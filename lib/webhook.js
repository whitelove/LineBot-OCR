import { AppError, errorResponse } from "./errors.js";
import { readLimitedBody } from "./image.js";
import { createStatelessTokenProvider } from "./line-token.js";
import { extractPdfText, validatePdfAttachment } from "./pdf.js";
import {
  verifySignature,
  createLineClient,
  GREETING,
  NO_TEXT,
  formatOcrReply,
  formatPdfReply,
} from "./line.js";

export function createWebhookHandler({
  ocr,
  pdfOcr = extractPdfText,
  env = process.env,
  fetchImpl = fetch,
  now = Date.now,
} = {}) {
  const line = createLineClient(
    createStatelessTokenProvider({ env, fetchImpl, now }),
    fetchImpl,
  );
  // Best-effort deduplication only: serverless instances do not share memory.
  const completed = new Map(),
    inFlight = new Map();
  return async function POST(request) {
    const received = now(),
      deadline = received + 48_000;
    try {
      if (!env.LINE_CHANNEL_SECRET)
        throw new AppError("ยังไม่ได้ตั้งค่า LINE_CHANNEL_SECRET", 503);
      const raw = await readLimitedBody(request.body, 1_000_000);
      if (
        !verifySignature(
          raw,
          request.headers.get("x-line-signature"),
          env.LINE_CHANNEL_SECRET,
        )
      )
        throw new AppError("Invalid signature", 401);
      let payload;
      try {
        payload = JSON.parse(raw.toString("utf8"));
      } catch {
        throw new AppError("Invalid JSON");
      }
      if (!Array.isArray(payload.events) || payload.events.length > 100)
        throw new AppError("Invalid events");
      if (!payload.events.length) return Response.json({ ok: true });
      for (const [key, expires] of completed)
        if (expires < received) completed.delete(key);
      for (const event of payload.events) {
        if (
          event.type !== "message" ||
          !event.replyToken ||
          event.mode === "standby"
        )
          continue;
        const key = event.webhookEventId || event.replyToken;
        if (completed.has(key)) continue;
        if (inFlight.has(key)) {
          await inFlight.get(key);
          continue;
        }
        const work = (async () => {
          const remaining = deadline - now();
          if (remaining < 2500)
            throw new AppError(
              "Webhook processing deadline reached",
              503,
              "WEBHOOK_TIMEOUT",
            );
          let text = GREETING;
          const message = event.message;
          if (message?.type === "image" || message?.type === "file") {
            // LINE supports loading only in one-to-one chats. Keep this cosmetic
            // request bounded so a loading failure cannot block OCR or its reply.
            if (event.source?.type === "user" && event.source.userId) {
              try {
                await line.showLoading(
                  event.source.userId,
                  AbortSignal.timeout(1500),
                );
              } catch (error) {
                console.warn(
                  "LINE loading unavailable:",
                  error.code || error.name,
                );
              }
            }
            try {
              const isPdf = message.type === "file" && /\.pdf$/i.test(message.fileName?.trim() || "");
              if (message.type === "file") {
                if (isPdf) validatePdfAttachment(message.fileName, message.fileSize);
                else if (!/\.(jpe?g|png|webp)$/i.test(message.fileName?.trim() || ""))
                  throw new AppError("รองรับไฟล์ PDF, JPEG, PNG และ WebP เท่านั้น", 422);
                else if (!Number.isFinite(message.fileSize) || message.fileSize <= 0 || message.fileSize > 4_000_000)
                  throw new AppError("กรุณาส่งไฟล์ขนาดไม่เกิน 4 MB", 413);
              }
              const file = await (isPdf ? line.downloadPdf : line.download)(
                message.id,
                AbortSignal.timeout(Math.min(8000, remaining - 1500)),
                message.type === "file",
              );
              const budget = Math.min(38_000, deadline - now() - 3000);
              if (budget <= 0)
                throw new AppError(
                  "ภาพนี้ใช้เวลาอ่านนานเกินไป กรุณาครอปภาพแล้วลองใหม่",
                  422,
                );
              const result = isPdf
                ? await pdfOcr(file, ocr, { timeoutMs: budget })
                : await ocr(file, { timeoutMs: budget });
              text = isPdf ? formatPdfReply(message.fileName, result)
                : result.text ? formatOcrReply(result) : NO_TEXT;
            } catch (error) {
              // Transient upstream failures must remain retryable by LINE.
              if (error instanceof AppError && error.status >= 500) throw error;
              text =
                error instanceof AppError
                  ? error.message
                  : "อ่านไฟล์ไม่สำเร็จ กรุณาลองส่งไฟล์ใหม่ครับ";
            }
          }
          if (deadline - now() <= 0)
            throw new AppError(
              "Reply deadline exceeded",
              503,
              "WEBHOOK_TIMEOUT",
            );
          await line.reply(
            event.replyToken,
            text,
            AbortSignal.timeout(Math.max(1, Math.min(5000, deadline - now()))),
          );
          if (completed.size >= 2000)
            completed.delete(completed.keys().next().value);
          completed.set(key, now() + 10 * 60_000);
        })();
        inFlight.set(key, work);
        try {
          await work;
        } finally {
          inFlight.delete(key);
        }
      }
      return Response.json({ ok: true });
    } catch (error) {
      return errorResponse(error);
    }
  };
}
