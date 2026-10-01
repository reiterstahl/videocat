import type { CSSProperties } from "react";
import { companionPortCandidates } from "@videocat/shared";
import { defaultLanguage, type Language, normalizeLanguage } from "../i18n";
import { thumbnailSrc } from "./api";
import {
  defaultCategoryColor,
  defaultPageSize,
  maxFilterWidth,
  minFilterWidth,
  pageSizeOptions,
  pathViews
} from "./app-config";
import type {
  AssistedDuplicateGroup,
  BrowserPlaybackSupport,
  CatalogView,
  CurationCategory,
  DownloadQueueEntry,
  DuplicateAssistantSession,
  DuplicateGroup,
  FolderFacet,
  SortBy,
  SortDirection,
  ViewMode,
  VisibleFolder
} from "./app-types";
import { isPendingDuplicateContender, orderDuplicateContenders } from "./duplicate-assistant";
import type { Disk, VideoFile } from "../types";

export function viewModeFromPath(pathname = window.location.pathname): ViewMode {
  const normalizedPath = pathname.replace(/\/+$/, "") || "/";
  return pathViews[normalizedPath] ?? "catalog";
}

export function localCompanionPortCandidates(storedPort: string | null): string[] {
  const parsedStoredPort = storedPort ? Number(storedPort) : undefined;
  return companionPortCandidates(parsedStoredPort).map(String);
}

export function browserPlaybackSupport(file: VideoFile): BrowserPlaybackSupport {
  const videoCodecs: Record<string, string> = { h264: "avc1.42E01E", avc: "avc1.42E01E", hevc: "hev1.1.6.L93.B0", h265: "hev1.1.6.L93.B0", vp9: "vp09.00.10.08", av1: "av01.0.08M.08" };
  const audioCodecs: Record<string, string> = { aac: "mp4a.40.2", mp3: "mp4a.40.34", opus: "opus", vorbis: "vorbis" };
  const extension = file.extension.toLowerCase();
  const mime = extension === ".mp4" || extension === ".mov" ? "video/mp4" : extension === ".webm" ? "video/webm" : "video/x-matroska";
  const codecs = [file.videoCodec ? videoCodecs[file.videoCodec.toLowerCase()] : undefined, file.audioCodec ? audioCodecs[file.audioCodec.toLowerCase()] : undefined]
    .filter((codec): codec is string => Boolean(codec));
  const mediaType = codecs.length > 0 ? `${mime}; codecs="${codecs.join(", ")}"` : mime;
  const result = typeof document === "undefined" ? "maybe" : document.createElement("video").canPlayType(mediaType) as BrowserPlaybackSupport["result"];
  return {
    result,
    mediaType,
    remuxUseful: ![".mp4", ".m4v", ".mov"].includes(extension) && ["h264", "avc"].includes((file.videoCodec ?? "").toLowerCase()) && ["aac", "mp3"].includes((file.audioCodec ?? "").toLowerCase())
  };
}

export function storedCatalogView(): CatalogView {
  return localStorage.getItem("videocat-catalog-view") === "list" ? "list" : "grid";
}

export function storedFiltersOpen(): boolean {
  const stored = localStorage.getItem("videocat-catalog-filters-open");
  if (stored === "true" || stored === "false") return stored === "true";
  return window.innerWidth >= 1280;
}

export function resolutionBadge(file: VideoFile): string | null {
  const width = file.width ?? 0;
  const height = file.height ?? 0;
  if (!width || !height) return null;
  if (width >= 3800 || height >= 2100) return "4K";
  if (width >= 2600) return "2.7K";
  if (height >= 1400) return "1440p";
  if (height >= 1000) return "1080p";
  if (height >= 700) return "720p";
  return "SD";
}

export function formatCount(value: number): string {
  return new Intl.NumberFormat("es-CR").format(value);
}

export function diskUsagePercent(disk: Disk): number | null {
  if (!disk.totalBytes || disk.freeBytes === null || disk.freeBytes === undefined) return null;
  return Math.min(100, Math.max(0, Math.round(((disk.totalBytes - disk.freeBytes) / disk.totalBytes) * 100)));
}

