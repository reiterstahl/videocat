import { type CSSProperties, useEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle, ArrowUp, ChevronRight, ExternalLink, EyeOff, FolderInput, FolderSearch, FolderTree, Heart, Image as ImageIcon, Layers, Search, Star, Undo2, X } from "lucide-react";
import { formatBytes } from "@videocat/shared";
import { api } from "../lib/api";
import { transferError } from "../lib/transfers";
import { formatCount, mainThumbnail } from "../lib/app-helpers";
import { squarify } from "../lib/treemap";
import { filterFolderNodes, matchesSearch, searchKey } from "../lib/folder-search";
import { ConsolidateDialog } from "../components/ConsolidateDialog";
import { GroupSession } from "../components/GroupSession";
import type { CatalogLocationScope, FolderFavorite, FolderGroupLocation, FolderGroupMap, FolderGroupNode, FolderGroupSummary, TransferDestination, VideoFile } from "../types";

type FolderFilesView = { files: VideoFile[]; total: number; totalBytes: number };

type FolderMenu = { x: number; y: number; title: string; locations: FolderGroupLocation[]; scope: CatalogLocationScope | null };

function cleanPath(path: string): string {
  return path.replace(/\\/g, "/").replace(/^\/+|\/+$/g, "");
}

// "exact": this folder is a favourite; "inherited": it is inside one (protected, but not removable here).
function favoriteState(location: { diskId: string; path: string }, favorites: readonly FolderFavorite[]): "exact" | "inherited" | null {
  const path = cleanPath(location.path).toLowerCase();
  let state: "exact" | "inherited" | null = null;
  for (const favorite of favorites) {
    if (favorite.diskId !== location.diskId) continue;
    const favoritePath = cleanPath(favorite.path).toLowerCase();
    if (favoritePath === path) return "exact";
    if (path.startsWith(`${favoritePath}/`)) state = "inherited";
  }
  return state;
}

type FolderUsageViewProps = {
  diskQuery: string;
  noDisksSelected: boolean;
  refreshKey: number;
  onOpenLocations: (scope: CatalogLocationScope) => void;
  onTransferCreated: () => void;
  onTransfersChanged: () => void;
  onOpenFile: (file: VideoFile) => void;
};

type ConsolidateRequest = {
  destination: TransferDestination;
  sources: Array<{ d: string; p: string }>;
};

function samePlace(destination: TransferDestination, location: FolderGroupLocation): boolean {
  return destination.diskId === location.diskId && destination.path.toLowerCase() === location.path.replace(/\\/g, "/").replace(/^\/+|\/+$/g, "").toLowerCase();
}

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

function locationsOf(node: FolderGroupNode): Array<{ d: string; p: string }> {
  return node.locations.map((location) => ({ d: location.diskId, p: location.path }));
}

function exploreKey(node: FolderGroupNode): string {
  return `${node.key}|${node.locations.map((location) => `${location.diskId}:${location.path}`).join(",")}`;
}

