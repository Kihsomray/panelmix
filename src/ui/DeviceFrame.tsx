import { createContext, type ComponentChildren } from 'preact';
import { useContext, useLayoutEffect, useRef, useState } from 'preact/hooks';

/*
 * Every device is designed at a fixed size in "design pixels" (100 per inch
 * of the real bezel) and laid out with absolute positions. DeviceFrame scales
 * that design to whatever space the panel gives it, so device code never
 * deals with screen sizes.
 */

export const PX_PER_INCH = 100;

/** The current design-to-CSS pixel scale; canvases use it to render crisply. */
export const DeviceScaleContext = createContext(1);

export function useDeviceScale(): number {
  return useContext(DeviceScaleContext);
}

interface Props {
  readonly width: number;
  readonly height: number;
  readonly label: string;
  readonly children: ComponentChildren;
}

export function DeviceFrame({ width, height, label, children }: Props) {
  const outer = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(0);

  useLayoutEffect(() => {
    const el = outer.current;
    if (!el) return;
    const measure = () => setScale(el.clientWidth / width);
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [width]);

  return (
    <div
      ref={outer}
      class="device-frame"
      role="group"
      aria-label={label}
      style={{ aspectRatio: `${width} / ${height}` }}
    >
      {scale > 0 && (
        <div
          class="device-canvas"
          style={{ width: `${width}px`, height: `${height}px`, transform: `scale(${scale})` }}
        >
          <DeviceScaleContext.Provider value={scale}>{children}</DeviceScaleContext.Provider>
        </div>
      )}
    </div>
  );
}

/** Absolutely positioned box in design pixels. */
export function Box({
  x,
  y,
  w,
  h,
  class: className,
  style,
  children,
}: {
  x: number;
  y: number;
  w: number;
  h: number;
  class?: string;
  style?: Record<string, string | number>;
  children?: ComponentChildren;
}) {
  return (
    <div class={className} style={{ position: 'absolute', left: `${x}px`, top: `${y}px`, width: `${w}px`, height: `${h}px`, ...style }}>
      {children}
    </div>
  );
}
