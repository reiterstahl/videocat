import type { CSSProperties } from "react";
import {
  AlertTriangle,
  ChevronDown,
  ChevronRight,
  FolderOpen,
  HardDrive,
  Image,
  Lock,
  Pause,
  Play,
  RefreshCw,
  Search,
  Shuffle,
  Trash2,
  X
} from "lucide-react";
import { formatBytes } from "@videocat/shared";
import { CategoryBadges } from "../components/CategoryBadges";
import { TransferSpeedChart } from "../components/TransferSpeedChart";
import { dateLabel, downloadProgressPercent, downloadStatusLabel, mainThumbnail, transferEtaLabel } from "../lib/app-helpers";
import type {
  CurationCategory,
  DownloadQueueEntry,
  DownloadSpeedSample,
  DownloadSummaryResponse,
  VisibleFolder
} from "../lib/app-types";
import type { VideoFile } from "../types";

export type DownloadsViewProps = {
  locale: string;
  categories: CurationCategory[];
  summary: DownloadSummaryResponse | null;
  loading: boolean;
  actionBusy: boolean;
  pauseBusy: boolean;
  processing: boolean;
  message: string;
  companion: {
    online: boolean;
    localOnline: boolean;
    needsUpdate: boolean;
    connectedDiskCount: number;
    connectionMessage: string;
  };
  selectedDiskCount: number;
  transfer: {
    active: DownloadQueueEntry | null;
    percent: number;
    speedBytesPerSecond: number;
    speedSamples: DownloadSpeedSample[];
    fileEtaSeconds: number | null;
    queueEtaSeconds: number | null;
    fileRemainingBytes: number;
    pendingBytes: number;
  };
  random: {
    gigabytes: string;
    folders: string[];
    folderSearch: string;
    visibleFolders: VisibleFolder[];
  };
  selection: {
    ids: string[];
    idSet: Set<string>;
    removableCount: number;
    allRemovableSelected: boolean;
  };
  onProcess: () => void;
  onTogglePause: () => void;
  onRefresh: () => void;
  onClearQueue: () => void;
  onClearHistory: () => void;
  onRandomGigabytesChange: (value: string) => void;
  onQueueRandom: () => void;
  onRandomFoldersReset: () => void;
  onRandomFolderSearchChange: (value: string) => void;
  onToggleRandomFolder: (folder: string) => void;
  onToggleRandomFolderExpansion: (folder: string) => void;
  onToggleSelection: (entry: DownloadQueueEntry) => void;
  onToggleAllSelection: (checked: boolean) => void;
  onClearSelection: () => void;
  onRemoveSelected: () => void;
  onOpenFile: (file: VideoFile) => void;
};

function stateLabel(summary: DownloadSummaryResponse | null, active: DownloadQueueEntry | null): string {
  if (active) return "Transferencia activa";
  if (summary?.paused) return "Cola detenida";
  if ((summary?.counts.queued ?? 0) > 0) return "Lista para procesar";
  return "Sin transferencias pendientes";
}

