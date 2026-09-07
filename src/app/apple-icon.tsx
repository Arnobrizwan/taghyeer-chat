import { ImageResponse } from 'next/og';

/**
 * iOS home-screen icon. Generated rather than committed as a binary so the mark lives in
 * exactly one place — change `public/logo.svg` and this follows.
 *
 * It is full-bleed vermilion instead of the rounded tile the favicon uses: iOS applies
 * its own squircle mask, and a tile inside that mask would show a second, smaller
 * rounded square floating in a transparent field.
 */
export const size = { width: 180, height: 180 };
export const contentType = 'image/png';

export default function AppleIcon() {
  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: '#cf3d18',
        }}
      >
        {/* The mark from public/logo.svg, minus its tile, scaled 32 → 140. */}
        <svg width="140" height="140" viewBox="0 0 32 32">
          <g fill="#fff">
            <path d="M18.6 15.5h4.4v9q0 1.4-1.3.6z" />
            <rect x="7" y="8" width="18" height="13" rx="5" />
          </g>
          <g fill="#cf3d18">
            <rect x="11.2" y="15.1" width="2.4" height="2.8" rx="1.2" />
            <rect x="14.8" y="13.1" width="2.4" height="4.8" rx="1.2" />
            <rect x="18.4" y="11.1" width="2.4" height="6.8" rx="1.2" />
          </g>
        </svg>
      </div>
    ),
    { ...size },
  );
}
