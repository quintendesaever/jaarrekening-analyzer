import { createHash } from "node:crypto";
import { sha256Hex, sha256HexWithoutSubtle } from "../src/utils/hash.ts";

function nodeHex(data: Uint8Array): string {
  return createHash("sha256").update(data).digest("hex");
}

function asBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(
    bytes.byteOffset,
    bytes.byteOffset + bytes.byteLength,
  );
}

const cases: Array<[string, Uint8Array]> = [
  ["empty", new Uint8Array()],
  ["abc", new TextEncoder().encode("abc")],
  ["quick", new TextEncoder().encode("The quick brown fox jumps over the lazy dog")],
  ["binary", Uint8Array.from({ length: 300 }, (_, i) => i & 0xff)],
  ["64kib", new Uint8Array(1024 * 64).fill(7)],
];

let failed = 0;
for (const [name, bytes] of cases) {
  const expect = nodeHex(bytes);
  const got = sha256HexWithoutSubtle(asBuffer(bytes));
  const ok = expect === got;
  console.log(name, ok ? "OK" : "FAIL");
  if (!ok) {
    console.log("  expect", expect);
    console.log("  got   ", got);
    failed += 1;
  }
}

const abc = new TextEncoder().encode("abc");
const subtleGot = await sha256Hex(asBuffer(abc));
const subtleOk = subtleGot === nodeHex(abc);
console.log("subtle-abc", subtleOk ? "OK" : "FAIL");
if (!subtleOk) failed += 1;

process.exit(failed ? 1 : 0);
