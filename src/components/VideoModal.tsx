import { useState, useRef, useCallback, useEffect } from "react";
import { X } from "lucide-react";

interface VideoModalProps {
  open: boolean;
  onClose: () => void;
  redirectUrl: string;
}

export default function VideoModal({ open, onClose, redirectUrl }: VideoModalProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [showFallback, setShowFallback] = useState(false);

  const navigateToRedirect = useCallback(
    (isUserInitiated: boolean) => {
      try {
        if (window.self !== window.top) {
          if (isUserInitiated) {
            window.open(redirectUrl, "_top");
          } else {
            window.top?.location.assign(redirectUrl);
          }
        } else {
          window.location.assign(redirectUrl);
        }

        // If navigation is blocked by browser/iframe policies, show fallback CTA.
        window.setTimeout(() => {
          setShowFallback(true);
        }, 700);
      } catch {
        setShowFallback(true);
      }
    },
    [redirectUrl]
  );

  const handleEnd = useCallback(() => {
    navigateToRedirect(false);
  }, [navigateToRedirect]);

  const handleSkip = useCallback(() => {
    navigateToRedirect(true);
  }, [navigateToRedirect]);

  useEffect(() => {
    if (open && videoRef.current) {
      setShowFallback(false);
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
      className="fixed inset-0 z-[9999] flex flex-col items-center justify-center bg-black/85 animate-fade-in"
      role="dialog"
      aria-label="AEG International Trip Support promotional video"
    >
      <button
        onClick={handleSkip}
        className="absolute top-4 right-4 z-10 flex items-center gap-1.5 rounded-full bg-white/10 px-4 py-2 text-sm font-medium text-white/80 backdrop-blur-sm hover:bg-white/20 hover:text-white transition-colors"
        aria-label="Skip video"
      >
        Skip <X className="h-4 w-4" />
      </button>

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

      {showFallback && (
        <div className="mt-4 flex flex-wrap items-center justify-center gap-3 rounded-lg border border-white/20 bg-black/60 px-4 py-3 text-sm text-white">
          <span>Continue to AEG Flight Support</span>
          <button
            onClick={handleSkip}
            className="rounded-md bg-white/15 px-3 py-1.5 font-medium hover:bg-white/25"
            aria-label="Continue to AEG Flight Support"
          >
            Continue
          </button>
          <button
            onClick={onClose}
            className="rounded-md border border-white/30 px-3 py-1.5 font-medium hover:bg-white/10"
            aria-label="Close video"
          >
            Close
          </button>
        </div>
      )}
    </div>
  );
}
