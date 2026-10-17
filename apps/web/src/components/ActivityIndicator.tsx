import { useCallback, useEffect, useRef, useState } from "react";
import { Activity, ArrowRight, ArrowRightLeft, Copy, Download, FolderSearch, Pause, Play, ShieldCheck, Trash2, X } from "lucide-react";
import { formatBytes } from "@videocat/shared";
import { api } from "../lib/api";
import { formatCount, transferEtaLabel } from "../lib/app-helpers";
import type { DownloadSpeedSample, ViewMode } from "../lib/app-types";
import { TransferSpeedChart } from "./TransferSpeedChart";

type LiveActivity = {
  kind: "transfer" | "download" | "scan" | "delete";
  phase: "staging" | "verifying_staging" | "delivering" | "verifying_target" | "downloading" | "scanning" | "deleting";
  filename?: string | null;
  from?: string | null;
  to?: string | null;
  bytesDone?: number | null;
  bytesTotal?: number | null;
  filesDone?: number | null;
  filesTotal?: number | null;
  bytesPerSecond?: number | null;
  startedAt: number;
};

type WorkAmount = { files: number; bytes: number };

type ConnectedDiskWork = {
  diskId: string;
  diskName: string;
  driveLetter: string | null;
  since: string;
  remaining: WorkAmount;
  outgoing: WorkAmount;
  incoming: WorkAmount;
  total: WorkAmount;
  blocked: WorkAmount;
  downloads: number;
  canDisconnect: boolean;
};

type ConnectedWork = { remaining: WorkAmount; total: WorkAmount; disks: ConnectedDiskWork[] };

type ActivityResponse = {
  companions: Array<{ companionId: string; companionName: string | null; activities: LiveActivity[]; reportedAt: number }>;
  waiting: { transfers: number; downloads: number };
  transfersWaitingForDownloads?: boolean;
  // "Detener traslados": a Companion to tell, what its transfers are doing, an order not acted on yet.
  transfers?: { live: boolean; mode: "running" | "stopping" | "stopped"; pending: "stop" | "resume" | null };
  connected?: ConnectedWork | null;
  recent: Array<{ kind: "transfer" | "duplicate" | "download" | "delete" | "scan"; label: string; detail: string | null; bytes: number | null; at: string }>;
};

const busyPollMs = 2000;
const idlePollMs = 15000;
const maxSamples = 60;

const phaseLabels: Record<LiveActivity["phase"], string> = {
  staging: "Copiando a la carpeta temporal",
  verifying_staging: "Verificando la copia temporal",
  delivering: "Copiando al destino",
  verifying_target: "Verificando en el destino",
  downloading: "Descargando",
  scanning: "Escaneando",
  deleting: "Borrando"
};

const shortLabels: Record<LiveActivity["phase"], string> = {
  staging: "Copiando",
  verifying_staging: "Verificando",
  delivering: "Copiando",
  verifying_target: "Verificando",
  downloading: "Descargando",
  scanning: "Escaneando",
  deleting: "Borrando"
};

const kindLabels: Record<LiveActivity["kind"], string> = {
  transfer: "Traslado",
  download: "Descarga",
  scan: "Escaneo",
  delete: "Borrado"
};

const recentLabels: Record<ActivityResponse["recent"][number]["kind"], string> = {
  transfer: "Trasladado",
  duplicate: "Ya estaba en el destino",
  download: "Descargado",
  delete: "Borrado",
  scan: "Escaneo terminado"
};

function KindIcon({ kind, size = 16 }: { kind: LiveActivity["kind"] | ActivityResponse["recent"][number]["kind"]; size?: number }) {
  if (kind === "transfer") return <ArrowRightLeft size={size} aria-hidden="true" />;
  if (kind === "duplicate") return <Copy size={size} aria-hidden="true" />;
  if (kind === "download") return <Download size={size} aria-hidden="true" />;
  if (kind === "delete") return <Trash2 size={size} aria-hidden="true" />;
  return <FolderSearch size={size} aria-hidden="true" />;
}

function percentOf(activity: LiveActivity): number | null {
  if (activity.bytesTotal && activity.bytesDone != null) return Math.min(100, Math.round((activity.bytesDone / activity.bytesTotal) * 100));
  if (activity.filesTotal && activity.filesDone != null) return Math.min(100, Math.round((activity.filesDone / activity.filesTotal) * 100));
  return null;
}

function timeAgo(value: string): string {
  const seconds = Math.max(0, Math.round((Date.now() - new Date(value).getTime()) / 1000));
  if (seconds < 60) return "hace un momento";
  if (seconds < 3600) return `hace ${Math.floor(seconds / 60)} min`;
  if (seconds < 86400) return `hace ${Math.floor(seconds / 3600)} h`;
  return `hace ${Math.floor(seconds / 86400)} d`;
}

