import test from 'node:test';
import assert from 'node:assert/strict';
import { Input } from '../src/game/input';

class MockInputElement {}
class MockTextAreaElement {}
Object.defineProperty(globalThis, 'HTMLInputElement', { value: MockInputElement, configurable: true });
Object.defineProperty(globalThis, 'HTMLTextAreaElement', { value: MockTextAreaElement, configurable: true });

function keyboard(target?: HTMLElement) {
  const events = new EventTarget();
  Object.defineProperty(globalThis, 'window', { value: events, configurable: true });
  const actions: string[] = [];
  const input = new Input(code => actions.push(code), target);
  const send = (type: string, code: string, options: Record<string, unknown> = {}) => {
    const { target: eventTarget, ...properties } = options;
    const event = Object.assign(new Event(type, { cancelable: true }), { code, repeat: false, ctrlKey: false, metaKey: false, altKey: false, ...properties });
    if (eventTarget) Object.defineProperty(event, 'target', { value: eventTarget });
    events.dispatchEvent(event);
    return event;
  };
  return { input, actions, events, send };
}

test('movement taps shorter than a frame are retained, while held input persists', () => {
  const { input, send } = keyboard();
  send('keydown', 'KeyW'); send('keyup', 'KeyW');
  assert.equal(input.sample().forward, 1);
  assert.equal(input.sample().forward, 0);
  send('keydown', 'KeyD');
  assert.equal(input.sample().turn, 1);
  assert.equal(input.sample().turn, 1);
  send('keyup', 'KeyD');
  assert.equal(input.sample().turn, 0);
  input.dispose();
});

test('interaction is one-shot per press and OS key repeat cannot repeatedly enter and exit', () => {
  const { input, send } = keyboard();
  send('keydown', 'KeyE');
  assert.equal(input.sample().interact, true);
  send('keydown', 'KeyE', { repeat: true });
  assert.equal(input.sample().interact, false);
  send('keyup', 'KeyE'); send('keydown', 'KeyE');
  assert.equal(input.sample().interact, true);
  input.dispose();
});

test('losing focus releases all controls; disposed input cannot react to events', () => {
  const { input, send, events, actions } = keyboard();
  send('keydown', 'KeyW'); send('keydown', 'KeyE');
  events.dispatchEvent(new Event('blur'));
  assert.deepEqual(input.sample(), { forward: 0, turn: 0, interact: false, restart: false, brake: false, sprint: false, fire: false, aiming: false, reload: false });
  input.dispose();
  send('keydown', 'KeyW'); send('keydown', 'KeyH');
  assert.equal(input.sample().forward, 0);
  assert.equal(actions.length, 0);
});

test('arrow controls prevent scrolling, shortcuts ignore repeat, and browser shortcuts stay intact', () => {
  const { input, send, actions } = keyboard();
  const arrow = send('keydown', 'ArrowUp');
  assert.equal(arrow.defaultPrevented, true);
  assert.equal(input.sample().forward, 1);
  send('keydown', 'KeyH'); send('keydown', 'KeyH', { repeat: true });
  assert.deepEqual(actions, ['KeyH']);
  const browserShortcut = send('keydown', 'KeyR', { ctrlKey: true });
  assert.equal(browserShortcut.defaultPrevented, false);
  assert.equal(input.sample().restart, false);
  input.dispose();
});

function mouseControls() {
  const document = Object.assign(new EventTarget(), { pointerLockElement: null as unknown });
  const canvas = { nodeType: 1, closest: () => null };
  const button = { nodeType: 1, closest: () => ({}) };
  const target = { ownerDocument: document, closest: () => null, contains: (node: unknown) => node === canvas || node === button };
  const controls = keyboard(target as unknown as HTMLElement);
  const lock = (value: unknown = target) => {
    document.pointerLockElement = value;
    document.dispatchEvent(new Event('pointerlockchange'));
  };
  const mouse = (type: string, mouseButton: number, options: Record<string, unknown> = {}) =>
    controls.send(type, '', { button: mouseButton, target, ...options });
  return { ...controls, target, canvas, button, lock, mouse };
}

test('R reloads once per key press, T restarts the mission, and the last weapon shortcut wins', () => {
  const { input, send } = keyboard();
  send('keydown', 'KeyR');
  const reload = input.sample();
  assert.equal(reload.reload, true);
  assert.equal(reload.restart, false);
  send('keydown', 'KeyR', { repeat: true });
  assert.equal(input.sample().reload, false);
  send('keydown', 'KeyT'); send('keyup', 'KeyT');
  assert.equal(input.sample().restart, true);
  assert.equal(input.sample().restart, false);
  for (const [code, weapon] of [['Digit1', 'knife'], ['Digit2', 'pistol'], ['Digit3', 'rifle']]) {
    send('keydown', code); send('keyup', code);
    assert.equal(input.sample().weapon, weapon);
    assert.equal(input.sample().weapon, undefined);
  }
  send('keydown', 'Digit3'); send('keydown', 'Digit1'); send('keydown', 'Digit2');
  assert.equal(input.sample().weapon, 'pistol');
  input.dispose();
});

test('locked LMB retains a short attack tap and held fire persists until release', () => {
  const { input, lock, mouse, canvas } = mouseControls();
  lock();
  const press = mouse('mousedown', 0, { target: canvas });
  assert.equal(press.defaultPrevented, true);
  mouse('mouseup', 0);
  assert.equal(input.sample().fire, true);
  assert.equal(input.sample().fire, false);
  mouse('mousedown', 0);
  assert.equal(input.sample().fire, true);
  assert.equal(input.sample().fire, true);
  mouse('mouseup', 0);
  assert.equal(input.sample().fire, false);
  input.dispose();
});

