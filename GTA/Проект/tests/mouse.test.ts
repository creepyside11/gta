import test from 'node:test';
import assert from 'node:assert/strict';
import { MouseLook } from '../src/game/mouse';

class TrackedEvents extends EventTarget {
  readonly listeners = new Map<string, Set<EventListenerOrEventListenerObject>>();
  override addEventListener(type: string, listener: EventListenerOrEventListenerObject | null, options?: AddEventListenerOptions | boolean): void {
    if (listener) {
      if (!this.listeners.has(type)) this.listeners.set(type, new Set());
      this.listeners.get(type)!.add(listener);
    }
    super.addEventListener(type, listener, options);
  }
  override removeEventListener(type: string, listener: EventListenerOrEventListenerObject | null, options?: EventListenerOptions | boolean): void {
    if (listener) this.listeners.get(type)?.delete(listener);
    super.removeEventListener(type, listener, options);
  }
  get listenerCount(): number {
    return [...this.listeners.values()].reduce((sum, listeners) => sum + listeners.size, 0);
  }
}

function deferred() {
  let resolve!: () => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<void>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

function mouse() {
  const view = new TrackedEvents();
  const document = Object.assign(new TrackedEvents(), {
    defaultView: view,
    pointerLockElement: null as HTMLElement | null,
    exitPointerLock: () => { exits++; lock(null); },
  });
  let requests = 0;
  let exits = 0;
  let implementation: () => Promise<void> | void = () => undefined;
  const target = {
    ownerDocument: document,
    requestPointerLock: (...options: unknown[]) => {
      assert.equal(options.length, 0, 'capture must not require optional browser features');
      requests++;
      return implementation();
    },
  } as unknown as HTMLElement;
  const other = {} as HTMLElement;
  const looks: number[][] = [];
  const locks: boolean[] = [];
  const errors: string[] = [];
  const input = new MouseLook(target, {
    onLook: (x, y) => looks.push([x, y]),
    onLockChange: locked => locks.push(locked),
    onError: error => errors.push(error),
  });
  const lock = (element: HTMLElement | null) => {
    document.pointerLockElement = element;
    document.dispatchEvent(new Event('pointerlockchange'));
  };
  const move = (movementX: unknown, movementY: unknown) => {
    document.dispatchEvent(Object.assign(new Event('mousemove'), { movementX, movementY }));
  };
  return { input, document, view, target, other, looks, locks, errors, lock, move,
    get requests() { return requests; }, get exits() { return exits; },
    requestWith: (fn: () => Promise<void> | void) => { implementation = fn; },
  };
}

test('legacy capture starts synchronously, gates mouse deltas and reports lock loss once', () => {
  const m = mouse();
  m.move(10, 20);
  m.input.request();
  assert.equal(m.requests, 1);
  assert.equal(m.input.isLocked, false);
  m.input.request();
  assert.equal(m.requests, 1, 'duplicate clicks cannot queue overlapping requests');
  m.move(10, 20);
  m.lock(m.target);
  assert.equal(m.input.isLocked, true);
  m.move(3.5, -8);
  m.move(-200, 0.25);
  assert.deepEqual(m.looks, [[3.5, -8], [-200, 0.25]], 'pixel deltas are passed through without frame scaling');
  m.lock(null);
  m.lock(null);
  m.move(12, 20);
  assert.equal(m.input.isLocked, false);
  assert.deepEqual(m.locks, [true, false]);
  assert.equal(m.looks.length, 2);
  m.input.dispose();
});

test('invalid deltas and another element owning pointer lock never reach the camera', () => {
  const m = mouse();
  m.input.request();
  m.lock(m.target);
  for (const [x, y] of [[NaN, 2], [2, Infinity], [-Infinity, 0], ['3', 2], [2, undefined]]) m.move(x, y);
  assert.equal(m.looks.length, 0);
  m.lock(m.other);
  m.move(4, 5);
  m.input.release();
  assert.equal(m.exits, 0, 'release never exits another element\'s lock');
  assert.equal(m.document.pointerLockElement, m.other);
  assert.deepEqual(m.locks, [true, false]);
  m.input.dispose();
});

test('release and blur exit this target and stop movement immediately', () => {
  const m = mouse();
  m.input.request();
  m.lock(m.target);
  m.input.release();
  m.move(4, 9);
  assert.equal(m.exits, 1);
  assert.deepEqual(m.locks, [true, false]);
  assert.equal(m.looks.length, 0);
  m.input.request();
  m.lock(m.target);
  m.view.dispatchEvent(new Event('blur'));
  assert.equal(m.exits, 2);
  assert.deepEqual(m.locks, [true, false, true, false]);
  m.input.dispose();
});

test('modern successful request and lock-change event notify success once', async () => {
  const m = mouse();
  const request = deferred();
  m.requestWith(() => request.promise);
  m.input.request();
  m.lock(m.target);
  request.resolve();
  await request.promise;
  assert.deepEqual(m.locks, [true]);
  assert.deepEqual(m.errors, []);
  m.input.dispose();
  assert.equal(m.exits, 1);
});

test('rejections, pointer-lock error events and synchronous failures show one notice per request', async () => {
  const m = mouse();
  const first = deferred();
  m.requestWith(() => first.promise);
  m.input.request();
  m.document.dispatchEvent(new Event('pointerlockerror'));
  first.reject(new Error('Denied'));
  await first.promise.catch(() => {});
  assert.equal(m.errors.length, 1);
  const second = deferred();
  m.requestWith(() => second.promise);
  m.input.request();
  second.reject(new Error('Denied'));
  await second.promise.catch(() => {});
  m.document.dispatchEvent(new Event('pointerlockerror'));
  assert.equal(m.errors.length, 2);
  m.requestWith(() => { throw new Error('Unsupported'); });
  m.input.request();
  m.document.dispatchEvent(new Event('pointerlockerror'));
  assert.equal(m.errors.length, 3);
  assert.deepEqual(m.locks, []);
  m.input.dispose();
});

test('release cancels a pending legacy capture and exits a late lock without reporting success', () => {
  const m = mouse();
  m.input.request();
  m.input.release();
  m.input.request();
  assert.equal(m.requests, 1, 'a cancelled attempt must settle before another can start');
  m.lock(m.target);
  assert.equal(m.exits, 1);
  assert.equal(m.document.pointerLockElement, null);
  assert.deepEqual(m.locks, []);
  m.input.request();
  m.lock(m.target);
  assert.deepEqual(m.locks, [true]);
  m.input.dispose();
});

test('release cancels a pending modern capture, including Promise resolution before its event', async () => {
  const m = mouse();
  const request = deferred();
  m.requestWith(() => request.promise);
  m.input.request();
  m.input.release();
  m.document.pointerLockElement = m.target;
  request.resolve();
  await request.promise;
  m.document.dispatchEvent(new Event('pointerlockchange'));
  assert.equal(m.exits, 1);
  assert.equal(m.document.pointerLockElement, null);
  assert.deepEqual(m.locks, []);
  assert.deepEqual(m.errors, []);
  m.input.dispose();
});

test('a cancelled rejection is silent and cannot prevent a subsequent user request', async () => {
  const m = mouse();
  const request = deferred();
  m.requestWith(() => request.promise);
  m.input.request();
  m.input.release();
  request.reject(new Error('Cancelled'));
  await request.promise.catch(() => {});
  m.document.dispatchEvent(new Event('pointerlockerror'));
  assert.deepEqual(m.errors, []);
  m.requestWith(() => undefined);
  m.input.request();
  assert.equal(m.requests, 2);
  m.lock(m.target);
  assert.deepEqual(m.locks, [true]);
  m.input.dispose();
});

test('dispose exits the owned lock, removes listeners and permanently disables callbacks', () => {
  const m = mouse();
  m.input.request();
  m.lock(m.target);
  m.input.dispose();
  m.input.dispose();
  m.input.request();
  m.move(4, 5);
  m.lock(m.target);
  m.document.dispatchEvent(new Event('pointerlockerror'));
  m.view.dispatchEvent(new Event('blur'));
  assert.equal(m.exits, 1);
  assert.equal(m.requests, 1);
  assert.equal(m.document.listenerCount, 0);
  assert.equal(m.view.listenerCount, 0);
  assert.deepEqual(m.locks, [true]);
  assert.deepEqual(m.looks, []);
  assert.deepEqual(m.errors, []);
});

test('disposed pending legacy capture keeps only a settlement guard and releases a late lock', () => {
  const m = mouse();
  m.input.request();
  m.input.dispose();
  assert.equal(m.document.listeners.get('mousemove')?.size, 0);
  assert.equal(m.view.listenerCount, 0);
  m.lock(m.target);
  m.move(4, 5);
  assert.equal(m.exits, 1);
  assert.equal(m.document.pointerLockElement, null);
  assert.equal(m.document.listenerCount, 0);
  assert.deepEqual(m.locks, []);
  assert.deepEqual(m.looks, []);
});

test('disposed pending Promise capture settles silently for both failure and success', async () => {
  for (const succeeds of [false, true]) {
    const m = mouse();
    const request = deferred();
    m.requestWith(() => request.promise);
    m.input.request();
    m.input.dispose();
    if (succeeds) {
      m.document.pointerLockElement = m.target;
      request.resolve();
    } else request.reject(new Error('Disposed'));
    await request.promise.catch(() => {});
    assert.equal(m.document.pointerLockElement, null);
    assert.equal(m.document.listenerCount, 0);
    assert.equal(m.exits, succeeds ? 1 : 0);
    assert.deepEqual(m.locks, []);
    assert.deepEqual(m.errors, []);
  }
});

test('unsupported browsers report an actionable message instead of throwing', () => {
  const m = mouse();
  Object.defineProperty(m.target, 'requestPointerLock', { value: undefined });
  assert.doesNotThrow(() => m.input.request());
  assert.match(m.errors[0], /unavailable/i);
  assert.equal(m.input.isLocked, false);
  m.input.dispose();
  assert.equal(m.document.listenerCount, 0);
});
