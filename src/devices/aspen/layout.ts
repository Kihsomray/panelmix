/*
 * Where things sit on the Aspen bezel, in design px (100 per inch: the unit
 * is 3.5 x 7.0 in at the bezel), and how the 400 x 760 display maps onto it
 * (a 6-inch diagonal panel, 2.8 x 5.3 in).
 */

export const SCREEN = { x: 22, y: 64, w: 280, h: 532 } as const;
/** Display pixels to design px. */
export const K = SCREEN.w / 400;

/** Hot key centers in display pixels; the bezel keys line up with these legends. */
export const HOTKEY_Y = [417, 483, 549, 614, 680] as const;

/** A display-pixel y on the bezel. */
export const toBezelY = (y: number) => SCREEN.y + y * K;
