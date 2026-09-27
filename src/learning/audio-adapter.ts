import type { NoteEvent } from "./contracts";
import type { CanonicalScheduler, SchedulerFrame } from "./scheduler";
import { SampleInstrumentEngine, type InstrumentName, type InstrumentPlayback } from "../audio/sample-instrument";
import { noteMatchesStaffScope, selectPlaybackNotes, type PlaybackSelection } from "./playback-selection";
import { activeHarmonyAt, type HarmonicEvent } from "./harmony";
import { selectLaneNotes, type VoiceLane } from "./voice-lanes";
import { resolveChordPatternFrame, type ChordPatternName, type PatternInstrument, type PatternRate } from "./chord-patterns";

export interface ChordPatternStatus {
  pattern: ChordPatternName;
  rate: PatternRate;
  step: string;
}

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
  private layers = { melody: true, chords: false };
  private levels = { melody: 0.9, chords: 0.62, metronome: 0.55 };
  private learningMelodyIds = new Set<string>();
  private instrumentName: PatternInstrument = "piano";
  private chordPattern: ChordPatternName = "block";
  private patternRate: PatternRate = "1/8";
  private pendingPattern: { pattern: ChordPatternName; rate: PatternRate } | null = null;
  private lastPatternBoundary = "";
  private lastHarmonyId = "";
  private patternStatus: ChordPatternStatus = { pattern: "block", rate: "1/8", step: "Block" };
  private readonly frame = (event: Event): void => this.render((event as CustomEvent<SchedulerFrame>).detail);

  constructor(
    private scheduler: CanonicalScheduler,
    private readonly instrument: InstrumentPlayback = new SampleInstrumentEngine(),
  ) { scheduler.addEventListener("frame", this.frame); }

  async enable(): Promise<void> {
    await this.instrument.enable(this.scheduler.timeline.notes.map((note) => note.midi));
  }

  setMetronome(enabled: boolean): void { this.metronome = enabled; }
  setLearningLayers(layers: Partial<typeof this.layers>, melodyNotes: readonly NoteEvent[] = []): void {
    this.layers = { ...this.layers, ...layers };
    if (melodyNotes.length) this.learningMelodyIds = new Set(melodyNotes.map((note) => note.id));
    this.reset();
  }
  setLevels(levels: Partial<typeof this.levels>): void { this.levels = { ...this.levels, ...levels }; }
  setInstrument(instrument: InstrumentName): void { this.instrumentName = instrument; this.instrument.setInstrument(instrument); this.reset(); }
  setSelection(selection: PlaybackSelection, lanes: VoiceLane[] = this.lanes, selectedLaneIds: ReadonlySet<string> = this.selectedLaneIds): void { this.selection = selection; this.lanes = lanes; this.selectedLaneIds = new Set(selectedLaneIds); this.reset(); }
  setHarmonicTimeline(harmonies: HarmonicEvent[]): void { this.harmonies = harmonies; this.reset(); }
  setChordPattern(pattern: ChordPatternName, rate: PatternRate = this.patternRate): void {
    if (this.scheduler.snapshot().playing) this.pendingPattern = { pattern, rate };
    else { this.chordPattern = pattern; this.patternRate = rate; this.pendingPattern = null; this.reset(); }
  }
  getChordPatternStatus(): ChordPatternStatus { return { ...this.patternStatus }; }
  selectNotes(notes: NoteEvent[]): NoteEvent[] {
    if (this.selection.mode === "chords") return this.selected;
    if (this.lanes.length) return selectLaneNotes(notes.filter((note) => noteMatchesStaffScope(note, this.selection.scope)), this.lanes, this.selectedLaneIds);
    return selectPlaybackNotes(notes, this.selection);
  }
  reset(): void { this.played.clear(); this.lastBeat = -1; this.lastPosition = 0; this.lastPatternBoundary = ""; this.lastHarmonyId = ""; this.instrument.releaseAll(); }

  destroy(): void {
    this.scheduler.removeEventListener("frame", this.frame);
    this.instrument.destroy();
  }

  private render(frame: SchedulerFrame): void {
    if (frame.position + 0.01 < this.lastPosition) {
      this.played.clear();
      this.instrument.releaseAll();
    }
    const learningCandidates = frame.active.filter((note) => this.learningMelodyIds.has(note.id) && noteMatchesStaffScope(note, this.selection.scope));
    const melody = this.learningMelodyIds.size
      ? (this.lanes.length ? selectLaneNotes(learningCandidates, this.lanes, this.selectedLaneIds) : learningCandidates)
      : this.selectNotes(frame.active);
    const chords = this.layers.chords ? this.chordNotes(frame) : [];
    this.selected = [...(this.layers.melody ? melody : []), ...chords];
    this.selected.forEach((note) => { if (!this.played.has(note.id)) { this.played.add(note.id); this.sound(note, frame.tempoPercent); } });
    const beatLength = 60 / (this.scheduler.timeline.tempos[0]?.bpm ?? 120);
    const beat = frame.measure ? frame.measure.index * frame.measure.beats + Math.floor(frame.beat) : Math.floor(frame.position / beatLength);
    if (this.metronome && beat !== this.lastBeat) this.click();
    this.lastBeat = beat;
    this.lastPosition = frame.position;
  }

  private sound(note: NoteEvent, tempoPercent: number): void {
    const duration = Math.max(0.04, note.durationSeconds / Math.max(0.5, tempoPercent / 100));
    const level = note.partId === "derived-harmony" ? this.levels.chords : this.levels.melody;
    this.instrument.play({ midi: note.midi, velocity: note.velocity * level, durationSeconds: duration });
  }

  private click(): void {
    this.instrument.metronome(this.levels.metronome);
  }

  private chordNotes(frame: SchedulerFrame): NoteEvent[] {
    const harmony = activeHarmonyAt(this.harmonies, frame.position);
    if (!harmony) return [];
    let patternFrame = resolveChordPatternFrame(this.scheduler.timeline, harmony, frame.position, this.chordPattern, this.patternRate, this.instrumentName, frame.tempoPercent);
    if (this.pendingPattern && (!this.lastPatternBoundary || patternFrame.boundaryKey !== this.lastPatternBoundary)) {
      this.chordPattern = this.pendingPattern.pattern;
      this.patternRate = this.pendingPattern.rate;
      this.pendingPattern = null;
      this.played.clear();
      this.instrument.releaseAll();
      patternFrame = resolveChordPatternFrame(this.scheduler.timeline, harmony, frame.position, this.chordPattern, this.patternRate, this.instrumentName, frame.tempoPercent);
    }
    if (harmony.id !== this.lastHarmonyId) {
      this.played.clear();
      this.instrument.releaseAll();
      this.lastHarmonyId = harmony.id;
    }
    this.lastPatternBoundary = patternFrame.boundaryKey;
    this.patternStatus = { pattern: this.chordPattern, rate: this.patternRate, step: patternFrame.stepLabel };
    const duration = this.chordPattern === "block"
      ? Math.max(0.04, harmony.startSeconds + harmony.durationSeconds - frame.position)
      : Math.max(0.04, patternFrame.canonicalStepSeconds * 0.88);
    return patternFrame.tones.map((tone, index) => ({
      id: `${patternFrame.eventKey}-${tone.midi}-${index}`,
      partId: "derived-harmony",
      measureIndex: frame.measure?.index ?? 0,
      beat: frame.beat,
      startSeconds: frame.position,
      durationSeconds: duration,
      midi: tone.midi,
      velocity: tone.role === "Bass" ? 0.76 : 0.7,
      hand: "unknown",
      ...(tone.guitar ? { string: tone.guitar.string, fret: tone.guitar.fret } : {}),
    }));
  }
}
