import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  ArrowDownToLine,
  ArrowRightLeft,
  ArrowUpFromLine,
  ChevronDown,
  ChevronRight,
  FolderInput,
  FolderSearch,
  HardDrive,
  Layers,
  Pause,
  Play,
  Plug,
  Search,
  Star,
  Trash2,
  X
} from "lucide-react";
import { formatBytes } from "@videocat/shared";
import { api } from "../lib/api";
import { formatCount } from "../lib/app-helpers";
import { driveName, groupNeeds, needDetail, needGroupTotals, needSortLabels, needTitle, stagingReserveRatio, transferStateLabels, transferError, type NeedSort } from "../lib/transfers";
import { ConsolidateDialog } from "../components/ConsolidateDialog";
import { GroupSession } from "../components/GroupSession";
import { GroupKeywordsEditor } from "../components/GroupKeywordsEditor";
import { TagRulesSection } from "../components/TagRulesSection";
import type { GroupFolder, TransferDestination, TransferItem, TransferJob, TransferNeed, TransferState, TransferSummary } from "../types";

const needSortKey = "videocat-transfers-need-sort";

// The chosen order is a per-browser convenience; "Más datos" when nothing is stored.
function readNeedSort(): NeedSort {
  try {
    const stored = localStorage.getItem(needSortKey);
    return stored === "connected" || stored === "name" ? stored : "data";
  } catch {
    return "data";
  }
}

type TransfersViewProps = {
  refreshKey: number;
  onOpenFolders: () => void;
  onChanged: () => void;
  initialGroupQuery?: string;
  onInitialGroupQueryUsed?: () => void;
};

type JobKind = TransferJob["kind"];

const pollMs = 10_000;
const recentClosedJobs = 5;
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

// Still has files on their way, whatever its status (a cancelled transfer finishes what left its drive).
function jobIsOpen(job: TransferJob): boolean {
  const totals = jobTotals(job);
  return job.status === "active" || job.status === "paused" || totals.finishedFiles < totals.files;
}

function folderName(path: string): string {
  return path.split("/").filter(Boolean).pop() ?? path;
}

