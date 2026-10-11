// "Uso por carpeta": folders with the same name are merged into one group wherever they live,
// on any drive and at any depth. Every file is drawn inside the outermost folder of its path
// whose name repeats, so each byte is counted once. Excluded names are never merged.

export type FolderGroupFile = {
  diskId: string;
  diskName: string;
  relativePath: string;
  sizeBytes: number;
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
  // Names found in two or more places (merged, or kept apart because they are excluded).
  repeated: FolderGroupSummary[];
};

export type FolderGroupOptions = {
  excludedNames?: Iterable<string>;
  maxDepth?: number;
  maxChildren?: number;
};

export function normalizeFolderName(name: string): string {
  return name.normalize("NFD").replace(/[̀-ͯ]/g, "").trim().toLowerCase();
}

function folderSegments(relativePath: string): string[] {
  const parts = relativePath.split(/[\\/]+/).filter((part) => part && part !== ".");
  return parts.slice(0, -1);
}

type Builder = {
  key: string;
  kind: FolderGroupNode["kind"];
  names: Map<string, number>;
  sizeBytes: number;
  fileCount: number;
  directBytes: number;
  directCount: number;
  directLocations: Map<string, FolderGroupLocation>;
  locations: Map<string, FolderGroupLocation>;
  children: Map<string, Builder>;
};

function builder(key: string, kind: FolderGroupNode["kind"]): Builder {
  return {
    key,
    kind,
    names: new Map(),
    sizeBytes: 0,
    fileCount: 0,
    directBytes: 0,
    directCount: 0,
    directLocations: new Map(),
    locations: new Map(),
    children: new Map()
  };
}

function addLocation(locations: Map<string, FolderGroupLocation>, file: FolderGroupFile, path: string) {
  const key = `${file.diskId}|${path.toLowerCase()}`;
  const current = locations.get(key);
  if (current) current.sizeBytes += file.sizeBytes;
  else locations.set(key, { diskId: file.diskId, diskName: file.diskName, path, sizeBytes: file.sizeBytes });
}

function displayName(names: Map<string, number>): string {
  let best = "";
  let bestCount = -1;
  for (const [name, count] of names) {
    if (count > bestCount) {
      best = name;
      bestCount = count;
    }
  }
  return best;
}

function sortedLocations(locations: Map<string, FolderGroupLocation>): FolderGroupLocation[] {
  return [...locations.values()].sort((left, right) => right.sizeBytes - left.sizeBytes || left.path.localeCompare(right.path));
}

function finish(node: Builder, depth: number, options: Required<Omit<FolderGroupOptions, "excludedNames">>): FolderGroupNode {
  const children: FolderGroupNode[] = [];
  if (depth < options.maxDepth) {
    const sorted = [...node.children.values()].sort((left, right) => right.sizeBytes - left.sizeBytes);
    for (const child of sorted.slice(0, options.maxChildren)) children.push(finish(child, depth + 1, options));
    const rest = sorted.slice(options.maxChildren);
    if (rest.length > 0) {
      children.push({
        key: `${node.key}/#rest`,
        name: `${rest.length} carpetas más`,
        kind: "rest",
        sizeBytes: rest.reduce((sum, child) => sum + child.sizeBytes, 0),
        fileCount: rest.reduce((sum, child) => sum + child.fileCount, 0),
        locations: [],
        children: []
      });
    }
    // Files that sit directly in a folder with subfolders get their own tile, so areas stay true.
    if (node.directBytes > 0 && node.children.size > 0) {
      children.push({
        key: `${node.key}/#files`,
        name: "Archivos sueltos",
        kind: "files",
        sizeBytes: node.directBytes,
        fileCount: node.directCount,
        locations: sortedLocations(node.directLocations),
        children: []
      });
    }
  }
  return {
    key: node.key,
    name: displayName(node.names),
    kind: node.kind,
    sizeBytes: node.sizeBytes,
    fileCount: node.fileCount,
    locations: sortedLocations(node.locations),
    children
  };
}

