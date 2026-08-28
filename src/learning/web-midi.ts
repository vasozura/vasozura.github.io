export interface MidiMessage { midi: number; velocity: number; on: boolean; atMs: number; }

interface MidiInputLike extends EventTarget { onmidimessage: ((event: { data: Uint8Array }) => void) | null; }
interface MidiAccessLike { inputs: Map<string, MidiInputLike>; }
type MidiNavigator = Navigator & { requestMIDIAccess?: () => Promise<MidiAccessLike> };

export function supportsWebMidi(): boolean {
  return typeof navigator !== "undefined" && typeof (navigator as MidiNavigator).requestMIDIAccess === "function";
}

export async function connectWebMidi(onMessage: (message: MidiMessage) => void): Promise<() => void> {
  const request = (navigator as MidiNavigator).requestMIDIAccess;
  if (!request) throw new Error("Web MIDI is not supported in this browser.");
  const access = await request.call(navigator);
  const inputs = [...access.inputs.values()];
  if (!inputs.length) throw new Error("No MIDI input device was found.");
  const handler = (event: { data: Uint8Array }): void => {
    const [status = 0, midi = 0, velocity = 0] = event.data;
    const command = status & 0xf0;
    if (command !== 0x90 && command !== 0x80) return;
    onMessage({ midi, velocity: velocity / 127, on: command === 0x90 && velocity > 0, atMs: performance.now() });
  };
  inputs.forEach((input) => { input.onmidimessage = handler; });
  return () => inputs.forEach((input) => { input.onmidimessage = null; });
}
