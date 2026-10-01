export type FolderTreeFile = {
  diskId: string;
  diskName: string;
  relativePath: string;
  sizeBytes: number;
};

export type FolderTreeNode = {
  name: string;
  path: string;
  sizeBytes: number;
  fileCount: number;
  childFolderCount: number;
  disks: Array<{ diskId: string; diskName: string; sizeBytes: number }>;
};

export type FolderTreeLevel = {
  prefix: string;
  sizeBytes: number;
  fileCount: number;
  directFileCount: number;
  directBytes: number;
  children: FolderTreeNode[];
};

function segments(pathValue: string): string[] {
  return pathValue.replace(/\\/g, "/").replace(/^\/+/, "").split("/").filter(Boolean);
}

// Aggregates catalogued video bytes one folder level below `prefix` ("" is the root of every drive).
export function folderTreeLevel(files: FolderTreeFile[], prefix: string, limit = 200): FolderTreeLevel {
  const prefixParts = segments(prefix);
  const children = new Map<string, FolderTreeNode & { grandchildren: Set<string>; diskBytes: Map<string, { diskName: string; sizeBytes: number }> }>();
  let sizeBytes = 0;
  let fileCount = 0;
  let directFileCount = 0;
  let directBytes = 0;

  for (const file of files) {
    const parts = segments(file.relativePath);
    const folders = parts.slice(0, -1);
    if (folders.length < prefixParts.length) continue;
    if (prefixParts.some((part, index) => folders[index] !== part)) continue;
    sizeBytes += file.sizeBytes;
    fileCount += 1;
    if (folders.length === prefixParts.length) {
      directFileCount += 1;
      directBytes += file.sizeBytes;
      continue;
    }
    const name = folders[prefixParts.length];
    const childPath = [...prefixParts, name].join("/");
    const child = children.get(childPath) ?? {
      name,
      path: childPath,
      sizeBytes: 0,
      fileCount: 0,
      childFolderCount: 0,
      disks: [],
      grandchildren: new Set<string>(),
      diskBytes: new Map()
    };
    child.sizeBytes += file.sizeBytes;
    child.fileCount += 1;
    if (folders.length > prefixParts.length + 1) child.grandchildren.add(folders[prefixParts.length + 1]);
    const disk = child.diskBytes.get(file.diskId) ?? { diskName: file.diskName, sizeBytes: 0 };
    disk.sizeBytes += file.sizeBytes;
    child.diskBytes.set(file.diskId, disk);
    children.set(childPath, child);
  }

  return {
    prefix: prefixParts.join("/"),
    sizeBytes,
    fileCount,
    directFileCount,
    directBytes,
    children: [...children.values()]
      .sort((left, right) => right.sizeBytes - left.sizeBytes)
      .slice(0, limit)
      .map(({ grandchildren, diskBytes, ...node }) => ({
        ...node,
        childFolderCount: grandchildren.size,
        disks: [...diskBytes.entries()]
          .map(([diskId, disk]) => ({ diskId, ...disk }))
          .sort((left, right) => right.sizeBytes - left.sizeBytes)
      }))
  };
}
