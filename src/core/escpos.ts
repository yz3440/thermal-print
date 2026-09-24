/** ESC/POS status and identity queries (Epson-compatible printers). */

const DLE = 0x10;
const EOT = 0x04;
const GS = 0x1d;

export type StatusKind = "printer" | "offline" | "error" | "paper";

const STATUS_N: Record<StatusKind, number> = { printer: 1, offline: 2, error: 3, paper: 4 };

/** DLE EOT n: real-time status. Answered immediately, even while the printer is busy or offline. */
export function statusRequest(kind: StatusKind): Uint8Array {
  return Uint8Array.of(DLE, EOT, STATUS_N[kind]);
}

export type InfoKind = "firmware" | "maker" | "model" | "serial";

const INFO_N: Record<InfoKind, number> = { firmware: 65, maker: 66, model: 67, serial: 68 };

/** GS I n: printer information. Not real-time: it waits behind print data and is ignored while offline. */
export function infoRequest(kind: InfoKind): Uint8Array {
  return Uint8Array.of(GS, 0x49, INFO_N[kind]);
}

/** Real-time status bytes always have bits 1 and 4 set and bits 0 and 7 clear. */
export function isStatusByte(byte: number | undefined): byte is number {
  return byte !== undefined && (byte & 0x93) === 0x12;
}

export interface PrinterStatus {
  online: boolean;
  coverOpen: boolean;
  paperOut: boolean;
  /** Unreliable on many units (the TM-T88V this was built with always reports it), so never blocks printing. */
  paperNearEnd: boolean;
  feedButtonPressed: boolean;
  cutterError: boolean;
  unrecoverableError: boolean;
  autoRecoverableError: boolean;
  /** The printer flagged an error in its offline status. */
  error: boolean;
  raw: Partial<Record<StatusKind, number>>;
}

export function decodeStatus(raw: Partial<Record<StatusKind, number>>): PrinterStatus {
  const printer = raw.printer ?? 0x12;
  const offline = raw.offline ?? 0x12;
  const error = raw.error ?? 0x12;
  const paper = raw.paper ?? 0x12;
  return {
    online: (printer & 0x08) === 0,
    feedButtonPressed: (printer & 0x40) !== 0,
    coverOpen: (offline & 0x04) !== 0,
    paperOut: (paper & 0x60) === 0x60 || (offline & 0x20) !== 0,
    paperNearEnd: (paper & 0x0c) === 0x0c,
    cutterError: (error & 0x08) !== 0,
    unrecoverableError: (error & 0x20) !== 0,
    autoRecoverableError: (error & 0x40) !== 0,
    error: (offline & 0x40) !== 0,
    raw,
  };
}

/** Why the printer can't take a job right now, or undefined if it can. */
export function blockingReason(status: PrinterStatus): string | undefined {
  if (status.coverOpen) return "The printer cover is open.";
  if (status.paperOut) return "The printer is out of paper.";
  if (status.cutterError) return "The cutter is jammed. Open the cover, clear the paper and close it again.";
  if (status.unrecoverableError) return "The printer reported a hardware error. Turn it off and on again.";
  if (status.autoRecoverableError)
    return "The printer is recovering from an error. It may be too hot; try again in a minute.";
  if (status.error) return "The printer reported an error.";
  if (!status.online) return "The printer is offline.";
  return undefined;
}

/** GS I replies are "_", ASCII text, then NUL. Returns the length of a complete reply, if there is one. */
export function infoReplyLength(buffer: Uint8Array): number | undefined {
  const end = buffer.indexOf(0);
  return end >= 0 ? end + 1 : undefined;
}

export function parseInfoReply(reply: Uint8Array): string | undefined {
  const end = reply.indexOf(0);
  const body = Buffer.from(reply.subarray(0, end >= 0 ? end : reply.length)).toString("latin1");
  const text = body.startsWith("_") ? body.slice(1) : body;
  return text.trim() || undefined;
}
