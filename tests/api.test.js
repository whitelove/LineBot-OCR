import { test } from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { createWebhookHandler as actualCreateWebhookHandler } from "../lib/webhook.js";
import {
  verifySignature,
  textMessages,
  formatOcrReply,
  GREETING,
  NO_TEXT,
  createLineClient,
} from "../lib/line.js";
import { AppError } from "../lib/errors.js";
import { decodeImage, readLimitedBody } from "../lib/image.js";
import { canonical } from "../lib/ocr/postprocess.js";
const secret = "test-secret",
  token = "test-token";
const env = { LINE_CHANNEL_SECRET: secret, LINE_CHANNEL_ID: "123456" };
// Existing workflow tests mock the token exchange separately from Messaging API calls.
function createWebhookHandler(options) {
  const messagingFetch = options.fetchImpl;
  return actualCreateWebhookHandler({
    ...options,
    fetchImpl: async (url, init) => url.endsWith("/oauth2/v3/token")
      ? Response.json({ access_token: token, expires_in: 900 })
      : messagingFetch(url, init),
  });
}
function request(events, signature = true) {
  const body = JSON.stringify({ events });
  return new Request("http://localhost/api/webhook", {
    method: "POST",
    body,
    headers: {
      "x-line-signature": signature
        ? createHmac("sha256", secret).update(body).digest("base64")
        : "bad",
    },
  });
}
const imageEvent = {
  type: "message",
  webhookEventId: "evt-1",
  replyToken: "reply-1",
  message: { type: "image", id: "123" },
};

for (const command of ["อัพโหลด", "อัปโหลด", "upload", "ไฟล์ PDF"])
  test(`text replies with direct-send instructions without selection buttons: ${command}`, async () => {
    const post = createWebhookHandler({ env, ocr: () => assert.fail(), fetchImpl: async (_url, options) => {
      const message = JSON.parse(options.body).messages[0];
      assert.equal(message.quickReply, undefined);
      assert.equal(message.text, GREETING);
      return Response.json({});
    } });
    assert.equal((await post(request([{ ...imageEvent, message: { type: "text", text: command } }]))).status, 200);
  });

test("PDF file event downloads content, runs PDF OCR, replies with metrics and deduplicates", async () => {
  let reads = 0, replies = 0;
  const post = createWebhookHandler({ env, ocr: () => assert.fail(),
    pdfOcr: async (buffer, _ocr, options) => {
      reads++;
      assert.equal(buffer.toString(), "%PDF-test");
      assert.ok(options.timeoutMs > 0);
      return { text: "หน้า 1\nสวัสดี", confidence: 0.98, ms: 1500 };
    },
    fetchImpl: async (url, options) => {
      if (url.includes("api-data")) return new Response("%PDF-test", { headers: { "content-type": "application/octet-stream" } });
      replies++;
      const message = JSON.parse(options.body).messages[0];
      assert.match(message.text, /scan.pdf/);
      assert.match(message.text, /หน้า 1\nสวัสดี/);
      assert.match(message.text, /98.0%/);
      assert.match(message.text, /1.50 วินาที/);
      assert.equal(message.quickReply, undefined);
      return Response.json({});
    },
  });
  const events = [{ ...imageEvent, message: { type: "file", id: "123", fileName: "scan.pdf", fileSize: 100 } }];
  assert.equal((await post(request(events))).status, 200);
  assert.equal((await post(request(events))).status, 200);
  assert.equal(reads, 1);
  assert.equal(replies, 1);
});

test("image file attachment accepts binary content and still invokes image OCR", async () => {
  let reads = 0;
  const post = createWebhookHandler({ env,
    ocr: async () => { reads++; return { text: "hello", confidence: 1, ms: 1 }; },
    fetchImpl: async (url) => url.includes("api-data")
      ? new Response("image", { headers: { "content-type": "application/octet-stream" } }) : Response.json({}),
  });
  assert.equal((await post(request([{ ...imageEvent, message: { type: "file", id: "123", fileName: "scan.png", fileSize: 100 } }]))).status, 200);
  assert.equal(reads, 1);
});

