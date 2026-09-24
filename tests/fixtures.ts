/** Sample receipts shared by the golden tests and scripts/render.ts. */
import type { RasterImage } from "../src/core/image";
import type { LayoutOptions } from "../src/core/layout";
import { specFor } from "../src/core/models";
import type { Receipt } from "../src/core/types";

/** A made-up photo: a sky that darkens upwards, a sun, and two ranges of hills. Deterministic. */
export function sampleImage(width = 320, height = 200): RasterImage {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const u = x / width;
      const v = y / height;
      let value = 90 + 150 * v;
      if (Math.hypot(u - 0.68, v - 0.42) < 0.13) value = 250;
      if (v > 0.62 + 0.1 * Math.sin(u * 9)) value = 110;
      if (v > 0.74 + 0.06 * Math.sin(u * 15 + 1)) value = 35;
      data.set([value, value, value, 255], (y * width + x) * 4);
    }
  }
  return { width, height, data };
}

/** Wednesday 23 September 2026, 18:52. */
export const NOW = new Date(2026, 8, 23, 18, 52);

export const BASE: LayoutOptions = {
  spec: specFor("epson-tm-t88v"),
  now: NOW,
  label: "YUFENG'S DESK",
  cut: "partial",
  dateOrder: "month-first",
  strict: true,
};

export interface Fixture {
  name: string;
  receipt: Receipt;
  options?: Partial<LayoutOptions>;
}

const task = (text: string, date?: string, time?: string) => ({
  text,
  checked: false,
  depth: 0,
  due: date ? { date, time } : undefined,
});

export const FIXTURES: Fixture[] = [
  {
    name: "todo-grouped",
    receipt: {
      style: "checklist",
      title: "To-Do",
      body: "",
      items: [
        task("Call the dentist", "2026-09-24", "15:00"),
        task("Buy oat milk"),
        task("Send the invoice to Acme", "2026-09-21"),
        task("Review the pull request", "2026-09-23", "20:30"),
        task("Dinner with Sam", "2026-09-23"),
        task("Go to the gym", "2026-09-24", "07:00"),
        task("Submit the quarterly report to the department office before the deadline", "2026-09-25"),
        task("Pay rent", "2026-09-30"),
        task("Renew passport", "2026-10-07"),
        task("Water the plants"),
      ],
    },
    options: { label: "" },
  },
  {
    name: "todo-from-text",
    receipt: {
      style: "checklist",
      body: [
        "# This week",
        "- [ ] call dentist tomorrow 3pm",
        "- [ ] submit report by friday",
        "- [ ] email Prof. Lee next monday at 9",
        "- [ ] buy oat milk",
        "- [ ] pay rent sep 30",
      ].join("\n"),
    },
  },
  {
    name: "list-3",
    receipt: {
      style: "checklist",
      title: "Groceries",
      body: "Oat milk\nEggs (dozen)\nCoffee beans — the good ones from the roaster on 5th",
    },
  },
  {
    name: "list-15",
    receipt: {
      style: "checklist",
      body: [
        "# Weekend packing list",
        "- [x] Passport",
        "- [ ] Charger",
        "  - [ ] USB-C cable",
        "  - [ ] Travel adapter",
        "- [ ] Toothbrush",
        "- [ ] Two shirts",
        "- [ ] Rain jacket",
        "- [ ] Book: The Remains of the Day",
        "- [ ] Headphones",
        "- [x] Snacks for the train",
        "- [ ] Water bottle",
        "- [ ] Sunglasses",
        "- [ ] Keys",
        "- [ ] Wallet",
        "- [ ] Umbrella",
      ].join("\n"),
    },
    options: { label: "" },
  },
  {
    name: "memo",
    receipt: {
      style: "memo",
      body: [
        "# Design review notes",
        "Print **whole to-do lists**, grouped by day. Keep the __@list__ grammar and nothing else.",
        "",
        "## Decisions",
        "- One cut per list, never between tasks",
        "- Lists without dates look like ==shop receipts==",
        "",
        "## Follow-ups",
        "- [ ] Calibration strip on real paper",
        "- [x] Golden images reviewed",
        "",
        "| Item | Owner |",
        "|:-----|------:|",
        "| Icon | Yufeng |",
        "| README | Claude |",
      ].join("\n"),
    },
  },
  {
    name: "accents",
    receipt: { style: "memo", body: "# Café crème\nGrößenordnung · Привет · Ελληνικά · naïve — “quoted” 25 €" },
  },
  {
    name: "unsupported",
    receipt: { style: "memo", body: "# Party\n你好 🎉 party at 8\n✅ cake → fridge\n☐ balloons" },
  },
  {
    name: "document",
    receipt: {
      style: "document",
      body: "",
      blocks: [
        { type: "bar", left: "THERMAL PRINT", right: "WED 23 SEP  18:52" },
        { type: "space", dots: 12 },
        { type: "image", raster: sampleImage(), dither: "atkinson", gamma: 1.2 },
        { type: "text", text: "Sunset over the hills", font: "B", align: "center" },
        { type: "rule" },
        {
          type: "table",
          columns: [{}, { width: 8, align: "right" }],
          header: ["Item", "Price"],
          rows: [
            ["Oat milk", "2.40"],
            ["Coffee beans", "11.90"],
          ],
        },
        { type: "rule" },
        { type: "qr", value: "https://www.raycast.com/yz3440/thermal-print", size: 5 },
        { type: "barcode", value: "TP-0042", symbology: "code128", height: 50 },
        { type: "text", text: "THANK YOU", bold: true, width: 2, height: 2, align: "center" },
      ],
    },
  },
  { name: "ticket", receipt: { style: "ticket", body: "Call the dentist about Friday" } },
  { name: "plain", receipt: { style: "plain", body: "Plain text\n  keeps its spacing\n\n# and its hashes" } },
];
