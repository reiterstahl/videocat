import { useCallback, useEffect, useState } from "react";
import {
  AlertTriangle,
  ArrowRightLeft,
  ChevronDown,
  ChevronRight,
  FolderInput,
  HardDrive,
  Layers,
  Pause,
  Play,
  Plug,
  Star,
  Trash2,
  X
} from "lucide-react";
import { formatBytes } from "@videocat/shared";
import { api } from "../lib/api";
import { formatCount } from "../lib/app-helpers";
import { needDetail, needTitle, stagingReserveRatio, transferStateLabels } from "../lib/transfers";
import type { TransferDestination, TransferItem, TransferJob, TransferState, TransferSummary } from "../types";

type TransfersViewProps = {
  refreshKey: number;
  onOpenFolders: () => void;
  onChanged: () => void;
};

const pollMs = 10_000;
const finishedStates: TransferState[] = ["done", "duplicate", "cancelled"];
const jobStatusLabels: Record<TransferJob["status"], string> = {
  active: "En curso",
  paused: "En pausa",
  cancelled: "Cancelado",
  done: "Terminado"
};

function jobTotals(job: TransferJob) {
  let files = 0;
  let bytes = 0;
  let finishedFiles = 0;
  let finishedBytes = 0;
  for (const [state, value] of Object.entries(job.states) as Array<[TransferState, { files: number; bytes: number }]>) {
    if (state === "cancelled") continue;
    files += value.files;
    bytes += value.bytes;
    if (finishedStates.includes(state)) {
      finishedFiles += value.files;
      finishedBytes += value.bytes;
    }
  }
  return { files, bytes, finishedFiles, finishedBytes, ratio: bytes > 0 ? finishedBytes / bytes : files === 0 ? 1 : 0 };
}

