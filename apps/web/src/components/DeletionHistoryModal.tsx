import { useEffect } from "react";
import { Trash2, X } from "lucide-react";
import { formatBytes } from "@videocat/shared";
import { dateLabel } from "../lib/app-helpers";
import type { DeletionHistoryEntry, DeletionHistoryResponse } from "../lib/app-types";

export function DeletionHistoryModal({
  data,
  locale,
  loading,
  processing,
  error,
  message,
  onClose,
  onRefresh,
  onProcess
}: {
  data: DeletionHistoryResponse | null;
  locale: string;
  loading: boolean;
  processing: boolean;
  error: string;
  message: string;
  onClose: () => void;
  onRefresh: () => void;
  onProcess: () => void;
}) {
  const entries = data?.entries ?? [];
  const canProcess = Boolean(
    data?.companionOnline
    && data.connectedDiskCount > 0
    && data.summary.pending > 0
    && !processing
  );

  useEffect(() => {
    function handleKey(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }

    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [onClose]);

  function statusLabel(status: DeletionHistoryEntry["status"]): string {
    if (status === "deleted") return "Borrado";
    if (status === "missing") return "Ya ausente";
    if (status === "failed") return "Fallido";
    return "Pendiente";
  }

  return (
    <div
      className="modal-backdrop"
      role="dialog"
      aria-modal="true"
      aria-labelledby="deletion-history-title"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <section className="deletion-history-panel">
        <header className="deletion-history-header">
          <div>
            <span>Review y companion</span>
            <h2 id="deletion-history-title">Últimos borrados</h2>
          </div>
          <button className="icon-button" onClick={onClose} type="button" title="Cerrar">
            <X size={20} />
          </button>
        </header>

        <div className="deletion-history-toolbar">
          <div className="deletion-history-summary">
            <div><span>Pendientes</span><strong>{(data?.summary.pending ?? 0).toLocaleString(locale)}</strong></div>
            <div><span>Borrados</span><strong>{(data?.summary.deleted ?? 0).toLocaleString(locale)}</strong></div>
            <div><span>Fallidos</span><strong>{(data?.summary.failed ?? 0).toLocaleString(locale)}</strong></div>
            <div><span>Espacio liberado</span><strong>{formatBytes(data?.summary.deletedBytes ?? 0)}</strong></div>
          </div>
          <div className="deletion-history-actions">
            <button className="secondary-button" onClick={onRefresh} disabled={loading} type="button">
              {loading ? "Actualizando..." : "Actualizar"}
            </button>
            <button className="danger-button" onClick={onProcess} disabled={!canProcess} type="button">
              <Trash2 size={17} />
              {processing ? "Enviando..." : "Procesar pendientes"}
            </button>
          </div>
        </div>

        {!data?.companionOnline ? (
          <div className="deletion-history-notice is-warning">El companion no está conectado. Los borrados pendientes se conservarán hasta que vuelva a estar activo.</div>
        ) : data.connectedDiskCount === 0 ? (
          <div className="deletion-history-notice is-warning">El companion está activo, pero no reporta discos conectados.</div>
        ) : null}
        {message ? <div className="deletion-history-notice is-success">{message}</div> : null}
        {error ? <div className="form-error deletion-history-error">{error}</div> : null}

        <div className="deletion-history-table-wrap">
          {loading && !data ? (
            <div className="empty">Cargando historial de borrados...</div>
          ) : entries.length === 0 ? (
            <div className="empty">Aún no hay borrados ni archivos pendientes registrados.</div>
          ) : (
            <table className="deletion-history-table">
              <thead>
                <tr>
                  <th>Estado</th>
                  <th>Fecha</th>
                  <th>Disco</th>
                  <th>Archivo</th>
                  <th>Tamaño</th>
                </tr>
              </thead>
              <tbody>
                {entries.map((entry) => {
                  const eventDate = entry.completedAt ?? entry.attemptedAt ?? entry.requestedAt;
                  return (
                    <tr key={entry.id}>
                      <td data-label="Estado">
                        <span className={`deletion-status is-${entry.status}`}>{statusLabel(entry.status)}</span>
                      </td>
                      <td data-label="Fecha">{dateLabel(eventDate, locale)}</td>
                      <td data-label="Disco">
                        <strong>{entry.diskName}</strong>
                        <span className={`deletion-disk-state ${entry.connected ? "is-connected" : ""}`}>
                          {entry.connected ? `Conectado${entry.driveLetter ? ` · ${entry.driveLetter}` : ""}` : "No conectado"}
                        </span>
                      </td>
                      <td data-label="Archivo" className="deletion-file-cell" title={entry.relativePath}>
                        <strong>{entry.filename}</strong>
                        <span>{entry.relativePath}</span>
                        {entry.errorMessage ? <em>{entry.errorMessage}</em> : null}
                      </td>
                      <td data-label="Tamaño">{formatBytes(entry.sizeBytes)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
        <footer className="deletion-history-footer">
          El historial detallado se conserva para los borrados realizados a partir de esta actualización.
        </footer>
      </section>
    </div>
  );
}
