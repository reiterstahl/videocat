export type Disk = {
  id: string;
  name: string;
  // True when the name was chosen in the web (scans keep it).
  nameLocked?: boolean;
  volumeLabel?: string | null;
  volumeId?: string | null;
  driveLetter?: string | null;
  totalBytes?: number | null;
  freeBytes?: number | null;
  fileSystem?: string | null;
  // "s3" for buckets the server scans (Administración › Almacenamiento S3).
  kind?: "drive" | "s3";
  firstScannedAt: string;
  lastScannedAt: string;
  notes?: string | null;
};

export type Thumbnail = {
  id: string;
  kind: string;
  timestampSeconds?: number | null;
  relativePath: string;
  url: string;
};

export type VideoFile = {
  id: string;
  diskId: string;
  filename: string;
  extension: string;
  absolutePath: string;
  relativePath: string;
  sizeBytes: number;
  folderSizeBytes?: number | null;
  modifiedAt?: string | null;
  scanStatus: string;
  errorMessage?: string | null;
  // Read problem: when the web asked to read it again on the next scan.
  readRetryAt?: string | null;
  durationSeconds?: number | null;
  width?: number | null;
  height?: number | null;
  fps?: number | null;
  videoCodec?: string | null;
  audioCodec?: string | null;
  audioChannels?: number | null;
  bitrate?: number | null;
  containerFormat?: string | null;
  streamCount?: number | null;
  ffprobeJson?: unknown;
  curationStatus: string;
  categoryKeys: string[];
  downloadStatus?: string | null;
  downloadRequestedAt?: string | null;
  downloadCompletedAt?: string | null;
  downloadDestinationPath?: string | null;
  downloadedTag?: string | null;
  lastIndexedAt?: string | null;
  disk?: Disk;
  thumbnails: Thumbnail[];
  tags: string[];
  duplicateCount: number;
  isProbableDuplicate: boolean;
  duplicateConfidence?: number;
  duplicateMatchType?: "same_size" | "visual" | "mixed";
  duplicateReasons?: string[];
  // Unfinished transfer of this file ("In transit").
  transfer?: { state: TransferState; targetDiskId: string; targetFolder: string } | null;
};

export type Stats = {
  diskCount: number;
  fileCount: number;
  totalBytes: number;
  duplicateGroupCount: number;
  pendingDuplicateGroupCount: number;
  activeTransferJobs?: number;
};

export type FolderGroupLocation = {
  diskId: string;
  diskName: string;
  path: string;
  sizeBytes: number;
};

export type FolderGroupNode = {
  key: string;
  name: string;
  kind: "group" | "folder" | "files" | "rest" | "free";
  sizeBytes: number;
  fileCount: number;
  locations: FolderGroupLocation[];
  children: FolderGroupNode[];
};

export type FolderGroupSummary = {
  key: string;
  name: string;
  sizeBytes: number;
  fileCount: number;
  locations: FolderGroupLocation[];
  excluded: boolean;
};

export type FolderGroupMap = {
  sizeBytes: number;
  fileCount: number;
  roots: FolderGroupNode[];
  repeated: FolderGroupSummary[];
  excludedNames: string[];
  free?: Array<{ diskId: string; diskName: string; driveLetter: string | null; freeBytes: number }>;
};

export type CatalogLocationScope = {
  label: string;
  locations: Array<{ d: string; p: string }>;
};

export type TransferState =
  | "pending"
  | "staging"
  | "staged"
  | "source_removed"
  | "blocked_space"
  | "delivering"
  | "delivered"
  | "done"
  | "duplicate"
  | "cancelled";

export type TransferDestination = {
  id: string;
  diskId: string;
  diskName: string;
  path: string;
  nameKey: string;
  groupKeywords: string[];
  freeBytes: number | null;
  totalBytes: number | null;
  // Size of the starred folder and its namesakes on other drives (what Consolidar brings in).
  sizeBytes: number;
  fileCount: number;
  namesakes: Array<{ diskId: string; diskName: string; path: string; sizeBytes: number }>;
  largest: boolean;
};

export type ConsolidatePlan = {
  destination: { id: string; diskId: string; diskName: string; path: string };
  sources: Array<{ diskId: string; diskName: string; path: string; files: number; bytes: number }>;
  files: number;
  neededBytes: number;
  freeBytes: number | null;
  pendingBytes: number;
  reserveBytes: number;
  fits: boolean;
  // Present when the files do not fit yet: they still leave their drives and wait in staging.
  spaceWarning: { reason: "unknown_space" | "no_space"; shortBytes: number } | null;
  skipped: { duplicates: number; inTransfer: number; favorites: number; objectStorage?: number };
};

export type TransferNeed = {
  kind: "free_space" | "space_short" | "connect_target" | "connect_source";
  diskId: string;
  diskName: string;
  driveLetter: string | null;
  files: number;
  bytes: number;
  connected: boolean;
  detail: string | null;
  shortBytes?: number;
  // What is still due on that drive: files to copy onto it and files that will leave it.
  movement?: {
    incoming: { files: number; bytes: number; names: string[] };
    outgoing: { files: number; bytes: number; names: string[] };
  };
};

export type TransferSummary = {
  activeJobs: number;
  // The Companion's transfers wait while its download queue runs (downloads come first).
  waitingForDownloads?: boolean;
  transfersMode?: "running" | "stopping" | "stopped";
  stagingBytes: number;
  staging: {
    configured: boolean;
    path?: string | null;
    freeBytes?: number | null;
    totalBytes?: number | null;
    error?: string | null;
    companionName?: string | null;
    reportedAt?: number;
  } | null;
  needs: TransferNeed[];
};

export type TransferJob = {
  id: string;
  kind: "consolidate" | "group" | "tag";
  label: string | null;
  status: "active" | "paused" | "cancelled" | "done";
  createdAt: string;
  destination: { id: string; diskId: string; diskName: string; path: string };
  states: Partial<Record<TransferState, { files: number; bytes: number }>>;
};

export type TransferItem = {
  id: string;
  videoFileId: string | null;
  filename: string;
  sourceDiskId: string;
  sourceRelativePath: string;
  targetRelativePath: string | null;
  sizeBytes: number;
  state: TransferState;
  attempts: number;
  error: string | null;
  updatedAt: string;
};

export type GroupCandidates = {
  destination: { id: string; diskId: string; diskName: string; path: string; name: string };
  key: string;
  total: number;
  totalBytes: number;
  exact: number;
  similar: number;
  skipped: { inside: number; inTransfer: number; ignored: number; duplicates: number; favorites: number; objectStorage?: number };
  // Folder name first, then the optional keywords.
  keywords: string[];
  items: Array<{ id: string; match: "exact" | "similar"; keyword: string }>;
};

export type GroupFolder = {
  diskId: string;
  diskName: string;
  path: string;
  files: number;
  bytes: number;
  destinationId: string | null;
};

// A favourite folder: its videos (subfolders included) are never offered to move elsewhere.
export type FolderFavorite = {
  id: string;
  diskId: string;
  diskName: string;
  path: string;
};
