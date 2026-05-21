export function playWelcomeAudio(): void {
  try {
    const ctx = new AudioContext();
    const master = ctx.createGain();
    master.gain.value = 0.8;
    master.connect(ctx.destination);
    const now = ctx.currentTime;

    // Layer 1: Bass hit — 60 Hz sine, sharp attack, decay over 600 ms
    const bass = ctx.createOscillator();
    const bassGain = ctx.createGain();
    bass.type = 'sine';
    bass.frequency.value = 60;
    bassGain.gain.setValueAtTime(0.8, now);
    bassGain.gain.exponentialRampToValueAtTime(0.001, now + 0.6);
    bass.connect(bassGain);
    bassGain.connect(master);
    bass.start(now);
    bass.stop(now + 0.6);

    // Layer 2: Rising sweep — 200 Hz → 900 Hz over 800 ms
    const sweep = ctx.createOscillator();
    const sweepGain = ctx.createGain();
    sweep.type = 'sine';
    sweep.frequency.setValueAtTime(200, now);
    sweep.frequency.exponentialRampToValueAtTime(900, now + 0.8);
    sweepGain.gain.setValueAtTime(0, now);
    sweepGain.gain.linearRampToValueAtTime(0.3, now + 0.1);
    sweepGain.gain.linearRampToValueAtTime(0, now + 0.8);
    sweep.connect(sweepGain);
    sweepGain.connect(master);
    sweep.start(now);
    sweep.stop(now + 0.8);

    // Layer 3: Chord shimmer — A4 (440 Hz) + C#5 (554 Hz), triangle, 0 → 0.15 → 0 over 1.2 s
    const freqs = [440, 554] as const;
    for (const freq of freqs) {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'triangle';
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0, now);
      gain.gain.linearRampToValueAtTime(0.15, now + 0.2);
      gain.gain.linearRampToValueAtTime(0, now + 1.2);
      osc.connect(gain);
      gain.connect(master);
      osc.start(now);
      osc.stop(now + 1.2);
    }

    // Close AudioContext after all nodes have finished (1.6 s total)
    setTimeout(() => ctx.close().catch(() => {}), 1600);
  } catch {
    // AudioContext unsupported or blocked — silent fallback, splash fades normally
  }
}
