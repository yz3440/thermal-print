/**
 * Draws assets/icon.png for Thermal Print: a to-do receipt coming out of a printer whose print line
 * glows with heat, on a graphite tile. Shapes are signed-distance functions, supersampled 4×4.
 *
 * Usage: npx tsx scripts/make-icon.ts [output.png]
 */
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { crc32, deflateSync } from "node:zlib";

const SIZE = 512;
const SAMPLES = 4;

/** r, g, b in 0–255; alpha in 0–1. */
type Color = [number, number, number, number];

const hex = (value: string, alpha = 1): Color => [
  parseInt(value.slice(1, 3), 16),
  parseInt(value.slice(3, 5), 16),
  parseInt(value.slice(5, 7), 16),
  alpha,
];
const withAlpha = (color: Color, alpha: number): Color => [color[0], color[1], color[2], alpha];
const mix = (a: Color, b: Color, t: number): Color => a.map((v, i) => v + (b[i] - v) * t) as Color;
const clamp01 = (value: number) => Math.min(1, Math.max(0, value));
const smoothstep = (from: number, to: number, value: number) => {
  const t = clamp01((value - from) / (to - from));
  return t * t * (3 - 2 * t);
};

/** Paints `top` over `base`. */
function over(base: Color, top: Color): Color {
  const alpha = top[3] + base[3] * (1 - top[3]);
  if (alpha <= 0) return [0, 0, 0, 0];
  const channel = (i: number) => (top[i] * top[3] + base[i] * base[3] * (1 - top[3])) / alpha;
  return [channel(0), channel(1), channel(2), alpha];
}

/** Signed distance to a rounded rectangle; negative inside. */
function roundRect(x: number, y: number, left: number, top: number, right: number, bottom: number, r: number) {
  const qx = Math.abs(x - (left + right) / 2) - ((right - left) / 2 - r);
  const qy = Math.abs(y - (top + bottom) / 2) - ((bottom - top) / 2 - r);
  return Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - r;
}

/** Signed distance to a round-capped line segment of the given half width. */
function segment(x: number, y: number, ax: number, ay: number, bx: number, by: number, halfWidth: number) {
  const dx = bx - ax;
  const dy = by - ay;
  const t = clamp01(((x - ax) * dx + (y - ay) * dy) / (dx * dx + dy * dy));
  return Math.hypot(x - ax - dx * t, y - ay - dy * t) - halfWidth;
}

/** Apple-style squircle (superellipse, n = 5) filling the canvas: 1 on its edge, less inside. */
const tileRadius = (x: number, y: number) => (Math.abs(x / 256 - 1) ** 5 + Math.abs(y / 256 - 1) ** 5) ** 0.2;

// Palette.
const TILE_TOP = hex("#474E59");
const TILE_BOTTOM = hex("#141619");
const BODY_TOP = hex("#6A727E");
const BODY_BOTTOM = hex("#3E444D");
const BODY_RIM = hex("#9AA3AF");
const SLOT = hex("#0E0F12");
const HEAT_EDGE = hex("#FF4F2B");
const HEAT_CORE = hex("#FFC35C");
const PAPER = hex("#FFFFFF");
const WARM = hex("#FFB08A");
const INK = hex("#1E2127");
const DONE = hex("#C3C7CE");
const ACCENT = hex("#FF6130");
const LED = hex("#4ADE80");

// Layout, in pixels of the 512 canvas.
const BODY = { left: 66, top: 82, right: 446, bottom: 222, radius: 44 };
const SLOT_BOX = { left: 106, top: 172, right: 406, bottom: 200, radius: 14 };
const PAPER_BOX = { left: 140, top: 190, right: 372, base: 428 };
const TOOTH = 29;
const TOOTH_DEPTH = 14;

/** The torn bottom edge of the receipt: eight teeth pointing down. */
const paperBottom = (x: number) =>
  PAPER_BOX.base + TOOTH_DEPTH * (1 - Math.abs((((x - PAPER_BOX.left) / TOOTH) % 1) * 2 - 1));