export function TransfersView({ refreshKey, onOpenFolders, onChanged, initialGroupQuery = "", onInitialGroupQueryUsed }: TransfersViewProps) {
  const [summary, setSummary] = useState<TransferSummary | null>(null);
  const [jobs, setJobs] = useState<TransferJob[] | null>(null);
  const [destinations, setDestinations] = useState<TransferDestination[] | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [items, setItems] = useState<TransferItem[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [confirmCancel, setConfirmCancel] = useState<TransferJob | null>(null);
  const [groupQuery, setGroupQuery] = useState(initialGroupQuery);
  const [jobFilter, setJobFilter] = useState<JobKind | "all">("all");
  const [needSort, setNeedSort] = useState<NeedSort>(readNeedSort);
  const neededGroups = useMemo(() => (summary && summary.needs.length > 0 ? groupNeeds(summary.needs, needSort) : null), [needSort, summary]);

  function changeNeedSort(next: NeedSort) {
    setNeedSort(next);
    try {
      localStorage.setItem(needSortKey, next);
    } catch {
      // Without storage the order lasts for this visit.
    }
  }
  const [groupFolders, setGroupFolders] = useState<GroupFolder[] | null>(null);
  const [groupingDestinationId, setGroupingDestinationId] = useState<string | null>(null);
  const [consolidating, setConsolidating] = useState<TransferDestination | null>(null);
  const groupCardRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!initialGroupQuery) return;
    setGroupQuery(initialGroupQuery);
    groupCardRef.current?.scrollIntoView({ block: "center" });
    onInitialGroupQueryUsed?.();
  }, [initialGroupQuery, onInitialGroupQueryUsed]);

  useEffect(() => {
    const term = groupQuery.trim();
    setGroupFolders(null);
    if (term.length < 3) return;
    let active = true;
    const timer = window.setTimeout(() => {
      api<{ folders: GroupFolder[] }>(`/api/transfers/folders?q=${encodeURIComponent(term)}`)
        .then((response) => {
          if (active) setGroupFolders(response.folders);
        })
        .catch(() => {
          if (active) setGroupFolders([]);
        });
    }, 300);
    return () => {
      active = false;
      window.clearTimeout(timer);
    };
  }, [groupQuery]);

  // Progress changes every few seconds; the starred folders (sizes and namesakes) only when something is decided.
  const loadProgress = useCallback(async () => {
    try {
      const [nextSummary, nextJobs] = await Promise.all([
        api<TransferSummary>("/api/transfers/summary"),
        api<{ jobs: TransferJob[] }>("/api/transfers")
      ]);
      setSummary(nextSummary);
      setJobs(nextJobs.jobs);
    } catch (reason) {
      setError(transferError(reason, "No se pudieron cargar los traslados."));
    }
  }, []);

  const loadDestinations = useCallback(async () => {
    try {
      const response = await api<{ destinations: TransferDestination[] }>("/api/transfers/destinations");
      setDestinations(response.destinations);
    } catch (reason) {
      setError(transferError(reason, "No se pudieron cargar las carpetas con estrella."));
    }
  }, []);

  const reload = useCallback(async () => {
    await Promise.all([loadProgress(), loadDestinations()]);
  }, [loadDestinations, loadProgress]);

  useEffect(() => {
    void reload();
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible") void loadProgress();
    }, pollMs);
    return () => window.clearInterval(timer);
  }, [loadProgress, refreshKey, reload]);

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
      await loadProgress();
      onChanged();
    } catch (reason) {
      setError(transferError(reason, "No se pudo actualizar el traslado."));
    } finally {
      setBusy(false);
    }
  }

  async function removeDestination(destination: TransferDestination) {
    setBusy(true);
    setError("");
    try {
      await api(`/api/transfers/destinations/${destination.id}`, { method: "DELETE" });
      await loadDestinations();
    } catch (reason) {
      setError(transferError(reason, "No se pudo quitar la estrella."));
    } finally {
      setBusy(false);
    }
  }

  async function startGrouping(folder: GroupFolder) {
    if (folder.destinationId) {
      setGroupingDestinationId(folder.destinationId);
      return;
    }
    setBusy(true);
    setError("");
    try {
      const response = await api<{ destination: { id: string } }>("/api/transfers/destinations", { method: "POST", body: JSON.stringify({ diskId: folder.diskId, path: folder.path }) });
      setGroupingDestinationId(response.destination.id);
      void loadDestinations();
    } catch (reason) {
      setError(transferError(reason, "No se pudo marcar la carpeta."));
    } finally {
      setBusy(false);
    }
  }

  const staging = summary?.staging ?? null;
  const stagingReserve = staging?.totalBytes ? staging.totalBytes * stagingReserveRatio : 0;
  const stagingUsable = staging?.freeBytes != null ? Math.max(0, staging.freeBytes - stagingReserve) : null;
  const openJobs = jobs?.filter(jobIsOpen) ?? [];
  const stagingMissing = openJobs.length > 0 && (!staging || !staging.configured);

  function jobsOf(kind: JobKind | "all") {
    const ofKind = jobs?.filter((job) => kind === "all" || job.kind === kind) ?? [];
    return [...ofKind.filter(jobIsOpen), ...ofKind.filter((job) => !jobIsOpen(job)).slice(0, recentClosedJobs)];
  }

  function renderJob(job: TransferJob) {
    const totals = jobTotals(job);
    const open = expanded === job.id;
    const running = job.status === "active" || job.status === "paused";
    return (
      <li key={job.id} className={`vc-transfers-job vc-accent-bar is-${job.kind} is-${job.status}`}>
        <div className="vc-transfers-job-head">
          <button className="vc-transfers-expand" onClick={() => setExpanded(open ? null : job.id)} type="button" aria-expanded={open}>
            {open ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
            <strong>{job.label || folderName(job.destination.path)}</strong>
          </button>
          <span className={`vc-badge ${job.status === "paused" ? "is-warning" : job.status === "done" ? "is-success" : ""}`}>{jobStatusLabels[job.status]}</span>
        </div>
        <p className="vc-transfers-job-route">
          <span className={`vc-kind-tag is-${job.kind}`}>{job.kind === "consolidate" ? "Consolidar" : job.kind === "group" ? "Agrupar" : "Etiqueta"}</span>
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
            {job.kind === "tag" ? (
              <span className="vc-transfers-detail">Para dejar de mover, quita la regla.</span>
            ) : (
              <button className="vc-button is-small is-ghost" disabled={busy} onClick={() => setConfirmCancel(job)} type="button"><X size={14} /> Cancelar</button>
            )}
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
  }

  function renderJobs(kind: JobKind | "all") {
    const list = jobsOf(kind);
    if (jobs === null) return <div className="loading">Cargando...</div>;
    if (list.length === 0) {
      return <p className="vc-folders-empty">{kind === "all" ? "No hay traslados todavía." : kind === "consolidate" ? "Sin consolidaciones todavía." : kind === "group" ? "Sin archivos agrupados todavía." : "Sin movimientos por etiqueta todavía."}</p>;
    }
    return <ul className="vc-transfers-list vc-transfers-grid">{list.map(renderJob)}</ul>;
  }

  function renderNeed(need: TransferNeed) {
    return (
      <div key={`${need.kind}:${need.diskId}`} className="vc-need" tabIndex={0} aria-describedby={`need-${need.kind}-${need.diskId}`}>
        <div className={`vc-status-banner ${need.kind === "free_space" ? "is-danger" : need.kind === "space_short" || !need.connected ? "is-warning" : ""}`}>
          {need.kind === "free_space" || need.kind === "space_short" ? <AlertTriangle size={18} /> : need.connected ? <HardDrive size={18} /> : <Plug size={18} />}
          <div>
            <strong>{needTitle(need)}</strong>
            <span>{needDetail(need)}</span>
            {need.detail ? <span className="vc-transfers-detail">{need.detail}</span> : null}
          </div>
        </div>
        {need.movement && (need.movement.incoming.files > 0 || need.movement.outgoing.files > 0) ? (
          <div className="vc-need-popover" role="tooltip" id={`need-${need.kind}-${need.diskId}`}>
            <strong>{`Pendiente en ${driveName(need)}`}</strong>
            {need.movement.incoming.files > 0 ? (
              <section className="is-incoming">
                <span>{`+ ${formatCount(need.movement.incoming.files)} ${need.movement.incoming.files === 1 ? "archivo por copiar" : "archivos por copiar"} a este disco · ${formatBytes(need.movement.incoming.bytes)}`}</span>
                <ul>
                  {need.movement.incoming.names.map((name) => <li key={name} title={name}>{name}</li>)}
                  {need.movement.incoming.files > need.movement.incoming.names.length ? <li className="is-more">{`y ${formatCount(need.movement.incoming.files - need.movement.incoming.names.length)} más`}</li> : null}
                </ul>
              </section>
            ) : null}
            {need.movement.outgoing.files > 0 ? (
              <section className="is-outgoing">
                <span>{`− ${formatCount(need.movement.outgoing.files)} ${need.movement.outgoing.files === 1 ? "archivo saldrá" : "archivos saldrán"} de este disco · ${formatBytes(need.movement.outgoing.bytes)}`}</span>
                <ul>
                  {need.movement.outgoing.names.map((name) => <li key={name} title={name}>{name}</li>)}
                  {need.movement.outgoing.files > need.movement.outgoing.names.length ? <li className="is-more">{`y ${formatCount(need.movement.outgoing.files - need.movement.outgoing.names.length)} más`}</li> : null}
                </ul>
              </section>
            ) : null}
            <small>Los que salen se borran de este disco solo después de verificar su copia en la carpeta temporal.</small>
          </div>
        ) : null}
      </div>
    );
  }

  return (
    <section className="vc-view vc-transfers" aria-label="Traslados">
      <div className="vc-panel vc-transfers-hero">
        <div className="vc-folders-title">
          <ArrowRightLeft size={18} aria-hidden="true" />
          <div>
            <h2>Traslados</h2>
            <p>Mueve videos entre discos aunque no estén conectados a la vez. Cada archivo pasa por la carpeta temporal del Companion y solo se borra de un lugar después de verificar su copia en el siguiente.</p>
          </div>
        </div>
        <dl className="vc-transfers-stats">
          <div>
            <dt>En curso</dt>
            <dd>{formatCount(openJobs.length)}</dd>
          </div>
          <div>
            <dt>Con estrella</dt>
            <dd>{formatCount(destinations?.length ?? 0)}</dd>
          </div>
          <div className={`vc-transfers-staging ${!staging?.configured ? "is-warning" : ""}`}>
            <dt><HardDrive size={13} aria-hidden="true" /> Carpeta temporal</dt>
            {!staging ? (
              <dd className="is-text">Sin informar</dd>
            ) : !staging.configured ? (
              <dd className="is-text">Sin configurar</dd>
            ) : (
              <>
                <dd>{formatBytes(summary?.stagingBytes ?? 0)}</dd>
                <dd className="is-sub" title={staging.path ?? undefined}>
                  <code>{staging.path}</code>
                  {stagingUsable === null ? null : <span>{`${formatBytes(stagingUsable)} disponibles · reserva 5 %`}</span>}
                </dd>
              </>
            )}
          </div>
        </dl>
      </div>

      {error ? <div className="form-error" role="alert">{error}</div> : null}

      {stagingMissing || (summary && summary.needs.length > 0) ? (
        <section className="vc-transfers-needs-panel" aria-label="Para continuar">
        <div className="vc-needs-head">
          <h3 className="vc-transfers-kind-subtitle is-first">Para continuar</h3>
          {summary && summary.needs.length > 1 ? (
            <div className="vc-segmented" role="group" aria-label="Ordenar discos">
              {(Object.keys(needSortLabels) as NeedSort[]).map((option) => (
                <button key={option} type="button" aria-pressed={needSort === option} onClick={() => changeNeedSort(option)}>{needSortLabels[option]}</button>
              ))}
            </div>
          ) : null}
        </div>
        <div className="vc-transfers-needs" aria-live="polite">
          {stagingMissing ? (
            <div className="vc-status-banner is-danger">
              <AlertTriangle size={18} />
              <div>
                <strong>Configura la carpeta temporal en el Companion</strong>
                <span>{staging ? "Elige una carpeta en Companion › Configuración › Archivos › Carpeta temporal de traslados. Hasta entonces los traslados no avanzan." : "El Companion todavía no informó su carpeta temporal: actualízalo a la última versión, conéctalo y elige la carpeta en Configuración › Archivos."}</span>
              </div>
            </div>
          ) : null}
          {neededGroups ? (
            <div className="vc-needs-groups">
              {([
                { key: "receiving", title: "Reciben material", help: "Discos a los que hay que copiar archivos desde la carpeta temporal.", icon: <ArrowDownToLine size={16} aria-hidden="true" />, items: neededGroups.receiving },
                { key: "sending", title: "Copian a la carpeta temporal", help: "Discos con archivos que todavía tienen que salir hacia la carpeta temporal.", icon: <ArrowUpFromLine size={16} aria-hidden="true" />, items: neededGroups.sending }
              ] as const).map((group) => (
                <section key={group.key} className={`vc-panel vc-needs-group vc-accent-bar is-${group.key}`} aria-label={group.title}>
                  <header>
                    <h4>{group.icon}{group.title}</h4>
                    <span className="vc-needs-group-total">
                      {group.items.length === 0 ? "Nada pendiente" : (() => {
                        const totals = needGroupTotals(group.items);
                        return `${formatCount(totals.disks)} ${totals.disks === 1 ? "disco" : "discos"} · ${formatBytes(totals.bytes)}`;
                      })()}
                    </span>
                    <p>{group.help}</p>
                  </header>
                  {group.items.length === 0 ? <p className="vc-folders-empty">Ningún disco en este grupo.</p> : (
                    <div className="vc-needs-list">{group.items.map(renderNeed)}</div>
                  )}
                </section>
              ))}
            </div>
          ) : null}
        </div>
        </section>
      ) : null}

      <section className="vc-panel vc-transfers-destinations" aria-label="Carpetas con estrella">
        <div className="vc-transfers-section-head">
          <h3><Star size={17} aria-hidden="true" className="vc-star-icon" /> Carpetas con estrella</h3>
          <p>Son las únicas que pueden recibir archivos. Desde cada una puedes consolidar sus carpetas iguales o agrupar archivos parecidos.</p>
        </div>
        {destinations === null ? <div className="loading">Cargando...</div> : destinations.length === 0 ? (
          <p className="vc-folders-empty">Ninguna todavía. Márcalas en Uso por carpeta › Carpetas repetidas o elige una carpeta en Agrupar archivos.</p>
        ) : (
          <ul className="vc-starred-grid">
            {destinations.map((destination) => {
              const namesakeBytes = destination.namesakes.reduce((sum, namesake) => sum + namesake.sizeBytes, 0);
              const larger = destination.namesakes.find((namesake) => namesake.sizeBytes > destination.sizeBytes);
              return (
                <li key={destination.id} className="vc-starred-card">
                  <div className="vc-starred-head">
                    <Star size={18} aria-hidden="true" className="vc-star-icon" />
                    <div>
                      <strong>{folderName(destination.path)}</strong>
                      <span title={destination.path}>{`${destination.diskName} › ${destination.path}`}</span>
                    </div>
                    <button className="icon-button" disabled={busy} onClick={() => void removeDestination(destination)} type="button" title="Quitar estrella">
                      <Trash2 size={14} />
                    </button>
                  </div>
                  <dl className="vc-starred-facts">
                    <div><dt>Contenido</dt><dd>{`${formatBytes(destination.sizeBytes)} · ${formatCount(destination.fileCount)} videos`}</dd></div>
                    <div><dt>Libre en el disco</dt><dd>{destination.freeBytes == null ? "Sin escanear" : formatBytes(destination.freeBytes)}</dd></div>
                  </dl>
                  <p className={`vc-starred-namesakes ${destination.namesakes.length > 0 ? "is-consolidate" : ""}`}>
                    {destination.namesakes.length > 0
                      ? `${destination.namesakes.length === 1 ? "1 carpeta igual" : `${formatCount(destination.namesakes.length)} carpetas iguales`} en otros discos · ${formatBytes(namesakeBytes)}`
                      : "Sin carpetas iguales en otros discos"}
                  </p>
                  {larger ? (
                    <p className="vc-folders-warning" role="note">
                      <AlertTriangle size={14} aria-hidden="true" />
                      {`La ubicación más grande es ${larger.diskName}: ${larger.path} (${formatBytes(larger.sizeBytes)}). Conviene que la estrella esté ahí para mover menos datos.`}
                    </p>
                  ) : null}
                  <GroupKeywordsEditor
                    destinationId={destination.id}
                    keywords={destination.groupKeywords}
                    onSaved={(keywords) => setDestinations((current) => current?.map((entry) => (entry.id === destination.id ? { ...entry, groupKeywords: keywords } : entry)) ?? current)}
                  />
                  <div className="vc-starred-actions">
                    <button className="vc-button is-small vc-kind-button is-consolidate" disabled={busy || destination.namesakes.length === 0} onClick={() => setConsolidating(destination)} type="button" title={destination.namesakes.length === 0 ? "No hay carpetas con este nombre en otros discos" : "Traer aquí el contenido de las carpetas iguales"}>
                      <FolderInput size={14} /> Consolidar
                    </button>
                    <button className="vc-button is-small vc-kind-button is-group" disabled={busy} onClick={() => setGroupingDestinationId(destination.id)} type="button" title="Agrupar archivos en esta carpeta">
                      <FolderSearch size={14} /> Agrupar archivos
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <div className="vc-transfers-columns is-three">
        <section className="vc-panel vc-transfers-kind vc-accent-bar is-consolidate" aria-label="Consolidar carpetas">
          <header className="vc-transfers-kind-head">
            <span className="vc-kind-icon" aria-hidden="true"><FolderInput size={20} /></span>
            <div>
              <h3>Consolidar carpetas</h3>
              <p>Junta en una sola las carpetas que se llaman igual en distintos discos. El contenido de las pequeñas va a la carpeta con estrella, normalmente la más grande.</p>
            </div>
          </header>
          <div className="vc-transfers-kind-start">
            <button className="vc-button is-small" onClick={onOpenFolders} type="button">
              <Layers size={14} /> Ir a Uso por carpeta
            </button>
            <span className="vc-transfers-detail">o usa Consolidar en una carpeta con estrella.</span>
          </div>
        </section>

        <section className="vc-panel vc-transfers-kind vc-accent-bar is-group vc-transfers-group" aria-label="Agrupar archivos" ref={groupCardRef}>
          <header className="vc-transfers-kind-head">
            <span className="vc-kind-icon" aria-hidden="true"><FolderSearch size={20} /></span>
            <div>
              <h3>Agrupar archivos</h3>
              <p>Parte de una carpeta (ej. testing001) y busca en todos los discos archivos con nombres parecidos. Decides uno por uno, como en Review: F agrupar, J ignorar.</p>
            </div>
          </header>
          <label className="vc-folders-search">
            <Search size={15} aria-hidden="true" />
            <input value={groupQuery} onChange={(event) => setGroupQuery(event.target.value)} placeholder="Nombre de la carpeta destino" aria-label="Buscar carpeta para agrupar archivos" />
          </label>
          {groupQuery.trim().length >= 3 ? (
            groupFolders === null ? <div className="loading">Buscando…</div> : groupFolders.length === 0 ? (
              <p className="vc-folders-empty">Ninguna carpeta con ese nombre en el catálogo.</p>
            ) : (
              <ul className="vc-transfers-folder-results">
                {groupFolders.map((folder) => {
                  const name = folderName(folder.path);
                  // Same rule as the stars: files should go to the largest folder with that name.
                  const larger = groupFolders.find((other) => other !== folder && other.bytes > folder.bytes && folderName(other.path).toLowerCase() === name.toLowerCase());
                  return (
                    <li key={`${folder.diskId}:${folder.path}`}>
                      <span className="vc-transfers-folder-name">
                        {folder.destinationId ? <Star size={12} aria-label="Con estrella" className="is-starred" /> : null}
                        <strong>{name}</strong>
                        <small>{`${folder.diskName} › ${folder.path}`}</small>
                      </span>
                      <em>{`${formatCount(folder.files)} ${folder.files === 1 ? "video" : "videos"} · ${formatBytes(folder.bytes)}`}</em>
                      <button className="vc-button is-small" disabled={busy} onClick={() => void startGrouping(folder)} type="button">
                        <FolderSearch size={14} /> Agrupar aquí
                      </button>
                      {larger ? (
                        <p className="vc-folders-warning">
                          <AlertTriangle size={14} aria-hidden="true" />
                          {`Hay una carpeta ${name} más grande en ${larger.diskName} (${formatBytes(larger.bytes)}). Conviene agrupar ahí.`}
                        </p>
                      ) : null}
                    </li>
                  );
                })}
              </ul>
            )
          ) : (
            <p className="vc-transfers-detail">Escribe al menos 3 letras. La carpeta que elijas queda marcada con estrella.</p>
          )}
        </section>
        <TagRulesSection
          destinations={destinations}
          refreshKey={refreshKey}
          onChanged={() => {
            void reload();
            onChanged();
          }}
        />
      </div>

      <section className="vc-panel vc-transfers-running" aria-label="Traslados en curso">
        <div className="vc-transfers-running-head">
          <div className="vc-transfers-section-head">
            <h3><ArrowRightLeft size={17} aria-hidden="true" /> Traslados en curso</h3>
            <p>Todos los traslados, de cualquier tipo. Se actualiza solo mientras el Companion trabaja.</p>
          </div>
          <div className="vc-segmented" role="group" aria-label="Filtrar traslados">
            {(["all", "consolidate", "group", "tag"] as const).map((kind) => (
              <button key={kind} type="button" aria-pressed={jobFilter === kind} onClick={() => setJobFilter(kind)}>
                {kind === "all" ? "Todos" : kind === "consolidate" ? "Consolidar" : kind === "group" ? "Agrupar" : "Etiqueta"}
                <span className="vc-count-badge is-quiet">{formatCount(kind === "all" ? openJobs.length : openJobs.filter((job) => job.kind === kind).length)}</span>
              </button>
            ))}
          </div>
        </div>
        {renderJobs(jobFilter)}
      </section>



      {consolidating ? (
        <ConsolidateDialog
          destination={consolidating}
          sources={consolidating.namesakes.map((namesake) => ({ d: namesake.diskId, p: namesake.path }))}
          onCancel={() => setConsolidating(null)}
          onCreated={() => {
            setConsolidating(null);
            void reload();
            onChanged();
          }}
        />
      ) : null}

      {groupingDestinationId ? (
        <GroupSession
          destinationId={groupingDestinationId}
          onClose={() => {
            setGroupingDestinationId(null);
            void reload();
          }}
          onOpenTransfers={() => {
            setGroupingDestinationId(null);
            void reload();
          }}
          onChanged={onChanged}
        />
      ) : null}

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
