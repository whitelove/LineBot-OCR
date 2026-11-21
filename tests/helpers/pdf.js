import sharp from "sharp";
import { deflateSync } from "node:zlib";

// A real scanned PDF, built from RGB fixture pixels without a text layer or fonts.
export async function scannedPdf(images, pageSize) {
  const objects = ["<< /Type /Catalog /Pages 2 0 R >>", ""];
  const kids = [];
  for (const image of images) {
    const { data, info } = await sharp(image).flatten({ background: "white" })
      .removeAlpha().toColourspace("srgb").raw().toBuffer({ resolveWithObject: true });
    const id = objects.length + 1;
    kids.push(`${id} 0 R`);
    const [width, height] = pageSize ?? [info.width, info.height];
    objects.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${width} ${height}] /Resources << /XObject << /Img ${id + 2} 0 R >> >> /Contents ${id + 1} 0 R >>`);
    const content = `q ${width} 0 0 ${height} 0 0 cm /Img Do Q`;
    objects.push(`<< /Length ${Buffer.byteLength(content)} >>\nstream\n${content}\nendstream`);
    const compressed = deflateSync(data);
    objects.push(Buffer.concat([
      Buffer.from(`<< /Type /XObject /Subtype /Image /Width ${info.width} /Height ${info.height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /FlateDecode /Length ${compressed.length} >>\nstream\n`),
      compressed, Buffer.from("\nendstream"),
    ]));
  }
  objects[1] = `<< /Type /Pages /Kids [${kids.join(" ")}] /Count ${kids.length} >>`;
  const parts = [Buffer.from("%PDF-1.7\n")], offsets = [0];
  let size = parts[0].length;
  objects.forEach((object, i) => {
    offsets.push(size);
    const part = Buffer.concat([Buffer.from(`${i + 1} 0 obj\n`), Buffer.from(object), Buffer.from("\nendobj\n")]);
    parts.push(part);
    size += part.length;
  });
  parts.push(Buffer.from(`xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.slice(1).map(offset => `${String(offset).padStart(10, "0")} 00000 n \n`).join("")}trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${size}\n%%EOF`));
  return Buffer.concat(parts);
}