function donePercent(work: { remaining: WorkAmount; total: WorkAmount }): number {
  if (work.total.bytes > 0) return Math.round(((work.total.bytes - work.remaining.bytes) / work.total.bytes) * 100);
  if (work.total.files > 0) return Math.round(((work.total.files - work.remaining.files) / work.total.files) * 100);
  return 100;
}

function files(count: number): string {
  return `${formatCount(count)} ${count === 1 ? "archivo" : "archivos"}`;
}

// What still holds a drive: files leaving it, files arriving and queued downloads.
function holdLabel(disk: ConnectedDiskWork): string {
  return [
    disk.outgoing.files > 0 ? `${files(disk.outgoing.files)} por salir` : null,
    disk.incoming.files > 0 ? `${files(disk.incoming.files)} por llegar` : null,
    disk.downloads > 0 ? `${formatCount(disk.downloads)} ${disk.downloads === 1 ? "descarga" : "descargas"} en cola` : null
  ].filter(Boolean).join(" · ");
}

// "Faltan x de y por mover" with the drives connected now: can a drive be unplugged yet?
function ConnectedWorkPanel({ work }: { work: ConnectedWork }) {
  const percent = donePercent(work);
  const pending = work.remaining.files > 0;
  return (
    <section className="vc-activity-connected" aria-label="Con los discos conectados">
      <div className="vc-activity-connected-head">
        <span className="vc-overline">Con los discos conectados</span>
        <strong>
          {work.total.files === 0
            ? "Nada por mover"
            : pending
              ? `Faltan ${formatCount(work.remaining.files)} de ${formatCount(work.total.files)} por mover`
              : `Listo: ${files(work.total.files)} ${work.total.files === 1 ? "movido" : "movidos"}`}
        </strong>
      </div>
      {work.total.files > 0 ? (
        <>
          <div className={`vc-transfer-bar ${pending ? "" : "is-done"}`} role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent} aria-label="Avance con los discos conectados">
            <span style={{ width: `${percent}%` }} />
          </div>
          <div className="vc-transfer-caption">
            <span>{pending ? `Faltan ${formatBytes(work.remaining.bytes)} de ${formatBytes(work.total.bytes)}` : formatBytes(work.total.bytes)}</span>
            <span>{`${percent} %`}</span>
          </div>
        </>
      ) : null}
      <ul className="vc-activity-drives">
        {work.disks.map((disk) => {
          const name = disk.driveLetter ? `${disk.diskName} (${disk.driveLetter})` : disk.diskName;
          const diskPercent = donePercent(disk);
          return (
            <li key={disk.diskId} className={disk.canDisconnect ? "is-ready" : "is-busy"}>
              <div className="vc-activity-drive-head">
                <strong title={name}>{name}</strong>
                <span className={`vc-badge ${disk.canDisconnect ? "is-success" : "is-warning"}`}>{disk.canDisconnect ? "Puedes desconectarlo" : "Espera"}</span>
              </div>
              {disk.total.files > 0 ? (
                <div className="vc-transfer-bar is-thin" aria-hidden="true"><span style={{ width: `${diskPercent}%` }} /></div>
              ) : null}
              <small>
                {disk.remaining.files > 0
                  ? `Faltan ${formatCount(disk.remaining.files)} de ${formatCount(disk.total.files)} · ${formatBytes(disk.remaining.bytes)} · ${holdLabel(disk)}`
                  : disk.downloads > 0
                    ? holdLabel(disk)
                    : disk.total.files > 0
                      ? `${files(disk.total.files)} ${disk.total.files === 1 ? "movido" : "movidos"} desde que se conectó`
                      : "Nada pendiente con este disco"}
              </small>
              {disk.blocked.files > 0 ? (
                <small className="vc-activity-drive-note">{`${files(disk.blocked.files)} esperan espacio en este disco; siguen seguros en la carpeta temporal.`}</small>
              ) : null}
            </li>
          );
        })}
      </ul>
    </section>
  );
}

function activityKey(companionId: string, activity: LiveActivity): string {
  return `${companionId}|${activity.kind}|${activity.phase}|${activity.filename ?? ""}`;
}

type ActivityIndicatorProps = {
  onNavigate: (view: ViewMode) => void;
};