export function buildFolderGroups(files: FolderGroupFile[], options: FolderGroupOptions = {}): FolderGroupMap {
  const excluded = new Set([...(options.excludedNames ?? [])].map(normalizeFolderName));
  const limits = { maxDepth: options.maxDepth ?? 4, maxChildren: options.maxChildren ?? 60 };

  // Pass 1: every distinct folder (drive + path) per normalized name.
  const occurrences = new Map<string, Map<string, { diskId: string; diskName: string; path: string }>>();
  const displayNames = new Map<string, Map<string, number>>();
  const seenFolders = new Set<string>();
  for (const file of files) {
    const folders = folderSegments(file.relativePath);
    for (let index = 0; index < folders.length; index += 1) {
      const path = folders.slice(0, index + 1).join("/");
      const folderKey = `${file.diskId}|${path.toLowerCase()}`;
      if (seenFolders.has(folderKey)) continue;
      seenFolders.add(folderKey);
      const name = normalizeFolderName(folders[index]);
      if (!name) continue;
      const places = occurrences.get(name) ?? new Map();
      places.set(folderKey, { diskId: file.diskId, diskName: file.diskName, path });
      occurrences.set(name, places);
      const names = displayNames.get(name) ?? new Map<string, number>();
      names.set(folders[index], (names.get(folders[index]) ?? 0) + 1);
      displayNames.set(name, names);
    }
  }
  const merged = (name: string) => !excluded.has(name) && (occurrences.get(name)?.size ?? 0) >= 2;

  // Pass 2: attribute each file to its outermost merged folder, or to its own top-level folder.
  const roots = new Map<string, Builder>();
  let totalBytes = 0;
  for (const file of files) {
    totalBytes += file.sizeBytes;
    const folders = folderSegments(file.relativePath);
    const anchor = folders.findIndex((folder) => merged(normalizeFolderName(folder)));
    let root: Builder;
    let anchorPath: string;
    let inner: string[];
    if (anchor >= 0) {
      const name = normalizeFolderName(folders[anchor]);
      root = roots.get(`g:${name}`) ?? builder(`g:${name}`, "group");
      anchorPath = folders.slice(0, anchor + 1).join("/");
      inner = folders.slice(anchor + 1);
      root.names.set(folders[anchor], (root.names.get(folders[anchor]) ?? 0) + 1);
    } else if (folders.length > 0) {
      const key = `p:${file.diskId}|${folders[0].toLowerCase()}`;
      root = roots.get(key) ?? builder(key, "folder");
      anchorPath = folders[0];
      inner = folders.slice(1);
      root.names.set(folders[0], (root.names.get(folders[0]) ?? 0) + 1);
    } else {
      const key = `r:${file.diskId}`;
      root = roots.get(key) ?? builder(key, "files");
      anchorPath = "";
      inner = [];
      root.names.set(`Raíz de ${file.diskName}`, 1);
    }
    roots.set(root.key, root);

    let node = root;
    let path = anchorPath;
    node.sizeBytes += file.sizeBytes;
    node.fileCount += 1;
    addLocation(node.locations, file, path);
    for (const segment of inner) {
      const childKey = `${node.key}/${normalizeFolderName(segment)}`;
      const child = node.children.get(childKey) ?? builder(childKey, "folder");
      node.children.set(childKey, child);
      child.names.set(segment, (child.names.get(segment) ?? 0) + 1);
      path = path ? `${path}/${segment}` : segment;
      child.sizeBytes += file.sizeBytes;
      child.fileCount += 1;
      addLocation(child.locations, file, path);
      node = child;
    }
    node.directBytes += file.sizeBytes;
    node.directCount += 1;
    addLocation(node.directLocations, file, path);
  }

  const finishedRoots = [...roots.values()]
    .sort((left, right) => right.sizeBytes - left.sizeBytes)
    .map((root) => finish(root, 1, limits));

  const repeated: FolderGroupSummary[] = [];
  for (const [name, places] of occurrences) {
    if (places.size < 2) continue;
    const isExcluded = excluded.has(name);
    const root = finishedRoots.find((candidate) => candidate.key === `g:${name}`);
    if (!isExcluded && !root) continue; // Nested inside a larger merged folder.
    repeated.push({
      key: `g:${name}`,
      name: root?.name ?? displayName(displayNames.get(name) ?? new Map()),
      sizeBytes: root?.sizeBytes ?? 0,
      fileCount: root?.fileCount ?? 0,
      locations: root?.locations ?? [...places.values()].map((place) => ({ ...place, sizeBytes: 0 })),
      excluded: isExcluded
    });
  }
  repeated.sort((left, right) => Number(left.excluded) - Number(right.excluded) || right.sizeBytes - left.sizeBytes || left.name.localeCompare(right.name));

  return { sizeBytes: totalBytes, fileCount: files.length, roots: finishedRoots, repeated };
}