export function TransfersView({ refreshKey, onOpenFolders, onChanged }: TransfersViewProps) {
  const [summary, setSummary] = useState<TransferSummary | null>(null);
  const [jobs, setJobs] = useState<TransferJob[] | null>(null);
  const [destinations, setDestinations] = useState<TransferDestination[]>([]);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [items, setItems] = useState<TransferItem[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [confirmCancel, setConfirmCancel] = useState<TransferJob | null>(null);

  const load = useCallback(async () => {
    try {
      const [nextSummary, nextJobs, nextDestinations] = await Promise.all([
        api<TransferSummary>("/api/transfers/summary"),
        api<{ jobs: TransferJob[] }>("/api/transfers"),
        api<{ destinations: TransferDestination[] }>("/api/transfers/destinations")
      ]);
      setSummary(nextSummary);
      setJobs(nextJobs.jobs);
      setDestinations(nextDestinations.destinations);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "No se pudieron cargar los traslados.");
    }
  }, []);

  useEffect(() => {
    void load();
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible") void load();
    }, pollMs);
    return () => window.clearInterval(timer);
  }, [load, refreshKey]);

  useEffect(() => {
    if (!expanded) {
      setItems(null);
      return;
    }
    let active = true;
    api<{ items: TransferItem[] }>(`/api/transfers/${expanded}`)
      .then((response) => {
        if (active) setItems(response.items);
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, [expanded, jobs]);

  async function act(job: TransferJob, action: "pause" | "resume" | "cancel") {
    setBusy(true);
    setError("");
    try {
      await api(`/api/transfers/${job.id}/${action}`, { method: "POST" });
      setConfirmCancel(null);
      await load();
      onChanged();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "No se pudo actualizar el traslado.");
    } finally {
      setBusy(false);
    }
  }

  async function removeDestination(destination: TransferDestination) {
    setBusy(true);
    setError("");
    try {
      await api(`/api/transfers/destinations/${destination.id}`, { method: "DELETE" });
      await load();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "No se pudo quitar la estrella.");
    } finally {
      setBusy(false);
    }
  }

  const staging = summary?.staging ?? null;
  const stagingReserve = staging?.totalBytes ? staging.totalBytes * stagingReserveRatio : 0;
  const stagingUsable = staging?.freeBytes != null ? Math.max(0, staging.freeBytes - stagingReserve) : null;
  const openJobs = jobs?.filter((job) => job.status === "active" || job.status === "paused" || jobTotals(job).finishedFiles < jobTotals(job).files) ?? [];
  const closedJobs = jobs?.filter((job) => !openJobs.includes(job)) ?? [];

  return (
    <section className="vc-view vc-transfers" aria-label="Traslados">
      <div className="vc-panel vc-folders-head">
        <div className="vc-folders-title">
          <ArrowRightLeft size={18} aria-hidden="true" />
          <div>
            <h2>Traslados</h2>
            <p>Mueve videos entre discos aunque no estén conectados a la vez. Cada archivo pasa por la carpeta temporal del Companion y solo se borra de un lugar después de verificar su copia en el siguiente.</p>
          </div>
        </div>
      </div>

      <div className="vc-transfers-kinds">
        <article className="vc-panel vc-transfers-kind">
          <FolderInput size={20} aria-hidden="true" />
          <div>
            <h3>Consolidar carpetas</h3>
            <p>Junta en una sola las carpetas que se llaman igual en distintos discos. El contenido de las pequeñas va a la carpeta con estrella, normalmente la más grande.</p>
          </div>
          <button className="vc-button is-small" onClick={onOpenFolders} type="button">
            <Layers size={14} /> Ir a Uso por carpeta
          </button>
        </article>
        <article className="vc-panel vc-transfers-kind is-soon">
          <ArrowRightLeft size={20} aria-hidden="true" />
          <div>
            <h3>Agrupar archivos</h3>
            <p>Parte de una carpeta (ej. testing001) y busca en todos los discos archivos con nombres parecidos. Decides uno por uno, como en Review: F agrupar, J ignorar.</p>
          </div>
          <span className="vc-badge">Próximamente</span>
        </article>
      </div>

      {error ? <div className="form-error" role="alert">{error}</div> : null}

      {summary && summary.needs.length > 0 ? (
        <div className="vc-transfers-needs" aria-live="polite">
          {summary.needs.map((need) => (
            <div key={`${need.kind}:${need.diskId}`} className={`vc-status-banner ${need.kind === "free_space" ? "is-danger" : need.connected ? "" : "is-warning"}`}>
              {need.kind === "free_space" ? <AlertTriangle size={18} /> : need.connected ? <HardDrive size={18} /> : <Plug size={18} />}
              <div>
                <strong>{needTitle(need)}</strong>
                <span>{needDetail(need)}</span>
                {need.detail ? <span className="vc-transfers-detail">{need.detail}</span> : null}
              </div>
            </div>
          ))}
        </div>
      ) : null}

      <div className="vc-transfers-layout">
        <div className="vc-panel vc-transfers-jobs">
          <div className="vc-panel-head">
            <div>
              <h3>Traslados</h3>
              <p>Se actualiza solo cada pocos segundos mientras el Companion trabaja.</p>
            </div>
          </div>
          {jobs === null ? <div className="loading">Cargando...</div> : null}
          {jobs && openJobs.length === 0 ? <p className="vc-folders-empty">No hay traslados en curso.</p> : null}
          <ul className="vc-transfers-list">
            {[...openJobs, ...closedJobs.slice(0, 10)].map((job) => {
              const totals = jobTotals(job);
              const open = expanded === job.id;
              const running = job.status === "active" || job.status === "paused";
              return (
                <li key={job.id} className={`is-${job.status}`}>
                  <div className="vc-transfers-job-head">
                    <button className="vc-transfers-expand" onClick={() => setExpanded(open ? null : job.id)} type="button" aria-expanded={open}>
                      {open ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
                      <strong>{job.label || job.destination.path}</strong>
                    </button>
                    <span className={`vc-badge ${job.status === "paused" ? "is-warning" : job.status === "done" ? "is-success" : ""}`}>{jobStatusLabels[job.status]}</span>
                  </div>
                  <p className="vc-transfers-job-route">
                    <span>{job.kind === "consolidate" ? "Consolidar" : "Agrupar"}</span>
                    <Star size={12} aria-hidden="true" />
                    <span>{`${job.destination.diskName}: ${job.destination.path}`}</span>
                  </p>
                  <div className="vc-transfers-progress" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(totals.ratio * 100)}>
                    <span style={{ width: `${Math.round(totals.ratio * 100)}%` }} />
                  </div>
                  <p className="vc-transfers-job-meta">
                    {`${formatCount(totals.finishedFiles)} de ${formatCount(totals.files)} archivos · ${formatBytes(totals.finishedBytes)} de ${formatBytes(totals.bytes)}`}
                  </p>
                  <ul className="vc-transfers-states">
                    {(Object.entries(job.states) as Array<[TransferState, { files: number; bytes: number }]>)
                      .filter(([state]) => state !== "done")
                      .map(([state, value]) => (
                        <li key={state}>{`${transferStateLabels[state]}: ${formatCount(value.files)}`}</li>
                      ))}
                  </ul>
                  {running ? (
                    <div className="vc-folders-actions">
                      {job.status === "active" ? (
                        <button className="vc-button is-small" disabled={busy} onClick={() => void act(job, "pause")} type="button"><Pause size={14} /> Pausar</button>
                      ) : (
                        <button className="vc-button is-small" disabled={busy} onClick={() => void act(job, "resume")} type="button"><Play size={14} /> Reanudar</button>
                      )}
                      <button className="vc-button is-small is-ghost" disabled={busy} onClick={() => setConfirmCancel(job)} type="button"><X size={14} /> Cancelar</button>
                    </div>
                  ) : null}
                  {open ? (
                    items === null ? <div className="loading">Cargando...</div> : (
                      <ul className="vc-transfers-items">
                        {items.map((item) => (
                          <li key={item.id} className={`is-${item.state}`}>
                            <span className="vc-transfers-item-name" title={item.sourceRelativePath}>{item.filename}</span>
                            <span className="vc-transfers-item-size">{formatBytes(item.sizeBytes)}</span>
                            <span className="vc-transfers-item-state">
                              {transferStateLabels[item.state]}{item.attempts > 0 && !finishedStates.includes(item.state) ? ` · ${item.attempts} reintentos` : ""}
                            </span>
                            {item.error && !finishedStates.includes(item.state) ? <span className="vc-transfers-item-error">{item.error}</span> : null}
                          </li>
                        ))}
                      </ul>
                    )
                  ) : null}
                </li>
              );
            })}
          </ul>
        </div>

        <aside className="vc-transfers-side">
          <div className="vc-panel vc-transfers-staging">
            <h3><HardDrive size={16} aria-hidden="true" /> Carpeta temporal</h3>
            {!staging ? (
              <p className="vc-folders-empty">El Companion todavía no informó su carpeta temporal. Actualízalo y conéctalo.</p>
            ) : !staging.configured ? (
              <p className="vc-folders-empty">Sin configurar. Elige una carpeta en Companion › Configuración › Archivos para que los traslados avancen.</p>
            ) : (
              <>
                <code>{staging.path}</code>
                {staging.error ? <p className="form-error">{staging.error}</p> : null}
                <dl className="vc-consolidate-facts">
                  <div><dt>En tránsito</dt><dd>{formatBytes(summary?.stagingBytes ?? 0)}</dd></div>
                  <div><dt>Disponible</dt><dd>{stagingUsable === null ? "—" : formatBytes(stagingUsable)}</dd></div>
                  <div><dt>Reserva (5 %)</dt><dd>{formatBytes(stagingReserve)}</dd></div>
                </dl>
                {staging.companionName ? <p className="vc-transfers-detail">{`Companion: ${staging.companionName}`}</p> : null}
              </>
            )}
          </div>

          <div className="vc-panel vc-transfers-destinations">
            <h3><Star size={16} aria-hidden="true" /> Carpetas con estrella</h3>
            {destinations.length === 0 ? (
              <p className="vc-folders-empty">Ninguna todavía. Márcalas en Uso por carpeta › Carpetas repetidas.</p>
            ) : (
              <ul className="vc-folders-locations">
                {destinations.map((destination) => (
                  <li key={destination.id}>
                    <span>{destination.diskName}</span>
                    <code>{destination.path}</code>
                    <button className="icon-button" disabled={busy} onClick={() => void removeDestination(destination)} type="button" title="Quitar estrella">
                      <Trash2 size={14} />
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </aside>
      </div>

      {confirmCancel ? (
        <div className="delete-confirm-backdrop" role="dialog" aria-modal="true" aria-labelledby="cancel-transfer-title" onMouseDown={(event) => { if (event.target === event.currentTarget && !busy) setConfirmCancel(null); }}>
          <section className="delete-confirm-panel">
            <header className="delete-confirm-header">
              <div className="delete-confirm-icon"><X size={22} /></div>
              <div>
                <span>Cancelar traslado</span>
                <h2 id="cancel-transfer-title">{confirmCancel.label || confirmCancel.destination.path}</h2>
              </div>
              <button className="icon-button" onClick={() => setConfirmCancel(null)} disabled={busy} type="button" title="Cerrar"><X size={18} /></button>
            </header>
            <div className="delete-confirm-body">
              <p>Los archivos que aún no salieron de su disco se quedan donde están. Los que ya están en la carpeta temporal terminan su camino hasta la carpeta destino: nunca se pierden.</p>
            </div>
            <footer className="delete-confirm-actions">
              <button className="secondary-button" onClick={() => setConfirmCancel(null)} disabled={busy} type="button">Volver</button>
              <button className="danger-button" onClick={() => void act(confirmCancel, "cancel")} disabled={busy} type="button"><X size={16} /> Cancelar traslado</button>
            </footer>
          </section>
        </div>
      ) : null}
    </section>
  );
}