function shade(x: number, y: number): Color {
  const radius = tileRadius(x, y);
  if (radius > 1) return [0, 0, 0, 0];

  // Graphite tile, lighter at the top, with a faint rim so it keeps its shape on dark backgrounds.
  let color = mix(TILE_TOP, TILE_BOTTOM, y / SIZE);
  const fromEdge = (1 - radius) * 256;
  color = over(color, withAlpha(hex("#FFFFFF"), (0.16 - 0.1 * (y / SIZE)) * (1 - smoothstep(0.5, 3, fromEdge))));

  // Printer body with a soft shadow and a light rim along the top.
  const body = roundRect(x, y, BODY.left, BODY.top, BODY.right, BODY.bottom, BODY.radius);
  const bodyShadow = roundRect(x, y - 14, BODY.left, BODY.top, BODY.right, BODY.bottom, BODY.radius);
  color = over(color, withAlpha(hex("#000000"), 0.4 * (1 - smoothstep(-10, 26, bodyShadow))));
  if (body <= 0) {
    let fill = mix(BODY_TOP, BODY_BOTTOM, (y - BODY.top) / (BODY.bottom - BODY.top));
    if (y < BODY.top + BODY.radius && body > -3.5) fill = mix(fill, BODY_RIM, 0.7);
    color = over(color, fill);
    // Status light.
    const led = Math.hypot(x - 398, y - 126) - 7;
    color = over(color, withAlpha(LED, 0.35 * Math.exp(-Math.max(led, 0) / 6)));
    if (led <= 0) color = over(color, LED);
  }

  // The print line: a dark slot with a glowing heater strip, and heat spilling onto the body.
  const slot = roundRect(x, y, SLOT_BOX.left, SLOT_BOX.top, SLOT_BOX.right, SLOT_BOX.bottom, SLOT_BOX.radius);
  if (slot > 0 && body <= 0) color = over(color, withAlpha(HEAT_EDGE, 0.6 * Math.exp(-slot / 11)));
  if (slot <= 0) {
    color = over(color, SLOT);
    const strip = roundRect(x, y, SLOT_BOX.left + 14, 181, SLOT_BOX.right - 14, 189, 4);
    const heat = mix(HEAT_EDGE, HEAT_CORE, 1 - Math.abs(x - 256) / 150);
    color = over(color, withAlpha(heat, 0.9 * Math.exp(-Math.max(strip, 0) / 2.5)));
  }

  // The receipt's shadow on the tile.
  const insidePaperX = x >= PAPER_BOX.left && x <= PAPER_BOX.right;
  const paperShadow = roundRect(
    x - 8,
    y - 14,
    PAPER_BOX.left,
    PAPER_BOX.top + 30,
    PAPER_BOX.right,
    PAPER_BOX.base + TOOTH_DEPTH / 2,
    6,
  );
  if (y > BODY.bottom - 6) color = over(color, withAlpha(hex("#000000"), 0.5 * (1 - smoothstep(-12, 22, paperShadow))));

  // The receipt: white paper, warmed and shaded where it leaves the slot.
  if (insidePaperX && y >= PAPER_BOX.top && y <= paperBottom(x)) {
    const fromTop = y - PAPER_BOX.top;
    let paper = mix(PAPER, WARM, 0.4 * (1 - smoothstep(0, 30, fromTop)));
    paper = mix(paper, hex("#7E858F"), 0.35 * (1 - smoothstep(0, 9, fromTop)));
    color = over(color, paper);

    // Kitchen-ticket header bar.
    if (roundRect(x, y, 162, 220, 350, 246, 5) <= 0) color = over(color, INK);

    // Three to-do rows: one ticked in orange, two open.
    const rows = [268, 314, 360];
    rows.forEach((top, index) => {
      const box = roundRect(x, y, 162, top, 190, top + 28, 6);
      if (box <= 0 && box >= -5.5) color = over(color, index === 0 ? DONE : INK);
      const bar = roundRect(x, y, 204, top + 7, [304, 348, 324][index], top + 21, 7);
      if (bar <= 0) color = over(color, index === 0 ? DONE : INK);
    });
    const tick = Math.min(segment(x, y, 166, 282, 174, 291, 3.6), segment(x, y, 174, 291, 190, 267, 3.6));
    if (tick <= 0) color = over(color, ACCENT);
  }
  return color;
}

function render(): Buffer {
  const raw = Buffer.alloc((SIZE * 4 + 1) * SIZE);
  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      let r = 0;
      let g = 0;
      let b = 0;
      let a = 0;
      for (let sy = 0; sy < SAMPLES; sy++) {
        for (let sx = 0; sx < SAMPLES; sx++) {
          const [cr, cg, cb, ca] = shade(x + (sx + 0.5) / SAMPLES, y + (sy + 0.5) / SAMPLES);
          r += cr * ca;
          g += cg * ca;
          b += cb * ca;
          a += ca;
        }
      }
      const at = y * (SIZE * 4 + 1) + 1 + x * 4;
      raw[at] = a ? Math.round(r / a) : 0;
      raw[at + 1] = a ? Math.round(g / a) : 0;
      raw[at + 2] = a ? Math.round(b / a) : 0;
      raw[at + 3] = Math.round((a / (SAMPLES * SAMPLES)) * 255);
    }
  }
  return raw;
}

function chunk(type: string, data: Buffer) {
  const head = Buffer.alloc(8);
  head.writeUInt32BE(data.length, 0);
  head.write(type, 4, "latin1");
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([head.subarray(4), data])) >>> 0, 0);
  return Buffer.concat([head, data, crc]);
}

function png(raw: Buffer): Buffer {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(SIZE, 0);
  header.writeUInt32BE(SIZE, 4);
  header[8] = 8;
  header[9] = 6;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", header),
    chunk("IDAT", deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

const out = path.resolve(process.argv[2] ?? path.join(import.meta.dirname, "../assets/icon.png"));
mkdirSync(path.dirname(out), { recursive: true });
const file = png(render());
writeFileSync(out, file);
console.log(`Wrote ${out} (${file.length} bytes)`);
