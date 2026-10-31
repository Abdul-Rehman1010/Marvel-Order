"use client";

import { useId } from "react";

import { useAnimatedNumber } from "@/lib/use-motion";

const TICKS = 60;
const SIZE = 120;
const RADIUS = 50;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;

/** Replaces the plain conic-gradient ring with an animated SVG gauge: gradient stroke, rim ticks, and a count-up label. Same `value` contract as the original ProgressRing. */
export function ProgressReactor({ value, tone = "global" }: { value: number; tone?: "global" | "local" }) {
  const gradientId = useId();
  const displayValue = useAnimatedNumber(value);
  const offset = CIRCUMFERENCE * (1 - value / 100);
  const center = SIZE / 2;

  return (
    <div className={`progress-reactor ${tone}`}>
      <svg viewBox={`0 0 ${SIZE} ${SIZE}`} width="100%" height="100%" aria-hidden="true">
        <defs>
          <linearGradient id={gradientId} x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor={tone === "global" ? "var(--global)" : "var(--accent)"} />
            <stop offset="100%" stopColor={tone === "global" ? "var(--mcu)" : "var(--global)"} />
          </linearGradient>
        </defs>
        <g className="reactor-ticks">
          {Array.from({ length: TICKS }, (_, index) => {
            const angle = (index / TICKS) * 360;
            const lit = index / TICKS <= value / 100;
            return (
              <line
                key={index}
                x1={center}
                y1={4}
                x2={center}
                y2={9}
                className={lit ? "lit" : ""}
                transform={`rotate(${angle} ${center} ${center})`}
              />
            );
          })}
        </g>
        <circle className="reactor-track" cx={center} cy={center} r={RADIUS} />
        <circle
          className="reactor-fill"
          cx={center}
          cy={center}
          r={RADIUS}
          stroke={`url(#${gradientId})`}
          strokeDasharray={CIRCUMFERENCE}
          strokeDashoffset={offset}
          transform={`rotate(-90 ${center} ${center})`}
        />
      </svg>
      <div className="reactor-readout">
        <strong>{displayValue}%</strong>
        <span>SYNCED</span>
      </div>
    </div>
  );
}
