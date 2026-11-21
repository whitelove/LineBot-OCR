import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import sharp from "sharp";
import { extractText, getSessions } from "../lib/ocr/engine.js";
import { createWebhookHandler } from "../lib/webhook.js";
import { createHmac } from "node:crypto";
import { scannedPdf } from "./helpers/pdf.js";
import { extractPdfText } from "../lib/pdf.js";
const evidence = [];
test("ONNX singleton loads real detector, recognizer and 530 character classes", async () => {
  assert.equal(getSessions(), getSessions());
  const { det, rec, dictionary } = await getSessions();
  assert.equal(dictionary.length, 530);
  assert.ok(det.inputNames.length);
  assert.ok(rec.inputNames.length);
});
for (const name of ["thai", "english", "multiline"])
  test(`real OCR: ${name}`, async () => {
    const image = await readFile(`tests/fixtures/${name}.png`),
      expected = (await readFile(`tests/fixtures/${name}.txt`, "utf8")).trim();
    const result = await extractText(image);
    evidence.push({ name, expected, ...result });
    console.log(
      JSON.stringify({
        name,
        text: result.text,
        confidence: result.confidence,
        ms: result.ms,
      }),
    );
    assert.equal(result.text, expected);
    assert.ok(result.confidence > 0.8);
    assert.equal(result.lines.length, expected.split("\n").length);
  });
for (const angle of [90, 180, 270, 12])
  test(`real OCR: multiline rotated ${angle} degrees`, async () => {
    const image = await sharp(await readFile("tests/fixtures/multiline.png"))
      .rotate(angle, { background: "#fff" })
      .png()
      .toBuffer();
    const expected = (
        await readFile("tests/fixtures/multiline.txt", "utf8")
      ).trim(),
      result = await extractText(image);
    evidence.push({ name: `rotation-${angle}`, expected, ...result });
    console.log(
      JSON.stringify({
        angle,
        text: result.text,
        rotation: result.rotation,
        text_angle: result.text_angle,
        ms: result.ms,
      }),
    );
    assert.equal(result.text, expected);
    const meta = await sharp(image).metadata();
    for (const line of result.lines)
      for (const [x, y] of line.box) {
        assert.ok(x >= 0 && x < meta.width);
        assert.ok(y >= 0 && y < meta.height);
      }
  });
test("blank page returns no text", async () => {
  const image = await sharp({
    create: { width: 600, height: 400, channels: 3, background: "#fff" },
  })
    .png()
    .toBuffer();
  assert.equal((await extractText(image)).text, "");
});
test("invalid image fails before inference", async () => {
  await assert.rejects(
    extractText(Buffer.from("not an image")),
    /อ่านไฟล์ภาพไม่ได้/,
  );
});
for (const format of ["jpeg", "webp"])
  test(`real OCR also decodes ${format}`, async () => {
    const image = await sharp(await readFile("tests/fixtures/english.png"))
      .toFormat(format)
      .toBuffer();
    assert.equal(
      (await extractText(image)).text,
      (await readFile("tests/fixtures/english.txt", "utf8")).trim(),
    );
  });
test("signed LINE image workflow with real OCR and mocked network", async () => {
  const image = await readFile("tests/fixtures/thai.png");
  const expected = (await readFile("tests/fixtures/thai.txt", "utf8")).trim();
  let replied = false;
  const post = createWebhookHandler({
    env: {
      LINE_CHANNEL_SECRET: "test-secret",
      LINE_CHANNEL_ID: "123456",
    },
    ocr: extractText,
    fetchImpl: async (url, options) => {
      if (url.endsWith("/oauth2/v3/token"))
        return Response.json({ access_token: "test-token", expires_in: 900 });
      if (url.endsWith("/chat/loading/start")) {
        assert.deepEqual(JSON.parse(options.body), {
          chatId: "Utest",
          loadingSeconds: 60,
        });
        return new Response("{}", { status: 202 });
      }
      if (url.startsWith("https://api-data.line.me/"))
        return new Response(image, {
          headers: { "content-type": "image/png" },
        });
      const reply = JSON.parse(options.body).messages[0].text;
      assert.ok(reply.startsWith(`📄 ข้อความที่อ่านได้จากรูปภาพ\n\n${expected}\n\n`));
      assert.match(
        reply,
        /🎯 ความมั่นใจ: \d+\.\d%\n⏱ เวลาประมวลผล OCR: \d+\.\d{2} วินาที$/,
      );
      replied = true;
      return new Response("{}");
    },
  });
  const body = JSON.stringify({
    events: [
      {
        type: "message",
        replyToken: "test-reply",
        source: { type: "user", userId: "Utest" },
        message: { type: "image", id: "123" },
      },
    ],
  });
  const signature = createHmac("sha256", "test-secret")
    .update(body)
    .digest("base64");
  const response = await post(
    new Request("http://localhost/api/webhook", {
      method: "POST",
      body,
      headers: { "x-line-signature": signature },
    }),
  );
  assert.equal(response.status, 200);
  assert.ok(replied);
});
test("scanned Thai and English PDF runs real rasterization and real OCR", async () => {
  const thai = await readFile("tests/fixtures/thai.png");
  const english = await readFile("tests/fixtures/english.png");
  const result = await extractPdfText(await scannedPdf([thai, english]), extractText);
  const expectedThai = (await readFile("tests/fixtures/thai.txt", "utf8")).trim();
  const expectedEnglish = (await readFile("tests/fixtures/english.txt", "utf8")).trim();
  assert.equal(result.text, `หน้า 1\n${expectedThai}\n\nหน้า 2\n${expectedEnglish}`);
  assert.ok(result.confidence > 0.9);
});

test("write local evidence", async () => {
  await mkdir("test-results", { recursive: true });
  await writeFile(
    "test-results/ocr.json",
    JSON.stringify(
      {
        platform: process.platform,
        arch: process.arch,
        node: process.version,
        maxRssKiB: process.resourceUsage().maxRSS,
        results: evidence,
      },
      null,
      2,
    ),
  );
});
