import { type MouseEvent as ReactMouseEvent, type PointerEvent as ReactPointerEvent, useEffect, useRef, useState } from "react";
import { ChevronLeft, ChevronRight, X } from "lucide-react";
import { thumbnailSrc } from "../lib/api";
import type { Thumbnail } from "../types";

const swipeThreshold = 50;

type SwipeStart = { pointerId: number; x: number; y: number; horizontal: boolean | null };

export function FullscreenGallery({
  thumbnail,
  index,
  total,
  canOpenPrevious,
  canOpenNext,
  onMove,
  onClose
}: {
  thumbnail: Thumbnail;
  index: number;
  total: number;
  canOpenPrevious: boolean;
  canOpenNext: boolean;
  onMove: (offset: -1 | 1) => void;
  onClose: () => void;
}) {
  const swipeRef = useRef<SwipeStart | null>(null);
  const [dragOffset, setDragOffset] = useState(0);
  const [enterFrom, setEnterFrom] = useState<"left" | "right" | null>(null);

  function move(offset: -1 | 1) {
    setEnterFrom(offset === 1 ? "right" : "left");
    onMove(offset);
  }

  // Touch and pen swipes; the mouse keeps using the arrows and the keyboard.
  function startSwipe(event: ReactPointerEvent<HTMLDivElement>) {
    if (event.pointerType === "mouse" || !event.isPrimary) return;
    swipeRef.current = { pointerId: event.pointerId, x: event.clientX, y: event.clientY, horizontal: null };
  }

  function trackSwipe(event: ReactPointerEvent<HTMLDivElement>) {
    const swipe = swipeRef.current;
    if (!swipe || swipe.pointerId !== event.pointerId) return;
    const dx = event.clientX - swipe.x;
    const dy = event.clientY - swipe.y;
    if (swipe.horizontal === null && Math.hypot(dx, dy) > 10) swipe.horizontal = Math.abs(dx) > Math.abs(dy);
    if (!swipe.horizontal) return;
    const blocked = (dx > 0 && !canOpenPrevious) || (dx < 0 && !canOpenNext);
    setDragOffset(blocked ? dx * 0.25 : dx);
  }

  function endSwipe(event: ReactPointerEvent<HTMLDivElement>) {
    const swipe = swipeRef.current;
    if (!swipe || swipe.pointerId !== event.pointerId) return;
    swipeRef.current = null;
    const dx = event.clientX - swipe.x;
    setDragOffset(0);
    if (!swipe.horizontal || Math.abs(dx) < swipeThreshold) return;
    if (dx < 0 && canOpenNext) move(1);
    else if (dx > 0 && canOpenPrevious) move(-1);
  }

  function cancelSwipe() {
    swipeRef.current = null;
    setDragOffset(0);
  }

  useEffect(() => {
    function handleKey(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopImmediatePropagation();
        onClose();
      } else if (event.key === "ArrowLeft" && canOpenPrevious) {
        event.preventDefault();
        event.stopImmediatePropagation();
        move(-1);
      } else if (event.key === "ArrowRight" && canOpenNext) {
        event.preventDefault();
        event.stopImmediatePropagation();
        move(1);
      }
    }

    window.addEventListener("keydown", handleKey, true);
    return () => window.removeEventListener("keydown", handleKey, true);
  }, [canOpenNext, canOpenPrevious, onClose, onMove]);

  function closeFromSurface(event: ReactMouseEvent<HTMLElement>) {
    if (event.target !== event.currentTarget) return;
    event.preventDefault();
    event.stopPropagation();
    onClose();
  }

  return (
    <div
      className="gallery-backdrop"
      role="dialog"
      aria-modal="true"
      aria-label="Galería de capturas"
      onMouseDown={closeFromSurface}
      onPointerDown={startSwipe}
      onPointerMove={trackSwipe}
      onPointerUp={endSwipe}
      onPointerCancel={cancelSwipe}
    >
      <button className="icon-button gallery-close" onClick={onClose} type="button" title="Cerrar">
        <X size={22} />
      </button>
      <button
        className="gallery-nav gallery-nav-prev"
        onClick={() => move(-1)}
        disabled={!canOpenPrevious}
        type="button"
        title="Captura anterior"
      >
        <ChevronLeft size={30} />
      </button>
      <div className="gallery-stage" onMouseDown={closeFromSurface}>
        <img
          key={thumbnail.url}
          className={`${dragOffset ? "is-dragging" : ""} ${enterFrom ? `is-entering-from-${enterFrom}` : ""}`}
          src={thumbnailSrc(thumbnail.url)}
          alt=""
          draggable={false}
          style={dragOffset ? { transform: `translateX(${dragOffset}px)` } : undefined}
          onAnimationEnd={() => setEnterFrom(null)}
        />
      </div>
      <button
        className="gallery-nav gallery-nav-next"
        onClick={() => move(1)}
        disabled={!canOpenNext}
        type="button"
        title="Captura siguiente"
      >
        <ChevronRight size={30} />
      </button>
      <div className="gallery-count">
        {index + 1} / {total}
      </div>
    </div>
  );
}
