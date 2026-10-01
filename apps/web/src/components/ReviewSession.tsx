import { useEffect, useRef, useState } from "react";
import { Check, ChevronLeft, ChevronRight, Image, LayoutGrid, Maximize, Pause, Play, RectangleHorizontal, SkipForward, Trash2 } from "lucide-react";
import { formatBytes, formatDuration } from "@videocat/shared";
import { FullscreenGallery } from "./FullscreenGallery";
import { thumbnailSrc } from "../lib/api";
import {
  categoryStyle,
  folderPath,
  hasFileCategory,
  isEditableTarget,
  mainThumbnail,
  resolution,
  resolutionBadge
} from "../lib/app-helpers";
import type { CurationCategory, ReviewDecision, ReviewSessionEntry } from "../lib/app-types";
import type { VideoFile } from "../types";

export function defaultFrameIndex(file: VideoFile): number {
  const index = file.thumbnails.findIndex((thumb) => thumb.kind === "frame_08");
  if (index >= 0) return index;
  return Math.max(0, Math.floor(file.thumbnails.length / 2));
}

type ReviewLayout = "frame" | "gallery";

const reviewLayoutKey = "videocat-review-layout";

const galleryGap = 8;

// Picks the column count that makes every 16:9 frame as large as possible inside the available box.
function bestGalleryTileWidth(count: number, width: number, height: number): number {
  let best = 0;
  for (let columns = 1; columns <= count; columns += 1) {
    const rows = Math.ceil(count / columns);
    const byWidth = (width - galleryGap * (columns - 1)) / columns;
    const byHeight = ((height - galleryGap * (rows - 1)) / rows) * (16 / 9);
    best = Math.max(best, Math.min(byWidth, byHeight));
  }
  return Math.floor(best);
}

function storedReviewLayout(): ReviewLayout {
  try {
    return localStorage.getItem(reviewLayoutKey) === "gallery" ? "gallery" : "frame";
  } catch {
    return "frame";
  }
}

