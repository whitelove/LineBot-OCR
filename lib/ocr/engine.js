import { readFile } from "node:fs/promises";
import path from "node:path";
import * as ort from "onnxruntime-node";
import sharp from "sharp";
import { decodeImage } from "../image.js";
import { AppError } from "../errors.js";
import { detect } from "./detection.js";
import { recognize } from "./recognition.js";
import {
  cropLine,
  distance,
  median,
  rotateQuarter,
  skewAngle,
  quadPoint,
} from "./geometry.js";
import { flattenGray } from "./preprocess.js";
import {
  canonical,
  invalidShare,
  readingOrder,
  fragmentIndices,
} from "./postprocess.js";

let sessionsPromise;
let busy = false;
export function getSessions() {
  if (!sessionsPromise)
    sessionsPromise = (async () => {
      const dir = path.join(process.cwd(), "models"),
        options = {
          executionProviders: ["cpu"],
          intraOpNumThreads: 1,
          interOpNumThreads: 1,
          graphOptimizationLevel: "all",
        };
      const [det, rec, dict, config] = await Promise.all([
        ort.InferenceSession.create(path.join(dir, "det.onnx"), options),
        ort.InferenceSession.create(path.join(dir, "rec.onnx"), options),
        readFile(path.join(dir, "rec_dict.txt"), "utf8"),
        readFile(path.join(dir, "config.json"), "utf8"),
      ]);
      return {
        det,
        rec,
        dictionary: ["", ...dict.split("\n").filter(Boolean), " "],
        config: JSON.parse(config),
      };
    })().catch((error) => {
      sessionsPromise = undefined;
      throw error;
    });
  return sessionsPromise;
}
async function readBoxes(image, boxes, sessions, check) {
  const crops = boxes.map((b) => cropLine(image, b)),
    tall = crops
      .map((c, i) => (c.height >= 1.5 * c.width ? i : -1))
      .filter((i) => i >= 0);
  const res = await recognize(
    [
      ...crops,
      ...tall.map((i) => rotateQuarter(crops[i], 270)),
      ...tall.map((i) => rotateQuarter(crops[i], 90)),
    ],
    sessions.rec,
    sessions.dictionary,
    check,
  );
  const out = res.slice(0, boxes.length);
  tall.forEach((i, j) => {
    for (const alt of [
      res[crops.length + j],
      res[crops.length + tall.length + j],
    ])
      if (alt.confidence > out[i].confidence) out[i] = alt;
  });
  return out;
}
function splitOne(image, box) {
  const crop = cropLine(image, box),
    { width: w, height: h } = crop;
  if (w < 4 * h || h < 4) return [box];
  const gray = flattenGray(crop),
    segments = [];
  let start = null,
    blank = 0;
  for (let x = 0; x < w; x++) {
    let ink = false;
    for (let y = 0; y < h && !ink; y++) ink = gray[y * w + x] < 128;
    if (ink) {
      if (start === null) start = x;
      else if (blank >= 1.2 * h) {
        segments.push([start, x - blank]);
        start = x;
      }
      blank = 0;
    } else if (start !== null) blank++;
  }
  if (start !== null) segments.push([start, w - blank]);
  if (
    !segments.length ||
    (segments.length === 1 &&
      segments[0][0] < 1.2 * h &&
      w - segments[0][1] < 1.2 * h)
  )
    return [box];
  return segments.map(([a, b]) => {
    const t0 = Math.max(0, (a - 0.15 * h) / w),
      t1 = Math.min(1, (b + 0.15 * h) / w);
    return [
      quadPoint(box, t0, 0),
      quadPoint(box, t1, 0),
      quadPoint(box, t1, 1),
      quadPoint(box, t0, 1),
    ];
  });
}
async function page(image, boxes, sessions, check) {
  const groups = boxes.map((b) => splitOne(image, b)),
    pieces = groups.flat(),
    changed = groups.map((g, i) => g.length !== 1 || g[0] !== boxes[i]);
  const res = await readBoxes(
    image,
    [...pieces, ...boxes.filter((_, i) => changed[i])],
    sessions,
    check,
  );
  let k = 0,
    e = pieces.length;
  const final = [],
    results = [];
  groups.forEach((group, i) => {
    const r = res.slice(k, k + group.length);
    k += group.length;
    if (changed[i]) {
      const alt = res[e++];
      if (
        Math.min(...r.map((x) => x.confidence)) <
          sessions.config.rec.drop_below ||
        r.reduce((n, x) => n + x.text.replace(/ /g, "").length, 0) <
          0.9 * alt.text.replace(/ /g, "").length
      ) {
        final.push(boxes[i]);
        results.push(alt);
        return;
      }
    }
    final.push(...group);
    results.push(...r);
  });
  return { boxes: final, results };
}
async function deskew(image, angle) {
  const radians = (angle * Math.PI) / 180,
    c = Math.cos(radians),
    s = Math.sin(radians);
  // Sharp positive rotation is clockwise; image-coordinate skew is clockwise.
  const { data, info } = await sharp(image.data, {
    raw: { width: image.width, height: image.height, channels: 3 },
  })
    .rotate(-angle, { background: "#fff" })
    .raw()
    .toBuffer({ resolveWithObject: true });
  const working = { data, width: info.width, height: info.height };
  const inverse = ([x, y]) => {
    const dx = x - (working.width - 1) / 2,
      dy = y - (working.height - 1) / 2;
    return [
      c * dx - s * dy + (image.width - 1) / 2,
      s * dx + c * dy + (image.height - 1) / 2,
    ];
  };
  return { image: working, inverse };
}
export async function extractText(buffer, { timeoutMs = 40_000 } = {}) {
  if (busy)
    throw new AppError("ระบบกำลังอ่านภาพอื่น กรุณาลองอีกครั้ง", 429, "OCR_BUSY");
  busy = true;
  const start = performance.now(),
    deadline = start + timeoutMs;
  const check = () => {
    if (performance.now() > deadline)
      throw new AppError(
        "ภาพนี้ใช้เวลาอ่านนานเกินไป กรุณาครอปภาพแล้วลองใหม่",
        422,
        "OCR_TIMEOUT",
      );
  };
  try {
    let image = await decodeImage(buffer);
    check();
    const original = { width: image.width, height: image.height },
      sessions = await getSessions();
    check();
    let boxes = await detect(image, sessions.det, check),
      rotation = 0,
      angle = 0;
    const inverse = [];
    if (
      !boxes.length &&
      image.height <= 200 &&
      image.width >= 1.5 * image.height
    )
      boxes = [
        [
          [0, 0],
          [image.width - 1, 0],
          [image.width - 1, image.height - 1],
          [0, image.height - 1],
        ],
      ];
    const vertical = boxes.filter(
        (b) => distance(b[0], b[3]) >= 2 * Math.max(1, distance(b[0], b[1])),
      ),
      horizontal = boxes.filter(
        (b) => distance(b[0], b[1]) >= 2 * Math.max(1, distance(b[0], b[3])),
      );
    if (vertical.length >= 3 && vertical.length > horizontal.length) {
      const crops = vertical
        .sort((a, b) => distance(b[0], b[3]) - distance(a[0], a[3]))
        .slice(0, 8)
        .map((b) => cropLine(image, b));
      const res = await recognize(
        [
          ...crops.map((c) => rotateQuarter(c, 270)),
          ...crops.map((c) => rotateQuarter(c, 90)),
        ],
        sessions.rec,
        sessions.dictionary,
        check,
      );
      rotation =
        res.slice(0, crops.length).reduce((n, r) => n + r.confidence, 0) >
        res.slice(crops.length).reduce((n, r) => n + r.confidence, 0)
          ? 270
          : 90;
      const { width: w, height: h } = image;
      inverse.push(([x, y]) =>
        rotation === 90 ? [y, h - 1 - x] : [w - 1 - y, x],
      );
      image = rotateQuarter(image, rotation);
      boxes = await detect(image, sessions.det, check);
    }
    angle = skewAngle(boxes);
    if (Math.abs(angle) >= 2.5) {
      const straight = await deskew(image, angle);
      inverse.push(straight.inverse);
      image = straight.image;
      boxes = await detect(image, sessions.det, check);
    }
    if (boxes.length > 240)
      throw new AppError("พบข้อความจำนวนมาก กรุณาแบ่งภาพเป็นส่วนย่อย", 422);
    let p = await page(image, boxes, sessions, check);
    const confs = p.results
      .filter((r) => r.text.length >= 2)
      .map((r) => r.confidence);
    if (!rotation && confs.length >= 3 && median(confs) < 0.8) {
      const idx = p.boxes
        .map((_, i) => i)
        .filter(
          (i) =>
            distance(p.boxes[i][0], p.boxes[i][1]) >=
            2 * distance(p.boxes[i][0], p.boxes[i][3]),
        )
        .sort(
          (a, b) =>
            distance(p.boxes[b][0], p.boxes[b][1]) -
            distance(p.boxes[a][0], p.boxes[a][1]),
        )
        .slice(0, 8);
      if (idx.length >= 3) {
        const flipped = await recognize(
          idx.map((i) => rotateQuarter(cropLine(image, p.boxes[i]), 180)),
          sessions.rec,
          sessions.dictionary,
          check,
        );
        if (
          flipped.reduce((n, r) => n + r.confidence, 0) >
          idx.reduce((n, i) => n + p.results[i].confidence, 0) +
            0.15 * idx.length
        ) {
          const { width: w, height: h } = image;
          inverse.push(([x, y]) => [w - 1 - x, h - 1 - y]);
          image = rotateQuarter(image, 180);
          rotation = 180;
          boxes = await detect(image, sessions.det, check);
          p = await page(image, boxes, sessions, check);
        }
      }
    }
    check();
    const rows = readingOrder(
        p.boxes,
        p.results.map((r) => r.text),
      ),
      fragments = fragmentIndices(p.boxes, p.results),
      lines = [],
      texts = [],
      dropped = [];
    rows.forEach((row, ri) => {
      const parts = [];
      for (const i of row) {
        if (fragments.has(i)) continue;
        const r = p.results[i],
          text = canonical(r.text),
          cfg = sessions.config.rec;
        const box = p.boxes[i].map((point) => {
          let q = point;
          for (let j = inverse.length - 1; j >= 0; j--) q = inverse[j](q);
          return q.map(
            (v, k) =>
              Math.round(
                Math.max(
                  0,
                  Math.min((k ? original.height : original.width) - 1, v),
                ) * 10,
              ) / 10,
          );
        });
        const line = {
          text,
          confidence: Math.round(r.confidence * 10000) / 10000,
          row: ri,
          box,
        };
        if (
          !text ||
          r.confidence < cfg.drop_below ||
          text.replace(/ /g, "").length < cfg.min_chars ||
          (r.confidence < cfg.junk_below &&
            invalidShare(text) > cfg.junk_invalid)
        ) {
          dropped.push(line);
          continue;
        }
        parts.push(text);
        lines.push(line);
      }
      if (parts.length) texts.push(parts.join(" "));
    });
    const chars = lines.reduce((n, l) => n + l.text.length, 0);
    return {
      text: texts.join("\n"),
      confidence: chars
        ? Math.round(
            (lines.reduce((n, l) => n + l.confidence * l.text.length, 0) /
              chars) *
              10000,
          ) / 10000
        : 0,
      lines,
      dropped,
      rotation,
      text_angle: Math.round(angle * 100) / 100,
      ms: Math.round(performance.now() - start),
    };
  } finally {
    busy = false;
  }
}
