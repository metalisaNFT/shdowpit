/**
 * Input abstraction.
 *
 * Everything downstream reads *actions*, never raw keys, so adding a gamepad
 * or touch layer later is a matter of writing into the same action table.
 */

export type Action =
  | 'light'
  | 'heavy'
  | 'dodge'
  | 'parry'
  | 'ranged'
  | 'interact'
  | 'sprint'
  | 'hierarchy'
  | 'pause'
  | 'lockon'
  | 'debug'
  | 'log'
  | 'skill1'
  | 'skill2'
  | 'ultimate';

const ACTIONS: Action[] = [
  'light',
  'heavy',
  'dodge',
  'parry',
  'ranged',
  'interact',
  'sprint',
  'hierarchy',
  'pause',
  'lockon',
  'debug',
  'log',
  'skill1',
  'skill2',
  'ultimate',
];

/** Default keyboard/mouse binding. Mouse buttons use the `Mouse0` form. */
const DEFAULT_BINDS: Record<string, Action> = {
  Mouse0: 'light',
  Mouse2: 'heavy',
  Space: 'dodge',
  KeyQ: 'parry',
  // VOID NEEDLE — middle mouse or R; lock-on keeps F.
  Mouse1: 'ranged',
  KeyR: 'ranged',
  KeyE: 'interact',
  ShiftLeft: 'sprint',
  ShiftRight: 'sprint',
  Tab: 'hierarchy',
  Escape: 'pause',
  KeyF: 'lockon',
  F1: 'debug',
  KeyL: 'log',
  Digit1: 'skill1',
  KeyC: 'skill1',
  Digit2: 'skill2',
  KeyV: 'skill2',
  Digit3: 'ultimate',
  KeyG: 'ultimate',
};

interface ActionState {
  down: boolean;
  /** went down this frame */
  pressed: boolean;
  /** went up this frame */
  released: boolean;
  /** performance.now() of the last press — used for input buffering */
  lastPress: number;
  /** consumed marker so a buffered press is only spent once */
  consumed: boolean;
}

export class Input {
  readonly moveX = 0;
  private keys = new Set<string>();
  private state: Record<Action, ActionState>;
  private binds: Record<string, Action> = { ...DEFAULT_BINDS };

  /** Accumulated mouse delta since last frame (pointer-lock pixels). */
  lookDX = 0;
  lookDY = 0;
  /** Accumulated wheel delta since last frame. */
  wheel = 0;

  /** Raw movement axes in the -1..1 range, already normalised. */
  axisX = 0;
  axisY = 0;

  mouseSensitivity = 0.0022;
  invertY = false;

  private pointerLocked = false;
  private enabled = true;
  private el: HTMLElement;
  private detachers: Array<() => void> = [];

  constructor(el: HTMLElement) {
    this.el = el;
    this.state = {} as Record<Action, ActionState>;
    for (const a of ACTIONS) {
      this.state[a] = { down: false, pressed: false, released: false, lastPress: -1e9, consumed: true };
    }
    this.attach();
  }

