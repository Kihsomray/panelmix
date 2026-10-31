import { useRef } from 'preact/hooks';
import { useSim } from '../../sim/hooks';
import { Box } from '../../ui/DeviceFrame';
import { Knob } from '../../ui/controls/Knob';
import type { DeviceProps } from '../types';
import {
  AirspeedIndicator,
  Altimeter,
  AttitudeGauge,
  CdiGauge,
  HeadingIndicator,
  TurnCoordinator,
  VerticalSpeedIndicator,
  WhiskeyCompass,
} from './gauges';

/*
 * The classic six-pack plus a GI 106A-style CDI driven by the navigator's
 * CDI key (GPS or VLOC), and the wet compass. The heading indicator is a
 * vacuum gyro: it precesses a few degrees every quarter hour, so align it
 * with the compass now and then using its right knob.
 */

const CELL = 340;
const TOP = 84;
/** Gyro precession, degrees per second (about 4 degrees per 15 minutes). */
const DG_DRIFT_DPS = 4 / 900;

export function SteamPanel({ panel }: DeviceProps) {
  const { state, derived, dispatch } = useSim();
  const a = state.aircraft;

  // Heading indicator error, local to this instrument: an offset set by the
  // knob plus the precession accumulated since. Starts aligned.
  const dg = useRef({ offset: 0, since: state.time });
  const dgError = dg.current.offset + Math.max(state.time - dg.current.since, 0) * DG_DRIFT_DPS;
  const cardHeading = derived.headingMag + dgError;

  const cdi = derived.cdi;
  const nav1Course = state.nav.obsMag[0];
  const usingGps = cdi.source === 'GPS';
  // The CDI card shows the OBS setting. With GPS in leg mode the needle is
  // referenced to the desired track, so the pilot should set the card to DTK.
  const obsCourse = usingGps && state.fms.obsMode ? state.fms.obsCourseMag : nav1Course;

  const turnObs = (steps: number) => {
    const next = obsCourse + steps;
    dispatch({ type: 'obs.set', radio: 0, mag: next });
    if (usingGps && state.fms.obsMode) dispatch({ type: 'course.set', mag: next });
  };

  const col = (i: number) => 20 + i * CELL;
  const row = (i: number) => TOP + i * 330;
  // Small knobs sit at the lower-left corner of their instrument plate.
  const knobAt = (c: number, r = 0, dx = 42) => ({ x: col(c) + dx, y: row(r) + 280 });

  return (
    <div class="steam-panel">
      <Box x={col(1) + 50} y={10} w={240} h={64}>
        <WhiskeyCompass headingMag={derived.headingMag} wobble={a.bankDeg * 0.08 + Math.sin(state.time * 1.7) * 0.6} />
      </Box>
      <Box x={col(3) + 20} y={18} w={280} h={48} class="steam-annunciator">
        <span class={`annun ${usingGps ? 'annun-gps is-on' : 'annun-gps'}`}>GPS</span>
        <span class={`annun ${!usingGps ? 'annun-nav is-on' : 'annun-nav'}`}>VLOC</span>
        <span class={`annun annun-msg${derived.unreadMessages > 0 ? ' is-on' : ''}`}>MSG</span>
        <span class={`annun annun-obs${state.fms.obsMode ? ' is-on' : ''}`}>OBS</span>
      </Box>

      <Box x={col(0)} y={row(0)} w={300} h={300}>
        <AirspeedIndicator iasKt={a.iasKt} />
      </Box>
      <Box x={col(1)} y={row(0)} w={300} h={300}>
        <AttitudeGauge pitchDeg={a.pitchDeg} bankDeg={a.bankDeg} />
      </Box>
      <Box x={col(2)} y={row(0)} w={300} h={300}>
        <Altimeter altitudeFt={derived.indicatedAltitudeFt} baroInHg={state.bugs.baroInHg} />
      </Box>
      <Box x={col(3)} y={row(0)} w={300} h={300}>
        <CdiGauge
          obsCourse={obsCourse}
          needle={cdi.needle}
          toFrom={cdi.toFrom}
          flag={cdi.flag}
          source={usingGps ? 'GPS' : 'VLOC'}
        />
      </Box>
      <Box x={col(0)} y={row(1)} w={300} h={300}>
        <TurnCoordinator turnRateDps={a.turnRateDps} slip={a.slip} />
      </Box>
      <Box x={col(1)} y={row(1)} w={300} h={300}>
        <HeadingIndicator cardHeading={cardHeading} bugMag={state.bugs.headingMag} />
      </Box>
      <Box x={col(2)} y={row(1)} w={300} h={300}>
        <VerticalSpeedIndicator vsFpm={a.verticalSpeedFpm} />
      </Box>
      <Box x={col(3)} y={row(1)} w={300} h={300} class="steam-placard">
        <div>
          <strong>{panel.cdiSources.includes('NAV1') ? 'CDI: GPS / VLOC' : 'CDI: GPS'}</strong>
          <span>Switch the CDI source with the navigator's CDI key.</span>
          <span>Align the heading indicator with the compass every 15 minutes.</span>
        </div>
      </Box>

      <Knob
        id="steam.baro"
        {...knobAt(2)}
        size={46}
        label="Altimeter setting knob"
        innerLabel="Baro"
        look="steam"
        onInner={(n) => dispatch({ type: 'baro.set', inHg: state.bugs.baroInHg + n * 0.01 })}
      />
      <Knob
        id="steam.obs"
        {...knobAt(3)}
        size={46}
        label="OBS knob"
        innerLabel="Course"
        look="steam"
        onInner={turnObs}
      />
      <Knob
        id="steam.hdg-bug"
        {...knobAt(1, 1)}
        size={46}
        label="Heading bug knob"
        innerLabel="Heading bug"
        look="steam"
        onInner={(n) => dispatch({ type: 'bug.heading', mag: state.bugs.headingMag + n })}
      />
      <Knob
        id="steam.dg-set"
        {...knobAt(1, 1, 258)}
        size={46}
        label="Heading indicator set knob"
        innerLabel="Set card"
        pushLabel="Align to compass"
        look="steam"
        onInner={(n) => {
          dg.current = { offset: dgError + n, since: state.time };
        }}
        onPush={() => {
          dg.current = { offset: 0, since: state.time };
        }}
      />
    </div>
  );
}

export default SteamPanel;
