import { extractText } from "../../../lib/ocr/engine.js";
import { createWebhookHandler } from "../../../lib/webhook.js";
export const runtime = "nodejs";
export const maxDuration = 60;
export const POST = createWebhookHandler({ ocr: extractText });
