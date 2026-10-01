import { useEffect } from "react";
import { X } from "lucide-react";
import { formatBytes } from "@videocat/shared";
import type { RecoverableSpaceResponse } from "../lib/app-types";

export function RecoverableSpaceModal({
  data,
  locale,
  loading,
  error,
  onClose,
  onRefresh
}: {
  data: RecoverableSpaceResponse | null;
  locale: string;
  loading: boolean;
  error: string;
  onClose: () => void;
  onRefresh: () => void;
}) {
  const disks = data?.disks ?? [];
  const maxRecoverable = Math.max(1, ...disks.map((disk) => disk.recoverableBytes));
  const totalRecoverable = data?.totalRecoverableBytes ?? 0;

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
      <section className="recoverable-panel">
        <header className="recoverable-header">
          <div>
            <span>Marcados para borrar</span>
            <h2>Espacio a recuperar</h2>
          </div>
          <button className="icon-button" onClick={onClose} type="button" title="Cerrar">
            <X size={20} />
          </button>
        </header>

        <div className="recoverable-summary">
          <div>
            <span>Total recuperable</span>
            <strong>{formatBytes(totalRecoverable)}</strong>
          </div>
          <button className="secondary-button" onClick={onRefresh} disabled={loading} type="button">
            {loading ? "Calculando..." : "Actualizar"}
          </button>
        </div>

        {error ? <div className="form-error">{error}</div> : null}

        {loading && !data ? (
          <div className="empty">Calculando espacio a recuperar...</div>
        ) : disks.length === 0 ? (
          <div className="empty">No hay archivos marcados para borrar en este momento.</div>
        ) : (
          <>
            <div className="recoverable-list" aria-label="Discos recomendados">
              {disks.map((disk, index) => (
                <div className="recoverable-card" key={disk.diskId}>
                  <span className="recoverable-rank">{index + 1}</span>
                  <div className="recoverable-card-main">
                    <strong>{disk.diskName}</strong>
                    <span>
                      {`${disk.driveLetter || "-"} · ${disk.fileCount.toLocaleString(locale)} archivo(s) · ${disk.volumeLabel || "Sin etiqueta"}`}
                    </span>
                  </div>
                  <div className="recoverable-card-space">
                    <strong>{formatBytes(disk.recoverableBytes)}</strong>
                    <span>{disk.totalBytes ? `de ${formatBytes(disk.totalBytes)}` : "recuperables"}</span>
                  </div>
                </div>
              ))}
            </div>

            <div className="recoverable-chart" aria-label="Grafico de recuperacion por disco">
              {disks.map((disk) => {
                const relativeWidth = Math.max(4, (disk.recoverableBytes / maxRecoverable) * 100);
                const share = totalRecoverable > 0 ? (disk.recoverableBytes / totalRecoverable) * 100 : 0;
                return (
                  <div className="recoverable-bar-row" key={disk.diskId}>
                    <div className="recoverable-bar-label">
                      <strong>{disk.diskName}</strong>
                      <span>{`${share.toFixed(1)}% del total`}</span>
                    </div>
                    <div className="recoverable-bar-track">
                      <div className="recoverable-bar-fill" style={{ width: `${relativeWidth}%` }} />
                    </div>
                    <em>{formatBytes(disk.recoverableBytes)}</em>
                  </div>
                );
              })}
            </div>
          </>
        )}
      </section>
    </div>
  );
}
