import {
  backspace as identBackspace,
  entryValue,
  startEntry,
  turnLarge,
  turnSmall,
  typeChar,
  type Completer,
  type IdentEntry,
} from '../../ui/identEntry';

/*
 * The GTN "Waypoint Identifier" keyboard. Keys type at the cursor and the
 * field autofills (cyan) with the first identifier in the database that
 * starts with what was typed. The dual knob edits the same field: the small
 * knob changes the character under the cursor, the large knob moves it.
 * Built on the shared Garmin spell-ahead entry.
 */

export type KeyboardAction =
  | { readonly type: 'char'; readonly ch: string }
  | { readonly type: 'backspace' }
  | { readonly type: 'small'; readonly steps: number }
  | { readonly type: 'large'; readonly steps: number }
  | { readonly type: 'set'; readonly ident: string };

export function startKeyboard(initial = ''): IdentEntry {
  return startEntry(initial);
}

export function keyboardReducer(e: IdentEntry, a: KeyboardAction, complete: Completer): IdentEntry {
  switch (a.type) {
    case 'char':
      return typeChar(e, a.ch, complete);
    case 'backspace':
      return identBackspace(e, complete);
    case 'small':
      return turnSmall(e, a.steps, complete);
    case 'large':
      return turnLarge(e, a.steps);
    case 'set':
      return { text: a.ident.toUpperCase(), cursor: Math.min(a.ident.length, 5), entered: a.ident.length };
  }
}

/** The field split for display: what the pilot entered and the autofilled rest. */
export function keyboardSplit(e: IdentEntry): { typed: string; fill: string } {
  const text = e.text.trimEnd();
  const n = Math.min(e.entered, text.length);
  return { typed: text.slice(0, n), fill: text.slice(n) };
}

/** The identifier Enter accepts: everything shown, autofill included. */
export function keyboardIdent(e: IdentEntry): string {
  return entryValue(e);
}

/** What the pilot actually typed, the prefix FastFind searches with. */
export function typedPrefix(e: IdentEntry): string {
  return keyboardSplit(e).typed;
}
