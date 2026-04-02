import { useState, useEffect } from "react";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";

function formatUTC(date: Date): string {
  return date.toUTCString().slice(17, 25);
}

function formatLocal(date: Date): string {
  const time = date.toLocaleTimeString("en-GB", { hour12: false });
  const tz = date.toLocaleTimeString("en-US", { timeZoneName: "short" }).split(" ").pop() || "";
  return `${time} ${tz}`;
}

function formatUtcDate(date: Date): string {
  return date.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric", timeZone: "UTC" });
}

function formatLocalDate(date: Date): string {
  const d = date.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
  const tz = date.toLocaleTimeString("en-US", { timeZoneName: "short" }).split(" ").pop() || "";
  return `${d} ${tz}`;
}

const UtcTooltip = ({ now, children }: { now: Date; children: React.ReactNode }) => (
  <Tooltip delayDuration={100}>
    <TooltipTrigger asChild>
      <span className="cursor-default" aria-label="Current UTC date">{children}</span>
    </TooltipTrigger>
    <TooltipContent side="bottom" className="text-xs font-mono">
      UTC Date: {formatUtcDate(now)}
    </TooltipContent>
  </Tooltip>
);

const LocalTooltip = ({ now, children }: { now: Date; children: React.ReactNode }) => (
  <Tooltip delayDuration={100}>
    <TooltipTrigger asChild>
      <span className="cursor-default" aria-label="Current local date">{children}</span>
    </TooltipTrigger>
    <TooltipContent side="bottom" className="text-xs font-mono">
      Local Date: {formatLocalDate(now)}
    </TooltipContent>
  </Tooltip>
);

const LiveClock = () => {
  const [now, setNow] = useState(new Date());

  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(id);
  }, []);

  return (
    <div
      className="text-xs font-mono text-muted-foreground select-none"
      role="status"
      aria-label="Current UTC and local time"
    >
      <span className="hidden sm:inline">
        <UtcTooltip now={now}>UTC: {formatUTC(now)}</UtcTooltip>
        {" | "}
        <LocalTooltip now={now}>Local: {formatLocal(now)}</LocalTooltip>
      </span>
      <span className="sm:hidden flex flex-col items-end leading-tight text-[10px]">
        <UtcTooltip now={now}>UTC: {formatUTC(now)}</UtcTooltip>
        <LocalTooltip now={now}>Local: {formatLocal(now)}</LocalTooltip>
      </span>
    </div>
  );
};

export default LiveClock;
