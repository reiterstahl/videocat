import { useCallback, useEffect, useRef, useState } from "react";
import { Activity, ArrowRight, ArrowRightLeft, Copy, Download, FolderSearch, ShieldCheck, Trash2, X } from "lucide-react";
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

type ActivityResponse = {
  companions: Array<{ companionId: string; companionName: string | null; activities: LiveActivity[]; reportedAt: number }>;
  waiting: { transfers: number; downloads: number };
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
  const busy = live.length > 0;

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
        {busy ? <span className="vc-button-label vc-activity-label">{buttonLabel}</span> : null}
      </button>

      {open ? (
        <section className="vc-theme-panel vc-activity-panel" role="dialog" aria-label="Actividad">
          <header className="vc-theme-panel-header">
            <strong>Actividad</strong>
            <button className="icon-button" onClick={() => setOpen(false)} type="button" title="Cerrar"><X size={16} /></button>
          </header>

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
