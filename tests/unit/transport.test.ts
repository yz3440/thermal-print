import assert from "node:assert/strict";
import { after, test } from "node:test";
import { parseAddress, PrinterError, probe, sendJob, serialize } from "../../src/core/transport";
import { FakePrinter, freePort } from "../harness/fake-printer";

const printers: FakePrinter[] = [];
after(async () => {
  for (const printer of printers) await printer.stop();
});

async function fake(options: ConstructorParameters<typeof FakePrinter>[0] = {}) {
  const printer = new FakePrinter(options);
  printers.push(printer);
  const port = await printer.start();
  return { printer, endpoint: { host: "127.0.0.1", port } };
}

const job = Buffer.from("\x1b@hello\n");

async function rejectsWith(promise: Promise<unknown>, code: string) {
  await assert.rejects(promise, (error: unknown) => {
    assert.ok(error instanceof PrinterError, String(error));
    assert.equal(error.code, code, error.message);
    return true;
  });
}

test("parseAddress", () => {
  assert.deepEqual(parseAddress("192.168.1.3"), { host: "192.168.1.3", port: 9100 });
  assert.deepEqual(parseAddress(" 192.168.1.3:9101 "), { host: "192.168.1.3", port: 9101 });
  assert.deepEqual(parseAddress("tcp://printer.local"), { host: "printer.local", port: 9100 });
  assert.deepEqual(parseAddress("[fe80::1]:9100"), { host: "fe80::1", port: 9100 });
  assert.throws(() => parseAddress(""), /No printer address/);
  assert.throws(() => parseAddress("192.168.1.3:99999"), /isn't a valid/);
  assert.throws(() => parseAddress("192.168.1.3:"), /isn't a valid/);
});

test("sends a job after checking the status", async () => {
  const { printer, endpoint } = await fake({ status: { paper: 0x1e } });
  const result = await sendJob(endpoint, job);
  assert.equal(printer.jobs.length, 1);
  assert.deepEqual(printer.jobs[0], job, "status queries are not part of the job");
  assert.equal(result.status?.online, true);
  assert.equal(result.status?.paperNearEnd, true);
});

test("refuses to print when the printer can't", async () => {
  for (const status of [{ printer: 0x1e }, { offline: 0x16 }, { paper: 0x72 }]) {
    const { printer, endpoint } = await fake({ status });
    await rejectsWith(sendJob(endpoint, job), "NOT_READY");
    assert.equal(printer.jobs.length, 0);
  }
});

test("prints to printers that don't answer status queries", async () => {
  const { printer, endpoint } = await fake({ status: { printer: 0x00, offline: 0x00, error: 0x00, paper: 0x00 } });
  await sendJob(endpoint, job);
  assert.equal(printer.jobs.length, 1);
});

test("retries a refused connection, then succeeds", async () => {
  const port = await freePort();
  const printer = new FakePrinter();
  printers.push(printer);
  setTimeout(() => void printer.start(port), 700);
  const started = Date.now();
  await sendJob({ host: "127.0.0.1", port }, job);
  assert.equal(printer.jobs.length, 1);
  assert.ok(Date.now() - started >= 700);
});

test("gives up on a closed port", async () => {
  await rejectsWith(sendJob({ host: "127.0.0.1", port: await freePort() }, job), "REFUSED");
});

test("times out on an address nobody answers", async () => {
  await rejectsWith(sendJob({ host: "192.0.2.1", port: 9100 }, job, { connectTimeoutMs: 300 }), "TIMEOUT");
});

test("reports a printer that stops taking data as stalled, maybe printed", async () => {
  const { endpoint } = await fake({ jam: true });
  // Bigger than the loopback socket buffers, so the writes really do stop.
  const big = Buffer.alloc(32 * 1024 * 1024, 0x20);
  await assert.rejects(sendJob(endpoint, big, { deadlineMs: 300 }), (error: unknown) => {
    assert.ok(error instanceof PrinterError);
    assert.equal(error.code, "STALLED");
    assert.equal(error.maybePrinted, true);
    return true;
  });
});

test("a printer that takes the job but never closes its side counts as printed", async () => {
  const { printer, endpoint } = await fake({ keepOpen: true });
  const started = Date.now();
  await sendJob(endpoint, job, { closeGraceMs: 100 });
  assert.equal(printer.jobs.length, 1);
  assert.ok(Date.now() - started >= 100, "waits the grace period for a close first");
});

test("probe reads status and identity", async () => {
  const { endpoint } = await fake({ identity: { maker: "EPSON", model: "TM-T88V", firmware: "30.27 ESC/POS" } });
  const result = await probe(endpoint);
  assert.equal(result.status?.online, true);
  assert.deepEqual(result.identity, { maker: "EPSON", model: "TM-T88V", firmware: "30.27 ESC/POS" });
});

test("probe skips identity while offline", async () => {
  const { endpoint } = await fake({ status: { printer: 0x1e }, identity: { model: "TM-T88V" } });
  const result = await probe(endpoint);
  assert.equal(result.status?.online, false);
  assert.equal(result.identity, undefined);
});

test("serialize runs tasks one after another", async () => {
  const order: string[] = [];
  const slow = serialize(async () => {
    await new Promise((resolve) => setTimeout(resolve, 50));
    order.push("slow");
  });
  const fast = serialize(async () => {
    order.push("fast");
  });
  await Promise.all([slow, fast]);
  assert.deepEqual(order, ["slow", "fast"]);
});