  private attach(): void {
    const onKeyDown = (e: KeyboardEvent) => {
      // Never let the browser steal Tab / Space / F1 from us.
      if (e.code === 'Tab' || e.code === 'Space' || e.code === 'F1') e.preventDefault();
      if (e.repeat) return;
      this.keys.add(e.code);
      const a = this.binds[e.code];
      if (a) this.press(a);
    };
    const onKeyUp = (e: KeyboardEvent) => {
      this.keys.delete(e.code);
      const a = this.binds[e.code];
      if (a) this.release(a);
    };
    const onMouseDown = (e: MouseEvent) => {
      if (!this.pointerLocked) return;
      const a = this.binds['Mouse' + e.button];
      if (a) this.press(a);
    };
    const onMouseUp = (e: MouseEvent) => {
      const a = this.binds['Mouse' + e.button];
      if (a) this.release(a);
    };
    const onMouseMove = (e: MouseEvent) => {
      if (!this.pointerLocked) return;
      this.lookDX += e.movementX;
      this.lookDY += e.movementY;
    };
    const onWheel = (e: WheelEvent) => {
      if (!this.pointerLocked) return;
      e.preventDefault();
      this.wheel += Math.sign(e.deltaY);
    };
    const onContext = (e: Event) => e.preventDefault();
    const onLockChange = () => {
      this.pointerLocked = document.pointerLockElement === this.el;
      if (!this.pointerLocked) {
        // Release everything so the player doesn't sprint forever after alt-tab.
        this.releaseAll();
      }
    };
    const onBlur = () => this.releaseAll();

    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    window.addEventListener('mousedown', onMouseDown);
    window.addEventListener('mouseup', onMouseUp);
    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('wheel', onWheel, { passive: false });
    window.addEventListener('contextmenu', onContext);
    document.addEventListener('pointerlockchange', onLockChange);
    window.addEventListener('blur', onBlur);

    this.detachers.push(() => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('mousedown', onMouseDown);
      window.removeEventListener('mouseup', onMouseUp);
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('wheel', onWheel);
      window.removeEventListener('contextmenu', onContext);
      document.removeEventListener('pointerlockchange', onLockChange);
      window.removeEventListener('blur', onBlur);
    });
  }

  dispose(): void {
    for (const d of this.detachers) d();
    this.detachers = [];
  }

  private press(a: Action): void {
    const s = this.state[a];
    if (s.down) return;
    s.down = true;
    s.pressed = true;
    s.lastPress = performance.now();
    s.consumed = false;
  }

  private release(a: Action): void {
    const s = this.state[a];
    if (!s.down) return;
    s.down = false;
    s.released = true;
  }

  private releaseAll(): void {
    this.keys.clear();
    for (const a of ACTIONS) {
      this.state[a].down = false;
    }
  }

  /** Menus set this false so gameplay stops reading movement. */
  setEnabled(v: boolean): void {
    this.enabled = v;
    if (!v) this.releaseAll();
  }

  /** Harness hook — inject a press without pointer lock or DOM events. */
  simulatePress(a: Action): void {
    this.press(a);
  }

  requestPointerLock(): void {
    if (!this.pointerLocked && this.el.requestPointerLock) {
      const p = this.el.requestPointerLock() as unknown as Promise<void> | undefined;
      if (p && typeof p.catch === 'function') p.catch(() => void 0);
    }
  }

  exitPointerLock(): void {
    if (this.pointerLocked) document.exitPointerLock();
  }

  get isPointerLocked(): boolean {
    return this.pointerLocked;
  }

  /** Call once per frame, before systems read input. */
  beginFrame(): void {
    // Movement axes from WASD (also arrow keys).
    let x = 0;
    let y = 0;
    if (this.enabled) {
      if (this.keys.has('KeyA') || this.keys.has('ArrowLeft')) x -= 1;
      if (this.keys.has('KeyD') || this.keys.has('ArrowRight')) x += 1;
      if (this.keys.has('KeyW') || this.keys.has('ArrowUp')) y += 1;
      if (this.keys.has('KeyS') || this.keys.has('ArrowDown')) y -= 1;
    }
    const len = Math.hypot(x, y);
    if (len > 1e-4) {
      x /= len;
      y /= len;
    }
    this.axisX = x;
    this.axisY = y;
  }

  /** Call once per frame, after systems read input. */
  endFrame(): void {
    for (const a of ACTIONS) {
      this.state[a].pressed = false;
      this.state[a].released = false;
    }
    this.lookDX = 0;
    this.lookDY = 0;
    this.wheel = 0;
  }

  down(a: Action): boolean {
    return this.state[a].down;
  }

  pressed(a: Action): boolean {
    return this.state[a].pressed;
  }

  released(a: Action): boolean {
    return this.state[a].released;
  }

  /**
   * Input buffering: returns true if the action was pressed within `window` ms
   * and has not been consumed yet. This is what makes combos feel responsive
   * when you mash slightly early.
   */
  buffered(a: Action, windowMs = 220): boolean {
    const s = this.state[a];
    return !s.consumed && performance.now() - s.lastPress <= windowMs;
  }

  consume(a: Action): void {
    this.state[a].consumed = true;
  }

  /** Consumes and returns true in one call. */
  takeBuffered(a: Action, windowMs = 220): boolean {
    if (this.buffered(a, windowMs)) {
      this.consume(a);
      return true;
    }
    return false;
  }

  /**
   * Called at every state transition (run start, resume, closing a screen).
   *
   * This clears the `pressed`/`released` edges as well as the buffer, and it
   * has to. The keydown that closes a menu is dispatched before the next
   * frame runs, so without this the very next `handlePlayingInput` still sees
   * that same press and acts on it again — which made ESC-to-resume reopen the
   * pause menu instantly, leaving no way out of it with the keyboard.
   *
   * Note this is NOT the same as consuming a buffered input on success (see
   * `buffered`/`consume`): buffering across recovery frames is deliberate and
   * still works. This only drops the one-frame edge.
   */
  clearBuffers(): void {
    for (const a of ACTIONS) {
      const s = this.state[a];
      s.consumed = true;
      s.pressed = false;
      s.released = false;
    }
  }
}
