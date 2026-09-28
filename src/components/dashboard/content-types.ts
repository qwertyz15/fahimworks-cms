import { BookOpen, FolderGit2, Newspaper, NotebookPen, type LucideIcon } from "lucide-react";
import type { ContentType } from "@/generated/prisma/enums";

export interface TypeMeta {
  label: string;
  plural: string;
  icon: LucideIcon;
  /** Icon tile colours (light + dark). */
  tile: string;
  /** Solid accent (timeline dots). */
  dot: string;
}

export const TYPE_META: Record<ContentType, TypeMeta> = {
  BLOG: { label: "Blog", plural: "Blogs", icon: BookOpen, tile: "bg-indigo-500/10 text-indigo-600 dark:text-indigo-300", dot: "bg-indigo-500" },
  ARTICLE: { label: "Article", plural: "Articles", icon: Newspaper, tile: "bg-pink-500/10 text-pink-600 dark:text-pink-300", dot: "bg-pink-500" },
  PROJECT: { label: "Project", plural: "Projects", icon: FolderGit2, tile: "bg-amber-500/12 text-amber-600 dark:text-amber-300", dot: "bg-amber-500" },
  NOTEBOOK: { label: "Notebook", plural: "Notebook", icon: NotebookPen, tile: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-300", dot: "bg-emerald-500" },
};

export const TYPE_ORDER: ContentType[] = ["BLOG", "ARTICLE", "PROJECT", "NOTEBOOK"];

export function parseType(value: unknown): ContentType | undefined {
  return typeof value === "string" && (TYPE_ORDER as string[]).includes(value) ? (value as ContentType) : undefined;
}

export type LibraryView = "grid" | "list";
export const VIEW_COOKIE = "library-view";
