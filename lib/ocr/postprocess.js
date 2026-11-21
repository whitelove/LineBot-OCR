import { distance, median, skewAngle } from "./geometry.js";
const VOWELS = new Set("ัิีึืฺุู็"),
  TONES = new Set("่้๊๋์๎");
const PUA = [
  0x0e10, 0x0e34, 0x0e35, 0x0e36, 0x0e37, 0x0e48, 0x0e49, 0x0e4a, 0x0e4b,
  0x0e4c, 0x0e48, 0x0e49, 0x0e4a, 0x0e4b, 0x0e4c, 0x0e0d, 0x0e31, 0x0e4d,
  0x0e47, 0x0e48, 0x0e49, 0x0e4a, 0x0e4b, 0x0e4c, 0x0e38, 0x0e39, 0x0e3a,
];
export function canonical(text) {
  return text
    .replace(/[\uf700-\uf71a]/g, (c) =>
      String.fromCodePoint(PUA[c.charCodeAt(0) - 0xf700]),
    )
    .replace(/[\u200b\u200c\u200d\u2060\u00ad\ufeff]/g, "")
    .replace(/\u00a0/g, " ")
    .normalize("NFC")
    .replace(/[ัิีึืฺุู็่้๊๋์๎ํ]{2,}/g, (run) =>
      [...run]
        .sort(
          (a, b) =>
            (VOWELS.has(a) ? 0 : TONES.has(a) ? 1 : 2) -
            (VOWELS.has(b) ? 0 : TONES.has(b) ? 1 : 2),
        )
        .filter((c, i, a) => !i || c !== a[i - 1])
        .join(""),
    )
    .replace(/([่-๋]?)ํ([่-๋]?)า/g, "$1$2ำ")
    .replace(/เเ/g, "แ")
    .replace(/ำำ/g, "ำ")
    .replace(/(?<![A-Za-z])[Ww](?=\.?[\u0e01-\u0e2e\u0e40-\u0e44])/g, "พ")
    .replace(/(?<=[๐-๙])[Oo0]|[Oo0](?=[๐-๙])/g, "๐")
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((s) => s.replace(/[ \t\f\v]+/g, " ").trim())
    .join("\n")
    .trim();
}
export function invalidShare(text) {
  let thai = 0,
    bad = 0;
  const mark = (c) => "ัิีึืฺุู็่้๊๋์ํ๎".includes(c || " "),
    cons = (c) => c >= "ก" && c <= "ฮ";
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c < "\u0e00" || c > "\u0e7f") continue;
    thai++;
    if (
      mark(c) &&
      !(cons(text[i - 1]) || (mark(text[i - 1]) && i >= 2 && cons(text[i - 2])))
    )
      bad++;
    else if ("เแโใไ".includes(c) && !cons(text[i + 1])) bad++;
  }
  return thai ? bad / thai : 0;
}
function lineHeight(boxes) {
  const heights = boxes.map((b) => Math.max(1, distance(b[0], b[3]))),
    lines = heights.filter(
      (h, i) => distance(boxes[i][0], boxes[i][1]) >= 2 * h,
    );
  return median(lines.length >= 3 ? lines : heights) || 1;
}
function gaps(intervals, minGap) {
  if (!intervals.length) return [];
  const sorted = [...intervals].sort((a, b) => a[0] - b[0]),
    out = [];
  let reach = sorted[0][1];
  for (const [lo, hi] of sorted.slice(1)) {
    if (lo - reach >= minGap) out.push([reach, lo]);
    reach = Math.max(reach, hi);
  }
  return out;
}
function blocks(idx, ext, h, texts, depth = 0) {
  if (idx.length < 6 || depth > 12) return [idx];
  const prose = (col) => {
    if (col.length < 12) return false;
    const widths = col.map((i) => ext[i][1] - ext[i][0]),
      span =
        Math.max(...col.map((i) => ext[i][1])) -
        Math.min(...col.map((i) => ext[i][0]));
    const chars = col
      .map((i) => texts[i])
      .join("")
      .replace(/\s/g, "");
    return (
      median(widths) >= 7 * h &&
      widths.filter((w) => w >= 0.75 * span).length >= 0.5 * col.length &&
      (chars.match(/[0-9๐-๙]/g)?.length || 0) <= 0.3 * chars.length
    );
  };
  const nextTo = (side, right) => {
    const g = gaps(
      side.map((i) => ext[i].slice(0, 2)),
      0.8 * h,
    );
    return !g.length
      ? side
      : side.filter((i) =>
          right ? ext[i][0] >= g.at(-1)[1] : ext[i][1] <= g[0][0],
        );
  };
  const enumValue = (text) => {
    const m = text.match(/^\s*\(?([0-9๐-๙]{1,4})\s*[.)]/);
    return m
      ? Number(m[1].replace(/[๐-๙]/g, (c) => c.charCodeAt(0) - 0x0e50))
      : null;
  };
  const numbered = (left, right) =>
    left.filter((i) => {
      const a = enumValue(texts[i]);
      return (
        a !== null &&
        right.some(
          (j) =>
            enumValue(texts[j]) === a + 1 &&
            Math.abs((ext[i][2] + ext[i][3] - ext[j][2] - ext[j][3]) / 2) <=
              0.5 * h,
        )
      );
    }).length >=
    0.5 * Math.min(left.length, right.length);
  const cuts = [];
  for (const [lo, hi] of gaps(
    idx.map((i) => ext[i].slice(0, 2)),
    0.8 * h,
  )) {
    const left = idx.filter((i) => ext[i][1] <= lo),
      right = idx.filter((i) => ext[i][0] >= hi),
      lc = nextTo(left, true),
      rc = nextTo(right, false);
    if (prose(lc) && prose(rc) && !numbered(lc, rc))
      cuts.push({ gap: hi - lo, a: left, b: right });
  }
  let cut = cuts.sort((a, b) => b.gap - a.gap)[0];
  if (!cut) {
    const g = gaps(
      idx.map((i) => ext[i].slice(2, 4)),
      0.8 * h,
    ).sort((a, b) => b[1] - b[0] - (a[1] - a[0]))[0];
    if (g)
      cut = {
        a: idx.filter((i) => ext[i][3] <= g[0]),
        b: idx.filter((i) => ext[i][2] >= g[1]),
      };
  }
  return cut
    ? [
        ...blocks(cut.a, ext, h, texts, depth + 1),
        ...blocks(cut.b, ext, h, texts, depth + 1),
      ]
    : [idx];
}
export function readingOrder(boxes, texts) {
  if (!boxes.length) return [];
  const angle = (-skewAngle(boxes) * Math.PI) / 180,
    c = Math.cos(angle),
    s = Math.sin(angle);
  const ext = boxes.map((b) => {
    const p = b.map(([x, y]) => [x * c - y * s, x * s + y * c]);
    return [
      Math.min(...p.map((p) => p[0])),
      Math.max(...p.map((p) => p[0])),
      Math.min(...p.map((p) => p[1])),
      Math.max(...p.map((p) => p[1])),
    ];
  });
  const h = lineHeight(boxes),
    cy = ext.map((e) => (e[2] + e[3]) / 2),
    hs = boxes.map((b) => Math.max(1, distance(b[0], b[3]))),
    out = [];
  for (const blk of blocks(
    boxes.map((_, i) => i),
    ext,
    h,
    texts,
  )) {
    let full = blk.filter((i) => hs[i] >= 0.6 * h);
    if (!full.length) full = blk;
    const small = blk.filter((i) => !full.includes(i)),
      rows = [];
    const centre = (r) => r.reduce((sum, i) => sum + cy[i], 0) / r.length;
    for (const i of [...full].sort((a, b) => cy[a] - cy[b])) {
      if (rows.length && Math.abs(cy[i] - centre(rows.at(-1))) <= 0.5 * h)
        rows.at(-1).push(i);
      else rows.push([i]);
    }
    const centres = rows.map(centre);
    for (const i of small) {
      let n = -1,
        d = Infinity;
      centres.forEach((v, j) => {
        if (Math.abs(cy[i] - v) < d) {
          d = Math.abs(cy[i] - v);
          n = j;
        }
      });
      if (n >= 0 && d <= 0.5 * (h + hs[i])) rows[n].push(i);
      else {
        rows.push([i]);
        centres.push(cy[i]);
      }
    }
    out.push(
      ...rows
        .map((r, i) => ({ r, c: centres[i] }))
        .sort((a, b) => a.c - b.c)
        .map(({ r }) => r.sort((a, b) => ext[a][0] - ext[b][0])),
    );
  }
  return out;
}
export function fragmentIndices(boxes, results) {
  const out = new Set();
  if (boxes.length < 3) return out;
  const h = lineHeight(boxes),
    hs = boxes.map((b) => distance(b[0], b[3]));
  const ext = boxes.map((b) => [
    Math.min(...b.map((p) => p[0])),
    Math.max(...b.map((p) => p[0])),
    Math.min(...b.map((p) => p[1])),
    Math.max(...b.map((p) => p[1])),
  ]);
  for (let i = 0; i < boxes.length; i++)
    if (hs[i] < 0.35 * h && results[i].text.replace(/ /g, "").length <= 3) {
      const a = ext[i];
      if (
        ext.some(
          (b, j) =>
            j !== i &&
            hs[j] >= 0.6 * h &&
            b[0] <= a[1] &&
            a[0] <= b[1] &&
            Math.min(Math.abs(a[2] - b[3]), Math.abs(b[2] - a[3])) <= 0.5 * h,
        )
      )
        out.add(i);
    }
  return out;
}
