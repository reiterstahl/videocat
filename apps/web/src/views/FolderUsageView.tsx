import { type CSSProperties, useEffect, useMemo, useRef, useState } from "react";
import { ExternalLink, EyeOff, FolderTree, Layers, Search, Undo2 } from "lucide-react";
import { formatBytes } from "@videocat/shared";
import { api } from "../lib/api";
import { formatCount } from "../lib/app-helpers";
import { squarify } from "../lib/treemap";
import type { CatalogLocationScope, FolderGroupMap, FolderGroupNode, FolderGroupSummary } from "../types";

type FolderUsageViewProps = {
  diskQuery: string;
  noDisksSelected: boolean;
  refreshKey: number;
  onOpenLocations: (scope: CatalogLocationScope) => void;
};

type Tile = {
  node: FolderGroupNode;
  trail: FolderGroupNode[];
  x: number;
  y: number;
  width: number;
  height: number;
  depth: number;
  hue: number;
  labelled: boolean;
  parent: boolean;
};

const maxRoots = 80;
const maxDepth = 3;
const headerHeight = 20;
const inset = 2;

// Hues spread by the golden angle so neighbouring top-level folders never share a colour.
function hueFor(index: number): number {
  return Math.round((index * 137.508 + 24) % 360);
}

function layout(nodes: FolderGroupNode[], width: number, height: number): Tile[] {
  const tiles: Tile[] = [];
  const visit = (items: FolderGroupNode[], x: number, y: number, w: number, h: number, depth: number, trail: FolderGroupNode[], hue: number | null) => {
    squarify(items, (node) => node.sizeBytes, w, h).forEach((rect, index) => {
      const tileHue = hue ?? hueFor(index);
      const tile: Tile = {
        node: rect.item,
        trail: [...trail, rect.item],
        x: x + rect.x,
        y: y + rect.y,
        width: rect.width,
        height: rect.height,
        depth,
        hue: tileHue,
        labelled: rect.width > 64 && rect.height > 26,
        parent: false
      };
      tiles.push(tile);
      const children = rect.item.children;
      const roomy = rect.width > 70 && rect.height > headerHeight + 30;
      if (depth < maxDepth && children.length > 0 && roomy) {
        tile.parent = true;
        visit(children, tile.x + inset, tile.y + headerHeight, rect.width - inset * 2, rect.height - headerHeight - inset, depth + 1, tile.trail, tileHue);
      }
    });
  };
  visit(nodes, 0, 0, width, height, 1, [], null);
  return tiles;
}

function scopeFor(trail: FolderGroupNode[]): CatalogLocationScope | null {
  // Loose files and the "more folders" tile open their parent folder.
  const target = [...trail].reverse().find((node) => node.kind !== "rest" && node.kind !== "files" && node.locations.length > 0);
  if (!target) return null;
  return {
    label: trail.filter((node) => node.kind !== "files" && node.kind !== "rest").map((node) => node.name).join(" › ") || target.name,
    locations: target.locations.map((location) => ({ d: location.diskId, p: location.path }))
  };
}

function describe(node: FolderGroupNode): string {
  const places = node.locations.length;
  return `${formatBytes(node.sizeBytes)} · ${formatCount(node.fileCount)} videos${places > 1 ? ` · ${places} ubicaciones` : ""}`;
}

