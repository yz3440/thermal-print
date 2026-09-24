/** Raw TCP ("port 9100") connection to a receipt printer. */
import net from "node:net";
import {
  blockingReason,
  decodeStatus,
  infoReplyLength,
  infoRequest,
  isStatusByte,
  parseInfoReply,
  statusRequest,
  type PrinterStatus,
  type StatusKind,
} from "./escpos";

export interface Endpoint {
  host: string;
  port: number;
}

export const DEFAULT_PORT = 9100;

export type PrinterErrorCode = "CONFIG" | "UNREACHABLE" | "REFUSED" | "TIMEOUT" | "RESET" | "STALLED" | "NOT_READY";

export class PrinterError extends Error {
  readonly code: PrinterErrorCode;
  readonly hint?: string;
  /** True when some bytes may already have reached the printer, so a retry could print twice. */
  readonly maybePrinted: boolean;
  readonly status?: PrinterStatus;

  constructor(
    code: PrinterErrorCode,
    message: string,
    options: { hint?: string; maybePrinted?: boolean; status?: PrinterStatus } = {},
  ) {
    super(message);
    this.name = "PrinterError";
    this.code = code;
    this.hint = options.hint;
    this.maybePrinted = options.maybePrinted ?? false;
    this.status = options.status;
  }
}

const LOCAL_NETWORK_HINT =
  "Check that the printer is on and on the same network. On macOS 15 and later, also allow Raycast under System Settings → Privacy & Security → Local Network.";

/** Parses "192.168.1.3", "192.168.1.3:9100", "printer.local" or "[fe80::1]:9100". */
export function parseAddress(input: string): Endpoint {
  const cleaned = input
    .trim()
    .replace(/^[a-z]+:\/\//i, "")
    .replace(/\/.*$/, "");
  if (!cleaned) {
    throw new PrinterError("CONFIG", "No printer address is set.", {
      hint: "Enter the printer's IP address in the extension preferences.",
    });
  }
  let host = cleaned;
  let port = DEFAULT_PORT;
  const bracketed = cleaned.match(/^\[([^\]]+)\](?::(\d+))?$/);
  if (bracketed) {
    host = bracketed[1];
    if (bracketed[2]) port = Number(bracketed[2]);
  } else if (cleaned.split(":").length === 2) {
    const [name, portText] = cleaned.split(":");
    host = name;
    port = portText ? Number(portText) : Number.NaN;
  }
  if (!host || !Number.isInteger(port) || port < 1 || port > 65535) {
    throw new PrinterError("CONFIG", `“${input.trim()}” isn't a valid printer address.`, {
      hint: "Use an IP address or hostname, optionally with a port, like 192.168.1.3 or 192.168.1.3:9100.",
    });
  }
  return { host, port };
}

export function formatEndpoint(endpoint: Endpoint): string {
  const host = endpoint.host.includes(":") ? `[${endpoint.host}]` : endpoint.host;
  return endpoint.port === DEFAULT_PORT ? host : `${host}:${endpoint.port}`;
}

function errorCode(error: unknown): string | undefined {
  if (error instanceof AggregateError) return errorCode(error.errors[0]);
  if (error && typeof error === "object" && "code" in error && typeof error.code === "string") return error.code;
  return undefined;
}

export function connectError(error: unknown, endpoint: Endpoint): PrinterError {
  const where = formatEndpoint(endpoint);
  switch (errorCode(error)) {
    case "ECONNREFUSED":
      return new PrinterError("REFUSED", `The printer at ${where} refused the connection.`, {
        hint: "Check the port in the printer address, or wait if another app is printing.",
      });
    case "ENOTFOUND":
    case "EAI_AGAIN":
    case "EAI_NONAME":
      return new PrinterError("UNREACHABLE", `Can't find a printer called “${endpoint.host}”.`, {
        hint: "Check the printer address in the extension preferences.",
      });
    case "ECONNRESET":
    case "EPIPE":
      return new PrinterError("RESET", `The printer at ${where} dropped the connection.`);
    case "ETIMEDOUT":
      return new PrinterError("TIMEOUT", `No answer from the printer at ${where}.`, { hint: LOCAL_NETWORK_HINT });
    default:
      return new PrinterError("UNREACHABLE", `Can't reach the printer at ${where}.`, { hint: LOCAL_NETWORK_HINT });
  }
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function connectOnce(endpoint: Endpoint, timeoutMs: number): Promise<net.Socket> {
  return new Promise((resolve, reject) => {
    const socket = net.createConnection({ host: endpoint.host, port: endpoint.port });
    const timer = setTimeout(() => {
      socket.destroy();
      reject(
        new PrinterError("TIMEOUT", `No answer from the printer at ${formatEndpoint(endpoint)}.`, {
          hint: LOCAL_NETWORK_HINT,
        }),
      );
    }, timeoutMs);
    socket.once("connect", () => {
      clearTimeout(timer);
      resolve(socket);
    });
    socket.on("error", (error) => {
      clearTimeout(timer);
      socket.destroy();
      reject(connectError(error, endpoint));
    });
  });
}

/** Connects, retrying a refused or reset connection (the printer is busy with another job) up to twice. */
export async function connect(endpoint: Endpoint, timeoutMs = 3000): Promise<net.Socket> {
  for (let attempt = 1; ; attempt++) {
    try {
      return await connectOnce(endpoint, timeoutMs);
    } catch (error) {
      const retryable = error instanceof PrinterError && (error.code === "REFUSED" || error.code === "RESET");
      if (!retryable || attempt >= 3) throw error;
      await sleep(attempt * 400);
    }
  }
}

/** Collects what the printer sends back so queries can wait for their replies. */
class Replies {
  private buffer = Buffer.alloc(0);
  private wake?: () => void;
  private closed = false;

  constructor(private readonly socket: net.Socket) {
    socket.on("data", (chunk: Buffer) => {
      this.buffer = Buffer.concat([this.buffer, chunk]);
      this.wake?.();
    });
    socket.on("close", () => {
      this.closed = true;
      this.wake?.();
    });
  }

  /** Sends `request` and waits until `complete` reports a full reply, or gives up after `timeoutMs`. */
  async ask(
    request: Uint8Array,
    complete: (buffer: Buffer) => number | undefined,
    timeoutMs: number,
  ): Promise<Buffer | undefined> {
    this.buffer = Buffer.alloc(0);
    this.socket.write(request);
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      const length = complete(this.buffer);
      if (length !== undefined) {
        const reply = this.buffer.subarray(0, length);
        this.buffer = this.buffer.subarray(length);
        return reply;
      }
      const left = deadline - Date.now();
      if (this.closed || left <= 0) return undefined;
      await new Promise<void>((resolve) => {
        const timer = setTimeout(resolve, left);
        this.wake = () => {
          clearTimeout(timer);
          this.wake = undefined;
          resolve();
        };
      });
    }
  }
}