export function FolderUsageView({ diskQuery, noDisksSelected, refreshKey, onOpenLocations, onTransferCreated, onTransfersChanged, onOpenFile }: FolderUsageViewProps) {
  const [map, setMap] = useState<FolderGroupMap | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  // Instant search on the map: blocks that do not match leave and the rest grow to fill.
  const [mapSearch, setMapSearch] = useState("");
  const mapSearchRef = useRef<HTMLInputElement | null>(null);
  const [hovered, setHovered] = useState<Tile | null>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });
  const [reloadKey, setReloadKey] = useState(0);
  const canvasRef = useRef<HTMLDivElement | null>(null);
  const [destinations, setDestinations] = useState<TransferDestination[]>([]);
  const [consolidating, setConsolidating] = useState<ConsolidateRequest | null>(null);
  const [favorites, setFavorites] = useState<FolderFavorite[]>([]);
  const [menu, setMenu] = useState<FolderMenu | null>(null);
  const [notice, setNotice] = useState("");
  const [groupingId, setGroupingId] = useState<string | null>(null);
  // Exploration: the folders entered from the overview, and what each level shows.
  const [trail, setTrail] = useState<FolderGroupNode[]>([]);
  const [subtrees, setSubtrees] = useState<Map<string, FolderGroupNode>>(new Map());
  const [folderFiles, setFolderFiles] = useState<Map<string, FolderFilesView>>(new Map());

  useEffect(() => {
    let active = true;
    api<{ destinations: TransferDestination[] }>("/api/transfers/destinations")
      .then((response) => {
        if (active) setDestinations(response.destinations);
      })
      .catch(() => undefined);
    api<{ favorites: FolderFavorite[] }>("/api/folder-favorites")
      .then((response) => {
        if (active) setFavorites(response.favorites);
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, [refreshKey, reloadKey]);

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
        if (!active) return;
        setMap(response);
        setTrail([]);
        setSubtrees(new Map());
        setFolderFiles(new Map());
      })
      .catch((reason) => {
        if (active) setError(transferError(reason, "No se pudo calcular el uso por carpeta."));
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

  const mapTerm = searchKey(mapSearch);
  const roots = useMemo(() => {
    if (!map) return [];
    // While searching, every top-level folder takes part (not only the largest ones).
    const all = mapTerm ? filterFolderNodes(map.roots, mapTerm).nodes : map.roots;
    const kept = all.slice(0, maxRoots);
    const rest = all.slice(maxRoots);
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
  }, [map, mapTerm]);

  const focus = trail.at(-1) ?? null;
  const focusTree = focus ? subtrees.get(exploreKey(focus)) ?? null : null;
  // The last level shows videos: a "loose files" block, or a folder without subfolders.
  const showsFiles = Boolean(focus && (focus.kind === "files" || (focusTree && !focusTree.children.some((child) => child.kind !== "files"))));
  const filesView = focus && showsFiles ? folderFiles.get(exploreKey(focus)) ?? null : null;
  const searchView = useMemo(
    () => filterFolderNodes(focus ? (showsFiles ? [] : focusTree?.children ?? []) : (map?.roots ?? []), mapTerm),
    [focus, focusTree, map, mapTerm, showsFiles]
  );
  const levelNodes = focus ? searchView.nodes : roots;
  const exploring = Boolean(focus && ((focus.kind !== "files" && !focusTree) || (showsFiles && !filesView)));

  useEffect(() => {
    if (!focus) return;
    const key = exploreKey(focus);
    if (focus.kind !== "files" && !subtrees.has(key)) {
      let active = true;
      api<{ node: FolderGroupNode }>("/api/folder-groups/subtree", { method: "POST", body: JSON.stringify({ key: focus.key, locations: locationsOf(focus) }) })
        .then((response) => {
          if (active) setSubtrees((current) => new Map(current).set(key, response.node));
        })
        .catch((reason) => {
          if (active) setError(transferError(reason, "No se pudo abrir la carpeta."));
        });
      return () => {
        active = false;
      };
    }
    if (showsFiles && !folderFiles.has(key)) {
      let active = true;
      api<FolderFilesView>("/api/folder-groups/files", { method: "POST", body: JSON.stringify({ locations: locationsOf(focus), direct: true }) })
        .then((response) => {
          if (active) setFolderFiles((current) => new Map(current).set(key, response));
        })
        .catch((reason) => {
          if (active) setError(transferError(reason, "No se pudieron cargar los videos de la carpeta."));
        });
      return () => {
        active = false;
      };
    }
    return undefined;
  }, [focus, folderFiles, showsFiles, subtrees]);

  const tiles = useMemo(() => (size.width > 0 && size.height > 0 ? layout(levelNodes, size.width, size.height) : []), [levelNodes, size]);
  const shownFiles = useMemo(
    () => (filesView ? filesView.files.filter((file) => matchesSearch(file.filename, mapTerm)) : []),
    [filesView, mapTerm]
  );
  const fileTiles = useMemo(() => (
    filesView && size.width > 0 && size.height > 0
      ? squarify(shownFiles, (file) => Math.max(1, file.sizeBytes), size.width, size.height)
      : []
  ), [filesView, shownFiles, size]);
  const matchCount = filesView ? shownFiles.length : searchView.matches.size;

  function enter(tile: Tile) {
    if (tile.node.kind === "rest") return;
    // Entering a nested block goes through its parents, so the trail stays complete.
    // Folders cut down by the search are entered whole.
    const steps = tile.trail.filter((node) => node.kind !== "rest").map((node) => searchView.originals.get(node) ?? node);
    setHovered(null);
    setTrail((current) => [...current, ...steps]);
  }

  function goTo(level: number) {
    setHovered(null);
    setTrail((current) => current.slice(0, level));
  }

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      const target = event.target as HTMLElement | null;
      if (event.key === "/" && !target?.closest("input, textarea, select, [contenteditable]")) {
        event.preventDefault();
        mapSearchRef.current?.focus();
        return;
      }
      if (event.key !== "Backspace" || !trail.length || target?.closest("input, textarea, select, [contenteditable]")) return;
      event.preventDefault();
      goTo(trail.length - 1);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [trail.length]);

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
      setError(transferError(reason, "No se pudo guardar la exclusión."));
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

  useEffect(() => {
    if (!menu) return;
    const close = () => setMenu(null);
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") close();
    }
    window.addEventListener("pointerdown", close);
    window.addEventListener("keydown", onKey);
    window.addEventListener("scroll", close, true);
    window.addEventListener("resize", close);
    return () => {
      window.removeEventListener("pointerdown", close);
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("scroll", close, true);
      window.removeEventListener("resize", close);
    };
  }, [menu]);

  // Adds every location as a favourite, or removes the ones that already are.
  async function toggleFavorite(locations: FolderGroupLocation[]) {
    const exact = locations.filter((location) => favoriteState(location, favorites) === "exact");
    const payload = { locations: (exact.length > 0 ? exact : locations).map((location) => ({ d: location.diskId, p: location.path })) };
    setMenu(null);
    setSaving(true);
    setError("");
    setNotice("");
    try {
      if (exact.length > 0) {
        await api("/api/folder-favorites/remove", { method: "POST", body: JSON.stringify(payload) });
        setNotice("Carpeta quitada de favoritas: sus videos vuelven a poder moverse.");
      } else {
        const result = await api<{ cancelledPending: number }>("/api/folder-favorites", { method: "POST", body: JSON.stringify(payload) });
        setNotice(result.cancelledPending > 0
          ? `Carpeta favorita: sus videos ya no se mueven. ${result.cancelledPending} ${result.cancelledPending === 1 ? "archivo salió" : "archivos salieron"} de traslados que aún no habían empezado.`
          : "Carpeta favorita: sus videos ya no se ofrecen para moverse a otra carpeta.");
      }
      const response = await api<{ favorites: FolderFavorite[] }>("/api/folder-favorites");
      setFavorites(response.favorites);
    } catch (reason) {
      setError(transferError(reason, "No se pudo cambiar la carpeta favorita."));
    } finally {
      setSaving(false);
    }
  }

  function starredIn(location: FolderGroupLocation): TransferDestination | undefined {
    return destinations.find((destination) => samePlace(destination, location));
  }

  async function toggleStar(location: FolderGroupLocation) {
    const current = starredIn(location);
    setSaving(true);
    setError("");
    try {
      if (current) {
        await api(`/api/transfers/destinations/${current.id}`, { method: "DELETE" });
        setDestinations((list) => list.filter((destination) => destination.id !== current.id));
      } else {
        await api("/api/transfers/destinations", { method: "POST", body: JSON.stringify({ diskId: location.diskId, path: location.path }) });
        const response = await api<{ destinations: TransferDestination[] }>("/api/transfers/destinations");
        setDestinations(response.destinations);
      }
    } catch (reason) {
      setError(transferError(reason, "No se pudo cambiar la carpeta destino."));
    } finally {
      setSaving(false);
    }
  }

  function consolidateInto(group: FolderGroupSummary, location: FolderGroupLocation) {
    const destination = starredIn(location);
    if (!destination) return;
    setConsolidating({
      destination,
      sources: group.locations.filter((other) => other !== location).map((other) => ({ d: other.diskId, p: other.path }))
    });
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
            <p>Las carpetas con el mismo nombre se muestran juntas, estén en el disco y en el nivel que estén. Haz clic en un bloque para entrar y explorarlo hasta sus videos; con clic derecho, ir al catálogo o marcar como favorita.</p>
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
      {notice ? <div className="vc-notice" role="status">{notice}</div> : null}
      {loading && !map ? <div className="loading">Cargando...</div> : null}

      {map && !noDisksSelected ? (
        <div className="vc-folders-layout">
          <div className="vc-panel vc-folders-map">
            <nav className="vc-folders-trail" aria-label="Ruta de exploración">
              <button className="vc-button is-small is-ghost" disabled={trail.length === 0} onClick={() => goTo(trail.length - 1)} type="button" title="Subir un nivel (Retroceso)">
                <ArrowUp size={14} /> Subir
              </button>
              <ol>
                <li><button type="button" onClick={() => goTo(0)} aria-current={trail.length === 0 ? "page" : undefined}>Todas las carpetas</button></li>
                {trail.map((node, index) => (
                  <li key={`${node.key}-${index}`}>
                    <ChevronRight size={13} aria-hidden="true" />
                    <button type="button" onClick={() => goTo(index + 1)} aria-current={index === trail.length - 1 ? "page" : undefined}>{node.kind === "files" ? "Archivos sueltos" : node.name}</button>
                  </li>
                ))}
              </ol>
              {focus ? <span className="vc-folders-trail-size">{describe(focus)}</span> : null}
              <label className="vc-folders-search is-map">
                <Search size={14} aria-hidden="true" />
                <input
                  ref={mapSearchRef}
                  value={mapSearch}
                  onChange={(event) => {
                    setHovered(null);
                    setMapSearch(event.target.value);
                  }}
                  onKeyDown={(event) => {
                    if (event.key === "Escape" && mapSearch) {
                      event.stopPropagation();
                      setMapSearch("");
                    }
                  }}
                  placeholder={filesView ? "Buscar video" : "Buscar en el mapa"}
                  aria-label="Buscar en el mapa"
                  title="Atajo: /"
                />
                {mapSearch ? (
                  <button className="vc-folders-search-clear" onClick={() => setMapSearch("")} type="button" aria-label="Limpiar búsqueda" title="Limpiar (Esc)">
                    <X size={13} />
                  </button>
                ) : null}
              </label>
            </nav>
            <div className={`vc-folders-canvas ${loading || saving || exploring ? "is-loading" : ""}`} ref={canvasRef} onMouseLeave={() => setHovered(null)}>
              {filesView ? fileTiles.map((rect) => {
                const file = rect.item;
                const cover = mainThumbnail(file);
                const labelled = rect.width > 70 && rect.height > 40;
                return (
                  <button
                    key={file.id}
                    className="vc-file-tile"
                    style={{ left: rect.x, top: rect.y, width: Math.max(0, rect.width - 2), height: Math.max(0, rect.height - 2) }}
                    onClick={() => onOpenFile(file)}
                    onContextMenu={(event) => {
                      if (!focus) return;
                      event.preventDefault();
                      setMenu({
                        x: Math.min(event.clientX, window.innerWidth - 270),
                        y: Math.min(event.clientY, window.innerHeight - 210),
                        title: trail.filter((node) => node.kind !== "files").map((node) => node.name).join(" › "),
                        locations: focus.locations,
                        scope: scopeFor(trail)
                      });
                    }}
                    type="button"
                    title={`${file.filename} · ${formatBytes(file.sizeBytes)}${file.disk?.name ? ` · ${file.disk.name}` : ""}`}
                    aria-label={`${file.filename}: ${formatBytes(file.sizeBytes)}`}
                  >
                    {cover ? <img src={cover} alt="" loading="lazy" decoding="async" /> : <ImageIcon size={22} aria-hidden="true" />}
                    {labelled ? (
                      <span className="vc-file-tile-label">
                        <strong>{file.filename}</strong>
                        <small>{formatBytes(file.sizeBytes)}</small>
                      </span>
                    ) : null}
                  </button>
                );
              }) : null}
              {!filesView && focus && !focusTree && focus.kind !== "files" ? <div className="loading vc-folders-canvas-loading">Abriendo carpeta…</div> : null}
              {showsFiles && !filesView ? <div className="loading vc-folders-canvas-loading">Cargando videos…</div> : null}
              {mapTerm && !exploring && (filesView ? shownFiles.length === 0 : levelNodes.length === 0) ? (
                <div className="vc-folders-canvas-loading vc-folders-no-match">{filesView ? `Ningún video de esta carpeta coincide con "${mapSearch.trim()}".` : `Ninguna carpeta coincide con "${mapSearch.trim()}" en este nivel.`}</div>
              ) : null}
              {!showsFiles ? tiles.map((tile) => {
                const scope = tile.node.kind === "rest" ? null : scopeFor([...trail, ...tile.trail]);
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
                    className={`vc-folder-tile is-depth-${tile.depth} is-${tile.node.kind} ${tile.parent ? "is-parent" : ""} ${hovered === tile ? "is-hovered" : ""} ${searchView.matches.has(tile.node) ? "is-match" : ""}`}
                    style={style}
                    disabled={tile.node.kind === "rest"}
                    title={tile.node.kind === "rest" ? "Carpetas pequeñas agrupadas en un solo bloque" : undefined}
                    onClick={(event) => {
                      event.stopPropagation();
                      enter(tile);
                    }}
                    onContextMenu={(event) => {
                      if (!scope || tile.node.locations.length === 0) return;
                      event.preventDefault();
                      setMenu({
                        x: Math.min(event.clientX, window.innerWidth - 270),
                        y: Math.min(event.clientY, window.innerHeight - 210),
                        title: [...trail, ...tile.trail].map((node) => node.name).join(" › "),
                        locations: tile.node.locations,
                        scope
                      });
                    }}
                    onMouseEnter={() => setHovered(tile)}
                    onFocus={() => setHovered(tile)}
                    type="button"
                    aria-label={`${tile.trail.map((node) => node.name).join(" › ")}: ${describe(tile.node)}`}
                  >
                    {tile.labelled ? (
                      <span className="vc-folder-tile-label">
                        <strong>
                          {tile.node.locations.length > 0 && tile.node.locations.every((location) => favoriteState(location, favorites)) ? <Heart size={11} aria-label="Favorita" className="vc-favorite-mark" /> : null}
                          {tile.node.name}
                        </strong>
                        <small>{formatBytes(tile.node.sizeBytes)}{tile.node.locations.length > 1 ? ` · ×${tile.node.locations.length}` : ""}</small>
                      </span>
                    ) : null}
                  </button>
                );
              }) : null}
            </div>
            <div className="vc-folders-status" aria-live="polite">
              {hovered ? (
                <>
                  <strong>{[...trail, ...hovered.trail].map((node) => node.name).join(" › ")}</strong>
                  <span>{describe(hovered.node)}</span>
                  {hovered.node.locations.length > 0 ? (
                    <span className="vc-folders-paths">
                      {hovered.node.locations.slice(0, 3).map((location) => `${location.diskName}: ${location.path}`).join("  ·  ")}
                      {hovered.node.locations.length > 3 ? `  ·  +${hovered.node.locations.length - 3}` : ""}
                    </span>
                  ) : null}
                </>
              ) : (
                <span>
                  {mapTerm && matchCount > 0
                    ? `${formatCount(matchCount)} ${filesView ? (matchCount === 1 ? "video coincide" : "videos coinciden") : (matchCount === 1 ? "carpeta coincide" : "carpetas coinciden")} con "${mapSearch.trim()}". Esc: limpiar.`
                    : filesView
                    ? (filesView.total > filesView.files.length
                      ? `${formatCount(filesView.total)} videos · ${formatBytes(filesView.totalBytes)} · se muestran los ${formatCount(filesView.files.length)} más grandes. Clic: abrir el video.`
                      : `${formatCount(filesView.total)} videos · ${formatBytes(filesView.totalBytes)}. Clic: abrir el video; clic derecho: ir al catálogo.`)
                    : "Clic: entrar en la carpeta · Clic derecho: ir al catálogo o marcar como favorita."}
                </span>
              )}
            </div>
          </div>

          <aside className="vc-panel vc-folders-groups" aria-label="Carpetas repetidas">
            <div className="vc-panel-head">
              <div>
                <h3><FolderTree size={16} aria-hidden="true" /> Carpetas repetidas</h3>
                <p>Excluye nombres genéricos (como RAW o 2019) para verlos por separado. Marca con estrella la carpeta que debe recibir el contenido de las demás.</p>
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
                      {group.locations.map((location) => {
                        const starred = Boolean(starredIn(location));
                        return (
                          <li key={`${location.diskId}:${location.path}`} className={starred ? "is-starred" : ""}>
                            <button
                              className={`vc-star-button ${starred ? "is-on" : ""}`}
                              disabled={saving}
                              onClick={() => void toggleStar(location)}
                              type="button"
                              aria-pressed={starred}
                              title={starred ? "Quitar estrella: deja de recibir archivos" : "Marcar con estrella: esta carpeta puede recibir archivos"}
                            >
                              <Star size={14} aria-hidden="true" />
                            </button>
                            <button
                              className={`vc-star-button vc-favorite-button ${favoriteState(location, favorites) ? "is-on" : ""}`}
                              disabled={saving || favoriteState(location, favorites) === "inherited"}
                              onClick={() => void toggleFavorite([location])}
                              type="button"
                              aria-pressed={Boolean(favoriteState(location, favorites))}
                              title={favoriteState(location, favorites) === "inherited"
                                ? "Está dentro de una carpeta favorita"
                                : favoriteState(location, favorites) ? "Quitar de favoritas" : "Marcar como favorita: sus videos nunca se ofrecen para moverse"}
                            >
                              <Heart size={14} aria-hidden="true" />
                            </button>
                            <span>{location.diskName}</span>
                            <code>{location.path}</code>
                            {location.sizeBytes > 0 ? <em>{formatBytes(location.sizeBytes)}</em> : <em />}
                          </li>
                        );
                      })}
                    </ul>
                    {(() => {
                      if (group.excluded) return null;
                      const starredLocation = [...group.locations].sort((left, right) => right.sizeBytes - left.sizeBytes).find((location) => starredIn(location));
                      if (!starredLocation) return null;
                      const largest = group.locations.reduce((best, location) => (location.sizeBytes > best.sizeBytes ? location : best), group.locations[0]);
                      return (
                        <>
                          {largest !== starredLocation && largest.sizeBytes > starredLocation.sizeBytes ? (
                            <p className="vc-folders-warning" role="note">
                              <AlertTriangle size={14} aria-hidden="true" />
                              {`La ubicación más grande es ${largest.diskName}: ${largest.path} (${formatBytes(largest.sizeBytes)}). Conviene que la estrella esté ahí para mover menos datos.`}
                            </p>
                          ) : null}
                          <div className="vc-folders-actions">
                            <button className="vc-button is-small is-primary" disabled={saving} onClick={() => consolidateInto(group, starredLocation)} type="button">
                              <FolderInput size={14} /> {`Consolidar en ${starredLocation.diskName}`}
                            </button>
                            <button className="vc-button is-small" disabled={saving} onClick={() => setGroupingId(starredIn(starredLocation)?.id ?? null)} type="button" title="Busca en todos los discos archivos con un nombre parecido al de esta carpeta">
                              <FolderSearch size={14} /> Agrupar archivos
                            </button>
                          </div>
                        </>
                      );
                    })()}
                    <div className="vc-folders-actions">
                      {!group.excluded ? (
                        <button className="vc-button is-small" onClick={() => openGroup(group)} type="button">
                          <ExternalLink size={14} /> Ir al catálogo
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

      {menu ? (() => {
        const states = menu.locations.map((location) => favoriteState(location, favorites));
        const exact = states.some((state) => state === "exact");
        const inherited = !exact && states.every((state) => state === "inherited");
        return (
          <div
            className="vc-context-menu"
            role="menu"
            aria-label={menu.title}
            style={{ left: menu.x, top: menu.y }}
            onPointerDown={(event) => event.stopPropagation()}
          >
            <span className="vc-context-menu-title" title={menu.title}>{menu.title}</span>
            <button role="menuitem" type="button" disabled={saving || inherited} onClick={() => void toggleFavorite(menu.locations)}>
              <Heart size={15} aria-hidden="true" className={exact ? "vc-favorite-mark" : undefined} />
              {inherited ? "Dentro de una carpeta favorita" : exact ? "Quitar de favoritas" : menu.locations.length > 1 ? `Marcar como favorita (${menu.locations.length} ubicaciones)` : "Marcar como favorita"}
            </button>
            {menu.scope ? (
              <button role="menuitem" type="button" onClick={() => { const scope = menu.scope!; setMenu(null); onOpenLocations(scope); }}>
                <ExternalLink size={15} aria-hidden="true" /> Ir al catálogo
              </button>
            ) : null}
            <small>Los videos de una carpeta favorita nunca se ofrecen para moverse a otra carpeta.</small>
          </div>
        );
      })() : null}

      {groupingId ? (
        <GroupSession
          destinationId={groupingId}
          onClose={() => setGroupingId(null)}
          onOpenTransfers={() => {
            setGroupingId(null);
            onTransferCreated();
          }}
          onChanged={onTransfersChanged}
        />
      ) : null}

      {consolidating ? (
        <ConsolidateDialog
          destination={consolidating.destination}
          sources={consolidating.sources}
          onCancel={() => setConsolidating(null)}
          onCreated={() => {
            setConsolidating(null);
            onTransferCreated();
          }}
        />
      ) : null}
    </section>
  );
}
