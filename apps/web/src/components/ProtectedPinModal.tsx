import { Lock, X } from "lucide-react";

export function ProtectedPinModal({
  value,
  submitting,
  onChange,
  onCancel
}: {
  value: string;
  submitting: boolean;
  onChange: (value: string) => void;
  onCancel: () => void;
}) {
  return (
    <div className="pin-backdrop" role="dialog" aria-modal="true">
      <section className="pin-panel">
        <button className="icon-button pin-close" onClick={onCancel} type="button" title="Cancelar">
          <X size={18} />
        </button>
        <Lock size={22} />
        <h2>PIN requerido</h2>
        <input
          autoFocus
          className="pin-input"
          value={value}
          disabled={submitting}
          inputMode="numeric"
          maxLength={4}
          pattern="[0-9]*"
          type="password"
          onChange={(event) => onChange(event.target.value)}
          aria-label="PIN de 4 digitos"
        />
      </section>
    </div>
  );
}
