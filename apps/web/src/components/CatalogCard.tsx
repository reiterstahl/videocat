import { type PointerEvent as ReactPointerEvent, useState } from "react";
import { Image } from "lucide-react";
import { formatBytes, formatDuration, isDamagedMediaMessage, isRiskyMediaMessage } from "@videocat/shared";
import { CategoryBadges } from "./CategoryBadges";
import { thumbnailSrc } from "../lib/api";
import { folderPath, mainThumbnail, resolutionBadge } from "../lib/app-helpers";
import type { CurationCategory } from "../lib/app-types";
import type { VideoFile } from "../types";
import { transferBadgeLabels, transferStateLabels } from "../lib/transfers";

export function CatalogCard({
  file,
  categories,
  active,
  checked,
  availability,
  selectable = true,
  onOpen,
  onToggleSelect
}: {
  file: VideoFile;
  categories: CurationCategory[];
  active: boolean;
  checked: boolean;
  availability: "mounted" | "offline" | "unknown";
  selectable?: boolean;
  onOpen: () => void;
  onToggleSelect: () => void;
}) {
  const [frameIndex, setFrameIndex] = useState<number | null>(null);
  const thumbnails = file.thumbnails;
  const scrubbing = frameIndex != null && thumbnails.length > 1;
  const cover = scrubbing && thumbnails[frameIndex] ? thumbnailSrc(thumbnails[frameIndex].url) : mainThumbnail(file);
  // An incomplete or damaged file (interrupted recording or copy): its reason, first line of the message.
  const damaged = isDamagedMediaMessage(file.errorMessage) ? (file.errorMessage ?? "").split("\n")[0] : null;
  // Its reading stopped answering during a scan with the drive connected (bad sectors).
  const atRisk = isRiskyMediaMessage(file.errorMessage) ? file.errorMessage ?? "" : null;
  const badge = resolutionBadge(file);
  const folder = /[\\/]/.test(file.relativePath) ? folderPath(file.relativePath) : "";

  function scrubFrames(event: ReactPointerEvent<HTMLButtonElement>) {
    if (thumbnails.length < 2 || event.pointerType !== "mouse") return;
    const rect = event.currentTarget.getBoundingClientRect();
    const ratio = (event.clientX - rect.left) / Math.max(1, rect.width);
    setFrameIndex(Math.min(thumbnails.length - 1, Math.max(0, Math.floor(ratio * thumbnails.length))));
  }

  return (
    <article className={`vc-card ${active ? "is-active" : ""} ${checked ? "is-checked" : ""}`}>
      <button
        className="vc-card-open"
        type="button"
        onClick={onOpen}
        onPointerMove={scrubFrames}
        onPointerLeave={() => setFrameIndex(null)}
        onContextMenu={(event) => {
          // A long press on touch screens starts or extends the bulk selection.
          if (!selectable || !window.matchMedia("(hover: none)").matches) return;
          event.preventDefault();
          onToggleSelect();
        }}
        aria-label={`Abrir ${file.filename}`}
      >
        <span className="vc-card-thumb">
          {cover ? <img src={cover} alt="" loading="lazy" /> : <Image size={26} aria-hidden="true" />}
          {badge ? <span className="vc-card-badge is-top-right">{badge}</span> : null}
          {availability === "offline" || file.isProbableDuplicate || file.transfer || damaged || atRisk ? (
            <span className="vc-card-flags">
              {file.transfer ? (
                <span className="vc-card-badge is-transit" title={`${transferStateLabels[file.transfer.state]} · destino: ${file.transfer.targetFolder}`}>
                  {transferBadgeLabels[file.transfer.state] ?? "En tránsito"}
                </span>
              ) : null}
              {availability === "offline" ? <span className="vc-card-badge is-light">Desconectado</span> : null}
              {file.isProbableDuplicate ? <span className="vc-card-badge is-warning" title="Duplicado probable">Duplicado</span> : null}
              {damaged ? <span className="vc-card-badge is-danger" title={damaged}>Dañado</span> : null}
              {atRisk ? <span className="vc-card-badge is-danger" title={atRisk}>En riesgo</span> : null}
            </span>
          ) : null}
          {file.durationSeconds ? <span className="vc-card-badge is-bottom-right is-mono">{formatDuration(file.durationSeconds)}</span> : null}
          {scrubbing ? (
            <span className="vc-card-scrub" aria-hidden="true">
              <span style={{ width: `${(((frameIndex ?? 0) + 1) / thumbnails.length) * 100}%` }} />
            </span>
          ) : null}
        </span>
        <span className="vc-card-body">
          <span className="vc-card-title" title={file.filename}>{file.filename}</span>
          <span className="vc-card-meta">{[formatBytes(file.sizeBytes), file.disk?.name, folder].filter(Boolean).join(" · ")}</span>
        </span>
      </button>
      <CategoryBadges file={file} categories={categories} />
      {selectable ? (
        <label className="vc-card-check" title="Seleccionar">
          <input type="checkbox" checked={checked} onChange={onToggleSelect} aria-label={`Seleccionar ${file.filename}`} />
        </label>
      ) : null}
    </article>
  );
}