/** Reads DLE EOT status. Returns undefined when the printer doesn't answer (it isn't Epson-compatible). */
async function readStatus(
  replies: Replies,
  kinds: StatusKind[] = ["printer", "offline", "error", "paper"],
  timeoutMs = 800,
): Promise<PrinterStatus | undefined> {
  const raw: Partial<Record<StatusKind, number>> = {};
  for (const kind of kinds) {
    const reply = await replies.ask(statusRequest(kind), (b) => (b.length > 0 ? 1 : undefined), timeoutMs);
    const byte = reply?.[0];
    if (!isStatusByte(byte)) {
      if (Object.keys(raw).length === 0) return undefined;
      continue;
    }
    raw[kind] = byte;
  }
  return decodeStatus(raw);
}

/** Ends the connection after `job` and resolves once the printer has taken every byte and closed its side. */
function writeAndClose(socket: net.Socket, job: Uint8Array, deadlineMs: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const fail = (error: PrinterError) => {
      clearTimeout(timer);
      socket.destroy();
      reject(error);
    };
    const timer = setTimeout(
      () =>
        fail(
          new PrinterError("STALLED", "The printer stopped taking data.", {
            maybePrinted: true,
            hint: "Part of the receipt may have printed. Check the printer, then reprint from Pending.",
          }),
        ),
      deadlineMs,
    );
    socket.once("error", () =>
      fail(
        new PrinterError("RESET", "The connection dropped while printing.", {
          maybePrinted: true,
          hint: "Part of the receipt may have printed. Check the printer, then reprint from Pending.",
        }),
      ),
    );
    socket.once("close", (hadError) => {
      clearTimeout(timer);
      if (!hadError) resolve();
    });
    socket.end(Buffer.from(job));
  });
}

// One conversation with the printer at a time: it refuses (or queues) a second connection while busy.
let queue: Promise<unknown> = Promise.resolve();

/** Runs `task` after every earlier task. Wrap each whole print or probe in this, not the pieces inside it. */
export function serialize<T>(task: () => Promise<T>): Promise<T> {
  const run = queue.then(task, task);
  queue = run.catch(() => undefined);
  return run;
}

export interface SendOptions {
  connectTimeoutMs?: number;
  /** How long the printer may take to accept the whole job. Defaults to 10 s plus 1 s per 10 KB. */
  deadlineMs?: number;
  /** Check the real-time status first and refuse to print when the printer can't. ESC/POS printers only. */
  preflight?: boolean;
}

export interface SendResult {
  ms: number;
  status?: PrinterStatus;
}

/** Sends one print job. Not queued: call it inside serialize(). */
export async function sendJob(endpoint: Endpoint, job: Uint8Array, options: SendOptions = {}): Promise<SendResult> {
  const started = Date.now();
  const socket = await connect(endpoint, options.connectTimeoutMs);
  const replies = new Replies(socket);
  try {
    let status: PrinterStatus | undefined;
    if (options.preflight ?? true) {
      status = await readStatus(replies, ["printer", "offline", "paper"]);
      const reason = status && blockingReason(status);
      if (reason) throw new PrinterError("NOT_READY", reason, { status });
    }
    await writeAndClose(socket, job, options.deadlineMs ?? 10_000 + Math.ceil(job.length / 10));
    return { ms: Date.now() - started, status };
  } finally {
    socket.destroy();
  }
}

export interface PrinterIdentity {
  maker?: string;
  model?: string;
  firmware?: string;
}

export interface Probe {
  connectMs: number;
  status?: PrinterStatus;
  identity?: PrinterIdentity;
}

/**
 * Talks to the printer without printing: reads the status, then asks for its identity when it is online
 * to answer. Not queued: call it inside serialize().
 */
export async function probe(
  endpoint: Endpoint,
  options: { identify?: boolean; connectTimeoutMs?: number } = {},
): Promise<Probe> {
  const started = Date.now();
  const socket = await connect(endpoint, options.connectTimeoutMs);
  const connectMs = Date.now() - started;
  const replies = new Replies(socket);
  try {
    const status = await readStatus(replies);
    let identity: PrinterIdentity | undefined;
    if ((options.identify ?? true) && (!status || status.online)) {
      identity = {};
      for (const kind of ["maker", "model", "firmware"] as const) {
        const reply = await replies.ask(infoRequest(kind), infoReplyLength, 1500);
        if (!reply) break;
        identity[kind] = parseInfoReply(reply);
      }
    }
    return { connectMs, status, identity };
  } finally {
    socket.destroy();
  }
}
