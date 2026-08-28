import { localize, type Language } from "../i18n";
import type { Song } from "../types/song";

type RepeatMode = "off" | "all" | "one";
interface PersistedPlayerState { queue: string[]; currentId: string | null; position: number; volume: number; shuffle: boolean; repeat: RepeatMode; }

const storageKey = "zura-player-state-v1";

export class PlayerController {
  private readonly audio = new Audio();
  private songs: Song[] = [];
  private queue: string[] = [];
  private currentId: string | null = null;
  private shuffle = false;
  private repeat: RepeatMode = "off";
  private root: HTMLElement | null = null;
  private language: Language = "ka";
  private restoredPosition = 0;
  private lastPersistedSecond = 0;

  constructor() {
    this.audio.preload = "metadata";
    this.restore();
    this.audio.addEventListener("timeupdate", () => { this.updateUi(); if (Math.abs(this.audio.currentTime - this.lastPersistedSecond) >= 5) { this.lastPersistedSecond = this.audio.currentTime; this.persist(); } });
    this.audio.addEventListener("durationchange", () => this.updateUi());
    this.audio.addEventListener("play", () => this.updateUi());
    this.audio.addEventListener("pause", () => this.updateUi());
    this.audio.addEventListener("ended", () => this.handleEnded());
  }

  bind(root: HTMLElement, songs: Song[], language: Language): void {
    this.root = root;
    this.songs = songs.filter((song) => Boolean(song.audioUrl));
    this.language = language;
    this.queue = this.queue.filter((id) => this.songs.some((song) => song.id === id));
    if (!this.queue.length) this.queue = this.songs.map((song) => song.id);
    const restoredSong = this.songs.find((song) => song.id === this.currentId);
    if (restoredSong?.audioUrl && !this.audio.src) {
      this.audio.src = restoredSong.audioUrl;
      this.audio.addEventListener("loadedmetadata", () => { this.audio.currentTime = Math.min(this.restoredPosition, Number.isFinite(this.audio.duration) ? this.audio.duration : this.restoredPosition); this.updateUi(); }, { once: true });
    }
    root.querySelectorAll<HTMLButtonElement>("[data-play-song]").forEach((button) => button.addEventListener("click", () => void this.playSong(button.dataset.playSong ?? "")));
    root.querySelector<HTMLButtonElement>("#player-play")?.addEventListener("click", () => void this.toggle());
    root.querySelector<HTMLButtonElement>("#player-prev")?.addEventListener("click", () => void this.previous());
    root.querySelector<HTMLButtonElement>("#player-next")?.addEventListener("click", () => void this.next());
    root.querySelector<HTMLButtonElement>("#player-shuffle")?.addEventListener("click", () => { this.shuffle = !this.shuffle; this.persist(); this.updateUi(); });
    root.querySelector<HTMLButtonElement>("#player-repeat")?.addEventListener("click", () => { this.repeat = this.repeat === "off" ? "all" : this.repeat === "all" ? "one" : "off"; this.persist(); this.updateUi(); });
    root.querySelector<HTMLInputElement>("#player-seek")?.addEventListener("input", (event) => { this.audio.currentTime = Number((event.target as HTMLInputElement).value); });
    root.querySelector<HTMLInputElement>("#player-volume")?.addEventListener("input", (event) => { this.audio.volume = Number((event.target as HTMLInputElement).value); this.persist(); });
    root.querySelectorAll<HTMLButtonElement>("[data-queue-song]").forEach((button) => button.addEventListener("click", () => void this.playSong(button.dataset.queueSong ?? "")));
    this.updateUi();
  }

  async playSong(id: string): Promise<void> {
    const song = this.songs.find((entry) => entry.id === id);
    if (!song?.audioUrl) return;
    if (this.currentId !== id || this.audio.src !== new URL(song.audioUrl, location.href).href) {
      this.currentId = id;
      this.audio.src = song.audioUrl;
      this.audio.currentTime = 0;
    }
    await this.audio.play();
    this.persist();
    this.updateUi();
  }

