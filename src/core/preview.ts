/** Renders printer bytes to a PNG, dot for dot, so previews show exactly what will print. */
import { ReceiptPrinterRenderer, stitch, type Bitmap } from "@point-of-sale/receipt-printer-renderer";
import { crc32, deflateSync } from "node:zlib";
import type { PaperSpec } from "./models";

export interface Preview {
  png: Buffer;
  /** For markdown: ![](dataUri). */
  dataUri: string;
  widthDots: number;
  heightDots: number;
  /** Paper used, including the feed to the cutter. */
  lengthMm: number;
}

export function renderPreview(bytes: Uint8Array, spec: PaperSpec): Preview {
  const { paper, bitmap } = renderSlip(bytes, spec);
  const png = bitmapToPng(bitmap);
  return {
    png,
    dataUri: `data:image/png;base64,${png.toString("base64")}`,
    widthDots: bitmap.width,
    heightDots: bitmap.height,
    lengthMm: Math.round((paper.height / spec.dpi) * 25.4),
  };
}

/** The slip as it leaves the printer (`paper`), and the same with the top margin shortened for display. */
export function renderSlip(bytes: Uint8Array, spec: PaperSpec): { paper: Bitmap; bitmap: Bitmap } {
  const renderer = new ReceiptPrinterRenderer({
    language: spec.language,
    width: spec.widthDots,
    codepageMapping: spec.codepageMapping,
    commands: ["cut"],
    // The paper between print head and cutter becomes the top margin of the next slip.
    cutterDistance: spec.cutFeed * 30,
  });
  const items = renderer.render(bytes);
  const lastCut = items.findLastIndex((item) => item.type === "cut");
  const slip = lastCut >= 0 ? items.slice(0, lastCut + 1) : items;
  const paper = stitch(slip, { cutMarker: true, width: spec.widthDots });
  return { paper, bitmap: trimTop(paper, 16) };
}

/** Shortens the blank top margin to `keep` rows; the preview doesn't need the full head-to-cutter gap. */
function trimTop(bitmap: Bitmap, keep: number): Bitmap {
  const stride = Math.ceil(bitmap.width / 8);
  let blank = 0;
  while (blank < bitmap.height && bitmap.data.subarray(blank * stride, (blank + 1) * stride).every((b) => b === 0)) {
    blank++;
  }
  const drop = Math.max(0, Math.min(blank, bitmap.height) - keep);
  if (drop === 0) return bitmap;
  return { width: bitmap.width, height: bitmap.height - drop, data: bitmap.data.subarray(drop * stride) };
}

const MARGIN = 8;
const INK = 0x14;
const PAPER = 0xff;
const EDGE = 0xc8;

/** Paper on a transparent margin with a light edge, so it reads as a slip in light and dark mode. */
export function bitmapToPng(bitmap: Bitmap): Buffer {
  const width = bitmap.width + MARGIN * 2;
  const height = Math.max(1, bitmap.height) + MARGIN * 2;
  const stride = Math.ceil(bitmap.width / 8);
  const rowBytes = width * 2 + 1;
  const raw = Buffer.alloc(rowBytes * height);
  for (let y = 0; y < height; y++) {
    const by = y - MARGIN;
    for (let x = 0; x < width; x++) {
      const bx = x - MARGIN;
      const at = y * rowBytes + 1 + x * 2;
      const inside = bx >= 0 && by >= 0 && bx < bitmap.width && by < bitmap.height;
      const onEdge = bx >= -1 && by >= -1 && bx <= bitmap.width && by <= bitmap.height && !inside;
      if (inside) {
        const ink = (bitmap.data[by * stride + (bx >> 3)] >> (7 - (bx & 7))) & 1;
        raw[at] = ink ? INK : PAPER;
        raw[at + 1] = 0xff;
      } else if (onEdge) {
        raw[at] = EDGE;
        raw[at + 1] = 0xff;
      }
    }
  }
  return encodePng(width, height, raw);
}

function chunk(type: string, data: Buffer): Buffer {
  const head = Buffer.alloc(8);
  head.writeUInt32BE(data.length, 0);
  head.write(type, 4, "latin1");
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([head.subarray(4), data])) >>> 0, 0);
  return Buffer.concat([head, data, crc]);
}

/** 8-bit grayscale with alpha; `raw` holds filter byte 0 plus pixels for every row. */
function encodePng(width: number, height: number, raw: Buffer): Buffer {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8;
  header[9] = 4;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", header),
    chunk("IDAT", deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}
