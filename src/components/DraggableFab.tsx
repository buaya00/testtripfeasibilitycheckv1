import React, { useState, useRef, useCallback, useEffect } from "react";
import { GripHorizontal } from "lucide-react";
import { cn } from "@/lib/utils";

interface DraggableFabProps {
  children: React.ReactNode;
  fabIcon: React.ReactNode;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  className?: string;
}

// Bumped to v4 so anyone with a stale saved position (e.g. stuck blocking
// content) resets to the bottom-right default on next load.
const STORAGE_KEY = "fab-position-v4";
const FAB_SIZE = 48;
const MARGIN = 8;

function getDefaultPosition() {
  if (typeof window === "undefined") return { left: 350, top: 600 };
  return {
    left: window.innerWidth - FAB_SIZE - 24,
    top: window.innerHeight - FAB_SIZE - 24,
  };
}

function clamp(pos: { left: number; top: number }) {
  if (typeof window === "undefined") return pos;
  return {
    left: Math.max(MARGIN, Math.min(window.innerWidth - FAB_SIZE - MARGIN, pos.left)),
    top: Math.max(MARGIN, Math.min(window.innerHeight - FAB_SIZE - MARGIN, pos.top)),
  };
}

export function DraggableFab({ children, fabIcon, open, onOpenChange, className }: DraggableFabProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef({ active: false, startX: 0, startY: 0, moved: false });

  const [pos, setPos] = useState<{ left: number; top: number }>(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const p = JSON.parse(raw);
        if (Number.isFinite(p.left) && Number.isFinite(p.top)) return clamp(p);
      }
    } catch {}
    // Clear any legacy keys
    try {
      localStorage.removeItem("fab-position");
      localStorage.removeItem("fab-position-v2");
      localStorage.removeItem("fab-position-v3");
    } catch {}
    return getDefaultPosition();
  });

  const save = useCallback((p: { left: number; top: number }) => {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(p)); } catch {}
  }, []);

  // Re-clamp on window resize
  useEffect(() => {
    const onResize = () => setPos(prev => { const c = clamp(prev); save(c); return c; });
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [save]);

  // Close on outside tap
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent | TouchEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        onOpenChange(false);
      }
    };
    document.addEventListener("mousedown", handler);
    document.addEventListener("touchstart", handler, { passive: true });
    return () => {
      document.removeEventListener("mousedown", handler);
      document.removeEventListener("touchstart", handler);
    };
  }, [open, onOpenChange]);

  const xy = (e: React.MouseEvent | React.TouchEvent | MouseEvent | TouchEvent) => {
    if ("touches" in e && e.touches.length) return { x: e.touches[0].clientX, y: e.touches[0].clientY };
    if ("clientX" in e) return { x: (e as MouseEvent).clientX, y: (e as MouseEvent).clientY };
    return { x: 0, y: 0 };
  };

  const onPointerDown = useCallback((e: React.MouseEvent | React.TouchEvent) => {
    const { x, y } = xy(e);
    dragRef.current = { active: true, startX: x, startY: y, moved: false };
  }, []);

  useEffect(() => {
    const onMove = (e: MouseEvent | TouchEvent) => {
      const d = dragRef.current;
      if (!d.active) return;
      const { x, y } = xy(e);
      const dx = x - d.startX;
      const dy = y - d.startY;
      if (!d.moved && Math.abs(dx) < 5 && Math.abs(dy) < 5) return;
      d.moved = true;
      e.preventDefault();
      setPos(prev => clamp({ left: prev.left + dx, top: prev.top + dy }));
      d.startX = x;
      d.startY = y;
    };
    const onUp = () => {
      if (dragRef.current.active) {
        dragRef.current.active = false;
        setPos(p => { save(p); return p; });
      }
    };
    document.addEventListener("mousemove", onMove);
    document.addEventListener("touchmove", onMove, { passive: false });
    document.addEventListener("mouseup", onUp);
    document.addEventListener("touchend", onUp);
    return () => {
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("touchmove", onMove);
      document.removeEventListener("mouseup", onUp);
      document.removeEventListener("touchend", onUp);
    };
  }, [save]);

  const handleFabClick = useCallback(() => {
    if (!dragRef.current.moved) onOpenChange(!open);
  }, [open, onOpenChange]);

  return (
    <div
      ref={containerRef}
      className={cn("fixed z-50", className)}
      style={{ left: pos.left, top: pos.top }}
    >
      {/* Collapsed FAB — mobile only */}
      {!open && (
        <button
          onMouseDown={onPointerDown}
          onTouchStart={onPointerDown}
          onClick={handleFabClick}
          className="sm:hidden flex items-center justify-center h-12 w-12 rounded-full bg-primary text-primary-foreground shadow-lg active:scale-95 transition-transform touch-none select-none"
          aria-label="Open action toolbar"
        >
          {fabIcon}
        </button>
      )}

      {/* Expanded toolbar */}
      <div className={cn(
        "flex flex-col gap-1 bg-background/95 backdrop-blur-sm border rounded-xl shadow-xl min-w-[160px] transition-all duration-200 origin-bottom-right",
        open ? "scale-100 opacity-100" : "sm:scale-100 sm:opacity-100 scale-0 opacity-0 pointer-events-none sm:pointer-events-auto"
      )}>
        {/* Drag handle — grab and move the toolbar anywhere, any number of times */}
        <div
          onMouseDown={onPointerDown}
          onTouchStart={onPointerDown}
          className="flex items-center justify-center py-1 cursor-move touch-none select-none text-muted-foreground/60 hover:text-muted-foreground"
          title="Drag to move"
        >
          <GripHorizontal className="h-3.5 w-3.5" />
        </div>
        <div className="flex flex-col gap-1 p-2 pt-0">
          {children}
        </div>
      </div>
    </div>
  );
}