  private async toggle(): Promise<void> {
    if (!this.currentId && this.queue[0]) return this.playSong(this.queue[0]);
    if (this.audio.paused) await this.audio.play(); else this.audio.pause();
  }

  private async previous(): Promise<void> {
    if (this.audio.currentTime > 5) { this.audio.currentTime = 0; return; }
    await this.move(-1);
  }

  private async next(): Promise<void> { await this.move(1); }

  private async move(direction: number): Promise<void> {
    if (!this.queue.length) return;
    if (this.shuffle && this.queue.length > 1) {
      const choices = this.queue.filter((id) => id !== this.currentId);
      return this.playSong(choices[Math.floor(Math.random() * choices.length)]);
    }
    const currentIndex = Math.max(0, this.queue.indexOf(this.currentId ?? ""));
    let nextIndex = currentIndex + direction;
    if (nextIndex < 0 || nextIndex >= this.queue.length) {
      if (this.repeat !== "all") { this.audio.pause(); return; }
      nextIndex = (nextIndex + this.queue.length) % this.queue.length;
    }
    await this.playSong(this.queue[nextIndex]);
  }

  private handleEnded(): void {
    if (this.repeat === "one") { this.audio.currentTime = 0; void this.audio.play(); }
    else void this.next();
  }

  private updateUi(): void {
    if (!this.root) return;
    const current = this.songs.find((song) => song.id === this.currentId);
    const title = current ? localize(current.title, this.language) ?? current.slug : (this.language === "ka" ? "აირჩიეთ MP3 ჩანაწერი" : "Choose an MP3 release");
    const duration = Number.isFinite(this.audio.duration) ? this.audio.duration : 0;
    const seek = this.root.querySelector<HTMLInputElement>("#player-seek");
    if (seek) { seek.max = String(duration); seek.value = String(Math.min(this.audio.currentTime, duration)); }
    const volume = this.root.querySelector<HTMLInputElement>("#player-volume");
    if (volume) volume.value = String(this.audio.volume);
    const play = this.root.querySelector<HTMLButtonElement>("#player-play");
    if (play) { play.textContent = this.audio.paused ? "▶" : "Ⅱ"; play.setAttribute("aria-label", this.audio.paused ? "Play" : "Pause"); play.disabled = !this.songs.length; }
    const name = this.root.querySelector<HTMLElement>("#player-track");
    if (name) name.textContent = title;
    const shuffle = this.root.querySelector<HTMLButtonElement>("#player-shuffle");
    if (shuffle) shuffle.setAttribute("aria-pressed", String(this.shuffle));
    const repeat = this.root.querySelector<HTMLButtonElement>("#player-repeat");
    if (repeat) { repeat.dataset.mode = this.repeat; repeat.setAttribute("aria-label", `Repeat: ${this.repeat}`); repeat.setAttribute("aria-pressed", String(this.repeat !== "off")); }
  }

  private persist(): void {
    const state: PersistedPlayerState = { queue: this.queue, currentId: this.currentId, position: this.audio.currentTime, volume: this.audio.volume, shuffle: this.shuffle, repeat: this.repeat };
    try { localStorage.setItem(storageKey, JSON.stringify(state)); } catch { /* Playback still works without storage. */ }
  }

  private restore(): void {
    try {
      const state = JSON.parse(localStorage.getItem(storageKey) ?? "null") as PersistedPlayerState | null;
      if (!state) return;
      this.queue = Array.isArray(state.queue) ? state.queue : [];
      this.currentId = typeof state.currentId === "string" ? state.currentId : null;
      this.restoredPosition = typeof state.position === "number" && state.position > 0 ? state.position : 0;
      this.audio.volume = typeof state.volume === "number" ? Math.min(1, Math.max(0, state.volume)) : 1;
      this.shuffle = Boolean(state.shuffle);
      this.repeat = ["off", "all", "one"].includes(state.repeat) ? state.repeat : "off";
    } catch { /* Ignore invalid stored state. */ }
  }
}
