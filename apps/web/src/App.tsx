import { useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties, FormEvent, PointerEvent as ReactPointerEvent } from "react";
import {
  AlertTriangle,
  ArrowUpDown,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Check,
  Copy,
  Database,
  Download,
  Filter,
  FileVideo,
  FolderOpen,
  Github,
  HardDrive,
  Heart,
  Image,
  LayoutGrid,
  Lock,
  LogOut,
  Moon,
  Pause,
  Play,
  Search,
  Shield,
  Shuffle,
  Sun,
  Trash2,
  User,
  X
} from "lucide-react";
import { formatBytes, formatDuration } from "@videocat/shared";
import { defaultLanguage, languageLabel, normalizeLanguage, observeLocalization, type Language } from "./i18n";
import { api, thumbnailSrc } from "./lib/api";
import type { Disk, Stats, VideoFile } from "./types";

type SortBy = "filename" | "sizeBytes" | "durationSeconds" | "modifiedAt" | "createdAt";
type SortDirection = "asc" | "desc";
type ViewMode = "catalog" | "review" | "downloads" | "duplicates" | "usage" | "audit" | "admin" | "profile";
type CurationStatus = string;
type CurationCategory = {
  key: string;
  label: string;
  color: string;
  builtIn: boolean;
  count: number;
};

type FileResponse = {
  files: VideoFile[];
  page: number;
  pageSize: number;
  total: number;
};

type ReviewNextResponse = {
  file: VideoFile | null;
  remaining: number;
};

type ReviewSummaryResponse = {
  pendingTotal: number;
  markedToday: number;
  markedLast7Days: number;
  freedBytes: number;
  pending: VideoFile[];
  recent: VideoFile[];
};

type DownloadQueueEntry = {
  id: string;
  status: "queued" | "downloading" | "done" | "failed";
  source: string;
  requestedAt: string;
  startedAt?: string | null;
  completedAt?: string | null;
  destinationPath?: string | null;
  downloadedTag?: string | null;
  errorMessage?: string | null;
  progressBytes: number;
  progressUpdatedAt?: string | null;
  file: VideoFile;
};

type DownloadSummaryResponse = {
  paused: boolean;
  counts: Record<string, number>;
  pendingBytes: number;
  entries: DownloadQueueEntry[];
};

type RandomDownloadResponse = {
  queued: number;
  queuedBytes: number;
  files: VideoFile[];
};

type RecoverableSpaceDisk = {
  diskId: string;
  diskName: string;
  driveLetter?: string | null;
  volumeLabel?: string | null;
  totalBytes?: number | null;
  fileCount: number;
  recoverableBytes: number;
};

type RecoverableSpaceResponse = {
  totalRecoverableBytes: number;
  disks: RecoverableSpaceDisk[];
};

type FolderUsageItem = {
  diskId: string;
  diskName: string;
  folder: string;
  sizeBytes: number;
  fileCount: number;
  estimated: boolean;
};

type AuditErrorItem = {
  id: string;
  diskName: string;
  category: string;
  phase: string;
  code?: string | null;
  message: string;
  absolutePath?: string | null;
  relativePath?: string | null;
  createdAt: string;
  scanStartedAt?: string | null;
};

type AuditSummaryItem = {
  category: string;
  phase: string;
  count: number;
};

type DuplicateGroup = {
  sizeBytes: number;
  count: number;
  files: VideoFile[];
};

type AdminPurgeResponse = {
  ok: boolean;
  disk: Disk;
  deleted: {
    files: number;
    thumbnails: number;
    errors: number;
    scans: number;
  };
  thumbnailFilesRemoved: boolean;
  thumbnailFileWarning?: string | null;
};

type ProfileSecurityResponse = {
  hasPin: boolean;
  protectedFolderPatterns: string[];
};

type FacetResponse = {
  folders: { path: string; label: string; depth: number; count: number; locked: boolean }[];
  tags: { tag: string; count: number }[];
  extensions: { extension: string; count: number }[];
  curationStatuses: CurationCategory[];
  protectedUnlocked: boolean;
};

type FolderFacet = FacetResponse["folders"][number];
type VisibleFolder = FolderFacet & {
  hasChildren: boolean;
  isExpanded: boolean;
};

type ProtectedPinPrompt = {
  folder: string;
  action: "expand" | "select";
};

type CompanionAction = "open-file" | "open-folder" | "delete-file";
type CompanionReason = "not_available" | "forbidden" | "bad_request" | "open_failed";
type CompanionResponse = {
  ok: boolean;
  reason?: CompanionReason;
  detail?: string;
};

type CompanionProcessDownloadsResponse = {
  ok: boolean;
  processedDisks?: number;
  reason?: CompanionReason;
  detail?: string;
};

type CompanionStatusResponse = {
  online: boolean;
  lastSeenAt?: string | null;
  staleAfterMs: number;
  version?: number;
  mountedDiskCount?: number;
};

type MountedCompanionDisk = {
  root: string;
  diskId: string;
  diskName: string;
  scanRoots: string[];
};

const logoUrl = "/logo.png";
const logoWhiteUrl = "/logo_white.png";
const githubProfileUrl = "https://github.com/reiterstahl";
const githubSponsorsUrl = "https://github.com/sponsors/reiterstahl";
const paypalDonateUrl = "https://www.paypal.com/donate/?hosted_button_id=2A4K45LJRACCY";
const pageSizeOptions = [15, 30, 60, 100] as const;
const defaultPageSize = 30;
const minFilterWidth = 250;
const maxFilterWidth = 560;
const defaultCategoryColor = "#2A9FD6";

function storedPageSize(): number {
  const value = Number(localStorage.getItem("videocat-page-size"));
  return pageSizeOptions.includes(value as (typeof pageSizeOptions)[number]) ? value : defaultPageSize;
}

function storedFilterWidth(): number {
  const value = Number(localStorage.getItem("videocat-filter-width"));
  if (!Number.isFinite(value)) return minFilterWidth;
  return Math.min(maxFilterWidth, Math.max(minFilterWidth, value));
}

function storedLanguage(): Language {
  const stored = localStorage.getItem("videocat-language");
  return stored ? normalizeLanguage(stored) : defaultLanguage();
}

function categoryLabel(status: string, categories: CurationCategory[]): string {
  if (status === "none") return "Sin marcar";
  if (status === "keep") return "Mantener";
  return categories.find((category) => category.key === status)?.label ?? status;
}

function categoryColor(status: string, categories: CurationCategory[]): string {
  if (status === "keep") return "#20A464";
  return categories.find((category) => category.key === status)?.color ?? defaultCategoryColor;
}

function categoryStyle(status: string, categories: CurationCategory[]): CSSProperties {
  if (status === "none") return {};
  return { "--category-color": categoryColor(status, categories) } as CSSProperties;
}

function categoryKeysForFile(file: VideoFile): string[] {
  return file.categoryKeys?.length > 0
    ? file.categoryKeys
    : file.curationStatus !== "none"
      ? [file.curationStatus]
      : [];
}

function WaterRippleBackdrop() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const surfaceCandidate = canvasRef.current;
    if (!surfaceCandidate) return;
    const surfaceElement: HTMLCanvasElement = surfaceCandidate;

    const contextCandidate = surfaceElement.getContext("2d");
    if (!contextCandidate) return;
    const drawingContext: CanvasRenderingContext2D = contextCandidate;

    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
    type Drop = {
      x: number;
      y: number;
      targetY: number;
      speed: number;
      rippleAge: number;
      rippleDuration: number;
      radius: number;
      alpha: number;
      hit: boolean;
    };

    let width = 0;
    let height = 0;
    let animationFrame = 0;
    let lastFrameAt = performance.now();
    let lastDropAt = 0;
    let drops: Drop[] = [];

    function resize() {
      const rect = surfaceElement.getBoundingClientRect();
      const pixelRatio = Math.min(window.devicePixelRatio || 1, 2);
      width = Math.max(1, Math.floor(rect.width));
      height = Math.max(1, Math.floor(rect.height));
      surfaceElement.width = Math.floor(width * pixelRatio);
      surfaceElement.height = Math.floor(height * pixelRatio);
      drawingContext.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
    }

    function createDrop(now: number) {
      drops.push({
        x: width * (0.12 + Math.random() * 0.76),
        y: -24,
        targetY: height * (0.58 + Math.random() * 0.28),
        speed: 150 + Math.random() * 95,
        rippleAge: 0,
        rippleDuration: 2600 + Math.random() * 900,
        radius: 22 + Math.random() * 18,
        alpha: 0.16 + Math.random() * 0.16,
        hit: false
      });
      lastDropAt = now;
    }

    function draw(now: number) {
      const delta = Math.min(40, now - lastFrameAt);
      lastFrameAt = now;
      const isDark = document.documentElement.dataset.theme === "dark";

      drawingContext.clearRect(0, 0, width, height);

      const gradient = drawingContext.createLinearGradient(0, 0, width, height);
      if (isDark) {
        gradient.addColorStop(0, "#100c0a");
        gradient.addColorStop(0.52, "#151016");
        gradient.addColorStop(1, "#09141a");
      } else {
        gradient.addColorStop(0, "#fff7f1");
        gradient.addColorStop(0.52, "#f2ebe5");
        gradient.addColorStop(1, "#e7eef0");
      }
      drawingContext.fillStyle = gradient;
      drawingContext.fillRect(0, 0, width, height);

      if (!reducedMotion.matches && now - lastDropAt > 720 + Math.random() * 520) createDrop(now);

      drawingContext.globalCompositeOperation = "source-over";
      drops = drops.filter((drop) => {
        if (!drop.hit) {
          drop.y += drop.speed * (delta / 1000);
          const trail = drawingContext.createLinearGradient(drop.x, drop.y - 42, drop.x, drop.y + 8);
          trail.addColorStop(0, "rgba(252, 97, 33, 0)");
          trail.addColorStop(1, isDark ? "rgba(255, 138, 76, 0.28)" : "rgba(217, 77, 20, 0.22)");
          drawingContext.strokeStyle = trail;
          drawingContext.lineWidth = 1.4;
          drawingContext.beginPath();
          drawingContext.moveTo(drop.x, drop.y - 42);
          drawingContext.lineTo(drop.x, drop.y);
          drawingContext.stroke();
          drawingContext.fillStyle = isDark ? "rgba(255, 184, 126, 0.64)" : "rgba(252, 97, 33, 0.58)";
          drawingContext.beginPath();
          drawingContext.arc(drop.x, drop.y, 2.2, 0, Math.PI * 2);
          drawingContext.fill();
          if (drop.y >= drop.targetY) drop.hit = true;
          return true;
        }

        drop.rippleAge += delta;
        const progress = Math.min(1, drop.rippleAge / drop.rippleDuration);
        const ease = 1 - Math.pow(1 - progress, 2);
        const alpha = drop.alpha * (1 - progress);
        drawingContext.strokeStyle = isDark ? `rgba(255, 138, 76, ${alpha})` : `rgba(217, 77, 20, ${alpha})`;
        drawingContext.lineWidth = 1.2;
        for (let ring = 0; ring < 3; ring += 1) {
          const ringProgress = Math.max(0, ease - ring * 0.16);
          if (ringProgress <= 0) continue;
          drawingContext.beginPath();
          drawingContext.ellipse(
            drop.x,
            drop.targetY,
            drop.radius * (1 + ringProgress * 4.8),
            drop.radius * (0.28 + ringProgress * 1.1),
            0,
            0,
            Math.PI * 2
          );
          drawingContext.stroke();
        }
        return drop.rippleAge < drop.rippleDuration;
      });

      drawingContext.globalCompositeOperation = "source-over";
      animationFrame = window.requestAnimationFrame(draw);
    }

    resize();
    for (let index = 0; index < 4; index += 1) createDrop(performance.now() - index * 500);
    animationFrame = window.requestAnimationFrame(draw);
    window.addEventListener("resize", resize);

    return () => {
      window.cancelAnimationFrame(animationFrame);
      window.removeEventListener("resize", resize);
    };
  }, []);

  return <canvas ref={canvasRef} className="water-ripple-backdrop" aria-hidden="true" />;
}

function hasFileCategory(file: VideoFile, key: string): boolean {
  return categoryKeysForFile(file).includes(key);
}

function mainThumbnail(file: VideoFile): string | undefined {
  return thumbnailSrc(file.thumbnails.find((thumb) => thumb.kind === "frame_08")?.url ?? file.thumbnails[0]?.url);
}

function resolution(file: VideoFile): string {
  if (!file.width || !file.height) return "-";
  return `${file.width} x ${file.height}`;
}

function dateLabel(value?: string | null, locale = "es-CR"): string {
  if (!value) return "-";
  return new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short" }).format(new Date(value));
}

function downloadStatusLabel(status: string): string {
  if (status === "queued") return "En cola";
  if (status === "downloading") return "Descargando";
  if (status === "done") return "Descargado";
  if (status === "failed") return "Falló";
  return status;
}

function downloadProgressPercent(entry: DownloadQueueEntry): number {
  if (entry.status === "done") return 100;
  if (entry.file.sizeBytes <= 0) return 0;
  return Math.max(0, Math.min(100, Math.round((entry.progressBytes / entry.file.sizeBytes) * 100)));
}

function folderPath(filePath: string): string {
  const index = Math.max(filePath.lastIndexOf("\\"), filePath.lastIndexOf("/"));
  return index >= 0 ? filePath.slice(0, index) : filePath;
}

function tagHue(tag: string): number {
  return [...tag].reduce((hash, char) => (hash * 31 + char.charCodeAt(0)) % 360, 17);
}

