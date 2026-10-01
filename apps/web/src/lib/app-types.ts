import type { Disk, VideoFile } from "../types";

export type SortBy = "filename" | "sizeBytes" | "durationSeconds" | "modifiedAt" | "createdAt";

export type SortDirection = "asc" | "desc";

export type ViewMode = "catalog" | "review" | "downloads" | "duplicates" | "usage" | "audit" | "admin" | "profile";

export type BrowserPlaybackSupport = {
  result: "" | "maybe" | "probably";
  mediaType: string;
  remuxUseful: boolean;
};

export type CurationStatus = string;

export type CurationCategory = {
  key: string;
  label: string;
  color: string;
  builtIn: boolean;
  count: number;
};

export type FileResponse = {
  files: VideoFile[];
  page: number;
  pageSize: number;
  total: number;
};

export type ReviewNextResponse = {
  file: VideoFile | null;
  remaining: number;
};

export type ReviewPrefetch = {
  currentFileId: string;
  promise: Promise<ReviewNextResponse | null>;
};

export type ReviewSummaryResponse = {
  pendingTotal: number;
  markedToday: number;
  markedLast7Days: number;
  freedBytes: number;
  pending: VideoFile[];
  recent: VideoFile[];
};

export type DownloadQueueEntry = {
  id: string;
  status: "queued" | "downloading" | "done" | "failed";
  source: string;
  requestedAt?: string | null;
  startedAt?: string | null;
  completedAt?: string | null;
  destinationPath?: string | null;
  downloadedTag?: string | null;
  errorMessage?: string | null;
  progressBytes: number;
  progressUpdatedAt?: string | null;
  file: VideoFile;
};

export type DownloadSummaryResponse = {
  paused: boolean;
  counts: Record<string, number>;
  pendingBytes: number;
  entries: DownloadQueueEntry[];
};

export type DownloadSpeedSample = {
  timestamp: number;
  bytesPerSecond: number;
};

export type RandomDownloadResponse = {
  queued: number;
  queuedBytes: number;
  files: VideoFile[];
};

export type RecoverableSpaceDisk = {
  diskId: string;
  diskName: string;
  driveLetter?: string | null;
  volumeLabel?: string | null;
  totalBytes?: number | null;
  fileCount: number;
  recoverableBytes: number;
};

export type RecoverableSpaceResponse = {
  totalRecoverableBytes: number;
  disks: RecoverableSpaceDisk[];
};

export type DuplicateDriveRecommendation = {
  diskId: string;
  diskName: string;
  driveLetter?: string | null;
  volumeLabel?: string | null;
  totalBytes?: number | null;
  connected: boolean;
  groupCount: number;
  fileCount: number;
  readyFileCount: number;
  readyBytes: number;
  pendingFileCount: number;
  pendingBytes: number;
  recoverableBytes: number;
};

export type DuplicateDriveRecommendationsResponse = {
  groupCount: number;
  totalRecoverableBytes: number;
  totalReadyBytes: number;
  totalPendingBytes: number;
  disks: DuplicateDriveRecommendation[];
};

export type CachedDuplicateGroups = {
  expiresAt: number;
  groups: DuplicateGroup[];
};

export type CachedDuplicateDriveRecommendations = {
  expiresAt: number;
  response: DuplicateDriveRecommendationsResponse;
};

export type DeletionHistoryEntry = {
  id: string;
  videoFileId: string;
  diskId?: string | null;
  diskName: string;
  driveLetter?: string | null;
  filename: string;
  relativePath: string;
  sizeBytes: number;
  status: "pending" | "deleted" | "missing" | "failed";
  requestedAt: string;
  attemptedAt?: string | null;
  completedAt?: string | null;
  errorMessage?: string | null;
  connected: boolean;
};

export type DeletionHistoryResponse = {
  companionOnline: boolean;
  connectedDiskCount: number;
  summary: {
    pending: number;
    deleted: number;
    missing: number;
    failed: number;
    deletedBytes: number;
  };
  entries: DeletionHistoryEntry[];
};

export type FolderUsageItem = {
  diskId: string;
  diskName: string;
  folder: string;
  sizeBytes: number;
  fileCount: number;
  estimated: boolean;
};

