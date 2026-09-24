import assert from "node:assert/strict";
import { test } from "node:test";
import {
  blankImage,
  decodePng,
  encodePng,
  place,
  prepareImage,
  printSize,
  resize,
  rotate,
  tone,
  type RasterImage,
} from "../../src/core/image";

/** A tiny image from rows of gray values. */
function gray(rows: number[][]): RasterImage {
  const height = rows.length;
  const width = rows[0].length;
  const data = new Uint8ClampedArray(width * height * 4);
  rows.flat().forEach((value, i) => data.set([value, value, value, 255], i * 4));
  return { width, height, data };
}

const values = (image: RasterImage) => {
  const out: number[][] = [];
  for (let y = 0; y < image.height; y++) {
    out.push([]);
    for (let x = 0; x < image.width; x++) out[y].push(image.data[(y * image.width + x) * 4]);
  }
  return out;
};

test("PNG round trip", () => {
  const image = gray([
    [0, 128],
    [255, 64],
  ]);
  assert.deepEqual(values(decodePng(encodePng(image))), values(image));
});

test("rotate turns clockwise", () => {
  const image = gray([[10, 20, 30]]);
  assert.deepEqual(values(rotate(image, 90)), [[10], [20], [30]]);
  assert.deepEqual(values(rotate(image, 180)), [[30, 20, 10]]);
  assert.deepEqual(values(rotate(image, 270)), [[30], [20], [10]]);
  const square = gray([
    [1, 2],
    [3, 4],
  ]);
  assert.deepEqual(values(rotate(square, 90)), [
    [3, 1],
    [4, 2],
  ]);
});

test("resize averages the area each pixel covers", () => {
  const image = gray([
    [0, 0, 200, 200],
    [0, 0, 200, 200],
    [100, 100, 50, 50],
    [100, 100, 50, 50],
  ]);
  assert.deepEqual(values(resize(image, 2, 2)), [
    [0, 200],
    [100, 50],
  ]);
  assert.deepEqual(values(resize(image, 1, 1)), [[88]]);
  assert.deepEqual(values(resize(gray([[40]]), 2, 2)), [
    [40, 40],
    [40, 40],
  ]);
});

test("tone: transparency is paper, and the adjustments move the gray", () => {
  const clear = { width: 1, height: 1, data: new Uint8ClampedArray([0, 0, 0, 0]) };
  assert.deepEqual(values(tone(clear)), [[255]]);
  assert.deepEqual(values(tone(gray([[0, 255]]), { invert: true })), [[255, 0]]);
  assert.ok(values(tone(gray([[128]]), { gamma: 1.6 }))[0][0] > 160, "gamma lightens mid-tones");
  assert.ok(values(tone(gray([[100]]), { brightness: 0.2 }))[0][0] > 140);
  const [[dark, light]] = values(tone(gray([[96, 160]]), { contrast: 0.5 }));
  assert.ok(dark < 96 && light > 160, "contrast spreads the tones");
});

test("place pads with white paper", () => {
  assert.deepEqual(values(place(gray([[0, 0]]), 6, "center")), [[255, 255, 0, 0, 255, 255]]);
  assert.deepEqual(values(place(gray([[0]]), 3, "right")), [[255, 255, 0]]);
});

test("printSize fits the paper in whole bytes", () => {
  assert.deepEqual(printSize({ width: 1000, height: 500 }, {}, 504), { width: 504, height: 252 });
  assert.deepEqual(printSize({ width: 100, height: 50 }, { width: "original" }, 504), { width: 96, height: 48 });
  assert.deepEqual(printSize({ width: 100, height: 100 }, { width: 250 }, 504), { width: 248, height: 248 });
  assert.deepEqual(printSize({ width: 400, height: 2000 }, { maxHeight: 1000 }, 504), { width: 200, height: 1000 });
});

test("prepareImage turns wide images sideways when asked and fills the paper width", () => {
  const wide = blankImage(300, 100, 0);
  const upright = prepareImage({ type: "image", raster: wide }, 504);
  assert.equal(upright.width, 504);
  assert.equal(upright.height, 168);
  const sideways = prepareImage({ type: "image", raster: wide, rotate: "landscape" }, 504);
  assert.equal(sideways.width, 504);
  assert.equal(sideways.height, 1512);
  const small = prepareImage({ type: "image", raster: blankImage(50, 50, 0), width: "original" }, 504);
  assert.equal(small.width, 504, "padded to the paper");
  assert.equal(small.data[(20 * 504 + 10) * 4], 255, "white margin on the left");
  assert.equal(small.data[(20 * 504 + 252) * 4], 0, "image in the middle");
});
