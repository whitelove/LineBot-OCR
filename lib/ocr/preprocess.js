import sharp from "sharp";
import { median } from "./geometry.js";
export async function resize(image, width, height) {
  const data = await sharp(image.data, {
    raw: { width: image.width, height: image.height, channels: 3 },
  })
    .resize(width, height, { fit: "fill", kernel: "linear" })
    .raw()
    .toBuffer();
  return { data, width, height };
}
export async function detectorInput(image) {
  const pad = Math.max(
    8,
    Math.floor(0.05 * Math.min(image.width, image.height)),
  );
  const w = image.width + pad * 2,
    h = image.height + pad * 2;
  const scale = Math.min(1280 / Math.max(w, h), 4);
  const width = Math.max(32, Math.round((w * scale) / 32) * 32),
    height = Math.max(32, Math.round((h * scale) / 32) * 32);
  // Sharp applies extend AFTER resize regardless of call order. Materialize the
  // border first or the tensor stride would silently disagree with image width.
  const padded = await sharp(image.data, {
    raw: { width: image.width, height: image.height, channels: 3 },
  })
    .extend({
      top: pad,
      bottom: pad,
      left: pad,
      right: pad,
      background: "#fff",
    })
    .raw()
    .toBuffer();
  const data = await sharp(padded, {
    raw: { width: w, height: h, channels: 3 },
  })
    .resize(width, height, { fit: "fill", kernel: "linear" })
    .raw()
    .toBuffer();
  const tensor = new Float32Array(width * height * 3),
    mean = [0.485, 0.456, 0.406],
    std = [0.229, 0.224, 0.225];
  // Upstream OpenCV input is BGR; channel normalization must use that order.
  for (let i = 0; i < width * height; i++)
    for (let c = 0; c < 3; c++)
      tensor[c * width * height + i] =
        (data[i * 3 + 2 - c] / 255 - mean[c]) / std[c];
  return { tensor, width, height, pad, paddedWidth: w, paddedHeight: h };
}
export function flattenGray(image) {
  const { width: w, height: h } = image,
    g = new Uint8Array(w * h),
    bg = new Uint8Array(w);
  for (let i = 0; i < g.length; i++)
    g[i] = Math.round(
      0.299 * image.data[3 * i] +
        0.587 * image.data[3 * i + 1] +
        0.114 * image.data[3 * i + 2],
    );
  const k = Math.max(2, Math.floor(h / 6));
  for (let x = 0; x < w; x++) {
    const col = [];
    for (let y = 0; y < Math.min(k, h); y++) {
      col.push(g[y * w + x], g[(h - 1 - y) * w + x]);
    }
    bg[x] = Math.floor(median(col));
  }
  const radius = (Math.max(3, Math.min(h | 1, 255)) - 1) / 2,
    smooth = new Uint8Array(w);
  for (let x = 0; x < w; x++) {
    const col = [];
    for (let dx = -radius; dx <= radius; dx++)
      col.push(bg[Math.max(0, Math.min(w - 1, x + dx))]);
    smooth[x] = median(col);
  }
  const hist = new Uint32Array(256),
    diff = new Uint8Array(g.length);
  for (let i = 0; i < g.length; i++) {
    diff[i] = Math.abs(g[i] - smooth[i % w]);
    hist[diff[i]]++;
  }
  let hi = 0,
    sum = 0;
  for (; hi < 255; hi++) {
    sum += hist[hi];
    if (sum >= 0.98 * g.length) break;
  }
  hi = Math.max(24, hi);
  return Uint8Array.from(diff, (d) =>
    Math.floor(255 - Math.min(255, (d * 255) / hi)),
  );
}
