import type { KapDisplay as KapDisplayModel, KapRight } from './kap140Logic';
import { KAP_LCD, SegChar, SegText } from './segments';

/*
 * The KAP 140 LCD: roll modes on the left (active above, armed below with
 * ARM), the [AP] box, pitch modes in the middle, the PT trim annunciator and
 * the five-digit readout with its unit labels on the right.
 */

const L = KAP_LCD;

/** The readout digits, right-aligned in five cells, and which separator to light. */
function readoutDigits(r: KapRight): { chars: string[]; comma: boolean; point: boolean } {
  let text: string;
  let comma = false;
  let point = false;
  switch (r.kind) {
    case 'ALT':
      text = String(Math.max(Math.round(r.ft), 0));
      comma = text.length > 3;
      break;
    case 'VS':
      text = String(Math.round(r.fpm));
      break;
    case 'BARO':
      text = r.unit === 'INHG' ? r.value.toFixed(2).replace('.', '') : String(r.value);
      point = r.unit === 'INHG';
      break;
  }
  return { chars: text.slice(-5).padStart(5, ' ').split(''), comma, point };
}

function Label({ x, y, text, on, anchor = 'start' }: { x: number; y: number; text: string; on: boolean; anchor?: 'start' | 'end' }) {
  return (
    <text x={x} y={y} text-anchor={anchor} class={`ap-lcd-label${on ? ' is-on' : ''}`}>
      {text}
    </text>
  );
}

/** "ARM" written downwards beside an armed-mode field. */
function VerticalArm({ x, on }: { x: number; on: boolean }) {
  return (
    <g class={`ap-lcd-label ap-lcd-small${on ? ' is-on' : ''}`}>
      {['A', 'R', 'M'].map((c, i) => (
        <text key={c} x={x} y={52 + i * 8.5} text-anchor="middle">
          {c}
        </text>
      ))}
    </g>
  );
}

export function KapLcd({ model, blinkOn }: { model: KapDisplayModel; blinkOn: boolean }) {
  const all = model.test === 'segments';
  const pft = typeof model.test === 'number';
  const r = model.right;
  const { chars, comma, point } = readoutDigits(r);
  const readout = !pft && !(r.kind === 'BARO' && r.flash && !blinkOn);
  const fields = [
    { at: L.lateral, text: pft ? 'PFT' : model.lateral },
    { at: L.lateralArmed, text: model.lateralArmed },
    { at: L.vertical, text: pft ? ` ${model.test}` : model.vertical },
    { at: L.verticalArmed, text: model.verticalArmed },
  ];

  return (
    <svg class="ap-lcd" viewBox={`0 0 ${L.w} ${L.h}`} width={L.w} height={L.h} aria-hidden="true">
      <g class="ap-lcd-lit">
        {fields.map((f) => (
          <SegText key={`${f.at.x}-${f.at.y}`} x={f.at.x} y={f.at.y} text={all ? '***' : f.text} pitch={L.pitch} />
        ))}
        {(all || readout) &&
          chars.map((c, i) => <SegChar key={i} x={L.digits[i]!} y={L.digitY} ch={all ? '8' : c} />)}
        {(all || (comma && readout)) && <path d="M281 30 l-2 4" class="ap-lcd-seg-path" />}
        {(all || (point && readout)) && <rect x={305} y={29.5} width={2.6} height={2.6} class="ap-lcd-dot" />}
      </g>

      {/* [AP] engaged box */}
      <g class={`ap-lcd-label${all || model.ap === 'on' || (model.ap === 'flash' && blinkOn) ? ' is-on' : ''}`}>
        <rect x={96} y={8} width={28} height={18} rx={1.5} class="ap-lcd-box" />
        <text x={110} y={21.8} text-anchor="middle" class="ap-lcd-ap">
          AP
        </text>
      </g>
      <VerticalArm x={88} on={all || model.lateralArmed !== ''} />
      <VerticalArm x={208} on={all || model.verticalArmed !== ''} />

      {/* Pitch trim: there is no trim system in the trainer, so it lights only in the display test. */}
      <g class={`ap-lcd-label ap-lcd-small${all ? ' is-on' : ''}`}>
        <path d="M222 5 l3.5 6 h-7 Z" class="ap-lcd-fill" />
        <text x={222} y={21} text-anchor="middle">
          P
        </text>
        <text x={222} y={30} text-anchor="middle">
          T
        </text>
        <path d="M222 40 l3.5 -6 h-7 Z" class="ap-lcd-fill" />
      </g>

      <Label x={238} y={52} text="ALERT" on={all || model.alert === 'on' || (model.alert === 'flash' && blinkOn)} />
      <Label x={297} y={52} text="FPM" on={all || (r.kind === 'VS' && readout)} />
      <Label x={352} y={52} text="FT" anchor="end" on={all || (r.kind === 'ALT' && readout)} />
      <Label x={262} y={67} text="HPA" on={all || (r.kind === 'BARO' && r.unit === 'HPA' && readout)} />
      <Label x={352} y={67} text="IN HG" anchor="end" on={all || (r.kind === 'BARO' && r.unit === 'INHG' && readout)} />
    </svg>
  );
}
