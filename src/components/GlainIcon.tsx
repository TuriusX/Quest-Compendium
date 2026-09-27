import React from 'react';

/**
 * The Glain stone from the logo's cover, used as the icon for the daily question count.
 * The stone follows the player's theme (--accent-color). Drawn on a 5x5 grid, so use sizes
 * that are multiples of 5 (10, 15, 20) to keep every pixel crisp.
 */
export const GlainIcon: React.FC<{ size?: number; className?: string; title?: string }> = ({ size = 15, className, title }) => (
  <svg
    className={className}
    width={size}
    height={size}
    viewBox="0 0 5 5"
    xmlns="http://www.w3.org/2000/svg"
    shapeRendering="crispEdges"
    style={{ imageRendering: 'pixelated', flexShrink: 0 }}
    role={title ? 'img' : undefined}
    aria-label={title}
    aria-hidden={title ? undefined : true}
  >
    <rect x="1" y="0" width="3" height="1" fill="#0b0916" />
    <rect x="0" y="1" width="1" height="3" fill="#0b0916" />
    <rect x="4" y="1" width="1" height="3" fill="#0b0916" />
    <rect x="1" y="4" width="3" height="1" fill="#0b0916" />
    <rect x="1" y="1" width="3" height="3" fill="var(--accent-color, #a87ffb)" />
    <rect x="2" y="2" width="1" height="1" fill="#ffffff" />
  </svg>
);
