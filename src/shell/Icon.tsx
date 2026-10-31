const PATHS = {
  play: 'M7 4.5v15l12-7.5L7 4.5Z',
  pause: 'M7 4h4v16H7zM13 4h4v16h-4z',
  help: 'M22 12a10 10 0 1 1-20 0 10 10 0 0 1 20 0ZM9.1 9a3 3 0 0 1 5.8 1c0 2-3 2.5-3 4.5M12 17.5v.01',
  expand: 'M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7',
  shrink: 'M4 14h6v6M20 10h-6V4M14 10l7-7M3 21l7-7',
  close: 'M18 6 6 18M6 6l12 12',
  share: 'M12 3v12M8 7l4-4 4 4M5 12v7a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-7',
  sliders: 'M4 21v-7M4 10V3M12 21v-9M12 8V3M20 21v-5M20 12V3M1 14h6M9 8h6M17 16h6',
  plane: 'M21 16v-2l-8-5V3.5a1.5 1.5 0 0 0-3 0V9l-8 5v2l8-2.5V19l-2 1.5V22l3.5-1 3.5 1v-1.5L13 19v-5.5l8 2.5Z',
  panel: 'M3 4h18v16H3zM3 10h18M10 10v10',
  reset: 'M3 12a9 9 0 1 0 3-6.7L3 8M3 3v5h5',
  level: 'M2 12h20M12 7v10',
  chevron: 'm6 9 6 6 6-6',
} as const;

export type ShellIconName = keyof typeof PATHS;

export function Icon({ name }: { name: ShellIconName }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
      <path d={PATHS[name]} fill={name === 'play' || name === 'pause' ? 'currentColor' : 'none'} />
    </svg>
  );
}
