export interface CoordinatedTransport {
  canPlay(): boolean;
  isPlaying(): boolean;
  play(): void | Promise<void>;
  pause(): void;
  stop(): void;
}

export interface PlaybackCoordinatorState { activeId: string | null; playing: boolean; }

export function ignoresTransportShortcut(target: EventTarget | null): boolean {
  const element = target as Element | null;
  return Boolean(element && typeof element.closest === "function" && element.closest("input, select, textarea, button, [contenteditable]"));
}

export class PlaybackCoordinator {
  private readonly transports = new Map<string, CoordinatedTransport>();
  private readonly listeners = new Set<(state: PlaybackCoordinatorState) => void>();
  private activeId: string | null = null;

  register(id: string, transport: CoordinatedTransport, activeByDefault = false): () => void {
    this.transports.set(id, transport);
    if (activeByDefault || !this.activeId) this.activeId = id;
    this.notify();
    return () => {
      if (this.transports.get(id) !== transport) return;
      this.transports.delete(id);
      if (this.activeId === id) this.activeId = this.transports.keys().next().value ?? null;
      this.notify();
    };
  }

  subscribe(listener: (state: PlaybackCoordinatorState) => void): () => void {
    this.listeners.add(listener);
    listener(this.snapshot());
    return () => this.listeners.delete(listener);
  }

  async play(id: string): Promise<void> {
    const target = this.transports.get(id);
    if (!target?.canPlay()) return;
    this.activate(id);
    await target.play();
    this.notify();
  }

  activate(id: string): void {
    if (!this.transports.has(id)) return;
    for (const [otherId, transport] of this.transports) if (otherId !== id && transport.isPlaying()) transport.pause();
    this.activeId = id;
    this.notify();
  }

  pause(id: string): void { this.transports.get(id)?.pause(); this.notify(); }
  stop(id: string): void { this.activeId = id; this.transports.get(id)?.stop(); this.notify(); }

  async toggleActive(): Promise<void> {
    const id = this.activeId;
    if (!id) return;
    const transport = this.transports.get(id);
    if (!transport?.canPlay()) return;
    if (transport.isPlaying()) { transport.pause(); this.notify(); } else await this.play(id);
  }

  stopActive(): void {
    if (this.activeId) { this.transports.get(this.activeId)?.stop(); this.notify(); }
  }

  handleKeydown(event: KeyboardEvent): void {
    if (event.defaultPrevented || event.repeat || ignoresTransportShortcut(event.target)) return;
    if (event.code === "Space" || event.key === " ") {
      event.preventDefault();
      void this.toggleActive();
    } else if (event.key === "Escape") {
      event.preventDefault();
      this.stopActive();
    }
  }

  private snapshot(): PlaybackCoordinatorState {
    return { activeId: this.activeId, playing: this.activeId ? this.transports.get(this.activeId)?.isPlaying() ?? false : false };
  }

  private notify(): void {
    const state = this.snapshot();
    this.listeners.forEach((listener) => listener(state));
  }
}

export const playbackCoordinator = new PlaybackCoordinator();
