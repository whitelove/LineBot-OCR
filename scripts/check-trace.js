import { readFile, stat } from "node:fs/promises";
import path from "node:path";
for (const route of ["webhook"]) {
  const file = path.resolve(`.next/server/app/api/${route}/route.js.nft.json`),
    trace = JSON.parse(await readFile(file, "utf8"));
  const paths = trace.files.map((f) => path.resolve(path.dirname(file), f));
  for (const required of [
    "models/det.onnx",
    "models/rec.onnx",
    "models/rec_dict.txt",
    "models/config.json",
    "node_modules/pdfjs-dist/legacy/build/pdf.worker.mjs",
    "node_modules/pdfjs-dist/standard_fonts/LiberationSans-Regular.ttf",
  ])
    if (!paths.includes(path.resolve(required)))
      throw new Error(`Missing runtime file: ${required}`);
  if (!paths.some((p) => p.includes("pdfjs-dist/wasm/") && p.endsWith(".wasm")))
    throw new Error("PDF decoder WASM files not traced");
  if (process.platform === "linux" && process.arch === "x64" &&
      !paths.some((p) => p.includes("@napi-rs/canvas-linux-x64-gnu/") && p.endsWith(".node")))
    throw new Error("Linux PDF canvas native library not traced");
  const linux = paths.filter((p) =>
    p.includes("onnxruntime-node/bin/napi-v6/linux/x64/"),
  );
  if (
    !linux.some((p) => p.endsWith("onnxruntime_binding.node")) ||
    !linux.some((p) => p.endsWith("libonnxruntime.so.1"))
  )
    throw new Error("Linux ONNX libraries not traced");
  const sizes = await Promise.all(
    paths.map(async (p) => {
      try {
        return (await stat(p)).size;
      } catch {
        return 0;
      }
    }),
  );
  const bytes = sizes.reduce((a, b) => a + b, 0);
  console.log(
    `${route}: traced ${(bytes / 1024 / 1024).toFixed(1)} MiB, models + Linux x64 ONNX + PDF assets verified${process.platform === "linux" ? " (Linux canvas checked)" : " (Linux canvas checked on Linux builds)"}`,
  );
  if (bytes > 250 * 1024 * 1024)
    throw new Error("Trace exceeds conservative 250 MiB function budget");
}
