import { useEffect, useRef, useState, type Dispatch, type SetStateAction } from "react";
import { Check, ChevronDown, ChevronRight, HardDrive } from "lucide-react";
import { formatBytes } from "@videocat/shared";
import { diskUsagePercent, formatCount } from "../lib/app-helpers";
import type { ViewMode } from "../lib/app-types";
import type { Disk, Stats } from "../types";

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

// Two flat rows once a single row no longer fits; the wheel scrolls the strip sideways.
function useDiskStrip(count: number) {
  const stripRef = useRef<HTMLDivElement | null>(null);
  const [width, setWidth] = useState(0);

  useEffect(() => {
    const strip = stripRef.current;
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
  }, []);

  const singleRowWidth = count * diskChipWidth + Math.max(0, count - 1) * diskStripGap;
  return { stripRef, twoRows: width > 0 && singleRowWidth > width };
}

export function CatalogContext({ companionLocalOnline, companionMountedDiskIds, companionNeedsUpdate, companionOnline, connectedMessage, connectedPanelCollapsed, detectingConnected, disks, downloadConnectionMessage, panelDisks, panelSelectedDiskIds, selectAllPanelDisks, selectNoPanelDisks, setConnectedPanelCollapsed, showMountedDisksFromCompanion, stats, switchView, togglePanelDisk, viewMode }: CatalogContextProps) {
  const { stripRef, twoRows } = useDiskStrip(panelDisks.length);
  return (
    <>
    <section className={`vc-disks ${connectedPanelCollapsed ? "is-collapsed" : ""}`} aria-label="Discos">
      <div className="vc-disks-heading">
        <HardDrive size={17} aria-hidden="true" />
        <strong>{viewMode === "downloads" ? "Discos para descargar" : "Discos"}</strong>
        <span className="vc-disks-count">{`${panelSelectedDiskIds.length} de ${panelDisks.length}`}</span>
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
          {viewMode === "downloads" ? (
            <div className={`vc-disks-message ${companionOnline && !companionNeedsUpdate ? "is-online" : companionLocalOnline || companionOnline ? "is-warning" : "is-offline"}`}>
              {downloadConnectionMessage}
            </div>
          ) : connectedMessage ? (
            <div className="vc-disks-message">{connectedMessage}</div>
          ) : null}
          <div className={`vc-disk-strip ${twoRows ? "is-two-rows" : ""}`} ref={stripRef}>
            {panelDisks.map((disk) => {
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
                  <span className="vc-disk-meta">
                    {[disk.driveLetter, disk.totalBytes ? formatBytes(disk.totalBytes) : null].filter(Boolean).join(" · ") || (mounted ? "Conectado" : "Sin datos")}
                  </span>
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

    <section className="vc-kpis" aria-label="Resumen del catálogo">
      <div className="vc-kpi">
        <span>Discos</span>
        <strong>{formatCount(stats?.diskCount ?? 0)}</strong>
      </div>
      <div className="vc-kpi">
        <span>Videos</span>
        <strong>{formatCount(stats?.fileCount ?? 0)}</strong>
      </div>
      <div className="vc-kpi">
        <span>Bytes catalogados</span>
        <strong>{formatBytes(stats?.totalBytes ?? 0)}</strong>
      </div>
      <div className="vc-kpi">
        <span>Duplicados probables</span>
        <strong>
          {formatCount(stats?.duplicateGroupCount ?? 0)}
          {(stats?.duplicateGroupCount ?? 0) > 0 ? (
            <button className="vc-kpi-link" type="button" onClick={() => switchView("duplicates")}>Revisar →</button>
          ) : null}
        </strong>
      </div>
    </section>
    </>
  );
}