export function ReviewSession({
  file,
  upcoming,
  categories,
  loading,
  remaining,
  pendingTotal,
  markedToday,
  markedLast7Days,
  message,
  onClose,
  onDecision,
  onSkip,
  onUndo,
  onToggleCategory
}: {
  file: VideoFile;
  upcoming: VideoFile | null | undefined;
  categories: CurationCategory[];
  loading: boolean;
  remaining: number;
  pendingTotal: number;
  markedToday: number;
  markedLast7Days: number;
  message: string;
  onClose: () => void;
  onDecision: (status: ReviewDecision) => Promise<void>;
  onSkip: () => Promise<void>;
  onUndo: (entry: ReviewSessionEntry) => Promise<boolean>;
  onToggleCategory: (categoryKey: string, enabled: boolean) => void;
}) {
  const [frameIndex, setFrameIndex] = useState(() => defaultFrameIndex(file));
  const [framesPlaying, setFramesPlaying] = useState(false);
  const [layout, setLayout] = useState<ReviewLayout>(storedReviewLayout);
  const [galleryTileWidth, setGalleryTileWidth] = useState<number | null>(null);
  const galleryRef = useRef<HTMLDivElement | null>(null);
  const [galleryIndex, setGalleryIndex] = useState<number | null>(null);
  const [history, setHistory] = useState<ReviewSessionEntry[]>([]);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const tagCategories = categories.filter((category) => category.key !== "keep" && category.key !== "delete");
  const frames = file.thumbnails;
  const activeFrame = frames[frameIndex] ?? frames[0];
  const galleryThumb = galleryIndex == null ? null : frames[galleryIndex];
  const lastEntry = history[0] ?? null;
  const sessionFreedBytes = history.reduce((total, entry) => total + (entry.status === "delete" ? entry.previous.sizeBytes : 0), 0);
  const badge = resolutionBadge(file);
  const folder = /[\\/]/.test(file.relativePath) ? folderPath(file.relativePath) : "";

  useEffect(() => {
    setFrameIndex(defaultFrameIndex(file));
    setGalleryIndex(null);
  }, [file.id]);

  useEffect(() => {
    if (!framesPlaying || frames.length < 2) return;
    const interval = window.setInterval(() => {
      setFrameIndex((current) => (current + 1) % frames.length);
    }, 750);
    return () => window.clearInterval(interval);
  }, [frames.length, framesPlaying]);

  useEffect(() => {
    rootRef.current?.focus();
  }, []);

  useEffect(() => {
    const element = galleryRef.current;
    if (layout !== "gallery" || !element || frames.length === 0) return;
    const observer = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect;
      // On narrow screens the gallery flows with the page instead of filling a fixed box.
      setGalleryTileWidth(height > 160 && window.innerWidth > 980 ? bestGalleryTileWidth(frames.length, width, height) : null);
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, [frames.length, layout]);

  function changeLayout(next: ReviewLayout) {
    setLayout(next);
    setFramesPlaying(false);
    try {
      localStorage.setItem(reviewLayoutKey, next);
    } catch {
      // The layout still applies for this session when storage is unavailable.
    }
  }

  async function decide(status: ReviewDecision) {
    if (loading) return;
    const previous = file;
    try {
      await onDecision(status);
      setHistory((current) => [{ previous, status }, ...current].slice(0, 20));
    } catch {
      // The session shows the error message provided by the parent.
    }
  }

  async function undo() {
    if (loading || !lastEntry) return;
    if (await onUndo(lastEntry)) setHistory((current) => current.slice(1));
  }

  function moveFrame(offset: -1 | 1) {
    if (frames.length === 0) return;
    setFramesPlaying(false);
    setFrameIndex((current) => (current + offset + frames.length) % frames.length);
  }

  function toggleFullscreen() {
    if (document.fullscreenElement) {
      void document.exitFullscreen();
    } else {
      void rootRef.current?.requestFullscreen?.().catch(() => undefined);
    }
  }

  useEffect(() => {
    function handleKey(event: KeyboardEvent) {
      if (galleryIndex != null || isEditableTarget(event.target)) return;
      if (event.ctrlKey || event.metaKey || event.altKey) return;
      const key = event.key.toLowerCase();
      if (key === "escape") {
        if (document.fullscreenElement) return;
        onClose();
      } else if (key === "f") {
        // Home-row split: left hand keeps, right hand deletes.
        void decide("keep");
      } else if (key === "j") {
        void decide("delete");
      } else if (key === "s") {
        if (!loading) void onSkip();
      } else if (key === "z") {
        void undo();
      } else if (key === "g") {
        changeLayout(layout === "gallery" ? "frame" : "gallery");
      } else if (layout === "frame" && (key === "arrowleft" || key === "arrowright")) {
        event.preventDefault();
        moveFrame(key === "arrowleft" ? -1 : 1);
      } else if (key === " " && layout === "frame") {
        event.preventDefault();
        setFramesPlaying((playing) => !playing);
      } else if (key === "p") {
        toggleFullscreen();
      } else if (/^[1-9]$/.test(key)) {
        const category = tagCategories[Number(key) - 1];
        if (category && !loading) onToggleCategory(category.key, !hasFileCategory(file, category.key));
      } else {
        return;
      }
    }

    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  });

  return (
    <div className="vc-review" role="dialog" aria-modal="true" aria-label="Sesión de review" ref={rootRef} tabIndex={-1}>
      <header className="vc-review-header">
        <button className="vc-button" onClick={onClose} type="button" aria-label="Salir del review">
          <ChevronLeft size={17} />
          <span className="vc-button-label">Salir del review</span>
        </button>
        <span className="vc-catmark" aria-hidden="true" />
        <h2 className="vc-review-heading">Review</h2>
        <span className="vc-review-pill">{`${remaining.toLocaleString("es-CR")} pendientes`}</span>
        <div className="vc-segmented is-icons vc-review-layout" role="group" aria-label="Vista de fotogramas">
          <button type="button" aria-pressed={layout === "frame"} onClick={() => changeLayout("frame")} title="Fotograma (G)" aria-label="Fotograma">
            <RectangleHorizontal size={16} />
          </button>
          <button type="button" aria-pressed={layout === "gallery"} onClick={() => changeLayout("gallery")} title="Galería (G)" aria-label="Galería">
            <LayoutGrid size={16} />
          </button>
        </div>
        <div className="vc-header-spacer" />
        {lastEntry ? (
          <span className={`vc-review-last is-${lastEntry.status}`} role="status">
            <span className="vc-review-last-label">
              {lastEntry.status === "keep" ? "Mantenido" : "Marcado para borrar"}: {lastEntry.previous.filename}
            </span>
            <button className="vc-link-button" onClick={() => void undo()} disabled={loading} type="button">
              Deshacer <kbd>Z</kbd>
            </button>
          </span>
        ) : null}
        <span className="vc-review-session">
          <strong>{history.length}</strong> en esta sesión
        </span>
      </header>

      <div className="vc-review-body">
        <section className="vc-review-stage-column" aria-label="Video actual">
          {layout === "gallery" ? (
            <div
              className="vc-review-gallery"
              aria-label="Todos los fotogramas"
              ref={galleryRef}
              style={galleryTileWidth ? { gridTemplateColumns: `repeat(auto-fill, ${galleryTileWidth}px)` } : undefined}
            >
              {frames.length > 0 ? frames.map((thumb, index) => (
                <button
                  key={thumb.id}
                  className="vc-review-gallery-tile"
                  onClick={() => setGalleryIndex(index)}
                  type="button"
                  aria-label={`Ver fotograma ${index + 1} en grande`}
                >
                  <img src={thumbnailSrc(thumb.url)} alt="" decoding="async" loading="eager" />
                  {thumb.timestampSeconds != null ? <span className="vc-card-badge is-bottom-right is-mono">{formatDuration(thumb.timestampSeconds)}</span> : null}
                </button>
              )) : (
                <div className="vc-review-empty-frame"><Image size={40} aria-hidden="true" /><span>Sin miniaturas</span></div>
              )}
              {loading ? <span className="vc-review-loading" aria-hidden="true" /> : null}
            </div>
          ) : (
          <div className="vc-review-stage">
            {activeFrame ? (
              <button className="vc-review-frame" onClick={() => setGalleryIndex(frameIndex)} type="button" title="Ver fotograma en grande">
                <img src={thumbnailSrc(activeFrame.url)} alt="" decoding="async" />
              </button>
            ) : (
              <div className="vc-review-empty-frame"><Image size={40} aria-hidden="true" /><span>Sin miniaturas</span></div>
            )}
            <div className="vc-review-stage-badges">
              {badge ? <span className="vc-card-badge">{badge}</span> : null}
              <span className="vc-card-badge">{file.disk?.name ?? "-"}</span>
            </div>
            {frames.length > 1 ? (
              <div className="vc-review-stage-controls">
                <button className="vc-review-round" onClick={() => moveFrame(-1)} type="button" aria-label="Fotograma anterior"><ChevronLeft size={18} /></button>
                <button
                  className="vc-review-round is-primary"
                  onClick={() => setFramesPlaying((playing) => !playing)}
                  type="button"
                  aria-label={framesPlaying ? "Pausar fotogramas" : "Reproducir fotogramas"}
                  aria-pressed={framesPlaying}
                >
                  {framesPlaying ? <Pause size={18} /> : <Play size={18} />}
                </button>
                <button className="vc-review-round" onClick={() => moveFrame(1)} type="button" aria-label="Fotograma siguiente"><ChevronRight size={18} /></button>
                <span className="vc-review-frame-count">{`${frameIndex + 1} / ${frames.length}`}</span>
                <button className="vc-review-round" onClick={toggleFullscreen} type="button" aria-label="Pantalla completa" title="Pantalla completa (P)"><Maximize size={17} /></button>
              </div>
            ) : null}
            {loading ? <span className="vc-review-loading" aria-hidden="true" /> : null}
          </div>
          )}

          {layout === "frame" && frames.length > 1 ? (
            <div className="vc-review-filmstrip" aria-label="Fotogramas">
              {frames.map((thumb, index) => (
                <button
                  key={thumb.id}
                  className={index === frameIndex ? "is-active" : ""}
                  onClick={() => { setFramesPlaying(false); setFrameIndex(index); }}
                  onPointerEnter={(event) => { if (event.pointerType === "mouse") { setFramesPlaying(false); setFrameIndex(index); } }}
                  type="button"
                  aria-label={`Fotograma ${index + 1}`}
                  aria-current={index === frameIndex ? "true" : undefined}
                >
                  <img src={thumbnailSrc(thumb.url)} alt="" decoding="async" loading="eager" />
                </button>
              ))}
            </div>
          ) : null}

          <div className="vc-review-decisions">
            <button className="vc-review-decision is-keep" onClick={() => void decide("keep")} disabled={loading} type="button">
              <Check size={20} />
              <span>Mantener</span>
              <kbd>F</kbd>
            </button>
            <button className="vc-review-decision is-skip" onClick={() => void onSkip()} disabled={loading} type="button">
              <SkipForward size={20} />
              <span>Saltar</span>
              <kbd>S</kbd>
            </button>
            <button className="vc-review-decision is-delete" onClick={() => void decide("delete")} disabled={loading} type="button">
              <Trash2 size={20} />
              <span>Marcar para borrar</span>
              <kbd>J</kbd>
            </button>
          </div>

          {tagCategories.length > 0 ? (
            <div className="vc-review-tags" aria-label="Etiquetas">
              <span className="vc-overline">Etiquetar</span>
              {tagCategories.map((category, index) => {
                const active = hasFileCategory(file, category.key);
                return (
                  <button
                    key={category.key}
                    className={`vc-review-tag ${active ? "is-active" : ""}`}
                    style={categoryStyle(category.key, categories)}
                    onClick={() => onToggleCategory(category.key, !active)}
                    disabled={loading}
                    aria-pressed={active}
                    type="button"
                  >
                    {index < 9 ? <kbd>{index + 1}</kbd> : null}
                    <span className="vc-review-tag-dot" aria-hidden="true" />
                    {category.label}
                  </button>
                );
              })}
            </div>
          ) : null}
          {message ? <div className="vc-review-message" role="status">{message}</div> : null}
        </section>

        <aside className="vc-review-side" aria-label="Información">
          <div className="vc-review-file">
            <h3>{file.filename}</h3>
            <span>{file.disk?.name ?? "-"}{folder ? ` › ${folder}` : ""}</span>
            <div className="vc-review-chips">
              <span>{resolution(file)}</span>
              <span>{formatBytes(file.sizeBytes)}</span>
              <span>{formatDuration(file.durationSeconds)}</span>
              {file.videoCodec ? <span>{[file.videoCodec, file.audioCodec].filter(Boolean).join(" · ")}</span> : null}
              {file.folderSizeBytes != null ? <span>{`Carpeta ${formatBytes(file.folderSizeBytes)}`}</span> : null}
            </div>
          </div>

          <div className="vc-review-stats">
            <div><span>Pendientes</span><strong>{pendingTotal.toLocaleString("es-CR")}</strong></div>
            <div><span>Hoy</span><strong>{markedToday.toLocaleString("es-CR")}</strong></div>
            <div><span>Últimos 7 días</span><strong>{markedLast7Days.toLocaleString("es-CR")}</strong></div>
            <div className="is-accent"><span>Marcado en la sesión</span><strong>{formatBytes(sessionFreedBytes)}</strong></div>
          </div>

          <div className="vc-review-block">
            <span className="vc-overline">Siguiente · precargado</span>
            {upcoming ? (
              <div className="vc-review-upcoming">
                <span className="vc-review-upcoming-thumb">
                  {mainThumbnail(upcoming) ? <img src={mainThumbnail(upcoming)} alt="" /> : <Image size={18} aria-hidden="true" />}
                </span>
                <span className="vc-review-upcoming-text">
                  <strong>{upcoming.filename}</strong>
                  <span>{[formatBytes(upcoming.sizeBytes), formatDuration(upcoming.durationSeconds)].join(" · ")}</span>
                </span>
              </div>
            ) : (
              <span className="vc-review-muted">
                {upcoming === null ? "Este es el último pendiente en los discos seleccionados." : "Preparando el siguiente video…"}
              </span>
            )}
          </div>

          <div className="vc-review-block">
            <span className="vc-overline">Decisiones de la sesión</span>
            {history.length === 0 ? (
              <span className="vc-review-muted">Todavía no tomaste decisiones.</span>
            ) : (
              <ul className="vc-review-history">
                {history.slice(0, 6).map((entry) => (
                  <li key={`${entry.previous.id}-${entry.status}`}>
                    <span className="vc-review-upcoming-thumb is-small">
                      {mainThumbnail(entry.previous) ? <img src={mainThumbnail(entry.previous)} alt="" /> : null}
                    </span>
                    <span className="vc-review-history-name">{entry.previous.filename}</span>
                    <em className={`vc-review-history-badge is-${entry.status}`}>{entry.status === "keep" ? "Mantener" : "Borrar"}</em>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <p className="vc-review-keys">
            <kbd>F</kbd> mantener · <kbd>J</kbd> borrar · <kbd>S</kbd> saltar · <kbd>Z</kbd> deshacer · <kbd>←</kbd><kbd>→</kbd> fotogramas · <kbd>Espacio</kbd> reproducir · <kbd>P</kbd> pantalla completa · <kbd>G</kbd> galería · <kbd>Esc</kbd> salir
          </p>
        </aside>
      </div>

      {galleryThumb ? (
        <FullscreenGallery
          thumbnail={galleryThumb}
          index={galleryIndex ?? 0}
          total={frames.length}
          canOpenPrevious={galleryIndex != null && galleryIndex > 0}
          canOpenNext={galleryIndex != null && galleryIndex < frames.length - 1}
          onMove={(offset) => setGalleryIndex((current) => (current == null ? current : Math.min(frames.length - 1, Math.max(0, current + offset))))}
          onClose={() => setGalleryIndex(null)}
        />
      ) : null}
    </div>
  );
}
