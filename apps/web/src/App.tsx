import {
  type FormEvent,
  type PointerEvent as ReactPointerEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState
} from "react";
import {
  Copy,
  Download,
  LayoutGrid,
  ListChecks,
  Moon,
  PieChart,
  Server,
  Shield,
  Shuffle,
  Sun,
  User
} from "lucide-react";
import { formatBytes } from "@videocat/shared";
import { AppHeader } from "./components/AppHeader";
import { AppSidebar } from "./components/AppSidebar";
import { CatalogContext } from "./components/CatalogContext";
import { ClearDownloadHistoryConfirmModal } from "./components/ClearDownloadHistoryConfirmModal";
import { DeletionHistoryModal } from "./components/DeletionHistoryModal";
import { DuplicateAssistantModal } from "./components/DuplicateAssistantModal";
import { DuplicateDriveRecommendationsModal } from "./components/DuplicateDriveRecommendationsModal";
import { FileDetail } from "./components/FileDetail";
import { MobileNav } from "./components/MobileNav";
import { ProtectedPinModal } from "./components/ProtectedPinModal";
import { RecoverableSpaceModal } from "./components/RecoverableSpaceModal";
import { ReviewSession } from "./components/ReviewSession";
import { WaterRippleBackdrop } from "./components/WaterRippleBackdrop";
import { useCompanionStatus } from "./hooks/useCompanionStatus";
import { useMediaQuery } from "./hooks/useMediaQuery";
import { useThemePreferences } from "./hooks/useThemePreferences";
import { type Language, languageLabel, normalizeLanguage, observeLocalization } from "./i18n";
import { api, thumbnailSrc } from "./lib/api";
import {
  defaultCategoryColor,
  maxFilterWidth,
  minFilterWidth,
  pageSizeOptions,
  viewPaths,
  webVersion
} from "./lib/app-config";
import {
  assistedDuplicateGroups,
  categoryLabel,
  downloadProgressPercent,
  formatCount,
  nextSelectedFolders,
  parentFolder,
  startDuplicateAssistantSession,
  storedCatalogLayout,
  storedFiltersOpen,
  storedFilterWidth,
  storedLanguage,
  storedPageSize,
  viewModeFromPath,
  visibleFolderOptions
} from "./lib/app-helpers";
import type {
  CachedDuplicateDriveRecommendations,
  CachedDuplicateGroups,
  CatalogLayout,
  CompanionProcessDownloadsResponse,
  CompanionStatusResponse,
  CurationCategory,
  CurationStatus,
  DeletionHistoryResponse,
  DownloadQueueEntry,
  DownloadSpeedSample,
  DownloadSummaryResponse,
  DuplicateAssistantSession,
  DuplicateDriveRecommendationsResponse,
  DuplicateGroup,
  FacetResponse,
  FileResponse,
  MountedCompanionDisk,
  NavigationItem,
  ProfileSecurityResponse,
  ProtectedPinPrompt,
  RandomDownloadResponse,
  RecoverableSpaceResponse,
  ReviewNextResponse,
  ReviewPrefetch,
  ReviewSummaryResponse,
  SortBy,
  SortDirection,
  VersionCheckResponse,
  ViewMode
} from "./lib/app-types";
import type { Disk, Stats, VideoFile } from "./types";
import { AdminView } from "./views/AdminView";
import { AuditView } from "./views/AuditView";
import { CatalogView } from "./views/CatalogView";
import { DownloadsView } from "./views/DownloadsView";
import { DuplicatesView } from "./views/DuplicatesView";
import { ProfileView } from "./views/ProfileView";
import { ReviewHomeView } from "./views/ReviewHomeView";
import { UsageView } from "./views/UsageView";