// Discreet header indicator of what the Companions are doing; a click opens the live movement panel.
export function ActivityIndicator({ onNavigate }: ActivityIndicatorProps) {
  const [data, setData] = useState<ActivityResponse | null>(null);
  const [open, setOpen] = useState(false);
  const [samples, setSamples] = useState<Map<string, DownloadSpeedSample[]>>(new Map());
  const anchorRef = useRef<HTMLDivElement | null>(null);

  const live = data?.companions.flatMap((companion) => companion.activities.map((activity) => ({ companion, activity }))) ?? [];
  const control = data?.transfers;
  const [ordering, setOrdering] = useState(false);
  const busy = live.length > 0 || Boolean(control?.pending) || control?.mode === "stopping";

  const load = useCallback(async () => {
    try {
      const next = await api<ActivityResponse>("/api/activity");
      setData(next);
      setSamples((current) => {
        const updated = new Map<string, DownloadSpeedSample[]>();
        for (const companion of next.companions) {
          for (const activity of companion.activities) {
            const key = activityKey(companion.companionId, activity);
            const list = [...(current.get(key) ?? [])];
            if (activity.bytesPerSecond != null) list.push({ timestamp: Date.now(), bytesPerSecond: activity.bytesPerSecond });
            updated.set(key, list.slice(-maxSamples));
          }
        }
        return updated;
      });
    } catch {
      // The indicator is informative; it keeps its last state until the next poll.
    }
  }, []);

  useEffect(() => {
    void load();
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible") void load();
    }, busy || open ? busyPollMs : idlePollMs);
    return () => window.clearInterval(timer);
  }, [busy, load, open]);

  useEffect(() => {
    if (!open) return;
    function onPointer(event: PointerEvent) {
      if (anchorRef.current && !anchorRef.current.contains(event.target as Node)) setOpen(false);
    }
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }
    window.addEventListener("pointerdown", onPointer);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("pointerdown", onPointer);
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const first = live[0]?.activity;
  const firstPercent = first ? percentOf(first) : null;
  const buttonLabel = first
    ? `${shortLabels[first.phase]}${firstPercent != null ? ` ${firstPercent} %` : ""}${live.length > 1 ? ` · +${live.length - 1}` : ""}`
    : "";
  const title = first
    ? `${phaseLabels[first.phase]}${first.filename ? `: ${first.filename}` : ""}`
    : "Sin actividad en este momento";

  // Shown while a Companion is reporting and there are transfers to run, or transfers are stopped.
  const showControl = Boolean(control?.live) && ((data?.waiting.transfers ?? 0) > 0 || control?.mode !== "running" || Boolean(control?.pending));
  const stopping = control?.pending === "stop" || control?.mode === "stopping";
  const resuming = control?.pending === "resume";
  const stopped = control?.mode === "stopped" && !resuming;

  async function orderTransfers(order: "stop" | "resume") {
    setOrdering(true);
    try {
      const response = await api<{ transfers: ActivityResponse["transfers"] }>(`/api/transfers/companion/${order}`, { method: "POST", body: JSON.stringify({}) });
      setData((current) => (current ? { ...current, transfers: response.transfers } : current));
    } catch {
      // The next poll shows the real state.
    } finally {
      setOrdering(false);
    }
  }

  function go(view: ViewMode) {
    setOpen(false);
    onNavigate(view);
  }

  return (
    <div className="vc-activity-anchor" ref={anchorRef}>
      <button
        className={`vc-button vc-activity-button ${busy ? "is-busy" : ""}`}
        type="button"
        aria-expanded={open}
        aria-haspopup="dialog"
        onClick={() => setOpen((value) => !value)}
        title={title}
        aria-label={busy ? `Actividad: ${title}` : "Actividad"}
      >
        <span className="vc-activity-pulse" aria-hidden="true"><Activity size={16} /></span>
        {live.length > 0 ? <span className="vc-button-label vc-activity-label">{buttonLabel}</span> : null}
      </button>

      {showControl ? (
        <button
          className={`vc-icon-button vc-transfers-control ${stopped ? "is-stopped" : ""} ${stopping || resuming ? "is-pending" : ""}`}
          type="button"
          disabled={ordering || stopping || resuming}
          onClick={() => void orderTransfers(stopped ? "resume" : "stop")}
          title={stopping
            ? "Termina el archivo en curso y no empieza otro; las descargas siguen"
            : stopped
              ? "Los traslados vuelven a moverse con los discos conectados"
              : "Termina el archivo en curso y no empieza otro; las descargas siguen. Al reiniciar el Companion vuelven solos."}
          aria-label={stopping ? "Deteniendo traslados" : resuming ? "Reanudando traslados" : stopped ? "Reanudar traslados" : "Detener traslados"}
        >
          {stopped || resuming ? <Play size={18} aria-hidden="true" /> : <Pause size={18} aria-hidden="true" />}
        </button>
      ) : null}

      {open ? (
        <section className="vc-theme-panel vc-activity-panel" role="dialog" aria-label="Actividad">
          <header className="vc-theme-panel-header">
            <strong>Actividad</strong>
            <button className="icon-button" onClick={() => setOpen(false)} type="button" title="Cerrar"><X size={16} /></button>
          </header>

          {data?.connected ? <ConnectedWorkPanel work={data.connected} /> : null}

          {!busy ? (
            <p className="vc-activity-idle"><ShieldCheck size={16} aria-hidden="true" /> Sin actividad en este momento.</p>
          ) : (
            <ul className="vc-activity-live">
              {live.map(({ companion, activity }) => {
                const percent = percentOf(activity);
                const key = activityKey(companion.companionId, activity);
                const remaining = activity.bytesTotal != null && activity.bytesDone != null && activity.bytesPerSecond
                  ? (activity.bytesTotal - activity.bytesDone) / activity.bytesPerSecond
                  : null;
                return (
                  <li key={key} className={`vc-activity-card is-${activity.kind}`}>
                    <div className="vc-activity-card-head">
                      <span className="vc-transfer-state is-active"><i aria-hidden="true" />{`${kindLabels[activity.kind]} · ${phaseLabels[activity.phase]}`}</span>
                      {percent != null ? <strong className="vc-activity-percent">{`${percent} %`}</strong> : null}
                    </div>
                    {activity.filename ? <strong className="vc-activity-file" title={activity.filename}>{activity.filename}</strong> : null}
                    {activity.from || activity.to ? (
                      <span className="vc-activity-route">
                        {activity.from ? <span title={activity.from}>{activity.from}</span> : null}
                        {activity.from && activity.to ? <ArrowRight size={13} aria-hidden="true" /> : null}
                        {activity.to ? <span title={activity.to}>{activity.to}</span> : null}
                      </span>
                    ) : null}
                    {percent != null ? (
                      <div className="vc-transfer-bar" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent}>
                        <span style={{ width: `${percent}%` }} />
                      </div>
                    ) : null}
                    <div className="vc-transfer-caption">
                      <span>
                        {activity.bytesTotal != null
                          ? `${formatBytes(activity.bytesDone ?? 0)} de ${formatBytes(activity.bytesTotal)}`
                          : activity.filesDone != null
                            ? `${formatCount(activity.filesDone)}${activity.filesTotal ? ` de ${formatCount(activity.filesTotal)}` : ""} archivos`
                            : ""}
                      </span>
                      <span>
                        {activity.bytesPerSecond ? `${formatBytes(Math.round(activity.bytesPerSecond))}/s` : ""}
                        {remaining != null ? ` · ${transferEtaLabel(remaining)}` : ""}
                      </span>
                    </div>
                    {activity.bytesTotal != null ? (
                      <div className="vc-transfer-chart vc-activity-chart">
                        <TransferSpeedChart samples={samples.get(key) ?? []} />
                      </div>
                    ) : null}
                    {data && data.companions.length > 1 ? <span className="vc-activity-companion">{companion.companionName ?? "Companion"}</span> : null}
                  </li>
                );
              })}
            </ul>
          )}

          {control?.mode === "stopped" || stopping ? (
            <p className="vc-activity-yield" role="status">
              <Pause size={15} aria-hidden="true" />
              {stopping
                ? "Deteniendo traslados: termina el archivo en curso y no empieza otro. Las descargas siguen."
                : "Traslados detenidos. Las descargas siguen; vuelven con Reanudar o al reiniciar el Companion."}
            </p>
          ) : null}

          {data?.transfersWaitingForDownloads ? (
            <p className="vc-activity-yield" role="status">
              <Download size={15} aria-hidden="true" />
              Los traslados esperan: las descargas van primero y siguen al terminar la cola o al pausarla.
            </p>
          ) : null}

          {data && (data.waiting.transfers > 0 || data.waiting.downloads > 0) ? (
            <div className="vc-activity-waiting">
              {data.waiting.transfers > 0 ? (
                <button className="vc-link-button" onClick={() => go("transfers")} type="button">
                  <ArrowRightLeft size={14} aria-hidden="true" /> {`${formatCount(data.waiting.transfers)} en traslado`}
                </button>
              ) : null}
              {data.waiting.downloads > 0 ? (
                <button className="vc-link-button" onClick={() => go("downloads")} type="button">
                  <Download size={14} aria-hidden="true" /> {`${formatCount(data.waiting.downloads)} en cola de descarga`}
                </button>
              ) : null}
            </div>
          ) : null}

          {data && data.recent.length > 0 ? (
            <div className="vc-activity-recent">
              <span className="vc-overline">Últimos movimientos</span>
              <ul>
                {data.recent.map((entry, index) => (
                  <li key={`${entry.kind}-${entry.at}-${index}`}>
                    <span className={`vc-activity-recent-icon is-${entry.kind}`}><KindIcon kind={entry.kind} size={14} /></span>
                    <span className="vc-activity-recent-text">
                      <strong title={entry.label}>{entry.label || recentLabels[entry.kind]}</strong>
                      <small title={entry.detail ?? undefined}>{[recentLabels[entry.kind], entry.bytes != null ? formatBytes(entry.bytes) : null, timeAgo(entry.at)].filter(Boolean).join(" · ")}</small>
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </section>
      ) : null}
    </div>
  );
}
