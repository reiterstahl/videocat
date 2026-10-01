import { Check, Image, Sparkles } from "lucide-react";
import { formatBytes, formatDuration } from "@videocat/shared";
import { CategoryBadges } from "../components/CategoryBadges";
import { type Language, translateText } from "../i18n";
import { mainThumbnail, resolution, resolutionBadge } from "../lib/app-helpers";
import type {
  AssistedDuplicateGroup,
  DuplicateDriveRecommendationsResponse,
  DuplicateGroup,
  FacetResponse
} from "../lib/app-types";
import type { VideoFile } from "../types";

export type DuplicatesViewProps = {
  auxLoading: boolean;
  duplicateAssistantMessage: string;
  duplicateDriveRecommendations: DuplicateDriveRecommendationsResponse | null;
  duplicateGroups: DuplicateGroup[];
  duplicateRecoverableBytes: number;
  facets: FacetResponse;
  language: Language;
  loading: boolean;
  locale: string;
  openDetail: (file: Pick<VideoFile, "id">) => Promise<void>;
  openDuplicateAssistant: (startGroupKey?: string) => void;
  openDuplicateDriveRecommendations: (force?: boolean) => Promise<void>;
  pendingAssistedDuplicateGroups: AssistedDuplicateGroup[];
  total: number;
};

