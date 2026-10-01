import { Trash2, X } from "lucide-react";

export function DeleteFileConfirmModal({
  filename,
  relativePath,
  value,
  submitting,
  onChange,
  onCancel,
  onConfirm
}: {
  filename: string;
  relativePath: string;
  value: string;
  submitting: boolean;
  onChange: (value: string) => void;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const canConfirm = value === "BORRAR" && !submitting;

  return (
    <div
      className="delete-confirm-backdrop"
      role="dialog"
      aria-modal="true"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onCancel();
      }}
    >
      <section className="delete-confirm-panel">
        <header className="delete-confirm-header">
          <div className="delete-confirm-icon">
            <Trash2 size={22} />
          </div>
          <div>
            <span>Confirmacion requerida</span>
            <h2>Borrar archivo fisicamente</h2>
          </div>
          <button className="icon-button" onClick={onCancel} type="button" title="Cancelar">
            <X size={18} />
          </button>
        </header>
        <div className="delete-confirm-body">
          <p>VideoCAT le pedira al companion local que elimine este archivo en Windows.</p>
          <div className="delete-file-target">
            <strong>{filename}</strong>
            <span>{relativePath}</span>
          </div>
          <label>
            Escribe BORRAR para confirmar
            <input
              autoFocus
              value={value}
              disabled={submitting}
              onChange={(event) => onChange(event.target.value.toUpperCase().slice(0, 6))}
              onKeyDown={(event) => {
                if (event.key === "Enter") onConfirm();
              }}
              placeholder="BORRAR"
            />
          </label>
        </div>
        <footer className="delete-confirm-actions">
          <button className="secondary-button" onClick={onCancel} disabled={submitting} type="button">
            Cancelar
          </button>
          <button className="danger-button" onClick={onConfirm} disabled={!canConfirm} type="button">
            <Trash2 size={16} />
            {submitting ? "Borrando..." : "Borrar archivo"}
          </button>
        </footer>
      </section>
    </div>
  );
}
