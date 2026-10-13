export interface FolderItem {
  id: string;
  parentId: string | null;
  name: string;
  icon: string | null;
  description: string | null;
  slug: string;
  position: string;
  isPublic: boolean;
}

export interface EntryItem {
  id: string;
  title: string;
  subtitle: string | null;
  summary: string | null;
  status: string;
  slug: string;
  wordCount: number | null;
  updatedAt: string;
  folderId: string | null;
  folderPosition: string | null;
}

export const byEntryPosition = (a: EntryItem, b: EntryItem) => {
  const pa = a.folderPosition ?? "~";
  const pb = b.folderPosition ?? "~";
  return pa < pb ? -1 : pa > pb ? 1 : b.updatedAt.localeCompare(a.updatedAt);
};