function normalizeSearchValue(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

function sortLabel(sortBy: SortBy, sortDirection: SortDirection, field: SortBy): string {
  if (sortBy !== field) return "";
  return sortDirection === "asc" ? "ASC" : "DESC";
}

function isFolderAncestor(parent: string, child: string): boolean {
  return parent !== "." && child.startsWith(`${parent}/`);
}

function parentFolder(pathValue: string): string {
  if (pathValue === "." || !pathValue.includes("/")) return "";
  return pathValue.split("/").slice(0, -1).join("/");
}

function compareFolderPaths(a: { path: string }, b: { path: string }): number {
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

function nextSelectedFolders(current: string[], folder: string): string[] {
  if (current.includes(folder)) return current.filter((item) => item !== folder);
  if (folder === ".") return ["."];
  return [...current.filter((item) => item !== "." && !isFolderAncestor(item, folder) && !isFolderAncestor(folder, item)), folder];
}

export function App() {
  const [theme, setTheme] = useState<"light" | "dark">(() => {
    const stored = localStorage.getItem("videocat-theme");
    if (stored === "light" || stored === "dark") return stored;
    return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  });
  const [language, setLanguage] = useState<Language>(storedLanguage);
  const [sessionChecked, setSessionChecked] = useState(false);
  const [authenticated, setAuthenticated] = useState(false);
  const [username, setUsername] = useState("admin");
  const [password, setPassword] = useState("");
  const [loginError, setLoginError] = useState("");
  const [stats, setStats] = useState<Stats | null>(null);
  const [disks, setDisks] = useState<Disk[]>([]);
  const [connectedDiskIds, setConnectedDiskIds] = useState<string[]>([]);
  const [facets, setFacets] = useState<FacetResponse>({
    folders: [],
    tags: [],
    extensions: [],
    curationStatuses: [],
    protectedUnlocked: false
  });
  const [protectedUnlocked, setProtectedUnlocked] = useState(false);
  const [protectedUnlockVersion, setProtectedUnlockVersion] = useState(0);
  const [pinPrompt, setPinPrompt] = useState<ProtectedPinPrompt | null>(null);
  const [protectedPin, setProtectedPin] = useState("");
  const [pinSubmitting, setPinSubmitting] = useState(false);
  const [files, setFiles] = useState<VideoFile[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(storedPageSize);
  const [q, setQ] = useState("");
  const [extension, setExtension] = useState("");
  const [selectedFolders, setSelectedFolders] = useState<string[]>([]);
  const [expandedFolders, setExpandedFolders] = useState<string[]>([]);
  const [folderSearch, setFolderSearch] = useState("");
  const [selectedTags, setSelectedTags] = useState<string[]>([]);
  const [selectedFileIds, setSelectedFileIds] = useState<string[]>([]);
  const [duplicateOnly, setDuplicateOnly] = useState(false);
  const [curationStatus, setCurationStatus] = useState<CurationStatus | "">("");
  const [bulkCategoryKey, setBulkCategoryKey] = useState("");
  const [bulkBusy, setBulkBusy] = useState(false);
  const [bulkMessage, setBulkMessage] = useState("");
  const [newCategoryLabel, setNewCategoryLabel] = useState("");
  const [newCategoryColor, setNewCategoryColor] = useState(defaultCategoryColor);
  const [categoryError, setCategoryError] = useState("");
  const [categorySubmitting, setCategorySubmitting] = useState(false);
  const [sortBy, setSortBy] = useState<SortBy>("modifiedAt");
  const [sortDirection, setSortDirection] = useState<SortDirection>("desc");
  const [selected, setSelected] = useState<VideoFile | null>(null);
  const [duplicates, setDuplicates] = useState<VideoFile[]>([]);
  const [loading, setLoading] = useState(false);
  const [catalogVersion, setCatalogVersion] = useState(0);
  const [viewMode, setViewMode] = useState<ViewMode>("catalog");
  const [reviewRecent, setReviewRecent] = useState<VideoFile[]>([]);
  const [reviewPending, setReviewPending] = useState<VideoFile[]>([]);
  const [reviewCurrent, setReviewCurrent] = useState<VideoFile | null>(null);
  const [reviewRemaining, setReviewRemaining] = useState(0);
  const [reviewMarkedToday, setReviewMarkedToday] = useState(0);
  const [reviewMarkedLast7Days, setReviewMarkedLast7Days] = useState(0);
  const [reviewFreedBytes, setReviewFreedBytes] = useState(0);
  const [reviewPendingTotal, setReviewPendingTotal] = useState(0);
  const [reviewLoading, setReviewLoading] = useState(false);
  const [reviewMessage, setReviewMessage] = useState("");
  const [recoverableSpaceOpen, setRecoverableSpaceOpen] = useState(false);
  const [recoverableSpaceLoading, setRecoverableSpaceLoading] = useState(false);
  const [recoverableSpaceError, setRecoverableSpaceError] = useState("");
  const [recoverableSpace, setRecoverableSpace] = useState<RecoverableSpaceResponse | null>(null);
  const [downloadSummary, setDownloadSummary] = useState<DownloadSummaryResponse | null>(null);
  const [downloadLoading, setDownloadLoading] = useState(false);
  const [downloadActionBusy, setDownloadActionBusy] = useState(false);
  const [selectedDownloadQueueIds, setSelectedDownloadQueueIds] = useState<string[]>([]);
  const [downloadMessage, setDownloadMessage] = useState("");
  const [randomDownloadGb, setRandomDownloadGb] = useState("10");
  const [folderUsage, setFolderUsage] = useState<FolderUsageItem[]>([]);
  const [duplicateGroups, setDuplicateGroups] = useState<DuplicateGroup[]>([]);
  const [auditSummary, setAuditSummary] = useState<AuditSummaryItem[]>([]);
  const [auditErrors, setAuditErrors] = useState<AuditErrorItem[]>([]);
  const [selectedAuditError, setSelectedAuditError] = useState<AuditErrorItem | null>(null);
  const [auxLoading, setAuxLoading] = useState(false);
  const [filterWidth, setFilterWidth] = useState(storedFilterWidth);
  const [adminBusyDiskId, setAdminBusyDiskId] = useState<string | null>(null);
  const [adminMessage, setAdminMessage] = useState("");
  const [adminError, setAdminError] = useState("");
  const [profileSecurity, setProfileSecurity] = useState<ProfileSecurityResponse | null>(null);
  const [profileCurrentPin, setProfileCurrentPin] = useState("");
  const [profileNewPin, setProfileNewPin] = useState("");
  const [profilePatternsText, setProfilePatternsText] = useState("");
  const [profileLoading, setProfileLoading] = useState(false);
  const [profileSaving, setProfileSaving] = useState(false);
  const [profileMessage, setProfileMessage] = useState("");
  const [profileError, setProfileError] = useState("");
  const [detectingConnected, setDetectingConnected] = useState(false);
  const [connectedMessage, setConnectedMessage] = useState("");
  const [companionOnline, setCompanionOnline] = useState(false);
  const locale = language === "en" ? "en-US" : "es-CR";

  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  const activeLogo = theme === "dark" ? logoWhiteUrl : logoUrl;
  const selectedIndex = selected ? files.findIndex((file) => file.id === selected.id) : -1;
  const canOpenPrevious = selectedIndex > 0;
  const canOpenNext = selectedIndex >= 0 && selectedIndex < files.length - 1;
  const selectedFileIdSet = useMemo(() => new Set(selectedFileIds), [selectedFileIds]);
  const allVisibleSelected = files.length > 0 && files.every((file) => selectedFileIdSet.has(file.id));
  const visibleSelectedCount = files.filter((file) => selectedFileIdSet.has(file.id)).length;
  const selectedDownloadQueueIdSet = useMemo(() => new Set(selectedDownloadQueueIds), [selectedDownloadQueueIds]);
  const removableDownloadEntries = useMemo(
    () => (downloadSummary?.entries ?? []).filter((entry) => entry.status === "queued" || entry.status === "failed"),
    [downloadSummary]
  );
  const allRemovableDownloadsSelected = removableDownloadEntries.length > 0 &&
    removableDownloadEntries.every((entry) => selectedDownloadQueueIdSet.has(entry.id));

  function reviewQuerySuffix(): string {
    if (disks.length === 0) return "";
    const params = new URLSearchParams();
    params.set("diskIds", diskQuery);
    return `?${params.toString()}`;
  }

  const extensions = useMemo(() => facets.extensions.map((item) => item.extension), [facets.extensions]);
  const maxFolderUsage = useMemo(() => Math.max(1, ...folderUsage.map((item) => item.sizeBytes)), [folderUsage]);
  const maxTagCount = useMemo(() => Math.max(1, ...facets.tags.map((tag) => tag.count)), [facets.tags]);
  const folderChildren = useMemo(() => {
    const counts = new Map<string, number>();
    for (const folder of facets.folders) {
      const parent = parentFolder(folder.path);
      counts.set(parent, (counts.get(parent) ?? 0) + 1);
    }
    return counts;
  }, [facets.folders]);
  const visibleFolders = useMemo<VisibleFolder[]>(() => {
    const expanded = new Set(expandedFolders);
    const search = normalizeSearchValue(folderSearch.trim());
    const searchableFolders = search
      ? new Set(
          facets.folders
            .filter((folder) =>
              normalizeSearchValue(`${folder.label} ${folder.path}`).includes(search)
            )
            .flatMap((folder) => {
              const parts = folder.path === "." ? ["."] : folder.path.split("/");
              const ancestors = parts.map((_part, index) => parts.slice(0, index + 1).join("/"));
              return [folder.path, ...ancestors];
            })
        )
      : null;
    return [...facets.folders]
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
        hasChildren: (folderChildren.get(folder.path) ?? 0) > 0,
        isExpanded: expanded.has(folder.path)
      }));
  }, [expandedFolders, facets.folders, folderChildren, folderSearch]);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    localStorage.setItem("videocat-theme", theme);
    document.querySelector<HTMLLinkElement>("link[rel='icon']")?.setAttribute("href", theme === "dark" ? logoWhiteUrl : logoUrl);
  }, [theme]);

  useEffect(() => {
    document.documentElement.lang = language;
    localStorage.setItem("videocat-language", language);
    const root = document.querySelector(".login-screen, .app-shell");
    return root ? observeLocalization(root, language) : undefined;
  }, [language, sessionChecked, authenticated, viewMode, catalogVersion, files, downloadSummary, reviewPending, reviewRecent, auditErrors, duplicateGroups, folderUsage]);

  useEffect(() => {
    localStorage.setItem("videocat-page-size", String(pageSize));
  }, [pageSize]);

  useEffect(() => {
    localStorage.setItem("videocat-filter-width", String(filterWidth));
  }, [filterWidth]);

  useEffect(() => {
    if (page > pageCount) setPage(pageCount);
  }, [page, pageCount]);

  function toggleTheme() {
    setTheme((value) => (value === "dark" ? "light" : "dark"));
  }

  useEffect(() => {
    api("/api/auth/me")
      .then(() => setAuthenticated(true))
      .catch(() => setAuthenticated(false))
      .finally(() => setSessionChecked(true));
  }, []);

  useEffect(() => {
    if (!authenticated) return;
    void Promise.all([
      api<{ stats?: never } & Stats>("/api/stats").then(setStats),
      api<{ disks: Disk[] }>("/api/disks").then((response) => {
        setDisks(response.disks);
        setConnectedDiskIds((current) => {
          if (current.length > 0) return current;
          const stored = localStorage.getItem("videocat-connected-disks");
          const storedIds = stored ? stored.split(",").filter((id) => response.disks.some((disk) => disk.id === id)) : [];
          return storedIds.length > 0 ? storedIds : response.disks.map((disk) => disk.id);
        });
      })
    ]);
  }, [authenticated, catalogVersion, protectedUnlockVersion]);

  useEffect(() => {
    if (!authenticated) {
      setCompanionOnline(false);
      return;
    }

    let cancelled = false;

    async function checkCompanionHealth() {
      const storedPort = localStorage.getItem("videocat-companion-port") ?? "29429";
      const ports = [...new Set([storedPort, "29429"].filter(Boolean))];

      for (const port of ports) {
        try {
          const response = await fetch(`http://127.0.0.1:${port}/health`, {
            cache: "no-store",
            signal: AbortSignal.timeout(1800)
          });
          const result = await response.json().catch(() => ({ ok: false })) as { ok?: boolean };
          if (response.ok && result.ok === true) {
            localStorage.setItem("videocat-companion-port", port);
            if (!cancelled) setCompanionOnline(true);
            return;
          }
        } catch {
          try {
            await fetch(`http://127.0.0.1:${port}/health`, {
              cache: "no-store",
              mode: "no-cors",
              signal: AbortSignal.timeout(1800)
            });
            localStorage.setItem("videocat-companion-port", port);
            if (!cancelled) setCompanionOnline(true);
            return;
          } catch {
            // Try the next known port before marking the companion offline.
          }
        }
      }

      try {
        const status = await api<CompanionStatusResponse>("/api/companion/status");
        if (!cancelled) setCompanionOnline(status.online);
      } catch {
        if (!cancelled) setCompanionOnline(false);
      }
    }

    void checkCompanionHealth();
    const interval = window.setInterval(() => {
      void checkCompanionHealth();
    }, 5000);

    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, [authenticated]);

  useEffect(() => {
    if (!authenticated || disks.length === 0) return;
    localStorage.setItem("videocat-connected-disks", connectedDiskIds.join(","));
  }, [authenticated, connectedDiskIds, disks.length]);

  const diskQuery = connectedDiskIds.join(",");

  useEffect(() => {
    if (!authenticated || disks.length === 0) return;
    if (connectedDiskIds.length === 0) {
      setFacets({ folders: [], tags: [], extensions: [], curationStatuses: [], protectedUnlocked: false });
      setSelectedFolders([]);
      setExpandedFolders([]);
      setFolderSearch("");
      setSelectedTags([]);
      return;
    }

    const params = new URLSearchParams();
    params.set("diskIds", diskQuery);
    api<FacetResponse>(`/api/facets?${params.toString()}`).then((response) => {
      setFacets(response);
      setProtectedUnlocked(response.protectedUnlocked);
      setSelectedFolders((current) => current.filter((folder) => response.folders.some((item) => item.path === folder)));
      setExpandedFolders((current) => current.filter((folder) => response.folders.some((item) => item.path === folder)));
      setSelectedTags((current) => current.filter((tag) => response.tags.some((item) => item.tag === tag)));
      if (extension && !response.extensions.some((item) => item.extension === extension)) {
        setExtension("");
      }
    });
  }, [authenticated, catalogVersion, connectedDiskIds.length, diskQuery, disks.length, extension, protectedUnlockVersion]);

  useEffect(() => {
    if (!authenticated) return;
    if (disks.length > 0 && connectedDiskIds.length === 0) {
      setFiles([]);
      setTotal(0);
      return;
    }
    const params = new URLSearchParams({
      page: String(page),
      pageSize: String(pageSize),
      sortBy,
      sortDirection
    });
    if (q.trim()) params.set("q", q.trim());
    if (diskQuery) params.set("diskIds", diskQuery);
    if (extension) params.set("extension", extension);
    if (selectedFolders.length > 0) params.set("folders", selectedFolders.join(","));
    if (selectedTags.length > 0) params.set("tags", selectedTags.join(","));
    if (duplicateOnly) params.set("duplicateOnly", "true");
    if (curationStatus) params.set("curationStatus", curationStatus);

    setLoading(true);
    api<FileResponse>(`/api/files?${params.toString()}`)
      .then((response) => {
        setFiles(response.files);
        setTotal(response.total);
      })
      .finally(() => setLoading(false));
  }, [
    authenticated,
    catalogVersion,
    connectedDiskIds.length,
    diskQuery,
    disks.length,
    duplicateOnly,
    curationStatus,
    extension,
    page,
    pageSize,
    q,
    selectedFolders,
    selectedTags,
    sortBy,
    sortDirection,
    protectedUnlockVersion
  ]);

  useEffect(() => {
    if (!authenticated || viewMode === "catalog" || viewMode === "review" || viewMode === "downloads" || viewMode === "admin" || viewMode === "profile") return;
    if (disks.length > 0 && connectedDiskIds.length === 0) {
      setFolderUsage([]);
      setDuplicateGroups([]);
      setAuditSummary([]);
      setAuditErrors([]);
      return;
    }

    const params = new URLSearchParams();
    if (diskQuery) params.set("diskIds", diskQuery);

    setAuxLoading(true);
    const endpoint =
      viewMode === "usage"
        ? `/api/folder-usage?${params.toString()}`
        : viewMode === "duplicates"
          ? `/api/duplicates/by-size?${params.toString()}`
          : `/api/audit/errors?${params.toString()}`;
    api<
      | { folders: FolderUsageItem[] }
      | { groups: DuplicateGroup[] }
      | { summary: AuditSummaryItem[]; errors: AuditErrorItem[] }
    >(endpoint)
      .then((response) => {
        if ("folders" in response) {
          setFolderUsage(response.folders);
        } else if ("groups" in response) {
          setDuplicateGroups(response.groups);
        } else {
          setAuditSummary(response.summary);
          setAuditErrors(response.errors);
        }
      })
      .finally(() => setAuxLoading(false));
  }, [authenticated, catalogVersion, connectedDiskIds.length, diskQuery, disks.length, viewMode]);

  useEffect(() => {
    if (!authenticated || viewMode !== "profile") return;
    setProfileLoading(true);
    setProfileError("");
    api<ProfileSecurityResponse>("/api/profile/security")
      .then((response) => {
        setProfileSecurity(response);
        setProfilePatternsText(response.protectedFolderPatterns.join("\n"));
      })
      .catch((error) => setProfileError(error instanceof Error ? error.message : "No se pudo cargar el perfil."))
      .finally(() => setProfileLoading(false));
  }, [authenticated, catalogVersion, viewMode]);

  useEffect(() => {
    if (!selectedAuditError) return;

    function handleKey(event: KeyboardEvent) {
      if (event.key === "Escape") setSelectedAuditError(null);
    }

    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [selectedAuditError]);

  useEffect(() => {
    if (!authenticated || viewMode !== "review") return;
    void loadReviewSummary();
  }, [authenticated, catalogVersion, connectedDiskIds.length, diskQuery, disks.length, protectedUnlockVersion, viewMode]);

  useEffect(() => {
    if (!authenticated || viewMode !== "review") return;
    const interval = window.setInterval(() => {
      void loadReviewSummary();
    }, 60000);
    return () => window.clearInterval(interval);
  }, [authenticated, connectedDiskIds.length, diskQuery, disks.length, protectedUnlockVersion, viewMode]);

  useEffect(() => {
    if (!authenticated || viewMode !== "downloads") return;
    void loadDownloadSummary();
    const interval = window.setInterval(() => {
      void loadDownloadSummary();
    }, 10000);
    return () => window.clearInterval(interval);
  }, [authenticated, catalogVersion, connectedDiskIds.length, diskQuery, disks.length, protectedUnlockVersion, viewMode]);

  async function login(event: FormEvent) {
    event.preventDefault();
    setLoginError("");
    try {
      await api("/api/auth/login", {
        method: "POST",
        body: JSON.stringify({ username, password })
      });
      setAuthenticated(true);
    } catch (error) {
      setLoginError(error instanceof Error ? error.message : "No se pudo iniciar sesion");
    }
  }

  async function logout() {
    await api("/api/auth/logout", { method: "POST" });
    setAuthenticated(false);
    setPassword("");
  }

  async function openDetail(file: VideoFile) {
    const response = await api<{ file: VideoFile; duplicates: VideoFile[] }>(`/api/files/${file.id}`);
    setSelected(response.file);
    setDuplicates(response.duplicates);
  }

  async function loadReviewSummary() {
    if (disks.length > 0 && connectedDiskIds.length === 0) {
      setReviewRecent([]);
      setReviewPending([]);
      setReviewMarkedToday(0);
      setReviewMarkedLast7Days(0);
      setReviewPendingTotal(0);
      setReviewRemaining(0);
      return;
    }

    const response = await api<ReviewSummaryResponse>(`/api/review/summary${reviewQuerySuffix()}`);
    setReviewRecent(response.recent);
    setReviewPending(response.pending);
    setReviewMarkedToday(response.markedToday);
    setReviewMarkedLast7Days(response.markedLast7Days);
    setReviewFreedBytes(response.freedBytes);
    setReviewPendingTotal(response.pendingTotal);
    setReviewRemaining(response.pendingTotal);
  }

  async function loadNextReviewVideo() {
    if (disks.length > 0 && connectedDiskIds.length === 0) {
      setReviewCurrent(null);
      setReviewRemaining(0);
      setReviewMessage("Selecciona al menos un disco conectado para iniciar Review.");
      return;
    }

    setReviewLoading(true);
    setReviewMessage("");
    try {
      const response = await api<ReviewNextResponse>(`/api/review/next${reviewQuerySuffix()}`);
      setReviewCurrent(response.file);
      setReviewRemaining(response.remaining);
      if (!response.file) {
        setReviewMessage("No quedan videos pendientes por revisar en los discos seleccionados.");
        await loadReviewSummary();
      }
    } finally {
      setReviewLoading(false);
    }
  }

  async function openRecoverableSpace() {
    setRecoverableSpaceOpen(true);
    setRecoverableSpaceLoading(true);
    setRecoverableSpaceError("");
    try {
      const response = await api<RecoverableSpaceResponse>("/api/review/recoverable-space");
      setRecoverableSpace(response);
    } catch (error) {
      setRecoverableSpaceError(error instanceof Error ? error.message : "No se pudo calcular el espacio a recuperar");
    } finally {
      setRecoverableSpaceLoading(false);
    }
  }

  async function loadDownloadSummary() {
    if (disks.length > 0 && connectedDiskIds.length === 0) {
      setDownloadSummary({ paused: false, counts: {}, pendingBytes: 0, entries: [] });
      return;
    }
    const params = new URLSearchParams();
    if (diskQuery) params.set("diskIds", diskQuery);
    setDownloadLoading(true);
    try {
      const response = await api<DownloadSummaryResponse>(`/api/downloads/summary?${params.toString()}`);
      setDownloadSummary(response);
      const removableIds = new Set(response.entries.filter((entry) => entry.status === "queued" || entry.status === "failed").map((entry) => entry.id));
      setSelectedDownloadQueueIds((current) => current.filter((id) => removableIds.has(id)));
    } finally {
      setDownloadLoading(false);
    }
  }

  async function queueSelectedDownloads() {
    if (selectedFileIds.length === 0 || bulkBusy) return;
    setBulkBusy(true);
    setBulkMessage("");
    try {
      const response = await api<{ ok: boolean; queued: number }>("/api/downloads/queue", {
        method: "POST",
        body: JSON.stringify({ fileIds: selectedFileIds })
      });
      setSelectedFileIds([]);
      setBulkMessage(`${response.queued} archivo(s) enviados a "A descargar".`);
      setCatalogVersion((value) => value + 1);
    } catch (error) {
      setBulkMessage(error instanceof Error ? error.message : "No se pudo enviar a descarga.");
    } finally {
      setBulkBusy(false);
    }
  }

  async function queueRandomDownloads() {
    const targetGb = Number(randomDownloadGb);
    if (!Number.isFinite(targetGb) || targetGb <= 0) {
      setDownloadMessage("Indica un tamaño en GB mayor a cero.");
      return;
    }
    if (connectedDiskIds.length === 0) {
      setDownloadMessage("Selecciona al menos un disco conectado.");
      return;
    }

    setDownloadLoading(true);
    setDownloadMessage("");
    try {
      const response = await api<RandomDownloadResponse>("/api/downloads/random", {
        method: "POST",
        body: JSON.stringify({ diskIds: connectedDiskIds, targetGb })
      });
      setDownloadMessage(
        response.queued > 0
          ? `${response.queued} video(s) aleatorios enviados a cola (${formatBytes(response.queuedBytes)}).`
          : "No encontré videos disponibles que no hubieran sido descargados o puestos en cola antes."
      );
      setCatalogVersion((value) => value + 1);
      await loadDownloadSummary();
    } catch (error) {
      setDownloadMessage(error instanceof Error ? error.message : "No se pudo crear la cola aleatoria.");
    } finally {
      setDownloadLoading(false);
    }
  }

  async function setDownloadPaused(paused: boolean) {
    setDownloadActionBusy(true);
    setDownloadMessage("");
    try {
      const response = await api<{ ok: boolean; paused: boolean }>("/api/downloads/pause", {
        method: "PATCH",
        body: JSON.stringify({ paused })
      });
      setDownloadSummary((current) => current ? { ...current, paused: response.paused } : current);
      setDownloadMessage(response.paused ? "Cola de descarga pausada." : "Cola de descarga reanudada.");
      await loadDownloadSummary();
    } catch (error) {
      setDownloadMessage(error instanceof Error ? error.message : "No se pudo cambiar el estado de la cola.");
    } finally {
      setDownloadActionBusy(false);
    }
  }

  async function clearDownloadQueue() {
    const confirmMessage = language === "en"
      ? "This will clear pending and failed items from the download queue. It does not delete already downloaded files or original videos. Continue?"
      : "Esto vaciara los pendientes y fallidos de la cola de descarga. No borra archivos ya descargados ni videos originales. Quieres continuar?";
    if (!window.confirm(confirmMessage)) return;

    setDownloadActionBusy(true);
    setDownloadMessage("");
    try {
      const response = await api<{ ok: boolean; cleared: number }>("/api/downloads/queue", { method: "DELETE" });
      setDownloadMessage(`${response.cleared} elemento(s) retirados de la cola.`);
      setCatalogVersion((value) => value + 1);
      await loadDownloadSummary();
    } catch (error) {
      setDownloadMessage(error instanceof Error ? error.message : "No se pudo vaciar la cola.");
    } finally {
      setDownloadActionBusy(false);
    }
  }

  function toggleDownloadSelection(entry: DownloadQueueEntry) {
    if (entry.status !== "queued" && entry.status !== "failed") return;
    setDownloadMessage("");
    setSelectedDownloadQueueIds((current) =>
      current.includes(entry.id) ? current.filter((id) => id !== entry.id) : [...current, entry.id]
    );
  }

  function toggleAllRemovableDownloads(checked: boolean) {
    setDownloadMessage("");
    const ids = removableDownloadEntries.map((entry) => entry.id);
    setSelectedDownloadQueueIds((current) => {
      if (!checked) return current.filter((id) => !ids.includes(id));
      return [...new Set([...current, ...ids])];
    });
  }

  async function removeSelectedDownloads() {
    if (selectedDownloadQueueIds.length === 0 || downloadActionBusy) return;
    setDownloadActionBusy(true);
    setDownloadMessage("");
    try {
      const response = await api<{ ok: boolean; removed: number; skipped: number }>("/api/downloads/queue/remove", {
        method: "POST",
        body: JSON.stringify({ queueIds: selectedDownloadQueueIds })
      });
      setDownloadMessage(
        `${response.removed} elemento(s) retirados de la cola.` +
        (response.skipped > 0 ? ` ${response.skipped} no se retiraron porque ya estaban en proceso o terminados.` : "")
      );
      setSelectedDownloadQueueIds([]);
      setCatalogVersion((value) => value + 1);
      await loadDownloadSummary();
    } catch (error) {
      setDownloadMessage(error instanceof Error ? error.message : "No se pudieron retirar elementos de la cola.");
    } finally {
      setDownloadActionBusy(false);
    }
  }

  async function processDownloadQueueNow() {
    setDownloadActionBusy(true);
    setDownloadMessage("");
    try {
      const port = localStorage.getItem("videocat-companion-port") ?? "29429";
      const token = localStorage.getItem("videocat-companion-token") ?? "";
      const headers = new Headers();
      if (token) headers.set("X-VideoCat-Companion-Token", token);
      const response = await fetch(`http://127.0.0.1:${port}/process-downloads`, {
        method: "POST",
        headers
      });
      const result = await response.json().catch(() => ({ ok: false, reason: "open_failed" })) as CompanionProcessDownloadsResponse;
      if (!response.ok || !result.ok) {
        const message = result.reason === "forbidden"
          ? "Token local no valido para el companion."
          : result.reason === "not_available"
            ? "Companion no disponible."
            : result.detail ?? "No se pudo procesar la cola.";
        setDownloadMessage(message);
        return;
      }
      setDownloadMessage(`Procesamiento solicitado al companion (${result.processedDisks ?? 0} disco(s) revisados).`);
      window.setTimeout(() => void loadDownloadSummary(), 1200);
    } catch {
      setDownloadMessage("Companion no iniciado o bloqueado por el navegador.");
    } finally {
      setDownloadActionBusy(false);
    }
  }

  async function decideReview(file: VideoFile, status: "keep" | "delete") {
    setReviewLoading(true);
    try {
      const response = await api<{ file: VideoFile }>(`/api/files/${file.id}/curation`, {
        method: "PATCH",
        body: JSON.stringify({ curationStatus: status })
      });
      setFiles((current) => current.map((item) => (item.id === response.file.id ? response.file : item)));
      setDuplicates((current) => current.map((item) => (item.id === response.file.id ? response.file : item)));
      setReviewRecent((current) => [response.file, ...current.filter((item) => item.id !== response.file.id)].slice(0, 24));
      setReviewPending((current) => current.filter((item) => item.id !== response.file.id));
      setReviewMarkedToday((value) => value + 1);
      setReviewMarkedLast7Days((value) => value + 1);
      setReviewPendingTotal((value) => Math.max(0, value - 1));
      setCatalogVersion((value) => value + 1);
      const next = await api<ReviewNextResponse>(`/api/review/next${reviewQuerySuffix()}`);
      setReviewCurrent(next.file);
      setReviewRemaining(next.remaining);
      if (!next.file) setReviewMessage("No quedan videos pendientes por revisar en los discos seleccionados.");
      void loadReviewSummary();
    } finally {
      setReviewLoading(false);
    }
  }

  function openAdjacentDetail(offset: -1 | 1) {
    if (selectedIndex < 0) return;
    const nextFile = files[selectedIndex + offset];
    if (!nextFile) return;
    void openDetail(nextFile);
  }

  function requestProtectedFolderPin(folder: string, action: ProtectedPinPrompt["action"]) {
    setProtectedPin("");
    setPinSubmitting(false);
    setPinPrompt({ folder, action });
  }

  function isFolderLocked(folder: string): boolean {
    if (protectedUnlocked) return false;
    return facets.folders.some((item) => item.path === folder && item.locked);
  }

  async function unlockProtectedFolder(pin: string) {
    if (!pinPrompt || pinSubmitting) return;
    const prompt = pinPrompt;
    setPinSubmitting(true);
    try {
      await api<{ ok: boolean; unlocked: boolean }>("/api/protected-folder/unlock", {
        method: "POST",
        body: JSON.stringify({ pin })
      });

      setProtectedUnlocked(true);
      setProtectedUnlockVersion((value) => value + 1);
      setPinPrompt(null);
      setProtectedPin("");

      if (prompt.action === "expand") {
        setExpandedFolders((current) => (current.includes(prompt.folder) ? current : [...current, prompt.folder]));
      } else {
        const hasChildren = (folderChildren.get(prompt.folder) ?? 0) > 0;
        if (hasChildren) {
          setExpandedFolders((current) => (current.includes(prompt.folder) ? current : [...current, prompt.folder]));
        }
        setSelectedFolders((current) => nextSelectedFolders(current, prompt.folder));
        setPage(1);
      }
    } catch {
      setPinPrompt(null);
      setProtectedPin("");
    } finally {
      setPinSubmitting(false);
    }
  }

  function handleProtectedPinChange(value: string) {
    const digits = value.replace(/\D/g, "").slice(0, 4);
    setProtectedPin(digits);
    if (digits.length === 4) void unlockProtectedFolder(digits);
  }

  function clearDiskScopedFilters() {
    setSelectedFolders([]);
    setExpandedFolders([]);
    setFolderSearch("");
    setSelectedTags([]);
    setPage(1);
  }

  function toggleDisk(diskId: string) {
    setConnectedDiskIds((current) =>
      current.includes(diskId) ? current.filter((id) => id !== diskId) : [...current, diskId]
    );
    clearDiskScopedFilters();
  }

  function selectAllDisks() {
    setConnectedDiskIds(disks.map((disk) => disk.id));
    clearDiskScopedFilters();
  }

  function selectNoDisks() {
    setConnectedDiskIds([]);
    clearDiskScopedFilters();
  }

  async function showMountedDisksFromCompanion() {
    const port = localStorage.getItem("videocat-companion-port") ?? "29429";
    const token = localStorage.getItem("videocat-companion-token") ?? "";
    setDetectingConnected(true);
    setConnectedMessage("");

    try {
      const headers = new Headers();
      if (token) headers.set("X-VideoCat-Companion-Token", token);
      const response = await fetch(`http://127.0.0.1:${port}/mounted-disks`, { headers });
      const result = await response.json().catch(() => ({ ok: false, disks: [] })) as { ok?: boolean; disks?: MountedCompanionDisk[]; reason?: string };
      if (response.status === 401 || response.status === 403 || result.reason === "forbidden") {
        setConnectedMessage("Token local no valido");
        return;
      }
      if (!response.ok || !result.ok) {
        setConnectedMessage("No se pudieron consultar discos conectados");
        return;
      }

      const refreshed = await api<{ disks: Disk[] }>("/api/disks");
      setDisks(refreshed.disks);

      const mountedDisks = result.disks ?? [];
      const mountedIds = new Set(mountedDisks.map((disk) => disk.diskId));
      const matchingIds = refreshed.disks
        .filter((disk) => mountedIds.has(disk.volumeId ?? "") || mountedIds.has(disk.id))
        .map((disk) => disk.id);
      const unmatchedCount = Math.max(0, mountedDisks.length - matchingIds.length);

      setConnectedDiskIds(matchingIds);
      clearDiskScopedFilters();
      setConnectedMessage(
        matchingIds.length > 0
          ? `${matchingIds.length} disco(s) conectados detectados${unmatchedCount > 0 ? `; ${unmatchedCount} sin catalogo asociado` : ""}`
          : "No hay discos VideoCAT conectados detectados"
      );
    } catch {
      setConnectedMessage("Companion no iniciado");
    } finally {
      setDetectingConnected(false);
    }
  }

  function toggleFolder(folder: string) {
    if (isFolderLocked(folder)) {
      requestProtectedFolderPin(folder, "select");
      return;
    }

    const hasChildren = (folderChildren.get(folder) ?? 0) > 0;
    if (hasChildren) {
      setExpandedFolders((current) => (current.includes(folder) ? current : [...current, folder]));
    }
    setSelectedFolders((current) => nextSelectedFolders(current, folder));
    setPage(1);
  }

  function toggleFolderExpansion(folder: string) {
    if (isFolderLocked(folder)) {
      requestProtectedFolderPin(folder, "expand");
      return;
    }

    setExpandedFolders((current) =>
      current.includes(folder) ? current.filter((item) => item !== folder) : [...current, folder]
    );
  }

  function toggleTag(tag: string) {
    setSelectedTags((current) => (current.includes(tag) ? current.filter((item) => item !== tag) : [...current, tag]));
    setPage(1);
  }

  function toggleFileSelection(fileId: string) {
    setBulkMessage("");
    setSelectedFileIds((current) =>
      current.includes(fileId) ? current.filter((id) => id !== fileId) : [...current, fileId]
    );
  }

  function toggleVisibleSelection(checked: boolean) {
    setBulkMessage("");
    const visibleIds = files.map((file) => file.id);
    setSelectedFileIds((current) => {
      if (!checked) return current.filter((id) => !visibleIds.includes(id));
      return [...new Set([...current, ...visibleIds])];
    });
  }

  function clearFileSelection() {
    setSelectedFileIds([]);
    setBulkMessage("");
  }

  function changeSort(field: SortBy) {
    setSortBy((current) => {
      if (current === field) {
        setSortDirection((direction) => (direction === "asc" ? "desc" : "asc"));
        return current;
      }
      setSortDirection(field === "filename" ? "asc" : "desc");
      return field;
    });
    setPage(1);
  }

  function clearFilters() {
    setQ("");
    setExtension("");
    setSelectedFolders([]);
    setExpandedFolders([]);
    setFolderSearch("");
    setSelectedTags([]);
    setDuplicateOnly(false);
    setCurationStatus("");
    setConnectedDiskIds(disks.map((disk) => disk.id));
    setSortBy("modifiedAt");
    setSortDirection("desc");
    setPage(1);
  }

  function showFullCatalog() {
    clearFilters();
    setViewMode("catalog");
    setSelected(null);
    setReviewCurrent(null);
    setReviewMessage("");
  }

  async function toggleFileCategory(file: VideoFile, categoryKey: string, enabled: boolean) {
    const response = await api<{ file: VideoFile }>(`/api/files/${file.id}/categories/${categoryKey}`, {
      method: "PATCH",
      body: JSON.stringify({ enabled })
    });
    setFiles((current) => current.map((item) => (item.id === response.file.id ? response.file : item)));
    setDuplicates((current) => current.map((item) => (item.id === response.file.id ? response.file : item)));
    setSelected((current) => (current?.id === response.file.id ? response.file : current));
    setReviewCurrent((current) => (current?.id === response.file.id ? response.file : current));
    setReviewRecent((current) => current.map((item) => (item.id === response.file.id ? response.file : item)));
    setCatalogVersion((value) => value + 1);
    if (viewMode === "review" && (categoryKey === "keep" || categoryKey === "delete")) {
      void loadReviewSummary();
    }
  }

  async function applyBulkCategory(categoryKey: string, enabled: boolean) {
    if (selectedFileIds.length === 0 || bulkBusy) return;
    setBulkBusy(true);
    setBulkMessage("");
    try {
      const response = await api<{ files: VideoFile[] }>(`/api/files/batch/categories/${categoryKey}`, {
        method: "PATCH",
        body: JSON.stringify({ fileIds: selectedFileIds, enabled })
      });
      const updatedById = new Map(response.files.map((file) => [file.id, file]));
      const updateList = (items: VideoFile[]) => items.map((item) => updatedById.get(item.id) ?? item);
      setFiles(updateList);
      setDuplicates(updateList);
      setReviewPending((current) => updateList(current).filter((file) => file.curationStatus !== "keep" && file.curationStatus !== "delete"));
      setReviewRecent(updateList);
      setReviewCurrent((current) => (current ? updatedById.get(current.id) ?? current : current));
      setSelected((current) => (current ? updatedById.get(current.id) ?? current : current));
      setSelectedFileIds([]);
      setBulkMessage(`${response.files.length} archivo(s) actualizados.`);
      setCatalogVersion((value) => value + 1);
    } catch (error) {
      setBulkMessage(error instanceof Error ? error.message : "No se pudo aplicar la acción por lote.");
    } finally {
      setBulkBusy(false);
    }
  }

  function removeDeletedFile(fileId: string) {
    setSelected((current) => (current?.id === fileId ? null : current));
    setFiles((current) => current.filter((file) => file.id !== fileId));
    setDuplicates((current) => current.filter((file) => file.id !== fileId));
    setSelectedFileIds((current) => current.filter((id) => id !== fileId));
    setDuplicateGroups((current) =>
      current
        .map((group) => {
          const nextFiles = group.files.filter((file) => file.id !== fileId);
          return { ...group, files: nextFiles, count: nextFiles.length };
        })
        .filter((group) => group.files.length > 1)
    );
    setTotal((current) => Math.max(0, current - 1));
    setCatalogVersion((value) => value + 1);
  }

  async function createCategory(event: FormEvent) {
    event.preventDefault();
    const label = newCategoryLabel.trim();
    if (!label) return;
    setCategoryError("");
    setCategorySubmitting(true);
    try {
      await api("/api/categories", {
        method: "POST",
        body: JSON.stringify({ label, color: newCategoryColor })
      });
      setNewCategoryLabel("");
      setNewCategoryColor(defaultCategoryColor);
      setCatalogVersion((value) => value + 1);
    } catch (error) {
      setCategoryError(error instanceof Error ? error.message : "No se pudo crear la categoria");
    } finally {
      setCategorySubmitting(false);
    }
  }

  async function deleteCategory(category: CurationCategory) {
    const message = language === "en"
      ? category.count > 0
        ? `Deleting "${category.label}" will remove this category from ${category.count} videos.`
        : `Delete "${category.label}".`
      : category.count > 0
        ? `Eliminar "${category.label}" quitara esta categoria de ${category.count} videos.`
        : `Eliminar "${category.label}".`;
    if (!window.confirm(`${message}\n\n${language === "en" ? "Continue?" : "Quieres continuar?"}`)) return;

    setCategoryError("");
    try {
      await api(`/api/categories/${category.key}`, { method: "DELETE" });
      if (curationStatus === category.key) {
        setCurationStatus("");
        setPage(1);
      }
      setFiles((current) =>
        current.map((file) => (file.curationStatus === category.key ? { ...file, curationStatus: "none" } : file))
      );
      setDuplicates((current) =>
        current.map((file) => (file.curationStatus === category.key ? { ...file, curationStatus: "none" } : file))
      );
      setSelected((current) =>
        current?.curationStatus === category.key ? { ...current, curationStatus: "none" } : current
      );
      setCatalogVersion((value) => value + 1);
    } catch (error) {
      setCategoryError(error instanceof Error ? error.message : "No se pudo eliminar la categoria");
    }
  }

  function handlePageInput(value: string) {
    const nextPage = Number(value);
    if (!Number.isInteger(nextPage)) return;
    setPage(Math.min(pageCount, Math.max(1, nextPage)));
  }

  function handlePageSizeChange(value: string) {
    const nextPageSize = Number(value);
    if (!pageSizeOptions.includes(nextPageSize as (typeof pageSizeOptions)[number])) return;
    setPageSize(nextPageSize);
    setPage(1);
  }

  async function purgeDiskCatalog(disk: Disk) {
    const firstConfirmation = window.confirm(
      language === "en"
        ? `This will remove all indexed VideoCAT content for "${disk.name}".\n\n` +
          "It includes cataloged videos, generated thumbnails, scans and audit errors for this drive. " +
          "It does not delete files from the external hard drive.\n\nContinue?"
        : `Esto eliminara de VideoCAT todo el contenido indexado para "${disk.name}".\n\n` +
          "Incluye videos catalogados, miniaturas generadas, escaneos y errores de auditoria de esa unidad. " +
          "No borra archivos del disco duro externo.\n\nQuieres continuar?"
    );
    if (!firstConfirmation) return;

    const typed = window.prompt(
      language === "en"
        ? `To confirm cleaning "${disk.name}", type BORRAR:`
        : `Para confirmar la limpieza de "${disk.name}", escribe BORRAR:`
    );
    if (typed !== "BORRAR") return;

    setAdminBusyDiskId(disk.id);
    setAdminMessage("");
    setAdminError("");
    try {
      const response = await api<AdminPurgeResponse>(`/api/admin/disks/${disk.id}/catalog`, { method: "DELETE" });
      setSelected((current) => (current?.diskId === disk.id ? null : current));
      setDuplicates((current) => current.filter((file) => file.diskId !== disk.id));
      setFiles((current) => current.filter((file) => file.diskId !== disk.id));
      setPage(1);
      setCatalogVersion((value) => value + 1);
      setAdminMessage(
        `Unidad "${response.disk.name}" limpia: ${response.deleted.files} videos, ` +
        `${response.deleted.thumbnails} miniaturas, ${response.deleted.errors} errores y ` +
        `${response.deleted.scans} escaneos eliminados.` +
        (response.thumbnailFilesRemoved ? "" : ` Aviso: ${response.thumbnailFileWarning ?? "no se pudieron eliminar algunos archivos de miniaturas"}.`)
      );
    } catch (error) {
      setAdminError(error instanceof Error ? error.message : "No se pudo limpiar la unidad");
    } finally {
      setAdminBusyDiskId(null);
    }
  }

  function parseProfilePatterns(): string[] {
    const seen = new Set<string>();
    return profilePatternsText
      .split(/[\n,]+/)
      .map((item) => item.trim())
      .filter(Boolean)
      .filter((item) => {
        const normalized = item.toLowerCase();
        if (seen.has(normalized)) return false;
        seen.add(normalized);
        return true;
      })
      .slice(0, 50);
  }

  async function saveProfileSecurity(event: FormEvent) {
    event.preventDefault();
    const nextPin = profileNewPin.trim();
    if (nextPin && !/^\d{4}$/.test(nextPin)) {
      setProfileError("El nuevo PIN debe tener 4 digitos.");
      return;
    }

    setProfileSaving(true);
    setProfileMessage("");
    setProfileError("");
    try {
      const response = await api<ProfileSecurityResponse>("/api/profile/security", {
        method: "PATCH",
        body: JSON.stringify({
          currentPin: profileCurrentPin.trim(),
          newPin: nextPin,
          protectedFolderPatterns: parseProfilePatterns()
        })
      });
      setProfileSecurity(response);
      setProfilePatternsText(response.protectedFolderPatterns.join("\n"));
      setProfileCurrentPin("");
      setProfileNewPin("");
      setProfileMessage("Perfil actualizado.");
      setProtectedUnlockVersion((value) => value + 1);
      setCatalogVersion((value) => value + 1);
    } catch (error) {
      const message = error instanceof Error ? error.message : "No se pudo guardar el perfil.";
      setProfileError(message === "Current PIN is incorrect" ? "PIN actual incorrecto." : message);
    } finally {
      setProfileSaving(false);
    }
  }

  function beginFilterResize(event: ReactPointerEvent<HTMLButtonElement>) {
    const startX = event.clientX;
    const startWidth = filterWidth;
    event.currentTarget.setPointerCapture(event.pointerId);

    function handleMove(moveEvent: PointerEvent) {
      const nextWidth = startWidth + moveEvent.clientX - startX;
      setFilterWidth(Math.min(maxFilterWidth, Math.max(minFilterWidth, nextWidth)));
    }

    function handleUp() {
      window.removeEventListener("pointermove", handleMove);
      window.removeEventListener("pointerup", handleUp);
    }

    window.addEventListener("pointermove", handleMove);
    window.addEventListener("pointerup", handleUp, { once: true });
  }

  if (!sessionChecked) {
    return <div className="boot">VideoCAT</div>;
  }

  if (!authenticated) {
    return (
      <main className="login-screen">
        <WaterRippleBackdrop />
        <section className="login-panel">
          <div className="login-panel-actions">
            <select
              className="language-select"
              value={language}
              onChange={(event) => setLanguage(normalizeLanguage(event.target.value))}
              title="Idioma"
              aria-label="Idioma"
            >
              <option value="es">{languageLabel("es")}</option>
              <option value="en">{languageLabel("en")}</option>
            </select>
            <button className="theme-button login-theme-button" onClick={toggleTheme} title="Cambiar tema">
              {theme === "dark" ? <Sun size={18} /> : <Moon size={18} />}
            </button>
          </div>
          <div className="brand-lockup login-brand">
            <img className="brand-logo" src={activeLogo} alt="" />
            <div className="brand-word">
              Video<span>CAT</span>
            </div>
          </div>
          <form onSubmit={login} className="login-form">
            <label>
              Usuario
              <input value={username} onChange={(event) => setUsername(event.target.value)} autoComplete="username" />
            </label>
            <label>
              Contrasena
              <input
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                type="password"
                autoComplete="current-password"
              />
            </label>
            {loginError ? <div className="form-error">{loginError}</div> : null}
            <button type="submit" className="primary-button">
              <Shield size={18} />
              Entrar
            </button>
          </form>
        </section>
      </main>
    );
  }

  return (
    <main className="app-shell">
      <header className="topbar">
        <button className="brand-lockup brand-button" onClick={showFullCatalog} type="button" title="Mostrar catalogo completo">
          <img className="brand-logo" src={activeLogo} alt="" />
          <div className="brand-word">
            Video<span>CAT</span>
            <em
              className={`agent-status-dot ${companionOnline ? "is-online" : "is-offline"}`}
              title={companionOnline ? "Agente conectado" : "Agente desconectado"}
              aria-label={companionOnline ? "Agente conectado" : "Agente desconectado"}
            />
          </div>
        </button>
        <section className="view-switcher" aria-label="Secciones principales">
          <button className={viewMode === "catalog" ? "is-active" : ""} onClick={() => setViewMode("catalog")} type="button">
            <FileVideo size={17} />
            Catalogo
          </button>
          <button className={viewMode === "review" ? "is-active" : ""} onClick={() => setViewMode("review")} type="button">
            <Check size={17} />
            Review
          </button>
          <button className={viewMode === "downloads" ? "is-active" : ""} onClick={() => setViewMode("downloads")} type="button">
            <Download size={17} />
            A descargar
          </button>
          <button className={viewMode === "duplicates" ? "is-active" : ""} onClick={() => setViewMode("duplicates")} type="button">
            <AlertTriangle size={17} />
            Duplicados
          </button>
          <button className={viewMode === "usage" ? "is-active" : ""} onClick={() => setViewMode("usage")} type="button">
            <LayoutGrid size={17} />
            Esquema de uso
          </button>
          <button className={viewMode === "audit" ? "is-active" : ""} onClick={() => setViewMode("audit")} type="button">
            <AlertTriangle size={17} />
            Auditoria
          </button>
          <button className={viewMode === "admin" ? "is-active" : ""} onClick={() => setViewMode("admin")} type="button">
            <Trash2 size={17} />
            Administracion
          </button>
          <button className={viewMode === "profile" ? "is-active" : ""} onClick={() => setViewMode("profile")} type="button">
            <User size={17} />
            Perfil
          </button>
        </section>
        <div className="topbar-actions">
          <button className="theme-button" onClick={toggleTheme} title="Cambiar tema">
            {theme === "dark" ? <Sun size={18} /> : <Moon size={18} />}
          </button>
          <button className="icon-text-button logout-button" onClick={logout} type="button" title="Cerrar sesion">
            <LogOut size={18} />
            Salir
          </button>
        </div>
      </header>

      <section className="connected-panel">
        <div className="connected-heading">
          <HardDrive size={18} />
          <strong>Discos conectados</strong>
          <span className="connected-count">{connectedDiskIds.length} de {disks.length}</span>
          <div className="connected-actions">
            <button
              className="connected-action is-detect"
              disabled={detectingConnected}
              onClick={() => void showMountedDisksFromCompanion()}
              type="button"
            >
              {detectingConnected ? "Detectando..." : "Mostrar conectados"}
            </button>
            <button
              className="connected-action"
              disabled={connectedDiskIds.length === disks.length}
              onClick={selectAllDisks}
              type="button"
            >
              Todos
            </button>
            <button
              className="connected-action"
              disabled={connectedDiskIds.length === 0}
              onClick={selectNoDisks}
              type="button"
            >
              Ninguno
            </button>
          </div>
        </div>
        {connectedMessage ? <div className="connected-message">{connectedMessage}</div> : null}
        <div className="disk-pills">
          {disks.map((disk) => {
            const active = connectedDiskIds.includes(disk.id);
            return (
              <button
                key={disk.id}
                className={`disk-pill ${active ? "is-active" : ""}`}
                onClick={() => toggleDisk(disk.id)}
                type="button"
              >
                <span className="pill-check">{active ? <Check size={14} /> : null}</span>
                <span>{disk.name}</span>
                {disk.driveLetter ? <small>{disk.driveLetter}</small> : null}
              </button>
            );
          })}
        </div>
      </section>

      <section className="stats-grid">
        <div className="stat">
          <HardDrive size={20} />
          <span>Discos</span>
          <strong>{stats?.diskCount ?? 0}</strong>
        </div>
        <div className="stat">
          <Image size={20} />
          <span>Videos</span>
          <strong>{stats?.fileCount ?? 0}</strong>
        </div>
        <div className="stat">
          <Database size={20} />
          <span>Bytes catalogados</span>
          <strong>{formatBytes(stats?.totalBytes ?? 0)}</strong>
        </div>
        <div className="stat">
          <AlertTriangle size={20} />
          <span>Duplicados probables</span>
          <strong>{stats?.duplicateGroupCount ?? 0}</strong>
        </div>
      </section>

      {viewMode === "catalog" ? (
      <section className="catalog-layout" style={{ "--filter-width": `${filterWidth}px` } as CSSProperties}>
        <aside className="filters">
          <button
            className="filter-resize-handle"
            onPointerDown={beginFilterResize}
            type="button"
            title="Arrastrar para cambiar ancho"
            aria-label="Cambiar ancho de filtros"
          />
          <div className="section-title">
            <Filter size={17} />
            Filtros
          </div>
          <label>
            Extension
            <select value={extension} onChange={(event) => { setExtension(event.target.value); setPage(1); }}>
              <option value="">Todas</option>
              {extensions.map((item) => {
                const count = facets.extensions.find((extensionItem) => extensionItem.extension === item)?.count ?? 0;
                return (
                <option key={item} value={item}>
                  {item} ({count})
                </option>
                );
              })}
            </select>
          </label>
          <div className="facet-block">
            <div className="facet-title">Carpetas</div>
            <div className="folder-search">
              <Search size={15} />
              <input
                value={folderSearch}
                onChange={(event) => setFolderSearch(event.target.value)}
                placeholder="Buscar carpeta"
              />
              {folderSearch ? (
                <button onClick={() => setFolderSearch("")} type="button" title="Limpiar busqueda de carpetas">
                  <X size={14} />
                </button>
              ) : null}
            </div>
            <div className="folder-list">
              {visibleFolders.length > 0 ? (
                visibleFolders.map((folder) => (
                  <div
                    key={folder.path}
                    className={`folder-option ${selectedFolders.includes(folder.path) ? "is-active" : ""}`}
                    style={{ "--folder-depth": folder.depth } as CSSProperties}
                    title={folder.path}
                  >
                    <button
                      className="folder-expander"
                      onClick={() => toggleFolderExpansion(folder.path)}
                      disabled={!folder.hasChildren}
                      type="button"
                      title={folder.isExpanded ? "Colapsar carpeta" : "Expandir carpeta"}
                    >
                      {folder.hasChildren ? (
                        folder.isExpanded ? <ChevronDown size={15} /> : <ChevronRight size={15} />
                      ) : null}
                    </button>
                    <button className="folder-select" onClick={() => toggleFolder(folder.path)} type="button">
                      {folder.locked ? <Lock size={15} /> : <FolderOpen size={15} />}
                      <span>{folder.label}</span>
                      <small>{folder.count}</small>
                    </button>
                  </div>
                ))
              ) : (
                <div className="facet-empty">{folderSearch ? "Sin coincidencias de carpeta." : "Sin carpetas para estos discos."}</div>
              )}
            </div>
          </div>
          <label className="check-row">
            <input
              type="checkbox"
              checked={duplicateOnly}
              onChange={(event) => { setDuplicateOnly(event.target.checked); setPage(1); }}
            />
            Duplicados probables
          </label>
          <div className="facet-block">
            <div className="facet-title">Categorias</div>
            <div className="curation-filter-list">
              <button
                className={`curation-filter is-none ${curationStatus === "" ? "is-active" : ""}`}
                onClick={() => { setCurationStatus(""); setPage(1); }}
                type="button"
              >
                <span>Todas</span>
              </button>
              {facets.curationStatuses.map((item) => (
                <div className="curation-filter-row" key={item.key}>
                  <button
                    className={`curation-filter ${curationStatus === item.key ? "is-active" : ""}`}
                    style={categoryStyle(item.key, facets.curationStatuses)}
                    onClick={() => { setCurationStatus(item.key); setPage(1); }}
                    type="button"
                  >
                    <span>{item.label}</span>
                    <small>{item.count}</small>
                  </button>
                  {!item.builtIn ? (
                    <button
                      className="category-delete-button"
                      onClick={() => deleteCategory(item)}
                      type="button"
                      title={`Eliminar ${item.label}`}
                    >
                      <Trash2 size={15} />
                    </button>
                  ) : null}
                </div>
              ))}
            </div>
            <form className="category-create-form" onSubmit={createCategory}>
              <input
                value={newCategoryLabel}
                onChange={(event) => setNewCategoryLabel(event.target.value)}
                maxLength={32}
                placeholder="Nueva categoria"
              />
              <input
                className="category-color-input"
                value={newCategoryColor}
                onChange={(event) => setNewCategoryColor(event.target.value)}
                type="color"
                title="Color"
              />
              <button disabled={categorySubmitting || !newCategoryLabel.trim()} type="submit">
                Crear
              </button>
            </form>
            {categoryError ? <div className="form-error compact-error">{categoryError}</div> : null}
          </div>
          <div className="facet-block tags-block">
            <div className="facet-title">Etiquetas</div>
            <div className="tag-list">
              {facets.tags.length > 0 ? (
                facets.tags.map((item) => {
                  const hue = tagHue(item.tag);
                  const relevance = 0.88 + Math.min(0.28, item.count / maxTagCount / 3);
                  return (
                    <button
                      key={item.tag}
                      className={`tag-chip ${selectedTags.includes(item.tag) ? "is-active" : ""}`}
                      style={{
                        "--tag-hue": hue,
                        "--tag-scale": relevance
                      } as CSSProperties}
                      onClick={() => toggleTag(item.tag)}
                      type="button"
                    >
                      <span>{item.tag}</span>
                      <small>{item.count}</small>
                    </button>
                  );
                })
              ) : (
                <div className="facet-empty">Sin etiquetas repetidas.</div>
              )}
            </div>
          </div>
          <div className="sidebar-support-panel">
            <div className="support-links" aria-label="Apoyar VideoCAT">
              <span>
                <Heart size={14} />
                Apoyar VideoCAT
              </span>
              <a href={githubProfileUrl} target="_blank" rel="noreferrer" title="Perfil de GitHub">
                <Github size={14} />
                GitHub
              </a>
              {githubSponsorsUrl ? (
                <a href={githubSponsorsUrl} target="_blank" rel="noreferrer">
                  GitHub Sponsors
                </a>
              ) : (
                <span className="support-link-disabled" title="Configura VITE_GITHUB_SPONSORS_URL">
                  GitHub Sponsors
                </span>
              )}
              {paypalDonateUrl ? (
                <a href={paypalDonateUrl} target="_blank" rel="noreferrer">
                  PayPal
                </a>
              ) : (
                <span className="support-link-disabled" title="Configura VITE_PAYPAL_DONATE_URL">
                  PayPal
                </span>
              )}
            </div>
            <label className="sidebar-language-control">
              <span>Idioma</span>
              <select
                className="language-select"
                value={language}
                onChange={(event) => setLanguage(normalizeLanguage(event.target.value))}
                title="Idioma"
                aria-label="Idioma"
              >
                <option value="es">{languageLabel("es")}</option>
                <option value="en">{languageLabel("en")}</option>
              </select>
            </label>
          </div>
        </aside>

        <section className="results">
          <div className="searchbar">
            <div className="search-input-wrap">
              <Search size={19} />
              <input
                value={q}
                onChange={(event) => { setQ(event.target.value); setPage(1); }}
                placeholder="Buscar por nombre o ruta"
              />
              <span className="search-result-count">
                {total.toLocaleString(locale)} {total === 1 ? "resultado" : "resultados"}
              </span>
            </div>
            <label className="page-size-control">
              <span>Por pantalla</span>
              <select value={pageSize} onChange={(event) => handlePageSizeChange(event.target.value)}>
                {pageSizeOptions.map((option) => (
                  <option key={option} value={option}>
                    {option}
                  </option>
                ))}
              </select>
            </label>
          </div>

          {selectedFileIds.length > 0 ? (
            <div className="bulk-actions">
              <strong>{selectedFileIds.length.toLocaleString(locale)} seleccionado(s)</strong>
              <span>{visibleSelectedCount} en esta página</span>
              <select value={bulkCategoryKey} onChange={(event) => setBulkCategoryKey(event.target.value)}>
                <option value="">Elegir etiqueta</option>
                {facets.curationStatuses.map((category) => (
                  <option key={category.key} value={category.key}>
                    {category.label}
                  </option>
                ))}
              </select>
              <button
                className="secondary-button"
                disabled={!bulkCategoryKey || bulkBusy}
                onClick={() => void applyBulkCategory(bulkCategoryKey, true)}
                type="button"
              >
                Añadir
              </button>
              <button
                className="secondary-button"
                disabled={!bulkCategoryKey || bulkBusy}
                onClick={() => void applyBulkCategory(bulkCategoryKey, false)}
                type="button"
              >
                Quitar
              </button>
              <button
                className="danger-button"
                disabled={bulkBusy}
                onClick={() => void applyBulkCategory("delete", true)}
                type="button"
              >
                Marcar para borrar
              </button>
              <button
                className="secondary-button is-download"
                disabled={bulkBusy}
                onClick={() => void queueSelectedDownloads()}
                type="button"
              >
                <Download size={16} />
                A descargar
              </button>
              <button className="ghost-button" disabled={bulkBusy} onClick={clearFileSelection} type="button">
                Limpiar
              </button>
            </div>
          ) : null}
          {bulkMessage ? <div className="bulk-message">{bulkMessage}</div> : null}

          <div className="table-frame">
            <table>
              <thead>
                <tr>
                  <th className="select-column">
                    <input
                      aria-label="Seleccionar página"
                      checked={allVisibleSelected}
                      disabled={files.length === 0}
                      onChange={(event) => toggleVisibleSelection(event.target.checked)}
                      type="checkbox"
                    />
                  </th>
                  <th><SortHeader label="Archivo" field="filename" sortBy={sortBy} sortDirection={sortDirection} onSort={changeSort} /></th>
                  <th>Disco</th>
                  <th>Ruta</th>
                  <th><SortHeader label="Tamano" field="sizeBytes" sortBy={sortBy} sortDirection={sortDirection} onSort={changeSort} /></th>
                  <th><SortHeader label="Duracion" field="durationSeconds" sortBy={sortBy} sortDirection={sortDirection} onSort={changeSort} /></th>
                  <th>Resolucion</th>
                  <th>Codec</th>
                  <th><SortHeader label="Modificado" field="modifiedAt" sortBy={sortBy} sortDirection={sortDirection} onSort={changeSort} /></th>
                  <th>Indexado</th>
                </tr>
              </thead>
              <tbody>
                {files.map((file) => (
                  <tr
                    key={file.id}
                    className={[
                      file.isProbableDuplicate ? "duplicate-highlight" : "",
                      file.curationStatus !== "none" ? `curation-row is-${file.curationStatus}` : "",
                      selectedFileIdSet.has(file.id) ? "is-selected" : ""
                    ].filter(Boolean).join(" ")}
                    style={categoryStyle(file.curationStatus, facets.curationStatuses)}
                    onClick={() => void openDetail(file)}
                  >
                    <td className="select-column" onClick={(event) => event.stopPropagation()}>
                      <input
                        aria-label={`Seleccionar ${file.filename}`}
                        checked={selectedFileIdSet.has(file.id)}
                        onChange={() => toggleFileSelection(file.id)}
                        type="checkbox"
                      />
                    </td>
                    <td>
                      <div className="file-cell">
                        <div className="thumb">
                          {mainThumbnail(file) ? <img src={mainThumbnail(file)} alt="" /> : <Image size={22} />}
                        </div>
                        <div>
                          <strong>{file.filename}</strong>
                          <span>
                            {file.extension} {file.isProbableDuplicate ? "Duplicado probable" : ""}
                          </span>
                          <CategoryBadges file={file} categories={facets.curationStatuses} />
                        </div>
                      </div>
                    </td>
                    <td>{file.disk?.name ?? "-"}</td>
                    <td className="path-cell">{file.relativePath}</td>
                    <td>{formatBytes(file.sizeBytes)}</td>
                    <td>{formatDuration(file.durationSeconds)}</td>
                    <td>{resolution(file)}</td>
                    <td>{file.videoCodec ?? "-"}</td>
                    <td>{dateLabel(file.modifiedAt, locale)}</td>
                    <td>{dateLabel(file.lastIndexedAt, locale)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {loading ? <div className="loading">Cargando...</div> : null}
            {!loading && files.length === 0 ? <div className="empty">No hay archivos para estos filtros.</div> : null}
          </div>

          <div className="pagination">
            <button disabled={page <= 1} onClick={() => setPage((value) => Math.max(1, value - 1))}>
              Anterior
            </button>
            <label className="page-jump">
              <span>Pagina</span>
              <input
                value={page}
                min={1}
                max={pageCount}
                onChange={(event) => handlePageInput(event.target.value)}
                type="number"
              />
              <span>de {pageCount} · {total} archivos</span>
            </label>
            <button disabled={page >= pageCount} onClick={() => setPage((value) => Math.min(pageCount, value + 1))}>
              Siguiente
            </button>
          </div>
        </section>
      </section>
      ) : null}

      {viewMode === "review" ? (
        <section className="results review-view">
          <div className="view-header review-header">
            <div>
              <strong>Review</strong>
              <span>Revision aleatoria de videos pendientes de decision.</span>
            </div>
            <div className="review-header-actions">
              <button className="secondary-button review-space-button" onClick={() => void openRecoverableSpace()} type="button">
                <HardDrive size={17} />
                Espacio a recuperar
              </button>
              <button className="primary-button review-start-button" onClick={() => void loadNextReviewVideo()} disabled={reviewLoading} type="button">
                <Play size={17} />
                {reviewLoading ? "Cargando..." : "Iniciar Review"}
              </button>
            </div>
          </div>
          {reviewMessage ? <div className="review-message">{reviewMessage}</div> : null}
          <div className="review-scoreboard">
            <div className="review-score-card">
              <span>Pendientes</span>
              <strong>{reviewPendingTotal.toLocaleString(locale)}</strong>
            </div>
            <div className="review-score-card is-today">
              <span>Marcados hoy</span>
              <strong>{reviewMarkedToday.toLocaleString(locale)}</strong>
            </div>
            <div className="review-score-card">
              <span>Racha semanal</span>
              <strong>{reviewMarkedLast7Days.toLocaleString(locale)}</strong>
            </div>
            <div className="review-score-card is-freed">
              <span>GB liberados</span>
              <strong>{formatBytes(reviewFreedBytes)}</strong>
            </div>
          </div>
          <div className="review-recent-header">
            <strong>Pendientes de review</strong>
            <span>{reviewPending.length} de {reviewPendingTotal.toLocaleString(locale)}</span>
          </div>
          {reviewPending.length === 0 ? (
            <div className="empty">No quedan videos pendientes por revisar.</div>
          ) : (
            <div className="review-recent-grid">
              {reviewPending.map((file) => (
                <button
                  className="review-recent-card is-pending"
                  key={file.id}
                  onClick={() => void openDetail(file)}
                  type="button"
                >
                  <div className="review-recent-thumb">
                    {mainThumbnail(file) ? <img src={mainThumbnail(file)} alt="" /> : <Image size={24} />}
                  </div>
                  <div className="review-recent-main">
                    <strong>{file.filename}</strong>
                    <span>{file.disk?.name ?? "-"} · {file.relativePath}</span>
                  </div>
                  <CategoryBadges file={file} categories={facets.curationStatuses} />
                </button>
              ))}
            </div>
          )}
          <div className="review-recent-header">
            <strong>Ultimos sometidos al review</strong>
            <span>{reviewRecent.length} recientes</span>
          </div>
          {reviewRecent.length === 0 ? (
            <div className="empty">Aun no hay videos sometidos al review.</div>
          ) : (
            <div className="review-recent-grid">
              {reviewRecent.map((file) => (
                <button
                  className={`review-recent-card is-${file.curationStatus}`}
                  key={file.id}
                  onClick={() => void openDetail(file)}
                  style={categoryStyle(file.curationStatus, facets.curationStatuses)}
                  type="button"
                >
                  <div className="review-recent-thumb">
                    {mainThumbnail(file) ? <img src={mainThumbnail(file)} alt="" /> : <Image size={24} />}
                  </div>
                  <div className="review-recent-main">
                    <strong>{file.filename}</strong>
                    <span>{file.disk?.name ?? "-"} · {file.relativePath}</span>
                  </div>
                  <CategoryBadges file={file} categories={facets.curationStatuses} />
                </button>
              ))}
            </div>
          )}
        </section>
      ) : null}

      {viewMode === "downloads" ? (
        <section className="results downloads-view">
          <div className="view-header downloads-header">
            <div>
              <strong>A descargar</strong>
              <span>Cola local para copiar videos desde discos conectados usando el companion.</span>
            </div>
            <div className="download-header-actions">
              <button
                className="primary-button"
                disabled={downloadActionBusy || downloadSummary?.paused}
                onClick={() => void processDownloadQueueNow()}
                type="button"
              >
                <Play size={17} />
                Procesar cola
              </button>
              <button
                className="secondary-button"
                disabled={downloadActionBusy}
                onClick={() => void setDownloadPaused(!(downloadSummary?.paused ?? false))}
                type="button"
              >
                {downloadSummary?.paused ? <Play size={17} /> : <Pause size={17} />}
                {downloadSummary?.paused ? "Reanudar" : "Pausar"}
              </button>
              <button
                className="danger-button"
                disabled={downloadActionBusy}
                onClick={() => void clearDownloadQueue()}
                type="button"
              >
                <Trash2 size={17} />
                Vaciar cola
              </button>
              <button className="secondary-button" disabled={downloadLoading || downloadActionBusy} onClick={() => void loadDownloadSummary()} type="button">
                Actualizar
              </button>
            </div>
          </div>
          {downloadSummary?.paused ? <div className="download-paused-banner">Cola pausada: el companion no tomara nuevas descargas hasta reanudarla.</div> : null}

          <div className="download-scoreboard">
            <div className="review-score-card">
              <span>En cola</span>
              <strong>{(downloadSummary?.counts.queued ?? 0).toLocaleString(locale)}</strong>
            </div>
            <div className="review-score-card is-today">
              <span>Descargando</span>
              <strong>{(downloadSummary?.counts.downloading ?? 0).toLocaleString(locale)}</strong>
            </div>
            <div className="review-score-card">
              <span>Pendiente</span>
              <strong>{formatBytes(downloadSummary?.pendingBytes ?? 0)}</strong>
            </div>
            <div className="review-score-card is-freed">
              <span>Descargados</span>
              <strong>{(downloadSummary?.counts.done ?? 0).toLocaleString(locale)}</strong>
            </div>
          </div>

          <section className="random-download-panel">
            <div>
              <strong>Selección aleatoria</strong>
              <span>Elige un aproximado en GB y VideoCAT pondrá videos aleatorios de los discos conectados en cola.</span>
            </div>
            <label>
              <span>GB aproximados</span>
              <input
                min="0.1"
                step="0.1"
                value={randomDownloadGb}
                onChange={(event) => setRandomDownloadGb(event.target.value)}
                type="number"
              />
            </label>
            <button className="primary-button" disabled={downloadLoading || connectedDiskIds.length === 0} onClick={() => void queueRandomDownloads()} type="button">
              <Shuffle size={17} />
              Elegir al azar
            </button>
          </section>
          {downloadMessage ? <div className="review-message">{downloadMessage}</div> : null}

          {selectedDownloadQueueIds.length > 0 ? (
            <div className="bulk-actions download-bulk-actions">
              <strong>{selectedDownloadQueueIds.length.toLocaleString(locale)} seleccionado(s) en cola</strong>
              <span>Solo se pueden retirar pendientes o fallidos.</span>
              <button
                className="danger-button"
                disabled={downloadActionBusy}
                onClick={() => void removeSelectedDownloads()}
                type="button"
              >
                <Trash2 size={16} />
                Retirar de cola
              </button>
              <button className="ghost-button" disabled={downloadActionBusy} onClick={() => setSelectedDownloadQueueIds([])} type="button">
                Limpiar
              </button>
            </div>
          ) : null}

          <div className="table-frame">
            <table className="download-table">
              <thead>
                <tr>
                  <th className="select-column">
                    <input
                      aria-label="Seleccionar cola retirable"
                      checked={allRemovableDownloadsSelected}
                      disabled={removableDownloadEntries.length === 0}
                      onChange={(event) => toggleAllRemovableDownloads(event.target.checked)}
                      type="checkbox"
                    />
                  </th>
                  <th>Estado</th>
                  <th>Archivo</th>
                  <th>Disco</th>
                  <th>Tamaño</th>
                  <th>Solicitado</th>
                  <th>Destino / error</th>
                </tr>
              </thead>
              <tbody>
                {(downloadSummary?.entries ?? []).map((entry) => (
                  <tr key={entry.id} className={`download-row is-${entry.status}`} onClick={() => void openDetail(entry.file)}>
                    <td className="select-column" onClick={(event) => event.stopPropagation()}>
                      <input
                        aria-label={`Seleccionar ${entry.file.filename}`}
                        checked={selectedDownloadQueueIdSet.has(entry.id)}
                        disabled={entry.status !== "queued" && entry.status !== "failed"}
                        onChange={() => toggleDownloadSelection(entry)}
                        type="checkbox"
                      />
                    </td>
                    <td>
                      <span className={`download-status is-${entry.status}`}>
                        {downloadStatusLabel(entry.status)}
                      </span>
                      <div className="download-progress">
                        <div className="download-progress-track">
                          <span style={{ width: `${downloadProgressPercent(entry)}%` }} />
                        </div>
                        <small>
                          {downloadProgressPercent(entry)}%
                          {entry.status === "downloading"
                            ? ` · ${formatBytes(entry.progressBytes)} de ${formatBytes(entry.file.sizeBytes)}`
                            : null}
                        </small>
                      </div>
                    </td>
                    <td>
                      <div className="file-cell">
                        <div className="thumb">
                          {mainThumbnail(entry.file) ? <img src={mainThumbnail(entry.file)} alt="" /> : <Image size={22} />}
                        </div>
                        <div>
                          <strong>{entry.file.filename}</strong>
                          <span>{entry.file.relativePath}</span>
                          <CategoryBadges file={entry.file} categories={facets.curationStatuses} />
                        </div>
                      </div>
                    </td>
                    <td>{entry.file.disk?.name ?? "-"}</td>
                    <td>{formatBytes(entry.file.sizeBytes)}</td>
                    <td>{dateLabel(entry.requestedAt, locale)}</td>
                    <td className="path-cell">{entry.errorMessage ?? entry.destinationPath ?? entry.downloadedTag ?? "-"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {downloadLoading ? <div className="loading">Cargando...</div> : null}
            {!downloadLoading && (downloadSummary?.entries.length ?? 0) === 0 ? (
              <div className="empty">No hay archivos en cola de descarga.</div>
            ) : null}
          </div>
        </section>
      ) : null}

      {viewMode === "duplicates" ? (
        <section className="results duplicates-view">
          <div className="view-header">
            <div>
              <strong>Potenciales duplicados</strong>
              <span>Grupos por tamano exacto dentro de los discos conectados seleccionados.</span>
            </div>
          </div>
          {auxLoading ? <div className="loading">Cargando...</div> : null}
          {!auxLoading && duplicateGroups.length === 0 ? (
            <div className="empty">No hay duplicados probables para estos discos.</div>
          ) : null}
          <div className="duplicate-groups">
            {duplicateGroups.map((group) => (
              <article className="duplicate-group" key={group.sizeBytes}>
                <header className="duplicate-group-header">
                  <div>
                    <strong>{group.count} archivos posibles</strong>
                    <span>{formatBytes(group.sizeBytes)} cada uno</span>
                  </div>
                </header>
                <div className="duplicate-file-list">
                  {group.files.map((file) => (
                    <button
                      className={[
                        "duplicate-file-row",
                        file.curationStatus !== "none" ? `curation-row is-${file.curationStatus}` : ""
                      ].filter(Boolean).join(" ")}
                      key={file.id}
                      onClick={() => void openDetail(file)}
                      style={categoryStyle(file.curationStatus, facets.curationStatuses)}
                      type="button"
                    >
                      <div className="thumb">
                        {mainThumbnail(file) ? <img src={mainThumbnail(file)} alt="" /> : <Image size={22} />}
                      </div>
                      <div className="duplicate-file-main">
                        <strong>{file.filename}</strong>
                        <span>{file.disk?.name ?? "-"} · {file.relativePath}</span>
                      </div>
                      <div className="duplicate-file-meta">
                        <span>{formatDuration(file.durationSeconds)}</span>
                        <span>{resolution(file)}</span>
                        <CategoryBadges file={file} categories={facets.curationStatuses} />
                      </div>
                    </button>
                  ))}
                </div>
              </article>
            ))}
          </div>
        </section>
      ) : null}

      {viewMode === "usage" ? (
        <section className="results usage-view">
          <div className="view-header">
            <div>
              <strong>Esquema de uso</strong>
              <span>Tamano por folder segun el ultimo dato reportado por el agente.</span>
            </div>
          </div>
          {auxLoading ? <div className="loading">Cargando...</div> : null}
          {!auxLoading && folderUsage.length === 0 ? <div className="empty">Aun no hay datos de uso por folder.</div> : null}
          <div className="usage-tiles">
            {folderUsage.map((item) => {
              const scale = Math.max(0.16, item.sizeBytes / maxFolderUsage);
              return (
                <article
                  className="usage-tile"
                  key={`${item.diskId}:${item.folder}`}
                  style={{ "--tile-scale": scale } as CSSProperties}
                  title={`${item.diskName} / ${item.folder}`}
                >
                  <div className="usage-fill" />
                  <div className="usage-content">
                    <span>{item.diskName}</span>
                    <strong>{item.folder}</strong>
                    <small>{formatBytes(item.sizeBytes)} · {item.fileCount} videos{item.estimated ? " · estimado" : ""}</small>
                  </div>
                </article>
              );
            })}
          </div>
        </section>
      ) : null}

      {viewMode === "audit" ? (
        <section className="results audit-view">
          <div className="view-header">
            <div>
              <strong>Auditoria del agente</strong>
              <span>Errores enviados por el agente durante los escaneos.</span>
            </div>
          </div>
          {auxLoading ? <div className="loading">Cargando...</div> : null}
          <div className="audit-summary">
            {auditSummary.map((item) => (
              <div className="audit-chip" key={`${item.category}:${item.phase}`}>
                <strong>{item.count}</strong>
                <span>{item.category}</span>
                <small>{item.phase}</small>
              </div>
            ))}
          </div>
          <div className="table-frame">
            <table className="audit-table">
              <thead>
                <tr>
                  <th>Fecha</th>
                  <th>Disco</th>
                  <th>Categoria</th>
                  <th>Fase</th>
                  <th>Codigo</th>
                  <th>Ruta</th>
                  <th>Mensaje</th>
                </tr>
              </thead>
              <tbody>
                {auditErrors.map((error) => (
                  <tr key={error.id}>
                    <td>{dateLabel(error.createdAt, locale)}</td>
                    <td>{error.diskName}</td>
                    <td><span className="audit-category">{error.category}</span></td>
                    <td>{error.phase}</td>
                    <td>{error.code ?? "-"}</td>
                    <td>
                      <button
                        className="audit-snippet is-path"
                        onClick={() => setSelectedAuditError(error)}
                        type="button"
                        title="Ver error completo"
                      >
                        {error.relativePath ?? error.absolutePath ?? "-"}
                      </button>
                    </td>
                    <td>
                      <button
                        className="audit-snippet"
                        onClick={() => setSelectedAuditError(error)}
                        type="button"
                        title="Ver error completo"
                      >
                        {error.message}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {!auxLoading && auditErrors.length === 0 ? <div className="empty">No hay errores registrados para estos discos.</div> : null}
          </div>
        </section>
      ) : null}

      {viewMode === "admin" ? (
        <section className="results admin-view">
          <div className="view-header">
            <div>
              <strong>Administracion</strong>
              <span>Limpieza de contenido indexado por unidad. No borra archivos del disco externo.</span>
            </div>
          </div>
          <div className="admin-panel">
            {adminMessage ? <div className="admin-notice">{adminMessage}</div> : null}
            {adminError ? <div className="form-error">{adminError}</div> : null}
            <div className="admin-disk-grid">
              {disks.map((disk) => (
                <article className="admin-disk-card" key={disk.id}>
                  <div className="admin-disk-main">
                    <HardDrive size={20} />
                    <div>
                      <strong>{disk.name}</strong>
                      <span>
                        {disk.driveLetter ? `${disk.driveLetter} · ` : ""}
                        {disk.fileSystem ?? "Sistema desconocido"}
                      </span>
                    </div>
                  </div>
                  <dl className="admin-disk-meta">
                    <div>
                      <dt>Capacidad</dt>
                      <dd>{disk.totalBytes ? formatBytes(disk.totalBytes) : "-"}</dd>
                    </div>
                    <div>
                      <dt>Ultimo indexado</dt>
                      <dd>{dateLabel(disk.lastScannedAt, locale)}</dd>
                    </div>
                  </dl>
                  <button
                    className="danger-button"
                    disabled={adminBusyDiskId === disk.id}
                    onClick={() => void purgeDiskCatalog(disk)}
                    type="button"
                  >
                    <Trash2 size={16} />
                    {adminBusyDiskId === disk.id ? "Limpiando..." : "Vaciar catalogo"}
                  </button>
                </article>
              ))}
            </div>
          </div>
        </section>
      ) : null}

      {viewMode === "profile" ? (
        <section className="results profile-view">
          <div className="view-header">
            <div>
              <strong>Perfil y seguridad</strong>
              <span>PIN y patrones protegidos para carpetas privadas.</span>
            </div>
          </div>
          <form className="profile-panel" onSubmit={saveProfileSecurity}>
            {profileLoading ? <div className="loading">Cargando...</div> : null}
            {profileMessage ? <div className="admin-notice">{profileMessage}</div> : null}
            {profileError ? <div className="form-error">{profileError}</div> : null}
            <div className="profile-status">
              <Lock size={18} />
              <span>{profileSecurity?.hasPin ? "PIN configurado" : "PIN no configurado"}</span>
            </div>
            <div className="profile-grid">
              <label>
                PIN actual
                <input
                  value={profileCurrentPin}
                  onChange={(event) => setProfileCurrentPin(event.target.value.replace(/\D/g, "").slice(0, 4))}
                  inputMode="numeric"
                  autoComplete="current-password"
                  placeholder="0000"
                  type="password"
                />
              </label>
              <label>
                Nuevo PIN
                <input
                  value={profileNewPin}
                  onChange={(event) => setProfileNewPin(event.target.value.replace(/\D/g, "").slice(0, 4))}
                  inputMode="numeric"
                  autoComplete="new-password"
                  placeholder="0000"
                  type="password"
                />
              </label>
            </div>
            <label className="profile-patterns">
              Patrones protegidos
              <textarea
                value={profilePatternsText}
                onChange={(event) => setProfilePatternsText(event.target.value)}
                rows={8}
                placeholder={"Private\nProtected"}
              />
              <small>Un patron por linea o separados por coma. VideoCAT ocultara carpetas cuyo nombre contenga cualquiera de estos textos.</small>
            </label>
            <div className="profile-actions">
              <button className="primary-button" disabled={profileSaving || profileLoading} type="submit">
                <Shield size={17} />
                {profileSaving ? "Guardando..." : "Guardar perfil"}
              </button>
            </div>
          </form>
        </section>
      ) : null}

      {selectedAuditError ? (
        <div
          className="audit-detail-backdrop"
          role="dialog"
          aria-modal="true"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) setSelectedAuditError(null);
          }}
        >
          <section className="audit-detail-panel">
            <header className="audit-detail-header">
              <div>
                <span>{selectedAuditError.diskName}</span>
                <h2>{selectedAuditError.category} · {selectedAuditError.phase}</h2>
              </div>
              <button className="icon-button" onClick={() => setSelectedAuditError(null)} type="button" title="Cerrar">
                <X size={20} />
              </button>
            </header>
            <div className="audit-detail-grid">
              <Info label="Fecha" value={dateLabel(selectedAuditError.createdAt, locale)} />
              <Info label="Codigo" value={selectedAuditError.code ?? "-"} />
              <Info label="Ruta relativa" value={selectedAuditError.relativePath ?? "-"} copy />
              <Info label="Ruta absoluta" value={selectedAuditError.absolutePath ?? "-"} copy />
            </div>
            <div className="audit-detail-message">
              <strong>Mensaje completo</strong>
              <pre>{selectedAuditError.message}</pre>
            </div>
          </section>
        </div>
      ) : null}

      {recoverableSpaceOpen ? (
        <RecoverableSpaceModal
          data={recoverableSpace}
          locale={locale}
          loading={recoverableSpaceLoading}
          error={recoverableSpaceError}
          onClose={() => setRecoverableSpaceOpen(false)}
          onRefresh={() => void openRecoverableSpace()}
        />
      ) : null}

      {reviewCurrent ? (
        <ReviewDecisionModal
          file={reviewCurrent}
          categories={facets.curationStatuses}
          locale={locale}
          loading={reviewLoading}
          remaining={reviewRemaining}
          onClose={() => setReviewCurrent(null)}
          onDecision={(status) => void decideReview(reviewCurrent, status)}
          onToggleCategory={(categoryKey, enabled) => void toggleFileCategory(reviewCurrent, categoryKey, enabled)}
        />
      ) : null}

      {selected ? (
        <FileDetail
          file={selected}
          duplicates={duplicates}
          locale={locale}
          canOpenPrevious={canOpenPrevious}
          canOpenNext={canOpenNext}
          onPrevious={() => openAdjacentDetail(-1)}
          onNext={() => openAdjacentDetail(1)}
          onClose={() => setSelected(null)}
          categories={facets.curationStatuses}
          onToggleCategory={(categoryKey, enabled) => void toggleFileCategory(selected, categoryKey, enabled)}
          onDeleted={removeDeletedFile}
        />
      ) : null}
      {pinPrompt ? (
        <ProtectedPinModal
          value={protectedPin}
          submitting={pinSubmitting}
          onChange={handleProtectedPinChange}
          onCancel={() => {
            setPinPrompt(null);
            setProtectedPin("");
          }}
        />
      ) : null}
    </main>
  );
}

function SortHeader({
  label,
  field,
  sortBy,
  sortDirection,
  onSort
}: {
  label: string;
  field: SortBy;
  sortBy: SortBy;
  sortDirection: SortDirection;
  onSort: (field: SortBy) => void;
}) {
  const active = sortBy === field;
  return (
    <button
      className={`sort-header ${active ? "is-active" : ""}`}
      onClick={() => onSort(field)}
      type="button"
      title={`Ordenar por ${label}`}
    >
      <span>{label}</span>
      <ArrowUpDown size={14} />
      {active ? <small>{sortLabel(sortBy, sortDirection, field)}</small> : null}
    </button>
  );
}

function CategoryBadges({ file, categories }: { file: VideoFile; categories: CurationCategory[] }) {
  const keys = categoryKeysForFile(file);
  if (keys.length === 0) return null;

  return (
    <div className="category-badges">
      {keys.map((key) => (
        <em key={key} className={`status-badge is-${key}`} style={categoryStyle(key, categories)}>
          {categoryLabel(key, categories)}
        </em>
      ))}
    </div>
  );
}

function ProtectedPinModal({
  value,
  submitting,
  onChange,
  onCancel
}: {
  value: string;
  submitting: boolean;
  onChange: (value: string) => void;
  onCancel: () => void;
}) {
  return (
    <div className="pin-backdrop" role="dialog" aria-modal="true">
      <section className="pin-panel">
        <button className="icon-button pin-close" onClick={onCancel} type="button" title="Cancelar">
          <X size={18} />
        </button>
        <Lock size={22} />
        <h2>PIN requerido</h2>
        <input
          autoFocus
          className="pin-input"
          value={value}
          disabled={submitting}
          inputMode="numeric"
          maxLength={4}
          pattern="[0-9]*"
          type="password"
          onChange={(event) => onChange(event.target.value)}
          aria-label="PIN de 4 digitos"
        />
      </section>
    </div>
  );
}

function RecoverableSpaceModal({
  data,
  locale,
  loading,
  error,
  onClose,
  onRefresh
}: {
  data: RecoverableSpaceResponse | null;
  locale: string;
  loading: boolean;
  error: string;
  onClose: () => void;
  onRefresh: () => void;
}) {
  const disks = data?.disks ?? [];
  const maxRecoverable = Math.max(1, ...disks.map((disk) => disk.recoverableBytes));
  const totalRecoverable = data?.totalRecoverableBytes ?? 0;

  useEffect(() => {
    function handleKey(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }

    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [onClose]);

  return (
    <div
      className="modal-backdrop"
      role="dialog"
      aria-modal="true"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <section className="recoverable-panel">
        <header className="recoverable-header">
          <div>
            <span>Marcados para borrar</span>
            <h2>Espacio a recuperar</h2>
          </div>
          <button className="icon-button" onClick={onClose} type="button" title="Cerrar">
            <X size={20} />
          </button>
        </header>

        <div className="recoverable-summary">
          <div>
            <span>Total recuperable</span>
            <strong>{formatBytes(totalRecoverable)}</strong>
          </div>
          <button className="secondary-button" onClick={onRefresh} disabled={loading} type="button">
            {loading ? "Calculando..." : "Actualizar"}
          </button>
        </div>

        {error ? <div className="form-error">{error}</div> : null}

        {loading && !data ? (
          <div className="empty">Calculando espacio a recuperar...</div>
        ) : disks.length === 0 ? (
          <div className="empty">No hay archivos marcados para borrar en este momento.</div>
        ) : (
          <>
            <div className="recoverable-list" aria-label="Discos recomendados">
              {disks.map((disk, index) => (
                <div className="recoverable-card" key={disk.diskId}>
                  <span className="recoverable-rank">{index + 1}</span>
                  <div className="recoverable-card-main">
                    <strong>{disk.diskName}</strong>
                    <span>
                      {disk.driveLetter || "-"} · {disk.fileCount.toLocaleString(locale)} archivo(s) · {disk.volumeLabel || "Sin etiqueta"}
                    </span>
                  </div>
                  <div className="recoverable-card-space">
                    <strong>{formatBytes(disk.recoverableBytes)}</strong>
                    <span>{disk.totalBytes ? `de ${formatBytes(disk.totalBytes)}` : "recuperables"}</span>
                  </div>
                </div>
              ))}
            </div>

            <div className="recoverable-chart" aria-label="Grafico de recuperacion por disco">
              {disks.map((disk) => {
                const relativeWidth = Math.max(4, (disk.recoverableBytes / maxRecoverable) * 100);
                const share = totalRecoverable > 0 ? (disk.recoverableBytes / totalRecoverable) * 100 : 0;
                return (
                  <div className="recoverable-bar-row" key={disk.diskId}>
                    <div className="recoverable-bar-label">
                      <strong>{disk.diskName}</strong>
                      <span>{share.toFixed(1)}% del total</span>
                    </div>
                    <div className="recoverable-bar-track">
                      <div className="recoverable-bar-fill" style={{ width: `${relativeWidth}%` }} />
                    </div>
                    <em>{formatBytes(disk.recoverableBytes)}</em>
                  </div>
                );
              })}
            </div>
          </>
        )}
      </section>
    </div>
  );
}

function ReviewDecisionModal({
  file,
  categories,
  locale,
  loading,
  remaining,
  onClose,
  onDecision,
  onToggleCategory
}: {
  file: VideoFile;
  categories: CurationCategory[];
  locale: string;
  loading: boolean;
  remaining: number;
  onClose: () => void;
  onDecision: (status: "keep" | "delete") => void;
  onToggleCategory: (categoryKey: string, enabled: boolean) => void;
}) {
  const [galleryIndex, setGalleryIndex] = useState<number | null>(null);
  const [decisionFeedback, setDecisionFeedback] = useState<"keep" | "delete" | null>(null);
  const thumbStripRef = useRef<HTMLDivElement | null>(null);
  const galleryThumb = galleryIndex == null ? null : file.thumbnails[galleryIndex];
  const canOpenPreviousImage = galleryIndex != null && galleryIndex > 0;
  const canOpenNextImage = galleryIndex != null && galleryIndex < file.thumbnails.length - 1;

  function moveGallery(offset: -1 | 1) {
    setGalleryIndex((current) => {
      if (current == null) return current;
      const next = current + offset;
      if (next < 0 || next >= file.thumbnails.length) return current;
      return next;
    });
  }

  useEffect(() => {
    setGalleryIndex(null);
    setDecisionFeedback(null);
    if (window.matchMedia("(max-width: 760px)").matches) {
      window.requestAnimationFrame(() => {
        thumbStripRef.current?.scrollIntoView({ block: "start", behavior: "smooth" });
      });
    }
  }, [file.id]);

  useEffect(() => {
    function handleKey(event: KeyboardEvent) {
      if (galleryIndex != null) {
        if (event.key === "Escape") {
          event.preventDefault();
          setGalleryIndex(null);
        }
        if (event.key === "ArrowLeft" && canOpenPreviousImage) {
          event.preventDefault();
          moveGallery(-1);
        }
        if (event.key === "ArrowRight" && canOpenNextImage) {
          event.preventDefault();
          moveGallery(1);
        }
        return;
      }

      if (event.key === "Escape") onClose();
    }

    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [canOpenNextImage, canOpenPreviousImage, galleryIndex, onClose]);

  return (
    <div
      className="modal-backdrop review-modal-backdrop"
      role="dialog"
      aria-modal="true"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <section className="detail-panel review-panel">
        <header className="detail-header">
          <div className="detail-title-block">
            <span>{file.disk?.name} · {remaining} pendientes</span>
            <h2>{file.filename}</h2>
          </div>
          <button className="icon-button" onClick={onClose} title="Cerrar">
            <X size={20} />
          </button>
        </header>

        <div className="review-tag-toolbar" aria-label="Etiquetas disponibles">
          {categories.filter((category) => category.key !== "keep" && category.key !== "delete").map((category) => {
            const active = hasFileCategory(file, category.key);
            return (
              <button
                key={category.key}
                className={`review-tag-toggle ${active ? "is-active" : ""}`}
                style={categoryStyle(category.key, categories)}
                onClick={() => onToggleCategory(category.key, !active)}
                disabled={loading}
                type="button"
              >
                {category.label}
              </button>
            );
          })}
        </div>

        <div className="thumb-strip" ref={thumbStripRef}>
          {file.thumbnails.length > 0 ? (
            file.thumbnails.map((thumb, index) => (
              <button
                key={thumb.id}
                className="thumb-button"
                onClick={() => setGalleryIndex(index)}
                type="button"
                title="Ver captura"
              >
                <img src={thumb.url} alt="" />
              </button>
            ))
          ) : (
            <div className="no-thumbs">Sin miniaturas</div>
          )}
        </div>

        <div className="review-decision-actions">
          <button
            className={`review-decision-button is-delete ${decisionFeedback === "delete" ? "is-selected" : ""}`}
            onClick={() => {
              setDecisionFeedback("delete");
              onDecision("delete");
            }}
            disabled={loading}
            type="button"
          >
            <Trash2 size={22} />
            {decisionFeedback === "delete" ? "MARCADO" : "BORRAR"}
          </button>
          <button
            className={`review-decision-button is-keep ${decisionFeedback === "keep" ? "is-selected" : ""}`}
            onClick={() => {
              setDecisionFeedback("keep");
              onDecision("keep");
            }}
            disabled={loading}
            type="button"
          >
            <Check size={22} />
            {decisionFeedback === "keep" ? "MARCADO" : "MANTENER"}
          </button>
        </div>

        <div className="detail-grid">
          <Info label="Ruta relativa" value={file.relativePath} copy />
          <Info label="Tamano exacto" value={`${file.sizeBytes} bytes (${formatBytes(file.sizeBytes)})`} />
          <Info label="Duracion" value={formatDuration(file.durationSeconds)} />
          <Info label="Resolucion" value={resolution(file)} />
          <Info label="FPS" value={file.fps?.toFixed(3) ?? "-"} />
          <Info label="Video" value={file.videoCodec ?? "-"} />
          <Info label="Audio" value={file.audioCodec ?? "-"} />
          <Info label="Ultima vez indexado" value={dateLabel(file.lastIndexedAt, locale)} />
          <Info
            label="Etiquetas"
            value={categoryKeysForFile(file).map((key) => categoryLabel(key, categories)).join(", ") || "Sin marcar"}
          />
        </div>
      </section>

      {galleryThumb ? (
        <div
          className="gallery-backdrop"
          role="dialog"
          aria-modal="true"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) setGalleryIndex(null);
          }}
        >
          <button className="icon-button gallery-close" onClick={() => setGalleryIndex(null)} type="button" title="Cerrar">
            <X size={22} />
          </button>
          <button
            className="gallery-nav gallery-nav-prev"
            onClick={() => moveGallery(-1)}
            disabled={!canOpenPreviousImage}
            type="button"
            title="Captura anterior"
          >
            <ChevronLeft size={30} />
          </button>
          <div className="gallery-stage">
            <img src={galleryThumb.url} alt="" />
          </div>
          <button
            className="gallery-nav gallery-nav-next"
            onClick={() => moveGallery(1)}
            disabled={!canOpenNextImage}
            type="button"
            title="Captura siguiente"
          >
            <ChevronRight size={30} />
          </button>
          <div className="gallery-count">
            {(galleryIndex ?? 0) + 1} / {file.thumbnails.length}
          </div>
        </div>
      ) : null}
    </div>
  );
}

function FileDetail({
  file,
  duplicates,
  locale,
  canOpenPrevious,
  canOpenNext,
  onPrevious,
  onNext,
  onClose,
  categories,
  onToggleCategory,
  onDeleted
}: {
  file: VideoFile;
  duplicates: VideoFile[];
  locale: string;
  canOpenPrevious: boolean;
  canOpenNext: boolean;
  onPrevious: () => void;
  onNext: () => void;
  onClose: () => void;
  categories: CurationCategory[];
  onToggleCategory: (categoryKey: string, enabled: boolean) => void;
  onDeleted: (fileId: string) => void;
}) {
  const [galleryIndex, setGalleryIndex] = useState<number | null>(null);
  const [companionBusy, setCompanionBusy] = useState<CompanionAction | null>(null);
  const [companionMessage, setCompanionMessage] = useState("");
  const [deletePromptOpen, setDeletePromptOpen] = useState(false);
  const [deleteConfirmText, setDeleteConfirmText] = useState("");
  const json = JSON.stringify(file.ffprobeJson ?? {}, null, 2);
  const localFolder = folderPath(file.absolutePath);
  const galleryThumb = galleryIndex == null ? null : file.thumbnails[galleryIndex];
  const canOpenPreviousImage = galleryIndex != null && galleryIndex > 0;
  const canOpenNextImage = galleryIndex != null && galleryIndex < file.thumbnails.length - 1;

  function moveGallery(offset: -1 | 1) {
    setGalleryIndex((current) => {
      if (current == null) return current;
      const next = current + offset;
      if (next < 0 || next >= file.thumbnails.length) return current;
      return next;
    });
  }

  async function callCompanion(action: CompanionAction) {
    const port = localStorage.getItem("videocat-companion-port") ?? "29429";
    const token = localStorage.getItem("videocat-companion-token") ?? "";
    setCompanionBusy(action);
    setCompanionMessage("");

    try {
      const headers = new Headers({ "Content-Type": "application/json" });
      if (token) headers.set("X-VideoCat-Companion-Token", token);
      const response = await fetch(`http://127.0.0.1:${port}/${action}`, {
        method: "POST",
        headers,
        body: JSON.stringify({
          diskId: file.disk?.volumeId ?? file.diskId,
          absolutePath: file.absolutePath,
          relativePath: file.relativePath
        })
      });
      const result = await response.json().catch(() => ({ ok: false, reason: "open_failed" })) as CompanionResponse;

      if (response.status === 401 || response.status === 403 || result.reason === "forbidden") {
        setCompanionMessage("Token local no valido");
      } else if (result.ok) {
        if (action === "delete-file") {
          try {
            await api(`/api/files/${file.id}/catalog`, { method: "DELETE" });
            setCompanionMessage("Archivo borrado y quitado del catalogo");
            onDeleted(file.id);
          } catch (error) {
            setCompanionMessage(
              `Archivo borrado localmente, pero no se pudo quitar del catalogo: ${
                error instanceof Error ? error.message : "error desconocido"
              }`
            );
          }
        } else {
          setCompanionMessage(action === "open-file" ? "Abriendo video local" : "Abriendo carpeta local");
        }
      } else if (result.reason === "not_available") {
        setCompanionMessage("Disco no conectado");
      } else {
        setCompanionMessage(result.detail ? `No se pudo abrir localmente: ${result.detail}` : "No se pudo abrir localmente");
      }
    } catch {
      setCompanionMessage("Companion no iniciado");
    } finally {
      setCompanionBusy(null);
    }
  }

  useEffect(() => {
    function handleKey(event: KeyboardEvent) {
      if (deletePromptOpen) {
        if (event.key === "Escape") {
          event.preventDefault();
          setDeletePromptOpen(false);
          setDeleteConfirmText("");
        }
        return;
      }

      if (galleryIndex != null) {
        if (event.key === "Escape") {
          event.preventDefault();
          setGalleryIndex(null);
        }
        if (event.key === "ArrowLeft" && canOpenPreviousImage) {
          event.preventDefault();
          moveGallery(-1);
        }
        if (event.key === "ArrowRight" && canOpenNextImage) {
          event.preventDefault();
          moveGallery(1);
        }
        return;
      }

      if (event.key === "Escape") onClose();
      if (event.key === "ArrowLeft" && canOpenPrevious) {
        event.preventDefault();
        onPrevious();
      }
      if (event.key === "ArrowRight" && canOpenNext) {
        event.preventDefault();
        onNext();
      }
    }

    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [canOpenNext, canOpenNextImage, canOpenPrevious, canOpenPreviousImage, deletePromptOpen, galleryIndex, onClose, onNext, onPrevious]);

  function requestDeleteFile() {
    setDeleteConfirmText("");
    setDeletePromptOpen(true);
  }

  function confirmDeleteFile() {
    if (deleteConfirmText !== "BORRAR" || companionBusy === "delete-file") return;
    setDeletePromptOpen(false);
    setDeleteConfirmText("");
    void callCompanion("delete-file");
  }

  return (
    <div
      className="modal-backdrop"
      role="dialog"
      aria-modal="true"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <button
        className="modal-nav modal-nav-prev"
        onClick={onPrevious}
        disabled={!canOpenPrevious}
        type="button"
        title="Video anterior"
      >
        <ChevronLeft size={26} />
      </button>
      <section className="detail-panel">
        <header className="detail-header">
          <div className="detail-title-block">
            <span>{file.disk?.name}</span>
            <h2>{file.filename}</h2>
            <div className="detail-primary-actions">
              <button
                className="detail-primary-action"
                disabled={companionBusy === "open-file"}
                onClick={() => void callCompanion("open-file")}
                title="Reproducir video"
                aria-label="Reproducir video"
                type="button"
              >
                <Play size={20} />
              </button>
              <button
                className="detail-primary-action is-folder"
                disabled={companionBusy === "open-folder"}
                onClick={() => void callCompanion("open-folder")}
                title="Abrir carpeta local"
                aria-label="Abrir carpeta local"
                type="button"
              >
                <FolderOpen size={20} />
              </button>
              <button
                className="detail-primary-action is-danger"
                disabled={companionBusy === "delete-file"}
                onClick={requestDeleteFile}
                title="Borrar archivo fisicamente"
                aria-label="Borrar archivo fisicamente"
                type="button"
              >
                <Trash2 size={20} />
              </button>
            </div>
          </div>
          <div className="detail-header-actions">
            <div className="curation-actions" aria-label="Categoria del video">
              {categories.map((category) => {
                const active = hasFileCategory(file, category.key);
                return (
                <button
                  key={category.key}
                  className={`curation-action is-${category.key} ${active ? "is-active" : ""}`}
                  style={categoryStyle(category.key, categories)}
                  onClick={() => onToggleCategory(category.key, !active)}
                  type="button"
                >
                  {category.label}
                </button>
                );
              })}
            </div>
            <button className="icon-button" onClick={onClose} title="Cerrar">
              <X size={20} />
            </button>
          </div>
        </header>

        <div className="thumb-strip">
          {file.thumbnails.length > 0 ? (
            file.thumbnails.map((thumb, index) => (
              <button
                key={thumb.id}
                className="thumb-button"
                onClick={() => setGalleryIndex(index)}
                type="button"
                title="Ver captura"
              >
                <img src={thumb.url} alt="" />
              </button>
            ))
          ) : (
            <div className="no-thumbs">Sin miniaturas</div>
          )}
        </div>

        <div className="detail-grid">
          <Info label="Ruta relativa" value={file.relativePath} copy />
          <Info
            label="Ruta absoluta escaneada"
            value={file.absolutePath}
            copy
            openKind="file"
            openBusy={companionBusy === "open-file"}
            onOpen={() => void callCompanion("open-file")}
          />
          <Info
            label="Carpeta local"
            value={localFolder}
            copy
            openKind="folder"
            openBusy={companionBusy === "open-folder"}
            onOpen={() => void callCompanion("open-folder")}
          />
          <Info label="Tamano exacto" value={`${file.sizeBytes} bytes (${formatBytes(file.sizeBytes)})`} />
          <Info label="Tamano del folder" value={file.folderSizeBytes != null ? formatBytes(file.folderSizeBytes) : "-"} />
          <Info label="Duracion" value={formatDuration(file.durationSeconds)} />
          <Info label="Resolucion" value={resolution(file)} />
          <Info label="FPS" value={file.fps?.toFixed(3) ?? "-"} />
          <Info label="Video" value={file.videoCodec ?? "-"} />
          <Info label="Audio" value={file.audioCodec ?? "-"} />
          <Info label="Bitrate" value={file.bitrate ? `${file.bitrate} bps` : "-"} />
          <Info label="Ultima vez indexado" value={dateLabel(file.lastIndexedAt, locale)} />
          <Info
            label="Etiquetas"
            value={categoryKeysForFile(file).map((key) => categoryLabel(key, categories)).join(", ") || "Sin marcar"}
          />
          <Info label="Estado" value={file.scanStatus} />
        </div>

        {companionMessage ? <div className="companion-status">{companionMessage}</div> : null}

        {duplicates.length > 0 ? (
          <section className="duplicates">
            <h3>Posibles duplicados</h3>
            {duplicates.map((duplicate) => (
              <button key={duplicate.id} className="duplicate-row">
                <span>{duplicate.filename}</span>
                <small>{duplicate.disk?.name} · {duplicate.relativePath}</small>
              </button>
            ))}
          </section>
        ) : null}

        <details className="json-block">
          <summary>JSON tecnico</summary>
          <pre>{json}</pre>
        </details>
      </section>
      <button
        className="modal-nav modal-nav-next"
        onClick={onNext}
        disabled={!canOpenNext}
        type="button"
        title="Video siguiente"
      >
        <ChevronRight size={26} />
      </button>
      {galleryThumb ? (
        <div
          className="gallery-backdrop"
          role="dialog"
          aria-modal="true"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) setGalleryIndex(null);
          }}
        >
          <button className="icon-button gallery-close" onClick={() => setGalleryIndex(null)} type="button" title="Cerrar">
            <X size={22} />
          </button>
          <button
            className="gallery-nav gallery-nav-prev"
            onClick={() => moveGallery(-1)}
            disabled={!canOpenPreviousImage}
            type="button"
            title="Captura anterior"
          >
            <ChevronLeft size={30} />
          </button>
          <div className="gallery-stage">
            <img src={galleryThumb.url} alt="" />
          </div>
          <button
            className="gallery-nav gallery-nav-next"
            onClick={() => moveGallery(1)}
            disabled={!canOpenNextImage}
            type="button"
            title="Captura siguiente"
          >
            <ChevronRight size={30} />
          </button>
          <div className="gallery-count">
            {(galleryIndex ?? 0) + 1} / {file.thumbnails.length}
          </div>
        </div>
      ) : null}
      {deletePromptOpen ? (
        <DeleteFileConfirmModal
          filename={file.filename}
          relativePath={file.relativePath}
          value={deleteConfirmText}
          submitting={companionBusy === "delete-file"}
          onChange={setDeleteConfirmText}
          onCancel={() => {
            setDeletePromptOpen(false);
            setDeleteConfirmText("");
          }}
          onConfirm={confirmDeleteFile}
        />
      ) : null}
    </div>
  );
}

function DeleteFileConfirmModal({
  filename,
  relativePath,
  value,
  submitting,
  onChange,
  onCancel,
  onConfirm
}: {
  filename: string;
  relativePath: string;
  value: string;
  submitting: boolean;
  onChange: (value: string) => void;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const canConfirm = value === "BORRAR" && !submitting;

  return (
    <div
      className="delete-confirm-backdrop"
      role="dialog"
      aria-modal="true"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onCancel();
      }}
    >
      <section className="delete-confirm-panel">
        <header className="delete-confirm-header">
          <div className="delete-confirm-icon">
            <Trash2 size={22} />
          </div>
          <div>
            <span>Confirmacion requerida</span>
            <h2>Borrar archivo fisicamente</h2>
          </div>
          <button className="icon-button" onClick={onCancel} type="button" title="Cancelar">
            <X size={18} />
          </button>
        </header>
        <div className="delete-confirm-body">
          <p>VideoCAT le pedira al companion local que elimine este archivo en Windows.</p>
          <div className="delete-file-target">
            <strong>{filename}</strong>
            <span>{relativePath}</span>
          </div>
          <label>
            Escribe BORRAR para confirmar
            <input
              autoFocus
              value={value}
              disabled={submitting}
              onChange={(event) => onChange(event.target.value.toUpperCase().slice(0, 6))}
              onKeyDown={(event) => {
                if (event.key === "Enter") onConfirm();
              }}
              placeholder="BORRAR"
            />
          </label>
        </div>
        <footer className="delete-confirm-actions">
          <button className="secondary-button" onClick={onCancel} disabled={submitting} type="button">
            Cancelar
          </button>
          <button className="danger-button" onClick={onConfirm} disabled={!canConfirm} type="button">
            <Trash2 size={16} />
            {submitting ? "Borrando..." : "Borrar archivo"}
          </button>
        </footer>
      </section>
    </div>
  );
}

function Info({
  label,
  value,
  copy = false,
  openKind = "folder",
  openBusy = false,
  onOpen
}: {
  label: string;
  value: string;
  copy?: boolean;
  openKind?: "file" | "folder";
  openBusy?: boolean;
  onOpen?: () => void;
}) {
  return (
    <div className="info-row">
      <span>{label}</span>
      <strong>{value}</strong>
      {onOpen ? (
        <button
          className="open-button"
          disabled={openBusy}
          onClick={onOpen}
          type="button"
          title={openKind === "file" ? "Intentar abrir archivo local" : "Intentar abrir carpeta local"}
        >
          {openKind === "file" ? <FileVideo size={15} /> : <FolderOpen size={15} />}
        </button>
      ) : null}
      {copy ? (
        <button className="copy-button" onClick={() => void navigator.clipboard.writeText(value)} title="Copiar">
          <Copy size={15} />
        </button>
      ) : null}
    </div>
  );
}
