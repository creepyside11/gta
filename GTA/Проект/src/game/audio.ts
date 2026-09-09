import type { GameState, WeaponId } from './types';
import { engineMix, spatialMix } from './audioMix';

type Voice = { source: OscillatorNode | AudioBufferSourceNode; gain: GainNode; filter: BiquadFilterNode };
/** Layered local synthesis: engine harmonics, tires, metal, gun transients and spatial sirens. */
export class GameAudio {
  private context: AudioContext | null = null;
  private master: GainNode | null = null;
  private noise: AudioBuffer | null = null;
  private engine: Voice | null = null;
  private exhaust: Voice | null = null;
  private road: Voice | null = null;
  private skid: Voice | null = null;
  private siren: Voice | null = null;
  private sirenPan: StereoPannerNode | null = null;
  private rattle: Voice | null = null;
  private impactRevisions = new Map<string, number>();
  private lastShot = 0;
  private lastStep = -1;
  private lastPhase = 'available';
  private reloading = false;
  private disposed = false;
  private startPromise: Promise<void> | null = null;
  enabled = false;

  private initialize() {
    if (this.context || this.disposed) return;
    const ctx = this.context = new AudioContext();
    this.master = ctx.createGain(); this.master.gain.value = 0;
    const limiter = ctx.createDynamicsCompressor();
    limiter.threshold.value = -12; limiter.knee.value = 10; limiter.ratio.value = 8;
    limiter.attack.value = .003; limiter.release.value = .18;
    this.master.connect(limiter).connect(ctx.destination);
    this.noise = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    const samples = this.noise.getChannelData(0);
    let seed = 7123;
    for (let i = 0; i < samples.length; i++) { seed = (seed * 1664525 + 1013904223) >>> 0; samples[i] = seed / 2147483648 - 1; }
    this.engine = this.loop(false, 'lowpass', 1200);
    this.exhaust = this.loop(false, 'lowpass', 320);
    const real = new Float32Array(16), imaginary = new Float32Array(16);
    for (let n = 1; n < 16; n++) imaginary[n] = (n % 2 ? 1 : .55) / n;
    (this.engine.source as OscillatorNode).setPeriodicWave(ctx.createPeriodicWave(real, imaginary));
    (this.exhaust.source as OscillatorNode).type = 'triangle';
    this.road = this.loop(true, 'lowpass', 700);
    this.skid = this.loop(true, 'bandpass', 1700); this.skid.filter.Q.value = 3;
    this.rattle = this.loop(true, 'bandpass', 650); this.rattle.filter.Q.value = 7;
    this.sirenPan = ctx.createStereoPanner(); this.sirenPan.connect(this.master);
    this.siren = this.loop(false, 'lowpass', 2600, this.sirenPan);
    (this.siren.source as OscillatorNode).type = 'triangle';
  }
  private loop(noise: boolean, type: BiquadFilterType, frequency: number, destination?: AudioNode): Voice {
    const ctx = this.context!;
    const source = noise ? ctx.createBufferSource() : ctx.createOscillator();
    if (noise) { (source as AudioBufferSourceNode).buffer = this.noise; (source as AudioBufferSourceNode).loop = true; }
    const gain = ctx.createGain(), filter = ctx.createBiquadFilter();
    gain.gain.value = 0; filter.type = type; filter.frequency.value = frequency;
    source.connect(filter).connect(gain).connect(destination ?? this.master!); source.start();
    return { source, gain, filter };
  }
  async start() {
    if (this.disposed) return false;
    this.initialize(); this.enabled = true;
    if (!this.startPromise) this.startPromise = this.context!.resume().finally(() => { this.startPromise = null; });
    try { await this.startPromise; }
    catch (error) { this.enabled = false; throw error; }
    return this.enabled;
  }
  async toggle() {
    if (!this.enabled) return this.start();
    this.enabled = false;
    if (this.context && this.master) this.master.gain.setTargetAtTime(0, this.context.currentTime, .015);
    return false;
  }
  private burst(frequency: number, endFrequency: number, duration: number, volume: number, noise = false, pan = 0, delay = 0) {
    if (!this.context || !this.master || !this.enabled || this.disposed) return;
    const ctx = this.context, now = ctx.currentTime + delay;
    const source = noise ? ctx.createBufferSource() : ctx.createOscillator();
    const filter = ctx.createBiquadFilter(), gain = ctx.createGain(), panner = ctx.createStereoPanner();
    if (noise) { (source as AudioBufferSourceNode).buffer = this.noise; filter.type = 'bandpass'; }
    else {
      (source as OscillatorNode).type = 'triangle'; filter.type = 'lowpass';
      (source as OscillatorNode).frequency.setValueAtTime(frequency, now);
      (source as OscillatorNode).frequency.exponentialRampToValueAtTime(Math.max(20, endFrequency), now + duration);
    }
    filter.frequency.setValueAtTime(noise ? frequency : 5000, now);
    if (noise) filter.frequency.exponentialRampToValueAtTime(Math.max(30, endFrequency), now + duration);
    filter.Q.value = noise ? .8 : .5; panner.pan.value = pan;
    gain.gain.setValueAtTime(0, now); gain.gain.linearRampToValueAtTime(volume, now + .003);
    gain.gain.exponentialRampToValueAtTime(.0001, now + duration);
    source.connect(filter).connect(gain).connect(panner).connect(this.master);
    source.start(now); source.stop(now + duration + .01);
    source.onended = () => { source.disconnect(); filter.disconnect(); gain.disconnect(); panner.disconnect(); };
  }
  private impact(energy: number, volume: number, pan: number) {
    const strength = Math.min(1, Math.sqrt(energy / 280000));
    this.burst(100 - strength * 35, 32, .17 + strength * .18, volume * (.06 + strength * .22), false, pan);
    this.burst(1800, 280, .12 + strength * .3, volume * strength * .3, true, pan);
    for (const [i, hz] of [430, 710, 1130].entries()) this.burst(hz, hz * .7, .12 + i * .04, volume * strength * .025, false, pan, i * .015);
    if (strength > .55) this.burst(6500, 2100, .38, volume * strength * .09, true, pan, .03);
  }
  private attack(weapon: WeaponId, volume: number, pan: number) {
    const knife = weapon === 'knife';
    this.burst(knife ? 3100 : 4300, knife ? 800 : 450, knife ? .14 : .12, volume, true, pan);
    if (!knife) {
      this.burst(weapon === 'rifle' ? 150 : 190, 45, .16, volume * .7, false, pan);
      this.burst(1000, 250, .19, volume * .18, true, pan, .055);
    }
  }
  update(state: GameState, paused: boolean) {
    const audible = this.enabled && !paused && !this.disposed;
    const car = state.vehicles.find(v => v.id === state.player.vehicleId);
    const listener = car ?? state.player;
    if (this.context && this.master && this.engine && this.exhaust && this.road && this.skid && this.siren && this.rattle) {
      const now = this.context.currentTime, mix = engineMix(car);
      this.master.gain.setTargetAtTime(audible ? .7 : 0, now, .018);
      const smooth = (param: AudioParam, value: number, rate = .07) => param.setTargetAtTime(value, now, rate);
      smooth((this.engine.source as OscillatorNode).frequency, mix.firingHz);
      smooth((this.exhaust.source as OscillatorNode).frequency, mix.firingHz / 2);
      smooth(this.engine.filter.frequency, 450 + mix.load * 1800 + mix.rpm * .15);
      smooth(this.engine.gain.gain, mix.engine); smooth(this.exhaust.gain.gain, mix.engine * .6);
      smooth(this.road.gain.gain, mix.road); smooth(this.road.filter.frequency, 350 + Math.abs(car?.speed ?? 0) * 45);
      smooth(this.skid.gain.gain, mix.skid); smooth(this.rattle.gain.gain, mix.rattle * (.5 + Math.sin(state.time * 37) ** 2));
      const police = state.vehicles.filter(v => v.active && v.kind === 'police').sort((a, b) => Math.hypot(a.x - listener.x, a.z - listener.z) - Math.hypot(b.x - listener.x, b.z - listener.z))[0];
      const spatial = police ? spatialMix(police.x - listener.x, police.z - listener.z, listener.yaw) : { volume: 0, pan: 0 };
      smooth((this.siren.source as OscillatorNode).frequency, 680 + Math.sin(state.time * (state.police.wanted >= 3 ? 12 : 3.8)) * 290, .035);
      smooth(this.siren.gain.gain, state.police.wanted ? .055 * spatial.volume : 0);
      smooth(this.sirenPan!.pan, spatial.pan);
    }
    for (const vehicle of state.vehicles) {
      const d = vehicle.damage;
      if (!d) { this.impactRevisions.delete(vehicle.id); continue; }
      if ((this.impactRevisions.get(vehicle.id) ?? 0) !== d.revision && audible && state.time - d.lastImpact < .25) {
        const spatial = spatialMix(vehicle.x - listener.x, vehicle.z - listener.z, listener.yaw);
        this.impact(d.impactEnergy, spatial.volume * .7, spatial.pan);
      }
      this.impactRevisions.set(vehicle.id, d.revision);
    }
    if (state.combat.nextShotId <= this.lastShot) this.lastShot = 0;
    for (const shot of state.combat.shots) {
      if (shot.id <= this.lastShot) continue;
      if (audible && state.time - shot.time < .2) {
        const spatial = spatialMix(shot.from.x - listener.x, shot.from.z - listener.z, listener.yaw);
        this.attack(shot.weapon, (shot.weapon === 'knife' ? .07 : .18) * spatial.volume, spatial.pan);
      }
      this.lastShot = Math.max(this.lastShot, shot.id);
    }
    const step = Math.floor(state.time * (state.player.swimming ? 2.2 : 3.4));
    if (audible && !car && state.player.moving && !state.combat.dead && step !== this.lastStep) {
      this.burst(state.player.swimming ? 1000 : 260, state.player.swimming ? 350 : 100, state.player.swimming ? .22 : .065, .033, true, step % 2 ? -.15 : .15);
    }
    this.lastStep = step;
    const reloading = state.combat.reload !== null;
    if (audible && reloading !== this.reloading) { this.burst(2400, 900, .05, .035, true); this.burst(700, 430, .04, .018, false, 0, .07); }
    this.reloading = reloading;
    if (audible && state.mission.phase === 'success' && this.lastPhase !== 'success') {
      [440, 554, 660].forEach((hz, i) => this.burst(hz, hz, .4, .055, false, 0, i * .12));
    }
    this.lastPhase = state.mission.phase;
  }
  dispose() {
    if (this.disposed) return;
    this.disposed = true; this.enabled = false;
    for (const voice of [this.engine, this.exhaust, this.road, this.skid, this.siren, this.rattle]) voice?.source.stop();
    void this.context?.close();
  }
}
