import type { NoteEvent } from "./contracts";
import type { CanonicalScheduler, SchedulerFrame } from "./scheduler";
import { SampleInstrumentEngine, type InstrumentName, type InstrumentPlayback } from "../audio/sample-instrument";
import { selectPlaybackNotes, type PlaybackSelection } from "./playback-selection";
import { activeHarmonyAt, type HarmonicEvent } from "./harmony";
import { selectLaneNotes, type VoiceLane } from "./voice-lanes";

export class SchedulerAudioAdapter {
  private played = new Set<string>();
  private lastBeat = -1;
  private lastPosition = 0;
  private metronome = false;
  private selection: PlaybackSelection = { mode: "chords", voices: 1, scope: "both" };
  private lanes: VoiceLane[] = [];
  private selectedLaneIds = new Set<string>();
  private harmonies: HarmonicEvent[] = [];
  private selected: NoteEvent[] = [];
  private readonly frame = (event: Event): void => this.render((event as CustomEvent<SchedulerFrame>).detail);

  constructor(
    private scheduler: CanonicalScheduler,
    private readonly instrument: InstrumentPlayback = new SampleInstrumentEngine(),
  ) { scheduler.addEventListener("frame", this.frame); }

  async enable(): Promise<void> {
    await this.instrument.enable(this.scheduler.timeline.notes.map((note) => note.midi));
  }

  setMetronome(enabled: boolean): void { this.metronome = enabled; }
  setInstrument(instrument: InstrumentName): void { this.instrument.setInstrument(instrument); this.reset(); }
  setSelection(selection: PlaybackSelection, lanes: VoiceLane[] = this.lanes, selectedLaneIds: ReadonlySet<string> = this.selectedLaneIds): void { this.selection = selection; this.lanes = lanes; this.selectedLaneIds = new Set(selectedLaneIds); this.reset(); }
  setHarmonicTimeline(harmonies: HarmonicEvent[]): void { this.harmonies = harmonies; this.reset(); }
  selectNotes(notes: NoteEvent[]): NoteEvent[] {
    if (this.selection.mode === "chords") return this.selected;
    if (this.lanes.length) return selectLaneNotes(notes, this.lanes, this.selectedLaneIds);
    return selectPlaybackNotes(notes, this.selection);
  }
  reset(): void { this.played.clear(); this.lastBeat = -1; this.lastPosition = 0; this.instrument.releaseAll(); }

  destroy(): void {
    this.scheduler.removeEventListener("frame", this.frame);
    this.instrument.destroy();
  }

  private render(frame: SchedulerFrame): void {
    if (frame.position + 0.01 < this.lastPosition) {
      this.played.clear();
      this.instrument.releaseAll();
    }
    this.selected = this.selection.mode === "chords" ? this.chordNotes(frame.position) : this.selectNotes(frame.active);
    this.selected.forEach((note) => { if (!this.played.has(note.id)) { this.played.add(note.id); this.sound(note, frame.tempoPercent); } });
    const beatLength = 60 / (this.scheduler.timeline.tempos[0]?.bpm ?? 120);
    const beat = frame.measure ? frame.measure.index * frame.measure.beats + Math.floor(frame.beat) : Math.floor(frame.position / beatLength);
    if (this.metronome && beat !== this.lastBeat) this.click();
    this.lastBeat = beat;
    this.lastPosition = frame.position;
  }

  private sound(note: NoteEvent, tempoPercent: number): void {
    const duration = Math.max(0.04, note.durationSeconds / Math.max(0.5, tempoPercent / 100));
    this.instrument.play({ midi: note.midi, velocity: note.velocity, durationSeconds: duration });
  }

  private click(): void {
    this.instrument.metronome();
  }

  private chordNotes(position: number): NoteEvent[] {
    const harmony = activeHarmonyAt(this.harmonies, position);
    if (!harmony) return [];
    const guitar = this.instrument instanceof SampleInstrumentEngine && this.instrument.currentInstrument === "guitar";
    const pitches = guitar && harmony.guitar.length ? harmony.guitar.map((entry) => entry.midi) : harmony.pitches;
    return pitches.map((midi, index) => ({ id: `${harmony.id}-${midi}-${index}`, partId: "derived-harmony", measureIndex: this.scheduler.snapshot().measure?.index ?? 0, beat: this.scheduler.snapshot().beat, startSeconds: harmony.startSeconds, durationSeconds: Math.max(0.04, harmony.startSeconds + harmony.durationSeconds - position), midi, velocity: 0.72, hand: "unknown", ...(guitar && harmony.guitar[index] ? { string: harmony.guitar[index].string, fret: harmony.guitar[index].fret } : {}) }));
  }
}
