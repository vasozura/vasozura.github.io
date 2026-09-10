/* Browser end-to-end check for VOCAL / KARAOKE.
 *
 * Mounts the real karaoke module against a real prepared directory in a real browser, plays the
 * canonical MP3, and asserts what a person would otherwise have to watch for by hand: lyrics that
 * follow playback, seeking that keeps every view in step, a lyric click that seeks without changing
 * whether the song is playing, chords, guide instruments, obvious control states and a page that
 * never scrolls itself.
 *
 *   pnpm verify:karaoke:browser -- --input=tmp/karaoke/song-slug --audio=tmp/karaoke/canonical.mp3
 *   pnpm verify:karaoke:browser -- --input=... --audio=... --headed --keep-server
 *
 * Playwright is not a dependency of this app; install it where the check is run:
 *   pnpm add -D playwright && pnpm exec playwright install chromium
 *
 * Nothing here touches Supabase or a published song: it serves the repository through Vite and
 * reads one prepared directory. Exits non-zero if any assertion fails. */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { KaraokeArtifactManifest } from "../src/karaoke/contracts";

const repository = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const argument = (name: string): string | null => process.argv.find((item) => item.startsWith(`--${name}=`))?.slice(name.length + 3) ?? null;
const headed = process.argv.includes("--headed");

interface Check { name: string; ok: boolean; detail: string }
const checks: Check[] = [];
const record = (name: string, ok: boolean, detail: unknown = ""): void => { checks.push({ name, ok, detail: String(detail) }); };

/** The song page renders this markup around the karaoke panel; the harness reproduces it exactly so
 *  the module under test sees what it sees in production. */
