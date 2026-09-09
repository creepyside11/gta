import test from 'node:test';
import assert from 'node:assert/strict';
import { GameAudio } from '../src/game/audio';
import { Simulation } from '../src/game/simulation';
import { freshDamage } from '../src/game/damage';

class Param {
  value = 0;
  setValueAtTime(v: number) { this.value = v; }
  setTargetAtTime(v: number) { assert.ok(Number.isFinite(v)); this.value = v; }
  exponentialRampToValueAtTime(v: number) { assert.ok(v > 0 && Number.isFinite(v)); this.value = v; }
  linearRampToValueAtTime(v: number) { this.value = v; }
}
class Node {
  gain = new Param(); frequency = new Param(); Q = new Param(); pan = new Param();
  threshold = new Param(); knee = new Param(); ratio = new Param(); attack = new Param(); release = new Param();
  type = ''; buffer: unknown; loop = false; started = false; stopped = false;
  connect(next: Node) { return next; }
  disconnect() {}
  start() { this.started = true; }
  stop() { this.stopped = true; }
  setPeriodicWave() {}
}
class Context {
  static latest: Context;
  sampleRate = 8000; currentTime = 1; state = 'running'; destination = new Node(); nodes: Node[] = []; gains: Node[] = []; closed = false;
  constructor() { Context.latest = this; }
  node() { const n = new Node(); this.nodes.push(n); return n; }
  createGain() { const n = this.node(); this.gains.push(n); return n; }
  createDynamicsCompressor() { return this.node(); }
  createOscillator() { return this.node(); }
  createBufferSource() { return this.node(); }
  createBiquadFilter() { return this.node(); }
  createStereoPanner() { return this.node(); }
  createPeriodicWave() { return {}; }
  createBuffer(_channels: number, length: number) { return { getChannelData: () => new Float32Array(length) }; }
  async resume() {}
  async close() { this.closed = true; }
}

test('audio is gesture-gated, pause and mute silence the master bus, old impacts do not replay', async () => {
  const original = Object.getOwnPropertyDescriptor(globalThis, 'AudioContext');
  Object.defineProperty(globalThis, 'AudioContext', { configurable: true, value: Context });
  try {
    const sim = new Simulation(), audio = new GameAudio();
    assert.equal(audio.enabled, false);
    await audio.start();
    const ctx = Context.latest, master = ctx.gains[0];
    audio.update(sim.state, false); assert.equal(master.gain.value, .7);
    const car = sim.state.vehicles[0]; car.damage = freshDamage();
    car.damage.lastImpact = sim.state.time; car.damage.revision = 1; car.damage.impactEnergy = 200000;
    const beforeImpact = ctx.nodes.length;
    audio.update(sim.state, false); assert.ok(ctx.nodes.length > beforeImpact);
    const afterImpact = ctx.nodes.length;
    audio.update(sim.state, false); assert.equal(ctx.nodes.length, afterImpact);
    audio.update(sim.state, true); assert.equal(master.gain.value, 0);
    car.damage.revision++; audio.update(sim.state, true);
    audio.update(sim.state, false); assert.equal(ctx.nodes.length, afterImpact);
    await audio.toggle(); audio.update(sim.state, false); assert.equal(master.gain.value, 0);
    audio.dispose(); assert.equal(ctx.closed, true);
    assert.ok(ctx.nodes.filter(n => n.started).every(n => n.stopped));
  } finally {
    if (original) Object.defineProperty(globalThis, 'AudioContext', original);
    else Reflect.deleteProperty(globalThis, 'AudioContext');
  }
});
