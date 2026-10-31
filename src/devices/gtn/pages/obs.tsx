import type { Gtn, PageView } from '../context';
import { backspace, courseText, courseValue, pressDigit, startCourse, stepCourse, type CourseEntry } from '../course';
import type { Page } from '../model';
import { GlyphKey, Key } from '../ui';

/*
 * OBS: the OBS key suspends sequencing on the active waypoint and opens
 * "Select OBS Course" (keypad or knob); tapping OBS again resumes normal
 * sequencing.
 */

type ObsPage = Extract<Page, { kind: 'obsCourse' }>;

/** The OBS key. */
export function toggleObs(g: Gtn): void {
  if (g.state.fms.obsMode) {
    g.dispatch({ type: 'fms.obs', on: false });
    return;
  }
  if (!g.state.fms.activeLeg) return;
  // OBS starts on the current desired track (the reducer does the same), then the pilot adjusts it.
  g.dispatch({ type: 'fms.obs', on: true });
  const start = Math.round(g.derived.gps.dtkMag ?? g.state.fms.obsCourseMag);
  g.go({ type: 'open', page: { kind: 'obsCourse', entry: startCourse(start) } });
}

function setEntry(g: Gtn, page: ObsPage, entry: CourseEntry) {
  g.go({ type: 'update', page: { ...page, entry } });
}

/** Sets the GPS OBS course, whatever the CDI shows (the OBS page is GPS-only). */
function enter(g: Gtn, page: ObsPage) {
  g.dispatch({ type: 'fms.obsCourse', mag: courseValue(page.entry) % 360 });
  g.go({ type: 'back' });
}

function ObsBody({ g, page }: { g: Gtn; page: ObsPage }) {
  const e = page.entry;
  const keys = ['1', '2', '3', '4', '5', '6', '7', '8', '9'];
  return (
    <div class={`gtn-radio gtn-radio-${g.model}`}>
      <div class="gtn-radio-top">
        <span class="gtn-radio-find" />
        <span class={`gtn-entry-field${e.typed ? ' is-editing' : ''}`} aria-live="polite" aria-label={`OBS course ${courseText(e)}`}>
          <span class={e.typed ? '' : 'gtn-entry-current'}>{courseText(e)}</span>
        </span>
        <GlyphKey glyph="backspace" text={g.model === '750' ? 'Backspace' : 'BKSP'} class="gtn-radio-bksp" onPress={() => setEntry(g, page, backspace(e))} />
      </div>
      <div class="gtn-radio-pad">
        {[...keys, ...(g.model === '650' ? ['0'] : [])].map((k) => (
          <Key key={k} class="gtn-round-key" onPress={() => setEntry(g, page, pressDigit(e, k))}>
            {k}
          </Key>
        ))}
      </div>
      {g.model === '750' && (
        <div class="gtn-radio-bottom">
          <span class="gtn-radio-mon" />
          <Key class="gtn-round-key" onPress={() => setEntry(g, page, pressDigit(e, '0'))}>
            0
          </Key>
          <span class="gtn-radio-mon" />
        </div>
      )}
    </div>
  );
}

export function obsCourseView(g: Gtn, page: ObsPage): PageView {
  return {
    title: 'Select OBS Course',
    body: <ObsBody g={g} page={page} />,
    controls: { primary: { label: 'Enter', glyph: 'enter', onPress: () => enter(g, page) } },
    knob: {
      inner: (n) => setEntry(g, page, stepCourse(page.entry, n)),
      outer: (n) => setEntry(g, page, stepCourse(page.entry, n * 10)),
      push: () => enter(g, page),
      hint: 'Course / Psh Enter',
      labels: { outer: '10 degrees', inner: '1 degree', push: 'Enter' },
    },
  };
}
