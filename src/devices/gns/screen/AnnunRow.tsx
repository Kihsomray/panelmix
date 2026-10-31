import type { Lcd } from '../layout';
import { pageIndicator } from '../model/pages';
import type { GnsUi } from '../model/types';
import { at } from './kit';

/*
 * The bottom row of the screen: the CDI source above the CDI key (GPS green,
 * VLOC white), OBS above the OBS key, a flashing MSG above the MSG key, and
 * on the right the page-group indicator, or a turn advisory in its place.
 */

export function AnnunRow({
  ui,
  lcd,
  cdi,
  obs,
  unread,
  advisory,
}: {
  ui: GnsUi;
  lcd: Lcd;
  cdi: 'GPS' | 'VLOC' | '';
  obs: boolean;
  unread: boolean;
  advisory: string | null;
}) {
  const h = lcd.h - lcd.annunY;
  const size = ui.model === '430' ? 8.6 : 12;
  const y = (h - size) / 2 + 0.5;
  const ind = pageIndicator(ui);
  const left = lcd.indicatorX;
  // Room for the longest group name (NRST, DRCT, PROC, VNAV).
  const nameW = size * 3.25;
  const room = lcd.w - left - nameW - 3;
  const sq = Math.min(size * 0.62, room / ind.count - 1.2);
  return (
    <div class="gns-t" style={{ ...at(0, lcd.annunY, lcd.w, h), background: '#000' }}>
      {cdi && (
        <div class={`gns-t is-bold ${cdi === 'GPS' ? 'c-green' : 'c-white'}`} style={{ ...at(lcd.annun.cdi, y), fontSize: `${size}px` }}>
          {cdi}
        </div>
      )}
      {obs && (
        <div class="gns-t is-bold c-green" style={{ ...at(lcd.annun.obs, y), fontSize: `${size}px` }}>
          OBS
        </div>
      )}
      {unread && (
        <div class="gns-t is-bold c-yellow gns-blink" style={{ ...at(lcd.annun.msg, y), fontSize: `${size}px` }}>
          MSG
        </div>
      )}
      {advisory ? (
        <div class="gns-advisory" style={{ ...at(left, 0, lcd.w - left, h), fontSize: `${size}px`, lineHeight: `${h}px`, paddingLeft: '3px' }}>
          {advisory}
        </div>
      ) : (
        <div class="gns-indicator" style={at(left, 0, lcd.w - left, h)}>
          <span class="gns-t is-bold c-white" style={{ ...at(3, y), fontSize: `${size}px` }}>
            {ind.name}
          </span>
          <span style={{ position: 'absolute', left: `${nameW}px`, top: `${(h - sq * 1.25) / 2}px`, display: 'flex' }}>
            {Array.from({ length: ind.count }, (_, i) => (
              <i key={i} class={i === ind.index ? 'is-on' : ''} style={{ width: `${sq}px`, height: `${sq * 1.25}px` }} />
            ))}
          </span>
        </div>
      )}
    </div>
  );
}