for (const attachment of [{ fileName: "doc.docx", fileSize: 10 }, { fileName: "doc.pdf", fileSize: 4_000_001 }])
  test(`unsupported attachment replies with an error instead of greeting: ${attachment.fileName}/${attachment.fileSize}`, async () => {
    const post = createWebhookHandler({ env, ocr: () => assert.fail(), fetchImpl: async (url, options) => {
      assert.ok(!url.includes("api-data"));
      assert.match(JSON.parse(options.body).messages[0].text, /รองรับ|4 MB/);
      return Response.json({});
    } });
    assert.equal((await post(request([{ ...imageEvent, message: { type: "file", id: "123", ...attachment } }]))).status, 200);
  });
test("raw signature validates; tampering, malformed and missing signatures fail", () => {
  const raw = Buffer.from('{ "events": [] }'),
    sig = createHmac("sha256", secret).update(raw).digest("base64");
  assert.ok(verifySignature(raw, sig, secret));
  assert.ok(!verifySignature(Buffer.from('{"events":[]}'), sig, secret));
  for (const signature of [null, "abc", "!", sig + "="])
    assert.ok(!verifySignature(raw, signature, secret));
});
test("reject invalid signature without calling OCR or LINE", async () => {
  const post = createWebhookHandler({
    env,
    ocr: () => assert.fail(),
    fetchImpl: () => assert.fail(),
  });
  assert.equal((await post(request([], false))).status, 401);
});
test("LINE Verify with no events succeeds without access token or OCR", async () => {
  const post = createWebhookHandler({
    env: { LINE_CHANNEL_SECRET: secret },
    ocr: () => assert.fail(),
    fetchImpl: () => assert.fail(),
  });
  assert.equal((await post(request([]))).status, 200);
});
test("text message awaits Thai instruction reply", async () => {
  let replied = false;
  const post = createWebhookHandler({
    env,
    ocr: () => assert.fail(),
    fetchImpl: async (url, opts) => {
      await new Promise((r) => setTimeout(r, 5));
      assert.equal(JSON.parse(opts.body).messages[0].text, GREETING);
      replied = true;
      return new Response("{}");
    },
  });
  assert.equal(
    (
      await post(
        request([{ ...imageEvent, message: { type: "text", text: "hi" } }]),
      )
    ).status,
    200,
  );
  assert.ok(replied);
});
test("image downloads through LINE Content API, invokes OCR, and awaits reply; duplicate skipped", async () => {
  const calls = [];
  let ocrCalls = 0;
  const post = createWebhookHandler({
    env,
    ocr: async (buffer) => {
      assert.equal(buffer.toString(), "image");
      ocrCalls++;
      return { text: "สวัสดี", confidence: 0.9876, ms: 1234 };
    },
    fetchImpl: async (url, opts) => {
      calls.push(url);
      assert.equal(opts.headers.Authorization, `Bearer ${token}`);
      if (url.includes("api-data.line.me"))
        return new Response("image", {
          headers: { "Content-Type": "image/png" },
        });
      assert.equal(
        JSON.parse(opts.body).messages[0].text,
        "📄 ข้อความที่อ่านได้จากรูปภาพ\n\nสวัสดี\n\n🎯 ความมั่นใจ: 98.8%\n⏱ เวลาประมวลผล OCR: 1.23 วินาที",
      );
      return new Response("{}");
    },
  });
  assert.equal((await post(request([imageEvent]))).status, 200);
  assert.equal((await post(request([imageEvent]))).status, 200);
  assert.equal(calls.length, 2);
  assert.equal(ocrCalls, 1);
});
test("empty OCR replies no-text instruction", async () => {
  const post = createWebhookHandler({
    env,
    ocr: async () => ({ text: "" }),
    fetchImpl: async (url, opts) => {
      if (url.includes("api-data"))
        return new Response("x", { headers: { "content-type": "image/png" } });
      assert.equal(JSON.parse(opts.body).messages[0].text, NO_TEXT);
      return new Response("{}");
    },
  });
  assert.equal((await post(request([imageEvent]))).status, 200);
});
test("reply failure remains retryable; no second reply attempt", async () => {
  let replies = 0;
  const post = createWebhookHandler({
    env,
    ocr: () => assert.fail(),
    fetchImpl: async () => {
      replies++;
      return new Response("{}", { status: 500 });
    },
  });
  const events = [{ ...imageEvent, message: { type: "text" } }];
  assert.equal((await post(request(events))).status, 502);
  assert.equal(replies, 1);
  assert.equal((await post(request(events))).status, 502);
  assert.equal(replies, 2);
});
test("bad image from LINE returns readable error", async () => {
  let text;
  const post = createWebhookHandler({
    env,
    ocr: async () => {
      throw new AppError("อ่านไฟล์ภาพไม่ได้");
    },
    fetchImpl: async (url, opts) =>
      url.includes("api-data")
        ? new Response("x", { headers: { "content-type": "image/png" } })
        : ((text = JSON.parse(opts.body).messages[0].text), new Response("{}")),
  });
  assert.equal((await post(request([imageEvent]))).status, 200);
  assert.equal(text, "อ่านไฟล์ภาพไม่ได้");
});
test("LINE image download rejects unexpected MIME and oversized streams", async () => {
  const line = createLineClient(
    token,
    async () =>
      new Response("bad", { headers: { "content-type": "text/html" } }),
  );
  await assert.rejects(line.download("123"), /รองรับภาพ/);
  const large = createLineClient(
    token,
    async () =>
      new Response("x", {
        headers: { "content-type": "image/png", "content-length": "4000001" },
      }),
  );
  await assert.rejects(large.download("123"), /4 MB/);
});
test("LINE text splitting respects 5 messages, 5000 UTF-16 units, surrogate pairs and truncation marker", () => {
  const input = "ก😀".repeat(20_000),
    messages = textMessages(input);
  assert.equal(messages.length, 5);
  assert.match(messages[4].text, /ข้อความยาวเกิน/);
  for (const msg of messages) {
    assert.ok(msg.text.length <= 5000);
    assert.ok(!/[\uD800-\uDBFF]$/.test(msg.text));
    assert.ok(!/^[\uDC00-\uDFFF]/.test(msg.text));
  }
  const text = "😀".repeat(6000);
  assert.equal(
    textMessages(text)
      .map((m) => m.text)
      .join(""),
    text,
  );
});
test("bounded stream reader stops excess bytes", async () => {
  await assert.rejects(
    readLimitedBody(new Response("123456").body, 5),
    /ขนาดใหญ่/,
  );
});
test("invalid image and SVG rejected", async () => {
  await assert.rejects(decodeImage(Buffer.from("bad")), /อ่านไฟล์ภาพไม่ได้/);
  await assert.rejects(
    decodeImage(
      Buffer.from(
        '<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100"/>',
      ),
    ),
    /อ่านไฟล์ภาพไม่ได้/,
  );
});
test("Thai canonicalization matches upstream examples", () => {
  assert.equal(canonical("นํ้า น้ํา เเ ำำ กี้้"), "น้ำ น้ำ แ ำ กี้");
});

