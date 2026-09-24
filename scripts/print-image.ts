/**
 * Prints images through the same pipeline as the Print Image command (macOS loader, house layout),
 * with a throwaway store. Handy for checking dithering on real paper.
 *
 * Usage: npm run print-image -- <printer address> <image…> [--look photo|smooth|pattern|lineart]
 *        [--caption "text"] [--qr https://…]
 */
import type { Block } from "../src/core/document";
import { pictureBlocks, type ImageLook } from "../src/core/layout";
import { printReceipt } from "../src/core/print";
import { Store } from "../src/core/store";
import { loadImage } from "../src/platform/macos";
import { MemoryKV } from "../tests/harness/memory-kv";

async function main() {
  const args = process.argv.slice(2);
  const option = (name: string) => {
    const at = args.indexOf(`--${name}`);
    return at >= 0 ? args.splice(at, 2)[1] : undefined;
  };
  const look = (option("look") ?? "photo") as ImageLook;
  const caption = option("caption");
  const qr = option("qr");
  const [address, ...files] = args;
  if (!address || files.length === 0) throw new Error("Usage: npm run print-image -- <printer address> <image…>");

  const blocks: Block[] = pictureBlocks(files, { size: "full", look, tone: "normal", sideways: false, caption });
  if (qr) blocks.push({ type: "space", dots: 12 }, { type: "qr", value: qr, size: 5 });

  const result = await printReceipt(
    new Store(new MemoryKV()),
    { address, model: "auto", cut: "partial", dateOrder: "month-first" },
    { receipt: { style: "document", body: files.join(", "), blocks }, source: "image" },
    { loadImage },
  );
  if (!result.ok) throw new Error(`${result.error.message} ${result.error.hint ?? ""}`);
  const missing = result.missingImages.length ? ` (couldn't read ${result.missingImages.join(", ")})` : "";
  console.log(`Printed ${files.length} image(s) on ${result.spec.name} in ${result.ms} ms${missing}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
