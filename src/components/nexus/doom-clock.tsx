"use client";

import { Fragment } from "react";

import { usePrefersReducedMotion } from "@/lib/use-motion";

type Unit = "days" | "hours" | "minutes" | "seconds";

function FlapDigit({ value }: { value: string }) {
  const reduced = usePrefersReducedMotion();
  return (
    <span className="flap-digit" aria-hidden="true">
      {reduced ? value : <span key={value} className="flap-digit-face">{value}</span>}
    </span>
  );
}

function FlapUnit({ unit, value }: { unit: Unit; value: number }) {
  const label = String(value).padStart(2, "0");
  return (
    <div className="flap-unit">
      <div className="flap-digits">
        {label.split("").map((digit, index) => (
          <FlapDigit key={index} value={digit} />
        ))}
      </div>
      <span className="flap-label">{unit.slice(0, 3)}</span>
    </div>
  );
}

export function DoomClock({ countdown }: { countdown: Record<Unit, number> }) {
  const units: Unit[] = ["days", "hours", "minutes", "seconds"];
  const srText = `${countdown.days} days, ${countdown.hours} hours, ${countdown.minutes} minutes, ${countdown.seconds} seconds until Avengers: Doomsday`;
  return (
    <div className="doom-clock">
      <div className="doom-clock-head">
        <span className="pulse-dot" /> DOOMSDAY ARRIVES
      </div>
      <div className="flap-row">
        {units.map((unit, index) => (
          <Fragment key={unit}>
            {index > 0 && <span className="flap-colon" aria-hidden="true">:</span>}
            <FlapUnit unit={unit} value={countdown[unit]} />
          </Fragment>
        ))}
      </div>
      <p className="doom-clock-caption">AVENGERS: DOOMSDAY · DEC 18 2026</p>
      <span className="sr-only">{srText}</span>
    </div>
  );
}
