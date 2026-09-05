import { readdir, stat } from "node:fs/promises";
import path from "node:path";

const assets = path.resolve("dist", "assets");
const files = (await readdir(assets)).filter((file) => file.endsWith(".js"));
const sizes = new Map(await Promise.all(files.map(async (file) => [file, (await stat(path.join(assets, file))).size])));

function requireChunk(prefix, maximumBytes) {
  const matches = [...sizes].filter(([file]) => file.startsWith(prefix));
  if (matches.length !== 1) throw new Error(`Expected one ${prefix} lazy chunk, found ${matches.length}.`);
  const [file, bytes] = matches[0];
  if (bytes > maximumBytes) throw new Error(`${file} is ${bytes} bytes; budget is ${maximumBytes}.`);
}

const main = [...sizes].filter(([file]) => /^index-[^.]+\.js$/.test(file));
if (main.length !== 1 || main[0][1] > 450_000) throw new Error("Main application chunk exceeded the 450 KB budget.");
requireChunk("learning-mode-", 100_000);
requireChunk("piano-visualizer-", 25_000);
requireChunk("guitar-visualizer-", 25_000);
requireChunk("accordion-visualizer-", 35_000);
requireChunk("opensheetmusicdisplay.min-", 1_600_000);

console.log("Performance budgets passed: main, Learning, instrument and OSMD chunks remain bounded.");
