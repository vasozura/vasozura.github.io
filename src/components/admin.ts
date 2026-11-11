import { appConfig } from "../config";
import { deleteSong, isCurrentUserAdmin, loadAdminSongs, saveSong, setSongStatus, updateLearningConfiguration, updateSongResources } from "../data/song-repository";
import { uploadSongFile } from "../data/storage-repository";
import { clearPasswordRecovery, isPasswordRecovery, requireSupabase } from "../lib/supabase";
import type { Difficulty, LocalizedText, Song } from "../types/song";
import { escapeHtml } from "../utils/escape-html";
import { cleanupLiteralNewlines, validateFile, type UploadFileType } from "../utils/file-validation";
import { extractYouTubeVideoId } from "../utils/youtube";
import { safeHttpUrl } from "../utils/safe-url";
import { parseLearningConfiguration, validateLearningPublication } from "../learning/admin-config";
import { inspectLearningReadiness, reprocessLearning } from "../learning/admin-readiness";
import { parseBatchManifest } from "../data/batch-manifest";
import JSZip from "jszip";

let dirty = false;
let hashGuardInstalled = false;

function value(text: string | null | undefined): string { return escapeHtml(text ?? ""); }
function localized(text: string | null): LocalizedText | null { return text ? { ka: text, en: text } : null; }
function numberValue(entry: FormDataEntryValue | null): number | null { const parsed = Number(entry); return entry && Number.isFinite(parsed) && parsed > 0 ? parsed : null; }
function readableError(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (error && typeof error === "object") {
    const record = error as Record<string, unknown>;
    return [record.message, record.details, record.hint, record.code].filter((entry) => typeof entry === "string" && entry).join(" · ") || JSON.stringify(error);
  }
  return String(error || "import failed");
}

function installUnsavedGuard(): void {
  window.onbeforeunload = () => dirty ? "Unsaved song changes will be lost." : undefined;
  if (hashGuardInstalled) return;
  window.addEventListener("hashchange", () => {
    if (!dirty || window.location.hash.startsWith("#/admin")) return;
    if (window.confirm("You have unsaved song changes. Leave this form?")) dirty = false;
    else window.location.hash = "#/admin";
  });
  hashGuardInstalled = true;
}

function emptySong(): Song {
  return { id: "new", slug: "", title: { ka: "", en: "" }, displayCredit: null, composer: null, lyricistOrPoet: null, translator: null, language: null, description: null, lyrics: null, coverUrl: null, audioUrl: null, midiUrl: null, musicXmlUrl: null, scorePdfUrl: null, sourceProjectUrl: null, sunoUrl: null, youtubeUrl: null, youtubeVideoId: null, durationSeconds: null, bpm: null, musicalKey: null, timeSignature: null, difficulty: null, publicationStatus: "draft", publicationDate: null };
}

function field(label: string, name: string, current: string | number | null | undefined, type = "text", extra = ""): string {
  return `<label><span>${label}</span><input name="${name}" type="${type}" value="${value(current === null || current === undefined ? "" : String(current))}" ${extra} /></label>`;
}

function textarea(label: string, name: string, current: string | null | undefined, rows = 5): string {
  return `<label><span>${label}</span><textarea name="${name}" rows="${rows}">${value(current)}</textarea></label>`;
}

function fileInput(label: string, name: string, accept: string, current: string | null): string {
  return `<label class="admin-file"><span>${label}</span><input name="${name}" type="file" accept="${accept}" />${current ? `<a href="${value(current)}" target="_blank" rel="noopener noreferrer">Current file ↗</a>` : ""}<progress data-upload-progress="${name}" max="100" value="0" hidden></progress><small data-file-error="${name}"></small></label>`;
}

function learningFields(song: Song): string {
  const instruments = song.learningInstruments ?? [];
  const checked = (name: string): string => instruments.includes(name as "piano" | "guitar" | "accordion") ? "checked" : "";
  return `<fieldset class="learning-admin"><legend>Interactive learning</legend><label class="admin-check"><input name="learning_enabled" type="checkbox" ${song.learningEnabled ? "checked" : ""} /> Enable learning mode</label><div class="learning-admin-options" role="group" aria-label="Learning instruments"><label><input name="learning_instrument" type="checkbox" value="piano" ${checked("piano")} /> Piano</label><label><input name="learning_instrument" type="checkbox" value="guitar" ${checked("guitar")} /> Guitar</label><label><input name="learning_instrument" type="checkbox" value="accordion" ${checked("accordion")} /> Accordion (verified mapping required)</label></div><label><span>Canonical source</span><select name="learning_source"><option value="musicxml" ${song.learningSource !== "midi" ? "selected" : ""}>MusicXML</option><option value="midi" ${song.learningSource === "midi" ? "selected" : ""}>MIDI</option></select></label><details class="admin-advanced"><summary>Advanced learning configuration</summary><p>Technical mapping is hidden during normal editing. Open only when instrument or fingering rules need manual correction.</p><div class="admin-grid admin-textareas">${textarea("Part / hand mapping", "learning_mapping", JSON.stringify(song.learningMapping ?? {}, null, 2), 7)}${textarea("Fingering overrides", "learning_fingering", JSON.stringify(song.learningFingering ?? {}, null, 2), 7)}</div></details><div class="admin-form-actions"><button type="button" data-learning-preview>Validate configuration</button>${song.id !== "new" && song.learningEnabled ? '<button type="button" data-learning-readiness>Check manifest readiness</button><button type="button" data-learning-reprocess>Reprocess safely</button>' : ""}</div><div data-learning-readiness-output></div><p data-learning-preview-status aria-live="polite"></p></fieldset>`;
}

