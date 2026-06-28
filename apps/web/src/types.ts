export type Disk = {
  id: string;
  name: string;
  volumeLabel?: string | null;
  volumeId?: string | null;
  driveLetter?: string | null;
  totalBytes?: number | null;
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
};

export type Stats = {
  diskCount: number;
  fileCount: number;
  totalBytes: number;
  duplicateGroupCount: number;
};
