import { useEffect, useRef } from 'preact/hooks';
import type { DeviceSpec } from '../devices/types';
import { Icon } from './Icon';

/*
 * How to work the controls, plus a quick reference for one unit when opened
 * from that unit's ? button.
 */

export function HelpSheet({ spec, onClose }: { spec: DeviceSpec | null; onClose: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current;
    if (d && !d.open) d.showModal();
  }, []);
  return (
    <dialog
      ref={ref}
      class="sheet"
      aria-labelledby="help-title"
      onClose={onClose}
      onClick={(e) => e.target === ref.current && onClose()}
    >
      <div class="sheet-head">
        <h2 id="help-title">{spec ? `${spec.maker} ${spec.name}` : 'How to use PanelMix'}</h2>
        <button type="button" class="icon-btn" onClick={onClose} aria-label="Close">
          <Icon name="close" />
        </button>
      </div>
      <div class="sheet-body">
        {spec && (
          <>
            <p class="sheet-lead">{spec.summary}</p>
            {spec.help.length > 0 ? (
              <table class="help-table">
                <tbody>
                  {spec.help.map((h) => (
                    <tr key={h.control}>
                      <th scope="row">{h.control}</th>
                      <td>{h.action}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <p>Every key and knob on this unit works. Try them.</p>
            )}
            <h3>Controls in general</h3>
          </>
        )}
        <ul class="help-list">
          <li>
            <strong>Buttons:</strong> tap or click. Some do something else when held, like CLR on Garmin units.
          </li>
          <li>
            <strong>Knobs, mouse:</strong> scroll over the outer ring for the large knob and over the center for the small knob, or drag
            around the knob. Click the center to push it.
          </li>
          <li>
            <strong>Knobs, touch:</strong> drag your finger around a knob to turn it, or tap it to open the knob controls at the bottom of
            the screen with big turn and push buttons.
          </li>
          <li>
            <strong>Keyboard:</strong> Tab to a knob. Up and down turn the large knob, left and right the small knob, Enter pushes.
          </li>
          <li>
            <strong>Focus</strong> (the arrows on each unit's title bar) enlarges one unit. On a phone, turn it sideways.
          </li>
          <li>
            <strong>Fly</strong> (bottom right) has the yoke, throttle, position and weather. The units all talk to each other: a flight
            plan built on the navigator drives the PFD's course needle, and the CDI key picks GPS or VOR.
          </li>
        </ul>
        {!spec && (
          <p class="sheet-fine">
            A training aid for learning buttonology, not for navigation. Not affiliated with or endorsed by Garmin, Aspen Avionics or
            Bendix/King; product names identify the units being imitated. Airport and navaid data from OurAirports, maps from Natural
            Earth, magnetic variation from the NOAA World Magnetic Model.
          </p>
        )}
      </div>
    </dialog>
  );
}
