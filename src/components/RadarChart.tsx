import React from 'react';
import { motion } from 'framer-motion';
import type { Criterion, Option } from '../types/decision';

interface RadarChartProps {
  criteria: Criterion[];
  options: Option[];
  weights: Record<string, number>;
  activeOptionIds: string[];
}

export const RadarChart: React.FC<RadarChartProps> = ({
  criteria,
  options,
  weights,
  activeOptionIds,
}) => {
  const size = 360;
  const center = size / 2;
  const radius = size * 0.34;
  const numAxes = criteria.length;

  const getAngle = (index: number) => {
    return (Math.PI * 2 * index) / numAxes - Math.PI / 2;
  };

  const getCoordinates = (index: number, value: number) => {
    const angle = getAngle(index);
    const r = (value / 100) * radius;
    const x = center + r * Math.cos(angle);
    const y = center + r * Math.sin(angle);
    return { x, y };
  };

  const gridLevels = [0.25, 0.5, 0.75, 1.0];

  return (
    <div className="relative flex flex-col items-center justify-center p-4 sm:p-6 bg-surface-card rounded-2xl sm:rounded-3xl border border-border w-full overflow-hidden">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between w-full pb-3 border-b border-border-subtle mb-4 gap-2">
        <div className="flex items-center gap-2">
          <span className="w-2 h-2 rounded-full bg-signal animate-ping" />
          <span className="text-xs font-mono font-bold uppercase text-slate-200 tracking-wider">
            Multi-Dimensional Radar Polygon
          </span>
        </div>
        <div className="flex flex-wrap items-center gap-3 text-[11px] font-mono">
          {options
            .filter((o) => activeOptionIds.includes(o.id))
            .map((opt) => (
              <div key={opt.id} className="flex items-center gap-1.5">
                <span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: opt.color }} />
                <span className="text-slate-300 font-semibold">{opt.name.replace('Company ', '')}</span>
              </div>
            ))}
        </div>
      </div>

      {/* Fully responsive SVG using viewBox */}
      <div className="w-full max-w-[340px] aspect-square flex items-center justify-center">
        <svg
          viewBox={`0 0 ${size} ${size}`}
          className="w-full h-full select-none overflow-visible"
        >
          <defs>
            <filter id="radar-glow-signal" x="-20%" y="-20%" width="140%" height="140%">
              <feGaussianBlur stdDeviation="3" result="blur" />
              <feComposite in="SourceGraphic" in2="blur" operator="over" />
            </filter>
          </defs>

          {/* Concentric Grid Rings */}
          {gridLevels.map((level, lvlIdx) => {
            const points = criteria
              .map((_, i) => {
                const angle = getAngle(i);
                const r = radius * level;
                return `${center + r * Math.cos(angle)},${center + r * Math.sin(angle)}`;
              })
              .join(' ');

            return (
              <polygon
                key={lvlIdx}
                points={points}
                fill="none"
                stroke="#262B3B"
                strokeWidth={lvlIdx === gridLevels.length - 1 ? '1.5' : '1'}
                strokeDasharray={lvlIdx < gridLevels.length - 1 ? '3 3' : undefined}
              />
            );
          })}

          {/* Axis Lines & Labels */}
          {criteria.map((c, i) => {
            const outer = getCoordinates(i, 100);
            const weightPercent = weights[c.id] || 0;
            const weightR = (weightPercent / 100) * radius;
            const angle = getAngle(i);
            const weightX = center + weightR * Math.cos(angle);
            const weightY = center + weightR * Math.sin(angle);

            const labelDist = radius + 22;
            const labelX = center + labelDist * Math.cos(angle);
            const labelY = center + labelDist * Math.sin(angle);

            return (
              <g key={c.id}>
                <line
                  x1={center}
                  y1={center}
                  x2={outer.x}
                  y2={outer.y}
                  stroke="#202430"
                  strokeWidth="1"
                />

                <circle
                  cx={weightX}
                  cy={weightY}
                  r="3.5"
                  fill="#08090A"
                  stroke="#B8FF5A"
                  strokeWidth="1.5"
                />

                <text
                  x={labelX}
                  y={labelY}
                  textAnchor={
                    Math.abs(Math.cos(angle)) < 0.1
                      ? 'middle'
                      : Math.cos(angle) > 0
                      ? 'start'
                      : 'end'
                  }
                  dominantBaseline="central"
                  fill="#94A3B8"
                  fontSize="10"
                  fontFamily="var(--font-mono)"
                  className="font-medium"
                >
                  {c.shortName} ({weightPercent}%)
                </text>
              </g>
            );
          })}

          {/* Option Polygons */}
          {options
            .filter((o) => activeOptionIds.includes(o.id))
            .map((option) => {
              const pointsString = criteria
                .map((c, i) => {
                  const score = option.scores[c.id] || 50;
                  const { x, y } = getCoordinates(i, score);
                  return `${x},${y}`;
                })
                .join(' ');

              return (
                <g key={option.id}>
                  <motion.polygon
                    points={pointsString}
                    fill={option.color}
                    fillOpacity="0.2"
                    stroke={option.color}
                    strokeWidth="2"
                    strokeLinejoin="round"
                    filter={option.id === 'alpha' ? 'url(#radar-glow-signal)' : undefined}
                    initial={false}
                    animate={{ points: pointsString }}
                    transition={{ type: 'spring', stiffness: 220, damping: 25 }}
                  />

                  {criteria.map((c, i) => {
                    const score = option.scores[c.id] || 50;
                    const { x, y } = getCoordinates(i, score);
                    return (
                      <motion.circle
                        key={c.id}
                        cx={x}
                        cy={y}
                        r="4"
                        fill={option.color}
                        stroke="#08090A"
                        strokeWidth="1.5"
                        animate={{ cx: x, cy: y }}
                        transition={{ type: 'spring', stiffness: 220, damping: 25 }}
                      />
                    );
                  })}
                </g>
              );
            })}

          <circle cx={center} cy={center} r="2.5" fill="#64748B" />
        </svg>
      </div>

      <div className="w-full flex flex-col sm:flex-row sm:items-center justify-between pt-3 border-t border-border-subtle text-[10px] font-mono text-slate-400 gap-1 mt-2">
        <span>* Green dots on spokes indicate allocated weights</span>
        <span>Polygon surface area reflects dimensional coverage</span>
      </div>
    </div>
  );
};
