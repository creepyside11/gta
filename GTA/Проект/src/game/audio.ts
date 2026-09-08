import type { GameState, WeaponId } from './types';

/** All sounds are synthesized locally; the audio graph only starts after a gesture. */
export class GameAudio {
  private context: AudioContext | null = null;
  private engine: OscillatorNode | null = null;
  private siren: OscillatorNode | null = null;
  private engineGain: GainNode | null = null;
  private sirenGain: GainNode | null = null;
  private lastCollision = 0;
  private lastPhase = 'available';
  private noise: AudioBuffer | null = null;
  private lastShot = 0;
  private reloading = false;
  enabled = false;
  async toggle() {
    if (!this.context) {
      this.context = new AudioContext();
      this.noise = this.context.createBuffer(1, Math.ceil(this.context.sampleRate * .2), this.context.sampleRate);
      const samples = this.noise.getChannelData(0);
      for (let i = 0; i < samples.length; i++) samples[i] = Math.random() * 2 - 1;
      this.engine = this.context.createOscillator();
      this.engine.type = 'triangle';
      this.engineGain = this.context.createGain();
      this.engineGain.gain.value = 0;
      this.engine.connect(this.engineGain).connect(this.context.destination);
      this.engine.start();
      this.siren = this.context.createOscillator();
      this.sirenGain = this.context.createGain();
      this.sirenGain.gain.value = 0;
      this.siren.connect(this.sirenGain).connect(this.context.destination);
      this.siren.start();
    }
    this.enabled = !this.enabled;
    if (this.context.state === 'suspended') await this.context.resume();
    return this.enabled;
  }
  private tone(frequency: number, duration: number, gain: number) {
    if (!this.context || !this.enabled) return;
    const oscillator = this.context.createOscillator();
    const envelope = this.context.createGain();
    oscillator.type = 'triangle';
    oscillator.frequency.value = frequency;
    envelope.gain.setValueAtTime(gain, this.context.currentTime);
    envelope.gain.exponentialRampToValueAtTime(0.001, this.context.currentTime + duration);
    oscillator.connect(envelope).connect(this.context.destination);
    oscillator.start();
    oscillator.stop(this.context.currentTime + duration);
    oscillator.onended = () => { oscillator.disconnect(); envelope.disconnect(); };
  }
  private attack(weapon: WeaponId, volume: number) {
    if (!this.context || !this.noise || !this.enabled) return;
    const source = this.context.createBufferSource();
    const filter = this.context.createBiquadFilter();
    const envelope = this.context.createGain();
    const now = this.context.currentTime;
    const duration = weapon === 'knife' ? .1 : weapon === 'rifle' ? .075 : .115;
    source.buffer = this.noise;
    filter.type = 'bandpass';
    filter.frequency.setValueAtTime(weapon === 'knife' ? 2600 : weapon === 'rifle' ? 1050 : 1450, now);
    filter.frequency.exponentialRampToValueAtTime(weapon === 'knife' ? 950 : 390, now + duration);
    filter.Q.value = weapon === 'knife' ? .6 : .9;
    envelope.gain.setValueAtTime(volume, now);
    envelope.gain.exponentialRampToValueAtTime(.001, now + duration);
    source.connect(filter).connect(envelope).connect(this.context.destination);
    source.start();
    source.stop(now + duration);
    source.onended = () => { source.disconnect(); filter.disconnect(); envelope.disconnect(); };
    if (weapon !== 'knife') this.tone(weapon === 'rifle' ? 115 : 155, duration, volume * .5);
  }
  update(state: GameState, paused: boolean) {
    if (!this.context || !this.engine || !this.siren || !this.engineGain || !this.sirenGain) return;
    const audible = this.enabled && !paused;
    const car = state.vehicles.find(v => v.id === state.player.vehicleId);
    const now = this.context.currentTime;
    this.engine.frequency.setTargetAtTime(42 + Math.abs(car?.speed ?? 0) * 4, now, 0.15);
    this.engineGain.gain.setTargetAtTime(audible && car ? 0.035 : 0, now, 0.12);
    this.siren.frequency.setTargetAtTime(580 + Math.sin(state.time * 5) * 200, now, 0.05);
    this.sirenGain.gain.setTargetAtTime(audible && state.police.wanted ? 0.018 : 0, now, 0.12);
    if (audible && state.collisions > this.lastCollision) this.tone(65, 0.12, 0.09);
    if (audible && state.mission.phase === 'success' && this.lastPhase !== 'success') this.tone(660, 0.8, 0.08);
    if (state.combat.nextShotId <= this.lastShot) this.lastShot = 0;
    for (const shot of state.combat.shots) {
      if (shot.id <= this.lastShot) continue;
      if (audible && state.time - shot.time < .2) {
        const distance = Math.hypot(shot.from.x - state.player.x, shot.from.z - state.player.z);
        this.attack(shot.weapon, (shot.weapon === 'knife' ? .055 : .12) / (1 + distance * .09));
      }
      this.lastShot = Math.max(this.lastShot, shot.id);
    }
    const reloading = state.combat.reload !== null;
    if (audible && reloading !== this.reloading) this.tone(reloading ? 1350 : 830, .055, .025);
    this.reloading = reloading;
    this.lastCollision = state.collisions;
    this.lastPhase = state.mission.phase;
  }
  dispose() { this.engine?.stop(); this.siren?.stop(); void this.context?.close(); }
}
