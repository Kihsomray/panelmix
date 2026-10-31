import type { DeviceProps } from './types';

/** Stand-in shown while a device family is being built. */
export function PlaceholderDevice({ spec }: DeviceProps) {
  return (
    <div class="placeholder-device">
      <div>
        <strong>
          {spec.maker} {spec.name}
        </strong>
        <span>Coming soon</span>
      </div>
    </div>
  );
}

export default PlaceholderDevice;