test("private image starts LINE loading before download and OCR, then replies once", async () => {
  const order = [];
  const post = createWebhookHandler({
    env,
    ocr: async () => {
      order.push("ocr");
      return { text: "สวัสดี", confidence: 0.9876, ms: 1234 };
    },
    fetchImpl: async (url, options) => {
      assert.equal(options.headers.Authorization, `Bearer ${token}`);
      if (url.endsWith("/chat/loading/start")) {
        order.push("loading");
        assert.deepEqual(JSON.parse(options.body), {
          chatId: "Utest",
          loadingSeconds: 60,
        });
        assert.ok(options.signal instanceof AbortSignal);
        return new Response("{}", { status: 202 });
      }
      if (url.includes("api-data")) {
        order.push("download");
        return new Response("image", {
          headers: { "content-type": "image/png" },
        });
      }
      order.push("reply");
      assert.match(JSON.parse(options.body).messages[0].text, /สวัสดี/);
      return new Response("{}");
    },
  });
  const event = { ...imageEvent, source: { type: "user", userId: "Utest" } };
  assert.equal((await post(request([event]))).status, 200);
  assert.equal((await post(request([event]))).status, 200);
  assert.deepEqual(order, ["loading", "download", "ocr", "reply"]);
});

for (const failure of ["http", "timeout"])
  test(`loading ${failure} failure still completes OCR and reply`, async () => {
    let replied = false,
      read = false;
    const post = createWebhookHandler({
      env,
      ocr: async () => {
        read = true;
        return { text: "สวัสดี", confidence: 0.9876, ms: 1234 };
      },
      fetchImpl: async (url) => {
        if (url.endsWith("/chat/loading/start")) {
          if (failure === "timeout")
            throw new DOMException("Timed out", "TimeoutError");
          return new Response("{}", { status: 500 });
        }
        if (url.includes("api-data"))
          return new Response("image", {
            headers: { "content-type": "image/png" },
          });
        replied = true;
        return new Response("{}");
      },
    });
    assert.equal(
      (
        await post(
          request([
            { ...imageEvent, source: { type: "user", userId: "Utest" } },
          ]),
        )
      ).status,
      200,
    );
    assert.ok(read && replied);
  });

