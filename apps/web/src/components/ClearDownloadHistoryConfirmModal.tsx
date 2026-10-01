import { useEffect } from "react";
import { Trash2, X } from "lucide-react";

export function ClearDownloadHistoryConfirmModal({
  submitting,
  onCancel,
  onConfirm
}: {
  submitting: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  useEffect(() => {
    function handleKey(event: KeyboardEvent) {
      if (event.key === "Escape") onCancel();
    }

    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [onCancel]);

  return (
    <div
      className="delete-confirm-backdrop"
      role="dialog"
      aria-modal="true"
      aria-labelledby="clear-download-history-title"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !submitting) onCancel();
      }}
    >
      <section className="delete-confirm-panel queue-history-confirm-panel">
        <header className="delete-confirm-header">
          <div className="delete-confirm-icon">
            <Trash2 size={22} />
          </div>
          <div>
            <span>Confirmacion requerida</span>
            <h2 id="clear-download-history-title">Eliminar historial de descargas</h2>
          </div>
          <button className="icon-button" onClick={onCancel} disabled={submitting} type="button" title="Cancelar">
            <X size={18} />
          </button>
        </header>
        <div className="delete-confirm-body">
          <p>Esto eliminara los elementos completados del historial de descargas.</p>
          <div className="queue-history-confirm-note">
            No borra archivos copiados, videos originales ni etiquetas de descarga.
          </div>
        </div>
        <footer className="delete-confirm-actions">
          <button className="secondary-button" onClick={onCancel} disabled={submitting} type="button">
            Cancelar
          </button>
          <button className="danger-button" onClick={onConfirm} disabled={submitting} type="button">
            <Trash2 size={16} />
            Eliminar cola
          </button>
        </footer>
      </section>
    </div>
  );
}
