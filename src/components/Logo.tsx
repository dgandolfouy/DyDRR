import React from 'react';
import { LOGO_PATHS } from './LogoPaths';

export const Logo = ({ className }: { className?: string }) => (
  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 445.41 237.71" className={className}>
    <g fill="currentColor">
      {LOGO_PATHS.text.map((d, i) => (
        <path key={i} d={d} />
      ))}
    </g>
    <g>
      <path fill="#ef7d00" d={LOGO_PATHS.ball} />
      <path fill="currentColor" fillRule="evenodd" d={LOGO_PATHS.rr} />
      <path fill="#ec6608" d={LOGO_PATHS.trademark} />
    </g>
  </svg>
);