test("group, room and missing user ID skip loading but still read images", async () => {
  for (const source of [
    { type: "group", groupId: "Gtest", userId: "Utest" },
    { type: "room", roomId: "Rtest", userId: "Utest" },
    { type: "user" },
  ]) {
    const post = createWebhookHandler({
      env,
      ocr: async () => ({ text: "สวัสดี", confidence: 0.9876, ms: 1234 }),
      fetchImpl: async (url) => {
        assert.ok(!url.endsWith("/chat/loading/start"));
        return url.includes("api-data")
          ? new Response("image", { headers: { "content-type": "image/png" } })
          : new Response("{}");
      },
    });
    assert.equal(
      (await post(request([{ ...imageEvent, source }]))).status,
      200,
    );
  }
});

test("private text message replies without loading", async () => {
  const post = createWebhookHandler({
    env,
    ocr: () => assert.fail(),
    fetchImpl: async (url) => {
      assert.ok(url.endsWith("/message/reply"));
      return new Response("{}");
    },
  });
  assert.equal(
    (
      await post(
        request([
          {
            ...imageEvent,
            source: { type: "user", userId: "Utest" },
            message: { type: "text", text: "hi" },
          },
        ]),
      )
    ).status,
    200,
  );
});

test("OCR reply keeps metrics after very long text within LINE limits", () => {
  const messages = textMessages(
    formatOcrReply({ text: "😀ก".repeat(12000), confidence: 0.9876, ms: 1234 }),
  );
  assert.equal(messages.length, 5);
  for (const message of messages) assert.ok(message.text.length <= 5000);
  assert.match(messages.at(-1).text, /ข้อความยาวเกินขีดจำกัด/);
  assert.ok(
    messages
      .at(-1)
      .text.endsWith("🎯 ความมั่นใจ: 98.8%\n⏱ เวลาประมวลผล OCR: 1.23 วินาที"),
  );
});
test("OCR reply displays zero confidence and subsecond duration", () => {
  assert.equal(
    formatOcrReply({ text: "test", confidence: 0, ms: 45 }),
    "📄 ข้อความที่อ่านได้จากรูปภาพ\n\ntest\n\n🎯 ความมั่นใจ: 0.0%\n⏱ เวลาประมวลผล OCR: 0.04 วินาที",
  );
});
