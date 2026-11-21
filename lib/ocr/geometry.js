export const distance = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
export const median = (values) => {
  if (!values.length) return 0;
  const a = [...values].sort((x, y) => x - y),
    m = a.length >> 1;
  return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2;
};
function orderPoints(points) {
  const p = [...points].sort((a, b) => a[0] - b[0]);
  const left = p.slice(0, 2).sort((a, b) => a[1] - b[1]);
  const right = p.slice(2).sort((a, b) => a[1] - b[1]);
  return [left[0], right[0], right[1], left[1]];
}
function hull(points) {
  const sorted = [...points].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const cross = (o, a, b) =>
    (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const half = (arr) => {
    const out = [];
    for (const p of arr) {
      while (out.length > 1 && cross(out.at(-2), out.at(-1), p) <= 0) out.pop();
      out.push(p);
    }
    return out.slice(0, -1);
  };
  return [...half(sorted), ...half(sorted.reverse())];
}
// Convex hull edge projections give the same minimum-area rectangle as rotating calipers.
export function minimumBox(points, unclip = 0) {
  const p = hull(points);
  if (p.length < 3) return null;
  let best;
  for (let i = 0; i < p.length; i++) {
    const a = p[i],
      b = p[(i + 1) % p.length],
      d = distance(a, b);
    if (!d) continue;
    const c = (b[0] - a[0]) / d,
      s = (b[1] - a[1]) / d;
    let x0 = Infinity,
      x1 = -Infinity,
      y0 = Infinity,
      y1 = -Infinity;
    for (const [x, y] of p) {
      const u = x * c + y * s,
        v = -x * s + y * c;
      x0 = Math.min(x0, u);
      x1 = Math.max(x1, u);
      y0 = Math.min(y0, v);
      y1 = Math.max(y1, v);
    }
    const area = (x1 - x0) * (y1 - y0);
    if (!best || area < best.area) best = { c, s, x0, x1, y0, y1, area };
  }
  if (!best) return null;
  const { c, s, x0, x1, y0, y1 } = best;
  // DB unclip distance = area * ratio / perimeter. A round offset rectangle
  // has the same enclosing rectangle as extending both axes by this distance.
  const pad = (unclip * best.area) / (2 * (x1 - x0 + y1 - y0) || 1);
  const corners = [
    [x0 - pad, y0 - pad],
    [x1 + pad, y0 - pad],
    [x1 + pad, y1 + pad],
    [x0 - pad, y1 + pad],
  ].map(([x, y]) => [x * c - y * s, x * s + y * c]);
  return {
    box: orderPoints(corners),
    side: Math.min(x1 - x0, y1 - y0) + 2 * pad,
  };
}
export function inPolygon(x, y, points) {
  let sign = 0;
  for (let i = 0; i < points.length; i++) {
    const a = points[i],
      b = points[(i + 1) % points.length];
    const cross = (b[0] - a[0]) * (y - a[1]) - (b[1] - a[1]) * (x - a[0]);
    if (Math.abs(cross) < 1e-6) continue;
    const next = Math.sign(cross);
    if (sign && next !== sign) return false;
    sign = next;
  }
  return true;
}
function sample(image, x, y, channel) {
  x = Math.max(0, Math.min(image.width - 1, x));
  y = Math.max(0, Math.min(image.height - 1, y));
  const x0 = Math.floor(x),
    y0 = Math.floor(y),
    x1 = Math.min(x0 + 1, image.width - 1),
    y1 = Math.min(y0 + 1, image.height - 1);
  const dx = x - x0,
    dy = y - y0,
    at = (xx, yy) => image.data[(yy * image.width + xx) * 3 + channel];
  return (
    (at(x0, y0) * (1 - dx) + at(x1, y0) * dx) * (1 - dy) +
    (at(x0, y1) * (1 - dx) + at(x1, y1) * dx) * dy
  );
}
// Unit square -> quadrilateral homography (handles perspective after clipping).
export function quadPoint(box, u, v) {
  const [a, b, c, d] = box;
  const dx1 = b[0] - c[0],
    dx2 = d[0] - c[0],
    dx3 = a[0] - b[0] + c[0] - d[0];
  const dy1 = b[1] - c[1],
    dy2 = d[1] - c[1],
    dy3 = a[1] - b[1] + c[1] - d[1];
  const den = dx1 * dy2 - dx2 * dy1;
  const g = Math.abs(den) > 1e-9 ? (dx3 * dy2 - dx2 * dy3) / den : 0;
  const h = Math.abs(den) > 1e-9 ? (dx1 * dy3 - dx3 * dy1) / den : 0;
  const z = g * u + h * v + 1;
  return [
    ((b[0] - a[0] + g * b[0]) * u + (d[0] - a[0] + h * d[0]) * v + a[0]) / z,
    ((b[1] - a[1] + g * b[1]) * u + (d[1] - a[1] + h * d[1]) * v + a[1]) / z,
  ];
}
export function cropLine(image, box) {
  const width = Math.max(
    1,
    Math.floor(Math.max(distance(box[0], box[1]), distance(box[2], box[3]))),
  );
  const height = Math.max(
    1,
    Math.floor(Math.max(distance(box[0], box[3]), distance(box[1], box[2]))),
  );
  const data = Buffer.alloc(width * height * 3);
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      const [sx, sy] = quadPoint(box, x / width, y / height);
      for (let c = 0; c < 3; c++)
        data[(y * width + x) * 3 + c] = Math.round(sample(image, sx, sy, c));
    }
  return { data, width, height };
}
export function rotateQuarter(image, degrees) {
  degrees = (degrees + 360) % 360;
  if (!degrees) return image;
  const { width: w, height: h } = image;
  const width = degrees === 180 ? w : h,
    height = degrees === 180 ? h : w;
  const data = Buffer.alloc(width * height * 3);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const [xx, yy] =
        degrees === 90
          ? [h - 1 - y, x]
          : degrees === 180
            ? [w - 1 - x, h - 1 - y]
            : [y, w - 1 - x];
      const from = (y * w + x) * 3,
        to = (yy * width + xx) * 3;
      data[to] = image.data[from];
      data[to + 1] = image.data[from + 1];
      data[to + 2] = image.data[from + 2];
    }
  return { data, width, height };
}
export function skewAngle(boxes) {
  return median(
    boxes
      .filter(
        (b) => distance(b[0], b[1]) >= 3 * Math.max(1, distance(b[0], b[3])),
      )
      .map(
        (b) =>
          (Math.atan2(b[1][1] - b[0][1], b[1][0] - b[0][0]) * 180) / Math.PI,
      ),
  );
}
