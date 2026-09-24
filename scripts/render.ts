/**
 * Renders every fixture to .previews/<name>.png (plus a contact sheet) without printing.
 * Usage: npm run render [-- name-filter]
 */
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { Bitmap } from "@point-of-sale/receipt-printer-renderer";
import { encodeReceipt } from "../src/core/layout";
import { bitmapToPng, renderPreview, renderSlip } from "../src/core/preview";
import { BASE, FIXTURES } from "../tests/fixtures";

const outDir = path.resolve(import.meta.dirname, "../.previews");
mkdirSync(outDir, { recursive: true });
const filter = process.argv[2];

const sheets: Bitmap[] = [];
for (const fixture of FIXTURES.filter((f) => !filter || f.name.includes(filter))) {
  const options = { ...BASE, ...fixture.options };
  const { bytes, unsupported } = encodeReceipt(fixture.receipt, options);
  const preview = renderPreview(bytes, options.spec);
  writeFileSync(path.join(outDir, `${fixture.name}.png`), preview.png);
  sheets.push(renderSlip(bytes, options.spec).bitmap);
  const note = unsupported.length ? `  unsupported: ${unsupported.join(" ")}` : "";
  console.log(`${fixture.name.padEnd(20)} ${String(bytes.length).padStart(5)} bytes  ${preview.lengthMm} mm${note}`);
}

// Contact sheet: fixtures side by side, four per row, 24 dots apart.
const GAP = 24;
const PER_ROW = 4;
const cellWidth = Math.max(...sheets.map((b) => b.width)) + GAP;
const rows: Bitmap[][] = [];
for (let i = 0; i < sheets.length; i += PER_ROW) rows.push(sheets.slice(i, i + PER_ROW));
const rowHeights = rows.map((row) => Math.max(...row.map((b) => b.height)) + GAP);
const width = Math.ceil((cellWidth * Math.min(PER_ROW, sheets.length)) / 8) * 8;
const height = rowHeights.reduce((a, b) => a + b, 0);
const stride = width / 8;
const data = new Uint8Array(stride * height);
let top = 0;
rows.forEach((row, r) => {
  row.forEach((bitmap, c) => {
    const left = c * cellWidth;
    const srcStride = Math.ceil(bitmap.width / 8);
    for (let y = 0; y < bitmap.height; y++) {
      for (let x = 0; x < bitmap.width; x++) {
        if ((bitmap.data[y * srcStride + (x >> 3)] >> (7 - (x & 7))) & 1) {
          const dx = left + x;
          data[(top + y) * stride + (dx >> 3)] |= 0x80 >> (dx & 7);
        }
      }
    }
  });
  top += rowHeights[r];
});
writeFileSync(path.join(outDir, "contact-sheet.png"), bitmapToPng({ width, height, data }));
console.log(`→ ${outDir}`);
