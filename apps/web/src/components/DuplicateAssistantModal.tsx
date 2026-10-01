import { useEffect, useMemo, useRef, useState } from "react";
import { Check, ChevronLeft, Image, Trash2 } from "lucide-react";
import { formatBytes, formatDuration } from "@videocat/shared";
import { type Language, translateText } from "../i18n";
import { thumbnailSrc } from "../lib/api";
import { isEditableTarget, mainThumbnail, resolution } from "../lib/app-helpers";
import type { DuplicateAssistantSession } from "../lib/app-types";
import { type DuplicateRecommendationReason, isBetterDuplicateMetric, recommendDuplicateKeep } from "../lib/duplicate-assistant";
import type { VideoFile } from "../types";

export function duplicateRecommendationLabel(reason: DuplicateRecommendationReason): string {
  if (reason === "resolution") return "Mayor resolución";
  if (reason === "size") return "Mayor tamaño de archivo";
  if (reason === "duration") return "Mayor duración";
  return "Mejor opción por consistencia";
}

export function DuplicateAssistantModal({
  session,
  language,
  prefetchedFiles,
  resolvePreviewFile,
  busy,
  feedbackFileId,
  message,
  onClose,
  onDecision,
  onSkip
}: {
  session: DuplicateAssistantSession;
  language: Language;
  prefetchedFiles: Record<string, VideoFile>;
  resolvePreviewFile: (file: VideoFile) => Promise<VideoFile>;
  busy: boolean;
  feedbackFileId: string | null;
  message: string;
  onClose: () => void;
  onDecision: (fileId: string) => void;
  onSkip: () => void;
}) {
  const group = session.groups[session.groupIndex];
  const recommendation = recommendDuplicateKeep(session.keeper, session.challenger);
  const files = useMemo(
    () => recommendation.fileId === session.keeper.id
      ? [session.keeper, session.challenger]
      : [session.challenger, session.keeper],
    [recommendation.fileId, session.challenger, session.keeper]
  );
  const currentComparison = Math.min(session.totalComparisons, session.completedComparisons + 1);
  const [hoveredFileId, setHoveredFileId] = useState<string | null>(null);
  const [hoveredFrameIndex, setHoveredFrameIndex] = useState(0);
  const [previewFiles, setPreviewFiles] = useState<Record<string, VideoFile>>(prefetchedFiles);
  const rootRef = useRef<HTMLDivElement | null>(null);

  // Move focus into the overlay so keys never reach buttons left focused on the page behind it.
  useEffect(() => {
    rootRef.current?.focus();
  }, []);
  const comparisonFiles = useMemo(
    () => files.map((file) => previewFiles[file.id] ?? file),
    [files, previewFiles]
  );
  const comparisonFileKey = files.map((file) => file.id).join(":");

  useEffect(() => {
    setPreviewFiles((current) => ({ ...current, ...prefetchedFiles }));
  }, [prefetchedFiles]);

  useEffect(() => {
    let cancelled = false;
    const missing = files.filter((file) => !previewFiles[file.id]);
    if (missing.length === 0) return;
    void Promise.all(missing.map(resolvePreviewFile)).then((loaded) => {
      if (cancelled) return;
      setPreviewFiles((current) => {
        const next = { ...current };
        for (const file of loaded) next[file.id] = file;
        return next;
      });
    });
    return () => {
      cancelled = true;
    };
  }, [comparisonFileKey, previewFiles, resolvePreviewFile]);

  useEffect(() => {
    const images = comparisonFiles.flatMap((file) => file.thumbnails).map((thumbnail) => thumbnailSrc(thumbnail.url) ?? thumbnail.url);
    for (const source of images) {
      const image = new window.Image();
      image.src = source;
    }
  }, [comparisonFiles]);

  useEffect(() => {
    setHoveredFrameIndex(0);
    if (!hoveredFileId) return;
    const hoveredFile = comparisonFiles.find((file) => file.id === hoveredFileId);
    const frames = hoveredFile?.thumbnails ?? [];
    if (frames.length < 2) return;
    const timer = window.setInterval(() => {
      setHoveredFrameIndex((current) => (current + 1) % frames.length);
    }, 700);
    return () => window.clearInterval(timer);
  }, [comparisonFiles, hoveredFileId]);

  useEffect(() => {
    function handleKey(event: KeyboardEvent) {
      if (busy || isEditableTarget(event.target)) return;
      if (event.ctrlKey || event.metaKey || event.altKey) return;
      const key = event.key.toLowerCase();
      // Enter on a focused button already activates that button.
      if (key === "enter" && event.target instanceof HTMLElement && event.target.closest("button, a")) return;
      if (key === "escape") onClose();
      else if (key === "1" || key === "arrowleft") onDecision(files[0].id);
      else if (key === "2" || key === "arrowright") onDecision(files[1].id);
      else if (key === "enter") onDecision(recommendation.fileId);
      else if (key === "s") onSkip();
      else return;
      event.preventDefault();
    }
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [busy, files, onClose, onDecision, onSkip, recommendation.fileId]);

  return (
    <div className="vc-review vc-dup-assistant" role="dialog" aria-modal="true" aria-labelledby="duplicate-assistant-title" ref={rootRef} tabIndex={-1}>
      <header className="vc-review-header">
        <button className="vc-button" disabled={busy} onClick={onClose} type="button" aria-label="Salir del modo asistido">
          <ChevronLeft size={17} />
          <span className="vc-button-label">Volver</span>
        </button>
        <span className="vc-catmark" aria-hidden="true" />
        <h2 className="vc-review-heading" id="duplicate-assistant-title">Duplicados · modo asistido</h2>
        <span className="vc-review-pill">
          {language === "en"
            ? `Group ${session.groupIndex + 1} of ${session.groups.length} · Comparison ${currentComparison} of ${session.totalComparisons}`
            : `Grupo ${session.groupIndex + 1} de ${session.groups.length} · Comparación ${currentComparison} de ${session.totalComparisons}`}
        </span>
        <div className="vc-header-spacer" />
        <span className={`vc-dup-confidence is-${group.matchType}`}>
          <span className="vc-meter" aria-hidden="true"><span style={{ width: `${group.confidence}%` }} /></span>
          <strong>{`${group.confidence}%`}</strong>
        </span>
      </header>
      <div
        className="vc-dup-progress"
        aria-label={language === "en"
          ? `Progress ${currentComparison} of ${session.totalComparisons}`
          : `Progreso ${currentComparison} de ${session.totalComparisons}`}
      >
        <span style={{ width: `${(currentComparison / Math.max(1, session.totalComparisons)) * 100}%` }} />
      </div>

      <div className="vc-dup-assistant-body">
        <div className="vc-dup-reasons">
          {group.reasons.map((reason) => (
            <span className="vc-dup-reason" key={reason}>{translateText(reason, language)}</span>
          ))}
          <span className="vc-dup-recoverable">{`${formatBytes(group.recoverableBytes)} recuperables en el grupo`}</span>
        </div>
        {message ? <div className="form-error">{message}</div> : null}

        <div className="vc-dup-compare">
          {comparisonFiles.map((file, index) => {
            const other = comparisonFiles[index === 0 ? 1 : 0];
            const recommended = recommendation.fileId === file.id;
            const selected = feedbackFileId === file.id;
            const rejected = feedbackFileId != null && !selected;
            const frames = file.thumbnails;
            const hovered = hoveredFileId === file.id;
            const frame = hovered && frames.length > 0
              ? frames[hoveredFrameIndex % frames.length]
              : undefined;
            const thumbnail = frame ? thumbnailSrc(frame.url) ?? frame.url : mainThumbnail(file);
            const letter = index === 0 ? "A" : "B";
            return (
              <article
                className={[
                  "vc-dup-choice",
                  recommended ? "is-recommended" : "",
                  selected ? "is-selected" : "",
                  rejected ? "is-rejected" : ""
                ].filter(Boolean).join(" ")}
                key={file.id}
              >
                <div className="vc-dup-choice-head">
                  <span className="vc-dup-letter">{letter}</span>
                  {recommended ? <span className="vc-dup-recommended">Recomendado · {duplicateRecommendationLabel(recommendation.reason)}</span> : null}
                </div>
                <div
                  className="vc-dup-media"
                  onPointerEnter={(event) => {
                    if (event.pointerType === "touch") return;
                    setHoveredFileId(file.id);
                    setHoveredFrameIndex(0);
                  }}
                  onPointerLeave={() => setHoveredFileId(null)}
                >
                  {thumbnail ? (
                    <img
                      key={`${file.id}-${frame?.kind ?? "main"}-${hoveredFrameIndex}`}
                      src={thumbnail}
                      alt=""
                      decoding="async"
                      fetchPriority="high"
                    />
                  ) : (
                    <div className="vc-review-empty-frame"><Image size={36} /><span>Sin miniatura</span></div>
                  )}
                  {hovered && frames.length > 1 ? (
                    <span className="vc-card-badge is-bottom-right is-mono">{`${hoveredFrameIndex % frames.length + 1}/${frames.length}`}</span>
                  ) : frames.length > 1 ? (
                    <span className="vc-card-badge is-bottom-right vc-hover-hint">Pasá el cursor para ver los fotogramas</span>
                  ) : null}
                  {selected ? <span className="vc-dup-feedback is-keep"><Check size={18} /> Mantener</span> : null}
                  {rejected ? <span className="vc-dup-feedback is-delete"><Trash2 size={18} /> Borrar</span> : null}
                </div>

                <div className="vc-dup-choice-copy">
                  <strong title={file.filename}>{file.filename}</strong>
                  <span title={file.relativePath}>{`${file.disk?.name ?? "-"} · ${file.relativePath}`}</span>
                </div>

                <dl className="vc-dup-metrics">
                  <div className={isBetterDuplicateMetric(file, other, "resolution") ? "is-better" : ""}>
                    <dt>Resolución</dt>
                    <dd>{resolution(file)}</dd>
                  </div>
                  <div className={isBetterDuplicateMetric(file, other, "size") ? "is-better" : ""}>
                    <dt>Tamaño</dt>
                    <dd>{formatBytes(file.sizeBytes)}</dd>
                  </div>
                  <div className={isBetterDuplicateMetric(file, other, "duration") ? "is-better" : ""}>
                    <dt>Duración</dt>
                    <dd>{formatDuration(file.durationSeconds)}</dd>
                  </div>
                  <div>
                    <dt>Códec</dt>
                    <dd>{[file.videoCodec, file.audioCodec].filter(Boolean).join(" · ") || "-"}</dd>
                  </div>
                </dl>

                <button
                  className={`vc-dup-keep ${recommended ? "is-primary" : ""}`}
                  disabled={busy}
                  onClick={() => onDecision(file.id)}
                  type="button"
                  aria-label={`${language === "en" ? "Keep" : "Mantener"} ${file.filename}`}
                >
                  <Check size={18} />
                  {`Mantener ${letter} · borrar ${index === 0 ? "B" : "A"}`}
                  <kbd>{index === 0 ? "1" : "2"}</kbd>
                </button>
              </article>
            );
          })}
        </div>
      </div>

      <footer className="vc-dup-footer">
        <span>La copia elegida se marca para mantener y la otra para borrar. El borrado físico ocurre cuando el Companion procesa ese disco.</span>
        <span className="vc-header-spacer" />
        <span className="vc-review-keys"><kbd>Enter</kbd> recomendado · <kbd>Esc</kbd> salir</span>
        <button className="vc-button" disabled={busy} onClick={onSkip} type="button">
          Omitir este grupo
          <kbd>S</kbd>
        </button>
      </footer>
    </div>
  );
}
