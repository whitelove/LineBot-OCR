import sharp from "sharp";
import { pdf } from "pdf-to-img";
import { createCanvas } from "@napi-rs/canvas";
import { AppError } from "./errors.js";

// Bound PDF work to fit the existing LINE reply-token deadline.
export const MAX_PDF_BYTES = 4_000_000;
export const MAX_PDF_PAGES = 3;

// Check dimensions before allocating a canvas, including canvases for PDF images.
class BoundedCanvasFactory {
  create(width, height) {
    if (!(width > 0 && height > 0) || Math.ceil(width) * Math.ceil(height) > 16_000_000)
      throw new AppError("หน้า PDF มีความละเอียดสูงเกินไป กรุณาลดขนาดหน้า", 422, "PDF_PAGE_SIZE");
    const canvas = createCanvas(Math.ceil(width), Math.ceil(height));
    return { canvas, context: canvas.getContext("2d") };
  }
  reset(target, width, height) {
    const replacement = this.create(width, height);
    this.destroy(target);
    Object.assign(target, replacement);
  }
  destroy(target) {
    target.canvas.width = target.canvas.height = 0;
    target.canvas = target.context = null;
  }
}

export function validatePdfAttachment(fileName, fileSize) {
  if (typeof fileName !== "string" || !/\.pdf$/i.test(fileName.trim())) {
    throw new AppError("รองรับเฉพาะไฟล์ PDF (.pdf) เท่านั้น", 422, "PDF_TYPE");
  }
  if (!Number.isFinite(fileSize) || fileSize <= 0 || fileSize > MAX_PDF_BYTES) {
    throw new AppError("กรุณาส่ง PDF ขนาดไม่เกิน 4 MB", 413, "PDF_SIZE");
  }
}

export async function extractPdfText(buffer, ocr, { timeoutMs = 38_000 } = {}) {
  if (!Buffer.isBuffer(buffer) || !buffer.length || buffer.length > MAX_PDF_BYTES) {
    throw new AppError("กรุณาส่ง PDF ขนาดไม่เกิน 4 MB", 413, "PDF_SIZE");
  }
  if (buffer.subarray(0, 5).toString("ascii") !== "%PDF-") {
    throw new AppError("ไฟล์นี้ไม่ใช่ PDF ที่ถูกต้อง", 422, "PDF_INVALID");
  }
  const started = performance.now();
  const deadline = started + timeoutMs;
  let doc;
  try {
    // No third-party OCR service: pdf-to-img only rasterizes the document.
    // The exact same OpenThai2.0-OCR-Text engine reads each rendered page.
    doc = await pdf(buffer, {
      scale: 1.6,
      format: "png",
      docInitParams: {
        CanvasFactory: BoundedCanvasFactory,
        isEvalSupported: false,
        maxImageSize: 16_000_000,
      },
    });
    if (!doc.length) throw new AppError("PDF ไม่มีหน้าที่อ่านได้", 422, "PDF_EMPTY");
    if (doc.length > MAX_PDF_PAGES) {
      throw new AppError(
        "รองรับ PDF สูงสุด 3 หน้าต่อครั้ง กรุณาแยกไฟล์แล้วส่งใหม่",
        422,
        "PDF_PAGES",
      );
    }
    const pages = [];
    let weighted = 0, characters = 0;
    for (let index = 1; index <= doc.length; index++) {
      let remaining = deadline - performance.now();
      if (remaining < 2500) {
        throw new AppError("อ่าน PDF นานเกินไป กรุณาลดจำนวนหน้าแล้วลองใหม่", 422, "PDF_TIMEOUT");
      }
      const pagePng = await doc.getPage(index);
      // Flatten and resize so the OCR input respects its existing 4 MB image limit.
      const image = await sharp(pagePng, { limitInputPixels: 16_000_000 })
        .resize({ width: 1500, withoutEnlargement: true })
        .flatten({ background: "#ffffff" })
        .jpeg({ quality: 82 })
        .toBuffer();
      if (image.length > 4_000_000) {
        throw new AppError("หน้า PDF มีความละเอียดสูงเกินไป", 422, "PDF_PAGE_SIZE");
      }
      remaining = deadline - performance.now();
      if (remaining < 2500)
        throw new AppError("อ่าน PDF นานเกินไป กรุณาลดจำนวนหน้าแล้วลองใหม่", 422, "PDF_TIMEOUT");
      const result = await ocr(image, {
        timeoutMs: Math.min(remaining - 1800, 25_000),
      });
      const text = result.text?.trim() || "(ไม่พบข้อความ)";
      pages.push("หน้า " + index + "\n" + text);
      const count = result.text?.length || 0;
      weighted += (result.confidence || 0) * count;
      characters += count;
    }
    return {
      text: pages.join("\n\n"),
      confidence: characters ? weighted / characters : 0,
      ms: Math.round(performance.now() - started),
      pageCount: pages.length,
    };
  } catch (error) {
    if (error instanceof AppError) throw error;
    // Invalid, password-protected and unsupported PDFs are handled here.
    throw new AppError("เปิด PDF ไม่สำเร็จ กรุณาส่ง PDF ที่ไม่ติดรหัสผ่าน", 422, "PDF_PARSE");
  } finally {
    if (doc) await doc.destroy();
  }
}
