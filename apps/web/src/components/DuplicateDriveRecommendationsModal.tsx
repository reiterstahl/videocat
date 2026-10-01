import { useEffect } from "react";
import { X } from "lucide-react";
import { formatBytes } from "@videocat/shared";
import { type Language, translateText } from "../i18n";
import type { DuplicateDriveRecommendationsResponse } from "../lib/app-types";

export function DuplicateDriveRecommendationsModal({
  data,
  language,
  locale,
  loading,
  error,
  onClose,
  onRefresh
}: {
  data: DuplicateDriveRecommendationsResponse | null;
  language: Language;
  locale: string;
  loading: boolean;
  error: string;
  onClose: () => void;
  onRefresh: () => void;
}) {
  const disks = data?.disks ?? [];
  const maximumBytes = Math.max(1, ...disks.map((disk) => disk.recoverableBytes));

  useEffect(() => {
    function handleKey(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }

    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [onClose]);

  return (
    <div
      className="modal-backdrop"
      role="dialog"
      aria-modal="true"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <section className="recoverable-panel duplicate-drive-panel">
        <header className="recoverable-header">
          <div>
            <span>{translateText("Plan de liberación", language)}</span>
            <h2>{translateText("Discos prioritarios", language)}</h2>
          </div>
          <button className="icon-button" onClick={onClose} type="button" title={translateText("Cerrar", language)}>
            <X size={20} />
          </button>
        </header>

        <div className="duplicate-drive-summary">
          <div>
            <span>{translateText("Listo para borrar", language)}</span>
            <strong>{formatBytes(data?.totalReadyBytes ?? 0)}</strong>
          </div>
          <div>
            <span>{translateText("Pendiente de decidir", language)}</span>
            <strong>{formatBytes(data?.totalPendingBytes ?? 0)}</strong>
          </div>
          <div>
            <span>{translateText("Potencial total", language)}</span>
            <strong>{formatBytes(data?.totalRecoverableBytes ?? 0)}</strong>
          </div>
          <button className="secondary-button" onClick={onRefresh} disabled={loading} type="button">
            {loading ? translateText("Calculando...", language) : translateText("Actualizar", language)}
          </button>
        </div>

        <p className="duplicate-drive-explanation">
          {translateText("La prioridad favorece archivos ya marcados para borrar y luego el mayor espacio potencial entre duplicados. No se borrará nada desde esta pantalla.", language)}
        </p>
        {error ? <div className="form-error">{error}</div> : null}

        {loading && !data ? (
          <div className="empty">{translateText("Calculando discos prioritarios...", language)}</div>
        ) : disks.length === 0 ? (
          <div className="empty">{translateText("No hay espacio duplicado atribuible a los discos seleccionados.", language)}</div>
        ) : (
          <div className="duplicate-drive-list" aria-label={translateText("Discos prioritarios", language)}>
            {disks.map((disk, index) => (
              <article className="duplicate-drive-card" key={disk.diskId}>
                <span className="recoverable-rank">{index + 1}</span>
                <div className="duplicate-drive-identity">
                  <div>
                    <strong>{disk.diskName}</strong>
                    <span>{disk.driveLetter || disk.volumeLabel || translateText("Sin letra reportada", language)}</span>
                  </div>
                  <span className={`duplicate-drive-presence ${disk.connected ? "is-connected" : ""}`}>
                    {disk.connected ? translateText("Conectado", language) : translateText("Conectar primero", language)}
                  </span>
                </div>
                <div className="duplicate-drive-progress" aria-hidden="true">
                  <span style={{ width: `${Math.max(3, (disk.recoverableBytes / maximumBytes) * 100)}%` }} />
                </div>
                <div className="duplicate-drive-metrics">
                  <div>
                    <span>{translateText("Recuperable", language)}</span>
                    <strong>{formatBytes(disk.recoverableBytes)}</strong>
                  </div>
                  <div>
                    <span>{translateText("Ya marcado", language)}</span>
                    <strong>{formatBytes(disk.readyBytes)}</strong>
                  </div>
                  <div>
                    <span>{translateText("Por revisar", language)}</span>
                    <strong>{formatBytes(disk.pendingBytes)}</strong>
                  </div>
                </div>
                <footer>
                  {disk.groupCount.toLocaleString(locale)} {translateText("grupos", language)} · {disk.fileCount.toLocaleString(locale)} {translateText("archivos candidatos", language)}
                </footer>
              </article>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
