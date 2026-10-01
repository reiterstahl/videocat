import { useEffect, useMemo, useState, type CSSProperties } from "react";
import { ChevronRight, ExternalLink, FolderOpen, HardDrive } from "lucide-react";
import { formatBytes } from "@videocat/shared";
import { api } from "../lib/api";
import { formatCount } from "../lib/app-helpers";
import { squarify } from "../lib/treemap";

type FolderTreeNode = {
  name: string;
  path: string;
  sizeBytes: number;
  fileCount: number;
  childFolderCount: number;
  disks: Array<{ diskId: string; diskName: string; sizeBytes: number }>;
};

type FolderTreeLevel = {
  prefix: string;
  sizeBytes: number;
  fileCount: number;
  directFileCount: number;
  directBytes: number;
  children: FolderTreeNode[];
};

type UsageViewProps = {
  diskQuery: string;
  noDisksSelected: boolean;
  refreshKey: number;
  onOpenInCatalog: (folderPath: string) => void;
};

const treemapLimit = 24;

export function UsageView({ diskQuery, noDisksSelected, refreshKey, onOpenInCatalog }: UsageViewProps) {
  const [prefix, setPrefix] = useState("");
  const [level, setLevel] = useState<FolderTreeLevel | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (noDisksSelected) {
      setLevel(null);
      return;
    }
    let active = true;
    const params = new URLSearchParams();
    if (diskQuery) params.set("diskIds", diskQuery);
    if (prefix) params.set("prefix", prefix);
    setLoading(true);
    setError("");
    api<FolderTreeLevel>(`/api/folder-usage/tree?${params.toString()}`)
      .then((response) => {
        if (active) setLevel(response);
      })
      .catch((reason) => {
        if (active) setError(reason instanceof Error ? reason.message : "No se pudo calcular el esquema de uso.");
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [diskQuery, noDisksSelected, prefix, refreshKey]);

  const crumbs = prefix ? prefix.split("/") : [];
  const tiles = useMemo(() => squarify((level?.children ?? []).slice(0, treemapLimit), (node) => node.sizeBytes), [level]);
  const largest = level?.children[0]?.sizeBytes ?? 1;

  return (
    <section className="vc-view vc-usage" aria-label="Esquema de uso">
      <div className="vc-panel vc-usage-head">
        <nav className="vc-breadcrumbs" aria-label="Ubicación">
          <button className={crumbs.length === 0 ? "is-current" : ""} onClick={() => setPrefix("")} type="button">
            <HardDrive size={15} aria-hidden="true" />
            Discos seleccionados
          </button>
          {crumbs.map((crumb, index) => {
            const path = crumbs.slice(0, index + 1).join("/");
            return (
              <span className="vc-breadcrumb" key={path}>
                <ChevronRight size={14} aria-hidden="true" />
                <button className={index === crumbs.length - 1 ? "is-current" : ""} onClick={() => setPrefix(path)} type="button">
                  {crumb}
                </button>
              </span>
            );
          })}
        </nav>
        <div className="vc-usage-summary">
          <strong>{formatBytes(level?.sizeBytes ?? 0)}</strong>
          <span>{`${formatCount(level?.fileCount ?? 0)} videos`}</span>
          {prefix ? (
            <button className="vc-button is-small" onClick={() => onOpenInCatalog(prefix)} type="button">
              <ExternalLink size={14} />
              Ver en el catálogo
            </button>
          ) : null}
        </div>
      </div>

      {noDisksSelected ? <div className="empty">Selecciona al menos un disco para ver el esquema de uso.</div> : null}
      {error ? <div className="form-error">{error}</div> : null}
      {loading && !level ? <div className="loading">Cargando...</div> : null}

      {level && level.children.length > 0 ? (
        <>
          <div className={`vc-treemap ${loading ? "is-loading" : ""}`} role="list" aria-label="Carpetas por tamaño">
            {tiles.map((tile, index) => (
              <button
                key={tile.item.path}
                className={`vc-treemap-tile ${tile.width * tile.height < 30 ? "is-small" : ""}`}
                role="listitem"
                style={{
                  left: `${tile.x}%`,
                  top: `${tile.y}%`,
                  width: `${tile.width}%`,
                  height: `${tile.height}%`,
                  "--tile-strength": `${Math.max(14, 46 - index * 3)}%`
                } as CSSProperties}
                onClick={() => (tile.item.childFolderCount > 0 ? setPrefix(tile.item.path) : onOpenInCatalog(tile.item.path))}
                title={`${tile.item.path} · ${formatBytes(tile.item.sizeBytes)}`}
                type="button"
              >
                <strong>{tile.item.name}</strong>
                <span>{formatBytes(tile.item.sizeBytes)}</span>
              </button>
            ))}
          </div>

          <div className="vc-panel vc-usage-list">
            {level.children.map((node) => {
              const share = level.sizeBytes > 0 ? (node.sizeBytes / level.sizeBytes) * 100 : 0;
              return (
                <div className="vc-usage-row" key={node.path}>
                  <button
                    className="vc-usage-name"
                    disabled={node.childFolderCount === 0}
                    onClick={() => setPrefix(node.path)}
                    type="button"
                    title={node.childFolderCount > 0 ? "Explorar subcarpetas" : undefined}
                  >
                    <FolderOpen size={16} aria-hidden="true" />
                    <span>{node.name}</span>
                    {node.childFolderCount > 0 ? <small>{`${node.childFolderCount} subcarpetas`}</small> : null}
                  </button>
                  <div className="vc-usage-bar" aria-hidden="true">
                    <span style={{ width: `${(node.sizeBytes / largest) * 100}%` }} />
                  </div>
                  <span className="vc-usage-size">{formatBytes(node.sizeBytes)}</span>
                  <span className="vc-usage-share">{`${share.toFixed(1)}%`}</span>
                  <span className="vc-usage-files">{`${formatCount(node.fileCount)} videos`}</span>
                  <span className="vc-usage-disks">
                    {node.disks.slice(0, 3).map((disk) => (
                      <span key={disk.diskId} title={formatBytes(disk.sizeBytes)}>{disk.diskName}</span>
                    ))}
                    {node.disks.length > 3 ? <span>{`+${node.disks.length - 3}`}</span> : null}
                  </span>
                  <button className="vc-icon-button is-small is-ghost" onClick={() => onOpenInCatalog(node.path)} type="button" aria-label={`Ver ${node.name} en el catálogo`} title="Ver en el catálogo">
                    <ExternalLink size={15} />
                  </button>
                </div>
              );
            })}
            {level.directFileCount > 0 ? (
              <div className="vc-usage-direct">
                {`${formatCount(level.directFileCount)} videos directamente en esta carpeta · ${formatBytes(level.directBytes)}`}
              </div>
            ) : null}
          </div>
        </>
      ) : null}
      {level && level.children.length === 0 && !loading ? (
        <div className="empty">
          {level.fileCount > 0 ? "Esta carpeta no tiene subcarpetas con videos." : "No hay videos catalogados en los discos seleccionados."}
        </div>
      ) : null}
    </section>
  );
}
