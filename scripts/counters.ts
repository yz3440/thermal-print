/**
 * Reads an Epson printer's maintenance counters without printing (GS g 2), e.g. to confirm that a
 * print from Raycast really happened: the cut count goes up by one per receipt.
 *
 * Usage: npm run counters -- <printer address>
 */
import { connect, parseAddress } from "../src/core/transport";

const COUNTERS: [string, number][] = [
  ["Cuts", 50],
  ["Line feeds", 20],
];

async function read(address: string, counter: number): Promise<string> {
  const socket = await connect(parseAddress(address));
  return new Promise((resolve) => {
    let reply = Buffer.alloc(0);
    const done = () => {
      socket.destroy();
      const end = reply.indexOf(0);
      resolve(reply.subarray(1, end >= 0 ? end : undefined).toString("latin1") || "no answer");
    };
    socket.setTimeout(2000, done);
    socket.on("data", (chunk: Buffer) => {
      reply = Buffer.concat([reply, chunk]);
      if (reply.includes(0)) done();
    });
    socket.write(Uint8Array.of(0x1d, 0x67, 0x32, 0x00, counter & 0xff, counter >> 8));
  });
}

async function main() {
  const address = process.argv[2];
  if (!address) throw new Error("Usage: npm run counters -- <printer address>");
  for (const [name, counter] of COUNTERS) console.log(`${name}: ${await read(address, counter)}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
