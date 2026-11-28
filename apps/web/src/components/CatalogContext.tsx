import { useEffect, useMemo, useRef, useState, type Dispatch, type ReactNode, type SetStateAction } from "react";
import { Check, ChevronDown, ChevronRight, ChevronUp, HardDrive, X } from "lucide-react";
import { useMediaQuery } from "../hooks/useMediaQuery";
import { formatBytes } from "@videocat/shared";
import { diskUsagePercent, formatCount } from "../lib/app-helpers";
import type { ViewMode } from "../lib/app-types";
import type { Disk, Stats } from "../types";
import { Skeleton, showsSkeletons } from "./Skeleton";

export type CatalogContextProps = {
  companionLocalOnline: boolean;
  companionMountedDiskIds: string[];
  companionNeedsUpdate: boolean;
  companionOnline: boolean;
  connectedMessage: string;
  connectedPanelCollapsed: boolean;
  detectingConnected: boolean;
  disks: Disk[];
  downloadConnectionMessage: string;
  panelDisks: Disk[];
  panelSelectedDiskIds: string[];
  selectAllPanelDisks: () => void;
  selectNoPanelDisks: () => void;
  setConnectedPanelCollapsed: Dispatch<SetStateAction<boolean>>;
  showMountedDisksFromCompanion: () => Promise<void>;
  stats: Stats | null;
  switchView: (mode: ViewMode) => void;
  togglePanelDisk: (diskId: string) => void;
  viewMode: ViewMode;
};

const diskChipWidth = 216;
const diskStripGap = 8;

// Two flat rows once a single row no longer fits; the wheel scrolls the strip sideways. The strip is
// held in state, so this attaches whenever it appears (after expanding the panel, or leaving the
// phone layout), not only when the page first draws.
function useDiskStrip(count: number) {
  const [strip, setStrip] = useState<HTMLDivElement | null>(null);
  const [width, setWidth] = useState(0);

  useEffect(() => {
    if (!strip) return;
    const observer = new ResizeObserver(([entry]) => setWidth(entry.contentRect.width));
    observer.observe(strip);
    const onWheel = (event: WheelEvent) => {
      if (event.ctrlKey || Math.abs(event.deltaX) >= Math.abs(event.deltaY)) return;
      const max = strip.scrollWidth - strip.clientWidth;
      if (max <= 0) return;
      const delta = event.deltaMode === 1 ? event.deltaY * 32 : event.deltaY;
      if ((delta < 0 && strip.scrollLeft <= 0) || (delta > 0 && strip.scrollLeft >= max - 1)) return;
      event.preventDefault();
      strip.scrollLeft += delta;
    };
    strip.addEventListener("wheel", onWheel, { passive: false });
    return () => {
      observer.disconnect();
      strip.removeEventListener("wheel", onWheel);
    };
  }, [strip]);

  const singleRowWidth = count * diskChipWidth + Math.max(0, count - 1) * diskStripGap;
  return { strip, stripRef: setStrip, twoRows: width > 0 && singleRowWidth > width };
}

// Two letters that stand for a disk in the phone summary: the first letter of its first two words
// ("Archivo Fotos" → AF), or its first two letters when it is one word.
export function diskInitials(name: string): string {
  const words = name.trim().split(/[\s_.-]+/).filter(Boolean);
  if (words.length === 0) return "?";
  const letters = words.length >= 2 ? [Array.from(words[0])[0], Array.from(words[1])[0]] : Array.from(words[0]).slice(0, 2);
  return letters.join("").toLocaleUpperCase();
}

function diskMeta(disk: Disk, mounted: boolean): string {
  if (disk.kind === "s3") return "Bucket S3";
  return [disk.driveLetter, disk.totalBytes ? formatBytes(disk.totalBytes) : null].filter(Boolean).join(" · ") || (mounted ? "Conectado" : "Sin datos");
}

