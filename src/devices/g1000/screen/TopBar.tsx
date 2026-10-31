import type { ComponentChildren } from 'preact';
import { formatCom, formatNav } from '../../../core/frequency';
import type { CdiSource, RadioState } from '../../../sim/types';
import { shownVolume, type RadioPanel } from '../shared/radioPanel';

/*
 * The top band both displays share: NAV frequency box on the left, COM on
 * the right, and a center slot (navigation status and AFCS status on the
 * PFD, navigation data bar and page title on the MFD).
 *
 * Garmin layout: active frequencies sit toward the middle of the screen,
 * standby toward the edges; the cyan tuning box marks the standby the knobs
 * tune and the transfer arrow sits beside it. The active NAV is green when
 * it drives the CDI, the active COM green when it is the transmitter.
 */

interface Props {
  readonly radios: RadioState;
  readonly panel: RadioPanel;
  readonly cdiSource: CdiSource;
  /** Station identifiers heard on NAV1 and NAV2. */
  readonly navIdents: readonly [string | null, string | null];
  readonly now: number;
  readonly children: ComponentChildren;
}

export function TopBar({ radios, panel, cdiSource, navIdents, now, children }: Props) {
  return (
    <div class="g1000-topbar">
      <div class="g1000-freqbox g1000-navbox">
        {([0, 1] as const).map((i) => {
          const pair = radios.nav[i];
          const tuned = panel.navTuned === i;
          const volume = shownVolume(panel, 'nav', i, now);
          const idOn = radios.navIdent[i];
          return (
            <div key={i} class="g1000-fr" style={{ top: `${i * 25}px` }}>
              <span class="g1000-fr-lbl">{volume !== null ? 'VOLUME' : `NAV${i + 1}`}</span>
              <span class={`g1000-fr-stby${tuned ? ' is-tuned' : ''}${volume !== null ? ' is-volume' : ''}`}>
                {volume !== null ? `${volume}%` : formatNav(pair.standbyKhz)}
              </span>
              {idOn ? <span class="g1000-fr-mid">ID</span> : tuned && <span class="g1000-fr-mid g1000-arrow">↔</span>}
              <span class={`g1000-fr-act${cdiSource === `NAV${i + 1}` ? ' is-green' : ''}`}>{formatNav(pair.activeKhz)}</span>
              <span class="g1000-fr-ident">{navIdents[i] ?? ''}</span>
            </div>
          );
        })}
      </div>
      <div class="g1000-topcenter">{children}</div>
      <div class="g1000-freqbox g1000-combox">
        {([0, 1] as const).map((i) => {
          const pair = radios.com[i];
          const tuned = panel.comTuned === i;
          const volume = shownVolume(panel, 'com', i, now);
          return (
            <div key={i} class="g1000-fr" style={{ top: `${i * 25}px` }}>
              <span class={`g1000-fr-act${radios.micCom === i ? ' is-green' : ''}`}>{formatCom(pair.activeKhz)}</span>
              {panel.squelchOff[i] ? (
                <span class="g1000-fr-mid">SQ</span>
              ) : (
                tuned && <span class="g1000-fr-mid g1000-arrow">↔</span>
              )}
              <span class={`g1000-fr-stby${tuned ? ' is-tuned' : ''}${volume !== null ? ' is-volume' : ''}`}>
                {volume !== null ? `${volume}%` : formatCom(pair.standbyKhz)}
              </span>
              <span class="g1000-fr-lbl">{volume !== null ? 'VOLUME' : `COM${i + 1}`}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