export function storedPageSize(): number {
  const value = Number(localStorage.getItem("videocat-page-size"));
  return pageSizeOptions.includes(value as (typeof pageSizeOptions)[number]) ? value : defaultPageSize;
}

export function storedFilterWidth(): number {
  const value = Number(localStorage.getItem("videocat-filter-width"));
  if (!Number.isFinite(value)) return minFilterWidth;
  return Math.min(maxFilterWidth, Math.max(minFilterWidth, value));
}

export function storedLanguage(): Language {
  const stored = localStorage.getItem("videocat-language");
  return stored ? normalizeLanguage(stored) : defaultLanguage();
}

export function categoryLabel(status: string, categories: CurationCategory[]): string {
  if (status === "none") return "Sin marcar";
  if (status === "keep") return "Mantener";
  return categories.find((category) => category.key === status)?.label ?? status;
}

export function categoryColor(status: string, categories: CurationCategory[]): string {
  if (status === "keep") return "#20A464";
  return categories.find((category) => category.key === status)?.color ?? defaultCategoryColor;
}

export function categoryStyle(status: string, categories: CurationCategory[]): CSSProperties {
  if (status === "none") return {};
  return { "--category-color": categoryColor(status, categories) } as CSSProperties;
}

export function categoryKeysForFile(file: VideoFile): string[] {
  return file.categoryKeys?.length > 0
    ? file.categoryKeys
    : file.curationStatus !== "none"
      ? [file.curationStatus]
      : [];
}

export function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return target.isContentEditable || ["INPUT", "SELECT", "TEXTAREA"].includes(target.tagName);
}

export function hexToRgbTriplet(hex: string): string {
  const value = hex.replace("#", "");
  const full = value.length === 3 ? value.split("").map((part) => part + part).join("") : value;
  const parsed = Number.parseInt(full.slice(0, 6), 16);
  if (Number.isNaN(parsed)) return "194, 65, 12";
  return `${(parsed >> 16) & 255}, ${(parsed >> 8) & 255}, ${parsed & 255}`;
}

export function hasFileCategory(file: VideoFile, key: string): boolean {
  return categoryKeysForFile(file).includes(key);
}

export function mainThumbnail(file: VideoFile): string | undefined {
  return thumbnailSrc(file.thumbnails.find((thumb) => thumb.kind === "frame_08")?.url ?? file.thumbnails[0]?.url);
}

export function assistedDuplicateGroups(groups: DuplicateGroup[]): AssistedDuplicateGroup[] {
  return groups.flatMap((group) => {
    const contenders = orderDuplicateContenders(group.files.filter(isPendingDuplicateContender));
    return contenders.length > 1 ? [{ ...group, contenders }] : [];
  });
}

export function startDuplicateAssistantSession(groups: AssistedDuplicateGroup[]): DuplicateAssistantSession | null {
  const first = groups[0];
  if (!first) return null;
  return {
    groups,
    groupIndex: 0,
    keeper: first.contenders[0],
    challenger: first.contenders[1],
    remaining: first.contenders.slice(2),
    completedComparisons: 0,
    totalComparisons: groups.reduce((total, group) => total + group.contenders.length - 1, 0)
  };
}

export function resolution(file: VideoFile): string {
  if (!file.width || !file.height) return "-";
  return `${file.width} x ${file.height}`;
}

export function dateLabel(value?: string | null, locale = "es-CR"): string {
  if (!value) return "-";
  return new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short" }).format(new Date(value));
}

export function downloadStatusLabel(status: string): string {
  if (status === "queued") return "En cola";
  if (status === "downloading") return "Descargando";
  if (status === "done") return "Descargado";
  if (status === "failed") return "Falló";
  return status;
}

export function downloadProgressPercent(entry: DownloadQueueEntry): number {
  if (entry.status === "done") return 100;
  if (entry.file.sizeBytes <= 0) return 0;
  return Math.max(0, Math.min(100, Math.round((entry.progressBytes / entry.file.sizeBytes) * 100)));
}

