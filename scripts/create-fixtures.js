import sharp from "sharp";
import { mkdir, writeFile } from "node:fs/promises";
const fixtures = [
  ["thai", ["สวัสดีครับ ภาษาไทย", "ทดสอบอ่านข้อความจากภาพ"]],
  ["english", ["Hello LINE OCR 123", "Free text recognition"]],
  ["multiline", ["สวัสดีประเทศไทย", "Hello from LINE OCR", "อ่านข้อความหลายบรรทัด"]],
];
await mkdir("tests/fixtures", { recursive: true });
for (const [name, lines] of fixtures) {
  // Fixture renderer only. Generated PNGs are committed so test hosts need no fonts.
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1100" height="${lines.length * 100 + 80}"><rect width="100%" height="100%" fill="white"/>${lines.map((line, i) => `<text x="55" y="${95 + i * 100}" font-family="Thonburi, Noto Sans Thai, sans-serif" font-size="48">${line}</text>`).join("")}</svg>`;
  const png = await sharp(Buffer.from(svg)).png().toBuffer();
  await writeFile(`tests/fixtures/${name}.png`, png);
  await writeFile(`tests/fixtures/${name}.txt`, lines.join("\n") + "\n");
}