export function CatalogContext({ companionLocalOnline, companionMountedDiskIds, companionNeedsUpdate, companionOnline, connectedMessage, connectedPanelCollapsed, detectingConnected, disks, downloadConnectionMessage, panelDisks, panelSelectedDiskIds, selectAllPanelDisks, selectNoPanelDisks, setConnectedPanelCollapsed, showMountedDisksFromCompanion, stats, switchView, togglePanelDisk, viewMode }: CatalogContextProps) {
  const { strip, stripRef, twoRows } = useDiskStrip(panelDisks.length);
  // Phones and small tablets: one summary line, and the disks in a sheet that rises from the bottom.
  const compact = useMediaQuery("(max-width: 900px)");
  // Connected drives go first (each group keeps its order), so they are in view without scrolling.
  const orderedDisks = useMemo(() => {
    const mounted = new Set(companionMountedDiskIds);
    return [...panelDisks.filter((disk) => mounted.has(disk.id)), ...panelDisks.filter((disk) => !mounted.has(disk.id))];
  }, [companionMountedDiskIds, panelDisks]);
  const mountedKey = companionMountedDiskIds.join(",");
  useEffect(() => {
    if (strip) strip.scrollLeft = 0;
  }, [mountedKey, strip]);
  // Inside the app, until the first numbers arrive: grey shapes instead of zeros.
  const waiting = stats === null && showsSkeletons();

  const title = viewMode === "downloads" ? "Discos para descargar" : "Discos";
  const connectionMessage = viewMode === "downloads" ? (
    <div className={`vc-disks-message ${companionOnline && !companionNeedsUpdate ? "is-online" : companionLocalOnline || companionOnline ? "is-warning" : "is-offline"}`}>
      {downloadConnectionMessage}
    </div>
  ) : null;

  return (
    <>
    {compact ? (
      <CompactDisks
        companionMountedDiskIds={companionMountedDiskIds}
        connectedMessage={connectedMessage}
        connectionMessage={connectionMessage}
        detectingConnected={detectingConnected}
        disks={orderedDisks}
        selectAll={selectAllPanelDisks}
        selectNone={selectNoPanelDisks}
        selectedDiskIds={panelSelectedDiskIds}
        showConnected={viewMode !== "downloads" ? showMountedDisksFromCompanion : null}
        title={title}
        toggle={togglePanelDisk}
        waiting={waiting}
      />
    ) : (
    <section className={`vc-disks ${connectedPanelCollapsed ? "is-collapsed" : ""}`} aria-label="Discos">
      <div className="vc-disks-heading">
        <HardDrive size={17} aria-hidden="true" />
        <strong>{title}</strong>
        {waiting && panelDisks.length === 0 ? <Skeleton className="vc-skel-count" /> : <span className="vc-disks-count">{`${panelSelectedDiskIds.length} de ${panelDisks.length}`}</span>}
        {!connectedPanelCollapsed ? (
          <div className="vc-disks-actions">
            {viewMode !== "downloads" ? (
              <button
                className="vc-chip-button is-primary"
                disabled={detectingConnected}
                onClick={() => void showMountedDisksFromCompanion()}
                type="button"
              >
                {detectingConnected ? "Detectando..." : "Mostrar conectados"}
              </button>
            ) : null}
            <button
              className="vc-chip-button"
              disabled={panelDisks.length === 0 || panelSelectedDiskIds.length === panelDisks.length}
              onClick={selectAllPanelDisks}
              type="button"
            >
              Todos
            </button>
            <button
              className="vc-chip-button"
              disabled={panelSelectedDiskIds.length === 0}
              onClick={selectNoPanelDisks}
              type="button"
            >
              Ninguno
            </button>
          </div>
        ) : null}
        <button
          className="vc-icon-button is-ghost is-small"
          onClick={() => setConnectedPanelCollapsed((current) => !current)}
          type="button"
          title={connectedPanelCollapsed ? "Expandir discos conectados" : "Colapsar discos conectados"}
          aria-label={connectedPanelCollapsed ? "Expandir discos conectados" : "Colapsar discos conectados"}
          aria-expanded={!connectedPanelCollapsed}
        >
          {connectedPanelCollapsed ? <ChevronRight size={17} /> : <ChevronDown size={17} />}
        </button>
      </div>
      {!connectedPanelCollapsed ? (
        <>
          {connectionMessage ?? (connectedMessage ? (
            <div className="vc-disks-message">{connectedMessage}</div>
          ) : null)}
          <div className={`vc-disk-strip ${twoRows ? "is-two-rows" : ""}`} ref={stripRef}>
            {waiting && panelDisks.length === 0 ? [0, 1].map((index) => <Skeleton key={index} className="vc-skel-chip" />) : null}
            {orderedDisks.map((disk) => {
              const active = panelSelectedDiskIds.includes(disk.id);
              const mounted = companionMountedDiskIds.includes(disk.id);
              const usage = diskUsagePercent(disk);
              return (
                <button
                  key={disk.id}
                  className={`vc-disk-chip ${active ? "is-active" : ""}`}
                  aria-pressed={active}
                  title={disk.name}
                  onClick={() => togglePanelDisk(disk.id)}
                  type="button"
                >
                  <span className={`vc-disk-dot ${mounted ? "is-mounted" : ""}`} title={mounted ? "Conectado al Companion" : "No detectado por el Companion"} />
                  <span className="vc-disk-name">{disk.name}</span>
                  <span className="vc-disk-meta">{diskMeta(disk, mounted)}</span>
                  {usage !== null ? (
                    <>
                      <span className={`vc-disk-percent ${usage >= 85 ? "is-high" : ""}`} title={`${usage}% usado`}>{`${usage}%`}</span>
                      <span className="vc-disk-bar" aria-hidden="true"><span className={usage >= 85 ? "is-high" : ""} style={{ width: `${usage}%` }} /></span>
                    </>
                  ) : null}
                  {active ? <Check className="vc-disk-check" size={15} aria-hidden="true" /> : null}
                </button>
              );
            })}
          </div>
        </>
      ) : null}
    </section>
    )}

    <section className="vc-kpis" aria-label="Resumen del catálogo">
      <div className="vc-kpi">
        <span>Discos</span>
        <strong>{waiting ? <Skeleton className="vc-skel-number" /> : formatCount(stats?.diskCount ?? 0)}</strong>
      </div>
      <div className="vc-kpi">
        <span>Videos</span>
        <strong>{waiting ? <Skeleton className="vc-skel-number" /> : formatCount(stats?.fileCount ?? 0)}</strong>
      </div>
      <div className="vc-kpi">
        <span>Bytes catalogados</span>
        <strong>{waiting ? <Skeleton className="vc-skel-number" /> : formatBytes(stats?.totalBytes ?? 0)}</strong>
      </div>
      <div className="vc-kpi">
        <span>Duplicados probables</span>
        <strong>
          {waiting ? <Skeleton className="vc-skel-number" /> : formatCount(stats?.duplicateGroupCount ?? 0)}
          {(stats?.pendingDuplicateGroupCount ?? 0) > 0 ? (
            <button className="vc-kpi-link" type="button" onClick={() => switchView("duplicates")}>Revisar →</button>
          ) : null}
        </strong>
      </div>
    </section>
    </>
  );
}

