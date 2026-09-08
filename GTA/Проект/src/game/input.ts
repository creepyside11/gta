import type { InputFrame, WeaponId } from './types';

const GAME_KEYS = new Set(['KeyW', 'KeyA', 'KeyS', 'KeyD', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space', 'KeyE', 'KeyR', 'KeyT', 'Digit1', 'Digit2', 'Digit3', 'ShiftLeft', 'ShiftRight', 'Escape', 'KeyP', 'KeyH', 'KeyM', 'KeyC', 'KeyN']);
const WEAPON_KEYS: Record<string, WeaponId> = { Digit1: 'knife', Digit2: 'pistol', Digit3: 'rifle' };

export class Input {
  private keys = new Set<string>();
  private actions = new Set<string>();
  private buttons = new Set<number>();
  private touchButtons = new Set<string>();
  private touchForward = 0;
  private touchTurn = 0;
  private touchFireTap = false;
  private fireTap = false;
  moveTouch(forward: number, turn: number) {
    this.touchForward = Number.isFinite(forward) ? Math.max(-1, Math.min(1, forward)) : 0;
    this.touchTurn = Number.isFinite(turn) ? Math.max(-1, Math.min(1, turn)) : 0;
  }
  pressTouch(code: string) {
    if (this.touchButtons.has(code)) return;
    this.touchButtons.add(code);
    if (code === 'Fire') this.touchFireTap = true;
    else {
      this.actions.add(code);
      if (WEAPON_KEYS[code]) this.weapon = WEAPON_KEYS[code];
    }
  }
  releaseTouch(code: string) { this.touchButtons.delete(code); }
  clearTouch() {
    this.touchButtons.clear(); this.touchForward = 0; this.touchTurn = 0; this.touchFireTap = false;
  }
  private weapon: WeaponId | undefined;
  constructor(private onAction: (code: string) => void, private target?: HTMLElement) {
    window.addEventListener('keydown', this.down);
    window.addEventListener('keyup', this.up);
    window.addEventListener('blur', this.clear);
    window.addEventListener('mousedown', this.mouseDown);
    window.addEventListener('mouseup', this.mouseUp);
    window.addEventListener('contextmenu', this.contextMenu);
    this.target?.ownerDocument.addEventListener('pointerlockchange', this.clear);
  }
  private down = (e: KeyboardEvent) => {
    if (!GAME_KEYS.has(e.code) || e.ctrlKey || e.altKey || e.metaKey) return;
    if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement ||
      (e.target as HTMLElement | null)?.closest?.('select,[contenteditable="true"],[contenteditable=""],[role="textbox"]')) return;
    e.preventDefault();
    if (!e.repeat && !this.keys.has(e.code)) {
      if (['Escape', 'KeyP', 'KeyH', 'KeyM', 'KeyC', 'KeyN'].includes(e.code)) this.onAction(e.code);
      else {
        this.actions.add(e.code);
        if (WEAPON_KEYS[e.code]) this.weapon = WEAPON_KEYS[e.code];
      }
    }
    this.keys.add(e.code);
  };
  private up = (e: KeyboardEvent) => { this.keys.delete(e.code); };
  private get mouseLocked(): boolean { return !!this.target && this.target.ownerDocument.pointerLockElement === this.target; }
  private mouseDown = (event: MouseEvent): void => {
    if (!this.mouseLocked || !this.target || event.ctrlKey || event.altKey || event.metaKey) return;
    if (event.button !== 0 && event.button !== 2) return;
    if (event.target !== this.target && (!(event.target && 'nodeType' in event.target) || !this.target.contains(event.target as Node))) return;
    if ((event.target as HTMLElement | null)?.closest?.('button,a,input,textarea,select,[contenteditable],[role="button"]')) return;
    if ((event as MouseEvent & { sourceCapabilities?: { firesTouchEvents: boolean } }).sourceCapabilities?.firesTouchEvents) return;
    event.preventDefault();
    this.buttons.add(event.button);
    if (event.button === 0) this.fireTap = true;
  };
  private mouseUp = (event: MouseEvent): void => { this.buttons.delete(event.button); };
  private contextMenu = (event: MouseEvent): void => { if (this.mouseLocked) event.preventDefault(); };
  clear = () => { this.clearTouch(); this.keys.clear(); this.actions.clear(); this.buttons.clear(); this.fireTap = false; this.weapon = undefined; };
  sample(): InputFrame {
    // Preserve taps shorter than a render frame as one simulation tick.
    const has = (...codes: string[]) => codes.some(code => this.keys.has(code) || this.touchButtons.has(code) || this.actions.has(code)) ? 1 : 0;
    const result: InputFrame = {
      forward: Math.max(-1, Math.min(1, this.touchForward + has('KeyW', 'ArrowUp') - has('KeyS', 'ArrowDown'))),
      turn: Math.max(-1, Math.min(1, this.touchTurn + has('KeyD', 'ArrowRight') - has('KeyA', 'ArrowLeft'))),
      brake: !!has('Space'), sprint: !!has('ShiftLeft', 'ShiftRight'),
      interact: this.actions.has('KeyE'), restart: this.actions.has('KeyT'),
      fire: this.touchButtons.has('Fire') || this.touchFireTap || (this.mouseLocked && (this.buttons.has(0) || this.fireTap)),
      aiming: this.touchButtons.has('Aim') || (this.mouseLocked && this.buttons.has(2)), reload: this.actions.has('KeyR'),
      ...(this.weapon ? { weapon: this.weapon } : {}),
    };
    this.actions.clear();
    this.touchFireTap = false;
    this.fireTap = false;
    this.weapon = undefined;
    return result;
  }
  dispose() {
    this.clear();
    window.removeEventListener('keydown', this.down);
    window.removeEventListener('keyup', this.up);
    window.removeEventListener('blur', this.clear);
    window.removeEventListener('mousedown', this.mouseDown);
    window.removeEventListener('mouseup', this.mouseUp);
    window.removeEventListener('contextmenu', this.contextMenu);
    this.target?.ownerDocument.removeEventListener('pointerlockchange', this.clear);
  }
}
