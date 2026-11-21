import * as ort from "onnxruntime-node";
import { detectorInput } from "./preprocess.js";
import { minimumBox, inPolygon } from "./geometry.js";

export function probabilityBoxes(prob, width, height, config = {}) {
  const {
    thresh = 0.2,
    box_thresh = 0.4,
    unclip = 1.4,
    max_candidates = 3000,
  } = config;
  const seen = new Uint8Array(width * height),
    queue = new Int32Array(width * height),
    boxes = [];
  let candidates = 0;
  // 8-connected foreground boundaries. Hole contours are deliberately omitted:
  // upstream RETR_LIST also finds holes, but these are not text-line regions.
  for (
    let start = 0;
    start < prob.length && candidates < max_candidates;
    start++
  ) {
    if (seen[start] || prob[start] <= thresh) continue;
    candidates++;
    let head = 0,
      tail = 1;
    queue[0] = start;
    seen[start] = 1;
    const boundary = [];
    while (head < tail) {
      const i = queue[head++],
        x = i % width,
        y = Math.floor(i / width);
      let edge = false;
      for (let dy = -1; dy <= 1; dy++)
        for (let dx = -1; dx <= 1; dx++) {
          if (!dx && !dy) continue;
          const xx = x + dx,
            yy = y + dy;
          if (xx < 0 || xx >= width || yy < 0 || yy >= height) {
            edge = true;
            continue;
          }
          const j = yy * width + xx;
          if (prob[j] <= thresh) {
            edge = true;
            continue;
          }
          if (!seen[j]) {
            seen[j] = 1;
            queue[tail++] = j;
          }
        }
      if (edge) boundary.push([x, y]);
    }
    const small = minimumBox(boundary);
    if (!small || small.side < 3) continue;
    const b = small.box;
    const x0 = Math.max(0, Math.floor(Math.min(...b.map((p) => p[0])))),
      x1 = Math.min(width - 1, Math.ceil(Math.max(...b.map((p) => p[0]))));
    const y0 = Math.max(0, Math.floor(Math.min(...b.map((p) => p[1])))),
      y1 = Math.min(height - 1, Math.ceil(Math.max(...b.map((p) => p[1]))));
    let score = 0,
      count = 0;
    for (let y = y0; y <= y1; y++)
      for (let x = x0; x <= x1; x++)
        if (inPolygon(x, y, b)) {
          score += prob[y * width + x];
          count++;
        }
    if (!count || score / count < box_thresh) continue;
    const big = minimumBox(b, unclip);
    if (big?.side >= 5) boxes.push(big.box);
  }
  return boxes;
}
export async function detect(image, session, checkBudget) {
  checkBudget();
  const input = await detectorInput(image);
  checkBudget();
  const outputs = await session.run({
    [session.inputNames[0]]: new ort.Tensor("float32", input.tensor, [
      1,
      3,
      input.height,
      input.width,
    ]),
  });
  const out = outputs[session.outputNames[0]],
    [height, width] = out.dims.slice(-2);
  const boxes = probabilityBoxes(out.data, width, height).map((box) =>
    box.map(([x, y]) => [
      Math.max(
        0,
        Math.min(image.width - 1, (x * input.paddedWidth) / width - input.pad),
      ),
      Math.max(
        0,
        Math.min(
          image.height - 1,
          (y * input.paddedHeight) / height - input.pad,
        ),
      ),
    ]),
  );
  checkBudget();
  return boxes.filter(
    (b) =>
      Math.max(...b.map((p) => p[0])) - Math.min(...b.map((p) => p[0])) >= 2 &&
      Math.max(...b.map((p) => p[1])) - Math.min(...b.map((p) => p[1])) >= 2,
  );
}
