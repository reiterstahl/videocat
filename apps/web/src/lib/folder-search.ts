import type { FolderGroupNode } from "../types";

// Case- and accent-insensitive, so "video" finds "Vídeos".
export function searchKey(text: string): string {
  return text.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();
}

export function matchesSearch(text: string, term: string): boolean {
  return !term || searchKey(text).includes(term);
}

export type FolderSearchResult = {
  nodes: FolderGroupNode[];
  // Folders whose own name matches (drawn highlighted).
  matches: Set<FolderGroupNode>;
  // Filtered copies point back to the folder they were cut from.
  originals: Map<FolderGroupNode, FolderGroupNode>;
};

// Keeps the folders whose name matches (whole, with everything inside) and the folders that
// lead to one; those shrink to what matches inside them. Blocks of loose files and of
// "more folders" only stay inside a matching folder.
export function filterFolderNodes(nodes: readonly FolderGroupNode[], rawTerm: string): FolderSearchResult {
  const term = searchKey(rawTerm);
  const matches = new Set<FolderGroupNode>();
  const originals = new Map<FolderGroupNode, FolderGroupNode>();
  if (!term) return { nodes: [...nodes], matches, originals };

  const visit = (items: readonly FolderGroupNode[]): FolderGroupNode[] => {
    const kept: FolderGroupNode[] = [];
    for (const node of items) {
      if (node.kind === "rest" || node.kind === "files") continue;
      if (matchesSearch(node.name, term)) {
        matches.add(node);
        kept.push(node);
        continue;
      }
      const children = visit(node.children);
      if (children.length === 0) continue;
      const copy: FolderGroupNode = {
        ...node,
        children,
        sizeBytes: children.reduce((sum, child) => sum + child.sizeBytes, 0),
        fileCount: children.reduce((sum, child) => sum + child.fileCount, 0)
      };
      originals.set(copy, node);
      kept.push(copy);
    }
    return kept.sort((left, right) => right.sizeBytes - left.sizeBytes);
  };

  return { nodes: visit(nodes), matches, originals };
}
