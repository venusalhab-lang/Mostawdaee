/**
 * Quiet merchant feedback. UI chrome stays silent; only meaningful outcomes
 * (save OK / hard error / POS scan) may chime, and even then at a low level.
 */

type SoundType = 'hover' | 'click' | 'success' | 'error' | 'typing' | 'pop';

class SoundService {
  private context: AudioContext | null = null;
  private mutedState: boolean = false;
  private listeners: Set<(muted: boolean) => void> = new Set();

  constructor() {
    try {
      this.mutedState = localStorage.getItem('sys_sound_muted') === 'true';
    } catch {
      this.mutedState = false;
    }
  }

  private getContext(): AudioContext {
    if (!this.context) {
      this.context = new (window.AudioContext || (window as any).webkitAudioContext)();
    }
    if (this.context.state === 'suspended') {
      this.context.resume();
    }
    return this.context;
  }

  subscribe(callback: (muted: boolean) => void) {
    this.listeners.add(callback);
    callback(this.mutedState);
    return () => {
      this.listeners.delete(callback);
    };
  }

  private notify() {
    this.listeners.forEach((cb) => cb(this.mutedState));
  }

  get isMuted(): boolean {
    return this.mutedState;
  }

  setMuted(muted: boolean) {
    this.mutedState = muted;
    try {
      localStorage.setItem('sys_sound_muted', String(muted));
    } catch {
      /* ignore */
    }
    this.notify();
  }

  toggleMute(): boolean {
    const nextState = !this.mutedState;
    this.setMuted(nextState);
    return nextState;
  }

  /** Navigation / filter / chrome clicks stay silent on purpose. */
  playHover() {}
  playClick() {}
  playPop() {}
  playTyping() {}

  /** Soft two-note confirm for a completed save (not for every tap). */
  playSuccess() {
    if (this.mutedState) return;
    try {
      const ctx = this.getContext();
      const notes = [523.25, 659.25];
      notes.forEach((freq, idx) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        const t = ctx.currentTime + idx * 0.05;
        osc.type = 'sine';
        osc.frequency.setValueAtTime(freq, t);
        gain.gain.setValueAtTime(0, t);
        gain.gain.linearRampToValueAtTime(0.028, t + 0.012);
        gain.gain.exponentialRampToValueAtTime(0.001, t + 0.12);
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start(t);
        osc.stop(t + 0.14);
      });
    } catch {
      /* ignore */
    }
  }

  /** Soft low thud for a blocked action — never a harsh alarm. */
  playError() {
    if (this.mutedState) return;
    try {
      const ctx = this.getContext();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      const now = ctx.currentTime;
      osc.type = 'sine';
      osc.frequency.setValueAtTime(220, now);
      osc.frequency.linearRampToValueAtTime(160, now + 0.14);
      gain.gain.setValueAtTime(0.035, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.16);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(now);
      osc.stop(now + 0.17);
    } catch {
      /* ignore */
    }
  }

  /** Quiet POS beeps: scan tick, refuse, soft checkout. */
  playPosBeep(type: 'success' | 'error' | 'success_checkout') {
    if (this.mutedState) return;
    try {
      const ctx = this.getContext();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(ctx.destination);
      const now = ctx.currentTime;

      if (type === 'success') {
        osc.type = 'sine';
        osc.frequency.setValueAtTime(880, now);
        gain.gain.setValueAtTime(0.04, now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.07);
        osc.start(now);
        osc.stop(now + 0.08);
      } else if (type === 'error') {
        osc.type = 'sine';
        osc.frequency.setValueAtTime(240, now);
        osc.frequency.linearRampToValueAtTime(180, now + 0.12);
        gain.gain.setValueAtTime(0.045, now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.14);
        osc.start(now);
        osc.stop(now + 0.15);
      } else {
        osc.type = 'sine';
        osc.frequency.setValueAtTime(660, now);
        gain.gain.setValueAtTime(0.04, now);
        osc.start(now);
        osc.frequency.setValueAtTime(880, now + 0.07);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.16);
        osc.stop(now + 0.17);
      }
    } catch {
      /* ignore */
    }
  }

  play(soundName: SoundType) {
    switch (soundName) {
      case 'success':
        this.playSuccess();
        break;
      case 'error':
        this.playError();
        break;
      default:
        break;
    }
  }
}

export const sounds = new SoundService();
export const playPosBeep = (type: 'success' | 'error' | 'success_checkout') =>
  sounds.playPosBeep(type);