function harnessPage(options: { manifestUrl: string; audioUrl: string; manifest: KaraokeArtifactManifest; lyrics: string; bpm: number }): string {
  const attribute = (value: string): string => value.replace(/[&<>"]/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[character]!);
  return `<!doctype html>
<html lang="ka"><head><meta charset="utf-8"><title>Karaoke browser check</title><link rel="stylesheet" href="/src/styles.css"></head>
<body class="karaoke-browser-check">
<main>
<section class="song-resource karaoke-panel" id="vocal-karaoke"
  data-slug="${attribute(options.manifest.slug)}" data-song-id="${attribute(options.manifest.songId)}"
  data-audio-url="${attribute(options.audioUrl)}" data-manifest-url="${attribute(options.manifestUrl)}"
  data-lyrics="${attribute(options.lyrics)}" data-duration-seconds="${options.manifest.timeline?.canonicalDurationSeconds ?? ""}"
  data-bpm="${options.bpm}" data-musical-key="G" aria-labelledby="karaoke-title"><h2 id="karaoke-title">VOCAL / KARAOKE</h2></section>
</main>
<script type="module">
  import { mountKaraokeMode } from "/src/karaoke/karaoke-mode.ts";
  const root = document.querySelector("#vocal-karaoke");
  root.querySelector("h2").remove();
  mountKaraokeMode(root).then(() => { document.body.dataset.karaokeReady = "true"; }, (error) => { document.body.dataset.karaokeError = String(error); });
</script>
</body></html>`;
}

async function main(): Promise<number> {
  const input = argument("input");
  const audio = argument("audio");
  if (!input || !audio) throw new Error("--input=<prepared directory> and --audio=<canonical mp3> are both required.");
  const directory = path.resolve(input);
  const manifest = JSON.parse(readFileSync(path.join(directory, "manifest.json"), "utf8")) as KaraokeArtifactManifest;

  // Resolved through a variable so TypeScript does not require Playwright to be installed for a
  // normal typecheck: this harness is optional tooling, not an app dependency.
  const playwrightModule = "playwright";
  const playwright = await import(playwrightModule).catch(() => null) as { chromium?: { launch: (options: Record<string, unknown>) => Promise<any> } } | null;
  if (!playwright?.chromium) throw new Error("Playwright is not installed here. Run: pnpm add -D playwright && pnpm exec playwright install chromium");
  const { createServer } = await import("vite");

  const output = path.join(repository, "tmp", "karaoke-browser-check");
  mkdirSync(output, { recursive: true });
  const served = (file: string): string => `/${path.relative(repository, file).split(path.sep).map(encodeURIComponent).join("/")}`;
  writeFileSync(path.join(output, "index.html"), harnessPage({
    manifestUrl: served(path.join(directory, "manifest.json")),
    audioUrl: served(path.resolve(audio)),
    manifest,
    lyrics: manifest.alignment.authoritativeText,
    bpm: 96,
  }), "utf8");

  const server = await createServer({ root: repository, server: { port: 5199, strictPort: true }, logLevel: "error" });
  await server.listen();
  const url = `http://localhost:5199${served(path.join(output, "index.html"))}`;
  // Autoplay is blocked without a gesture in a normal browser; the harness drives playback directly.
  const executablePath = process.env.PLAYWRIGHT_EXECUTABLE_PATH?.trim() || undefined;
  const browser = await playwright.chromium.launch({
    headless: !headed,
    executablePath,
    args: ["--autoplay-policy=no-user-gesture-required", "--mute-audio"],
  });
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });

  const consoleErrors: string[] = [];
  const httpErrors: string[] = [];
  const requestErrors: string[] = [];

  page.on("pageerror", (error: Error) => {
    consoleErrors.push(`pageerror: ${error.message}`);
  });

  page.on("console", (message: { type: () => string; text: () => string }) => {
    if (message.type() !== "error") return;

    const text = message.text();

    // Chromium emits a generic console error for failed resources. The exact
    // URL/status is captured by the response/requestfailed handlers below.
    if (text.startsWith("Failed to load resource:")) return;

    consoleErrors.push(`console: ${text}`);
  });

  page.on("response", (response: any) => {
    if (response.status() >= 400) {
      httpErrors.push(`${response.status()} ${response.url()}`);
    }
  });

  page.on("requestfailed", (request: any) => {
    const failure = request.failure?.();
    const errorText = failure?.errorText ?? "";

    // Chromium routinely aborts in-flight media range requests when the
    // <audio> element seeks, reloads metadata, or changes playback state.
    // That is not a broken resource and must not fail the browser QA gate.
    if (errorText === "net::ERR_ABORTED") return;

    requestErrors.push(
      `requestfailed ${request.url()}${errorText ? ` (${errorText})` : ""}`,
    );
  });

  try {
    await page.goto(url, { waitUntil: "load" });
    await page.waitForSelector("body[data-karaoke-ready='true']", { timeout: 20000 });
    record("Karaoke mounts on the song panel", true, await page.locator(".karaoke-heading h2").innerText());

    // Browser-side snippets are plain JavaScript strings: the TypeScript loader rewrites function
    // bodies with helpers that do not exist inside the page, so a passed function would not run.
    const inPage = async <T>(source: string): Promise<T> => await page.evaluate(`(async () => { ${source} })()`) as T;
    const wait = (ms: number): string => `await new Promise((r) => setTimeout(r, ${ms}));`;
    const audioElement = `const audio = document.querySelector("[data-karaoke-audio]");`;
    const activeLine = `const activeLine = () => { const line = document.querySelector(".karaoke-line.is-active"); return line ? line.dataset.lineId : ""; };`;

    const audioReady = await inPage<{ source: boolean; duration: number }>(`
      ${audioElement}
      if (!isFinite(audio.duration) || !audio.duration) await new Promise((r) => audio.addEventListener("loadedmetadata", r, { once: true }));
      return { source: Boolean(audio.currentSrc), duration: audio.duration };`);
    record("Canonical MP3 loads with a real duration", audioReady.source && audioReady.duration > 1, `${audioReady.duration.toFixed(2)}s`);

    const lines = await page.locator(".karaoke-line").count();
    record("Every authoritative lyric line is rendered", lines === manifest.alignment.lines.length, `${lines} lines`);

    const followed = await inPage<{ moved: boolean; first: string; afterSeek: string; playing: boolean; at: number }>(`
      ${audioElement} ${activeLine}
      const first = activeLine();
      audio.currentTime = 0;
      await audio.play();
      const start = audio.currentTime;
      ${wait(2500)}
      const moved = audio.currentTime > start + 1;
      audio.currentTime = Math.min(audio.duration - 1, 9);
      ${wait(400)}
      return { moved, first, afterSeek: activeLine(), playing: !audio.paused, at: audio.currentTime };`);
    record("Playback advances the canonical clock", followed.moved, `at ${followed.at.toFixed(2)}s`);
    record("Seeking moves the highlighted lyric line", Boolean(followed.afterSeek) && followed.afterSeek !== followed.first, `${followed.first} -> ${followed.afterSeek}`);

    const whilePlaying = await inPage<{ target: number; at: number; playing: boolean; wordId: string }>(`
      ${audioElement}
      const word = document.querySelectorAll(".karaoke-line[data-line-id] .karaoke-word")[1];
      const target = Number(word.dataset.start);
      word.click();
      ${wait(300)}
      return { target, at: audio.currentTime, playing: !audio.paused, wordId: word.dataset.wordId };`);
    record("Clicking a lyric seeks to that word", Math.abs(whilePlaying.at - whilePlaying.target) < 1.2, `wanted ${whilePlaying.target.toFixed(2)}s, got ${whilePlaying.at.toFixed(2)}s`);
    record("A click during playback keeps playing", whilePlaying.playing, "still playing");

    const whilePaused = await inPage<{ before: number; target: number; at: number; paused: boolean }>(`
      ${audioElement}
      audio.pause();
      const before = audio.currentTime;
      const words = document.querySelectorAll(".karaoke-line[data-line-id] .karaoke-word");
      const word = words[words.length - 1];
      word.click();
      ${wait(300)}
      return { before, target: Number(word.dataset.start), at: audio.currentTime, paused: audio.paused };`);
    record("A click while paused seeks and stays paused", whilePaused.paused && Math.abs(whilePaused.at - whilePaused.target) < 1.2, `${whilePaused.before.toFixed(2)}s -> ${whilePaused.at.toFixed(2)}s, paused`);

    const resumed = await inPage<{ moving: boolean; reset: number; line: string }>(`
      ${audioElement} ${activeLine}
      const from = audio.currentTime;
      await audio.play();
      ${wait(1200)}
      const moving = audio.currentTime > from;
      audio.pause();
      audio.currentTime = 0;
      ${wait(300)}
      return { moving, reset: audio.currentTime, line: activeLine() };`);
    record("Resume continues from the clicked position", resumed.moving, "clock advanced after resume");
    record("Stopping returns to the first line", resumed.reset === 0 && resumed.line === "line-0", `line ${resumed.line}`);

    const chords = await inPage<{ before: number; off: number; on: number; inWord: boolean; symbol: string }>(`
      const visible = () => [...document.querySelectorAll(".karaoke-chord")].filter((element) => element.offsetParent !== null).length;
      const before = visible();
      document.querySelector("[data-chords-off]").click();
      const off = visible();
      document.querySelector("[data-chords]").click();
      const first = document.querySelector(".karaoke-chord");
      return { before, off, on: visible(), inWord: Boolean(first && first.closest(".karaoke-word")), symbol: first ? first.textContent : "" };`);
    record("Chords render above a timed word, not at the line start", chords.before > 0 && chords.inWord, `${chords.before} chords, first "${chords.symbol}"`);
    record("The chord toggle hides and restores them", chords.off === 0 && chords.on === chords.before, `${chords.before} -> ${chords.off} -> ${chords.on}`);

    const availability = await inPage<{ banner: string; instrumental: boolean; guides: string }>(`
      const button = (mode) => document.querySelector('[data-audio-mode="' + mode + '"]');
      return {
        banner: document.querySelector(".karaoke-availability").innerText,
        instrumental: button("instrumental").disabled,
        guides: [...document.querySelectorAll("[data-guide]")].map((item) => item.dataset.guide + ":" + (item.disabled ? "off" : "on")).join(" "),
      };`);
    const instrumentalPrepared = Boolean(manifest.audio.instrumentalUrl);
    record("Unprepared audio modes are disabled rather than broken", availability.instrumental !== instrumentalPrepared, `instrumental ${availability.instrumental ? "disabled" : "enabled"}`);
    record("Availability is stated on the panel", availability.banner.includes("Karaoke: AVAILABLE"), availability.banner.split("\n").slice(0, 2).join(" | "));
    record("Guide instruments are offered", availability.guides.includes("piano:on") && availability.guides.includes("guitar:on"), availability.guides);

    const guide = await inPage<{ keys: number; frets: number; offText: string }>(`
      const press = (selector) => document.querySelector(selector).click();
      press("[data-guide='piano']");
      ${wait(200)}
      const keys = document.querySelectorAll(".learning-key").length;
      press("[data-guide='guitar']");
      ${wait(200)}
      const frets = document.querySelectorAll(".guitar-string button").length;
      press("[data-guide='off']");
      ${wait(200)}
      const offText = document.querySelector("[data-karaoke-visualizer]").innerText;
      press("[data-guide='piano']");
      ${wait(200)}
      return { keys, frets, offText };`);
    record("Piano guide renders a keyboard", guide.keys > 12, `${guide.keys} keys`);
    record("Guitar guide renders a fretboard", guide.frets > 12, `${guide.frets} frets`);
    record("Turning the guide off says so", guide.offText.toLowerCase().includes("off"), guide.offText.trim());

    const contrast = await inPage<{ pressed: string; idle: string; label: string }>(`
      const pressed = document.querySelector(".karaoke-controls button[aria-pressed='true']");
      const idle = document.querySelector(".karaoke-controls button[aria-pressed='false']");
      const paint = (element) => getComputedStyle(element).backgroundColor;
      return { pressed: paint(pressed), idle: paint(idle), label: pressed.textContent };`);
    record("The selected control looks different from an idle one", contrast.pressed !== contrast.idle, `${contrast.label}: ${contrast.pressed} vs ${contrast.idle}`);

    const scrolled = await inPage<{ maximum: number; overflow: string; visibleLines: number }>(`
      ${audioElement}
      window.scrollTo(0, 0);
      audio.currentTime = 0;
      await audio.play();
      let maximum = 0;
      for (let step = 0; step < 12; step += 1) { ${wait(250)} maximum = Math.max(maximum, window.scrollY); }
      audio.pause();
      const viewer = document.querySelector(".karaoke-viewer");
      return { maximum, overflow: getComputedStyle(viewer).overflow, visibleLines: [...document.querySelectorAll(".karaoke-line")].filter((line) => line.offsetParent !== null).length };`);
    record("The page never scrolls itself during playback", scrolled.maximum === 0, `max scrollY ${scrolled.maximum}`);
    record("The lyric viewport stays a compact few lines", scrolled.visibleLines > 0 && scrolled.visibleLines <= 3, `${scrolled.visibleLines} of ${lines} lines visible, overflow ${scrolled.overflow}`);

    const shot = path.join(output, "karaoke.png");
    await inPage(`${audioElement} audio.currentTime = 4.2; ${wait(400)} return true;`);
    await page.locator("#vocal-karaoke").screenshot({ path: shot });
    record("Karaoke preview captured", true, path.relative(repository, shot));
    const browserErrors = [...httpErrors, ...requestErrors, ...consoleErrors];
    record(
      "No console or page errors",
      browserErrors.length === 0,
      browserErrors.slice(0, 6).join(" | ") || "none",
    );
  } finally {
    await browser.close();
    if (!process.argv.includes("--keep-server")) await server.close();
  }

  console.table(checks.map((check) => ({ check: check.name, result: check.ok ? "PASS" : "FAIL", detail: check.detail })));
  const failed = checks.filter((check) => !check.ok);
  if (failed.length) { console.error(`${failed.length} browser check(s) failed.`); return 1; }
  console.log(`${checks.length} browser checks passed.`);
  return 0;
}

main().then((code) => { process.exitCode = code; }, (error: unknown) => { console.error(error instanceof Error ? error.message : error); process.exitCode = 1; });
