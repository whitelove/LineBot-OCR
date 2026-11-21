import sharp from "sharp";
import { AppError } from "./errors.js";
export const MAX_IMAGE_BYTES = 4_000_000;
const MAX_PIXELS = 16_000_000;
export const MIME_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);
export async function readLimitedBody(body, limit) {
  if (!body) throw new AppError("ไม่พบข้อมูล");
  const reader = body.getReader();
  const chunks = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > limit) {
        await reader.cancel();
        throw new AppError("ไฟล์มีขนาดใหญ่เกินกำหนด (สูงสุด 4 MB)", 413);
      }
      chunks.push(Buffer.from(value));
    }
  } finally {
    reader.releaseLock();
  }
  return Buffer.concat(chunks, size);
}
export async function decodeImage(buffer) {
  if (!buffer?.length || buffer.length > MAX_IMAGE_BYTES)
    throw new AppError("กรุณาเลือกภาพขนาดไม่เกิน 4 MB", 413);
  try {
    const source = sharp(buffer, {
      limitInputPixels: MAX_PIXELS,
      failOn: "warning",
      animated: false,
    });
    const meta = await source.metadata();
    if (!["jpeg", "png", "webp"].includes(meta.format) || (meta.pages || 1) > 1)
      throw new Error("format");
    const { data, info } = await source
      .autoOrient()
      .flatten({ background: "#ffffff" })
      .removeAlpha()
      .toColourspace("srgb")
      .raw()
      .toBuffer({ resolveWithObject: true });
    return { data, width: info.width, height: info.height };
  } catch {
    throw new AppError(
      "อ่านไฟล์ภาพไม่ได้ รองรับ JPEG, PNG และ WebP แบบภาพนิ่ง ไม่เกิน 16 ล้านพิกเซล",
    );
  }
}
