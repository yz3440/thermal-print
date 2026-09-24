# Thermal Print

Build to-do lists from the Raycast search bar, with due dates in plain English, and print the whole list on a network receipt printer. Tasks are grouped by day, and the list prints as one receipt with one cut.

```
 TO-DO                  WED 23 SEP  18:52     white on black
OVERDUE
[ ] Send the invoice to Acme          Mon 21
TODAY · WED 23
[ ] Review the pull request            20:30
TOMORROW · THU 24
[ ] Go to the gym                      07:00
[ ] Call the dentist                   15:00
LATER
[ ] Pay rent                          Sep 30
NO DATE
[ ] Buy oat milk
──────────────────────────────────────────
6 TASKS · 1 OVERDUE
```

## Setup

1. Connect an ESC/POS receipt printer to your network, for example an Epson TM-T88V, and note its IP address. Most printers print it on a self-test page if you hold the feed button while switching them on.
2. Open **Printer Status** in Raycast and enter the address (for example `192.168.1.3`, or `192.168.1.3:9100` for another port).
3. Leave **Printer Model** on Auto-detect for Epson printers. For other brands, pick the matching model, or a generic 58 mm / 80 mm one.
4. On macOS 15 and later, the first connection may ask for Local Network access. Allow Raycast under System Settings → Privacy & Security → Local Network.

## Commands

| Command | What it does |
|---|---|
| **To-Do List** | Type a task and press ↵; the search bar clears for the next one. Due dates are read out of the text as you type. ⌘↵ prints the whole list. ⌘D marks a task done, ⌘T sets a date, ⌘Y previews the receipt. |
| **Add To-Do** | Adds one task without opening anything: `call dentist tomorrow 3pm`. |
| **Print To-Do List** | Prints the list straight away, handy on a hotkey. Takes an optional list name. |
| **Compose Receipt** | Write a longer note or a list, preview it, print it, or add every line to a to-do list (⌘L). A line like `![caption](~/Pictures/photo.jpg)` prints the picture. |
| **Print Image** | Photos, screenshots, logos: any image macOS can open (PNG, JPEG, HEIC, GIF, TIFF, WebP, the first page of a PDF). Starts with the images selected in Finder or the one on the clipboard. Choose the size, the look (photo, smooth, halftone, line art) and the brightness, and preview before printing. |
| **Print Selection or Clipboard** | Prints what you've selected or copied: text (checklists with dates print grouped by day), images selected in Finder, a copied image file, or a screenshot on the clipboard. |
| **Receipt Library** | Your lists, saved drafts, jobs that couldn't print (Pending) and print history. |
| **Printer Status** | Connection, paper and cover state, a test page, and feed & cut. |

### Dates it understands

`today`, `tonight`, `tomorrow 3pm`, `friday`, `next monday at 9`, `sep 30`, `in 2 weeks`, `14:30`, `2026-10-31`.

- Words like "by", "on" and "due" before a date are dropped: `submit report by friday` becomes "submit report", due Friday.
- A bare hour from 1 to 7 means the afternoon: `call mom at 5` is 17:00.
- For numbers like `10/9`, choose Month/Day or Day/Month under **Numeric Dates** in the preferences.
- If a date is read wrongly (say, a film called Friday Night Lights), press ⌥↵ to add the task without a date.

### More lists

Start or end a task with `@name` to put it on another list, like `oat milk @groceries`. Create lists with ⌘N in To-Do List or ⌘⇧N in the Library. A list without any dates prints as a shop-style checklist.

### Suggested setup

- Give **Add To-Do** the alias `t`: type `t`, Tab, your task, ↵.
- Give **To-Do List** a hotkey, and **Print To-Do List** another.
- Make **To-Do List** a fallback command: anything you type in root search that matches nothing can become a task.
- From **Raycast Notes**: select the text (⌘A), then run **Print Selection or Clipboard** with a hotkey.

## Printing anything: the document model

Every receipt is a list of blocks, and one renderer (`src/core/render.ts`) turns any list into printer bytes. The to-do list, checklist and memo styles are just templates that build blocks (`src/core/layout.ts`).

| Block | What it prints |
|---|---|
| `text` | Text with bold, underline, white-on-black, font B, sizes 1–8 and alignment |
| `markdown` | Headings, **bold**, __underline__, ==highlight==, lists and tables |
| `list` | Checkboxes, bullets or numbers, with an optional right-aligned column |
| `table` | Columns with widths, alignment and a bold header row |
| `bar`, `rule`, `space` | The white-on-black header bar, single or double rules, gaps in dots |
| `image` | Any picture: scaled, rotated, toned (brightness, contrast, gamma), then dithered (Atkinson, Floyd–Steinberg, Bayer or threshold) |
| `qr`, `barcode` | Printer-drawn QR codes and barcodes (Code 128, EAN-13, UPC-A and more) |
| `cut`, `raw` | Several slips in one job, and raw ESC/POS for anything else |

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

## Limitations

- Receipt printers only have Latin, Greek and Cyrillic characters. Chinese, Japanese and emoji print as `?`; the preview lists which characters will be replaced.
- Status checks and auto-detect use Epson's commands. Other ESC/POS printers still print, but may not report paper or cover state.

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
```

`src/core` has no Raycast imports and is tested in plain Node. `src/platform/macos.ts` uses macOS's own `sips` and `osascript` for images and the clipboard. The Raycast commands live in `src/*.tsx` and `src/ui`.
