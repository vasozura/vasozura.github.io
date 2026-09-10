import type { KaraokeRenderManifest } from "./contracts";

/** Deterministic FFmpeg invocation for one karaoke render.
 *
 * Kept as a pure function so every layout, background and audio combination is unit-testable
 * without FFmpeg installed. The preparation script is the only place that actually spawns it. */

export interface KaraokeVideoOptions {
  /** Absolute path of the MP4 to write. */
  outputFile: string;
  /** Overrides the audio recorded in the render manifest, used for the guide mix. */
  audioFile?: string;
  /** Trim the render, used for short review clips. */
  durationSeconds?: number | null;
  /** Overridden only by tests that need a stable frame count. */
  frameRate?: number | null;
}

const gradientColours = { start: "0x0f1016", end: "0x1c2338" } as const;

/** Escape a path for use inside a quoted `ass` filter argument.
 *  Backslashes become forward slashes so the same manifest works on Windows and Linux.
 *  A single quote cannot be escaped reliably inside an FFmpeg filter argument, so such a path
 *  is refused rather than silently producing a broken filtergraph. */
export function escapeFilterPath(file: string): string {
  if (file.includes("'")) throw new Error(`Rename the output directory: FFmpeg cannot take a path containing an apostrophe (${file}).`);
  return file.replace(/\\/g, "/").replace(/:/g, "\\:");
}

function backgroundInput(render: KaraokeRenderManifest): string[] {
  if (render.background.kind === "dark-gradient") {
    return ["-f", "lavfi", "-i", `gradients=s=${render.width}x${render.height}:c0=${gradientColours.start}:c1=${gradientColours.end}:x0=0:y0=0:x1=${render.width}:y1=${render.height}:type=linear:speed=0.00001:seed=1`];
  }
  if (!render.background.source) throw new Error(`A ${render.background.kind} background needs background.source.`);
  return ["-loop", "1", "-i", render.background.source];
}

function backgroundFilter(render: KaraokeRenderManifest): string {
  const size = `${render.width}:${render.height}`;
  if (render.background.kind === "dark-gradient") return "[0:v]setsar=1[bg]";
  if (render.background.kind === "image") return `[0:v]scale=${size}:force_original_aspect_ratio=increase,crop=${size},setsar=1[bg]`;
  if (render.background.kind === "cover-blur") {
    // A 16:9 cover cropped to 9:16 loses most of the artwork, so the cover is contained over a
    // blurred, darkened copy of itself. The whole image stays visible in every layout.
    const blurSigma = Math.max(12, Math.round(Math.min(render.width, render.height) / 26));
    return `[0:v]split=2[fill][fit];[fill]scale=${size}:force_original_aspect_ratio=increase,crop=${size},gblur=sigma=${blurSigma},eq=brightness=-0.16:saturation=0.7[blurred];[fit]scale=${size}:force_original_aspect_ratio=decrease[cover];[blurred][cover]overlay=(W-w)/2:(H-h)/2,setsar=1[bg]`;
  }
  throw new Error(`The ${render.background.kind} background is not implemented for offline rendering.`);
}

export function buildKaraokeFfmpegArgs(render: KaraokeRenderManifest, options: KaraokeVideoOptions): string[] {
  const audio = options.audioFile ?? render.audio.source;
  if (!audio) throw new Error("A karaoke render needs an audio source.");
  if (render.subtitles.format !== "ass") throw new Error(`Only ass subtitles can be burned in, received ${render.subtitles.format}.`);
  const filter = `${backgroundFilter(render)};[bg]ass='${escapeFilterPath(render.subtitles.source)}'[v]`;
  return [
    "-y", "-loglevel", "error",
    ...backgroundInput(render),
    "-i", audio,
    "-filter_complex", filter,
    "-map", "[v]", "-map", "1:a",
    ...(options.frameRate ? ["-r", String(options.frameRate)] : []),
    ...(options.durationSeconds ? ["-t", options.durationSeconds.toFixed(3)] : []),
    "-c:v", "libx264", "-preset", "veryfast", "-tune", "stillimage",
    "-c:a", "aac", "-b:a", "192k",
    "-pix_fmt", "yuv420p", "-movflags", "+faststart", "-shortest",
    options.outputFile,
  ];
}
