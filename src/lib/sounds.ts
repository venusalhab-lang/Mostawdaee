/**
 * Simple, high-fidelity sound utility using window.AudioContext.
 * Generates tactile, sci-fi style custom sound syntheses dynamically
 * with instant feedback, zero asset-loading overhead, and reactive muting.
 */

type SoundType = 'hover' | 'click' | 'success' | 'error' | 'typing' | 'pop';

class SoundService {
  private context: AudioContext | null = null;
  private mutedState: boolean = false;
  private listeners: Set<(muted: boolean) => void> = new Set();

  constructor() {
    try {
      // Load initial state from local storage securely
      this.mutedState = localStorage.getItem('sys_sound_muted') === 'true';
    } catch {
      this.mutedState = false;
    }
  }

  private getContext(): AudioContext {
    if (!this.context) {
      this.context = new (window.AudioContext || (window as any).webkitAudioContext)();
    }
    // Resume context if state is suspended (browser autoplay safeguards)
    if (this.context.state === 'suspended') {
      this.context.resume();
    }
    return this.context;
  }

  // Reactive subscription system for components to render mute state updates instantly
  subscribe(callback: (muted: boolean) => void) {
    this.listeners.add(callback);
    callback(this.mutedState); // Immediate emit
    return () => {
      this.listeners.delete(callback);
    };
  }

  private notify() {
    this.listeners.forEach(cb => cb(this.mutedState));
  }

  get isMuted(): boolean {
    return this.mutedState;
  }

  setMuted(muted: boolean) {
    this.mutedState = muted;
    try {
      localStorage.setItem('sys_sound_muted', String(muted));
    } catch (e) {
      console.warn('LocalStorage sound preference write failed');
    }
    this.notify();
  }

  toggleMute(): boolean {
    const nextState = !this.mutedState;
    this.setMuted(nextState);
    if (!nextState) {
      // Play a happy sci-fi chime upon unmuting to acknowledge setup success
      setTimeout(() => this.playSuccess(), 50);
    }
    return nextState;
  }

  // 1. Subtle high-frequency hover sweep (warm cyber click)
  playHover() {
    if (this.mutedState) return;
    try {
      const ctx = this.getContext();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();

      osc.type = 'sine';
      osc.frequency.setValueAtTime(1400, ctx.currentTime);
      osc.frequency.linearRampToValueAtTime(1200, ctx.currentTime + 0.03);

      gain.gain.setValueAtTime(0.02, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.03);

      osc.connect(gain);
      gain.connect(ctx.destination);

      osc.start();
      osc.stop(ctx.currentTime + 0.04);
    } catch (e) {
      // Ignored silently (no context available on page start)
    }
  }

  // 2. Snappy tactile cyber click pop
  playClick() {
    if (this.mutedState) return;
    try {
      const ctx = this.getContext();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();

      osc.type = 'triangle';
      osc.frequency.setValueAtTime(820, ctx.currentTime);
      osc.frequency.exponentialRampToValueAtTime(120, ctx.currentTime + 0.06);

      gain.gain.setValueAtTime(0.08, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.06);

      osc.connect(gain);
      gain.connect(ctx.destination);

      osc.start();
      osc.stop(ctx.currentTime + 0.07);
    } catch (e) {
      // Ignored silently
    }
  }

  // Alias compatible with old code invocations
  playPop() {
    this.playClick();
  }

  // 3. Cyber computer arpeggiator cascading success chord
  playSuccess() {
    if (this.mutedState) return;
    try {
      const ctx = this.getContext();
      const notes = [523.25, 659.25, 783.99, 1046.50]; // Beautiful C major arpeggio
      const delayStep = 0.04;

      notes.forEach((freq, idx) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();

        osc.type = 'sine';
        osc.frequency.setValueAtTime(freq, ctx.currentTime + idx * delayStep);

        gain.gain.setValueAtTime(0, ctx.currentTime);
        gain.gain.linearRampToValueAtTime(0.06, ctx.currentTime + idx * delayStep + 0.01);
        gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + idx * delayStep + 0.18);

        osc.connect(gain);
        gain.connect(ctx.destination);

        osc.start(ctx.currentTime + idx * delayStep);
        osc.stop(ctx.currentTime + idx * delayStep + 0.2);
      });
    } catch (e) {
      // Ignored silently
    }
  }

  // 4. Warning alert with low dual oscillators
  playError() {
    if (this.mutedState) return;
    try {
      const ctx = this.getContext();
      const now = ctx.currentTime;

      // Two dual mistuned oscillators to create a dramatic ring-modulated drone alarm
      [180, 184].forEach(freq => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();

        osc.type = 'sawtooth';
        osc.frequency.setValueAtTime(freq, now);
        osc.frequency.linearRampToValueAtTime(freq - 60, now + 0.35);

        gain.gain.setValueAtTime(0.08, now);
        gain.gain.linearRampToValueAtTime(0.001, now + 0.35);

        osc.connect(gain);
        gain.connect(ctx.destination);

        osc.start(now);
        osc.stop(now + 0.36);
      });
    } catch (e) {
      // Ignored silently
    }
  }

  // 5. Short mechanical typing chirp (perfect for searches/text inputs)
  playTyping() {
    if (this.mutedState) return;
    try {
      const ctx = this.getContext();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();

      osc.type = 'sine';
      osc.frequency.setValueAtTime(1020, ctx.currentTime);
      osc.frequency.exponentialRampToValueAtTime(40, ctx.currentTime + 0.015);

      gain.gain.setValueAtTime(0.02, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.015);

      osc.connect(gain);
      gain.connect(ctx.destination);

      osc.start();
      osc.stop(ctx.currentTime + 0.02);
    } catch (e) {
      // Ignored silently
    }
  }

  // Legacy dynamic trigger method to adapt to provided layout snippet
  play(soundName: SoundType) {
    switch (soundName) {
      case 'hover':
        this.playHover();
        break;
      case 'click':
      case 'pop':
        this.playClick();
        break;
      case 'success':
        this.playSuccess();
        break;
      case 'error':
        this.playError();
        break;
      case 'typing':
        this.playTyping();
        break;
      default:
        this.playClick();
    }
  }
}

export const sounds = new SoundService();
