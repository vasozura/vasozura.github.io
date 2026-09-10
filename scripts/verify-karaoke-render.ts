/* Karaoke render gate.
 *
 * Renders one short MP4 for every layout and background from synthetic inputs, probes what FFmpeg
 * actually produced, and checks that a guide track really sounds at the pitches it was asked for.
 * Nothing here touches Supabase, a real song or any published artifact: it verifies the committed
 * rendering code so a release does not depend on remembering to eyeball a video by hand.
 *
 *   pnpm verify:karaoke                       (writes into the ignored tmp/ directory)
 *   pnpm verify:karaoke -- --output=tmp/check --keep-frames --ffmpeg="C:\\ffmpeg\\bin\\ffmpeg.exe"
 *
 * Requires FFmpeg and ffprobe. Exits non-zero if any layout, background or pitch check fails. */
import { spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { instrumentSampleBank } from "../src/audio/sample-instrument";
import type { KaraokeArtifactManifest, KaraokeRenderManifest } from "../src/karaoke/contracts";
import { createPresetAss, createRenderManifest, karaokePresets, karaokePresetSlug } from "../src/karaoke/exports";
import { guideSampleMidis, renderGuideTrack, type GuideSample } from "../src/karaoke/guide-audio";
import { alignLyricsToNotes } from "../src/karaoke/lyrics-alignment";
import { createLearningNotes } from "../src/karaoke/vocal-midi";
import { buildKaraokeFfmpegArgs } from "../src/karaoke/video-render";

const argument = (name: string): string | null => process.argv.find((item) => item.startsWith(`--${name}=`))?.slice(name.length + 3) ?? null;
const ffmpeg = argument("ffmpeg") ?? "ffmpeg";
const ffprobe = argument("ffprobe") ?? (argument("ffmpeg") ? path.join(path.dirname(ffmpeg), process.platform === "win32" ? "ffprobe.exe" : "ffprobe") : "ffprobe");
const output = path.resolve(argument("output") ?? "tmp/karaoke-render-check");
const keepFrames = process.argv.includes("--keep-frames");
const sampleRate = 44100;
const clipSeconds = 6;

const capture = (command: string, args: string[]): Buffer => {
  const result = spawnSync(command, args, { maxBuffer: 512 * 1024 * 1024 });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${path.basename(command)} failed: ${result.stderr?.toString().slice(0, 800)}`);
  return result.stdout;
};
const run = (command: string, args: string[]): void => { capture(command, args); };

function probe(file: string): { width: number; height: number; seconds: number; video: string; audio: string } {
  const parsed = JSON.parse(capture(ffprobe, ["-v", "error", "-show_entries", "stream=codec_type,codec_name,width,height", "-show_entries", "format=duration", "-of", "json", file]).toString()) as { streams: Array<Record<string, string | number>>; format: { duration: string } };
  const video = parsed.streams.find((stream) => stream.codec_type === "video");
  const audio = parsed.streams.find((stream) => stream.codec_type === "audio");
  if (!video || !audio) throw new Error(`${path.basename(file)} is missing a video or audio stream.`);
  return { width: Number(video.width), height: Number(video.height), seconds: Number(parsed.format.duration), video: String(video.codec_name), audio: String(audio.codec_name) };
}

/** Power at one frequency, enough to confirm a rendered note sounds at its own pitch. */
function goertzel(pcm: Float32Array, frequency: number): number {
  const coefficient = 2 * Math.cos(2 * Math.PI * frequency / sampleRate);
  let previous = 0;
  let older = 0;
  for (const value of pcm) { const current = value + coefficient * previous - older; older = previous; previous = current; }
  return Math.sqrt(previous * previous + older * older - coefficient * previous * older) / pcm.length;
}

function verifyGuide(): { rows: Array<Record<string, unknown>>; ok: boolean } {
  const bank = instrumentSampleBank("piano");
  // No octave pairs: a real piano note's second partial often beats its own fundamental, so an
  // octave candidate would win the comparison for the wrong reason.
  const melody = [60, 63, 65, 70];
  const notes = createLearningNotes(melody.map((midi, index) => ({ id: `g${index}`, midi, startSeconds: index, durationSeconds: .8, velocity: .85, confidence: .9, pitchConfidence: .9, sourceTimestampSeconds: index })));
  const bankDirectory = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "public", "audio", "salamander");
  const samples: GuideSample[] = guideSampleMidis(notes, bank).map((sample) => {
    const raw = capture(ffmpeg, ["-v", "error", "-i", path.join(bankDirectory, sample.file), "-f", "f32le", "-ac", "1", "-ar", String(sampleRate), "-"]);
    return { midi: sample.midi, pcm: new Float32Array(Uint8Array.from(raw.subarray(0, Math.floor(raw.length / 4) * 4)).buffer) };
  });
  const track = renderGuideTrack(notes, samples, bank, { sampleRate, totalSeconds: melody.length + 1 });
  const rows = melody.map((midi, index) => {
    const window = track.pcm.slice(Math.round((index + .08) * sampleRate), Math.round((index + .45) * sampleRate));
    const strongest = melody.map((candidate) => ({ candidate, power: goertzel(window, 440 * 2 ** ((candidate - 69) / 12)) })).reduce((best, item) => item.power > best.power ? item : best);
    return { note: midi, sounds: strongest.candidate, ok: strongest.candidate === midi };
  });
  return { rows, ok: rows.every((row) => row.ok) && track.missingSamples.length === 0 };
}

function main(): number {
  mkdirSync(output, { recursive: true });
  const audio = path.join(output, "instrumental.mp3");
  run(ffmpeg, ["-y", "-loglevel", "error", "-f", "lavfi", "-i", `sine=frequency=220:duration=${clipSeconds}`, "-c:a", "libmp3lame", audio]);
  const cover = path.join(output, "cover.jpg");
  run(ffmpeg, ["-y", "-loglevel", "error", "-f", "lavfi", "-i", "testsrc2=size=1600x900:duration=1", "-frames:v", "1", cover]);

  const notes = createLearningNotes([0, 1, 2, 3, 4, 5].map((index) => ({ id: `n${index}`, midi: 60 + index, startSeconds: index * .9, durationSeconds: .7, velocity: .8, confidence: .9, pitchConfidence: .9, sourceTimestampSeconds: index * .9 })));
  const aligned = alignLyricsToNotes("მზეო თიბათვისა შენ\nkaraoke layout check", notes);
  const chords = [{ id: "c0", symbol: "Am", startSeconds: 0, endSeconds: 3, wordId: aligned.alignment.lines[0].words[0].id, source: "analysis" as const }];
  const manifest = { alignment: aligned.alignment } as KaraokeArtifactManifest;

  const backgrounds: KaraokeRenderManifest["background"]["kind"][] = ["image", "cover-blur", "dark-gradient"];
  const rows: Array<Record<string, unknown>> = [];
  for (const background of backgrounds) {
    for (const preset of karaokePresets) {
      const name = `${background}-${karaokePresetSlug(preset)}`;
      const subtitle = path.join(output, `${name}.ass`);
      writeFileSync(subtitle, createPresetAss(aligned.alignment, chords, preset), "utf8");
      const render = createRenderManifest(manifest, { preset, audioSource: audio, audioKind: "instrumental", backgroundKind: background, backgroundSource: background === "dark-gradient" ? null : cover, subtitleSource: subtitle });
      const file = path.join(output, `${name}.mp4`);
      run(ffmpeg, buildKaraokeFfmpegArgs(render, { outputFile: file, durationSeconds: clipSeconds }));
      const actual = probe(file);
      if (keepFrames) run(ffmpeg, ["-y", "-loglevel", "error", "-ss", "2.5", "-i", file, "-frames:v", "1", path.join(output, `${name}.png`)]);
      rows.push({ background, preset, expected: `${render.width}x${render.height}`, actual: `${actual.width}x${actual.height}`, codecs: `${actual.video}/${actual.audio}`, seconds: actual.seconds.toFixed(2), ok: actual.width === render.width && actual.height === render.height });
    }
  }
  console.table(rows);
  const guide = verifyGuide();
  console.table(guide.rows);

  const failures = rows.filter((row) => !row.ok);
  if (failures.length) console.error(`${failures.length} layout(s) did not render at their declared resolution.`);
  if (!guide.ok) console.error("The guide track did not sound at the requested pitches.");
  if (failures.length || !guide.ok) return 1;
  console.log(`${rows.length} layout/background combinations and ${guide.rows.length} guide notes verified. Artifacts in ${path.relative(process.cwd(), output)}${keepFrames ? " (frames included)" : ""}.`);
  return 0;
}

try {
  process.exitCode = main();
} catch (error: unknown) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
}
