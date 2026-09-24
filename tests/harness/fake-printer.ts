/**
 * A pretend ESC/POS network printer for tests and development.
 *
 * It answers DLE EOT status and GS I identity queries, keeps every job it receives,
 * and can misbehave on purpose (offline, cover open, never finishing a job).
 *
 * As a command it saves each job to .captures/<time>.bin and .png:
 *   npm run fake-printer -- [--port 9100] [--model epson-tm-t88v] [--offline] [--cover-open] [--paper-out]
 */
import { mkdirSync, writeFileSync } from "node:fs";
import net from "node:net";
import path from "node:path";

export interface FakePrinterOptions {
  /** DLE EOT replies; defaults describe an online printer with paper. */
  status?: { printer?: number; offline?: number; error?: number; paper?: number };
  /** GS I replies; leave out to not answer identity queries at all. */
  identity?: { maker?: string; model?: string; firmware?: string };
  /** Take the data but never finish the job, like a jammed printer. */
  stall?: boolean;
  /** Called with each finished job (status queries removed). */
  onJob?: (job: Buffer) => void;
}

export const ONLINE = { printer: 0x16, offline: 0x12, error: 0x12, paper: 0x12 };

const STATUS_KEYS = { 1: "printer", 2: "offline", 3: "error", 4: "paper" } as const;
const INFO_KEYS = { 65: "firmware", 66: "maker", 67: "model" } as const;

export class FakePrinter {
  readonly jobs: Buffer[] = [];
  connections = 0;
  private server?: net.Server;
  private readonly sockets = new Set<net.Socket>();

  constructor(private readonly options: FakePrinterOptions = {}) {}

  /** Starts listening on 127.0.0.1 and returns the port. */
  async start(port = 0): Promise<number> {
    const server = net.createServer({ allowHalfOpen: !!this.options.stall }, (socket) => this.handle(socket));
    this.server = server;
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(port, "127.0.0.1", () => resolve());
    });
    return (server.address() as net.AddressInfo).port;
  }

  async stop(): Promise<void> {
    for (const socket of this.sockets) socket.destroy();
    await new Promise<void>((resolve) => (this.server ? this.server.close(() => resolve()) : resolve()));
  }

  private handle(socket: net.Socket) {
    this.connections++;
    this.sockets.add(socket);
    socket.on("close", () => this.sockets.delete(socket));
    socket.on("error", () => undefined);
    const job: number[] = [];
    let pending = Buffer.alloc(0);

    socket.on("data", (chunk: Buffer) => {
      pending = Buffer.concat([pending, chunk]);
      let i = 0;
      while (i < pending.length) {
        const [a, b, n] = [pending[i], pending[i + 1], pending[i + 2]];
        const complete = i + 2 < pending.length;
        if (a === 0x10 && b === 0x04) {
          if (!complete) break;
          const key = STATUS_KEYS[n as 1 | 2 | 3 | 4];
          const status = { ...ONLINE, ...this.options.status };
          if (key) socket.write(Uint8Array.of(status[key]));
          i += 3;
        } else if (a === 0x1d && b === 0x49) {
          if (!complete) break;
          const key = INFO_KEYS[n as 65 | 66 | 67];
          const value = key && this.options.identity?.[key];
          if (value) socket.write(Buffer.from(`_${value}\0`, "latin1"));
          i += 3;
        } else if ((a === 0x10 || a === 0x1d) && i + 1 >= pending.length) {
          break;
        } else {
          job.push(a);
          i += 1;
        }
      }
      pending = pending.subarray(i);
    });

    socket.on("end", () => {
      if (job.length > 0) {
        const bytes = Buffer.from(job);
        this.jobs.push(bytes);
        this.options.onJob?.(bytes);
      }
      if (!this.options.stall) socket.end();
    });
  }
}

/** A port on 127.0.0.1 with nothing listening, for "connection refused". */
export async function freePort(): Promise<number> {
  const server = net.createServer();
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
  const { port } = server.address() as net.AddressInfo;
  await new Promise<void>((resolve) => server.close(() => resolve()));
  return port;
}

async function main() {
  const args = process.argv.slice(2);
  const value = (flag: string) => {
    const at = args.indexOf(flag);
    return at >= 0 ? args[at + 1] : undefined;
  };
  const { isModelId, specFor } = await import("../../src/core/models");
  const { renderPreview } = await import("../../src/core/preview");
  const modelArg = value("--model") ?? "epson-tm-t88v";
  if (!isModelId(modelArg)) throw new Error(`Unknown model ${modelArg}`);
  const spec = specFor(modelArg);
  const outDir = path.resolve(import.meta.dirname, "../../.captures");
  mkdirSync(outDir, { recursive: true });

  const printer = new FakePrinter({
    status: {
      printer: args.includes("--offline") ? 0x1e : ONLINE.printer,
      offline: args.includes("--cover-open") ? 0x16 : ONLINE.offline,
      paper: args.includes("--paper-out") ? 0x72 : ONLINE.paper,
    },
    identity: { maker: "EPSON", model: spec.name.replace(/^Epson /, ""), firmware: "fake" },
    onJob: (job) => {
      const stamp = new Date().toISOString().replace(/[:.]/g, "-");
      writeFileSync(path.join(outDir, `${stamp}.bin`), job);
      const preview = renderPreview(job, spec);
      writeFileSync(path.join(outDir, `${stamp}.png`), preview.png);
      console.log(`job: ${job.length} bytes, ${preview.lengthMm} mm → .captures/${stamp}.png`);
    },
  });
  const port = await printer.start(Number(value("--port") ?? 9100));
  console.log(`Fake ${spec.name} listening on 127.0.0.1:${port}`);
}

if (process.argv[1] && import.meta.url.endsWith(path.basename(process.argv[1]))) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