function renderAdminOverview(songs: Song[]): string {
  const published = songs.filter((song) => song.publicationStatus === "published").length;
  const withAudio = songs.filter((song) => song.audioUrl).length;
  const withScore = songs.filter((song) => song.midiUrl || song.musicXmlUrl || song.scorePdfUrl).length;
  const incomplete = songs.filter((song) => !song.audioUrl || !song.coverUrl).length;
  return `<section class="admin-overview" aria-label="Archive overview"><article><span>All songs</span><strong>${songs.length}</strong><small>catalog records</small></article><article><span>Published</span><strong>${published}</strong><small>visible on website</small></article><article><span>Audio ready</span><strong>${withAudio}</strong><small>playable MP3 files</small></article><article><span>Score ready</span><strong>${withScore}</strong><small>MIDI, XML or PDF</small></article><article class="${incomplete ? "needs-attention" : ""}"><span>Needs review</span><strong>${incomplete}</strong><small>missing cover or audio</small></article></section>`;
}

function renderLogin(message = ""): string {
  if (!appConfig.hasSupabase) return `<main class="admin-route shell" id="main-content"><div class="admin-setup"><p class="num">OWNER ARCHIVE · SETUP REQUIRED</p><h1>Connect Supabase</h1><p>The administration code is ready, but browser credentials are not configured. Copy <code>.env.example</code> to <code>.env.local</code>, add the project URL and public anonymous key, then restart the local server.</p><a href="#top">Return to site</a></div></main>`;
  return `<main class="admin-route shell" id="main-content"><form class="admin-login" id="admin-login" method="post" action="#/admin"><p class="num">OWNER ACCESS</p><h1>Composer archive administration</h1>${message ? `<p class="form-message error">${escapeHtml(message)}</p>` : ""}${field("Owner email", "email", "", "email", "required autocomplete=\"email\"")}${field("Password", "password", "", "password", "required autocomplete=\"current-password\"")}<button class="admin-primary" type="submit">Sign in</button><a href="#top">Return to site</a></form></main>`;
}

function renderPasswordRecovery(message = "", success = false): string {
  return `<main class="admin-route shell" id="main-content"><form class="admin-login" id="password-recovery" method="post" action="#/admin"><p class="num">OWNER ACCESS · RECOVERY</p><h1>Set a new password</h1><p>Use a new, unique password with at least 12 characters.</p><p class="form-message ${success ? "success" : "error"}" id="recovery-message" aria-live="polite" ${message ? "" : "hidden"}>${escapeHtml(message)}</p>${field("New password", "new_password", "", "password", "required minlength=\"12\" autocomplete=\"new-password\"")}${field("Confirm new password", "confirm_password", "", "password", "required minlength=\"12\" autocomplete=\"new-password\"")}<button class="admin-primary" type="submit">Update password</button></form></main>`;
}

function renderSongList(songs: Song[]): string {
  return `<section class="admin-list" aria-labelledby="admin-list-title"><div class="admin-heading"><div><p class="num">DATABASE</p><h2 id="admin-list-title">Songs · ${songs.length}</h2></div><button class="admin-primary" type="button" data-admin-new>New song</button></div><div class="admin-table-wrap"><table><thead><tr><th>Title</th><th>Status</th><th>Resources</th><th>Actions</th></tr></thead><tbody>${songs.map((song) => `<tr><td><strong>${value(song.title.ka ?? song.title.en ?? song.slug)}</strong><small>${value(song.slug)}</small></td><td><span class="status-badge ${song.publicationStatus}">${song.publicationStatus}</span></td><td>${[song.audioUrl && "MP3", song.midiUrl && "MIDI", song.musicXmlUrl && "XML", song.scorePdfUrl && "PDF"].filter(Boolean).join(" · ") || "—"}</td><td><div class="admin-row-actions"><button type="button" data-admin-edit="${value(song.id)}">Edit</button><button type="button" data-admin-publish="${value(song.id)}" data-status="${song.publicationStatus === "published" ? "draft" : "published"}">${song.publicationStatus === "published" ? "Unpublish" : "Publish"}</button><button class="danger" type="button" data-admin-delete="${value(song.id)}">Delete</button></div></td></tr>`).join("")}</tbody></table></div></section>`;
}

