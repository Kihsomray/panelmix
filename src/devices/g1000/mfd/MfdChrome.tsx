import type { GpsSolution } from '../../../sim/fms';
import { formatBearing, formatEte } from '../../../ui/format';
import { PAGE_GROUPS, type MfdPages } from './mfdPages';

/*
 * MFD furniture: the navigation data bar (GS, DTK, TRK, ETE, the default
 * four fields) and the page title in the top band, and the page group
 * indicator at the bottom right, which lists the pages of the group while
 * the FMS knob is selecting one.
 */

export function NavDataBar({ gps, groundSpeedKt, trackMag }: { gps: GpsSolution; groundSpeedKt: number; trackMag: number }) {
  return (
    <div class="g1000-databar">
      <div>
        <span class="g1000-lbl">GS</span>
        <span class="g1000-mag">
          {Math.round(groundSpeedKt)}
          <small class="g1000-unit">KT</small>
        </span>
      </div>
      <div>
        <span class="g1000-lbl">DTK</span>
        <span class="g1000-mag">{gps.active ? formatBearing(gps.dtkMag) : '___°'}</span>
      </div>
      <div>
        <span class="g1000-lbl">TRK</span>
        <span class="g1000-mag">{formatBearing(trackMag)}</span>
      </div>
      <div>
        <span class="g1000-lbl">ETE</span>
        <span class="g1000-mag">{formatEte(gps.eteSec)}</span>
      </div>
    </div>
  );
}

export function PageTitle({ title }: { title: string }) {
  return <div class="g1000-pagetitle">{title}</div>;
}

export function PageGroups({ pages, picking }: { pages: MfdPages; picking: boolean }) {
  const group = PAGE_GROUPS[pages.current.group]!;
  return (
    <div class="g1000-pagegroups">
      {picking && !pages.proc && (
        <div class="g1000-pagelist">
          {group.pages.map((p, i) => (
            <div key={p.id} class={i === pages.current.page ? 'is-current' : ''}>
              {p.title}
            </div>
          ))}
        </div>
      )}
      <div class="g1000-tabs">
        {PAGE_GROUPS.map((g, i) => (
          <span key={g.id} class={i === pages.current.group && !pages.proc ? 'is-current' : ''}>
            {g.tab}
          </span>
        ))}
      </div>
      {!picking && (
        <div class="g1000-pagedots" aria-hidden="true">
          {group.pages.map((p, i) => (
            <i key={p.id} class={i === pages.current.page ? 'is-current' : ''} />
          ))}
        </div>
      )}
    </div>
  );
}
