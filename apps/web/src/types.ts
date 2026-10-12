export type Disk = {
  id: string;
  name: string;
  volumeLabel?: string | null;
  volumeId?: string | null;
  driveLetter?: string | null;
  totalBytes?: number | null;
  freeBytes?: number | null;
  fileSystem?: string | null;
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
  kind: "group" | "folder" | "files" | "rest";
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
  freeBytes: number | null;
  totalBytes: number | null;
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
  skipped: { duplicates: number; inTransfer: number };
};

export type TransferNeed = {
  kind: "free_space" | "connect_target" | "connect_source";
  diskId: string;
  diskName: string;
  driveLetter: string | null;
  files: number;
  bytes: number;
  connected: boolean;
  detail: string | null;
};

export type TransferSummary = {
  activeJobs: number;
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
  kind: "consolidate" | "group";
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
  skipped: { inside: number; inTransfer: number; ignored: number; duplicates: number };
  items: Array<{ id: string; match: "exact" | "similar" }>;
};

export type GroupFolder = {
  diskId: string;
  diskName: string;
  path: string;
  files: number;
  bytes: number;
  destinationId: string | null;
};
