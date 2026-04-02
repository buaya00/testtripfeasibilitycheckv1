import React, { useState, useRef, useCallback, useEffect } from "react";
import { cn } from "@/lib/utils";

interface DraggableFabProps {
  children: React.ReactNode;
  fabIcon: React.ReactNode;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  className?: string;
}

const STORAGE_KEY = "fab-position-v2";
const LEGACY_STORAGE_KEYS = ["fab-position"];
const FAB_SIZE = 48;
const MIN_MARGIN = 8;
const DEFAULT_POSITION = { bottom: 24, right: 24 };

const clampOffset = (value: number | undefined, max: number, fallback: number) => (
  Number.isFinite(value) ? Math.max(MIN_MARGIN, Math.min(max, value as number)) : fallback
);

const clampPosition = (position: Partial<{ bottom: number; right: number }>) => {
  if (typeof window === "undefined") {
    return DEFAULT_POSITION;
  }

  const maxRight = Math.max(MIN_MARGIN, window.innerWidth - FAB_SIZE);
  const maxBottom = Math.max(MIN_MARGIN, window.innerHeight - FAB_SIZE);

  return {
    bottom: clampOffset(position.bottom, maxBottom, DEFAULT_POSITION.bottom),
    right: clampOffset(position.right, maxRight, DEFAULT_POSITION.right),
  };
};

export function DraggableFab({ children, fabIcon, open, onOpenChange, className }: DraggableFabProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const dragState = useRef({ dragging: false, startX: 0, startY: 0, hasMoved: false });

  const [pos, setPos] = useState<{ bottom: number; right: number }>(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) return clampPosition(JSON.parse(saved) as Partial<{ bottom: number; right: number }>);

      for (const legacyKey of LEGACY_STORAGE_KEYS) {
        localStorage.removeItem(legacyKey);
      }

      return DEFAULT_POSITION;
    } catch {
      return DEFAULT_POSITION;
    }
  });

  const savePos = useCallback((p: { bottom: number; right: number }) => {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(clampPosition(p))); } catch {}
  }, []);

  useEffect(() => {
    const safePosition = clampPosition(pos);
    if (safePosition.bottom !== pos.bottom || safePosition.right !== pos.right) {
      setPos(safePosition);
      savePos(safePosition);
    }
  }, [pos, savePos]);

  useEffect(() => {
    const handleResize = () => {
      setPos((previous) => {
        const safePosition = clampPosition(previous);
        savePos(safePosition);
        return safePosition;
      });
    };

    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, [savePos]);

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

  const getClientXY = (e: React.MouseEvent | React.TouchEvent | MouseEvent | TouchEvent) => {
    if ("touches" in e && e.touches.length) return { x: e.touches[0].clientX, y: e.touches[0].clientY };
    if ("clientX" in e) return { x: (e as MouseEvent).clientX, y: (e as MouseEvent).clientY };
    return { x: 0, y: 0 };
  };

  const onPointerDown = useCallback((e: React.MouseEvent | React.TouchEvent) => {
    const { x, y } = getClientXY(e);
    dragState.current = { dragging: true, startX: x, startY: y, hasMoved: false };
  }, []);

  useEffect(() => {
    const onMove = (e: MouseEvent | TouchEvent) => {
      const ds = dragState.current;
      if (!ds.dragging) return;
      const { x, y } = getClientXY(e);
      const dx = x - ds.startX;
      const dy = y - ds.startY;
      if (!ds.hasMoved && Math.abs(dx) < 5 && Math.abs(dy) < 5) return;
      ds.hasMoved = true;
      e.preventDefault();
      setPos(prev => {
        const newRight = Math.max(8, Math.min(window.innerWidth - 64, prev.right - dx));
        const newBottom = Math.max(8, Math.min(window.innerHeight - 64, prev.bottom - dy));
        return { bottom: newBottom, right: newRight };
      });
      ds.startX = x;
      ds.startY = y;
    };
    const onUp = () => {
      if (dragState.current.dragging) {
        dragState.current.dragging = false;
        setPos(p => { savePos(p); return p; });
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
  }, [savePos]);

  const handleFabClick = useCallback(() => {
    if (!dragState.current.hasMoved) {
      onOpenChange(!open);
    }
  }, [open, onOpenChange]);

  return (
    <div
      ref={containerRef}
      className={cn("fixed z-50", className)}
      style={{ bottom: pos.bottom, right: pos.right }}
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
        "flex flex-col gap-1 bg-background/95 backdrop-blur-sm border rounded-xl shadow-xl p-2 min-w-[160px] transition-all duration-200 origin-bottom-right",
        open ? "scale-100 opacity-100" : "sm:scale-100 sm:opacity-100 scale-0 opacity-0 pointer-events-none sm:pointer-events-auto"
      )}>
        {children}
      </div>
    </div>
  );
}
