/*
 * Segment glyphs for the KAP 140 liquid-crystal display, drawn the way the
 * KAP's LCD draws them: thin, slanted strokes with gaps at the joints, the
 * D built from two arcs and the V from two long strokes. Letters for the
 * mode fields, seven-segment digits for the readout. Only lit segments are
 * drawn.
 */

/** Cell size in display px; strokes are centered on these lines. */
const W = 15;
const H = 24;
const M = H / 2;
const G = 2.2;

/** Segment centerlines: a top, b/c right, d bottom, e/f left, g1/g2 middle, i/l center, h/j/k/m diagonals. */
const SEG: Readonly<Record<string, string>> = {
  a: `M${G} 0 H${W - G}`,
  d: `M${G} ${H} H${W - G}`,
  f: `M0 ${G} V${M - G}`,
  e: `M0 ${M + G} V${H - G}`,
  b: `M${W} ${G} V${M - G}`,
  c: `M${W} ${M + G} V${H - G}`,
  g: `M${G} ${M} H${W - G}`,
  g1: `M${G} ${M} H${W / 2 - G / 2}`,
  g2: `M${W / 2 + G / 2} ${M} H${W - G}`,
  i: `M${W / 2} ${G} V${M - G}`,
  l: `M${W / 2} ${M + G} V${H - G}`,
  h: `M${G * 1.3} ${G * 1.6} L${W / 2 - G * 0.8} ${M - G * 1.4}`,
  j: `M${W - G * 1.3} ${G * 1.6} L${W / 2 + G * 0.8} ${M - G * 1.4}`,
  k: `M${G * 1.3} ${H - G * 1.6} L${W / 2 - G * 0.8} ${M + G * 1.4}`,
  m: `M${W - G * 1.3} ${H - G * 1.6} L${W / 2 + G * 0.8} ${M + G * 1.4}`,
  /** The D: half bars and two arcs on the right. */
  a1: `M${G} 0 H${W * 0.45}`,
  d1: `M${G} ${H} H${W * 0.45}`,
  r1: `M${W * 0.55} 0.3 C${W * 0.95} 1.5 ${W} ${M * 0.45} ${W} ${M - G}`,
  r2: `M${W} ${M + G} C${W} ${H - M * 0.45} ${W * 0.95} ${H - 1.5} ${W * 0.55} ${H - 0.3}`,
  /** The V: two long strokes meeting at the bottom. */
  v1: `M0 ${G} L${W / 2 - 0.9} ${H - 0.6}`,
  v2: `M${W} ${G} L${W / 2 + 0.9} ${H - 0.6}`,
};

/** Glyphs the KAP 140 fields use. '*' lights every segment (display test). */
const FONT: Readonly<Record<string, readonly string[]>> = {
  '*': ['a', 'b', 'c', 'd', 'e', 'f', 'g1', 'g2', 'h', 'i', 'j', 'k', 'l', 'm'],
  A: ['a', 'b', 'c', 'e', 'f', 'g1', 'g2'],
  D: ['a1', 'd1', 'e', 'f', 'r1', 'r2'],
  E: ['a', 'd', 'e', 'f', 'g1', 'g2'],
  F: ['a', 'e', 'f', 'g1', 'g2'],
  G: ['a', 'c', 'd', 'e', 'f', 'g2'],
  H: ['b', 'c', 'e', 'f', 'g1', 'g2'],
  I: ['a', 'd', 'i', 'l'],
  L: ['d', 'e', 'f'],
  N: ['b', 'c', 'e', 'f', 'h', 'm'],
  O: ['a', 'b', 'c', 'd', 'e', 'f'],
  P: ['a', 'b', 'e', 'f', 'g1', 'g2'],
  R: ['a', 'b', 'e', 'f', 'g1', 'g2', 'm'],
  S: ['a', 'c', 'd', 'f', 'g1', 'g2'],
  T: ['a', 'i', 'l'],
  V: ['v1', 'v2'],
  '0': ['a', 'b', 'c', 'd', 'e', 'f'],
  '1': ['b', 'c'],
  '2': ['a', 'b', 'd', 'e', 'g'],
  '3': ['a', 'b', 'c', 'd', 'g'],
  '4': ['b', 'c', 'f', 'g'],
  '5': ['a', 'c', 'd', 'f', 'g'],
  '6': ['a', 'c', 'd', 'e', 'f', 'g'],
  '7': ['a', 'b', 'c'],
  '8': ['a', 'b', 'c', 'd', 'e', 'f', 'g'],
  '9': ['a', 'b', 'c', 'd', 'f', 'g'],
  '-': ['g'],
};

/** The LCD's slant. */
const SKEW = 'skewX(-9)';

/** One character with its cell's top-left at (x, y). Unknown characters and spaces draw nothing. */
export function SegChar({ x, y, ch }: { x: number; y: number; ch: string }) {
  const segs = FONT[ch.toUpperCase()];
  if (!segs) return null;
  return (
    <path
      transform={`translate(${x} ${y}) ${SKEW}`}
      d={segs.map((s) => SEG[s]).join(' ')}
      class="ap-lcd-seg-path"
    />
  );
}

/** A row of characters, left aligned, `pitch` apart. */
export function SegText({ x, y, text, pitch }: { x: number; y: number; text: string; pitch: number }) {
  return (
    <>
      {[...text].map((ch, i) => (
        <SegChar key={i} x={x + i * pitch} y={y} ch={ch} />
      ))}
    </>
  );
}

/** Character origins in the 361 x 77 display, from the KAP 140 pilot's guide figure. */
export const KAP_LCD = {
  w: 361,
  h: 77,
  pitch: 24,
  lateral: { x: 12, y: 7 },
  lateralArmed: { x: 12, y: 44 },
  vertical: { x: 132, y: 7 },
  verticalArmed: { x: 132, y: 44 },
  /** Readout digit cells; the comma sits between the second and third. */
  digits: [238, 261, 289, 312, 335] as const,
  digitY: 7,
} as const;
