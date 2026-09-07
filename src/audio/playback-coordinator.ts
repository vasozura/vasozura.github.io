export interface CoordinatedTransport {
  canPlay(): boolean;
  isPlaying(): boolean;
  play(): void | Promise<void>;
  pause(): void;
  stop(): void;
}

export function ignoresTransportShortcut(target: EventTarget | null): boolean {
  const element = target as Element | null;
  return Boolean(element && typeof element.closest === "function" && element.closest("input, select, textarea, button, [contenteditable]"));
}

export class PlaybackCoordinator {
  private readonly transports = new Map<string, CoordinatedTransport>();
  private activeId: string | null = null;

  register(id: string, transport: CoordinatedTransport, activeByDefault = false): () => void {
    this.transports.set(id, transport);
    if (activeByDefault || !this.activeId) this.activeId = id;
    return () => {
      if (this.transports.get(id) !== transport) return;
      this.transports.delete(id);
      if (this.activeId === id) this.activeId = this.transports.keys().next().value ?? null;
    };
  }

  async play(id: string): Promise<void> {
    const target = this.transports.get(id);
    if (!target?.canPlay()) return;
    this.activate(id);
    await target.play();
  }

  activate(id: string): void {
    if (!this.transports.has(id)) return;
    for (const [otherId, transport] of this.transports) if (otherId !== id && transport.isPlaying()) transport.pause();
    this.activeId = id;
  }

  pause(id: string): void { this.transports.get(id)?.pause(); }
  stop(id: string): void { this.activeId = id; this.transports.get(id)?.stop(); }

  async toggleActive(): Promise<void> {
    const id = this.activeId;
    if (!id) return;
    const transport = this.transports.get(id);
    if (!transport?.canPlay()) return;
    if (transport.isPlaying()) transport.pause(); else await this.play(id);
  }

  stopActive(): void {
    if (this.activeId) this.transports.get(this.activeId)?.stop();
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
}

export const playbackCoordinator = new PlaybackCoordinator();
