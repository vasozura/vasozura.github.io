/* Rebuild one prepared song's lyric timing from the generator's own forced alignment.
 *
 * Suno publishes `aligned_lyrics` for a generation: every written word with the seconds it is sung
 * in that exact render. Saved to a file, it becomes the Karaoke timing source, replacing anything
 * inferred locally. Nothing else in the prepared directory changes: the melody, the audio and the
 * checksum are kept, the chords are re-anchored to the words they now sit above, and the melody
 * notes are re-attached to the line, word and syllable sounding at their own start.
 *
 *   pnpm import:suno -- --input=tmp/karaoke-real/taflis-tvali/prepared \
 *                       --aligned=tmp/suno/aligned_lyrics.json \
 *                       --phrases=tmp/taflis/vocal-phrases-fine.json --output=tmp/suno/corrected
 *
 * `--phrases` is optional and can only cut a highlight short at a silence; every start and end
 * still comes from Suno. The authored lyrics are never rewritten and nothing is uploaded. */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { KaraokeArtifactManifest, LearningVocalNote, LyricAlignment } from "../src/karaoke/contracts";
import { buildSunoTimeline, type SungWindow } from "../src/karaoke/suno-timeline";
import { reanchorChords } from "./realign-karaoke";

const argument = (name: string): string | null => process.argv.find((item) => item.startsWith(`--${name}=`))?.slice(name.length + 3) ?? null;

interface PhraseFile { phrases: SungWindow[] }

/** Re-attach every melody note to whatever is being sung at the moment it starts. A note in an
 *  instrumental passage carries no lyric ids rather than the nearest stale ones. */
export function reattachNotes(notes: readonly LearningVocalNote[], alignment: LyricAlignment): LearningVocalNote[] {
  const within = (start: number, end: number, time: number): boolean => start <= time && end > time;
  return notes.map((note) => {
    const time = note.originalStartSeconds;
    const line = alignment.lines.find((item) => within(item.startSeconds, item.endSeconds, time)) ?? null;
    const word = line?.words.find((item) => within(item.startSeconds, item.endSeconds, time)) ?? null;
    const syllable = word?.syllables.find((item) => within(item.startSeconds, item.endSeconds, time)) ?? null;
    return { ...note, lyricLineId: line?.id ?? null, wordId: word?.id ?? null, syllableId: syllable?.id ?? null };
  });
}

function main(): number {
  const input = argument("input");
  const aligned = argument("aligned");
  if (!input) throw new Error("--input=<prepared directory> is required.");
  if (!aligned) throw new Error("--aligned=<aligned_lyrics.json> is required.");
  const directory = path.resolve(input);
  const output = path.resolve(argument("output") ?? directory);
  const manifest = JSON.parse(readFileSync(path.join(directory, "manifest.json"), "utf8")) as KaraokeArtifactManifest;
  const payload: unknown = JSON.parse(readFileSync(path.resolve(aligned), "utf8"));

  const phrasesFile = argument("phrases");
  const sungWindows = phrasesFile ? (JSON.parse(readFileSync(path.resolve(phrasesFile), "utf8")) as PhraseFile).phrases : undefined;

  const built = buildSunoTimeline(payload, { authoritativeText: manifest.alignment.authoritativeText, sungWindows });

  if (built.alignment.authoritativeText !== manifest.alignment.authoritativeText.replace(/\r\n/g, "\n").trim()) {
    throw new Error("The authoritative lyric text changed, which must never happen.");
  }
  // Every authored line must be recognisable in the performance, or the alignment belongs to a
  // different song and must not be shipped as this one's timing.
  const normalise = (text: string): string => text.replace(/[^\p{L}\p{N}]+/gu, " ").trim().toLowerCase();
  const sung = new Set(built.alignment.lines.map((line) => normalise(line.text)));
  const missing = manifest.alignment.authoritativeText.split("\n").map(normalise).filter(Boolean).filter((line) => !sung.has(line));
  if (missing.length) throw new Error(`${missing.length} authored line(s) are absent from the aligned lyrics, starting with: ${missing[0]}`);

  const words = built.alignment.lines.flatMap((line) => line.words).filter((word) => word.endSeconds > word.startSeconds);
  const corrected: KaraokeArtifactManifest = {
    ...manifest,
    alignment: built.alignment,
    originalNotes: reattachNotes(manifest.originalNotes, built.alignment),
    continuousNotes: reattachNotes(manifest.continuousNotes, built.alignment),
    chords: reanchorChords(manifest.chords, words),
    sourceConfidence: manifest.sourceConfidence,
    provenance: {
      tool: "scripts/import-suno-timeline.ts",
      analysis: `Suno aligned_lyrics (${built.diagnostics.tokenCount} tokens, ${built.diagnostics.sectionCount} sections)${sungWindows ? " + silence mask" : ""}`,
      stemSeparation: manifest.provenance?.stemSeparation ?? true,
      lyricsSource: "song.lyrics",
      status: "verified",
      notes: manifest.provenance?.notes ?? null,
    },
  };

  mkdirSync(output, { recursive: true });
  writeFileSync(path.join(output, "manifest.json"), `${JSON.stringify(corrected, null, 2)}\n`, "utf8");
  writeFileSync(path.join(output, "lyrics-alignment.json"), `${JSON.stringify(built.alignment, null, 2)}\n`, "utf8");
  writeFileSync(path.join(output, "performance-lyrics.txt"), `${built.performanceText}\n`, "utf8");
  console.log(JSON.stringify({ slug: manifest.slug, ...built.diagnostics, chords: corrected.chords.filter((chord) => chord.wordId).length, output: path.relative(process.cwd(), output) }));
  return 0;
}

if (process.argv[1] && process.argv[1].endsWith("import-suno-timeline.ts")) {
  try { process.exitCode = main(); } catch (error: unknown) { console.error(error instanceof Error ? error.message : error); process.exitCode = 1; }
}
