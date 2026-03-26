import { useState, useEffect } from "react";

function formatUTC(date: Date): string {
  return date.toUTCString().slice(17, 25); // HH:MM:SS
}

function formatLocal(date: Date): string {
  const time = date.toLocaleTimeString("en-GB", { hour12: false });
  const tz = date.toLocaleTimeString("en-US", { timeZoneName: "short" }).split(" ").pop() || "";
  return `${time} ${tz}`;
}

const LiveClock = () => {
  const [now, setNow] = useState(new Date());

  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(id);
  }, []);

  return (
    <div
      className="fixed top-3 right-4 z-50 text-xs font-mono text-muted-foreground select-none"
      role="status"
      aria-label="Current UTC and local time"
    >
      <span className="hidden sm:inline">
        UTC: {formatUTC(now)} | Local: {formatLocal(now)}
      </span>
      <span className="sm:hidden flex flex-col items-end leading-tight">
        <span>UTC: {formatUTC(now)}</span>
        <span>Local: {formatLocal(now)}</span>
      </span>
    </div>
  );
};

export default LiveClock;