function renderBatchPanel(): string {
  return `<section class="admin-list admin-batch" aria-labelledby="batch-title"><div class="admin-heading"><div><p class="num">BATCH · OWNER ONLY</p><h2 id="batch-title">Catalog onboarding</h2></div></div><p>Choose a validated batch manifest and its package ZIP. The dashboard uploads verified files with the active owner session and creates drafts; public publication remains separate.</p><div class="admin-grid"><label class="admin-file"><span>Batch manifest JSON</span><input type="file" accept="application/json,.json" data-batch-manifest /></label><label class="admin-file"><span>Package ZIP</span><input type="file" accept="application/zip,.zip" data-batch-packages /></label></div><progress data-batch-progress max="100" value="0" hidden></progress><div data-batch-result role="status" aria-live="polite">Select a manifest and package ZIP.</div><div class="admin-form-actions"><button type="button" data-batch-import disabled>Import validated packages as drafts</button><button type="button" data-batch-copy disabled>Copy validation-only command</button><button type="button" data-batch-resume disabled>Copy resume command</button></div><label class="admin-check"><input type="checkbox" data-batch-publication-confirm /> I reviewed every draft and its publication checklist</label><button type="button" data-batch-publish disabled>Batch publication disabled by default</button><p><small>Import is resumable: matching slugs and checksums are reused. Publication remains a separate confirmed action.</small></p></section>`;
}

