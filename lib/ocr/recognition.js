import * as ort from "onnxruntime-node";
import { resize, flattenGray } from "./preprocess.js";
export function ctcDecode(data, frames, classes, dictionary) {
  if (classes !== dictionary.length)
    throw new Error("Model/dictionary class count mismatch");
  let prev = -1,
    text = "",
    confidence = 0,
    count = 0;
  for (let t = 0; t < frames; t++) {
    let id = 0,
      score = -Infinity;
    for (let c = 0; c < classes; c++)
      if (data[t * classes + c] > score) {
        id = c;
        score = data[t * classes + c];
      }
    if (id && id !== prev) {
      text += dictionary[id];
      confidence += score;
      count++;
    }
    prev = id;
  }
  return { text, confidence: count ? confidence / count : 0 };
}
export async function recognize(crops, session, dictionary, checkBudget) {
  const prepared = [];
  for (const crop of crops) {
    checkBudget();
    const width = Math.min(
      3200,
      Math.max(1, Math.ceil((48 * crop.width) / crop.height)),
    );
    const image = await resize(crop, width, 48);
    prepared.push({ gray: flattenGray(image), width });
  }
  const order = prepared
      .map((_, i) => i)
      .sort((a, b) => prepared[a].width - prepared[b].width),
    result = new Array(crops.length);
  // Four lines per batch keeps native activation memory bounded on serverless.
  for (let offset = 0; offset < order.length; offset += 4) {
    checkBudget();
    const idx = order.slice(offset, offset + 4),
      width = Math.max(16, ...idx.map((i) => prepared[i].width));
    const input = new Float32Array(idx.length * 3 * 48 * width);
    for (let n = 0; n < idx.length; n++) {
      const item = prepared[idx[n]];
      for (let y = 0; y < 48; y++)
        for (let x = 0; x < item.width; x++) {
          const v = item.gray[y * item.width + x] / 127.5 - 1;
          for (let c = 0; c < 3; c++)
            input[((n * 3 + c) * 48 + y) * width + x] = v;
        }
    }
    const outputs = await session.run({
      [session.inputNames[0]]: new ort.Tensor("float32", input, [
        idx.length,
        3,
        48,
        width,
      ]),
    });
    const out = outputs[session.outputNames[0]],
      [, frames, classes] = out.dims;
    for (let n = 0; n < idx.length; n++)
      result[idx[n]] = ctcDecode(
        out.data.subarray(n * frames * classes, (n + 1) * frames * classes),
        frames,
        classes,
        dictionary,
      );
  }
  checkBudget();
  return result;
}