export function App() {
  const { themePreferences, resolvedAppearance, theme, toggleTheme, updateThemePreferences } = useThemePreferences();
  const [themePanelOpen, setThemePanelOpen] = useState(false);
  const [catalogView, setCatalogView] = useState<CatalogLayout>(storedCatalogLayout);
  const compactLayout = useMediaQuery("(max-width: 900px)");
  // On phones the filters open as a sheet, so they always start closed there.
  const [filtersOpen, setFiltersOpen] = useState(() => !window.matchMedia("(max-width: 900px)").matches && storedFiltersOpen());
  const wideCatalog = useMediaQuery("(min-width: 1680px)");
  const searchInputRef = useRef<HTMLInputElement | null>(null);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => localStorage.getItem("videocat-sidebar-collapsed") === "true");
  const [language, setLanguage] = useState<Language>(storedLanguage);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [sessionChecked, setSessionChecked] = useState(false);
  const [authenticated, setAuthenticated] = useState(false);
  const {
    companionMountedDiskIds,
    setCompanionMountedDiskIds,
    companionMountedDiskCount,
    setCompanionMountedDiskCount,
    companionLocalOnline,
    companionOnline,
    setCompanionOnline,
    companionVersion,
    setCompanionVersion
  } = useCompanionStatus(authenticated);
  const [availableUpdate, setAvailableUpdate] = useState<string | null>(null);
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
  const [viewMode, setViewMode] = useState<ViewMode>(() => viewModeFromPath());
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
  const [reviewUpcoming, setReviewUpcoming] = useState<VideoFile | null | undefined>(undefined);
  const reviewPrefetchRef = useRef<ReviewPrefetch | null>(null);
  const reviewPreloadImagesRef = useRef<HTMLImageElement[]>([]);
  const reviewCatalogDirtyRef = useRef(false);
  const [recoverableSpaceOpen, setRecoverableSpaceOpen] = useState(false);
  const [recoverableSpaceLoading, setRecoverableSpaceLoading] = useState(false);
  const [recoverableSpaceError, setRecoverableSpaceError] = useState("");
  const [recoverableSpace, setRecoverableSpace] = useState<RecoverableSpaceResponse | null>(null);
  const [deletionHistoryOpen, setDeletionHistoryOpen] = useState(false);
  const [deletionHistoryLoading, setDeletionHistoryLoading] = useState(false);
  const [deletionHistoryProcessing, setDeletionHistoryProcessing] = useState(false);
  const [deletionHistoryError, setDeletionHistoryError] = useState("");
  const [deletionHistoryMessage, setDeletionHistoryMessage] = useState("");
  const [deletionHistory, setDeletionHistory] = useState<DeletionHistoryResponse | null>(null);
  const [downloadSummary, setDownloadSummary] = useState<DownloadSummaryResponse | null>(null);
  const [downloadLoading, setDownloadLoading] = useState(false);
  const [downloadActionBusy, setDownloadActionBusy] = useState(false);
  const [downloadPauseBusy, setDownloadPauseBusy] = useState(false);
  const [downloadProcessing, setDownloadProcessing] = useState(false);
  const [downloadSpeedSamples, setDownloadSpeedSamples] = useState<DownloadSpeedSample[]>([]);
  const [clearProcessedQueuePromptOpen, setClearProcessedQueuePromptOpen] = useState(false);
  const [selectedDownloadQueueIds, setSelectedDownloadQueueIds] = useState<string[]>([]);
  const [downloadMessage, setDownloadMessage] = useState("");
  const [randomDownloadGb, setRandomDownloadGb] = useState("10");
  const [downloadDiskIds, setDownloadDiskIds] = useState<string[]>([]);
  const [downloadFacets, setDownloadFacets] = useState<FacetResponse>({
    folders: [],
    tags: [],
    extensions: [],
    curationStatuses: [],
    protectedUnlocked: false
  });
  const [randomDownloadFolders, setRandomDownloadFolders] = useState<string[]>([]);
  const [downloadExpandedFolders, setDownloadExpandedFolders] = useState<string[]>([]);
  const [downloadFolderSearch, setDownloadFolderSearch] = useState("");
  const [connectedPanelCollapsed, setConnectedPanelCollapsed] = useState(
    () => localStorage.getItem("videocat-connected-panel-collapsed") === "true"
  );
  const downloadProgressSampleRef = useRef<{
    queueId: string;
    progressBytes: number;
    timestamp: number;
  } | null>(null);
  const previousMountedDiskIdsRef = useRef<Set<string>>(new Set());
  const [duplicateGroups, setDuplicateGroups] = useState<DuplicateGroup[]>([]);
  const [duplicateAssistant, setDuplicateAssistant] = useState<DuplicateAssistantSession | null>(null);
  const [duplicateAssistantBusy, setDuplicateAssistantBusy] = useState(false);
  const [duplicateAssistantFeedback, setDuplicateAssistantFeedback] = useState<string | null>(null);
  const [duplicateAssistantMessage, setDuplicateAssistantMessage] = useState("");
  const duplicateAssistantDirtyRef = useRef(false);
  const duplicateGroupsCacheRef = useRef<Map<string, CachedDuplicateGroups>>(new Map());
  const duplicatePreviewFilesRef = useRef<Record<string, VideoFile>>({});
  const duplicatePreviewRequestsRef = useRef<Map<string, Promise<VideoFile>>>(new Map());
  const [duplicatePreviewFiles, setDuplicatePreviewFiles] = useState<Record<string, VideoFile>>({});
  const [duplicateDriveRecommendationsOpen, setDuplicateDriveRecommendationsOpen] = useState(false);
  const [duplicateDriveRecommendationsLoading, setDuplicateDriveRecommendationsLoading] = useState(false);
  const [duplicateDriveRecommendationsError, setDuplicateDriveRecommendationsError] = useState("");
  const [duplicateDriveRecommendations, setDuplicateDriveRecommendations] = useState<DuplicateDriveRecommendationsResponse | null>(null);
  const duplicateDriveRecommendationCacheRef = useRef<Map<string, CachedDuplicateDriveRecommendations>>(new Map());
  const duplicateDriveRecommendationRequestRef = useRef<{
    key: string;
    promise: Promise<DuplicateDriveRecommendationsResponse>;
  } | null>(null);
  const [auxLoading, setAuxLoading] = useState(false);
  const [filterWidth, setFilterWidth] = useState(storedFilterWidth);
  const [profileSecurity, setProfileSecurity] = useState<ProfileSecurityResponse | null>(null);
  const [detectingConnected, setDetectingConnected] = useState(false);
  const [connectedMessage, setConnectedMessage] = useState("");
  const locale = language === "en" ? "en-US" : "es-CR";

  function navigateToView(mode: ViewMode, replace = false): void {
    const nextPath = viewPaths[mode];
    const currentUrl = `${window.location.pathname}${window.location.search}${window.location.hash}`;
    const nextUrl = nextPath;
    if (currentUrl !== nextUrl) {
      window.history[replace ? "replaceState" : "pushState"]({}, "", nextUrl);
    }
    setViewMode(mode);
    setMobileMenuOpen(false);
  }

  useEffect(() => {
    const initialMode = viewModeFromPath();
    const canonicalPath = viewPaths[initialMode];
    if (window.location.pathname !== canonicalPath) {
      window.history.replaceState({}, "", `${canonicalPath}${window.location.search}${window.location.hash}`);
    }

    function handlePopState(): void {
      setViewMode(viewModeFromPath());
      setMobileMenuOpen(false);
    }

    window.addEventListener("popstate", handlePopState);
    return () => window.removeEventListener("popstate", handlePopState);
  }, []);

  const pageCount = Math.max(1, Math.ceil(total / pageSize));
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
  const activeDownload = useMemo(
    () => (downloadSummary?.entries ?? []).find((entry) => entry.status === "downloading") ?? null,
    [downloadSummary]
  );
  const activeDownloadPercent = activeDownload ? downloadProgressPercent(activeDownload) : 0;
  const currentDownloadSpeed = useMemo(() => {
    if (!activeDownload || downloadSpeedSamples.length === 0) return 0;
    const progressUpdatedAt = activeDownload.progressUpdatedAt
      ? new Date(activeDownload.progressUpdatedAt).getTime()
      : 0;
    if (progressUpdatedAt > 0 && Date.now() - progressUpdatedAt > 8000) return 0;
    const recent = downloadSpeedSamples.slice(-5);
    return recent.reduce((total, sample) => total + sample.bytesPerSecond, 0) / recent.length;
  }, [activeDownload, downloadSpeedSamples]);
  const activeDownloadRemainingBytes = activeDownload
    ? Math.max(0, activeDownload.file.sizeBytes - activeDownload.progressBytes)
    : 0;
  const activeDownloadEta = activeDownload && currentDownloadSpeed > 0
    ? activeDownloadRemainingBytes / currentDownloadSpeed
    : null;
  const pendingDownloadBytes = Math.max(
    0,
    (downloadSummary?.pendingBytes ?? 0) - (activeDownload?.progressBytes ?? 0)
  );
  const downloadQueueEta = activeDownload && currentDownloadSpeed > 0
    ? pendingDownloadBytes / currentDownloadSpeed
    : null;

  function reviewQuerySuffix(): string {
    if (disks.length === 0) return "";
    const params = new URLSearchParams();
    params.set("diskIds", diskQuery);
    return `?${params.toString()}`;
  }

  function reviewNextQuerySuffix(excludeId?: string): string {
    const params = new URLSearchParams();
    if (disks.length > 0) params.set("diskIds", diskQuery);
    if (excludeId) params.set("excludeId", excludeId);
    const query = params.toString();
    return query ? `?${query}` : "";
  }

  const extensions = useMemo(() => facets.extensions.map((item) => item.extension), [facets.extensions]);
  const pendingAssistedDuplicateGroups = useMemo(() => assistedDuplicateGroups(duplicateGroups), [duplicateGroups]);
  const duplicateRecoverableBytes = useMemo(
    () => duplicateGroups.reduce((total, group) => total + group.recoverableBytes, 0),
    [duplicateGroups]
  );
  const maxTagCount = useMemo(() => Math.max(1, ...facets.tags.map((tag) => tag.count)), [facets.tags]);
  const folderChildren = useMemo(() => {
    const counts = new Map<string, number>();
    for (const folder of facets.folders) {
      const parent = parentFolder(folder.path);
      counts.set(parent, (counts.get(parent) ?? 0) + 1);
    }
    return counts;
  }, [facets.folders]);
  const visibleFolders = useMemo(
    () => visibleFolderOptions(facets.folders, expandedFolders, folderSearch),
    [expandedFolders, facets.folders, folderSearch]
  );
  const downloadFolderChildren = useMemo(() => {
    const counts = new Map<string, number>();
    for (const folder of downloadFacets.folders) {
      const parent = parentFolder(folder.path);
      counts.set(parent, (counts.get(parent) ?? 0) + 1);
    }
    return counts;
  }, [downloadFacets.folders]);
  const visibleDownloadFolders = useMemo(
    () => visibleFolderOptions(downloadFacets.folders, downloadExpandedFolders, downloadFolderSearch),
    [downloadExpandedFolders, downloadFacets.folders, downloadFolderSearch]
  );
  const downloadConnectedDisks = useMemo(
    () => disks.filter((disk) => companionMountedDiskIds.includes(disk.id)),
    [companionMountedDiskIds, disks]
  );
  const companionNeedsUpdate = companionOnline && companionVersion < 5;
  const companionIndicatorState = companionOnline && !companionNeedsUpdate
    ? "is-online"
    : companionLocalOnline || companionOnline
      ? "is-warning"
      : "is-offline";
  const companionIndicatorLabel = companionOnline && !companionNeedsUpdate
    ? "Agente sincronizado"
    : companionNeedsUpdate
      ? "Agente sincronizado; actualización requerida"
      : companionLocalOnline
        ? "Agente abierto localmente, sin sincronizar"
        : "Agente desconectado";
  const downloadDiskQuery = downloadDiskIds.join(",");
  const panelDisks = viewMode === "downloads" ? downloadConnectedDisks : disks;
  const panelSelectedDiskIds = viewMode === "downloads" ? downloadDiskIds : connectedDiskIds;
  const downloadConnectionMessage = !companionOnline
    ? companionLocalOnline
      ? "Companion abierto localmente, pero no está sincronizado con este servidor. Revisa SERVER_URL y AGENT_TOKEN."
      : "Companion no iniciado. Abre el Companion para detectar discos y procesar descargas."
    : companionNeedsUpdate
      ? "El Companion está sincronizado, pero necesita actualizarse para reportar qué discos están conectados."
      : companionMountedDiskCount > 0 && downloadConnectedDisks.length === 0
        ? "El Companion reporta discos conectados, pero no coinciden con este catálogo. Revisa SERVER_URL y vuelve a escanearlos."
        : downloadConnectedDisks.length === 0
          ? "Companion sincronizado. No hay discos VideoCAT conectados en este momento."
          : `${downloadConnectedDisks.length} disco(s) conectado(s) disponible(s) para descargar.`;

  useEffect(() => {
    localStorage.setItem("videocat-sidebar-collapsed", String(sidebarCollapsed));
  }, [sidebarCollapsed]);

  useEffect(() => {
    localStorage.setItem("videocat-catalog-view", catalogView);
  }, [catalogView]);

  useEffect(() => {
    if (!compactLayout) localStorage.setItem("videocat-catalog-filters-open", String(filtersOpen));
  }, [compactLayout, filtersOpen]);

  useEffect(() => {
    if (compactLayout) setFiltersOpen(false);
  }, [compactLayout]);

  useEffect(() => {
    if (!mobileMenuOpen && !(compactLayout && filtersOpen)) return;
    function closeSheet(event: KeyboardEvent) {
      if (event.key !== "Escape") return;
      setMobileMenuOpen(false);
      if (compactLayout) setFiltersOpen(false);
    }
    window.addEventListener("keydown", closeSheet);
    return () => window.removeEventListener("keydown", closeSheet);
  }, [compactLayout, filtersOpen, mobileMenuOpen]);

  useEffect(() => {
    function focusCatalogSearch(event: KeyboardEvent) {
      if (!(event.ctrlKey || event.metaKey) || event.key.toLowerCase() !== "k") return;
      event.preventDefault();
      if (viewMode !== "catalog") navigateToView("catalog");
      window.setTimeout(() => searchInputRef.current?.focus(), 0);
    }

    window.addEventListener("keydown", focusCatalogSearch);
    return () => window.removeEventListener("keydown", focusCatalogSearch);
  }, [viewMode]);

  useEffect(() => {
    localStorage.setItem("videocat-connected-panel-collapsed", String(connectedPanelCollapsed));
  }, [connectedPanelCollapsed]);

  useEffect(() => {
    document.documentElement.lang = language;
    localStorage.setItem("videocat-language", language);
    const root = document.querySelector(".login-screen, .vc-frame");
    return root ? observeLocalization(root, language) : undefined;
  }, [language, sessionChecked, authenticated, viewMode, catalogVersion, files, downloadSummary, reviewPending, reviewRecent, duplicateGroups]);

  useEffect(() => {
    localStorage.setItem("videocat-page-size", String(pageSize));
  }, [pageSize]);

  useEffect(() => {
    localStorage.setItem("videocat-filter-width", String(filterWidth));
  }, [filterWidth]);

  useEffect(() => {
    if (page > pageCount) setPage(pageCount);
  }, [page, pageCount]);

  const closeThemePanel = useCallback(() => setThemePanelOpen(false), []);


  useEffect(() => {
    api("/api/auth/me")
      .then(() => setAuthenticated(true))
      .catch(() => setAuthenticated(false))
      .finally(() => setSessionChecked(true));
  }, []);

  useEffect(() => {
    if (!authenticated) {
      setAvailableUpdate(null);
      return;
    }

    let cancelled = false;
    void api<VersionCheckResponse>(`/api/version/latest?current=${encodeURIComponent(webVersion)}`)
      .then((response) => {
        if (cancelled) return;
        setAvailableUpdate(response.updateAvailable && response.latestVersion
          ? response.latestVersion
          : null);
      })
      .catch(() => {
        if (!cancelled) setAvailableUpdate(null);
      });
    return () => {
      cancelled = true;
    };
  }, [authenticated]);

  useEffect(() => {
    if (!authenticated) return;
    void Promise.all([
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
    const availableIds = companionMountedDiskIds.filter((id) => disks.some((disk) => disk.id === id));
    const previousIds = previousMountedDiskIdsRef.current;
    setDownloadDiskIds((current) => {
      const retained = current.filter((id) => availableIds.includes(id));
      const newlyMounted = availableIds.filter((id) => !previousIds.has(id));
      return [...new Set([...retained, ...newlyMounted])];
    });
    previousMountedDiskIdsRef.current = new Set(availableIds);
    if (availableIds.length === 0) {
      setRandomDownloadFolders([]);
      setDownloadExpandedFolders([]);
      setDownloadFolderSearch("");
    }
  }, [companionMountedDiskIds, disks]);

  useEffect(() => {
    if (!authenticated || disks.length === 0) return;
    localStorage.setItem("videocat-connected-disks", connectedDiskIds.join(","));
  }, [authenticated, connectedDiskIds, disks.length]);

  const diskQuery = connectedDiskIds.join(",");
  const duplicateCacheKey = `${catalogVersion}:${diskQuery || "all"}`;

  const fetchDuplicatePreviewFile = useCallback((file: VideoFile): Promise<VideoFile> => {
    const cached = duplicatePreviewFilesRef.current[file.id];
    if (cached) return Promise.resolve(cached);

    const pending = duplicatePreviewRequestsRef.current.get(file.id);
    if (pending) return pending;

    const request = api<{ file: VideoFile }>(`/api/files/${file.id}`)
      .then((response) => response.file)
      .catch(() => file)
      .then((resolved) => {
        duplicatePreviewFilesRef.current = {
          ...duplicatePreviewFilesRef.current,
          [resolved.id]: resolved
        };
        setDuplicatePreviewFiles(duplicatePreviewFilesRef.current);
        for (const thumbnail of resolved.thumbnails) {
          const image = new window.Image();
          image.decoding = "async";
          image.fetchPriority = "low";
          image.src = thumbnailSrc(thumbnail.url) ?? thumbnail.url;
        }
        return resolved;
      })
      .finally(() => {
        duplicatePreviewRequestsRef.current.delete(file.id);
      });

    duplicatePreviewRequestsRef.current.set(file.id, request);
    return request;
  }, []);

  const warmDuplicatePreviewFiles = useCallback((items: VideoFile[]) => {
    const unique = [...new Map(items.map((file) => [file.id, file])).values()];
    void Promise.all(unique.map((file) => fetchDuplicatePreviewFile(file)));
  }, [fetchDuplicatePreviewFile]);

  const fetchDuplicateDriveRecommendations = useCallback((force = false): Promise<DuplicateDriveRecommendationsResponse> => {
    const now = Date.now();
    const cached = duplicateDriveRecommendationCacheRef.current.get(duplicateCacheKey);
    if (!force && cached && cached.expiresAt > now) return Promise.resolve(cached.response);

    const inFlight = duplicateDriveRecommendationRequestRef.current;
    if (inFlight?.key === duplicateCacheKey) return inFlight.promise;

    const params = new URLSearchParams();
    if (diskQuery) params.set("diskIds", diskQuery);
    const suffix = params.size > 0 ? `?${params.toString()}` : "";
    const promise = api<DuplicateDriveRecommendationsResponse>(`/api/duplicates/recommended-disks${suffix}`)
      .then((response) => {
        duplicateDriveRecommendationCacheRef.current.set(duplicateCacheKey, {
          response,
          expiresAt: Date.now() + 2 * 60 * 1000
        });
        setDuplicateDriveRecommendations(response);
        return response;
      })
      .finally(() => {
        if (duplicateDriveRecommendationRequestRef.current?.key === duplicateCacheKey) {
          duplicateDriveRecommendationRequestRef.current = null;
        }
      });

    duplicateDriveRecommendationRequestRef.current = { key: duplicateCacheKey, promise };
    return promise;
  }, [diskQuery, duplicateCacheKey]);

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
    if (!authenticated || viewMode !== "downloads" || downloadDiskIds.length === 0) {
      setDownloadFacets({
        folders: [],
        tags: [],
        extensions: [],
        curationStatuses: [],
        protectedUnlocked: false
      });
      setRandomDownloadFolders([]);
      setDownloadExpandedFolders([]);
      setDownloadFolderSearch("");
      return;
    }

    const params = new URLSearchParams({ diskIds: downloadDiskQuery });
    api<FacetResponse>(`/api/facets?${params.toString()}`).then((response) => {
      setDownloadFacets(response);
      setProtectedUnlocked(response.protectedUnlocked);
      setRandomDownloadFolders((current) => current.filter((folder) => response.folders.some((item) => item.path === folder)));
      setDownloadExpandedFolders((current) => current.filter((folder) => response.folders.some((item) => item.path === folder)));
    });
  }, [
    authenticated,
    catalogVersion,
    downloadDiskIds.length,
    downloadDiskQuery,
    protectedUnlockVersion,
    viewMode
  ]);

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
    if (!authenticated || viewMode !== "duplicates") return;
    if (disks.length > 0 && connectedDiskIds.length === 0) {
      setDuplicateGroups([]);
      return;
    }

    {
      const cached = duplicateGroupsCacheRef.current.get(duplicateCacheKey);
      if (cached && cached.expiresAt > Date.now()) {
        setDuplicateGroups(cached.groups);
        void fetchDuplicateDriveRecommendations().catch(() => undefined);
        return;
      }

      let active = true;
      setAuxLoading(true);
      const params = new URLSearchParams();
      if (diskQuery) params.set("diskIds", diskQuery);
      void api<{ groups: DuplicateGroup[] }>(`/api/duplicates/by-size?${params.toString()}`)
        .then((response) => {
          if (!active) return;
          duplicateGroupsCacheRef.current.set(duplicateCacheKey, {
            groups: response.groups,
            expiresAt: Date.now() + 2 * 60 * 1000
          });
          setDuplicateGroups(response.groups);
          void fetchDuplicateDriveRecommendations().catch(() => undefined);
        })
        .catch(() => undefined)
        .finally(() => {
          if (active) setAuxLoading(false);
        });
      return () => {
        active = false;
      };
    }
  }, [
    authenticated,
    catalogVersion,
    connectedDiskIds.length,
    diskQuery,
    disks.length,
    duplicateCacheKey,
    fetchDuplicateDriveRecommendations,
    viewMode
  ]);

  useEffect(() => {
    if (!authenticated || viewMode !== "duplicates") return;
    const upcoming = pendingAssistedDuplicateGroups
      .slice(0, 2)
      .flatMap((group) => group.contenders.slice(0, 2));
    warmDuplicatePreviewFiles(upcoming);
  }, [authenticated, pendingAssistedDuplicateGroups, viewMode, warmDuplicatePreviewFiles]);

  useEffect(() => {
    if (!duplicateAssistant) return;
    const currentGroup = duplicateAssistant.groups[duplicateAssistant.groupIndex];
    const nextGroup = duplicateAssistant.groups[duplicateAssistant.groupIndex + 1];
    warmDuplicatePreviewFiles([
      duplicateAssistant.keeper,
      duplicateAssistant.challenger,
      ...duplicateAssistant.remaining.slice(0, 1),
      ...(currentGroup?.contenders.slice(0, 2) ?? []),
      ...(nextGroup?.contenders.slice(0, 2) ?? [])
    ]);
  }, [duplicateAssistant, warmDuplicatePreviewFiles]);

  useEffect(() => {
    if (!authenticated) return;
    api<ProfileSecurityResponse>("/api/profile/security")
      .then(setProfileSecurity)
      .catch(() => setProfileSecurity(null));
  }, [authenticated, catalogVersion]);

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
    if (!authenticated || !deletionHistoryOpen) return;
    const interval = window.setInterval(() => {
      void loadDeletionHistory(true);
    }, 5000);
    return () => window.clearInterval(interval);
  }, [authenticated, deletionHistoryOpen]);

  useEffect(() => {
    const currentFileId = reviewCurrent?.id;
    setReviewUpcoming(undefined);
    if (!authenticated || viewMode !== "review" || !currentFileId) {
      reviewPrefetchRef.current = null;
      reviewPreloadImagesRef.current = [];
      return;
    }

    let active = true;
    const promise = api<ReviewNextResponse>(`/api/review/next${reviewNextQuerySuffix(currentFileId)}`)
      .then((response) => {
        if (active && !response.file) setReviewUpcoming(null);
        if (!active || !response.file) return response;
        reviewPreloadImagesRef.current = response.file.thumbnails.map((thumbnail) => {
          const image = new window.Image();
          image.decoding = "async";
          image.fetchPriority = "low";
          image.src = thumbnailSrc(thumbnail.url) ?? thumbnail.url;
          return image;
        });
        setReviewUpcoming(response.file);
        return response;
      })
      .catch(() => null);

    reviewPrefetchRef.current = { currentFileId, promise };

    return () => {
      active = false;
      if (reviewPrefetchRef.current?.currentFileId === currentFileId) {
        reviewPrefetchRef.current = null;
      }
    };
  }, [authenticated, connectedDiskIds.length, diskQuery, disks.length, protectedUnlockVersion, reviewCurrent?.id, viewMode]);

  useEffect(() => {
    if (!authenticated || viewMode !== "downloads") return;
    void loadDownloadSummary();
    const interval = window.setInterval(() => {
      void loadDownloadSummary(true);
    }, (downloadSummary?.counts.downloading ?? 0) > 0 ? 2000 : 10000);
    return () => window.clearInterval(interval);
  }, [authenticated, catalogVersion, downloadDiskIds.length, downloadDiskQuery, downloadSummary?.counts.downloading, protectedUnlockVersion, viewMode]);

  useEffect(() => {
    if (!activeDownload) {
      downloadProgressSampleRef.current = null;
      setDownloadSpeedSamples((current) => current.length > 0 ? [] : current);
      return;
    }

    const serverTimestamp = activeDownload.progressUpdatedAt
      ? new Date(activeDownload.progressUpdatedAt).getTime()
      : Date.now();
    const timestamp = Number.isFinite(serverTimestamp) ? serverTimestamp : Date.now();
    const previous = downloadProgressSampleRef.current;

    if (!previous || previous.queueId !== activeDownload.id || activeDownload.progressBytes < previous.progressBytes) {
      let initialSpeed = 0;
      const startedAt = activeDownload.startedAt ? new Date(activeDownload.startedAt).getTime() : 0;
      if (activeDownload.progressBytes > 0 && startedAt > 0 && timestamp > startedAt) {
        initialSpeed = activeDownload.progressBytes / ((timestamp - startedAt) / 1000);
      }
      setDownloadSpeedSamples(initialSpeed > 0 ? [{ timestamp, bytesPerSecond: initialSpeed }] : []);
      downloadProgressSampleRef.current = {
        queueId: activeDownload.id,
        progressBytes: activeDownload.progressBytes,
        timestamp
      };
      return;
    }

    if (activeDownload.progressBytes <= previous.progressBytes) return;
    const elapsedSeconds = Math.max(0.1, (timestamp - previous.timestamp) / 1000);
    const bytesPerSecond = (activeDownload.progressBytes - previous.progressBytes) / elapsedSeconds;
    setDownloadSpeedSamples((current) => [
      ...current,
      { timestamp, bytesPerSecond }
    ].slice(-30));
    downloadProgressSampleRef.current = {
      queueId: activeDownload.id,
      progressBytes: activeDownload.progressBytes,
      timestamp
    };
  }, [activeDownload]);

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

  async function openDetail(file: Pick<VideoFile, "id">) {
    const response = await api<{ file: VideoFile; duplicates: VideoFile[] }>(`/api/files/${file.id}`);
    setSelected(response.file);
    setDuplicates(response.duplicates);
  }

  async function openRandomConnectedDetail(excludeId: string) {
    const response = await api<{ file: VideoFile }>(`/api/playback/random?excludeId=${encodeURIComponent(excludeId)}`);
    setSelected(response.file);
    setDuplicates([]);
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
    reviewCatalogDirtyRef.current = false;
    try {
      const response = await api<ReviewNextResponse>(`/api/review/next${reviewNextQuerySuffix()}`);
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

  function closeReview(): void {
    setReviewCurrent(null);
    if (!reviewCatalogDirtyRef.current) return;
    reviewCatalogDirtyRef.current = false;
    setCatalogVersion((value) => value + 1);
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

  async function openDuplicateDriveRecommendations(force = false) {
    setDuplicateDriveRecommendationsOpen(true);
    setDuplicateDriveRecommendationsLoading(true);
    setDuplicateDriveRecommendationsError("");
    try {
      await fetchDuplicateDriveRecommendations(force);
    } catch (error) {
      setDuplicateDriveRecommendationsError(error instanceof Error ? error.message : "No se pudieron calcular los discos prioritarios.");
    } finally {
      setDuplicateDriveRecommendationsLoading(false);
    }
  }

  async function loadDeletionHistory(silent = false) {
    if (!silent) setDeletionHistoryLoading(true);
    setDeletionHistoryError("");
    try {
      const response = await api<DeletionHistoryResponse>("/api/review/deletions?limit=200");
      setDeletionHistory(response);
    } catch (error) {
      setDeletionHistoryError(error instanceof Error ? error.message : "No se pudo cargar el historial de borrados.");
    } finally {
      if (!silent) setDeletionHistoryLoading(false);
    }
  }

  async function openDeletionHistory() {
    setDeletionHistoryOpen(true);
    setDeletionHistoryMessage("");
    await loadDeletionHistory();
  }

  async function processPendingDeletionsNow() {
    if (deletionHistoryProcessing) return;
    setDeletionHistoryProcessing(true);
    setDeletionHistoryError("");
    setDeletionHistoryMessage("");
    try {
      const response = await api<{ ok: boolean; connectedDiskCount: number }>("/api/review/deletions/process", {
        method: "POST"
      });
      setDeletionHistoryMessage(
        `Orden enviada al companion para ${response.connectedDiskCount} disco(s). Los resultados aparecerán aquí.`
      );
      window.setTimeout(() => void loadDeletionHistory(true), 2500);
    } catch (error) {
      setDeletionHistoryError(error instanceof Error ? error.message : "No se pudo solicitar el borrado inmediato.");
    } finally {
      setDeletionHistoryProcessing(false);
    }
  }

  async function loadDownloadSummary(silent = false) {
    if (!companionOnline || downloadDiskIds.length === 0) {
      setDownloadSummary({ paused: false, counts: {}, pendingBytes: 0, entries: [] });
      return;
    }
    const params = new URLSearchParams();
    params.set("diskIds", downloadDiskQuery);
    if (!silent) setDownloadLoading(true);
    try {
      const response = await api<DownloadSummaryResponse>(`/api/downloads/summary?${params.toString()}`);
      setDownloadSummary(response);
      const removableIds = new Set(response.entries.filter((entry) => entry.status === "queued" || entry.status === "failed").map((entry) => entry.id));
      setSelectedDownloadQueueIds((current) => current.filter((id) => removableIds.has(id)));
    } finally {
      if (!silent) setDownloadLoading(false);
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

  async function regenerateSelectedThumbnails() {
    if (selectedFileIds.length === 0 || bulkBusy) return;
    setBulkBusy(true);
    setBulkMessage("");
    try {
      const queued = await api<{ ok: boolean; queued: number; diskIds: string[] }>("/api/files/batch/thumbnails/regenerate", {
        method: "POST",
        body: JSON.stringify({ fileIds: selectedFileIds })
      });
      setSelectedFileIds([]);
      setCatalogVersion((value) => value + 1);

      if (!companionLocalOnline) {
        setBulkMessage(`${queued.queued} video(s) en cola para regenerar. El companion los procesara en su proxima revision.`);
        return;
      }

      const port = localStorage.getItem("videocat-companion-port") ?? "29429";
      const token = localStorage.getItem("videocat-companion-token") ?? "";
      const headers = new Headers({ "Content-Type": "application/json" });
      if (token) headers.set("X-VideoCat-Companion-Token", token);
      const response = await fetch(`http://127.0.0.1:${port}/repair-thumbnails`, {
        method: "POST",
        headers,
        body: JSON.stringify({ diskIds: queued.diskIds })
      });
      const result = await response.json().catch(() => ({ ok: false })) as {
        ok?: boolean;
        accepted?: boolean;
        busy?: boolean;
        reason?: string;
      };
      if (response.status === 401 || response.status === 403 || result.reason === "forbidden") {
        setBulkMessage(`${queued.queued} video(s) en cola. Falta el token del Companion o no es válido: pégalo en Perfil › Companion local.`);
      } else if (result.busy) {
        setBulkMessage(`${queued.queued} video(s) en cola. El companion terminara primero el escaneo actual.`);
      } else if (response.ok && result.ok && result.accepted) {
        setBulkMessage(`${queued.queued} video(s) en cola. Regeneracion iniciada en el companion.`);
      } else {
        setBulkMessage(`${queued.queued} video(s) en cola. Se procesaran en la proxima revision del companion.`);
      }
    } catch (error) {
      setBulkMessage(error instanceof Error ? error.message : "No se pudo solicitar la regeneracion de miniaturas.");
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
    if (!companionOnline) {
      setDownloadMessage("El Companion no está en ejecución o no está sincronizado con VideoCAT.");
      return;
    }
    if (downloadDiskIds.length === 0) {
      setDownloadMessage("Selecciona al menos un disco conectado.");
      return;
    }

    setDownloadLoading(true);
    setDownloadMessage("");
    try {
      const response = await api<RandomDownloadResponse>("/api/downloads/random", {
        method: "POST",
        body: JSON.stringify({
          diskIds: downloadDiskIds,
          targetGb,
          folders: randomDownloadFolders
        })
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
    if (downloadPauseBusy) return;
    setDownloadPauseBusy(true);
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
      setDownloadPauseBusy(false);
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

  function requestClearProcessedDownloadQueue() {
    const doneCount = downloadSummary?.counts.done ?? 0;
    if (doneCount === 0) return;
    setClearProcessedQueuePromptOpen(true);
  }

  async function clearProcessedDownloadQueue() {
    setClearProcessedQueuePromptOpen(false);
    setDownloadActionBusy(true);
    setDownloadMessage("");
    try {
      const response = await api<{ ok: boolean; cleared: number }>("/api/downloads/history", { method: "DELETE" });
      setDownloadMessage(`${response.cleared} descarga(s) completada(s) eliminadas del historial.`);
      setCatalogVersion((value) => value + 1);
      await loadDownloadSummary();
    } catch (error) {
      setDownloadMessage(error instanceof Error ? error.message : "No se pudo eliminar el historial de descargas.");
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
    setDownloadProcessing(true);
    setDownloadMessage("");
    try {
      if (!companionLocalOnline) {
        const result = await api<{ ok: boolean; connectedDiskCount: number }>("/api/downloads/process", {
          method: "POST"
        });
        setDownloadMessage(`Orden enviada al Companion de la PC (${result.connectedDiskCount} disco(s) conectado(s)).`);
        window.setTimeout(() => void loadDownloadSummary(), 1800);
        return;
      }

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
          ? "Falta el token del Companion o no es válido. Pégalo en Perfil › Companion local."
          : result.reason === "not_available"
            ? "Companion no disponible."
            : result.detail ?? "No se pudo procesar la cola.";
        setDownloadMessage(message);
        return;
      }
      setDownloadMessage(`Procesamiento solicitado al companion (${result.processedDisks ?? 0} disco(s) revisados).`);
      window.setTimeout(() => void loadDownloadSummary(), 1200);
    } catch (error) {
      setDownloadMessage(
        companionOnline
          ? error instanceof Error ? error.message : "No se pudo enviar la orden al Companion de la PC."
          : "Companion no iniciado o no sincronizado con el servidor."
      );
    } finally {
      setDownloadProcessing(false);
      setDownloadActionBusy(false);
    }
  }

  async function decideReview(file: VideoFile, status: "keep" | "delete"): Promise<void> {
    setReviewLoading(true);
    setReviewMessage("");
    const prefetchedNext = reviewPrefetchRef.current?.currentFileId === file.id
      ? reviewPrefetchRef.current.promise
      : null;
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
      reviewCatalogDirtyRef.current = true;
      const next = await prefetchedNext
        ?? await api<ReviewNextResponse>(`/api/review/next${reviewNextQuerySuffix(file.id)}`);
      setReviewCurrent(next.file);
      setReviewRemaining(next.remaining);
      if (!next.file) {
        setReviewMessage("No quedan videos pendientes por revisar en los discos seleccionados.");
        reviewCatalogDirtyRef.current = false;
        setCatalogVersion((value) => value + 1);
      }
    } catch (error) {
      setReviewMessage(error instanceof Error ? error.message : "No se pudo guardar la decisión.");
      throw error;
    } finally {
      setReviewLoading(false);
    }
  }

  async function skipReviewVideo(file: VideoFile): Promise<void> {
    setReviewLoading(true);
    setReviewMessage("");
    const prefetchedNext = reviewPrefetchRef.current?.currentFileId === file.id
      ? reviewPrefetchRef.current.promise
      : null;
    try {
      const next = await prefetchedNext
        ?? await api<ReviewNextResponse>(`/api/review/next${reviewNextQuerySuffix(file.id)}`);
      if (!next.file) {
        setReviewMessage("No hay otro video pendiente para mostrar.");
        return;
      }
      setReviewCurrent(next.file);
      setReviewRemaining(next.remaining);
    } catch (error) {
      setReviewMessage(error instanceof Error ? error.message : "No se pudo cargar otro video.");
    } finally {
      setReviewLoading(false);
    }
  }

  // Reverts the last review decision: drops the keep/delete category and restores the previous status.
  async function undoReviewDecision(previous: VideoFile, status: "keep" | "delete"): Promise<boolean> {
    setReviewLoading(true);
    setReviewMessage("");
    try {
      let response = await api<{ file: VideoFile }>(`/api/files/${previous.id}/categories/${status}`, {
        method: "PATCH",
        body: JSON.stringify({ enabled: false })
      });
      if (previous.curationStatus !== "none" && previous.curationStatus !== status) {
        response = await api<{ file: VideoFile }>(`/api/files/${previous.id}/curation`, {
          method: "PATCH",
          body: JSON.stringify({ curationStatus: previous.curationStatus })
        });
      }
      const restored = response.file;
      setFiles((current) => current.map((item) => (item.id === restored.id ? restored : item)));
      setReviewRecent((current) => current.filter((item) => item.id !== restored.id));
      setReviewPending((current) => [restored, ...current.filter((item) => item.id !== restored.id)]);
      setReviewMarkedToday((value) => Math.max(0, value - 1));
      setReviewMarkedLast7Days((value) => Math.max(0, value - 1));
      setReviewPendingTotal((value) => value + 1);
      setReviewRemaining((value) => value + 1);
      reviewCatalogDirtyRef.current = true;
      setReviewCurrent(restored);
      return true;
    } catch (error) {
      setReviewMessage(error instanceof Error && error.message !== "File not found"
        ? error.message
        : "No se pudo deshacer: el archivo ya no está en el catálogo.");
      return false;
    } finally {
      setReviewLoading(false);
    }
  }

  function openDuplicateAssistant(startGroupKey?: string) {
    const startGroup = startGroupKey ? pendingAssistedDuplicateGroups.find((group) => group.key === startGroupKey) : undefined;
    const orderedGroups = startGroup
      ? [startGroup, ...pendingAssistedDuplicateGroups.filter((group) => group.key !== startGroup.key)]
      : pendingAssistedDuplicateGroups;
    const session = startDuplicateAssistantSession(orderedGroups);
    setDuplicateAssistantMessage("");
    setDuplicateAssistantFeedback(null);
    if (!session) {
      setDuplicateAssistantMessage("No quedan grupos de duplicados pendientes de decisión.");
      return;
    }
    warmDuplicatePreviewFiles([
      session.keeper,
      session.challenger,
      ...session.remaining.slice(0, 1),
      ...(session.groups[session.groupIndex + 1]?.contenders.slice(0, 2) ?? [])
    ]);
    setDuplicateAssistant(session);
  }

  function closeDuplicateAssistant() {
    setDuplicateAssistant(null);
    setDuplicateAssistantFeedback(null);
    if (duplicateAssistantDirtyRef.current) {
      duplicateAssistantDirtyRef.current = false;
      setCatalogVersion((value) => value + 1);
    }
  }

  function advanceDuplicateAssistant(session: DuplicateAssistantSession, keeper: VideoFile): DuplicateAssistantSession | null {
    const completedComparisons = session.completedComparisons + 1;
    if (session.remaining.length > 0) {
      return {
        ...session,
        keeper,
        challenger: session.remaining[0],
        remaining: session.remaining.slice(1),
        completedComparisons
      };
    }

    const nextGroupIndex = session.groupIndex + 1;
    const nextGroup = session.groups[nextGroupIndex];
    if (!nextGroup) return null;
    return {
      ...session,
      groupIndex: nextGroupIndex,
      keeper: nextGroup.contenders[0],
      challenger: nextGroup.contenders[1],
      remaining: nextGroup.contenders.slice(2),
      completedComparisons
    };
  }

  function refreshStats(): void {
    void api<Stats>("/api/stats").then(setStats).catch(() => undefined);
  }

  // Counters such as pending duplicates follow decisions made anywhere in the app.
  useEffect(() => {
    if (authenticated) refreshStats();
  }, [authenticated, catalogVersion, viewMode]);

  async function decideAssistedDuplicate(keepFileId: string) {
    const session = duplicateAssistant;
    if (!session || duplicateAssistantBusy) return;
    const keepFile = session.keeper.id === keepFileId ? session.keeper : session.challenger;
    const deleteFile = session.keeper.id === keepFileId ? session.challenger : session.keeper;
    setDuplicateAssistantBusy(true);
    setDuplicateAssistantFeedback(keepFileId);
    setDuplicateAssistantMessage("");

    try {
      const response = await api<{ keepFile: VideoFile; deleteFile: VideoFile }>("/api/duplicates/assisted/decision", {
        method: "POST",
        body: JSON.stringify({
          keepFileId: keepFile.id,
          deleteFileId: deleteFile.id,
          groupFileIds: session.groups[session.groupIndex].files.map((file) => file.id)
        })
      });
      const updatedById = new Map([
        [response.keepFile.id, response.keepFile],
        [response.deleteFile.id, response.deleteFile]
      ]);
      setDuplicateGroups((current) => current.map((group) => ({
        ...group,
        files: group.files.map((file) => updatedById.get(file.id) ?? file)
      })));
      duplicateAssistantDirtyRef.current = true;
      refreshStats();
      const next = advanceDuplicateAssistant(session, response.keepFile);
      setDuplicateAssistant(next);
      setDuplicateAssistantFeedback(null);
      if (!next) {
        duplicateAssistantDirtyRef.current = false;
        setDuplicateAssistantMessage("Revisión asistida completada.");
        setCatalogVersion((value) => value + 1);
      }
    } catch (error) {
      setDuplicateAssistantFeedback(null);
      setDuplicateAssistantMessage(error instanceof Error ? error.message : "No se pudo guardar la decisión.");
    } finally {
      setDuplicateAssistantBusy(false);
    }
  }

  function skipAssistedDuplicateGroup() {
    const session = duplicateAssistant;
    if (!session) return;
    const nextGroupIndex = session.groupIndex + 1;
    const nextGroup = session.groups[nextGroupIndex];
    if (!nextGroup) {
      setDuplicateAssistant(null);
      setDuplicateAssistantMessage("No quedan más grupos en esta sesión.");
      if (duplicateAssistantDirtyRef.current) {
        duplicateAssistantDirtyRef.current = false;
        setCatalogVersion((value) => value + 1);
      }
      return;
    }
    setDuplicateAssistant({
      ...session,
      groupIndex: nextGroupIndex,
      keeper: nextGroup.contenders[0],
      challenger: nextGroup.contenders[1],
      remaining: nextGroup.contenders.slice(2),
      completedComparisons: session.completedComparisons + session.remaining.length + 1
    });
    setDuplicateAssistantFeedback(null);
  }

  async function openAdjacentDetail(offset: -1 | 1) {
    if (selectedIndex < 0) return;
    const nextFile = files[selectedIndex + offset];
    if (!nextFile) return;
    await openDetail(nextFile);
  }

  function requestProtectedFolderPin(
    folder: string,
    action: ProtectedPinPrompt["action"],
    scope: ProtectedPinPrompt["scope"] = "catalog"
  ) {
    setProtectedPin("");
    setPinSubmitting(false);
    setPinPrompt({ folder, action, scope });
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

      if (prompt.scope === "download") {
        if (prompt.action === "expand") {
          setDownloadExpandedFolders((current) => (current.includes(prompt.folder) ? current : [...current, prompt.folder]));
        } else {
          const hasChildren = (downloadFolderChildren.get(prompt.folder) ?? 0) > 0;
          if (hasChildren) {
            setDownloadExpandedFolders((current) => (current.includes(prompt.folder) ? current : [...current, prompt.folder]));
          }
          setRandomDownloadFolders((current) => nextSelectedFolders(current, prompt.folder));
        }
      } else if (prompt.action === "expand") {
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

  function togglePanelDisk(diskId: string) {
    if (viewMode === "downloads") {
      setDownloadDiskIds((current) =>
        current.includes(diskId) ? current.filter((id) => id !== diskId) : [...current, diskId]
      );
      setRandomDownloadFolders([]);
      setDownloadExpandedFolders([]);
      setDownloadFolderSearch("");
      return;
    }
    toggleDisk(diskId);
  }

  function selectAllPanelDisks() {
    if (viewMode === "downloads") {
      setDownloadDiskIds(downloadConnectedDisks.map((disk) => disk.id));
      setRandomDownloadFolders([]);
      return;
    }
    selectAllDisks();
  }

  function selectNoPanelDisks() {
    if (viewMode === "downloads") {
      setDownloadDiskIds([]);
      setRandomDownloadFolders([]);
      return;
    }
    selectNoDisks();
  }

  async function showMountedDisksFromCompanion() {
    const port = localStorage.getItem("videocat-companion-port") ?? "29429";
    const token = localStorage.getItem("videocat-companion-token") ?? "";
    setDetectingConnected(true);
    setConnectedMessage("");

    try {
      if (!companionLocalOnline) {
        const [status, refreshed] = await Promise.all([
          api<CompanionStatusResponse>("/api/companion/status"),
          api<{ disks: Disk[] }>("/api/disks")
        ]);
        setCompanionOnline(status.online);
        setCompanionVersion(status.online ? (status.version ?? 0) : 0);
        setCompanionMountedDiskCount(status.online ? (status.mountedDiskCount ?? 0) : 0);
        const mountedDiskIds = status.online ? (status.mountedDiskIds ?? []) : [];
        setCompanionMountedDiskIds(mountedDiskIds);
        setDisks(refreshed.disks);

        if (!status.online) {
          setConnectedMessage("Companion no iniciado o no sincronizado con el servidor");
          return;
        }

        const matchingIds = refreshed.disks
          .filter((disk) => mountedDiskIds.includes(disk.id))
          .map((disk) => disk.id);
        setConnectedDiskIds(matchingIds);
        clearDiskScopedFilters();
        setConnectedMessage(
          matchingIds.length > 0
            ? `${matchingIds.length} disco(s) detectado(s) por el Companion de la PC`
            : "Companion activo, sin discos VideoCAT conectados"
        );
        return;
      }

      const headers = new Headers();
      if (token) headers.set("X-VideoCat-Companion-Token", token);
      const response = await fetch(`http://127.0.0.1:${port}/mounted-disks`, { headers });
      const result = await response.json().catch(() => ({ ok: false, disks: [] })) as { ok?: boolean; disks?: MountedCompanionDisk[]; reason?: string };
      if (response.status === 401 || response.status === 403 || result.reason === "forbidden") {
        setConnectedMessage("Falta el token del Companion o no es válido. Pégalo en Perfil › Companion local.");
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
      setCompanionOnline(true);
      setCompanionMountedDiskCount(mountedDisks.length);
      setCompanionMountedDiskIds(matchingIds);
      clearDiskScopedFilters();
      setConnectedMessage(
        matchingIds.length > 0
          ? `${matchingIds.length} disco(s) conectados detectados${unmatchedCount > 0 ? `; ${unmatchedCount} sin catalogo asociado` : ""}`
          : "No hay discos VideoCAT conectados detectados"
      );
    } catch (error) {
      setConnectedMessage(
        companionOnline
          ? error instanceof Error
            ? `No se pudo consultar el Companion mediante el servidor: ${error.message}`
            : "No se pudo consultar el Companion mediante el servidor"
          : "Companion no iniciado o no sincronizado con el servidor"
      );
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

  function isDownloadFolderLocked(folder: string): boolean {
    if (protectedUnlocked) return false;
    return downloadFacets.folders.some((item) => item.path === folder && item.locked);
  }

  function toggleDownloadFolder(folder: string) {
    if (isDownloadFolderLocked(folder)) {
      requestProtectedFolderPin(folder, "select", "download");
      return;
    }

    const hasChildren = (downloadFolderChildren.get(folder) ?? 0) > 0;
    if (hasChildren) {
      setDownloadExpandedFolders((current) => (current.includes(folder) ? current : [...current, folder]));
    }
    setRandomDownloadFolders((current) => nextSelectedFolders(current, folder));
  }

  function toggleDownloadFolderExpansion(folder: string) {
    if (isDownloadFolderLocked(folder)) {
      requestProtectedFolderPin(folder, "expand", "download");
      return;
    }

    setDownloadExpandedFolders((current) =>
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

  function openFolderInCatalog(folder: string) {
    const parts = folder.split("/").filter(Boolean);
    const ancestors = parts.slice(0, -1).map((_, index) => parts.slice(0, index + 1).join("/"));
    setSelectedFolders([folder]);
    setExpandedFolders((current) => [...new Set([...current, ...ancestors])]);
    setFolderSearch("");
    setPage(1);
    setSelected(null);
    navigateToView("catalog");
  }

  function clearCatalogFilters() {
    setExtension("");
    setSelectedFolders([]);
    setSelectedTags([]);
    setDuplicateOnly(false);
    setCurationStatus("");
    setPage(1);
  }

  const activeCatalogFilters: Array<{ key: string; label: string; onRemove: () => void }> = [
    ...(extension ? [{ key: "extension", label: extension.toUpperCase(), onRemove: () => { setExtension(""); setPage(1); } }] : []),
    ...selectedFolders.map((folder) => ({
      key: `folder:${folder}`,
      label: folder,
      onRemove: () => {
        setSelectedFolders((current) => current.filter((item) => item !== folder));
        setPage(1);
      }
    })),
    ...(duplicateOnly ? [{ key: "duplicates", label: "Duplicados probables", onRemove: () => { setDuplicateOnly(false); setPage(1); } }] : []),
    ...(curationStatus
      ? [{ key: "category", label: categoryLabel(curationStatus, facets.curationStatuses), onRemove: () => { setCurationStatus(""); setPage(1); } }]
      : []),
    ...selectedTags.map((tag) => ({ key: `tag:${tag}`, label: `#${tag}`, onRemove: () => toggleTag(tag) }))
  ];
  const showCatalogFilters = filtersOpen && (!selected || wideCatalog);
  // Drive selection and catalog totals only matter for views that read the catalog.
  const showCatalogContext = viewMode !== "admin" && viewMode !== "profile";
  const shortcutLabel = /Mac|iPhone|iPad/.test(navigator.platform) ? "⌘K" : "Ctrl K";

  function showFullCatalog() {
    clearFilters();
    navigateToView("catalog");
    setSelected(null);
    setReviewCurrent(null);
    setReviewMessage("");
  }

  const queuedDownloadCount = (downloadSummary?.counts.queued ?? 0) + (downloadSummary?.counts.downloading ?? 0);
  const navigationItems: NavigationItem[] = [
    { mode: "catalog", label: "Catálogo", icon: <LayoutGrid size={18} /> },
    { mode: "review", label: "Review", icon: <Shuffle size={18} /> },
    { mode: "downloads", label: "A descargar", icon: <Download size={18} />, badge: queuedDownloadCount > 0 ? formatCount(queuedDownloadCount) : undefined },
    { mode: "duplicates", label: "Duplicados", icon: <Copy size={18} />, badge: (stats?.pendingDuplicateGroupCount ?? 0) > 0 ? formatCount(stats?.pendingDuplicateGroupCount ?? 0) : undefined },
    { mode: "usage", label: "Esquema de uso", icon: <PieChart size={18} /> },
    { mode: "audit", label: "Auditoría", icon: <ListChecks size={18} /> },
    { mode: "admin", label: "Administración", icon: <Server size={18} /> },
    { mode: "profile", label: "Perfil", icon: <User size={18} /> }
  ];
  const activeNavigationItem = navigationItems.find((item) => item.mode === viewMode) ?? navigationItems[0];
  const primaryNavigationItems = navigationItems.filter((item) => item.mode !== "admin" && item.mode !== "profile");
  const secondaryNavigationItems = navigationItems.filter((item) => item.mode === "admin" || item.mode === "profile");
  const mobileTabModes: ViewMode[] = ["catalog", "review", "duplicates", "downloads"];
  const mobileTabItems = mobileTabModes.flatMap((mode) => navigationItems.filter((item) => item.mode === mode));
  const mobileMoreItems = navigationItems.filter((item) => !mobileTabModes.includes(item.mode));

  function switchView(mode: ViewMode): void {
    navigateToView(mode);
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
    if (viewMode === "review" && reviewCurrent?.id === response.file.id) {
      reviewCatalogDirtyRef.current = true;
    } else {
      setCatalogVersion((value) => value + 1);
    }
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

  function handleDiskPurged(disk: Disk) {
    setSelected((current) => (current?.diskId === disk.id ? null : current));
    setDuplicates((current) => current.filter((file) => file.diskId !== disk.id));
    setFiles((current) => current.filter((file) => file.diskId !== disk.id));
    setPage(1);
    setCatalogVersion((value) => value + 1);
  }

  function handleSecuritySaved(security: ProfileSecurityResponse) {
    setProfileSecurity(security);
    setProtectedUnlockVersion((value) => value + 1);
    setCatalogVersion((value) => value + 1);
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
            <button className="theme-button login-theme-button" onClick={toggleTheme} title="Cambiar tema">
              {theme === "dark" ? <Sun size={18} /> : <Moon size={18} />}
            </button>
          </div>
          <div className="brand-lockup login-brand">
            <span className="vc-catmark is-large" aria-hidden="true" />
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
          <div className="login-footer-controls">
            <select
              className="language-select login-language-select"
              value={language}
              onChange={(event) => setLanguage(normalizeLanguage(event.target.value))}
              title="Idioma"
              aria-label="Idioma"
            >
              <option value="es">{languageLabel("es")}</option>
              <option value="en">{languageLabel("en")}</option>
            </select>
          </div>
        </section>
      </main>
    );
  }

  return (
    <div className={`vc-frame ${sidebarCollapsed ? "is-sidebar-collapsed" : ""}`}>
      <AppSidebar
        {...{
          availableUpdate,
          companionIndicatorLabel,
          companionIndicatorState,
          connectedDiskIds,
          disks,
          language,
          logout,
          primaryNavigationItems,
          secondaryNavigationItems,
          setSidebarCollapsed,
          showFullCatalog,
          sidebarCollapsed,
          switchView,
          viewMode
        }}
      />

      <main className="vc-main">
        <AppHeader
          {...{
            activeCatalogFilters,
            activeNavigationItem,
            closeThemePanel,
            companionIndicatorLabel,
            companionIndicatorState,
            filtersOpen,
            language,
            q,
            resolvedAppearance,
            searchInputRef,
            setFiltersOpen,
            setLanguage,
            setPage,
            setQ,
            setSelected,
            setThemePanelOpen,
            shortcutLabel,
            showCatalogFilters,
            showFullCatalog,
            theme,
            themePanelOpen,
            themePreferences,
            toggleTheme,
            updateThemePreferences,
            viewMode
          }}
        />

        <div className="vc-content">
      {showCatalogContext ? (
        <CatalogContext
          {...{
            companionLocalOnline,
            companionMountedDiskIds,
            companionNeedsUpdate,
            companionOnline,
            connectedMessage,
            connectedPanelCollapsed,
            detectingConnected,
            disks,
            downloadConnectionMessage,
            panelDisks,
            panelSelectedDiskIds,
            selectAllPanelDisks,
            selectNoPanelDisks,
            setConnectedPanelCollapsed,
            showMountedDisksFromCompanion,
            stats,
            switchView,
            togglePanelDisk,
            viewMode
          }}
        />
      ) : null}

      {viewMode === "catalog" ? (
        <CatalogView
          {...{
            activeCatalogFilters,
            allVisibleSelected,
            applyBulkCategory,
            beginFilterResize,
            bulkBusy,
            bulkCategoryKey,
            bulkMessage,
            canOpenNext,
            canOpenPrevious,
            catalogView,
            categoryError,
            categorySubmitting,
            changeSort,
            clearCatalogFilters,
            clearFileSelection,
            compactLayout,
            companionLocalOnline,
            companionMountedDiskIds,
            companionOnline,
            createCategory,
            curationStatus,
            deleteCategory,
            duplicateOnly,
            duplicates,
            extension,
            extensions,
            facets,
            files,
            filterWidth,
            folderSearch,
            handlePageInput,
            handlePageSizeChange,
            loading,
            locale,
            maxTagCount,
            newCategoryColor,
            newCategoryLabel,
            openAdjacentDetail,
            openDetail,
            openRandomConnectedDetail,
            page,
            pageCount,
            pageSize,
            profileSecurity,
            queueSelectedDownloads,
            regenerateSelectedThumbnails,
            removeDeletedFile,
            selected,
            selectedFileIdSet,
            selectedFileIds,
            selectedFolders,
            selectedTags,
            setBulkCategoryKey,
            setCatalogView,
            setCurationStatus,
            setDuplicateOnly,
            setExtension,
            setFiltersOpen,
            setFolderSearch,
            setNewCategoryColor,
            setNewCategoryLabel,
            setPage,
            setSelected,
            setSortBy,
            setSortDirection,
            showCatalogFilters,
            sortBy,
            sortDirection,
            toggleFileCategory,
            toggleFileSelection,
            toggleFolder,
            toggleFolderExpansion,
            toggleTag,
            toggleVisibleSelection,
            total,
            visibleFolders,
            visibleSelectedCount
          }}
        />
      ) : null}

      {viewMode === "review" ? (
        <ReviewHomeView
          {...{
            companionMountedDiskIds,
            companionOnline,
            facets,
            loadNextReviewVideo,
            locale,
            openDeletionHistory,
            openDetail,
            openRecoverableSpace,
            reviewCurrent,
            reviewFreedBytes,
            reviewLoading,
            reviewMarkedLast7Days,
            reviewMarkedToday,
            reviewMessage,
            reviewPending,
            reviewPendingTotal,
            reviewRecent
          }}
        />
      ) : null}

      {viewMode === "downloads" ? (
        <DownloadsView
          locale={locale}
          categories={downloadFacets.curationStatuses}
          summary={downloadSummary}
          loading={downloadLoading}
          actionBusy={downloadActionBusy}
          pauseBusy={downloadPauseBusy}
          processing={downloadProcessing}
          message={downloadMessage}
          companion={{
            online: companionOnline,
            localOnline: companionLocalOnline,
            needsUpdate: companionNeedsUpdate,
            connectedDiskCount: downloadConnectedDisks.length,
            connectionMessage: downloadConnectionMessage
          }}
          selectedDiskCount={downloadDiskIds.length}
          transfer={{
            active: activeDownload,
            percent: activeDownloadPercent,
            speedBytesPerSecond: currentDownloadSpeed,
            speedSamples: downloadSpeedSamples,
            fileEtaSeconds: activeDownloadEta,
            queueEtaSeconds: downloadQueueEta,
            fileRemainingBytes: activeDownloadRemainingBytes,
            pendingBytes: pendingDownloadBytes
          }}
          random={{
            gigabytes: randomDownloadGb,
            folders: randomDownloadFolders,
            folderSearch: downloadFolderSearch,
            visibleFolders: visibleDownloadFolders
          }}
          selection={{
            ids: selectedDownloadQueueIds,
            idSet: selectedDownloadQueueIdSet,
            removableCount: removableDownloadEntries.length,
            allRemovableSelected: allRemovableDownloadsSelected
          }}
          onProcess={() => void processDownloadQueueNow()}
          onTogglePause={() => void setDownloadPaused(!(downloadSummary?.paused ?? false))}
          onRefresh={() => void loadDownloadSummary()}
          onClearQueue={() => void clearDownloadQueue()}
          onClearHistory={requestClearProcessedDownloadQueue}
          onRandomGigabytesChange={setRandomDownloadGb}
          onQueueRandom={() => void queueRandomDownloads()}
          onRandomFoldersReset={() => setRandomDownloadFolders([])}
          onRandomFolderSearchChange={setDownloadFolderSearch}
          onToggleRandomFolder={toggleDownloadFolder}
          onToggleRandomFolderExpansion={toggleDownloadFolderExpansion}
          onToggleSelection={toggleDownloadSelection}
          onToggleAllSelection={toggleAllRemovableDownloads}
          onClearSelection={() => setSelectedDownloadQueueIds([])}
          onRemoveSelected={() => void removeSelectedDownloads()}
          onOpenFile={(file) => void openDetail(file)}
        />
      ) : null}

      {viewMode === "duplicates" ? (
        <DuplicatesView
          {...{
            auxLoading,
            duplicateAssistantMessage,
            duplicateDriveRecommendations,
            duplicateGroups,
            duplicateRecoverableBytes,
            facets,
            language,
            loading,
            locale,
            openDetail,
            openDuplicateAssistant,
            openDuplicateDriveRecommendations,
            pendingAssistedDuplicateGroups,
            total
          }}
        />
      ) : null}

      {viewMode === "usage" ? (
        <UsageView
          diskQuery={diskQuery}
          noDisksSelected={disks.length > 0 && connectedDiskIds.length === 0}
          refreshKey={catalogVersion}
          onOpenInCatalog={openFolderInCatalog}
        />
      ) : null}

      {viewMode === "audit" ? (
        <AuditView
          diskQuery={diskQuery}
          noDisksSelected={disks.length > 0 && connectedDiskIds.length === 0}
          refreshKey={catalogVersion}
          locale={locale}
        />
      ) : null}

      {viewMode === "admin" ? (
        <AdminView
          locale={locale}
          refreshKey={catalogVersion}
          mountedDiskIds={companionMountedDiskIds}
          onDiskPurged={handleDiskPurged}
        />
      ) : null}

      {viewMode === "profile" ? (
        <ProfileView
          security={profileSecurity}
          onSecuritySaved={handleSecuritySaved}
          themePreferences={themePreferences}
          resolvedAppearance={resolvedAppearance}
          onThemeChange={updateThemePreferences}
          language={language}
          onLanguageChange={setLanguage}
        />
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

      {duplicateDriveRecommendationsOpen ? (
        <DuplicateDriveRecommendationsModal
          data={duplicateDriveRecommendations}
          language={language}
          locale={locale}
          loading={duplicateDriveRecommendationsLoading}
          error={duplicateDriveRecommendationsError}
          onClose={() => setDuplicateDriveRecommendationsOpen(false)}
          onRefresh={() => void openDuplicateDriveRecommendations(true)}
        />
      ) : null}

      {deletionHistoryOpen ? (
        <DeletionHistoryModal
          data={deletionHistory}
          locale={locale}
          loading={deletionHistoryLoading}
          processing={deletionHistoryProcessing}
          error={deletionHistoryError}
          message={deletionHistoryMessage}
          onClose={() => setDeletionHistoryOpen(false)}
          onRefresh={() => void loadDeletionHistory()}
          onProcess={() => void processPendingDeletionsNow()}
        />
      ) : null}

      {reviewCurrent ? (
        <ReviewSession
          file={reviewCurrent}
          upcoming={reviewUpcoming}
          categories={facets.curationStatuses}
          loading={reviewLoading}
          remaining={reviewRemaining}
          pendingTotal={reviewPendingTotal}
          markedToday={reviewMarkedToday}
          markedLast7Days={reviewMarkedLast7Days}
          message={reviewMessage}
          onClose={closeReview}
          onDecision={(status) => decideReview(reviewCurrent, status)}
          onSkip={() => skipReviewVideo(reviewCurrent)}
          onUndo={(entry) => undoReviewDecision(entry.previous, entry.status)}
          onToggleCategory={(categoryKey, enabled) => void toggleFileCategory(reviewCurrent, categoryKey, enabled)}
        />
      ) : null}

      {duplicateAssistant ? (
        <DuplicateAssistantModal
          session={duplicateAssistant}
          language={language}
          prefetchedFiles={duplicatePreviewFiles}
          resolvePreviewFile={fetchDuplicatePreviewFile}
          busy={duplicateAssistantBusy}
          feedbackFileId={duplicateAssistantFeedback}
          message={duplicateAssistantMessage}
          onClose={closeDuplicateAssistant}
          onDecision={(fileId) => void decideAssistedDuplicate(fileId)}
          onSkip={skipAssistedDuplicateGroup}
        />
      ) : null}

      {selected && viewMode !== "catalog" ? (
        <FileDetail
          file={selected}
          duplicates={duplicates}
          locale={locale}
          canOpenPrevious={canOpenPrevious}
          canOpenNext={canOpenNext}
          onPrevious={() => openAdjacentDetail(-1)}
          onNext={() => openAdjacentDetail(1)}
          onRandom={(excludeId) => openRandomConnectedDetail(excludeId)}
          onClose={() => setSelected(null)}
          categories={facets.curationStatuses}
          companionOnline={companionOnline}
          companionLocalOnline={companionLocalOnline}
          companionMountedDiskIds={companionMountedDiskIds}
          chromecastEnabled={profileSecurity?.chromecastEnabled ?? false}
          onToggleCategory={(categoryKey, enabled) => toggleFileCategory(selected, categoryKey, enabled)}
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
      {clearProcessedQueuePromptOpen ? (
        <ClearDownloadHistoryConfirmModal
          submitting={downloadActionBusy}
          onCancel={() => setClearProcessedQueuePromptOpen(false)}
          onConfirm={() => void clearProcessedDownloadQueue()}
        />
      ) : null}
        </div>
      </main>

      <MobileNav
        {...{
          companionIndicatorLabel,
          companionIndicatorState,
          connectedDiskIds,
          disks,
          logout,
          mobileMenuOpen,
          mobileMoreItems,
          mobileTabItems,
          setMobileMenuOpen,
          setThemePanelOpen,
          switchView,
          viewMode
        }}
      />

    </div>
  );
}