export function transferEtaLabel(seconds: number | null): string {
  if (seconds === null || !Number.isFinite(seconds) || seconds < 0) return "Calculando...";
  const rounded = Math.max(1, Math.ceil(seconds));
  if (rounded < 60) return `${rounded} s`;
  if (rounded < 3600) return `${Math.floor(rounded / 60)} min ${rounded % 60} s`;
  const hours = Math.floor(rounded / 3600);
  const minutes = Math.floor((rounded % 3600) / 60);
  return `${hours} h ${minutes} min`;
}

export function folderPath(filePath: string): string {
  const index = Math.max(filePath.lastIndexOf("\\"), filePath.lastIndexOf("/"));
  return index >= 0 ? filePath.slice(0, index) : filePath;
}

export function tagHue(tag: string): number {
  return [...tag].reduce((hash, char) => (hash * 31 + char.charCodeAt(0)) % 360, 17);
}

export function normalizeSearchValue(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

export function sortLabel(sortBy: SortBy, sortDirection: SortDirection, field: SortBy): string {
  if (sortBy !== field) return "";
  return sortDirection === "asc" ? "ASC" : "DESC";
}

export function isFolderAncestor(parent: string, child: string): boolean {
  return parent !== "." && child.startsWith(`${parent}/`);
}

export function parentFolder(pathValue: string): string {
  if (pathValue === "." || !pathValue.includes("/")) return "";
  return pathValue.split("/").slice(0, -1).join("/");
}

export function compareFolderPaths(a: { path: string }, b: { path: string }): number {
  if (a.path === b.path) return 0;
  if (a.path === ".") return -1;
  if (b.path === ".") return 1;

  const aParts = a.path.split("/");
  const bParts = b.path.split("/");
  const length = Math.min(aParts.length, bParts.length);

  for (let index = 0; index < length; index += 1) {
    const result = aParts[index].localeCompare(bParts[index], "es", {
      numeric: true,
      sensitivity: "base"
    });
    if (result !== 0) return result;
  }

  return aParts.length - bParts.length;
}

export function nextSelectedFolders(current: string[], folder: string): string[] {
  if (current.includes(folder)) return current.filter((item) => item !== folder);
  if (folder === ".") return ["."];
  return [...current.filter((item) => item !== "." && !isFolderAncestor(item, folder) && !isFolderAncestor(folder, item)), folder];
}

export function visibleFolderOptions(
  folders: FolderFacet[],
  expandedFolders: string[],
  folderSearch: string
): VisibleFolder[] {
  const expanded = new Set(expandedFolders);
  const children = new Map<string, number>();
  for (const folder of folders) {
    const parent = parentFolder(folder.path);
    children.set(parent, (children.get(parent) ?? 0) + 1);
  }
  const search = normalizeSearchValue(folderSearch.trim());
  const searchableFolders = search
    ? new Set(
        folders
          .filter((folder) => normalizeSearchValue(`${folder.label} ${folder.path}`).includes(search))
          .flatMap((folder) => {
            const parts = folder.path === "." ? ["."] : folder.path.split("/");
            const ancestors = parts.map((_part, index) => parts.slice(0, index + 1).join("/"));
            return [folder.path, ...ancestors];
          })
      )
    : null;

  return [...folders]
    .sort(compareFolderPaths)
    .filter((folder) => {
      if (searchableFolders && !searchableFolders.has(folder.path)) return false;
      if (searchableFolders) return true;
      if (folder.path === "." || folder.depth <= 1) return true;
      const parts = folder.path.split("/");
      for (let index = 1; index < parts.length; index += 1) {
        const ancestor = parts.slice(0, index).join("/");
        if (!expanded.has(ancestor)) return false;
      }
      return true;
    })
    .map((folder) => ({
      ...folder,
      hasChildren: (children.get(folder.path) ?? 0) > 0,
      isExpanded: expanded.has(folder.path)
    }));
}
