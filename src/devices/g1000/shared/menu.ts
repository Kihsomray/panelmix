/*
 * Pop-up lists driven by the FMS knob: the PAGE MENU (MENU key), the
 * PROCEDURES options, and two-choice confirmation windows such as
 * "Remove KJYO?  OK or CANCEL". Disabled items are listed in gray and the
 * cursor skips them, as on the real unit.
 */

export interface MenuItem {
  readonly id: string;
  readonly label: string;
  readonly enabled: boolean;
}

export interface PageMenu {
  readonly title: string;
  readonly items: readonly MenuItem[];
  /** Highlighted item, or -1 when nothing can be selected. */
  readonly cursor: number;
}

export function openMenu(items: readonly MenuItem[], title = 'PAGE MENU'): PageMenu {
  return { title, items, cursor: items.findIndex((i) => i.enabled) };
}

export function menuMove(m: PageMenu, steps: number): PageMenu {
  if (m.cursor < 0 || steps === 0) return m;
  const dir = Math.sign(steps);
  let cursor = m.cursor;
  for (let n = Math.abs(steps); n > 0; n--) {
    let next = cursor + dir;
    while (next >= 0 && next < m.items.length && !m.items[next]!.enabled) next += dir;
    if (next < 0 || next >= m.items.length) break;
    cursor = next;
  }
  return cursor === m.cursor ? m : { ...m, cursor };
}

export function menuSelection(m: PageMenu): string | null {
  const item = m.items[m.cursor];
  return item && item.enabled ? item.id : null;
}

export interface Confirm {
  readonly id: string;
  /** Leg shown above the question (Activate Leg window), e.g. "KJYO → MRB". */
  readonly leg?: string;
  readonly message: string;
  readonly ok: string;
  readonly cancel: string;
  /** 0 = the OK choice, 1 = CANCEL. */
  readonly choice: 0 | 1;
  /** What the question is about (a plan index). */
  readonly arg: number | null;
}

export function openConfirm(id: string, message: string, arg: number | null = null, ok = 'OK', leg?: string): Confirm {
  return { id, message, ok, cancel: 'CANCEL', choice: 0, arg, ...(leg !== undefined ? { leg } : {}) };
}

export function confirmMove(c: Confirm, steps: number): Confirm {
  if (steps === 0) return c;
  return { ...c, choice: steps > 0 ? 1 : 0 };
}
