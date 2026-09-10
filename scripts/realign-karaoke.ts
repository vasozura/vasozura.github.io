/* Rebuild one prepared song's lyric timing from its vocal stem.
 *
 * Everything else in the prepared directory - the melody, the chords, the audio, the checksum - is
 * kept exactly as it was. Only the timing of the authoritative lyrics is replaced, and the chords
 * are re-anchored to the words they now sit above.
 *
 *   pnpm realign:karaoke -- --input=tmp/karaoke-real/taflis-tvali/prepared --stem=.../vocals.wav
 *   pnpm realign:karaoke -- --input=... --phrases=tmp/vocal-phrases.json --output=tmp/corrected
 *
 * The lyric text is never rewritten. Nothing is uploaded: the corrected manifest is written next to
 * the original for review. */
import { spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { KaraokeArtifactManifest, KaraokeChord } from "../src/karaoke/contracts";
import { alignLyricsToPhrases, type VocalPhrase } from "../src/karaoke/phrase-alignment";

const repository = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const argument = (name: string): string | null => process.argv.find((item) => item.startsWith(`--${name}=`))?.slice(name.length + 3) ?? null;

interface PhraseFile { durationSeconds: number; phrases: VocalPhrase[]; onsets: number[] }

/** Each chord keeps its own time and is re-anchored to the word sounding at that moment, so a
 *  symbol still sits above the word it belongs to after the timing changes.
 *
 *  A chord that plays during an instrumental passage has no word to sit above. Its timing is kept -
 *  it is still part of the chord timeline - but it is left unanchored rather than piled onto
 *  whichever lyric happens to be nearest, which is what turns a line into a row of stacked symbols. */
export function reanchorChords(chords: readonly KaraokeChord[], words: ReadonlyArray<{ id: string; startSeconds: number; endSeconds: number }>, toleranceSeconds = 1): KaraokeChord[] {
  if (!words.length) return [...chords];
  const taken = new Set<string>();
  return chords.map((chord) => {
    const covering = words.find((word) => chord.startSeconds >= word.startSeconds && chord.startSeconds < word.endSeconds);
    const nearest = covering ?? words.reduce((best, word) => Math.abs(word.startSeconds - chord.startSeconds) < Math.abs(best.startSeconds - chord.startSeconds) ? word : best, words[0]);
    const close = covering !== undefined || Math.abs(nearest.startSeconds - chord.startSeconds) <= toleranceSeconds;
    // One symbol per word: a second chord on the same word would print on top of the first.
    if (!close || taken.has(nearest.id)) return { ...chord, wordId: null };
    taken.add(nearest.id);
    return { ...chord, wordId: nearest.id };
  });
}

function main(): number {
  const input = argument("input");
  if (!input) throw new Error("--input=<prepared directory> is required.");
  const directory = path.resolve(input);
  const output = path.resolve(argument("output") ?? directory);
  const manifest = JSON.parse(readFileSync(path.join(directory, "manifest.json"), "utf8")) as KaraokeArtifactManifest;

  let phrasesFile = argument("phrases");
  if (!phrasesFile) {
    const stem = argument("stem");
    if (!stem) throw new Error("Pass --stem=<vocals.wav> to analyse, or --phrases=<vocal-phrases.json> if you already have one.");
    mkdirSync(path.join(repository, "tmp"), { recursive: true });
    phrasesFile = path.join(repository, "tmp", `${manifest.slug}-vocal-phrases.json`);
    const python = argument("python") ?? (process.platform === "win32" ? "py" : "python3");
    const result = spawnSync(python, [path.join(repository, "scripts", "vocal-phrases.py"), "--audio", path.resolve(stem), "--output", phrasesFile], { stdio: "inherit" });
    if (result.status !== 0) throw new Error("Vocal phrase analysis failed.");
  }
  const analysis = JSON.parse(readFileSync(path.resolve(phrasesFile), "utf8")) as PhraseFile;

  const rebuilt = alignLyricsToPhrases({
    authoritativeText: manifest.alignment.authoritativeText,
    phrases: analysis.phrases,
    onsets: analysis.onsets,
    durationSeconds: analysis.durationSeconds,
  });
  if (rebuilt.alignment.authoritativeText !== manifest.alignment.authoritativeText) throw new Error("The authoritative lyric text changed, which must never happen.");

  const words = rebuilt.alignment.lines.flatMap((line) => line.words);
  const corrected: KaraokeArtifactManifest = {
    ...manifest,
    alignment: rebuilt.alignment,
    chords: reanchorChords(manifest.chords, words),
    provenance: manifest.provenance
      ? { ...manifest.provenance, analysis: `${manifest.provenance.analysis} + vocal-phrase lyric alignment` }
      : { tool: "scripts/realign-karaoke.ts", analysis: "vocal-phrase lyric alignment", stemSeparation: true, lyricsSource: "song.lyrics", status: "review", notes: null },
  };
  mkdirSync(output, { recursive: true });
  writeFileSync(path.join(output, "manifest.json"), `${JSON.stringify(corrected, null, 2)}\n`, "utf8");
  writeFileSync(path.join(output, "lyrics-alignment.json"), `${JSON.stringify(rebuilt.alignment, null, 2)}\n`, "utf8");
  console.log(JSON.stringify({ slug: manifest.slug, ...rebuilt.diagnostics, chords: corrected.chords.length, output: path.relative(process.cwd(), output) }));
  return 0;
}

if (process.argv[1] && process.argv[1].endsWith("realign-karaoke.ts")) {
  try { process.exitCode = main(); } catch (error: unknown) { console.error(error instanceof Error ? error.message : error); process.exitCode = 1; }
}
