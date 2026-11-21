import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import sharp from "sharp";
import { scannedPdf } from "./helpers/pdf.js";
import { extractPdfText, validatePdfAttachment } from "../lib/pdf.js";

test("PDF attachment validation rejects unsupported names and sizes", () => {
  validatePdfAttachment("Scan.PDF", 100);
  for (const name of [null, "doc.exe", "doc.pdf.exe"])
    assert.throws(() => validatePdfAttachment(name, 100), /PDF/);
  for (const size of [0, -1, undefined, Infinity, 4_000_001])
    assert.throws(() => validatePdfAttachment("doc.pdf", size), /4 MB/);
});

test("scanned pages rasterize in order and aggregate confidence by text length", async () => {
  const image = await readFile("tests/fixtures/english.png");
  let calls = 0;
  const result = await extractPdfText(await scannedPdf([image, image]), async (buffer, options) => {
    const metadata = await sharp(buffer).metadata();
    assert.equal(metadata.format, "jpeg");
    assert.ok(metadata.width <= 1500);
    assert.ok(options.timeoutMs > 0);
    return ++calls === 1 ? { text: "Hello", confidence: 0.8 } : { text: "World", confidence: 1 };
  });
  assert.equal(result.text, "หน้า 1\nHello\n\nหน้า 2\nWorld");
  assert.equal(result.pageCount, 2);
  assert.equal(result.confidence, 0.9);
});

test("PDF bounds reject oversized pages, too many pages, invalid content and exhausted budget", async () => {
  const image = await readFile("tests/fixtures/english.png");
  const neverOcr = () => assert.fail("must reject before OCR");
  await assert.rejects(extractPdfText(Buffer.from("not pdf"), neverOcr), error => error.code === "PDF_INVALID");
  await assert.rejects(extractPdfText(Buffer.from("%PDF-1.7\ninvalid"), neverOcr), error => error.code === "PDF_PARSE");
  await assert.rejects(extractPdfText(await scannedPdf([image, image, image, image]), neverOcr), error => error.code === "PDF_PAGES");
  await assert.rejects(extractPdfText(await scannedPdf([image], [100_000, 100_000]), neverOcr), error => error.code === "PDF_PAGE_SIZE");
  await assert.rejects(extractPdfText(await scannedPdf([image]), neverOcr, { timeoutMs: 0 }), error => error.code === "PDF_TIMEOUT");
});
