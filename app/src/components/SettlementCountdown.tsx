"use client";
import { useEffect, useState } from "react";

function msToFourPmET(now: Date = new Date()): number {
  // 4:00 PM ET = 16:00 in America/New_York. Use Intl to compute the offset.
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const parts: Record<string, string> = {};
  for (const p of fmt.formatToParts(now)) parts[p.type] = p.value;
  // Take today's ET date components, compose 16:00 ET as an instant.
  // Use a UTC date and subtract the current ET offset.
  const todayET = new Date(`${parts.year}-${parts.month}-${parts.day}T16:00:00`);
  const offsetMins = getETOffsetMinutes(now);
  const target = todayET.getTime() - offsetMins * 60_000;
  return target - now.getTime();
}

function getETOffsetMinutes(d: Date): number {
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    timeZoneName: "shortOffset",
  });
  const parts = dtf.formatToParts(d);
  const tz = parts.find((p) => p.type === "timeZoneName")?.value ?? "GMT-5";
  const match = /GMT([+-]\d+)(?::(\d+))?/.exec(tz);
  if (!match) return -300;
  const h = parseInt(match[1], 10);
  const m = match[2] ? parseInt(match[2], 10) : 0;
  return h * 60 + (h < 0 ? -m : m);
}

export function SettlementCountdown() {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(id);
  }, []);

  const remaining = msToFourPmET(now);
  if (remaining <= 0) {
    return <span className="text-xs text-no">Settled at 4:00 PM ET</span>;
  }
  const totalSec = Math.floor(remaining / 1000);
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  const pad = (n: number) => String(n).padStart(2, "0");
  return (
    <span className="text-xs text-slate-400">
      Settles in <span className="text-slate-200">{`${h}h ${pad(m)}m ${pad(s)}s`}</span>
    </span>
  );
}
