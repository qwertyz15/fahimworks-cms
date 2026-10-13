/**
 * Notebook folder tree helpers, shared by the server (validation) and the
 * dashboard (tree, breadcrumbs, the "Move to…" picker).
 */

export interface FolderLike {
  id: string;
  parentId: string | null;
  name: string;
  position: string;
}

/** Deepest nesting allowed (a top-level folder is depth 1). */
export const MAX_FOLDER_DEPTH = 20;
export const FOLDER_NAME_MAX = 120;

export const byPosition = <T extends { position: string }>(a: T, b: T) => (a.position < b.position ? -1 : a.position > b.position ? 1 : 0);

export function childrenOf<T extends FolderLike>(folders: T[], parentId: string | null): T[] {
  return folders.filter((f) => f.parentId === parentId).sort(byPosition);
}

/** Ancestors from the top down, ending with the folder itself. */
export function pathOf<T extends FolderLike>(folders: T[], id: string | null): T[] {
  const byId = new Map(folders.map((f) => [f.id, f]));
  const out: T[] = [];
  const seen = new Set<string>();
  for (let f = id ? byId.get(id) : undefined; f && !seen.has(f.id); f = f.parentId ? byId.get(f.parentId) : undefined) {
    seen.add(f.id);
    out.unshift(f);
  }
  return out;
}

/** The folder and everything below it. */
export function subtreeIds(folders: FolderLike[], id: string): Set<string> {
  const out = new Set<string>([id]);
  let grew = true;
  while (grew) {
    grew = false;
    for (const f of folders) {
      if (f.parentId && out.has(f.parentId) && !out.has(f.id)) {
        out.add(f.id);
        grew = true;
      }
    }
  }
  return out;
}

/** Levels below a folder, counting itself (a leaf is 1). */
export function heightOf(folders: FolderLike[], id: string): number {
  const kids = folders.filter((f) => f.parentId === id);
  return 1 + (kids.length ? Math.max(...kids.map((k) => heightOf(folders, k.id))) : 0);
}

/** Why a folder can't move under `parentId` (null: it can). */
export function moveProblem(folders: FolderLike[], id: string, parentId: string | null): string | null {
  if (parentId === null) return heightOf(folders, id) > MAX_FOLDER_DEPTH ? "That folder is nested too deeply." : null;
  if (subtreeIds(folders, id).has(parentId)) return "A folder can't go inside itself or one of its own folders.";
  if (!folders.some((f) => f.id === parentId)) return "That folder no longer exists.";
  if (pathOf(folders, parentId).length + heightOf(folders, id) > MAX_FOLDER_DEPTH) return `Folders can be nested up to ${MAX_FOLDER_DEPTH} levels.`;
  return null;
}

/** Folders as an indented, depth-first list (pickers). */
export function flatten<T extends FolderLike>(folders: T[], parentId: string | null = null, depth = 0): { folder: T; depth: number }[] {
  return childrenOf(folders, parentId).flatMap((f) => [{ folder: f, depth }, ...flatten(folders, f.id, depth + 1)]);
}
