import type { SimCommand } from '../../../sim/commands';
import type { Derived } from '../../../sim/simulator';
import type { SimState } from '../../../sim/types';
import type { GduActions } from '../bezel/GduBezel';
import { afcsPress, navKind } from './afcs';
import { adjustVolume, EMERGENCY_KHZ, toggleSquelch, toggleTuning, tuneStandby, VOLUME_SHOW_MS } from './radioPanel';
import { getShared, updateShared } from './store';

/*
 * The controls that do the same thing on both displays ("PFD and MFD
 * control functions are the same"): NAV/COM volume, tuning and transfer,
 * HDG, ALT, CRS/BARO and the GFC 700 keys. The RANGE joystick, FMS knob,
 * softkeys and the D->, MENU, FPL, PROC, CLR, ENT keys act on what each
 * display shows and are wired by the display itself.
 */

export type CommonControls = Pick<
  GduActions,
  | 'navVolume'
  | 'navIdent'
  | 'navSwap'
  | 'navOuter'
  | 'navInner'
  | 'navToggle'
  | 'heading'
  | 'headingSync'
  | 'altOuter'
  | 'altInner'
  | 'comVolume'
  | 'comSquelch'
  | 'comSwap'
  | 'comEmergency'
  | 'comOuter'
  | 'comInner'
  | 'comToggle'
  | 'baro'
  | 'course'
  | 'courseCenter'
  | 'afcs'
>;

const HPA_PER_INHG = 33.8639;
const AFCS_FLASH_MS = 5000;

/** Steps the Kollsman setting: 0.01 inHg per click, or 1 hPa when the PFD shows hectopascals. */
export function baroStep(inHg: number, steps: number, hpa: boolean): number {
  if (!hpa) return inHg + steps * 0.01;
  return (Math.round(inHg * HPA_PER_INHG) + steps) / HPA_PER_INHG;
}

/** CRS push: the course that centers the needle, to the station or the GPS (OBS) waypoint. */
export function centeredCourse(state: SimState, derived: Derived): SimCommand | null {
  const src = state.nav.cdiSource;
  if (src === 'GPS') {
    const brg = derived.gps.bearingMag;
    return state.fms.obsMode && brg !== null ? { type: 'course.set', mag: Math.round(brg) } : null;
  }
  const v = derived.vor[src === 'NAV1' ? 0 : 1];
  return v.bearingToMag !== null ? { type: 'obs.set', radio: src === 'NAV1' ? 0 : 1, mag: Math.round(v.bearingToMag) } : null;
}

export function commonControls(state: SimState, derived: Derived, dispatch: (cmd: SimCommand) => void): CommonControls {
  const radio = () => getShared().radio;
  const now = () => performance.now();
  const volume = (kind: 'nav' | 'com', steps: number) => {
    const t = now();
    updateShared((s) => ({ ...s, radio: adjustVolume(s.radio, kind, steps, t) }), t + VOLUME_SHOW_MS);
  };
  const nav = () => radio().navTuned;
  const com = () => radio().comTuned;
  const bugs = state.bugs;

  return {
    navVolume: (n) => volume('nav', n),
    navIdent: () => dispatch({ type: 'nav.ident', radio: nav(), on: !state.radios.navIdent[nav()] }),
    navSwap: () => dispatch({ type: 'nav.swap', radio: nav() }),
    navOuter: (n) => dispatch(tuneStandby('nav', nav(), state.radios.nav[nav()].standbyKhz, 'outer', n)),
    navInner: (n) => dispatch(tuneStandby('nav', nav(), state.radios.nav[nav()].standbyKhz, 'inner', n)),
    navToggle: () => updateShared((s) => ({ ...s, radio: toggleTuning(s.radio, 'nav') })),
    heading: (n) => dispatch({ type: 'bug.heading', mag: bugs.headingMag + n }),
    headingSync: () => dispatch({ type: 'bug.heading', mag: Math.round(derived.headingMag) }),
    altOuter: (n) => dispatch({ type: 'bug.altitude', ft: bugs.altitudeFt + n * 1000 }),
    altInner: (n) => dispatch({ type: 'bug.altitude', ft: Math.round(bugs.altitudeFt / 100) * 100 + n * 100 }),
    comVolume: (n) => volume('com', n),
    comSquelch: () => updateShared((s) => ({ ...s, radio: toggleSquelch(s.radio) })),
    comSwap: () => dispatch({ type: 'com.swap', radio: com() }),
    comEmergency: () => dispatch({ type: 'com.setActive', radio: com(), khz: EMERGENCY_KHZ }),
    comOuter: (n) => dispatch(tuneStandby('com', com(), state.radios.com[com()].standbyKhz, 'outer', n)),
    comInner: (n) => dispatch(tuneStandby('com', com(), state.radios.com[com()].standbyKhz, 'inner', n)),
    comToggle: () => updateShared((s) => ({ ...s, radio: toggleTuning(s.radio, 'com') })),
    baro: (n) => dispatch({ type: 'baro.set', inHg: baroStep(bugs.baroInHg, n, getShared().baroHpa) }),
    course: (n) => dispatch({ type: 'course.set', mag: derived.cdi.courseMag + n }),
    courseCenter: () => {
      const cmd = centeredCourse(state, derived);
      if (cmd) dispatch(cmd);
    },
    afcs: (key) => {
      const cdi = derived.cdi;
      const result = afcsPress(key, state.ap, {
        navValid: !cdi.flag,
        needle: cdi.needle,
        source: navKind(cdi.label),
        approach: getShared().approach,
      });
      for (const cmd of result.commands) dispatch(cmd);
      if (result.approach !== undefined) {
        const approach = result.approach;
        updateShared((s) => (s.approach === approach ? s : { ...s, approach }));
      }
      if (result.unavailable) {
        const until = now() + AFCS_FLASH_MS;
        const mode = result.unavailable.mode;
        updateShared((s) => ({ ...s, afcsFlash: { mode, until } }), until);
        dispatch({ type: 'msg.post', text: result.unavailable.message, level: 'advisory' });
      }
    },
  };
}
