import assert from "node:assert/strict";
import { test } from "node:test";
import type { Block } from "../../src/core/document";
import { blankImage } from "../../src/core/image";
import { specFor } from "../../src/core/models";
import { renderDocument, resolveImages } from "../../src/core/render";

const options = { spec: specFor("epson-tm-t88v"), cut: "partial" as const, strict: true };
const render = (blocks: Block[]) => Buffer.from(renderDocument(blocks, options).bytes);
const has = (bytes: Buffer, ...sequence: number[]) => bytes.includes(Buffer.from(sequence));
const count = (bytes: Buffer, ...sequence: number[]) => bytes.toString("latin1").split(Buffer.from(sequence).toString("latin1")).length - 1;

test("text styles become printer commands", () => {
  const bytes = render([
    { type: "text", text: "Bold", bold: true },
    { type: "text", text: "Big", width: 2, height: 2 },
    { type: "text", text: "Inverted", invert: true },
    { type: "text", text: "Small", font: "B" },
    { type: "text", text: "Centered", align: "center" },
  ]);
  assert.ok(has(bytes, 0x1b, 0x45, 0x01), "ESC E 1 bold");
  assert.ok(has(bytes, 0x1d, 0x21, 0x11), "GS ! double width and height");
  assert.ok(has(bytes, 0x1d, 0x42, 0x01), "GS B 1 invert");
  assert.ok(has(bytes, 0x1b, 0x4d, 0x01), "ESC M 1 font B");
  // The encoder centres text itself, with spaces, so it looks the same on every printer.
  assert.match(bytes.toString("latin1"), / {17}Centered/);
  for (const word of ["Bold", "Big", "Inverted", "Small"]) assert.ok(bytes.includes(word));
});

test("multi-line text keeps its lines", () => {
  const text = render([{ type: "text", text: "one\ntwo" }]).toString("latin1");
  assert.match(text, /one[\s\S]*\n[\s\S]*two/);
});

test("lists: checkboxes, bullets, numbers and a right-aligned aside column", () => {
  const text = render([
    { type: "list", items: [{ text: "call", aside: "15:00" }, { text: "done", checked: true }] },
    { type: "list", items: [{ text: "apples" }], marker: "bullet" },
    { type: "list", items: [{ text: "first" }, { text: "second" }], marker: "number" },
  ]).toString("latin1");
  assert.match(text, /\[ \] call +15:00/);
  assert.match(text, /\[x\] done/);
  assert.match(text, /- apples/);
  assert.match(text, /2\. second/);
});

test("tables, rules, bars and spacing", () => {
  const bytes = render([
    { type: "bar", left: "LEFT", right: "RIGHT" },
    { type: "space", dots: 300 },
    { type: "table", columns: [{}, { width: 6, align: "right" }], header: ["Item", "Price"], rows: [["Tea", "3.50"]] },
    { type: "rule", style: "double" },
  ]);
  const text = bytes.toString("latin1");
  assert.match(text, / LEFT +RIGHT /);
  assert.match(text, /Tea +3\.50/);
  assert.ok(has(bytes, 0x1b, 0x33, 0xff) && has(bytes, 0x1b, 0x33, 45), "300 dots as lines of 255 + 45");
  assert.ok(!has(bytes, 0x1b, 0x4a), "no print-and-feed, which would break alignment");
});

test("QR codes, barcodes and raw bytes", () => {
  const bytes = render([
    { type: "qr", value: "https://www.raycast.com" },
    { type: "barcode", value: "THERMAL-042", symbology: "code128" },
    { type: "raw", bytes: [0x1b, 0x70, 0x00, 0x19, 0xfa] },
  ]);
  assert.ok(has(bytes, 0x1d, 0x28, 0x6b), "GS ( k: QR code");
  assert.ok(has(bytes, 0x1d, 0x6b), "GS k: barcode");
  assert.ok(has(bytes, 0x1b, 0x70, 0x00, 0x19, 0xfa), "raw bytes pass through");
});

test("images print as bit images", () => {
  const bytes = render([{ type: "image", raster: blankImage(120, 40, 0), width: "original" }]);
  assert.ok(has(bytes, 0x1b, 0x2a) || has(bytes, 0x1d, 0x76, 0x30), "ESC * or GS v 0");
  assert.ok(bytes.length > 504 / 8 * 40, "a full-width row of dots per line");
});

test("cuts: one per slip, and no extra when the document ends with its own", () => {
  const cuts = (blocks: Block[]) => count(render(blocks), 0x1d, 0x56);
  assert.equal(cuts([{ type: "text", text: "a" }]), 1);
  assert.equal(cuts([{ type: "text", text: "a" }, { type: "cut" }, { type: "text", text: "b" }]), 2);
  assert.equal(cuts([{ type: "text", text: "a" }, { type: "cut", mode: "full" }]), 1);
});

test("unsupported characters are replaced in every block", () => {
  const result = renderDocument(
    [
      { type: "bar", left: "你好" },
      { type: "list", items: [{ text: "🎉 party", aside: "✨" }] },
    ],
    options,
  );
  assert.deepEqual(result.unsupported, ["你", "好", "🎉", "✨"]);
  const text = Buffer.from(result.bytes).toString("latin1");
  assert.match(text, / \?\? /);
  assert.match(text, /\? party/);
});

test("resolveImages loads sources, and keeps going when one fails", async () => {
  const blocks: Block[] = [
    { type: "image", src: "/good.png" },
    { type: "image", src: "/missing/photo.jpg" },
    { type: "text", text: "after" },
  ];
  const { blocks: resolved, missing } = await resolveImages(blocks, async (src) => {
    if (src === "/good.png") return blankImage(8, 8);
    throw new Error("nope");
  });
  assert.deepEqual(missing, ["/missing/photo.jpg"]);
  assert.ok(resolved[0].type === "image" && resolved[0].raster);
  assert.ok(resolved[1].type === "image" && !resolved[1].raster && resolved[1].alt === "image not found: photo.jpg");
  const text = render(resolved).toString("latin1");
  assert.match(text, /\[image not found: photo\.jpg\]/);
  assert.match(text, /after/);
});
