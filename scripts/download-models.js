import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile, rename, rm } from "node:fs/promises";
import path from "node:path";

const REVISION = "39fa41bdd49f067ba41b1d9de79c06ab506d67d4";
const FILES = {
  "det.onnx":
    "193bab7a04fca699a6c82e6abb5b81bdb28177f0abd4062552b04908dafb19f8",
  "rec.onnx":
    "82ec89533346faadcb30df96703dad2dd7521de65709e60d83fd9745b8968124",
  "rec_dict.txt":
    "259ef2636cec0eeae225ae9fd9a63fa9305285650c22d7ec34fe8a82b24c2f1a",
  "config.json":
    "11599c0dae206381cb8ea11c1b7ce130b2e7971c19219f409785ee8c02ab5d94",
  "det.yml": "3ac018be6f97499a08faa3bbdeb33640968d9307f6736d152902747a9f259593",
  NOTICE: "4c0e4f27877836de51e29aec3918b6c743c3028cd4163b6661fd540336db32b3",
};
const hash = (b) => createHash("sha256").update(b).digest("hex");
const dir = path.join(process.cwd(), "models");
await mkdir(dir, { recursive: true });
for (const [name, expected] of Object.entries(FILES)) {
  const target = path.join(dir, name);
  try {
    if (hash(await readFile(target)) === expected) {
      console.log(`Verified ${name}`);
      continue;
    }
  } catch {}
  const response = await fetch(
    `https://huggingface.co/iapp/OpenThai2.0-OCR-Text/resolve/${REVISION}/${name}`,
    { signal: AbortSignal.timeout(120_000) },
  );
  if (!response.ok)
    throw new Error(`Download ${name}: HTTP ${response.status}`);
  const bytes = Buffer.from(await response.arrayBuffer());
  if (hash(bytes) !== expected) throw new Error(`Checksum mismatch: ${name}`);
  const tmp = `${target}.${process.pid}.tmp`;
  try {
    await writeFile(tmp, bytes);
    await rename(tmp, target);
  } finally {
    await rm(tmp, { force: true });
  }
  console.log(`Downloaded ${name}: ${bytes.length} bytes`);
}