export type AuditErrorItem = {
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

export type AuditSummaryItem = {
  category: string;
  phase: string;
  count: number;
};

export type DuplicateGroup = {
  key: string;
  count: number;
  confidence: number;
  matchType: "same_size" | "visual" | "mixed";
  reasons: string[];
  recoverableBytes: number;
  files: VideoFile[];
};

export type AssistedDuplicateGroup = DuplicateGroup & {
  contenders: VideoFile[];
};

export type DuplicateAssistantSession = {
  groups: AssistedDuplicateGroup[];
  groupIndex: number;
  keeper: VideoFile;
  challenger: VideoFile;
  remaining: VideoFile[];
  completedComparisons: number;
  totalComparisons: number;
};

export type AdminPurgeResponse = {
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

export type AdminDiskAction = {
  id: string;
  type: "scan" | "deletion";
  status: string;
  occurredAt: string;
  fileCount?: number | null;
  errorCount?: number | null;
  filename?: string | null;
  sizeBytes?: number | null;
};

export type AdminDiskOverview = {
  disk: Disk;
  storage: {
    totalBytes?: number | null;
    freeBytes?: number | null;
    usedBytes?: number | null;
    catalogedBytes: number;
  };
  catalog: {
    presentFiles: number;
    missingFiles: number;
    scanCount: number;
    errorCount: number;
    deletionCount: number;
  };
  latestScan?: {
    status: string;
    startedAt: string;
    finishedAt?: string | null;
    fileCount: number;
    errorCount: number;
  } | null;
  recentActions: AdminDiskAction[];
};

export type CompanionAdminItem = {
  installationId: string;
  name: string | null;
  version: number;
  mountedDiskCount: number;
  firstSeenAt: string;
  lastSeenAt: string;
  revokedAt: string | null;
  credentialIssuedAt: string | null;
  authMode: "legacy" | "paired" | string;
  tunnel?: {
    connected: boolean;
    connectedAt: string | null;
    lastSeenAt: string | null;
    protocolVersion: number | null;
    capabilities: {
      control: boolean;
      streamRead: boolean;
      streamRemux: boolean;
    } | null;
  };
};

export type CompanionPairingCode = {
  code: string;
  expiresAt: string;
};

export type ProfileSecurityResponse = {
  hasPin: boolean;
  protectedFolderPatterns: string[];
  chromecastEnabled: boolean;
};

export type CastAccessResponse = {
  path: string;
  expiresAt: string;
  mimeType: string;
};

export type FacetResponse = {
  folders: { path: string; label: string; depth: number; count: number; locked: boolean }[];
  tags: { tag: string; count: number }[];
  extensions: { extension: string; count: number }[];
  curationStatuses: CurationCategory[];
  protectedUnlocked: boolean;
};

export type FolderFacet = FacetResponse["folders"][number];

export type VisibleFolder = FolderFacet & {
  hasChildren: boolean;
  isExpanded: boolean;
};

export type ProtectedPinPrompt = {
  folder: string;
  action: "expand" | "select";
  scope: "catalog" | "download";
};

export type CompanionAction = "open-file" | "open-folder" | "delete-file";

export type CompanionReason = "not_available" | "forbidden" | "bad_request" | "open_failed";

export type CompanionResponse = {
  ok: boolean;
  reason?: CompanionReason;
  detail?: string;
};

export type CompanionProcessDownloadsResponse = {
  ok: boolean;
  processedDisks?: number;
  reason?: CompanionReason;
  detail?: string;
};

export type CompanionStatusResponse = {
  online: boolean;
  lastSeenAt?: string | null;
  staleAfterMs: number;
  version?: number;
  mountedDiskCount?: number;
  mountedDiskIds?: string[];
  agents?: Array<{
    installationId: string;
    name: string | null;
    version: number;
    lastSeenAt: string;
    revokedAt: string | null;
    authMode: string;
  }>;
};

export type StreamSessionResponse = {
  session: {
    id: string;
    status: "opening" | "ready" | "streaming" | "failed" | "cancelled" | "expired";
    expiresAt: string;
    mimeType: string | null;
    sizeBytes: number | null;
  };
};

export type MountedCompanionDisk = {
  root: string;
  diskId: string;
  diskName: string;
  scanRoots: string[];
};

export type VersionCheckResponse = {
  latestVersion: string | null;
  updateAvailable: boolean;
};

export type CatalogView = "grid" | "list";

export type ReviewDecision = "keep" | "delete";

export type ReviewSessionEntry = {
  previous: VideoFile;
  status: ReviewDecision;
};
