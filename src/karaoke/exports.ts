import type { KaraokeArtifactManifest, KaraokeChord, KaraokeRenderManifest, LearningVocalNote, LyricAlignment } from "./contracts";

const utf8 = new TextEncoder();
const bytes = (...parts: Array<Uint8Array | number[]>): Uint8Array => {
  const length = parts.reduce((sum, part) => sum + part.length, 0);
  const result = new Uint8Array(length);
  let offset = 0;
  for (const part of parts) { result.set(part, offset); offset += part.length; }
  return result;
};

function variableLength(value: number): number[] {
  let buffer = value & 0x7f;
  const output: number[] = [];
  while ((value >>= 7)) { buffer <<= 8; buffer |= (value & 0x7f) | 0x80; }
  while (true) { output.push(buffer & 0xff); if (buffer & 0x80) buffer >>= 8; else break; }
  return output;
}

function meta(type: number, payload: Uint8Array): Uint8Array { return bytes([0xff, type], variableLength(payload.length), payload); }
const chunk = (name: string, payload: Uint8Array): Uint8Array => bytes(utf8.encode(name), [(payload.length >>> 24) & 255, (payload.length >>> 16) & 255, (payload.length >>> 8) & 255, payload.length & 255], payload);

export interface MidiExportOptions { bpm?: number; timeSignature?: [number, number]; trackName?: string; provenance?: string; includeLyrics?: boolean; }

export function createMidi(notesInput: readonly LearningVocalNote[], alignment: LyricAlignment | null, options: MidiExportOptions = {}): Uint8Array {
  const ppq = 480;
  const bpm = options.bpm ?? 120;
  const ticksPerSecond = ppq * bpm / 60;
  const events: Array<{ tick: number; priority: number; data: Uint8Array }> = [];
  const [numerator, denominator] = options.timeSignature ?? [4, 4];
  events.push({ tick: 0, priority: 0, data: meta(0x03, utf8.encode(options.trackName ?? "Learning Melody")) });
  events.push({ tick: 0, priority: 1, data: meta(0x01, utf8.encode(options.provenance ?? "MP3 Vocal Extraction")) });
  const micros = Math.round(60_000_000 / bpm);
  events.push({ tick: 0, priority: 2, data: meta(0x51, new Uint8Array([(micros >>> 16) & 255, (micros >>> 8) & 255, micros & 255])) });
  events.push({ tick: 0, priority: 3, data: meta(0x58, new Uint8Array([numerator, Math.round(Math.log2(denominator)), 24, 8])) });
  if (options.includeLyrics && alignment) {
    for (const line of alignment.lines) for (const word of line.words) {
      events.push({ tick: Math.round(word.startSeconds * ticksPerSecond), priority: 4, data: meta(0x05, utf8.encode(word.text)) });
    }
  }
  for (const note of notesInput) {
    const start = Math.max(0, Math.round(note.startSeconds * ticksPerSecond));
    const end = Math.max(start + 1, Math.round((note.startSeconds + note.durationSeconds) * ticksPerSecond));
    const velocity = Math.max(1, Math.min(127, Math.round(note.velocity * 127)));
    events.push({ tick: start, priority: 6, data: new Uint8Array([0x90, note.midi, velocity]) });
    events.push({ tick: end, priority: 5, data: new Uint8Array([0x80, note.midi, 0]) });
  }
  events.sort((a, b) => a.tick - b.tick || a.priority - b.priority);
  let previous = 0;
  const trackParts: Uint8Array[] = [];
  for (const event of events) { trackParts.push(new Uint8Array(variableLength(event.tick - previous)), event.data); previous = event.tick; }
  trackParts.push(new Uint8Array([0x00, 0xff, 0x2f, 0x00]));
  const header = chunk("MThd", new Uint8Array([0, 0, 0, 0, 0, 1, (ppq >>> 8) & 255, ppq & 255]));
  return bytes(header, chunk("MTrk", bytes(...trackParts)));
}