export function FolderUsageView({ diskQuery, noDisksSelected, refreshKey, onOpenLocations }: FolderUsageViewProps) {
  const [map, setMap] = useState<FolderGroupMap | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [hovered, setHovered] = useState<Tile | null>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });
  const [reloadKey, setReloadKey] = useState(0);
  const canvasRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (noDisksSelected) {
      setMap(null);
      return;
    }
    let active = true;
    const params = new URLSearchParams();
    if (diskQuery) params.set("diskIds", diskQuery);
    setLoading(true);
    setError("");
    api<FolderGroupMap>(`/api/folder-groups?${params.toString()}`)
      .then((response) => {
        if (active) setMap(response);
      })
      .catch((reason) => {
        if (active) setError(reason instanceof Error ? reason.message : "No se pudo calcular el uso por carpeta.");
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [diskQuery, noDisksSelected, refreshKey, reloadKey]);

  useEffect(() => {
    const element = canvasRef.current;
    if (!element) return;
    const observer = new ResizeObserver(([entry]) => setSize({ width: entry.contentRect.width, height: entry.contentRect.height }));
    observer.observe(element);
    return () => observer.disconnect();
  }, [map !== null]);

  const roots = useMemo(() => {
    if (!map) return [];
    const kept = map.roots.slice(0, maxRoots);
    const rest = map.roots.slice(maxRoots);
    if (rest.length === 0) return kept;
    return [...kept, {
      key: "#rest",
      name: `${rest.length} carpetas más`,
      kind: "rest" as const,
      sizeBytes: rest.reduce((sum, node) => sum + node.sizeBytes, 0),
      fileCount: rest.reduce((sum, node) => sum + node.fileCount, 0),
      locations: [],
      children: []
    }];
  }, [map]);

  const tiles = useMemo(() => (size.width > 0 && size.height > 0 ? layout(roots, size.width, size.height) : []), [roots, size]);

  const repeated = useMemo(() => {
    const term = search.trim().toLowerCase();
    return (map?.repeated ?? []).filter((group) => !term || group.name.toLowerCase().includes(term));
  }, [map, search]);
  const mergedCount = map?.repeated.filter((group) => !group.excluded).length ?? 0;

  async function saveExclusions(names: string[]) {
    setSaving(true);
    setError("");
    try {
      await api<{ excludedNames: string[] }>("/api/folder-groups/exclusions", { method: "PUT", body: JSON.stringify({ names }) });
      setReloadKey((value) => value + 1);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "No se pudo guardar la exclusión.");
    } finally {
      setSaving(false);
    }
  }

  function toggleExcluded(group: FolderGroupSummary) {
    const current = map?.excludedNames ?? [];
    const normalized = group.name.toLowerCase();
    void saveExclusions(group.excluded
      ? current.filter((name) => name.toLowerCase() !== normalized)
      : [...current, group.name]);
  }

  function openGroup(group: FolderGroupSummary) {
    if (group.locations.length === 0) return;
    onOpenLocations({ label: group.name, locations: group.locations.map((location) => ({ d: location.diskId, p: location.path })) });
  }

  return (
    <section className="vc-view vc-folders" aria-label="Uso por carpeta">
      <div className="vc-panel vc-folders-head">
        <div className="vc-folders-title">
          <Layers size={18} aria-hidden="true" />
          <div>
            <h2>Uso por carpeta</h2>
            <p>Las carpetas con el mismo nombre se muestran juntas, estén en el disco y en el nivel que estén. Haz clic en cualquier bloque para ver su contenido en el catálogo.</p>
          </div>
        </div>
        <div className="vc-usage-summary">
          <strong>{formatBytes(map?.sizeBytes ?? 0)}</strong>
          <span>{`${formatCount(map?.fileCount ?? 0)} videos`}</span>
          <span>{`${formatCount(mergedCount)} carpetas agrupadas`}</span>
        </div>
      </div>

      {noDisksSelected ? <div className="empty">Selecciona al menos un disco para ver el uso por carpeta.</div> : null}
      {error ? <div className="form-error" role="alert">{error}</div> : null}
      {loading && !map ? <div className="loading">Cargando...</div> : null}

      {map && !noDisksSelected ? (
        <div className="vc-folders-layout">
          <div className="vc-panel vc-folders-map">
            <div className={`vc-folders-canvas ${loading || saving ? "is-loading" : ""}`} ref={canvasRef} onMouseLeave={() => setHovered(null)}>
              {tiles.map((tile) => {
                const scope = tile.node.kind === "rest" ? null : scopeFor(tile.trail);
                const style = {
                  left: tile.x,
                  top: tile.y,
                  width: Math.max(0, tile.width - 1),
                  height: Math.max(0, tile.height - 1),
                  "--tile-hue": tile.hue,
                  "--tile-depth": tile.depth
                } as CSSProperties;
                return (
                  <button
                    key={tile.trail.map((node) => node.key).join(">")}
                    className={`vc-folder-tile is-depth-${tile.depth} is-${tile.node.kind} ${tile.parent ? "is-parent" : ""} ${hovered === tile ? "is-hovered" : ""}`}
                    style={style}
                    disabled={!scope}
                    onClick={(event) => {
                      event.stopPropagation();
                      if (scope) onOpenLocations(scope);
                    }}
                    onMouseEnter={() => setHovered(tile)}
                    onFocus={() => setHovered(tile)}
                    type="button"
                    aria-label={`${tile.trail.map((node) => node.name).join(" › ")}: ${describe(tile.node)}`}
                  >
                    {tile.labelled ? (
                      <span className="vc-folder-tile-label">
                        <strong>{tile.node.name}</strong>
                        <small>{formatBytes(tile.node.sizeBytes)}{tile.node.locations.length > 1 ? ` · ×${tile.node.locations.length}` : ""}</small>
                      </span>
                    ) : null}
                  </button>
                );
              })}
            </div>
            <div className="vc-folders-status" aria-live="polite">
              {hovered ? (
                <>
                  <strong>{hovered.trail.map((node) => node.name).join(" › ")}</strong>
                  <span>{describe(hovered.node)}</span>
                  {hovered.node.locations.length > 0 ? (
                    <span className="vc-folders-paths">
                      {hovered.node.locations.slice(0, 3).map((location) => `${location.diskName}: ${location.path}`).join("  ·  ")}
                      {hovered.node.locations.length > 3 ? `  ·  +${hovered.node.locations.length - 3}` : ""}
                    </span>
                  ) : null}
                </>
              ) : (
                <span>Pasa el cursor por un bloque para ver su ruta y sus ubicaciones.</span>
              )}
            </div>
          </div>

          <aside className="vc-panel vc-folders-groups" aria-label="Carpetas repetidas">
            <div className="vc-panel-head">
              <div>
                <h3><FolderTree size={16} aria-hidden="true" /> Carpetas repetidas</h3>
                <p>Excluye nombres genéricos (como RAW o 2019) para verlos por separado.</p>
              </div>
            </div>
            <label className="vc-folders-search">
              <Search size={15} aria-hidden="true" />
              <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Buscar carpeta" aria-label="Buscar carpeta repetida" />
            </label>
            {repeated.length === 0 ? (
              <p className="vc-folders-empty">{map.repeated.length === 0 ? "No hay carpetas con el mismo nombre en los discos seleccionados." : "Ninguna carpeta coincide con la búsqueda."}</p>
            ) : (
              <ul className="vc-folders-list">
                {repeated.map((group) => (
                  <li key={group.key} className={group.excluded ? "is-excluded" : ""}>
                    <div className="vc-folders-item-head">
                      <strong>{group.name}</strong>
                      <span>{group.excluded ? "Sin agrupar" : formatBytes(group.sizeBytes)}</span>
                    </div>
                    <ul className="vc-folders-locations">
                      {group.locations.map((location) => (
                        <li key={`${location.diskId}:${location.path}`}>
                          <span>{location.diskName}</span>
                          <code>{location.path}</code>
                          {location.sizeBytes > 0 ? <em>{formatBytes(location.sizeBytes)}</em> : null}
                        </li>
                      ))}
                    </ul>
                    <div className="vc-folders-actions">
                      {!group.excluded ? (
                        <button className="vc-button is-small" onClick={() => openGroup(group)} type="button">
                          <ExternalLink size={14} /> Ver en catálogo
                        </button>
                      ) : null}
                      <button className="vc-button is-small is-ghost" disabled={saving} onClick={() => toggleExcluded(group)} type="button">
                        {group.excluded ? <><Undo2 size={14} /> Agrupar de nuevo</> : <><EyeOff size={14} /> No agrupar</>}
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </aside>
        </div>
      ) : null}
    </section>
  );
}
