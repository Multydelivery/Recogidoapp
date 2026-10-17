import type { DispatchSound } from "./dispatch-notifications";

const melodies: Record<DispatchSound, { frequency: number; start: number; duration: number }[]> = {
  positive: [{ frequency: 660, start: 0, duration: 0.12 }, { frequency: 880, start: 0.13, duration: 0.18 }],
  complete: [{ frequency: 523, start: 0, duration: 0.1 }, { frequency: 659, start: 0.11, duration: 0.1 }, { frequency: 784, start: 0.22, duration: 0.22 }],
  attention: [{ frequency: 440, start: 0, duration: 0.22 }, { frequency: 440, start: 0.32, duration: 0.22 }],
};

type AudioContextConstructor = new () => AudioContext;

/** Short Web Audio tones; no audio files or external requests. */
export function createSoundPlayer() {
  let context: AudioContext | null = null;

  function ensureContext() {
    if (context) return context;
    if (typeof window === "undefined") return null;
    const Constructor: AudioContextConstructor | undefined = window.AudioContext ??
      (window as unknown as { webkitAudioContext?: AudioContextConstructor }).webkitAudioContext;
    if (!Constructor) return null;
    try {
      context = new Constructor();
    } catch {
      context = null;
    }
    return context;
  }

  return {
    /** Call from a user gesture so browsers allow later playback. */
    unlock() {
      const audio = ensureContext();
      if (audio?.state === "suspended") void audio.resume().catch(() => {});
    },
    play(sound: DispatchSound) {
      const audio = ensureContext();
      if (!audio) return;
      if (audio.state === "suspended") void audio.resume().catch(() => {});
      const now = audio.currentTime;
      for (const note of melodies[sound]) {
        const oscillator = audio.createOscillator();
        const gain = audio.createGain();
        oscillator.type = sound === "attention" ? "square" : "sine";
        oscillator.frequency.value = note.frequency;
        gain.gain.setValueAtTime(0.0001, now + note.start);
        gain.gain.exponentialRampToValueAtTime(sound === "attention" ? 0.08 : 0.15, now + note.start + 0.02);
        gain.gain.exponentialRampToValueAtTime(0.0001, now + note.start + note.duration);
        oscillator.connect(gain).connect(audio.destination);
        oscillator.start(now + note.start);
        oscillator.stop(now + note.start + note.duration + 0.02);
      }
    },
    dispose() {
      void context?.close().catch(() => {});
      context = null;
    },
  };
}
