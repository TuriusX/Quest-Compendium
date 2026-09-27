import React from 'react';

/**
 * The Quest Compendium logo: a 16x16 pixel-art book with the Glain stone on its cover.
 * The stone follows the player's theme (--accent-color). Its centre is white at small sizes
 * and warm cream when the logo is shown large. Use sizes that are multiples of 16 so every
 * pixel stays crisp.
 */
export const QuestLogo: React.FC<{ size?: number; className?: string; large?: boolean; background?: string }> = ({
  size = 32,
  className,
  large = false,
  background,
}) => {
  const stone = 'var(--accent-color, #a87ffb)';
  const heart = large ? '#fff6d5' : '#ffffff';
  return (
    <svg
      className={className}
      width={size}
      height={size}
      viewBox="0 0 16 16"
      xmlns="http://www.w3.org/2000/svg"
      shapeRendering="crispEdges"
      style={{ imageRendering: 'pixelated' }}
      aria-hidden="true"
    >
      {background && <rect width="16" height="16" rx="3" fill={background} />}
      <rect x="1" y="1" width="12" height="1" fill="#0b0916" />
      <rect x="1" y="2" width="1" height="1" fill="#0b0916" />
      <rect x="2" y="2" width="1" height="1" fill="#1c1635" />
      <rect x="3" y="2" width="7" height="1" fill="#16112c" />
      <rect x="10" y="2" width="2" height="1" fill="#f4c535" />
      <rect x="12" y="2" width="1" height="1" fill="#0b0916" />
      <rect x="13" y="2" width="1" height="1" fill="#d6cda4" />
      <rect x="0" y="3" width="2" height="1" fill="#f4c535" />
      <rect x="2" y="3" width="1" height="1" fill="#1c1635" />
      <rect x="3" y="3" width="8" height="1" fill="#16112c" />
      <rect x="11" y="3" width="1" height="1" fill="#f4c535" />
      <rect x="12" y="3" width="1" height="1" fill="#0b0916" />
      <rect x="13" y="3" width="1" height="1" fill="#a49a71" />
      <rect x="1" y="4" width="1" height="1" fill="#0b0916" />
      <rect x="2" y="4" width="1" height="1" fill="#1c1635" />
      <rect x="3" y="4" width="9" height="1" fill="#16112c" />
      <rect x="12" y="4" width="1" height="1" fill="#0b0916" />
      <rect x="13" y="4" width="1" height="1" fill="#d6cda4" />
      <rect x="1" y="5" width="1" height="1" fill="#0b0916" />
      <rect x="2" y="5" width="1" height="1" fill="#1c1635" />
      <rect x="3" y="5" width="9" height="1" fill="#16112c" />
      <rect x="12" y="5" width="1" height="1" fill="#0b0916" />
      <rect x="13" y="5" width="1" height="1" fill="#a49a71" />
      <rect x="1" y="6" width="1" height="1" fill="#0b0916" />
      <rect x="2" y="6" width="1" height="1" fill="#1c1635" />
      <rect x="3" y="6" width="3" height="1" fill="#16112c" />
      <rect x="6" y="6" width="3" height="1" fill="#0b0916" />
      <rect x="9" y="6" width="3" height="1" fill="#16112c" />
      <rect x="12" y="6" width="1" height="1" fill="#0b0916" />
      <rect x="13" y="6" width="1" height="1" fill="#d6cda4" />
      <rect x="1" y="7" width="1" height="1" fill="#0b0916" />
      <rect x="2" y="7" width="1" height="1" fill="#1c1635" />
      <rect x="3" y="7" width="2" height="1" fill="#16112c" />
      <rect x="5" y="7" width="1" height="1" fill="#0b0916" />
      <rect x="6" y="7" width="3" height="1" fill={stone} />
      <rect x="9" y="7" width="1" height="1" fill="#0b0916" />
      <rect x="10" y="7" width="2" height="1" fill="#16112c" />
      <rect x="12" y="7" width="1" height="1" fill="#0b0916" />
      <rect x="13" y="7" width="1" height="1" fill="#a49a71" />
      <rect x="1" y="8" width="1" height="1" fill="#0b0916" />
      <rect x="2" y="8" width="1" height="1" fill="#1c1635" />
      <rect x="3" y="8" width="2" height="1" fill="#16112c" />
      <rect x="5" y="8" width="1" height="1" fill="#0b0916" />
      <rect x="6" y="8" width="1" height="1" fill={stone} />
      <rect x="7" y="8" width="1" height="1" fill={heart} />
      <rect x="8" y="8" width="1" height="1" fill={stone} />
      <rect x="9" y="8" width="1" height="1" fill="#0b0916" />
      <rect x="10" y="8" width="2" height="1" fill="#16112c" />
      <rect x="12" y="8" width="1" height="1" fill="#0b0916" />
      <rect x="13" y="8" width="1" height="1" fill="#d6cda4" />
      <rect x="1" y="9" width="1" height="1" fill="#0b0916" />
      <rect x="2" y="9" width="1" height="1" fill="#1c1635" />
      <rect x="3" y="9" width="2" height="1" fill="#16112c" />
      <rect x="5" y="9" width="1" height="1" fill="#0b0916" />
      <rect x="6" y="9" width="3" height="1" fill={stone} />
      <rect x="9" y="9" width="1" height="1" fill="#0b0916" />
      <rect x="10" y="9" width="2" height="1" fill="#16112c" />
      <rect x="12" y="9" width="1" height="1" fill="#0b0916" />
      <rect x="13" y="9" width="1" height="1" fill="#a49a71" />
      <rect x="1" y="10" width="1" height="1" fill="#0b0916" />
      <rect x="2" y="10" width="1" height="1" fill="#1c1635" />
      <rect x="3" y="10" width="3" height="1" fill="#16112c" />
      <rect x="6" y="10" width="3" height="1" fill="#0b0916" />
      <rect x="9" y="10" width="3" height="1" fill="#16112c" />
      <rect x="12" y="10" width="1" height="1" fill="#0b0916" />
      <rect x="13" y="10" width="1" height="1" fill="#d6cda4" />
      <rect x="1" y="11" width="1" height="1" fill="#0b0916" />
      <rect x="2" y="11" width="1" height="1" fill="#1c1635" />
      <rect x="3" y="11" width="9" height="1" fill="#16112c" />
      <rect x="12" y="11" width="1" height="1" fill="#0b0916" />
      <rect x="13" y="11" width="1" height="1" fill="#a49a71" />
      <rect x="0" y="12" width="2" height="1" fill="#f4c535" />
      <rect x="2" y="12" width="1" height="1" fill="#1c1635" />
      <rect x="3" y="12" width="9" height="1" fill="#16112c" />
      <rect x="12" y="12" width="1" height="1" fill="#0b0916" />
      <rect x="13" y="12" width="1" height="1" fill="#d6cda4" />
      <rect x="1" y="13" width="1" height="1" fill="#0b0916" />
      <rect x="2" y="13" width="1" height="1" fill="#1c1635" />
      <rect x="3" y="13" width="8" height="1" fill="#16112c" />
      <rect x="11" y="13" width="1" height="1" fill="#f4c535" />
      <rect x="12" y="13" width="1" height="1" fill="#0b0916" />
      <rect x="13" y="13" width="1" height="1" fill="#a49a71" />
      <rect x="1" y="14" width="1" height="1" fill="#0b0916" />
      <rect x="2" y="14" width="1" height="1" fill="#1c1635" />
      <rect x="3" y="14" width="7" height="1" fill="#16112c" />
      <rect x="10" y="14" width="2" height="1" fill="#f4c535" />
      <rect x="12" y="14" width="1" height="1" fill="#0b0916" />
      <rect x="13" y="14" width="1" height="1" fill="#d6cda4" />
      <rect x="1" y="15" width="13" height="1" fill="#0b0916" />
    </svg>
  );
};