type CompactDisksProps = {
  companionMountedDiskIds: string[];
  connectedMessage: string;
  connectionMessage: ReactNode;
  detectingConnected: boolean;
  disks: Disk[];
  selectAll: () => void;
  selectNone: () => void;
  selectedDiskIds: string[];
  showConnected: (() => Promise<void>) | null;
  title: string;
  toggle: (diskId: string) => void;
  waiting: boolean;
};

// The phone version of the disks panel: which disks are in, on one line, and «Elegir» to change them
// in a list that rises from the bottom, so the disks never scroll sideways.
function CompactDisks({ companionMountedDiskIds, connectedMessage, connectionMessage, detectingConnected, disks, selectAll, selectNone, selectedDiskIds, showConnected, title, toggle, waiting }: CompactDisksProps) {
  const [open, setOpen] = useState(false);
  const openButton = useRef<HTMLButtonElement | null>(null);
  const closeButton = useRef<HTMLButtonElement | null>(null);
  const selected = disks.filter((disk) => selectedDiskIds.includes(disk.id));
  const count = `${selected.length} de ${disks.length}`;
  const loading = waiting && disks.length === 0;

  useEffect(() => {
    if (!open) return;
    closeButton.current?.focus();
    const opener = openButton.current;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      opener?.focus();
    };
  }, [open]);

  const summary = selected.length === 0 ? "Ningún disco elegido" : selected.length === disks.length ? "Todos los discos" : selected.map((disk) => disk.name).join(", ");
  const done = showConnected === null || selected.length === 0 ? "Listo" : `Ver ${selected.length} ${selected.length === 1 ? "disco" : "discos"}`;

  return (
    <section className="vc-disks is-compact" aria-label="Discos">
      <div className="vc-disks-heading">
        <HardDrive size={17} aria-hidden="true" />
        <strong>{title}</strong>
        {loading ? <Skeleton className="vc-skel-count" /> : <span className="vc-disks-count">{count}</span>}
        <button
          className="vc-disks-open"
          disabled={loading}
          onClick={() => setOpen(true)}
          ref={openButton}
          type="button"
          aria-haspopup="dialog"
          aria-expanded={open}
          aria-label={`Elegir ${title.toLowerCase()}`}
        >
          <span>Elegir</span>
          <ChevronUp size={15} aria-hidden="true" />
        </button>
      </div>
      {connectionMessage}
      {loading ? (
        <div className="vc-disks-summary" aria-hidden="true">
          <Skeleton className="vc-skel-dots" />
          <Skeleton className="vc-skel-line" />
        </div>
      ) : disks.length > 0 ? (
        <div className="vc-disks-summary">
          <span className="vc-disk-initials" aria-hidden="true">
            {selected.length === 0 ? <span>0</span> : null}
            {selected.slice(0, 3).map((disk) => <span key={disk.id} className="is-active">{diskInitials(disk.name)}</span>)}
            {selected.length > 3 ? <span>{`+${selected.length - 3}`}</span> : null}
          </span>
          <span className="vc-disks-summary-text">{summary}</span>
        </div>
      ) : null}

      {open ? (
        <>
          <button className="vc-sheet-scrim" type="button" aria-label="Cerrar discos" onClick={() => setOpen(false)} />
          <div className="vc-sheet vc-disk-sheet" role="dialog" aria-modal="true" aria-label={title}>
            <div className="vc-disk-sheet-top">
              <span className="vc-sheet-handle" aria-hidden="true" />
              <div className="vc-disks-heading">
                <HardDrive size={17} aria-hidden="true" />
                <strong>{title}</strong>
                <span className="vc-disks-count">{count}</span>
                <button className="vc-icon-button is-ghost is-small vc-sheet-close" onClick={() => setOpen(false)} ref={closeButton} type="button" aria-label="Cerrar" title="Cerrar">
                  <X size={17} />
                </button>
              </div>
              <div className="vc-disks-actions">
                {showConnected ? (
                  <button className="vc-chip-button is-primary" disabled={detectingConnected} onClick={() => void showConnected()} type="button">
                    {detectingConnected ? "Detectando..." : "Mostrar conectados"}
                  </button>
                ) : null}
                <button className="vc-chip-button" disabled={disks.length === 0 || selected.length === disks.length} onClick={selectAll} type="button">Todos</button>
                <button className="vc-chip-button" disabled={selected.length === 0} onClick={selectNone} type="button">Ninguno</button>
              </div>
              {showConnected && connectedMessage ? <div className="vc-disks-message">{connectedMessage}</div> : null}
            </div>
            <div className="vc-disk-list">
              {disks.map((disk) => {
                const active = selectedDiskIds.includes(disk.id);
                const mounted = companionMountedDiskIds.includes(disk.id);
                const usage = diskUsagePercent(disk);
                const high = usage !== null && usage >= 85;
                return (
                  <button key={disk.id} className={`vc-disk-row ${active ? "is-active" : ""}`} aria-pressed={active} onClick={() => toggle(disk.id)} type="button">
                    <span className="vc-disk-row-check" aria-hidden="true">{active ? <Check size={13} strokeWidth={3} /> : null}</span>
                    <span className="vc-disk-row-name">
                      <span className={`vc-disk-dot ${mounted ? "is-mounted" : ""}`} title={mounted ? "Conectado al Companion" : "No detectado por el Companion"} />
                      <span>{disk.name}</span>
                    </span>
                    <span className="vc-disk-row-meta">{diskMeta(disk, mounted)}</span>
                    {usage !== null ? <span className={`vc-disk-row-percent ${high ? "is-high" : ""}`}>{`${usage}%`}</span> : null}
                    <span className="vc-disk-row-bar" aria-hidden="true">{usage !== null ? <span className={high ? "is-high" : ""} style={{ width: `${usage}%` }} /> : null}</span>
                  </button>
                );
              })}
            </div>
            <div className="vc-sheet-footer">
              <button className="vc-button is-primary" onClick={() => setOpen(false)} type="button">{done}</button>
            </div>
          </div>
        </>
      ) : null}
    </section>
  );
}
