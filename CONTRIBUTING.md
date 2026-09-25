# Contributing

## Development

```sh
npm install
npm run dev                                  # load the extension in Raycast
npm test                                     # unit and golden tests (node:test via tsx)
npm run render                               # every sample receipt as a PNG in .previews/
npm run fake-printer                         # a pretend printer on 127.0.0.1:9100 that saves jobs as PNGs
npm run print-sample -- 192.168.1.3          # a sample to-do list on real paper
npm run print-image -- 192.168.1.3 photo.jpg # an image on real paper (--look, --caption, --qr)
npm run counters -- 192.168.1.3              # read the cut counter to confirm prints (Epson)
npm run gen-models                           # refresh the printer models after upgrading the encoder
npm run check                                # typecheck, lint, build and test, as CI would
```

## Layout

- `src/core` has no Raycast imports and is tested in plain Node. ESLint enforces this.
- `src/platform/macos.ts` uses macOS's own `sips` and `osascript` for images and the clipboard.
- `src/ui` holds the Raycast-dependent pieces shared by commands and tools: settings, storage, printing, previews.
- The Raycast commands are `src/*.tsx` and `src/*.ts`; the AI tools are `src/tools/*.ts`.

## The document model

Every receipt is a list of blocks, and one renderer (`src/core/render.ts`) turns any list into printer bytes. The checklist, memo, ticket and plain styles are templates that build blocks (`src/core/layout.ts`).

| Block                  | What it prints                                                                                                                   |
| ---------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| `text`                 | Text with bold, underline, white-on-black, font B, sizes 1–8 and alignment                                                       |
| `markdown`             | Headings, **bold**, **underline**, ==highlight==, lists and tables                                                               |
| `list`                 | Checkboxes, bullets or numbers, with an optional right-aligned column                                                            |
| `table`                | Columns with widths, alignment and a bold header row                                                                             |
| `bar`, `rule`, `space` | The white-on-black header bar, single or double rules, gaps in dots                                                              |
| `image`                | Any picture: scaled, rotated, toned (brightness, contrast, gamma), then dithered (Atkinson, Floyd–Steinberg, Bayer or threshold) |
| `qr`, `barcode`        | Printer-drawn QR codes and barcodes (Code 128, EAN-13, UPC-A and more)                                                           |
| `cut`, `raw`           | Several slips in one job, and raw ESC/POS for anything else                                                                      |

```ts
const blocks: Block[] = [
  { type: "bar", left: "ORDER 42", right: "18:52" },
  { type: "image", src: "~/Pictures/logo.png", width: "half", dither: "threshold" },
  { type: "table", columns: [{}, { width: 8, align: "right" }], rows: [["Coffee", "3.50"]] },
  { type: "qr", value: "https://example.com/receipt/42" },
];
const { blocks: ready } = await resolveImages(blocks, loadImage); // macOS: src/platform/macos.ts
const { bytes } = renderDocument(ready, { spec: specFor("epson-tm-t88v"), cut: "partial" });
```

## Transport

Jobs go over raw TCP to port 9100. Before printing, ESC/POS printers are asked for their real-time status (DLE EOT) so a cover-open or paper-out printer is refused rather than left with a half-printed job. A job counts as printed when the printer closes its side of the connection, or, for printers that never do, once every byte has left and a short grace period has passed. A printer that stops taking data is reported as stalled and the job is kept under Pending.

## Store data

Records live in Raycast's LocalStorage, one key per record. `Store.migrate()` upgrades old data; version 3 turned the earlier built-in to-do lists into drafts.
