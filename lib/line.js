import { createHmac, timingSafeEqual } from "node:crypto";
import { AppError } from "./errors.js";
import { MAX_IMAGE_BYTES, MIME_TYPES, readLimitedBody } from "./image.js";
// export const GREETING =
  // "สวัสดีครับ 👋 ส่งรูปภาพหรือ PDF เข้าแชตนี้ได้เลยครับ ระบบจะถอดข้อความให้อัตโนมัติ\nรองรับไฟล์ไม่เกิน 4 MB และ PDF สูงสุด 3 หน้า";
export const GREETING =
  "AA สวัสดีครับ BB 👋 ส่งรูปภาพหรือ PDF เข้าแชตนี้ได้เลยครับ ระบบจะถอดข้อความให้อัตโนมัติ CC \nรองรับไฟล์ไม่เกิน 4 MB และ PDF สูงสุด 3 หน้า!!!";
export const NO_TEXT = "ไม่พบข้อความในรูปภาพ กรุณาลองส่งภาพที่ชัดเจนขึ้นครับ";
export function formatOcrReply({ text, confidence, ms }) {
  const header = "📄 ข้อความที่อ่านได้จากรูปภาพ\n\n";
  const footer = `\n\n🎯 ความมั่นใจ: ${(confidence * 100).toFixed(1)}%\n⏱ เวลาประมวลผล OCR: ${(ms / 1000).toFixed(2)} วินาที`;
  // Reserve room for metrics even when OCR text exceeds LINE's five messages.
  // Four spare UTF-16 units cover surrogate pairs at message boundaries.
  const budget = 25_000 - 4 - header.length - footer.length;
  if (text.length > budget) {
    const notice = "\n\n[ข้อความยาวเกินขีดจำกัด กรุณาแบ่งส่งภาพเป็นส่วนย่อย]";
    let end = budget - notice.length;
    if (/[\uD800-\uDBFF]/.test(text[end - 1])) end--;
    text = text.slice(0, end) + notice;
  }
  return header + text + footer;
}
export function formatPdfReply(fileName, result) {
  const safeName = String(fileName).slice(0, 80);
  const header = "📄 ข้อความจาก " + safeName + "\n\n";
  const footer = "\n\n🎯 ความมั่นใจ: " + (result.confidence * 100).toFixed(1) +
    "%\n⏱ เวลาประมวลผล PDF OCR: " + (result.ms / 1000).toFixed(2) + " วินาที";
  const budget = 25_000 - header.length - footer.length - 120;
  const end = /[\uD800-\uDBFF]/.test(result.text[budget - 1]) ? budget - 1 : budget;
  const body = result.text.length > budget
    ? result.text.slice(0, end) + "\n[ข้อความยาวเกินกำหนด กรุณาแยก PDF แล้วส่งใหม่]"
    : result.text;
  return header + body + footer;
}
export function verifySignature(raw, signature, secret) {
  if (!signature || !secret || !/^[A-Za-z0-9+/]{43}=$/.test(signature))
    return false;
  const expected = createHmac("sha256", secret).update(raw).digest();
  const received = Buffer.from(signature, "base64");
  return (
    received.length === expected.length && timingSafeEqual(received, expected)
  );
}
export function textMessages(text) {
  const messages = [];
  let rest = text;
  const suffix = "\n\n[ข้อความยาวเกินขีดจำกัด กรุณาแบ่งส่งภาพเป็นส่วนย่อย]";
  for (let i = 0; i < 5 && rest.length; i++) {
    const limit = i === 4 && rest.length > 5000 ? 5000 - suffix.length : 5000;
    let end = Math.min(limit, rest.length);
    // LINE counts UTF-16 units. Never split a surrogate pair between messages.
    if (end < rest.length && /[\uD800-\uDBFF]/.test(rest[end - 1])) end--;
    let chunk = rest.slice(0, end);
    rest = rest.slice(end);
    if (i === 4 && rest) chunk += suffix;
    messages.push({ type: "text", text: chunk });
  }
  return messages;
}
export function createLineClient(token, fetchImpl = fetch) {
  async function authorizedFetch(url, options) {
    const value = typeof token === "function" ? await token() : token;
    const response = await fetchImpl(url, {
      ...options,
      headers: { ...options.headers, Authorization: `Bearer ${value}` },
    });
    if (response.status === 401 && typeof token === "function")
      token.invalidate?.(value);
    return response;
  }
  return {
    async showLoading(userId, signal) {
      const response = await authorizedFetch(
        "https://api.line.me/v2/bot/chat/loading/start",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ chatId: userId, loadingSeconds: 60 }),
          signal,
        },
      );
      await response.body?.cancel();
      if (!response.ok)
        throw new AppError(
          "เปิด loading animation ไม่สำเร็จ",
          502,
          "LINE_LOADING",
        );
    },
    async download(messageId, signal, allowBinary = false) {
      if (!/^[A-Za-z0-9_-]{1,200}$/.test(messageId || ""))
        throw new AppError("Invalid message ID");
      const response = await authorizedFetch(
        `https://api-data.line.me/v2/bot/message/${encodeURIComponent(messageId)}/content`,
        { signal },
      );
      if (!response.ok) {
        await response.body?.cancel();
        throw new AppError("ดาวน์โหลดภาพจาก LINE ไม่สำเร็จ", 502, "LINE_DOWNLOAD");
      }
      const type = response.headers.get("content-type")?.split(";")[0].trim().toLowerCase();
      if (!MIME_TYPES.has(type) && !(allowBinary && type === "application/octet-stream")) {
        await response.body?.cancel();
        throw new AppError("รองรับภาพ JPEG, PNG และ WebP เท่านั้น");
      }
      if (Number(response.headers.get("content-length")) > MAX_IMAGE_BYTES) {
        await response.body?.cancel();
        throw new AppError("กรุณาส่งภาพขนาดไม่เกิน 4 MB", 413);
      }
      return readLimitedBody(response.body, MAX_IMAGE_BYTES);
    },
    async downloadPdf(messageId, signal) {
      if (!/^[A-Za-z0-9_-]{1,200}$/.test(messageId || "")) {
        throw new AppError("Invalid message ID");
      }
      const response = await authorizedFetch(
        "https://api-data.line.me/v2/bot/message/" + encodeURIComponent(messageId) + "/content",
        { signal },
      );
      if (!response.ok) {
        await response.body?.cancel();
        throw new AppError("ดาวน์โหลด PDF จาก LINE ไม่สำเร็จ", 502, "LINE_DOWNLOAD");
      }
      const size = Number(response.headers.get("content-length") || 0);
      if (size > 4_000_000) {
        await response.body?.cancel();
        throw new AppError("กรุณาส่ง PDF ขนาดไม่เกิน 4 MB", 413, "PDF_SIZE");
      }
      const type = response.headers.get("content-type")?.split(";")[0].toLowerCase() || "";
      if (!["application/pdf", "application/octet-stream", "application/x-pdf"].includes(type)) {
        await response.body?.cancel();
        throw new AppError("ไฟล์ที่แนบมาไม่ใช่ PDF", 422, "PDF_TYPE");
      }
      return readLimitedBody(response.body, 4_000_000);
    },
    async reply(replyToken, text, signal) {
      const messages = textMessages(text);
      const response = await authorizedFetch(
        "https://api.line.me/v2/bot/message/reply",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ replyToken, messages }),
          signal,
        },
      );
      if (!response.ok) {
        await response.body?.cancel();
        throw new AppError("ส่งข้อความตอบกลับ LINE ไม่สำเร็จ", 502, "LINE_REPLY");
      }
      await response.body?.cancel();
    },
  };
}