function bindBatchPanel(root: HTMLElement): void {
  const input = root.querySelector<HTMLInputElement>("[data-batch-manifest]");
  const output = root.querySelector<HTMLElement>("[data-batch-result]");
  const progress = root.querySelector<HTMLProgressElement>("[data-batch-progress]");
  const copy = root.querySelector<HTMLButtonElement>("[data-batch-copy]");
  const resume = root.querySelector<HTMLButtonElement>("[data-batch-resume]");
  const packageInput = root.querySelector<HTMLInputElement>("[data-batch-packages]");
  const importButton = root.querySelector<HTMLButtonElement>("[data-batch-import]");
  const confirmation = root.querySelector<HTMLInputElement>("[data-batch-publication-confirm]");
  const publish = root.querySelector<HTMLButtonElement>("[data-batch-publish]");
  if (!input || !packageInput || !importButton || !output || !progress || !copy || !resume || !confirmation || !publish) return;
  let filename = "batch.json";
  let manifest: ReturnType<typeof parseBatchManifest>["manifest"] = null;
  let packageFiles: File[] = [];
  const refreshImport = (): void => { importButton.disabled = !manifest || packageFiles.length === 0; };
  const copyCommand = async (withResume: boolean): Promise<void> => {
    const command = `.\\scripts\\import-batch.ps1 -ManifestPath ".\\${filename}"${withResume ? " -Resume" : " -DryRun"}`;
    await navigator.clipboard.writeText(command);
    output.textContent = `${withResume ? "Resume" : "Validation-only"} PowerShell command copied.`;
  };
  input.addEventListener("change", async () => {
    const file = input.files?.[0];
    if (!file) return;
    filename = file.name.replace(/[^a-zA-Z0-9._-]/g, "-");
    progress.hidden = false; progress.value = 25;
    const readiness = parseBatchManifest(await file.text());
    manifest = readiness.manifest;
    progress.value = 100;
    output.className = readiness.valid ? "success" : "error";
    output.innerHTML = readiness.valid
      ? `Ready for local dry-run · ${readiness.manifest!.packages.length} package(s) · concurrency ${readiness.manifest!.concurrency ?? 2}. No production write occurred.`
      : readiness.errors.map((error) => `<p><strong>${value(error.song)}</strong>: ${value(error.message)}</p>`).join("");
    copy.disabled = !readiness.valid;
    resume.disabled = !readiness.valid;
    refreshImport();
  });
  packageInput.addEventListener("change", async () => {
    const archiveFile = packageInput.files?.[0];
    packageFiles = [];
    if (!archiveFile) { output.textContent = "Select a manifest and package ZIP."; refreshImport(); return; }
    output.textContent = "Reading package ZIP…";
    try {
      const archive = await JSZip.loadAsync(archiveFile);
      for (const [relativePath, entry] of Object.entries(archive.files)) {
        if (entry.dir) continue;
        const blob = await entry.async("blob");
        const mime = /\.mp3$/i.test(relativePath) ? "audio/mpeg" : /\.jpe?g$/i.test(relativePath) ? "image/jpeg" : /\.png$/i.test(relativePath) ? "image/png" : /\.webp$/i.test(relativePath) ? "image/webp" : /\.json$/i.test(relativePath) ? "application/json" : "text/plain";
        const file = new File([blob], relativePath.replace(/\\/g, "/").split("/").pop() ?? "package-file", { type: mime });
        Object.defineProperty(file, "relativePath", { value: relativePath.replace(/\\/g, "/") });
        packageFiles.push(file);
      }
      output.textContent = `${packageFiles.length} package file(s) loaded from ZIP.`;
    } catch (error) {
      output.className = "error"; output.textContent = error instanceof Error ? error.message : "Unable to read package ZIP.";
    }
    refreshImport();
  });
  importButton.addEventListener("click", async () => {
    if (!manifest) return;
    importButton.disabled = true; input.disabled = true; packageInput.disabled = true;
    progress.hidden = false; progress.value = 0;
    let completed = 0; const failures: string[] = [];
    const packagePaths = (packagePath: string): string[] => {
      const normalized = packagePath.replace(/\\/g, "/").toLowerCase();
      return [normalized, normalized.replace(/^packages\//, "")];
    };
    const locate = (packagePath: string, name: string): File | undefined => {
      const suffixes = packagePaths(packagePath).map((candidate) => `${candidate}/${name.toLowerCase()}`);
      return packageFiles.find((file) => suffixes.some((suffix) => String((file as File & { relativePath?: string }).relativePath ?? file.webkitRelativePath ?? file.name).replace(/\\/g, "/").toLowerCase().endsWith(suffix)));
    };
    for (const entry of manifest.packages) {
      try {
        const metadataFile = locate(entry.path, "metadata.json");
        const audio = locate(entry.path, "audio.mp3");
        const lyrics = locate(entry.path, "lyrics-ka.txt");
        const cover = packageFiles.find((file) => packagePaths(entry.path).some((candidate) => new RegExp(`${candidate.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}/cover\\.(?:jpe?g|png|webp)$`, "i").test(String((file as File & { relativePath?: string }).relativePath ?? file.webkitRelativePath ?? file.name).replace(/\\/g, "/"))));
        if (!metadataFile || !audio || !lyrics || !cover) throw new Error("metadata, audio, lyrics or cover is missing");
        const metadata = JSON.parse(await metadataFile.text()) as Record<string, unknown>;
        if (metadata.slug !== entry.expectedSlug || metadata.status !== "draft") throw new Error("manifest and metadata identity differ");
        const base = emptySong();
        const draft: Song = { ...base, slug: String(metadata.slug), title: { ka: String(metadata.title_ka), en: String(metadata.title_en) }, displayCredit: localized(typeof metadata.display_credit === "string" ? metadata.display_credit : null), language: typeof metadata.language === "string" ? metadata.language : null, lyrics: { ka: cleanupLiteralNewlines(await lyrics.text()), en: null }, sunoUrl: typeof metadata.suno_url === "string" ? safeHttpUrl(metadata.suno_url) : null, durationSeconds: typeof metadata.duration_seconds === "number" ? Math.round(metadata.duration_seconds) : null };
        const saved = await saveSong(draft);
        const resources: Partial<Record<ResourceColumn, string>> = {};
        for (const [fileType, file, column] of [["audio", audio, "audio_url"], ["cover", cover, "cover_url"], ["lyrics", lyrics, null]] as const) {
          const uploaded = await uploadSongFile(saved.id, saved.slug, fileType, file, () => undefined);
          if (column) resources[column] = uploaded.publicUrl;
        }
        await updateSongResources(saved.id, resources);
      } catch (error) {
        failures.push(`${entry.expectedSlug}: ${readableError(error)}`);
      }
      completed++; progress.value = Math.round((completed / manifest.packages.length) * 100);
      output.textContent = `Imported ${completed - failures.length}/${manifest.packages.length} · failed ${failures.length}`;
    }
    output.className = failures.length ? "error" : "success";
    output.innerHTML = failures.length ? `<strong>Imported ${completed - failures.length}/${manifest.packages.length}</strong>${failures.slice(0, 20).map((failure) => `<p>${value(failure)}</p>`).join("")}` : `<strong>Imported ${completed}/${manifest.packages.length} drafts successfully.</strong>`;
    input.disabled = false; packageInput.disabled = false; refreshImport();
  });
  copy.addEventListener("click", () => { void copyCommand(false); });
  resume.addEventListener("click", () => { void copyCommand(true); });
  confirmation.addEventListener("change", () => { publish.disabled = true; publish.textContent = confirmation.checked ? "Use the reviewed per-song Publish action" : "Batch publication disabled by default"; });
}

function renderEditor(song: Song): string {
  return `<section class="admin-editor" aria-labelledby="editor-title"><div class="admin-heading"><div><p class="num">${song.id === "new" ? "CREATE" : "EDIT"}</p><h2 id="editor-title">${song.id === "new" ? "New song" : value(song.title.ka ?? song.slug)}</h2></div><button type="button" data-admin-close>Close editor</button></div><form id="song-form" novalidate><input type="hidden" name="id" value="${value(song.id)}" /><div class="admin-grid">${field("Slug *", "slug", song.slug, "text", "required pattern=\"[a-z0-9]+(?:-[a-z0-9]+)*\"")}${field("Status", "status", song.publicationStatus, "text", "readonly")}${field("Georgian title *", "title_ka", song.title.ka, "text", "required")}${field("English title *", "title_en", song.title.en, "text", "required")}${field("Display credit", "display_credit", song.displayCredit?.ka)}${field("Composer", "composer", song.composer?.ka)}${field("Poet / lyricist", "lyricist", song.lyricistOrPoet?.ka)}${field("Translator", "translator", song.translator?.ka)}${field("Language", "language", song.language)}${field("BPM", "bpm", song.bpm, "number", "min=\"1\" max=\"400\"")}${field("Musical key", "musical_key", song.musicalKey)}${field("Time signature", "time_signature", song.timeSignature)}<label><span>Difficulty</span><select name="difficulty"><option value="">Not specified</option>${["beginner", "intermediate", "advanced"].map((difficulty) => `<option value="${difficulty}" ${song.difficulty === difficulty ? "selected" : ""}>${difficulty}</option>`).join("")}</select></label>${field("Duration (seconds)", "duration_seconds", song.durationSeconds, "number", "min=\"1\"")}${field("Suno URL", "suno_url", song.sunoUrl, "url")}${field("YouTube URL", "youtube_url", song.youtubeUrl, "url")}<label><span>YouTube video ID</span><input name="youtube_video_id" value="${value(song.youtubeVideoId)}" readonly /></label></div><div class="admin-grid admin-textareas">${textarea("Georgian description", "description_ka", song.description?.ka)}${textarea("English description", "description_en", song.description?.en)}${textarea("Georgian lyrics", "lyrics_ka", song.lyrics?.ka, 12)}${textarea("English lyrics", "lyrics_en", song.lyrics?.en, 12)}</div><fieldset><legend>Files</legend><div class="admin-grid">${fileInput("Cover (JPG, PNG, WebP · 5 MB)", "cover", "image/jpeg,image/png,image/webp", song.coverUrl)}${fileInput("MP3 audio · 100 MB", "audio", ".mp3,audio/mpeg", song.audioUrl)}${fileInput("MIDI · 5 MB", "midi", ".mid,.midi", song.midiUrl)}${fileInput("MusicXML / MXL · 20 MB", "musicxml", ".musicxml,.xml,.mxl", song.musicXmlUrl)}${fileInput("PDF score · 25 MB", "score_pdf", ".pdf,application/pdf", song.scorePdfUrl)}${fileInput("MuseScore source · 50 MB", "source_project", ".mscz", song.sourceProjectUrl)}${fileInput("Georgian lyrics TXT · 1 MB", "lyrics_ka_file", ".txt,text/plain", null)}${fileInput("English lyrics TXT · 1 MB", "lyrics_en_file", ".txt,text/plain", null)}</div><div class="admin-previews">${song.coverUrl ? `<img src="${value(song.coverUrl)}" alt="Current cover preview" />` : `<img data-cover-preview alt="New cover preview" hidden />`}${song.audioUrl ? `<audio controls preload="metadata" src="${value(song.audioUrl)}"></audio>` : `<audio data-audio-preview controls hidden></audio>`}</div></fieldset>${learningFields(song)}<div class="form-message" id="admin-form-message" aria-live="polite"></div><div class="admin-form-actions"><button class="admin-primary" type="submit">Save song and files</button><button type="button" data-admin-close>Cancel</button></div></form></section>`;
}

function songFromForm(form: HTMLFormElement, existing: Song): Song {
  const data = new FormData(form);
  const text = (name: string): string | null => String(data.get(name) ?? "").trim() || null;
  const youtubeUrl = text("youtube_url");
  const youtubeId = youtubeUrl ? extractYouTubeVideoId(youtubeUrl) : null;
  if (youtubeUrl && !youtubeId) throw new Error("Enter a valid YouTube watch, short, live, embed, or youtu.be URL.");
  const sunoUrl = text("suno_url");
  if (sunoUrl && !safeHttpUrl(sunoUrl)) throw new Error("Suno URL must use HTTPS.");
  const slug = text("slug") ?? "";
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)) throw new Error("Slug may contain lowercase letters, numbers and single hyphens only.");
  const titleKa = text("title_ka");
  const titleEn = text("title_en");
  if (!titleKa || !titleEn) throw new Error("Both Georgian and English titles are required.");
  return { ...existing, slug, title: { ka: titleKa, en: titleEn }, displayCredit: localized(text("display_credit")), composer: localized(text("composer")), lyricistOrPoet: localized(text("lyricist")), translator: localized(text("translator")), language: text("language"), description: { ka: text("description_ka"), en: text("description_en") }, lyrics: { ka: cleanupLiteralNewlines(text("lyrics_ka") ?? "") || null, en: cleanupLiteralNewlines(text("lyrics_en") ?? "") || null }, durationSeconds: numberValue(data.get("duration_seconds")), bpm: numberValue(data.get("bpm")), musicalKey: text("musical_key"), timeSignature: text("time_signature"), difficulty: (text("difficulty") as Difficulty) ?? null, sunoUrl: safeHttpUrl(sunoUrl), youtubeUrl, youtubeVideoId: youtubeId };
}

