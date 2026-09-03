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

let dirty = false;
let hashGuardInstalled = false;

function value(text: string | null | undefined): string { return escapeHtml(text ?? ""); }
function localized(text: string | null): LocalizedText | null { return text ? { ka: text, en: text } : null; }
function numberValue(entry: FormDataEntryValue | null): number | null { const parsed = Number(entry); return entry && Number.isFinite(parsed) && parsed > 0 ? parsed : null; }

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
  return `<fieldset class="learning-admin"><legend>Interactive learning</legend><label class="admin-check"><input name="learning_enabled" type="checkbox" ${song.learningEnabled ? "checked" : ""} /> Enable learning mode</label><div class="learning-admin-options" role="group" aria-label="Learning instruments"><label><input name="learning_instrument" type="checkbox" value="piano" ${checked("piano")} /> Piano (88 keys)</label><label><input name="learning_instrument" type="checkbox" value="guitar" ${checked("guitar")} /> Guitar</label><label><input name="learning_instrument" type="checkbox" value="accordion" ${checked("accordion")} /> Accordion</label></div><label><span>Canonical source</span><select name="learning_source"><option value="musicxml" ${song.learningSource !== "midi" ? "selected" : ""}>MusicXML</option><option value="midi" ${song.learningSource === "midi" ? "selected" : ""}>MIDI</option></select></label><div class="admin-grid admin-textareas">${textarea("Part / hand mapping (JSON)", "learning_mapping", JSON.stringify(song.learningMapping ?? {}, null, 2), 7)}${textarea("Fingering overrides (JSON)", "learning_fingering", JSON.stringify(song.learningFingering ?? {}, null, 2), 7)}</div><button type="button" data-learning-preview>Validate learning configuration</button><p data-learning-preview-status aria-live="polite"></p></fieldset>`;
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
    root.innerHTML = `<main class="admin-route shell" id="main-content"><header class="admin-top"><div><p class="num">OWNER ONLY</p><h1>Composer archive</h1></div><div><a href="#top">Public site</a><button type="button" data-admin-logout>Sign out</button></div></header>${renderSongList(songs)}${editing ? renderEditor(editing) : ""}</main>`;
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
    root.querySelectorAll<HTMLButtonElement>("[data-admin-publish]").forEach((button) => button.addEventListener("click", async () => { const song = songs.find((entry) => entry.id === button.dataset.adminPublish); if (button.dataset.status === "published" && song) validateLearningPublication(song); await setSongStatus(button.dataset.adminPublish ?? "", button.dataset.status === "published" ? "published" : "draft"); songs = await loadAdminSongs(); renderDashboard(); }));
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
      form.addEventListener("input", () => { dirty = true; });
      form.addEventListener("submit", async (event) => { event.preventDefault(); try { await saveForm(form, editing!, root.querySelector<HTMLElement>("#admin-form-message")!); songs = await loadAdminSongs(); editing = songs.find((song) => song.slug === (form.elements.namedItem("slug") as HTMLInputElement).value) ?? null; window.setTimeout(renderDashboard, 650); } catch { /* Inline retry is available. */ } });
    }
  };
  renderDashboard();
}
