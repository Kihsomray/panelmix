import { useSim } from '../../sim/hooks';
import { formatAltitude } from '../../ui/format';
import { NumberField, Segmented } from '../controls';
import { aloftRows, altimeterErrorFt, clampKt, presetLayers, TURBULENCE, WEATHER_PRESETS, withAloft, type Wind } from './weather';

/*
 * Surface wind, winds aloft at 3,000 / 6,000 / 9,000 ft, turbulence and the
 * real altimeter setting. Changes apply at once.
 */

const TURBULENCE_OPTIONS = TURBULENCE.map((t) => ({ id: t.level, name: t.name }));

export function WeatherTab() {
  const { state, derived, dispatch } = useSim();
  const env = state.env;
  const weather = state.systems.weather;
  const surface: Wind = { fromTrue: env.windFromTrue, kt: env.windKt };
  const rows = aloftRows(weather.windsAloft, surface);
  const error = altimeterErrorFt(state.bugs.baroStd ? 29.92 : state.bugs.baroInHg, env.qnhInHg);
  const here = derived.systems;

  const setSurface = (w: Wind) => dispatch({ type: 'sim.wind', fromTrue: w.fromTrue, kt: clampKt(w.kt) });
  const setAloft = (altitudeFt: number, w: Wind) => dispatch({ type: 'weather.windsAloft', layers: withAloft(rows, altitudeFt, w) });

  return (
    <div class="ins-section ins-cols">
      <div class="ins-col">
        <div class="ins-presets" role="group" aria-label="Weather presets">
          {WEATHER_PRESETS.map((p) => (
            <button
              key={p.id}
              type="button"
              class="pill-btn pill-sm"
              onClick={() => {
                setSurface(p.surface);
                dispatch({ type: 'weather.windsAloft', layers: presetLayers(p) });
                dispatch({ type: 'weather.turbulence', level: p.turbulence });
              }}
            >
              {p.name}
            </button>
          ))}
        </div>

        <table class="ins-wind">
          <caption>Wind, from degrees true</caption>
          <thead>
            <tr>
              <th scope="col">Level</th>
              <th scope="col">From °T</th>
              <th scope="col">Speed kt</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <th scope="row">Surface</th>
              <td>
                <NumberField
                  wrap
                  label="Surface wind from, degrees true"
                  value={Math.round(surface.fromTrue)}
                  min={0}
                  max={359}
                  step={10}
                  onCommit={(v) => setSurface({ ...surface, fromTrue: v })}
                />
              </td>
              <td>
                <NumberField label="Surface wind speed, knots" value={Math.round(surface.kt)} min={0} max={80} onCommit={(v) => setSurface({ ...surface, kt: v })} />
              </td>
            </tr>
            {rows.map((r) => (
              <tr key={r.altitudeFt} class={r.set ? '' : 'is-unset'}>
                <th scope="row">{formatAltitude(r.altitudeFt)} ft</th>
                <td>
                  <NumberField
                    wrap
                    label={`Wind at ${formatAltitude(r.altitudeFt)} ft from, degrees true`}
                    value={Math.round(r.fromTrue)}
                    min={0}
                    max={359}
                    step={10}
                    onCommit={(v) => setAloft(r.altitudeFt, { fromTrue: v, kt: r.kt })}
                  />
                </td>
                <td>
                  <NumberField
                    label={`Wind at ${formatAltitude(r.altitudeFt)} ft, knots`}
                    value={Math.round(r.kt)}
                    min={0}
                    max={150}
                    onCommit={(v) => setAloft(r.altitudeFt, { fromTrue: r.fromTrue, kt: v })}
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <p class="sim-ap-note">
          At the airplane now: {Math.round(here.windFromTrue) % 360 || 360}° at {Math.round(here.windKt)} kt.
          {rows.some((r) => !r.set) && ' Dimmed levels are not set and follow the level below.'}
        </p>
      </div>

      <div class="ins-col">
        <div class="ins-field">
          <span>Turbulence</span>
          <Segmented label="Turbulence" options={TURBULENCE_OPTIONS} value={weather.turbulence} onChange={(level) => dispatch({ type: 'weather.turbulence', level })} />
        </div>

        <label class="field ins-qnh">
          <span>Actual altimeter setting (inHg)</span>
          <NumberField value={env.qnhInHg} decimals={2} step={0.01} min={28} max={31} onCommit={(v) => dispatch({ type: 'sim.qnh', inHg: v })} />
        </label>
        <p class="sim-ap-note">
          {error === 0
            ? 'The altimeters are set to the actual pressure.'
            : `With the pilot's setting the altimeter reads about ${Math.abs(error).toLocaleString('en-US')} ft ${error > 0 ? 'high' : 'low'}. ATC gives the new setting; the pilot dials it in.`}
        </p>
      </div>
    </div>
  );
}
