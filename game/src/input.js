// PALM COAST build v2 by recorded agent
// PALM COAST — committed in this session.
// Keyboard input. Axes are read every frame; one-shot presses (enter/exit car, pause,
// confirm) are queued as bit flags and taken once by the loop, so a press between two
// frames is never lost and never counted twice.

export const ACT_ENTER = 1;
export const ACT_PAUSE = 2;
export const ACT_CONFIRM = 4;
export const ACT_NEWGAME = 8;

const LEFT = new Set(['ArrowLeft', 'KeyA']);
const RIGHT = new Set(['ArrowRight', 'KeyD']);
const UP = new Set(['ArrowUp', 'KeyW']);
const DOWN = new Set(['ArrowDown', 'KeyS']);
const ENTER_KEY = new Set(['KeyE']);
const CONFIRM = new Set(['Enter']);
const NEWGAME = new Set(['KeyN']);
const PAUSE = new Set(['KeyP', 'Escape']);

export function createInput() {
  const held = new Set();
  let actions = 0;

  window.addEventListener('keydown', (event) => {
    const code = event.code;
    if (LEFT.has(code) || RIGHT.has(code) || UP.has(code) || DOWN.has(code)) held.add(code);
    else if (ENTER_KEY.has(code)) {
      if (!event.repeat) actions |= ACT_ENTER;
    } else if (CONFIRM.has(code)) {
      if (!event.repeat) actions |= ACT_CONFIRM;
    } else if (NEWGAME.has(code)) {
      if (!event.repeat) actions |= ACT_NEWGAME;
    } else if (PAUSE.has(code)) {
      if (!event.repeat) actions |= ACT_PAUSE;
    } else if (code === 'Space' || code === 'KeyF') {
      held.add('FIRE');
    } else if (code === 'KeyM') {
      if (!event.repeat) actions |= 16; // ACT_MUTE, handled by main via bit 16
    } else return;
    event.preventDefault();
  });
  window.addEventListener('keyup', (event) => {
    held.delete(event.code);
    if (event.code === 'Space' || event.code === 'KeyF') held.delete('FIRE');
  });
  // A key released while the tab is hidden never sends keyup: let go of everything on blur.
  window.addEventListener('blur', () => held.clear());

  return {
    /** -1..1 horizontal, -1..1 vertical (screen coordinates: down is +1). */
    axes() {
      return {
        ax: (RIGHT.has('ArrowRight') || RIGHT.has('KeyD') ? 1 : 0) - (LEFT.has('ArrowLeft') || LEFT.has('KeyA') ? 1 : 0),
        ay: (DOWN.has('ArrowDown') || DOWN.has('KeyS') ? 1 : 0) - (UP.has('ArrowUp') || UP.has('KeyW') ? 1 : 0),
      };
    },
    /** Fire (pistol) held. */
    firing() {
      return held.has('FIRE');
    },
    /** The one-shot presses since the last call, as ACT_* flags (bit 16 = mute). */
    takeActions() {
      const taken = actions;
      actions = 0;
      return taken;
    },
  };
}