test('aim is held only while captured, and focus or pointer lock loss clears every combat action', () => {
  const { input, lock, mouse, send, events } = mouseControls();
  lock(); mouse('mousedown', 2);
  assert.equal(input.sample().aiming, true);
  assert.equal(mouse('contextmenu', 2).defaultPrevented, true);
  mouse('mouseup', 2);
  assert.equal(input.sample().aiming, false);
  for (const loseFocus of [() => lock(null), () => events.dispatchEvent(new Event('blur'))]) {
    lock(); mouse('mousedown', 0); mouse('mousedown', 2);
    send('keydown', 'KeyR'); send('keydown', 'Digit3');
    loseFocus();
    const cleared = input.sample();
    assert.equal(cleared.fire, false); assert.equal(cleared.aiming, false);
    assert.equal(cleared.reload, false); assert.equal(cleared.weapon, undefined);
    lock();
    assert.equal(input.sample().fire, false, 'relocking must never replay a held attack');
  }
  input.dispose();
});

test('menu clicks, another pointer capture, touch emulation and browser shortcuts cannot attack', () => {
  const { input, lock, mouse, button } = mouseControls();
  assert.equal(mouse('mousedown', 0).defaultPrevented, false);
  assert.equal(input.sample().fire, false);
  assert.equal(mouse('contextmenu', 2).defaultPrevented, false);
  lock({}); mouse('mousedown', 0);
  assert.equal(input.sample().fire, false);
  lock();
  for (const options of [{ target: button }, { target: new EventTarget() }, { sourceCapabilities: { firesTouchEvents: true } }, { ctrlKey: true }]) {
    mouse('mousedown', 0, options);
    assert.equal(input.sample().fire, false);
  }
  input.dispose();
  mouse('mousedown', 0);
  assert.equal(input.sample().fire, false);
});

test('typing into form fields or editable UI does not reload, equip, interact or move', () => {
  const { input, send } = keyboard();
  for (const target of [new MockInputElement(), new MockTextAreaElement(), { closest: () => ({}) }]) {
    for (const code of ['KeyR', 'Digit2', 'KeyE', 'KeyW']) {
      assert.equal(send('keydown', code, { target }).defaultPrevented, false);
    }
    const controls = input.sample();
    assert.equal(controls.reload, false); assert.equal(controls.weapon, undefined);
    assert.equal(controls.interact, false); assert.equal(controls.forward, 0);
  }
  input.dispose();
});

test('touch movement and combat work simultaneously without pointer lock', () => {
  const { input } = keyboard();
  input.moveTouch(.75, -.5);
  input.pressTouch('Fire'); input.pressTouch('Aim'); input.pressTouch('ShiftLeft');
  const frame = input.sample();
  assert.equal(frame.forward, .75); assert.equal(frame.turn, -.5);
  assert.equal(frame.fire, true); assert.equal(frame.aiming, true); assert.equal(frame.sprint, true);
  input.releaseTouch('Fire'); input.releaseTouch('Aim'); input.releaseTouch('ShiftLeft');
  const released = input.sample();
  assert.equal(released.fire, false); assert.equal(released.aiming, false); assert.equal(released.sprint, false);
  assert.equal(released.forward, .75);
  input.dispose();
});

test('quick touch taps survive one tick and interaction does not repeat while held', () => {
  const { input } = keyboard();
  input.pressTouch('Fire'); input.releaseTouch('Fire'); input.pressTouch('KeyE');
  input.pressTouch('Digit3'); input.releaseTouch('Digit3');
  assert.deepEqual([input.sample().weapon, input.sample().interact], ['rifle', false]);
  assert.equal(input.sample().fire, false);
  input.pressTouch('KeyE'); assert.equal(input.sample().interact, false);
  input.releaseTouch('KeyE'); input.pressTouch('KeyE');
  assert.equal(input.sample().interact, true);
  input.pressTouch('Fire'); input.releaseTouch('Fire');
  assert.equal(input.sample().fire, true); assert.equal(input.sample().fire, false);
  input.dispose();
});

test('blur clears every touch control and queued action', () => {
  const { input, events } = keyboard();
  input.moveTouch(1, 1); input.pressTouch('Fire'); input.pressTouch('Aim');
  input.pressTouch('Space'); input.pressTouch('KeyR'); input.pressTouch('Digit2');
  events.dispatchEvent(new Event('blur'));
  assert.deepEqual(input.sample(), { forward: 0, turn: 0, brake: false, sprint: false, interact: false, restart: false, fire: false, aiming: false, reload: false });
  input.dispose();
});

test('touch axes are bounded and releasing touch leaves keyboard movement intact', () => {
  const { input, send } = keyboard();
  input.moveTouch(4, -4);
  assert.equal(input.sample().forward, 1); assert.equal(input.sample().turn, -1);
  input.moveTouch(NaN, Infinity);
  assert.equal(input.sample().forward, 0); assert.equal(input.sample().turn, 0);
  send('keydown', 'KeyW'); input.moveTouch(.5, 0);
  assert.equal(input.sample().forward, 1);
  input.clearTouch(); assert.equal(input.sample().forward, 1);
  input.dispose();
});
