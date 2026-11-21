import { test } from "node:test";
import assert from "node:assert/strict";
import { detectorInput } from "../lib/ocr/preprocess.js";
import { ctcDecode } from "../lib/ocr/recognition.js";
import { minimumBox, quadPoint, rotateQuarter } from "../lib/ocr/geometry.js";
import { probabilityBoxes } from "../lib/ocr/detection.js";
test("detector border is added before resizing and tensor pixels match geometry", async () => {
  const input = await detectorInput({
    width: 40,
    height: 20,
    data: Buffer.alloc(40 * 20 * 3, 0),
  });
  assert.equal(input.tensor.length, input.width * input.height * 3);
  for (let c = 0; c < 3; c++) {
    const plane = input.width * input.height * c;
    assert.ok(input.tensor[plane] > 1.5, "top-left border is white");
    assert.ok(
      input.tensor[
        plane + (input.height >> 1) * input.width + (input.width >> 1)
      ] < -1.5,
      "image centre is black",
    );
    assert.ok(
      input.tensor[plane + input.width * input.height - 1] > 1.5,
      "bottom-right border is white",
    );
  }
});
test("DB boxes remain local to their connected text area and unclip outward", () => {
  const prob = new Float32Array(80 * 40);
  for (let y = 10; y <= 20; y++)
    for (let x = 20; x <= 60; x++) prob[y * 80 + x] = 0.9;
  const boxes = probabilityBoxes(prob, 80, 40);
  assert.equal(boxes.length, 1);
  assert.ok(boxes[0][0][0] < 20 && boxes[0][0][1] < 10);
  assert.ok(boxes[0][2][0] > 60 && boxes[0][2][1] > 20);
});
test("CTC removes adjacent repeats and blanks, preserves repeats across a blank", () => {
  const ids = [1, 1, 0, 1, 2, 2, 0, 3],
    p = new Float32Array(ids.length * 4);
  ids.forEach((id, i) => (p[i * 4 + id] = 1));
  assert.deepEqual(ctcDecode(p, ids.length, 4, ["", "ก", "ข", " "]), {
    text: "กกข ",
    confidence: 1,
  });
  assert.throws(() => ctcDecode(p, ids.length, 4, ["", "ก"]), /class count/);
});
test("perspective mapping preserves all quad corners", () => {
  const q = [
    [12, 5],
    [70, 15],
    [65, 45],
    [2, 40],
  ];
  for (const [uv, corner] of [
    [[0, 0], 0],
    [[1, 0], 1],
    [[1, 1], 2],
    [[0, 1], 3],
  ])
    quadPoint(q, ...uv).forEach((v, i) =>
      assert.ok(Math.abs(v - q[corner][i]) < 1e-8),
    );
  assert.ok(minimumBox(q).side > 0);
});
test("quarter rotation is lossless and invertible", () => {
  const im = {
    width: 3,
    height: 2,
    data: Buffer.from(Array.from({ length: 18 }, (_, i) => i)),
  };
  const back = rotateQuarter(rotateQuarter(im, 90), 270);
  assert.deepEqual(back, im);
});
