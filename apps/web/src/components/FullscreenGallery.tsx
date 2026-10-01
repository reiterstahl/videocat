import { type MouseEvent as ReactMouseEvent, useEffect } from "react";
import { ChevronLeft, ChevronRight, X } from "lucide-react";
import { thumbnailSrc } from "../lib/api";
import type { Thumbnail } from "../types";

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
  useEffect(() => {
    function handleKey(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopImmediatePropagation();
        onClose();
      } else if (event.key === "ArrowLeft" && canOpenPrevious) {
        event.preventDefault();
        event.stopImmediatePropagation();
        onMove(-1);
      } else if (event.key === "ArrowRight" && canOpenNext) {
        event.preventDefault();
        event.stopImmediatePropagation();
        onMove(1);
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
    >
      <button className="icon-button gallery-close" onClick={onClose} type="button" title="Cerrar">
        <X size={22} />
      </button>
      <button
        className="gallery-nav gallery-nav-prev"
        onClick={() => onMove(-1)}
        disabled={!canOpenPrevious}
        type="button"
        title="Captura anterior"
      >
        <ChevronLeft size={30} />
      </button>
      <div className="gallery-stage" onMouseDown={closeFromSurface}>
        <img src={thumbnailSrc(thumbnail.url)} alt="" />
      </div>
      <button
        className="gallery-nav gallery-nav-next"
        onClick={() => onMove(1)}
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
