# Thermal Print

Print notes, lists, images, and whatever you've selected or copied, on a network receipt printer. Lists with dates come out grouped by day, on one receipt with one cut. Raycast AI can print for you too: ask it for today's tasks from Things or Reminders and they arrive on paper.

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
3. Leave **Printer Model** on Auto-detect for Epson printers. For other brands, pick the matching model, or a generic 58 mm / 80 mm one. Printer Status tells you when the model couldn't be detected.
4. On macOS 15 and later, the first connection may ask for Local Network access. Allow Raycast under System Settings → Privacy & Security → Local Network.

## Commands

| Command | What it does |
|---|---|
| **Compose Receipt** | Write a note or a list, preview it, print it, or save it as a draft. A list with dates (`call dentist tomorrow 3pm`) prints grouped by day. A line like `![caption](~/Pictures/photo.jpg)` prints the picture. |
| **Print Selection or Clipboard** | Prints what you've selected or copied: text (lists with dates print grouped by day), images selected in Finder, a copied image file, or a screenshot on the clipboard. Long texts open in Compose first. |
| **Print Image** | Photos, screenshots, logos: any image macOS can open (PNG, JPEG, HEIC, GIF, TIFF, WebP, the first page of a PDF). Starts with the images selected in Finder or the one on the clipboard. Choose the size, the look (photo, smooth, halftone, line art) and the brightness, and preview before printing. |
| **Receipt Library** | Saved drafts, jobs that couldn't print (Pending) and print history. Anything can be reprinted, edited or pinned. |
| **Printer Status** | Connection, paper and cover state, the detected model, a test page, and feed & cut. |

## Printing with Raycast AI

With Raycast Pro, the extension's tools let AI print for you and check the printer. Every print shows a preview of the receipt and asks before using paper.

- `@thermal-print print my tasks due today from Things`
- `@thermal-print print a shopping list: oat milk, eggs, coffee beans`
- `@thermal-print print what's on my clipboard`
- `@thermal-print print ~/Desktop/logo.png as line art`
- `@thermal-print is the printer ready?`

Tasks, reminders and events come from the other extensions' tools, so anything Raycast AI can read can be printed as one checklist grouped by day.

### Dates it understands

In a list, `today`, `tonight`, `tomorrow 3pm`, `friday`, `next monday at 9`, `sep 30`, `in 2 weeks`, `14:30` and `2026-10-31` are read out of each line.

- Words like "by", "on" and "due" before a date are dropped: `submit report by friday` becomes "submit report", due Friday.
- A bare hour from 1 to 7 means the afternoon: `call mom at 5` is 17:00.
- For numbers like `10/9`, choose Month/Day or Day/Month under **Numeric Dates** in the preferences.

## Suggested setup

- Give **Print Selection or Clipboard** a hotkey. From **Raycast Notes**, select the text (⌘A) and press it.
- Give **Compose Receipt** an alias, like `rc`.

## Limitations

- Receipt printers only have Latin, Greek and Cyrillic characters. Chinese, Japanese and emoji print as `?`; the preview lists which characters will be replaced.
- Status checks and auto-detect use Epson's commands. Other ESC/POS printers still print, but may not report paper or cover state, and need their model picked in the preferences.
- Dates and headings are in English.
