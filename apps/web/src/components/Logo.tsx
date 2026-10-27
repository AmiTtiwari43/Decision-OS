import React from 'react';

interface LogoProps {
  size?: 'sm' | 'md' | 'lg';
  className?: string;
  withGlow?: boolean;
}

export const Logo: React.FC<LogoProps> = ({
  size = 'md',
  className = '',
  withGlow = true,
}) => {
  const dimensionMap = {
    sm: 'w-7 h-7',
    md: 'w-9 h-9',
    lg: 'w-12 h-12',
  };

  const pixelMap = {
    sm: 28,
    md: 36,
    lg: 48,
  };

  const px = pixelMap[size];

  return (
    <div
      className={`relative flex items-center justify-center rounded-xl bg-gradient-to-br from-surface-card to-surface border border-signal/30 p-1 group-hover:border-signal/70 group-hover:shadow-glow-signal-sm transition-all duration-300 ${dimensionMap[size]} ${className}`}
    >
      {/* Background radial glow */}
      {withGlow && (
        <div className="absolute inset-0 bg-signal/15 rounded-xl blur-md opacity-70 group-hover:opacity-100 transition-opacity pointer-events-none" />
      )}

      {/* SVG Isometric Decision Prism Mark */}
      <svg
        viewBox="0 0 48 48"
        width={px - 8}
        height={px - 8}
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        className="relative z-10 select-none transform group-hover:scale-105 transition-transform duration-300"
      >
        <defs>
          <linearGradient id="logo-neon-lime" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="#D4FF8A" />
            <stop offset="100%" stopColor="#B8FF5A" />
          </linearGradient>
          <linearGradient id="logo-cyan-edge" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="#38BDF8" />
            <stop offset="100%" stopColor="#0284C7" />
          </linearGradient>
          <filter id="logo-inner-glow" x="-20%" y="-20%" width="140%" height="140%">
            <feGaussianBlur stdDeviation="2" result="blur" />
            <feComposite in="SourceGraphic" in2="blur" operator="over" />
          </filter>
        </defs>

        {/* Outer Isometric Hexagon Skeleton (Cyan) */}
        <path
          d="M24 4L42 14V34L24 44L6 34V14L24 4Z"
          stroke="url(#logo-cyan-edge)"
          strokeWidth="2.5"
          strokeLinecap="round"
          strokeLinejoin="round"
          opacity="0.85"
        />

        {/* Isometric Internal Dividing Axes */}
        <path
          d="M24 4V24M42 14L24 24M6 14L24 24M24 24V44M24 24L42 34M24 24L6 34"
          stroke="#1E293B"
          strokeWidth="1.5"
          strokeLinecap="round"
        />

        {/* Central Core Decision Node (Glowing Lime Green Prism) */}
        <path
          d="M24 14L33 19V29L24 34L15 29V19L24 14Z"
          fill="#111318"
          stroke="url(#logo-neon-lime)"
          strokeWidth="2.5"
          strokeLinecap="round"
          strokeLinejoin="round"
          filter="url(#logo-inner-glow)"
        />

        {/* Inner Isometric Y-Split Focal Node */}
        <path
          d="M24 24L33 19M24 24L15 19M24 24V34"
          stroke="url(#logo-neon-lime)"
          strokeWidth="2"
          strokeLinecap="round"
        />

        {/* Central Core Center Dot */}
        <circle cx="24" cy="24" r="2.5" fill="#B8FF5A" />
      </svg>
    </div>
  );
};
