import { useState, useRef, useCallback, useEffect } from "react";
import { X } from "lucide-react";

interface VideoModalProps {
  open: boolean;
  onClose: () => void;
  redirectUrl: string;
}

export default function VideoModal({ open, onClose, redirectUrl }: VideoModalProps) {
  const videoRef = useRef<HTMLVideoElement>(null);

  const navigateToRedirect = useCallback(() => {
    onClose();

    // In embedded preview, navigate the top-level context to avoid iframe blocking.
    if (window.self !== window.top) {
      window.open(redirectUrl, "_top");
      return;
    }

    window.location.assign(redirectUrl);
  }, [redirectUrl, onClose]);

  const handleEnd = useCallback(() => {
    navigateToRedirect();
  }, [navigateToRedirect]);

  const handleSkip = useCallback(() => {
    navigateToRedirect();
  }, [navigateToRedirect]);

  useEffect(() => {
    if (open && videoRef.current) {
      videoRef.current.currentTime = 0;
      videoRef.current.play().catch(() => {});
    }
  }, [open]);

  // Keyboard: Escape to skip
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") handleSkip();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [open, handleSkip]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/85 animate-fade-in"
      role="dialog"
      aria-label="AEG International Trip Support promotional video"
    >
      {/* Skip button */}
      <button
        onClick={handleSkip}
        className="absolute top-4 right-4 z-10 flex items-center gap-1.5 rounded-full bg-white/10 px-4 py-2 text-sm font-medium text-white/80 backdrop-blur-sm hover:bg-white/20 hover:text-white transition-colors"
        aria-label="Skip video"
      >
        Skip <X className="h-4 w-4" />
      </button>

      {/* Video container */}
      <div className="w-full max-w-5xl mx-4 rounded-xl overflow-hidden shadow-2xl animate-scale-in">
        <video
          ref={videoRef}
          src="/aeg-marketing.mp4"
          className="w-full h-auto"
          autoPlay
          muted
          playsInline
          onEnded={handleEnd}
        />
      </div>
    </div>
  );
}
