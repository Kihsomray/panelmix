import { AV_FONT } from '../../ui/instruments/palette';
import { dotTextWidth, drawDotText, drawDotTextAligned } from './dotFont';
import type { GtxPageView, GtxScreen } from './gtx345Logic';

/*
 * Paints the GTX 345 display: white on black, a dot-matrix font for labels
 * and values and large digits for the squawk code. Layout in display px
 * (the canvas is 352 x 68 design px): mode and annunciations on the left,
 * the code, then the function page and its scroll bar on the right.
 */

export const GTX_SCREEN_W = 352;
export const GTX_SCREEN_H = 68;

const CODE_X = 46;
const CODE_W = 124;
const FUNC_CENTER = 260;
const FUNC_LEFT = 184;
const FUNC_RIGHT = 331;
const SCROLL_X = 345;

function drawPage(ctx: CanvasRenderingContext2D, page: GtxPageView, ink: string, blinkOn: boolean) {
  if (page.kind === 'titled') {
    if (page.flash !== 'title' || blinkOn) drawDotTextAligned(ctx, page.title, FUNC_CENTER, 8, 1.6, 'center');
    if (page.flash === 'value' && !blinkOn) return;
    const px = dotTextWidth(page.value, 3) > FUNC_RIGHT - FUNC_LEFT ? 2.4 : 3;
    const w = dotTextWidth(page.value, px);
    if (page.highlight) {
      ctx.fillRect(FUNC_CENTER - w / 2 - 4, 27, w + 8, 7 * px + 6);
      ctx.fillStyle = '#000';
    }
    drawDotTextAligned(ctx, page.value, FUNC_CENTER, 30, px, 'center');
    ctx.fillStyle = ink;
    return;
  }
  page.rows.forEach((row, i) => {
    const y = 10 + i * 28;
    drawDotText(ctx, row.label, FUNC_LEFT, y + 3, 1.6);
    const w = dotTextWidth(row.value, 2.4);
    if (row.highlight) {
      ctx.fillRect(FUNC_RIGHT - w - 3, y - 3, w + 6, 7 * 2.4 + 6);
      ctx.fillStyle = '#000';
    }
    drawDotTextAligned(ctx, row.value, FUNC_RIGHT, y, 2.4, 'right');
    ctx.fillStyle = ink;
  });
}

/** Up/down arrows with a thumb showing the page's place in its group. */
function drawScroll(ctx: CanvasRenderingContext2D, index: number, count: number) {
  const top = 12;
  const bottom = 56;
  ctx.beginPath();
  ctx.moveTo(SCROLL_X, 3);
  ctx.lineTo(SCROLL_X - 4, 9);
  ctx.lineTo(SCROLL_X + 4, 9);
  ctx.closePath();
  ctx.moveTo(SCROLL_X, 65);
  ctx.lineTo(SCROLL_X - 4, 59);
  ctx.lineTo(SCROLL_X + 4, 59);
  ctx.closePath();
  ctx.fill();
  ctx.fillRect(SCROLL_X - 0.6, top, 1.2, bottom - top);
  const seg = (bottom - top) / Math.max(count, 1);
  ctx.fillRect(SCROLL_X - 2.5, top + seg * index, 5, seg);
}

function drawGroupName(ctx: CanvasRenderingContext2D, name: string) {
  const px = 1.5;
  const step = 12;
  const top = (GTX_SCREEN_H - name.length * step) / 2 + 1;
  [...name].forEach((ch, i) => drawDotTextAligned(ctx, ch, SCROLL_X, top + i * step, px, 'center'));
}

function drawCode(ctx: CanvasRenderingContext2D, code: string) {
  const cell = CODE_W / 4;
  ctx.font = `700 60px ${AV_FONT}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'alphabetic';
  [...code].forEach((ch, i) => {
    const cx = CODE_X + cell * (i + 0.5);
    // Digits not yet entered show as underscored blanks.
    if (ch === '_') ctx.fillRect(cx - cell * 0.36, 44, cell * 0.72, 4);
    else ctx.fillText(ch, cx, 48);
  });
}

export function drawGtxScreen(ctx: CanvasRenderingContext2D, screen: GtxScreen, blinkOn: boolean): void {
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, GTX_SCREEN_W, GTX_SCREEN_H);
  if (screen.kind === 'off') return;
  const ink = `rgba(255, 255, 255, ${screen.brightness})`;
  ctx.fillStyle = ink;

  if (screen.kind === 'boot') {
    drawDotTextAligned(ctx, 'GARMIN', GTX_SCREEN_W / 2, 10, 2.6, 'center');
    drawDotTextAligned(ctx, 'GTX 345', GTX_SCREEN_W / 2, 36, 1.6, 'center');
    drawDotTextAligned(ctx, 'SW 2.90', GTX_SCREEN_W / 2, 52, 1.2, 'center');
    return;
  }

  if (screen.ident) drawDotText(ctx, 'IDENT', 3, 4, 1.4);
  drawDotText(ctx, screen.mode, 3, 27, 2);
  if (screen.reply) {
    // Reply symbol: an inverse "R".
    ctx.fillRect(3, 49, 13, 15);
    ctx.fillStyle = '#000';
    drawDotText(ctx, 'R', 5.3, 52, 1.4);
    ctx.fillStyle = ink;
  }

  drawCode(ctx, screen.code);
  if (screen.special) drawDotTextAligned(ctx, screen.special, CODE_X + CODE_W / 2, 56, 1.3, 'center');

  if (screen.banner) {
    if (blinkOn) drawDotTextAligned(ctx, screen.banner, FUNC_CENTER, 28, 1.6, 'center');
  } else {
    drawPage(ctx, screen.page, ink, blinkOn);
  }
  if (screen.groupName) drawGroupName(ctx, screen.groupName);
  else drawScroll(ctx, screen.scroll.index, screen.scroll.count);
}