export function DownloadsView(props: DownloadsViewProps) {
  const { locale, categories, summary, loading, actionBusy, pauseBusy, processing, message, companion, transfer, random, selection } = props;
  const active = transfer.active;
  const entries = summary?.entries ?? [];
  const counts = summary?.counts ?? {};
  const canProcess = !actionBusy && !processing && !summary?.paused && companion.online && props.selectedDiskCount > 0;
  const activeThumbnail = active ? mainThumbnail(active.file) : undefined;

  return (
    <section className="vc-view vc-downloads" aria-label="A descargar">
      {!companion.online ? (
        <div className="vc-status-banner is-danger">
          <AlertTriangle size={18} aria-hidden="true" />
          <div>
            <strong>{companion.localOnline ? "Companion sin sincronizar" : "Companion no iniciado"}</strong>
            <span>
              {companion.localOnline
                ? "El proceso local está abierto, pero no reporta a este servidor. Revisa SERVER_URL y la credencial del Companion."
                : "Abre el Companion de Windows para detectar discos y procesar esta cola."}
            </span>
          </div>
        </div>
      ) : companion.needsUpdate ? (
        <div className="vc-status-banner is-warning">
          <AlertTriangle size={18} aria-hidden="true" />
          <div>
            <strong>Actualización requerida</strong>
            <span>Instala la versión más reciente del Companion para reportar los discos conectados.</span>
          </div>
        </div>
      ) : companion.connectedDiskCount === 0 ? (
        <div className="vc-status-banner is-warning">
          <HardDrive size={18} aria-hidden="true" />
          <div>
            <strong>Sin discos conectados</strong>
            <span>{companion.connectionMessage}</span>
          </div>
        </div>
      ) : null}
      {summary?.paused ? (
        <div className="vc-status-banner is-warning">
          <Pause size={18} aria-hidden="true" />
          <div>
            <strong>Cola detenida</strong>
            <span>El Companion no tomará nuevas descargas hasta reanudarla. La descarga en curso termina primero.</span>
          </div>
        </div>
      ) : null}

      <div className="vc-downloads-top">
        <section className={`vc-panel vc-transfer ${active ? "is-active" : ""}`} aria-label="Transferencia">
          <div className="vc-transfer-head">
            <span className="vc-transfer-thumb">
              {activeThumbnail ? <img src={activeThumbnail} alt="" /> : <Image size={22} aria-hidden="true" />}
            </span>
            <div className="vc-transfer-file">
              <span className={`vc-transfer-state ${active ? "is-active" : ""}`}>
                <i aria-hidden="true" />
                {stateLabel(summary, active)}
              </span>
              <strong title={active?.file.filename}>{active?.file.filename ?? "VideoCAT Companion"}</strong>
              <span title={active?.file.relativePath}>
                {active
                  ? `${active.file.disk?.name ?? "-"} · ${active.file.relativePath}`
                  : (counts.queued ?? 0) > 0
                    ? "El Companion puede comenzar con el siguiente archivo."
                    : "Añade videos a la cola para comenzar una transferencia."}
              </span>
            </div>
            <strong className="vc-transfer-percent">{active ? `${transfer.percent}%` : "—"}</strong>
          </div>
          <div className="vc-transfer-bar" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={transfer.percent} aria-label="Progreso del archivo">
            <span style={{ width: `${transfer.percent}%` }} />
          </div>
          <div className="vc-transfer-caption">
            <span>{active ? `${formatBytes(active.progressBytes)} de ${formatBytes(active.file.sizeBytes)}` : "Sin archivo en curso"}</span>
            <span>{active ? `${formatBytes(Math.round(transfer.speedBytesPerSecond))}/s` : ""}</span>
          </div>
          <div className="vc-transfer-chart">
            <TransferSpeedChart samples={transfer.speedSamples} />
          </div>
          <dl className="vc-transfer-stats">
            <div><dt>ETA del archivo</dt><dd>{active ? transferEtaLabel(transfer.fileEtaSeconds) : "-"}</dd></div>
            <div><dt>ETA de la cola</dt><dd>{active ? transferEtaLabel(transfer.queueEtaSeconds) : "-"}</dd></div>
            <div><dt>En cola</dt><dd>{(counts.queued ?? 0).toLocaleString(locale)}</dd></div>
            <div><dt>Pendiente</dt><dd>{formatBytes(transfer.pendingBytes)}</dd></div>
            <div><dt>Descargados</dt><dd>{(counts.done ?? 0).toLocaleString(locale)}</dd></div>
            <div><dt>Fallidos</dt><dd>{(counts.failed ?? 0).toLocaleString(locale)}</dd></div>
          </dl>
        </section>

        <section className="vc-panel vc-random" aria-labelledby="random-download-title">
          <div className="vc-panel-head">
            <div>
              <h2 id="random-download-title"><Shuffle size={16} aria-hidden="true" /> Selección aleatoria</h2>
              <p>VideoCAT pone en cola videos al azar de los discos conectados hasta el tamaño elegido.</p>
            </div>
          </div>
          <div className="vc-panel-body">
            <div className="vc-random-row">
              <label className="vc-field">
                <span>GB aproximados</span>
                <input min="0.1" step="0.1" value={random.gigabytes} onChange={(event) => props.onRandomGigabytesChange(event.target.value)} type="number" />
              </label>
              <button className="vc-button is-primary" disabled={loading || !companion.online || props.selectedDiskCount === 0} onClick={props.onQueueRandom} type="button">
                <Shuffle size={16} />
                Elegir al azar
              </button>
            </div>
            <div className="vc-random-scope">
              <div className="vc-random-scope-head">
                <span>
                  {random.folders.length > 0
                    ? `${random.folders.length} carpeta(s) seleccionada(s).`
                    : "Sin selección se usarán todas las carpetas disponibles."}
                </span>
                {random.folders.length > 0 ? (
                  <button className="vc-link-button" onClick={props.onRandomFoldersReset} type="button">Usar todas</button>
                ) : null}
              </div>
              <div className="folder-search">
                <Search size={15} />
                <input value={random.folderSearch} onChange={(event) => props.onRandomFolderSearchChange(event.target.value)} placeholder="Buscar carpeta" />
                {random.folderSearch ? (
                  <button onClick={() => props.onRandomFolderSearchChange("")} type="button" title="Limpiar busqueda de carpetas">
                    <X size={14} />
                  </button>
                ) : null}
              </div>
              <div className="vc-random-folders">
                {random.visibleFolders.length > 0 ? random.visibleFolders.map((folder) => (
                  <div
                    key={folder.path}
                    className={`folder-option ${random.folders.includes(folder.path) ? "is-active" : ""}`}
                    style={{ "--folder-depth": folder.depth } as CSSProperties}
                    title={folder.path}
                  >
                    <button
                      className="folder-expander"
                      onClick={() => props.onToggleRandomFolderExpansion(folder.path)}
                      disabled={!folder.hasChildren}
                      type="button"
                      title={folder.isExpanded ? "Colapsar carpeta" : "Expandir carpeta"}
                    >
                      {folder.hasChildren ? folder.isExpanded ? <ChevronDown size={15} /> : <ChevronRight size={15} /> : null}
                    </button>
                    <button className="folder-select" onClick={() => props.onToggleRandomFolder(folder.path)} type="button">
                      {folder.locked ? <Lock size={15} /> : <FolderOpen size={15} />}
                      <span>{folder.label}</span>
                      <small>{folder.count}</small>
                    </button>
                  </div>
                )) : (
                  <div className="facet-empty">
                    {props.selectedDiskCount === 0
                      ? "Selecciona al menos un disco conectado."
                      : random.folderSearch
                        ? "Sin coincidencias de carpeta."
                        : "Sin carpetas para estos discos."}
                  </div>
                )}
              </div>
            </div>
          </div>
        </section>
      </div>

      {message ? <div className="vc-review-message" role="status">{message}</div> : null}

      <div className="vc-downloads-toolbar">
        <button className="vc-button is-primary" disabled={!canProcess} onClick={props.onProcess} type="button">
          <Play size={16} />
          Procesar cola
        </button>
        <button className="vc-button" disabled={pauseBusy} onClick={props.onTogglePause} type="button">
          {summary?.paused ? <Play size={16} /> : <Pause size={16} />}
          {summary?.paused ? "Reanudar" : "Detener"}
        </button>
        <button className="vc-icon-button" disabled={loading || actionBusy} onClick={props.onRefresh} type="button" aria-label="Actualizar" title="Actualizar">
          <RefreshCw size={16} />
        </button>
        <span className="vc-toolbar-spacer" />
        <button
          className="vc-button"
          disabled={actionBusy || processing || (counts.done ?? 0) === 0}
          onClick={props.onClearHistory}
          type="button"
          title="Quita de la lista las descargas completadas"
        >
          Limpiar completados
        </button>
        <button className="vc-button is-danger-ghost" disabled={actionBusy} onClick={props.onClearQueue} type="button">
          <Trash2 size={15} />
          Vaciar cola
        </button>
      </div>

      {selection.ids.length > 0 ? (
        <div className="bulk-actions download-bulk-actions">
          <strong>{`${selection.ids.length.toLocaleString(locale)} ${selection.ids.length === 1 ? "seleccionado" : "seleccionados"} en cola`}</strong>
          <span>Solo se pueden retirar pendientes o fallidos.</span>
          <button className="danger-button" disabled={actionBusy} onClick={props.onRemoveSelected} type="button">
            <Trash2 size={16} />
            Retirar de cola
          </button>
          <button className="ghost-button" disabled={actionBusy} onClick={props.onClearSelection} type="button">Limpiar</button>
        </div>
      ) : null}

      <section className="vc-panel vc-queue" aria-label="Cola de descarga">
        <div className="vc-queue-head">
          <label className="vc-switch">
            <input
              aria-label="Seleccionar cola retirable"
              checked={selection.allRemovableSelected}
              disabled={selection.removableCount === 0}
              onChange={(event) => props.onToggleAllSelection(event.target.checked)}
              type="checkbox"
            />
            <span>{`${entries.length.toLocaleString(locale)} en la lista`}</span>
          </label>
        </div>
        {entries.map((entry) => {
          const percent = downloadProgressPercent(entry);
          const removable = entry.status === "queued" || entry.status === "failed";
          const thumbnail = mainThumbnail(entry.file);
          return (
            <article className={`vc-queue-row is-${entry.status}`} key={entry.id}>
              <input
                aria-label={`Seleccionar ${entry.file.filename}`}
                checked={selection.idSet.has(entry.id)}
                disabled={!removable}
                onChange={() => props.onToggleSelection(entry)}
                type="checkbox"
              />
              <button className="vc-queue-open" onClick={() => props.onOpenFile(entry.file)} type="button">
                <span className="vc-queue-thumb">{thumbnail ? <img src={thumbnail} alt="" loading="lazy" /> : <Image size={18} aria-hidden="true" />}</span>
                <span className="vc-queue-main">
                  <strong>{entry.file.filename}</strong>
                  <span>{`${entry.file.disk?.name ?? "-"} · ${entry.file.relativePath}`}</span>
                </span>
              </button>
              <span className="vc-queue-size">{formatBytes(entry.file.sizeBytes)}</span>
              <span className="vc-queue-status">
                <span className={`download-status is-${entry.status}`}>{downloadStatusLabel(entry.status)}</span>
                {entry.status === "downloading" || entry.status === "done" ? (
                  <span className="vc-queue-progress" aria-label={`${percent}%`}><span style={{ width: `${percent}%` }} /></span>
                ) : null}
              </span>
              <span className="vc-queue-meta">
                <span>{dateLabel(entry.requestedAt, locale)}</span>
                {entry.errorMessage || entry.destinationPath || entry.downloadedTag ? (
                  <span className={entry.errorMessage ? "is-error" : ""} title={entry.errorMessage ?? entry.destinationPath ?? undefined}>
                    {entry.errorMessage ?? entry.destinationPath ?? entry.downloadedTag}
                  </span>
                ) : null}
              </span>
              <CategoryBadges file={entry.file} categories={categories} />
            </article>
          );
        })}
        {loading ? <div className="loading">Cargando...</div> : null}
        {!loading && entries.length === 0 ? <div className="empty">No hay archivos en la cola de descarga.</div> : null}
      </section>
    </section>
  );
}
