import { useEffect, useState } from "react";
import { AlertTriangle, ArrowRight, FolderInput, Star, X } from "lucide-react";
import { formatBytes } from "@videocat/shared";
import { api } from "../lib/api";
import { formatCount } from "../lib/app-helpers";
import { stagingReserveRatio, transferError } from "../lib/transfers";
import type { ConsolidatePlan, TransferDestination, TransferSummary } from "../types";

type ConsolidateDialogProps = {
  destination: TransferDestination;
  sources: Array<{ d: string; p: string }>;
  onCancel: () => void;
  onCreated: () => void;
};

export function ConsolidateDialog({ destination, sources, onCancel, onCreated }: ConsolidateDialogProps) {
  const [plan, setPlan] = useState<ConsolidatePlan | null>(null);
  const [summary, setSummary] = useState<TransferSummary | null>(null);
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    let active = true;
    const body = JSON.stringify({ destinationId: destination.id, sources });
    Promise.all([
      api<ConsolidatePlan>("/api/transfers/consolidate/preview", { method: "POST", body }),
      api<TransferSummary>("/api/transfers/summary").catch(() => null)
    ])
      .then(([nextPlan, nextSummary]) => {
        if (!active) return;
        setPlan(nextPlan);
        setSummary(nextSummary);
      })
      .catch((reason) => {
        if (active) setError(transferError(reason, "No se pudo preparar el plan."));
      });
    return () => {
      active = false;
    };
  }, [destination.id, sources]);

  useEffect(() => {
    function handleKey(event: KeyboardEvent) {
      if (event.key === "Escape" && !submitting) onCancel();
    }
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [onCancel, submitting]);

  async function confirm() {
    setSubmitting(true);
    setError("");
    try {
      await api("/api/transfers/consolidate", { method: "POST", body: JSON.stringify({ destinationId: destination.id, sources }) });
      onCreated();
    } catch (reason) {
      setError(transferError(reason, "No se pudo crear el traslado."));
      setSubmitting(false);
    }
  }

  const staging = summary?.staging ?? null;
  const stagingMissing = summary !== null && !staging?.configured;
  const stagingRoom = staging?.freeBytes != null && staging.totalBytes != null
    ? staging.freeBytes - staging.totalBytes * stagingReserveRatio
    : null;
  const room = plan?.freeBytes != null ? plan.freeBytes - plan.pendingBytes - plan.reserveBytes : null;

  return (
    <div
      className="delete-confirm-backdrop"
      role="dialog"
      aria-modal="true"
      aria-labelledby="consolidate-title"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !submitting) onCancel();
      }}
    >
      <section className="delete-confirm-panel vc-consolidate-panel">
        <header className="delete-confirm-header">
          <div className="delete-confirm-icon is-accent">
            <FolderInput size={22} />
          </div>
          <div>
            <span>Consolidar carpetas</span>
            <h2 id="consolidate-title">{`Llevar todo a ${destination.path.split("/").pop() ?? destination.path}`}</h2>
          </div>
          <button className="icon-button" onClick={onCancel} disabled={submitting} type="button" title="Cancelar">
            <X size={18} />
          </button>
        </header>

        <div className="delete-confirm-body vc-consolidate-body">
          <p>Los archivos salen de cada carpeta, esperan verificados en la carpeta temporal del Companion y llegan a la carpeta con estrella cuando conectes su disco. Nada se borra sin una copia verificada en otro lugar.</p>

          {!plan && !error ? <div className="loading">Calculando el plan…</div> : null}

          {plan ? (
            <>
              <div className="vc-consolidate-route">
                <ul className="vc-consolidate-sources" aria-label="Desde">
                  {plan.sources.map((source) => (
                    <li key={`${source.diskId}:${source.path}`}>
                      <span>{source.diskName}</span>
                      <code>{source.path}</code>
                      <em>{source.files > 0 ? `${formatCount(source.files)} · ${formatBytes(source.bytes)}` : "Nada que mover"}</em>
                    </li>
                  ))}
                </ul>
                <ArrowRight size={20} aria-hidden="true" className="vc-consolidate-arrow" />
                <div className="vc-consolidate-target vc-accent-bar">
                  <Star size={14} aria-hidden="true" />
                  <span>{plan.destination.diskName}</span>
                  <code>{plan.destination.path}</code>
                </div>
              </div>

              <dl className="vc-consolidate-facts">
                <div>
                  <dt>A mover</dt>
                  <dd>{`${formatCount(plan.files)} videos · ${formatBytes(plan.neededBytes)}`}</dd>
                </div>
                <div>
                  <dt>Libre en el destino</dt>
                  <dd>{room === null ? "Sin escanear" : formatBytes(Math.max(0, room))}</dd>
                </div>
                {plan.skipped.duplicates > 0 ? (
                  <div>
                    <dt>Ya están en el destino</dt>
                    <dd>{`${formatCount(plan.skipped.duplicates)} se quedan para revisar en Duplicados`}</dd>
                  </div>
                ) : null}
                {plan.skipped.favorites > 0 ? (
                  <div>
                    <dt>En carpetas favoritas</dt>
                    <dd>{`${formatCount(plan.skipped.favorites)} no se mueven`}</dd>
                  </div>
                ) : null}
                {(plan.skipped.objectStorage ?? 0) > 0 ? (
                  <div>
                    <dt>En buckets S3</dt>
                    <dd>{`${formatCount(plan.skipped.objectStorage ?? 0)} no se mueven: los traslados todavía no incluyen buckets`}</dd>
                  </div>
                ) : null}
                {plan.skipped.inTransfer > 0 ? (
                  <div>
                    <dt>En otro traslado</dt>
                    <dd>{formatCount(plan.skipped.inTransfer)}</dd>
                  </div>
                ) : null}
              </dl>

              {plan.files === 0 ? (
                <div className="vc-status-banner is-warning"><AlertTriangle size={18} /><div><strong>No hay nada que mover.</strong><span>Todo ya está en la carpeta destino o en otro traslado.</span></div></div>
              ) : null}
              {plan.files > 0 && !plan.fits ? (
                <div className="vc-status-banner is-warning" role="note">
                  <AlertTriangle size={18} />
                  <div>
                    <strong>{plan.freeBytes === null ? "Todavía no se conoce el espacio libre del destino." : `Hoy no cabe en ${plan.destination.diskName}: faltan ${formatBytes(plan.spaceWarning?.shortBytes ?? 0)}.`}</strong>
                    <span>{plan.freeBytes === null
                      ? "Se medirá al conectarlo. Puedes crear el traslado: si no alcanza, los archivos esperan en la carpeta temporal."
                      : "Puedes crear el traslado igual: los archivos salen de su disco y esperan en la carpeta temporal; llegan cuando liberes espacio y conectes el disco."}</span>
                  </div>
                </div>
              ) : null}
              {stagingMissing ? (
                <div className="vc-status-banner is-warning">
                  <AlertTriangle size={18} />
                  <div>
                    <strong>Falta la carpeta temporal en el Companion.</strong>
                    <span>Configúrala en Companion › Configuración › Archivos. Puedes crear el traslado ahora; empezará cuando esté configurada.</span>
                  </div>
                </div>
              ) : null}
              {stagingRoom !== null && plan.files > 0 && stagingRoom < plan.neededBytes ? (
                <div className="vc-status-banner is-warning">
                  <AlertTriangle size={18} />
                  <div>
                    <strong>{`La carpeta temporal tiene ${formatBytes(Math.max(0, stagingRoom))} disponibles.`}</strong>
                    <span>El Companion siempre deja libre el 5 % de ese disco; los archivos irán pasando por partes: cuando unos llegan al destino, entran los siguientes.</span>
                  </div>
                </div>
              ) : null}
            </>
          ) : null}

          {error ? <div className="form-error" role="alert">{error}</div> : null}
        </div>

        <footer className="delete-confirm-actions">
          <button className="secondary-button" onClick={onCancel} disabled={submitting} type="button">
            Cancelar
          </button>
          <button className="vc-button is-primary" onClick={() => void confirm()} disabled={submitting || !plan || plan.files === 0} type="button">
            <FolderInput size={16} />
            {submitting ? "Creando…" : "Crear traslado"}
          </button>
        </footer>
      </section>
    </div>
  );
}
