import { HardDrive, History, Play } from "lucide-react";
import { formatBytes } from "@videocat/shared";
import { CatalogCard } from "../components/CatalogCard";
import type { FacetResponse } from "../lib/app-types";
import type { VideoFile } from "../types";

export type ReviewHomeViewProps = {
  companionMountedDiskIds: string[];
  companionOnline: boolean;
  facets: FacetResponse;
  loadNextReviewVideo: () => Promise<void>;
  locale: string;
  openDeletionHistory: () => Promise<void>;
  openDetail: (file: Pick<VideoFile, "id">) => Promise<void>;
  openRecoverableSpace: () => Promise<void>;
  reviewCurrent: VideoFile | null;
  reviewFreedBytes: number;
  reviewLoading: boolean;
  reviewMarkedLast7Days: number;
  reviewMarkedToday: number;
  reviewMessage: string;
  reviewPending: VideoFile[];
  reviewPendingTotal: number;
  reviewRecent: VideoFile[];
};

export function ReviewHomeView({ companionMountedDiskIds, companionOnline, facets, loadNextReviewVideo, locale, openDeletionHistory, openDetail, openRecoverableSpace, reviewCurrent, reviewFreedBytes, reviewLoading, reviewMarkedLast7Days, reviewMarkedToday, reviewMessage, reviewPending, reviewPendingTotal, reviewRecent }: ReviewHomeViewProps) {
  return (
    <section className="vc-review-home">
      <div className="vc-review-hero">
        <div className="vc-review-hero-text">
          <span className="vc-overline">Review aleatorio</span>
          <h2>{`${reviewPendingTotal.toLocaleString(locale)} ${reviewPendingTotal === 1 ? "video pendiente" : "videos pendientes"}`}</h2>
          <p>Decidí qué conservar y qué borrar, un video a la vez, en los discos seleccionados.</p>
          <p className="vc-review-hero-keys"><kbd>K</kbd> mantener · <kbd>D</kbd> borrar · <kbd>S</kbd> saltar · <kbd>Z</kbd> deshacer</p>
        </div>
        <div className="vc-review-hero-actions">
          <button className="vc-button is-primary is-large" onClick={() => void loadNextReviewVideo()} disabled={reviewLoading} type="button">
            <Play size={18} />
            {reviewLoading ? "Cargando..." : "Iniciar Review"}
          </button>
          <button className="vc-button" onClick={() => void openDeletionHistory()} type="button">
            <History size={17} />
            Últimos borrados
          </button>
          <button className="vc-button" onClick={() => void openRecoverableSpace()} type="button">
            <HardDrive size={17} />
            Espacio a recuperar
          </button>
        </div>
      </div>
      {reviewMessage && !reviewCurrent ? <div className="vc-review-message" role="status">{reviewMessage}</div> : null}
      <section className="vc-kpis" aria-label="Progreso del review">
        <div className="vc-kpi">
          <span>Pendientes</span>
          <strong>{reviewPendingTotal.toLocaleString(locale)}</strong>
        </div>
        <div className="vc-kpi">
          <span>Marcados hoy</span>
          <strong>{reviewMarkedToday.toLocaleString(locale)}</strong>
        </div>
        <div className="vc-kpi">
          <span>Últimos 7 días</span>
          <strong>{reviewMarkedLast7Days.toLocaleString(locale)}</strong>
        </div>
        <div className="vc-kpi is-accent">
          <span>Espacio liberado</span>
          <strong>{formatBytes(reviewFreedBytes)}</strong>
        </div>
      </section>

      <div className="vc-section-heading">
        <h3>Pendientes de review</h3>
        <span>{`${reviewPending.length} de ${reviewPendingTotal.toLocaleString(locale)}`}</span>
      </div>
      {reviewPending.length === 0 ? (
        <div className="empty">No quedan videos pendientes por revisar.</div>
      ) : (
        <div className="vc-grid">
          {reviewPending.map((file) => (
            <CatalogCard
              key={file.id}
              file={file}
              categories={facets.curationStatuses}
              active={false}
              checked={false}
              selectable={false}
              availability={!companionOnline ? "unknown" : companionMountedDiskIds.includes(file.diskId) ? "mounted" : "offline"}
              onOpen={() => void openDetail(file)}
              onToggleSelect={() => undefined}
            />
          ))}
        </div>
      )}

      <div className="vc-section-heading">
        <h3>Últimos revisados</h3>
        <span>{`${reviewRecent.length} recientes`}</span>
      </div>
      {reviewRecent.length === 0 ? (
        <div className="empty">Aun no hay videos sometidos al review.</div>
      ) : (
        <div className="vc-grid">
          {reviewRecent.map((file) => (
            <CatalogCard
              key={file.id}
              file={file}
              categories={facets.curationStatuses}
              active={false}
              checked={false}
              selectable={false}
              availability={!companionOnline ? "unknown" : companionMountedDiskIds.includes(file.diskId) ? "mounted" : "offline"}
              onOpen={() => void openDetail(file)}
              onToggleSelect={() => undefined}
            />
          ))}
        </div>
      )}
    </section>
  );
}
