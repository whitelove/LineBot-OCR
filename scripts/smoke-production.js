import { spawn } from "node:child_process";
import { randomBytes, createHmac } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import assert from "node:assert/strict";
import { createServer } from "node:net";

// Reserve an available port without interrupting another local server.
const probe = createServer();
await new Promise((resolve, reject) => {
  probe.once("error", reject);
  probe.listen(0, resolve);
});
const port = probe.address().port;
await new Promise((resolve, reject) => probe.close(error => error ? reject(error) : resolve()));
const secret = randomBytes(24).toString("hex");
const child = spawn(
  process.execPath,
  ["node_modules/next/dist/bin/next", "start", "--port", String(port)],
  {
    env: {
      ...process.env,
      NODE_ENV: "production",
      LINE_CHANNEL_SECRET: secret,
      LINE_CHANNEL_ID: "",
    },
    stdio: ["ignore", "pipe", "pipe"],
  },
);
let logs = "";
child.stdout.on("data", (b) => {
  logs += b;
});
child.stderr.on("data", (b) => {
  logs += b;
});
const base = `http://localhost:${port}`;
try {
  let ready = false;
  for (let i = 0; i < 600; i++) {
    if (child.exitCode !== null)
      throw new Error(
        `Server exited (${child.exitCode}): ${logs.slice(-3000)}`,
      );
    try {
      const response = await fetch(`${base}/api/webhook`, {
        signal: AbortSignal.timeout(500),
      });
      if (response.status === 405) {
        ready = true;
        break;
      }
    } catch {}
    await new Promise((r) => setTimeout(r, 100));
  }
  assert.ok(ready, "production server starts");
  assert.equal((await fetch(base)).status, 404, "web page removed");
  assert.equal(
    (await fetch(`${base}/api/ocr`, { method: "POST", body: "image" })).status,
    404,
    "demo OCR API removed",
  );
  const start = performance.now();
  const raw = JSON.stringify({ events: [] }),
    signature = createHmac("sha256", secret).update(raw).digest("base64");
  assert.equal(
    (
      await fetch(`${base}/api/webhook`, {
        method: "POST",
        body: raw,
        headers: { "x-line-signature": signature },
      })
    ).status,
    200,
  );
  assert.equal(
    (
      await fetch(`${base}/api/webhook`, {
        method: "POST",
        body: raw,
        headers: { "x-line-signature": "bad" },
      })
    ).status,
    401,
  );
  const evidence = {
    runtime: "next-start",
    node: process.version,
    platform: process.platform,
    webhookChecksMs: Math.round(performance.now() - start),
  };
  await mkdir("test-results", { recursive: true });
  await writeFile(
    "test-results/production.json",
    JSON.stringify(evidence, null, 2),
  );
  console.log(
    `PASS ${evidence.runtime}: web page and demo API removed, signed verification, invalid signature. Webhook checks: ${evidence.webhookChecksMs} ms`,
  );
} finally {
  child.kill("SIGTERM");
  await new Promise((resolve) => {
    if (child.exitCode !== null) return resolve();
    child.once("exit", resolve);
  });
}