export function DuplicatesView({ auxLoading, duplicateAssistantMessage, duplicateDriveRecommendations, duplicateGroups, duplicateRecoverableBytes, facets, language, loading, locale, openDetail, openDuplicateAssistant, openDuplicateDriveRecommendations, pendingAssistedDuplicateGroups, total }: DuplicatesViewProps) {
  return (
    <section className="vc-dup-home">
      <div className="vc-review-hero">
        <div className="vc-review-hero-text">
          <span className="vc-overline">Duplicados probables</span>
          <h2>{`${duplicateGroups.length.toLocaleString(locale)} ${duplicateGroups.length === 1 ? "grupo" : "grupos"} · ${formatBytes(duplicateRecoverableBytes)} recuperables`}</h2>
          <p>Coincidencias por huella visual, duración y tamaño dentro de los discos seleccionados.</p>
        </div>
        <div className="vc-review-hero-actions">
          <button
            className="vc-button is-primary is-large"
            disabled={auxLoading || pendingAssistedDuplicateGroups.length === 0}
            onClick={() => openDuplicateAssistant()}
            type="button"
          >
            <Sparkles size={18} />
            Iniciar modo asistido
            <span className="vc-count-badge is-inverse">{pendingAssistedDuplicateGroups.length}</span>
          </button>
        </div>
      </div>
      {duplicateAssistantMessage ? <div className="vc-review-message" role="status">{duplicateAssistantMessage}</div> : null}

      <div className="vc-dup-layout">
        <div className="vc-dup-groups">
          {auxLoading ? <div className="loading">Cargando...</div> : null}
          {!auxLoading && duplicateGroups.length === 0 ? (
            <div className="empty">No hay duplicados probables para estos discos.</div>
          ) : null}
          {duplicateGroups.map((group) => {
            const pendingGroup = pendingAssistedDuplicateGroups.find((item) => item.key === group.key);
            const recommendedId = pendingGroup?.contenders[0]?.id;
            return (
              <article className="vc-dup-group" key={group.key}>
                <header className="vc-dup-group-header">
                  <span
                    className={`vc-dup-confidence is-${group.matchType}`}
                    title={group.matchType === "visual" ? "Coincidencia visual" : group.matchType === "mixed" ? "Coincidencia mixta" : "Mismo tamaño"}
                  >
                    <span className="vc-meter" aria-hidden="true"><span style={{ width: `${group.confidence}%` }} /></span>
                    <strong>{`${group.confidence}% de confianza`}</strong>
                  </span>
                  {group.reasons.map((reason) => (
                    <span className="vc-dup-reason" key={reason}>{translateText(reason, language)}</span>
                  ))}
                  <span className="vc-toolbar-spacer" />
                  <span className="vc-dup-recoverable">{`${formatBytes(group.recoverableBytes)} recuperables`}</span>
                  {pendingGroup ? (
                    <button className="vc-button is-small" onClick={() => openDuplicateAssistant(group.key)} type="button">
                      <Sparkles size={15} />
                      Resolver
                    </button>
                  ) : (
                    <span className="vc-dup-resolved"><Check size={14} /> Resuelto</span>
                  )}
                </header>
                <div className="vc-dup-files">
                  {group.files.map((file) => {
                    const badge = resolutionBadge(file);
                    return (
                      <button
                        className={`vc-dup-file ${file.id === recommendedId ? "is-recommended" : ""}`}
                        key={file.id}
                        onClick={() => void openDetail(file)}
                        type="button"
                      >
                        <span className="vc-card-thumb">
                          {mainThumbnail(file) ? <img src={mainThumbnail(file)} alt="" loading="lazy" /> : <Image size={22} aria-hidden="true" />}
                          {badge ? <span className="vc-card-badge is-top-right">{badge}</span> : null}
                          {file.durationSeconds ? <span className="vc-card-badge is-bottom-right is-mono">{formatDuration(file.durationSeconds)}</span> : null}
                          {file.id === recommendedId ? <span className="vc-dup-best">Recomendado</span> : null}
                        </span>
                        <span className="vc-dup-file-body">
                          <strong title={file.filename}>{file.filename}</strong>
                          <span title={file.relativePath}>{`${file.disk?.name ?? "-"} · ${file.relativePath}`}</span>
                          <span className="vc-dup-file-metrics">{`${formatBytes(file.sizeBytes)} · ${resolution(file)}`}</span>
                        </span>
                        <CategoryBadges file={file} categories={facets.curationStatuses} />
                      </button>
                    );
                  })}
                </div>
              </article>
            );
          })}
        </div>

        <aside className="vc-dup-side" aria-label="Discos prioritarios">
          <span className="vc-overline">Conecta primero</span>
          {duplicateDriveRecommendations ? (
            <>
              <div className="vc-dup-side-total">
                <strong>{formatBytes(duplicateDriveRecommendations.totalRecoverableBytes)}</strong>
                <span className="vc-dup-legend">
                  <span><i className="is-ready" />{`Marcado ${formatBytes(duplicateDriveRecommendations.totalReadyBytes)}`}</span>
                  <span><i className="is-pending" />{`Por decidir ${formatBytes(duplicateDriveRecommendations.totalPendingBytes)}`}</span>
                </span>
              </div>
              <ol className="vc-dup-drives">
                {duplicateDriveRecommendations.disks.slice(0, 6).map((disk) => {
                  const total = Math.max(1, disk.readyBytes + disk.pendingBytes);
                  return (
                    <li key={disk.diskId}>
                      <div className="vc-dup-drive-head">
                        <strong>{disk.diskName}</strong>
                        <span>{formatBytes(disk.recoverableBytes)}</span>
                      </div>
                      <span className="vc-dup-drive-bar" aria-hidden="true">
                        <span className="is-ready" style={{ width: `${(disk.readyBytes / total) * 100}%` }} />
                        <span className="is-pending" style={{ width: `${(disk.pendingBytes / total) * 100}%` }} />
                      </span>
                      <span className="vc-dup-drive-status">
                        <span className={`vc-disk-dot ${disk.connected ? "is-mounted" : ""}`} />
                        {disk.connected ? "Conectado" : "Desconectado"}
                      </span>
                    </li>
                  );
                })}
              </ol>
            </>
          ) : (
            <span className="vc-review-muted">Calculando discos prioritarios...</span>
          )}
          <button className="vc-link-button" onClick={() => void openDuplicateDriveRecommendations()} type="button">
            Ver plan completo
          </button>
        </aside>
      </div>
    </section>
  );
}