type ResourceColumn = "cover_url" | "audio_url" | "midi_url" | "musicxml_url" | "score_pdf_url" | "source_project_url";

const fileFields: Array<{ name: string; type: UploadFileType; column: ResourceColumn | null }> = [
  { name: "cover", type: "cover", column: "cover_url" }, { name: "audio", type: "audio", column: "audio_url" }, { name: "midi", type: "midi", column: "midi_url" }, { name: "musicxml", type: "musicxml", column: "musicxml_url" }, { name: "score_pdf", type: "score_pdf", column: "score_pdf_url" }, { name: "source_project", type: "source_project", column: "source_project_url" },
  { name: "lyrics_ka_file", type: "lyrics", column: null }, { name: "lyrics_en_file", type: "lyrics", column: null },
];

async function saveForm(form: HTMLFormElement, existing: Song, message: HTMLElement): Promise<void> {
  const submit = form.querySelector<HTMLButtonElement>('button[type="submit"]')!;
  submit.disabled = true;
  message.className = "form-message";
  message.textContent = "Saving song…";
  try {
    for (const [fileName, textareaName] of [["lyrics_ka_file", "lyrics_ka"], ["lyrics_en_file", "lyrics_en"]] as const) {
      const file = (form.elements.namedItem(fileName) as HTMLInputElement).files?.[0];
      if (!file) continue;
      const issues = validateFile(file, "lyrics");
      if (issues.length) throw new Error(`${fileName}: ${issues.join(" ")}`);
      (form.elements.namedItem(textareaName) as HTMLTextAreaElement).value = cleanupLiteralNewlines(await file.text());
    }
    const learning = parseLearningConfiguration(new FormData(form));
    const saved = await saveSong(songFromForm(form, existing));
    const learningConfigured = existing.learningEnabled !== undefined || learning.enabled || learning.instruments.length > 0 || Object.keys(learning.mapping).length > 0 || Object.keys(learning.fingering).length > 0;
    if (learningConfigured) await updateLearningConfiguration(saved.id, { learningEnabled: learning.enabled, learningInstruments: learning.instruments, learningSource: learning.source, learningMapping: learning.mapping, learningFingering: learning.fingering });
    const resources: Partial<Record<ResourceColumn, string>> = {};
    for (const field of fileFields) {
      const input = form.elements.namedItem(field.name) as HTMLInputElement;
      const file = input.files?.[0];
      if (!file) continue;
      const issues = validateFile(file, field.type);
      if (issues.length) throw new Error(`${field.name}: ${issues.join(" ")}`);
      const progress = form.querySelector<HTMLProgressElement>(`[data-upload-progress="${field.name}"]`)!;
      progress.hidden = false;
      const uploaded = await uploadSongFile(saved.id, saved.slug, field.type, file, (percent) => { progress.value = percent; });
      if (field.column) resources[field.column] = uploaded.publicUrl;
      message.textContent = uploaded.duplicate ? `${file.name} already exists; reusing it.` : `${file.name} uploaded.`;
    }
    if (Object.keys(resources).length) await updateSongResources(saved.id, resources);
    dirty = false;
    message.className = "form-message success";
    message.textContent = "Song saved successfully.";
  } catch (error) {
    message.className = "form-message error";
    message.innerHTML = `${escapeHtml(error instanceof Error ? error.message : "Save failed.")} <button type="submit">Retry</button>`;
    throw error;
  } finally { submit.disabled = false; }
}

