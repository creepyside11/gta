interface MouseLookCallbacks {
  onLook(dx: number, dy: number): void;
  onLockChange(locked: boolean): void;
  onError(message: string): void;
}

interface LockRequest {
  cancelled: boolean;
  settled: boolean;
}

/** Owns pointer capture only; the camera decides how to apply mouse deltas. */
export class MouseLook {
  private readonly document: Document;
  private readonly view: Window | null;
  private pending: LockRequest | null = null;
  private wanted = false;
  private locked = false;
  private disposed = false;

  constructor(private target: HTMLElement, private callbacks: MouseLookCallbacks) {
    this.document = target.ownerDocument;
    this.view = this.document.defaultView;
    this.document.addEventListener('mousemove', this.move);
    this.document.addEventListener('pointerlockchange', this.change);
    this.document.addEventListener('pointerlockerror', this.error);
    this.view?.addEventListener('blur', this.release);
  }

  get isLocked(): boolean {
    return !this.disposed && this.wanted && this.locked && this.document.pointerLockElement === this.target;
  }

  /** Call directly from a user gesture so the browser receives its activation. */
  request(): void {
    if (this.disposed || this.pending || this.isLocked) return;
    if (typeof this.target.requestPointerLock !== 'function') {
      this.callbacks.onError('Mouse control is unavailable in this browser.');
      return;
    }
    const attempt: LockRequest = { cancelled: false, settled: false };
    this.pending = attempt;
    this.wanted = true;
    try {
      // No options are required; older browsers return void instead of a Promise.
      const result: Promise<void> | void = this.target.requestPointerLock();
      if (result && typeof result.then === 'function') {
        void result.then(() => {
          if (!attempt.settled && this.document.pointerLockElement === this.target) this.change();
        }, () => this.fail(attempt));
      }
    } catch {
      this.fail(attempt);
    }
  }

  release = (): void => {
    this.wanted = false;
    if (this.pending) this.pending.cancelled = true;
    this.setLocked(false);
    this.exitOwnLock();
  };

  private move = (event: MouseEvent): void => {
    if (!this.isLocked || !Number.isFinite(event.movementX) || !Number.isFinite(event.movementY)) return;
    this.callbacks.onLook(event.movementX, event.movementY);
  };

  private setLocked(value: boolean): void {
    if (value === this.locked) return;
    this.locked = value;
    if (!this.disposed) this.callbacks.onLockChange(value);
  }

  private settle(attempt: LockRequest): void {
    attempt.settled = true;
    if (this.pending === attempt) this.pending = null;
    if (this.disposed) this.removeLockListeners();
  }

  private change = (): void => {
    if (this.document.pointerLockElement === this.target) {
      const cancelled = this.disposed || !this.wanted || this.pending?.cancelled;
      if (this.pending) this.settle(this.pending);
      if (cancelled) {
        this.exitOwnLock();
        return;
      }
      this.setLocked(true);
    } else if (this.locked) {
      this.wanted = false;
      this.setLocked(false);
    }
  };

  private error = (): void => {
    if (this.pending) this.fail(this.pending);
  };

  private fail(attempt: LockRequest): void {
    if (attempt.settled) return;
    this.settle(attempt);
    this.wanted = false;
    this.setLocked(false);
    if (!this.disposed && !attempt.cancelled) {
      this.callbacks.onError('Mouse control could not start. Click the game to try again.');
    }
  }

  private exitOwnLock(): void {
    if (this.document.pointerLockElement === this.target) this.document.exitPointerLock();
  }

  private removeLockListeners(): void {
    this.document.removeEventListener('pointerlockchange', this.change);
    this.document.removeEventListener('pointerlockerror', this.error);
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.document.removeEventListener('mousemove', this.move);
    this.view?.removeEventListener('blur', this.release);
    this.release();
    // A void-returning legacy request has no cancellation API. Keep only its
    // settlement listeners until we can release a late lock, without callbacks.
    if (!this.pending) this.removeLockListeners();
  }
}