function clock(seconds: number, fractionDigits = 3): string {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = (seconds % 60).toFixed(fractionDigits).padStart(2 + (fractionDigits ? fractionDigits + 1 : 0), "0");
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${secs}`;
}

export function createLrc(alignment: LyricAlignment): string {
  return `${alignment.lines.map((line) => {
    const minutes = Math.floor(line.startSeconds / 60);
    const seconds = (line.startSeconds % 60).toFixed(2).padStart(5, "0");
    return `[${String(minutes).padStart(2, "0")}:${seconds}]${line.text}`;
  }).join("\n")}\n`;
}

export function createSrt(alignment: LyricAlignment): string {
  return `${alignment.lines.map((line, index) => `${index + 1}\n${clock(line.startSeconds).replace(".", ",")} --> ${clock(line.endSeconds).replace(".", ",")}\n${line.text}`).join("\n\n")}\n`;
}

function assEscape(value: string): string { return value.replace(/[{}]/g, "").replace(/\n/g, "\\N"); }

export function createAss(alignment: LyricAlignment, chords: readonly KaraokeChord[] = [], width = 1920, height = 1080): string {
  const header = `[Script Info]\nScriptType: v4.00+\nPlayResX: ${width}\nPlayResY: ${height}\nWrapStyle: 0\n\n[V4+ Styles]\nFormat: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding\nStyle: Karaoke,Arial,64,&H00FFFFFF,&H0000B8FF,&H00101010,&H70000000,-1,0,0,0,100,100,0,0,1,3,1,2,120,120,110,1\nStyle: Chord,Arial,34,&H0000B8FF,&H0000B8FF,&H00101010,&H50000000,-1,0,0,0,100,100,0,0,1,2,0,8,120,120,190,1\n\n[Events]\nFormat: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text\n`;
  const events: string[] = [];
  for (const line of alignment.lines) {
    const karaoke = line.words.map((word) => `{\\k${Math.max(1, Math.round((word.endSeconds - word.startSeconds) * 100))}}${assEscape(word.text)} `).join("").trimEnd();
    events.push(`Dialogue: 0,${clock(line.startSeconds, 2)},${clock(line.endSeconds, 2)},Karaoke,,0,0,0,,${karaoke}`);
    const symbols = chords.filter((chord) => chord.startSeconds >= line.startSeconds && chord.startSeconds <= line.endSeconds).map((chord) => chord.symbol).join("     ");
    if (symbols) events.push(`Dialogue: 1,${clock(line.startSeconds, 2)},${clock(line.endSeconds, 2)},Chord,,0,0,0,,${assEscape(symbols)}`);
  }
  return `${header}${events.join("\n")}\n`;
}

export function createChordedLyrics(alignment: LyricAlignment, chords: readonly KaraokeChord[]): string {
  return `${alignment.lines.map((line) => {
    const chordLine = chords.filter((chord) => chord.wordId && line.words.some((word) => word.id === chord.wordId)).map((chord) => chord.symbol).join("     ");
    return chordLine ? `${chordLine}\n${line.text}` : line.text;
  }).join("\n\n")}\n`;
}

export function karaokePreset(preset: KaraokeRenderManifest["preset"]): Pick<KaraokeRenderManifest, "width" | "height" | "safeMargin"> {
  if (preset === "shorts-9:16") return { width: 1080, height: 1920, safeMargin: 108 };
  if (preset === "square-1:1") return { width: 1080, height: 1080, safeMargin: 86 };
  return { width: 1920, height: 1080, safeMargin: 96 };
}

export function createRenderManifest(manifest: KaraokeArtifactManifest, options: { preset: KaraokeRenderManifest["preset"]; audioSource: string; audioKind: KaraokeRenderManifest["audio"]["kind"]; backgroundKind: KaraokeRenderManifest["background"]["kind"]; backgroundSource?: string | null; subtitleSource: string; guide?: "piano" | "guitar" }): KaraokeRenderManifest {
  const dimensions = karaokePreset(options.preset);
  const lastLine = manifest.alignment.lines.at(-1);
  return { version: 1, preset: options.preset, ...dimensions, background: { kind: options.backgroundKind, source: options.backgroundSource ?? null }, audio: { kind: options.audioKind, source: options.audioSource, guide: options.guide }, subtitles: { source: options.subtitleSource, format: "ass" }, durationSeconds: lastLine?.endSeconds ?? 0 };
}
