import type { SoftkeyRow } from '../shared/softkeys';

/*
 * The twelve softkey label boxes along the bottom of the display. A label
 * shown black on gray is a function that is on (TOPO, the selected wind
 * option...); gray text is a function not available right now. An alert
 * turns the ALERTS key into a flashing WARNING, CAUTION or ADVISORY.
 */

export function SoftkeyBar({ keys, blink }: { keys: SoftkeyRow; blink: boolean }) {
  return (
    <div class="g1000-softkeys">
      {keys.map((k, i) => {
        if (!k) return <div key={i} class="g1000-sk" />;
        const alert = k.alert && blink ? ` is-${k.alert}` : '';
        return (
          <div key={i} class={`g1000-sk${k.on ? ' is-on' : ''}${k.disabled ? ' is-disabled' : ''}${alert}`}>
            {k.label}
          </div>
        );
      })}
    </div>
  );
}

/** Labels for the bezel's softkey buttons (accessible names), "|"-joined so a memo can compare them cheaply. */
export function softkeyNames(keys: SoftkeyRow): string {
  return keys.map((k) => (k && !k.disabled ? k.label : '')).join('|');
}
