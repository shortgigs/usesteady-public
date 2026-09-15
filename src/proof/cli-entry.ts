import { runR0Proof } from "./r0-proof.js";

const args = process.argv.slice(3);
const approved = args.includes("--approve");
const keepSandbox = args.includes("--keep");
const known = new Set(["--approve", "--keep"]);
const unknown = args.filter((arg) => !known.has(arg));

if (unknown.length > 0) {
  process.stderr.write(`Unknown proof option(s): ${unknown.join(", ")}\n`);
  process.stderr.write("Usage: usesteady proof --approve [--keep]\n");
  process.exitCode = 2;
} else {
  const result = await runR0Proof({
    approved,
    keepSandbox,
    io: {
      out: (line) => process.stdout.write(`${line}\n`),
      err: (line) => process.stderr.write(`${line}\n`),
    },
  });
  process.exitCode = result === null ? 2 : 0;
}
