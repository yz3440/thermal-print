import assert from "node:assert/strict";
import { test } from "node:test";
import { blockingReason, decodeStatus, isStatusByte, parseInfoReply } from "../../src/core/escpos";

test("status bytes carry the fixed bit pattern", () => {
  assert.ok(isStatusByte(0x12));
  assert.ok(isStatusByte(0x16));
  assert.ok(isStatusByte(0x1e));
  assert.ok(!isStatusByte(0x00));
  assert.ok(!isStatusByte(0x5f));
  assert.ok(!isStatusByte(undefined));
});

test("decodes the TM-T88V's real replies: online, paper near end", () => {
  const status = decodeStatus({ printer: 0x16, offline: 0x12, error: 0x12, paper: 0x1e });
  assert.equal(status.online, true);
  assert.equal(status.paperNearEnd, true);
  assert.equal(status.paperOut, false);
  assert.equal(status.coverOpen, false);
  assert.equal(blockingReason(status), undefined, "near end must not block printing");
});

test("offline, cover open, paper out and cutter errors block printing", () => {
  assert.match(blockingReason(decodeStatus({ printer: 0x1e }))!, /offline/);
  assert.match(blockingReason(decodeStatus({ offline: 0x16 }))!, /cover/);
  assert.match(blockingReason(decodeStatus({ paper: 0x72 }))!, /out of paper/);
  assert.match(blockingReason(decodeStatus({ offline: 0x32 }))!, /out of paper/);
  assert.match(blockingReason(decodeStatus({ error: 0x1a }))!, /cutter/);
  assert.match(blockingReason(decodeStatus({ error: 0x32 }))!, /hardware/);
});

test("parses GS I replies", () => {
  assert.equal(parseInfoReply(Buffer.from("_TM-T88V\0", "latin1")), "TM-T88V");
  assert.equal(parseInfoReply(Buffer.from("_EPSON\0", "latin1")), "EPSON");
  assert.equal(parseInfoReply(Buffer.from("_\0", "latin1")), undefined);
});