function bindPreviews(form: HTMLFormElement): void {
  const cover = form.elements.namedItem("cover") as HTMLInputElement;
  const audio = form.elements.namedItem("audio") as HTMLInputElement;
  cover.addEventListener("change", () => { const file = cover.files?.[0]; const preview = form.querySelector<HTMLImageElement>("[data-cover-preview]"); if (file && preview) { preview.src = URL.createObjectURL(file); preview.hidden = false; } });
  audio.addEventListener("change", () => { const file = audio.files?.[0]; const preview = form.querySelector<HTMLAudioElement>("[data-audio-preview]"); if (file && preview) { preview.src = URL.createObjectURL(file); preview.hidden = false; } });
  const youtube = form.elements.namedItem("youtube_url") as HTMLInputElement;
  const id = form.elements.namedItem("youtube_video_id") as HTMLInputElement;
  youtube.addEventListener("input", () => { id.value = extractYouTubeVideoId(youtube.value) ?? ""; });
}

export async function mountAdmin(root: HTMLElement): Promise<void> {
  installUnsavedGuard();
  if (!appConfig.hasSupabase) { root.innerHTML = renderLogin(); return; }
  const supabase = requireSupabase();
  if (isPasswordRecovery()) {
    root.innerHTML = renderPasswordRecovery();
    root.querySelector<HTMLFormElement>("#password-recovery")?.addEventListener("submit", async (event) => {
      event.preventDefault();
      const form = event.currentTarget as HTMLFormElement;
      const data = new FormData(form);
      const password = String(data.get("new_password") ?? "");
      const confirmation = String(data.get("confirm_password") ?? "");
      const message = form.querySelector<HTMLElement>("#recovery-message")!;
      const showError = (text: string): void => { message.hidden = false; message.textContent = text; };
      if (password.length < 12) { showError("Password must contain at least 12 characters."); return; }
      if (password !== confirmation) { showError("The passwords do not match."); return; }
      const submit = form.querySelector<HTMLButtonElement>('button[type="submit"]')!;
      submit.disabled = true;
      const { error } = await supabase.auth.updateUser({ password });
      if (error) { submit.disabled = false; showError(error.message); return; }
      clearPasswordRecovery();
      await supabase.auth.signOut();
      window.history.replaceState(null, "", `${window.location.pathname}${window.location.search}#/admin`);
      root.innerHTML = renderLogin("Password updated. Sign in with the new password.");
    });
    return;
  }
  const { data } = await supabase.auth.getSession();
  if (!data.session) {
    root.innerHTML = renderLogin();
    root.querySelector<HTMLFormElement>("#admin-login")?.addEventListener("submit", async (event) => {
      event.preventDefault();
      const form = event.currentTarget as HTMLFormElement;
      const formData = new FormData(form);
      const { error } = await supabase.auth.signInWithPassword({ email: String(formData.get("email")), password: String(formData.get("password")) });
      if (error) root.innerHTML = renderLogin(error.message); else await mountAdmin(root);
    });
    return;
  }

  if (!await isCurrentUserAdmin()) {
    root.innerHTML = `<main class="admin-route shell" id="main-content"><div class="admin-setup"><p class="num">ACCESS DENIED</p><h1>This account is not an archive administrator.</h1><p>Add this user ID to <code>admin_profiles</code> through the Supabase dashboard, then sign in again.</p><button type="button" data-admin-logout>Sign out</button></div></main>`;
    root.querySelector("[data-admin-logout]")?.addEventListener("click", async () => { await supabase.auth.signOut(); await mountAdmin(root); });
    return;
  }

  let songs = await loadAdminSongs();
  let editing: Song | null = null;
  const renderDashboard = (): void => {
    root.innerHTML = `<main class="admin-route shell" id="main-content"><header class="admin-top"><div><p class="num">OWNER DASHBOARD</p><h1>Composer archive</h1><p class="admin-intro">Manage songs, verify their files and publish only complete catalog entries.</p></div><div><a href="#top">Public site</a><button type="button" data-admin-logout>Sign out</button></div></header>${renderAdminOverview(songs)}${renderSongList(songs)}${renderBatchPanel()}${editing ? renderEditor(editing) : ""}</main>`;
    bindBatchPanel(root);
    if (editing?.publicationStatus === "draft") {
      const heading = root.querySelector<HTMLElement>(".admin-editor .admin-heading");
      const preview = document.createElement("a");
      preview.className = "admin-preview-link";
      preview.href = `#/admin/songs/${encodeURIComponent(editing.slug)}/preview`;
      preview.textContent = "Preview draft";
      heading?.append(preview);
    }
    root.querySelector("[data-admin-logout]")?.addEventListener("click", async () => { dirty = false; await supabase.auth.signOut(); await mountAdmin(root); });
    root.querySelector("[data-admin-new]")?.addEventListener("click", () => { editing = emptySong(); renderDashboard(); });
    root.querySelectorAll<HTMLButtonElement>("[data-admin-edit]").forEach((button) => button.addEventListener("click", () => { editing = songs.find((song) => song.id === button.dataset.adminEdit) ?? null; renderDashboard(); }));
    root.querySelectorAll<HTMLButtonElement>("[data-admin-publish]").forEach((button) => button.addEventListener("click", async () => {
      const song = songs.find((entry) => entry.id === button.dataset.adminPublish);
      button.disabled = true;
      try {
        if (button.dataset.status === "published" && song) {
          validateLearningPublication(song);
          const readiness = await inspectLearningReadiness(song);
          if (!readiness.ready) throw new Error(`Publication blocked: ${readiness.problems.join(" ")}`);
        }
        await setSongStatus(button.dataset.adminPublish ?? "", button.dataset.status === "published" ? "published" : "draft", Boolean(song?.learningEnabled));
        songs = await loadAdminSongs(); renderDashboard();
      } catch (error) {
        const message = error instanceof Error
          ? error.message
          : typeof error === "object" && error && "message" in error
            ? String(error.message)
            : "Publication failed.";
        window.alert(message);
        button.disabled = false;
      }
    }));
    root.querySelectorAll<HTMLButtonElement>("[data-admin-delete]").forEach((button) => button.addEventListener("click", async () => { const song = songs.find((entry) => entry.id === button.dataset.adminDelete); if (!song || !window.confirm(`Delete “${song.title.ka ?? song.slug}” and all of its uploaded files? This cannot be undone.`)) return; await deleteSong(song.id); songs = await loadAdminSongs(); renderDashboard(); }));
    root.querySelectorAll("[data-admin-close]").forEach((button) => button.addEventListener("click", () => { if (dirty && !window.confirm("Discard unsaved changes?")) return; dirty = false; editing = null; renderDashboard(); }));
    const form = root.querySelector<HTMLFormElement>("#song-form");
    if (form && editing) {
      bindPreviews(form);
      form.querySelector("[data-learning-preview]")?.addEventListener("click", () => {
        const status = form.querySelector<HTMLElement>("[data-learning-preview-status]")!;
        try { const config = parseLearningConfiguration(new FormData(form)); status.textContent = `Valid: ${config.instruments.join(", ") || "disabled"}; ${config.source} source.`; status.className = "success"; }
        catch (error) { status.textContent = error instanceof Error ? error.message : "Invalid learning configuration."; status.className = "error"; }
      });
      form.querySelector<HTMLButtonElement>("[data-learning-readiness]")?.addEventListener("click", async (event) => {
        const button = event.currentTarget as HTMLButtonElement;
        const output = form.querySelector<HTMLElement>("[data-learning-readiness-output]")!;
        button.disabled = true; output.textContent = "Checking canonical resources and manifest…";
        try {
          const readiness = await inspectLearningReadiness(editing!);
          output.className = readiness.ready ? "success" : "error";
          output.textContent = readiness.ready && readiness.versions
            ? `Ready · manifest ${readiness.manifestKey} · checksum ${readiness.checksum?.slice(0, 12)}… · schema ${readiness.versions.schema} · parser ${readiness.versions.parser} · mapping ${readiness.versions.mapping}. Synchronization confidence is verified in Preview.`
            : `Not ready · ${readiness.problems.join(" ")}`;
        } finally { button.disabled = false; }
      });
      form.querySelector<HTMLButtonElement>("[data-learning-reprocess]")?.addEventListener("click", async (event) => {
        const button = event.currentTarget as HTMLButtonElement;
        const output = form.querySelector<HTMLElement>("[data-learning-readiness-output]")!;
        if (!window.confirm("Reprocess the existing canonical source? Identical checksums reuse the current manifest.")) return;
        button.disabled = true; output.textContent = "Processing canonical score…";
        try { await reprocessLearning(editing!); output.className = "success"; output.textContent = "Processing complete. Run readiness check to verify the manifest."; }
        catch (error) { output.className = "error"; output.textContent = error instanceof Error ? error.message : "Processing failed."; }
        finally { button.disabled = false; }
      });
      form.addEventListener("input", () => { dirty = true; });
      form.addEventListener("submit", async (event) => { event.preventDefault(); try { await saveForm(form, editing!, root.querySelector<HTMLElement>("#admin-form-message")!); songs = await loadAdminSongs(); editing = songs.find((song) => song.slug === (form.elements.namedItem("slug") as HTMLInputElement).value) ?? null; window.setTimeout(renderDashboard, 650); } catch { /* Inline retry is available. */ } });
    }
  };
  renderDashboard();
}
