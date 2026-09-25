import assert from "node:assert/strict";
import { after, test } from "node:test";
import type { Block } from "../../src/core/document";
import { blankImage } from "../../src/core/image";
import { printReceipt, type PrintJob, type PrinterSettings } from "../../src/core/print";
import { itemsMarkdown, receiptOf, Store } from "../../src/core/store";
import { FakePrinter, freePort } from "../harness/fake-printer";
import { MemoryKV } from "../harness/memory-kv";

const printers: FakePrinter[] = [];
after(async () => {
  for (const printer of printers) await printer.stop();
});

async function setup(options: ConstructorParameters<typeof FakePrinter>[0] = {}) {
  const printer = new FakePrinter({ identity: { maker: "EPSON", model: "TM-T88V" }, ...options });
  printers.push(printer);
  const port = await printer.start();
  const store = new Store(new MemoryKV());
  const settings: PrinterSettings = {
    address: `127.0.0.1:${port}`,
    model: "auto",
    cut: "partial",
    dateOrder: "month-first",
  };
  return { printer, store, settings };
}

/** A checklist with dates, as the print-checklist tool builds it. */
function todoJob(): PrintJob {
  const items = [
    { text: "call dentist", due: { date: "2026-09-24", time: "15:00" }, done: false },
    { text: "buy milk", done: false },
  ];
  return {
    receipt: {
      style: "checklist",
      title: "To-Do",
      body: itemsMarkdown(items),
      items: items.map((item) => ({ text: item.text, checked: item.done, depth: 0, due: item.due })),
    },
    source: "ai",
  };
}

test("prints a whole list as one job with one cut", async () => {
  const { printer, store, settings } = await setup();
  const result = await printReceipt(store, settings, todoJob(), { now: () => new Date(2026, 8, 23, 18, 52) });
  assert.ok(result.ok);
  assert.equal(result.modelDetected, true);
  assert.equal(printer.jobs.length, 1);
  const text = printer.jobs[0].toString("latin1");
  assert.match(text, /call dentist/);
  assert.match(text, /buy milk/);
  assert.match(text, /TOMORROW/);
  const cuts = text.split("\x1dV").length - 1;
  assert.equal(cuts, 1, "one cut for the whole list");
  const history = (await store.all()).filter((record) => record.kind === "history");
  assert.equal(history.length, 1);
  assert.equal(history[0].items?.length, 2);
});

test("auto-detect asks the printer once and remembers the answer", async () => {
  const { printer, store, settings } = await setup();
  await printReceipt(store, settings, todoJob());
  await printReceipt(store, settings, todoJob());
  assert.equal(printer.connections, 3, "one probe, two jobs");
  const cached = await store.printerCache(settings.address);
  assert.deepEqual(cached, { model: "epson-tm-t88v", detected: true, identity: "EPSON TM-T88V" });
});

test("a printer that gives no identity prints with the fallback, flagged as not detected", async () => {
  const { store, settings } = await setup({ identity: undefined });
  const result = await printReceipt(store, settings, { receipt: { style: "memo", body: "note" }, source: "compose" });
  assert.ok(result.ok);
  assert.equal(result.modelDetected, false);
  assert.equal(result.spec.model, "epson-tm-t88v");
});

test("a failed print goes to Pending with the tasks kept", async () => {
  const { store, settings } = await setup({ status: { offline: 0x16 } });
  const failed = await printReceipt(store, { ...settings, model: "epson-tm-t88v" }, todoJob());
  assert.ok(!failed.ok && failed.error.code === "NOT_READY");
  assert.equal(failed.record?.kind, "pending");
  assert.match(failed.record?.error ?? "", /cover/);
  assert.equal(failed.record?.items?.length, 2);
});

test("retrying a pending job turns it into history", async () => {
  const { store, settings } = await setup();
  const offline = { ...settings, address: `127.0.0.1:${await freePort()}`, model: "epson-tm-t88v" };
  const failed = await printReceipt(store, offline, { receipt: { style: "memo", body: "note" }, source: "compose" });
  assert.ok(!failed.ok && failed.record);
  const retried = await printReceipt(
    store,
    { ...settings, model: "epson-tm-t88v" },
    { receipt: receiptOf(failed.record), source: "library", fromId: failed.record.id },
  );
  assert.ok(retried.ok);
  assert.equal(retried.record.id, failed.record.id);
  assert.deepEqual(
    (await store.all()).map((record) => record.kind),
    ["history"],
  );
});

test("a printer that never closes the connection still counts as printed", async () => {
  const { printer, store, settings } = await setup({ keepOpen: true });
  const result = await printReceipt(
    store,
    { ...settings, model: "epson-tm-t88v" },
    { receipt: { style: "memo", body: "note" }, source: "compose" },
    { send: { closeGraceMs: 100 } },
  );
  assert.ok(result.ok);
  assert.equal(printer.jobs.length, 1);
});

test("images are loaded, printed, and stored by path only", async () => {
  const { printer, store, settings } = await setup();
  const blocks: Block[] = [
    { type: "image", src: "/photos/sunset.png", width: "half" },
    { type: "image", src: "/photos/missing.jpg" },
    { type: "text", text: "caption", align: "center" },
  ];
  const result = await printReceipt(
    store,
    { ...settings, model: "epson-tm-t88v" },
    { receipt: { style: "document", body: "sunset.png", blocks }, source: "image" },
    {
      loadImage: async (src) => {
        if (src === "/photos/sunset.png") return blankImage(200, 100, 0);
        throw new Error("not found");
      },
    },
  );
  assert.ok(result.ok);
  assert.deepEqual(result.missingImages, ["/photos/missing.jpg"]);
  const job = printer.jobs[0];
  assert.ok(job.includes(Buffer.from([0x1b, 0x2a])), "a bit image");
  assert.match(job.toString("latin1"), /\[image not found: missing\.jpg\]/);
  const saved = result.record.blocks?.find((block) => block.type === "image");
  assert.ok(saved && saved.type === "image" && saved.src === "/photos/sunset.png" && !saved.raster);
});

test("a bad address fails with a config error and is not kept as pending", async () => {
  const store = new Store(new MemoryKV());
  const result = await printReceipt(
    store,
    { address: "", model: "auto", cut: "partial", dateOrder: "month-first" },
    { receipt: { style: "memo", body: "note" }, source: "compose" },
  );
  assert.ok(!result.ok && result.error.code === "CONFIG");
  assert.equal(result.record, undefined);
  assert.equal((await store.all()).length, 0);
});
