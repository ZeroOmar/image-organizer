import icon from '@brand/app-icon.svg';

/** The app logo (apps/app-icon.svg). Brand mark only: its petal colors are never used as UI colors. */
export function Logo({ size = 28 }: { size?: number }) {
  return <img src={icon} width={size} height={size} alt="" aria-hidden="true" style={{ display: 'block' }} />;
}
