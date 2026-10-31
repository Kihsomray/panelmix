import type { Rect } from '../screen/Frames';

/*
 * MFD regions on the 1024 x 768 grid (Figures 3-1, 5-33, 5-37): the EIS
 * strip takes the left 150 px; map pages use the rest, and information
 * pages split it into a map and a column of boxes on the right.
 */

export const PAGE: Rect = { x: 150, y: 51, w: 874, h: 693 };
export const SPLIT_MAP: Rect = { x: 150, y: 51, w: 548, h: 693 };
export const PANEL: Rect = { x: 702, y: 56, w: 318, h: 650 };
export const MENU_RECT: Rect = { x: 702, y: 300, w: 318, h: 260 };
/** Confirmations open over the page's data column, where the cursor is. */
export const CONFIRM_RECT: Rect = { x: 712, y: 300, w: 300, h: 100 };

/** Rows of the Active Flight Plan list on the MFD. */
export const MFD_FPL_ROWS = 17;
