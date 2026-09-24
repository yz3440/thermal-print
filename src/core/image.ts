/**
 * Getting pictures ready for thermal paper: decode, rotate, scale, adjust tones and place them on the
 * paper width. The printer only makes black dots; the encoder's dithering does the last step.
 */
import { PNG } from "pngjs";
import type { Align, ImageBlock } from "./document";

/** Pixels as RGBA bytes, row by row. */
export interface RasterImage {
  width: number;
  height: number;
  data: Uint8ClampedArray;
}

export function blankImage(width: number, height: number, gray = 255): RasterImage {
  const data = new Uint8ClampedArray(width * height * 4).fill(gray);
  for (let i = 3; i < data.length; i += 4) data[i] = 255;
  return { width, height, data };
}

export function decodePng(bytes: Uint8Array): RasterImage {
  const png = PNG.sync.read(Buffer.from(bytes));
  return { width: png.width, height: png.height, data: new Uint8ClampedArray(png.data) };
}

export function encodePng(image: RasterImage): Buffer {
  const png = new PNG({ width: image.width, height: image.height });
  png.data = Buffer.from(image.data);
  return PNG.sync.write(png);
}

export function rotate(image: RasterImage, degrees: 90 | 180 | 270): RasterImage {
  const { width, height, data } = image;
  const turned = degrees !== 180;
  const out = new Uint8ClampedArray(data.length);
  const outWidth = turned ? height : width;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const [nx, ny] =
        degrees === 90 ? [height - 1 - y, x] : degrees === 180 ? [width - 1 - x, height - 1 - y] : [y, width - 1 - x];
      const from = (y * width + x) * 4;
      const to = (ny * outWidth + nx) * 4;
      out[to] = data[from];
      out[to + 1] = data[from + 1];
      out[to + 2] = data[from + 2];
      out[to + 3] = data[from + 3];
    }
  }
  return { width: outWidth, height: turned ? width : height, data: out };
}

/** Scales to an exact size: each output pixel averages the source area it covers. */
export function resize(image: RasterImage, width: number, height: number): RasterImage {
  if (width === image.width && height === image.height) return image;
  const out = new Uint8ClampedArray(width * height * 4);
  const sx = image.width / width;
  const sy = image.height / height;
  for (let y = 0; y < height; y++) {
    const top = y * sy;
    const bottom = Math.max(top + 1e-6, Math.min(image.height, (y + 1) * sy));
    for (let x = 0; x < width; x++) {
      const left = x * sx;
      const right = Math.max(left + 1e-6, Math.min(image.width, (x + 1) * sx));
      const sum = [0, 0, 0, 0];
      let total = 0;
      for (let py = Math.floor(top); py < Math.ceil(bottom); py++) {
        const wy = Math.min(bottom, py + 1) - Math.max(top, py);
        for (let px = Math.floor(left); px < Math.ceil(right); px++) {
          const weight = wy * (Math.min(right, px + 1) - Math.max(left, px));
          const at = (py * image.width + px) * 4;
          for (let c = 0; c < 4; c++) sum[c] += image.data[at + c] * weight;
          total += weight;
        }
      }
      const at = (y * width + x) * 4;
      for (let c = 0; c < 4; c++) out[at + c] = sum[c] / total;
    }
  }
  return { width, height, data: out };
}

export interface ToneOptions {
  brightness?: number;
  contrast?: number;
  gamma?: number;
  invert?: boolean;
}

/** Grayscale on white paper (transparency becomes white), with tone adjustments. */
export function tone(image: RasterImage, options: ToneOptions = {}): RasterImage {
  const { brightness = 0, contrast = 0, gamma = 1, invert = false } = options;
  const factor = (1 + contrast) / (1 - Math.min(contrast, 0.99));
  const out = new Uint8ClampedArray(image.data.length);
  for (let i = 0; i < image.data.length; i += 4) {
    const alpha = image.data[i + 3] / 255;
    const luma = 0.2126 * image.data[i] + 0.7152 * image.data[i + 1] + 0.0722 * image.data[i + 2];
    let value = (luma * alpha + 255 * (1 - alpha)) / 255;
    value = Math.pow(Math.min(1, Math.max(0, value)), 1 / gamma);
    value = (value - 0.5) * factor + 0.5 + brightness;
    if (invert) value = 1 - value;
    const gray = Math.round(Math.min(1, Math.max(0, value)) * 255);
    out[i] = out[i + 1] = out[i + 2] = gray;
    out[i + 3] = 255;
  }
  return { width: image.width, height: image.height, data: out };
}

/** Puts an image on white paper `width` dots wide. */
export function place(image: RasterImage, width: number, align: Align = "left"): RasterImage {
  if (image.width >= width) return image;
  const out = blankImage(width, image.height);
  const left = align === "center" ? Math.floor((width - image.width) / 2) : align === "right" ? width - image.width : 0;
  for (let y = 0; y < image.height; y++) {
    const from = y * image.width * 4;
    out.data.set(image.data.subarray(from, from + image.width * 4), (y * width + left) * 4);
  }
  return out;
}

/** The size an image prints at: whole bytes of dots wide, within the paper and `maxHeight`. */
export function printSize(
  source: { width: number; height: number },
  block: Pick<ImageBlock, "width" | "maxHeight">,
  paperWidth: number,
): { width: number; height: number } {
  const wanted =
    block.width === "original"
      ? source.width
      : block.width === "half"
        ? paperWidth / 2
        : typeof block.width === "number"
          ? block.width
          : paperWidth;
  let width = Math.max(8, Math.min(paperWidth, wanted));
  let height = Math.max(1, Math.round((source.height * width) / source.width));
  if (block.maxHeight && height > block.maxHeight) {
    width = Math.max(8, Math.round((source.width * block.maxHeight) / source.height));
    height = block.maxHeight;
  }
  width = Math.max(8, Math.floor(width / 8) * 8);
  height = Math.max(1, Math.round((source.height * width) / source.width));
  return { width, height: block.maxHeight ? Math.min(height, block.maxHeight) : height };
}

/** Everything short of dithering: rotation, size, tones and placement on the paper. */
export function prepareImage(block: ImageBlock & { raster: RasterImage }, paperWidth: number): RasterImage {
  let image = block.raster;
  const turn = block.rotate === "landscape" ? (image.width > image.height ? 90 : 0) : (block.rotate ?? 0);
  if (turn) image = rotate(image, turn);
  const size = printSize(image, block, paperWidth);
  image = resize(image, size.width, size.height);
  image = tone(image, block);
  return place(image, paperWidth, block.align ?? "center");
}
