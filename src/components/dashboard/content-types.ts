import { BookOpen, FolderGit2, GraduationCap, Newspaper, type LucideIcon } from "lucide-react";
import type { ContentType } from "@/generated/prisma/enums";

export interface TypeMeta {
  label: string;
  plural: string;
  icon: LucideIcon;
  /** Icon tile colours (light + dark). */
  tile: string;
}

export const TYPE_META: Record<ContentType, TypeMeta> = {
  BLOG: { label: "Blog", plural: "Blogs", icon: BookOpen, tile: "bg-indigo-500/10 text-indigo-600 dark:text-indigo-300" },
  TUTORIAL: { label: "Tutorial", plural: "Tutorials", icon: GraduationCap, tile: "bg-sky-500/10 text-sky-600 dark:text-sky-300" },
  ARTICLE: { label: "Article", plural: "Articles", icon: Newspaper, tile: "bg-pink-500/10 text-pink-600 dark:text-pink-300" },
  PROJECT: { label: "Project", plural: "Projects", icon: FolderGit2, tile: "bg-amber-500/12 text-amber-600 dark:text-amber-300" },
};

export const TYPE_ORDER: ContentType[] = ["BLOG", "TUTORIAL", "ARTICLE", "PROJECT"];

export function parseType(value: unknown): ContentType | undefined {
  return typeof value === "string" && (TYPE_ORDER as string[]).includes(value) ? (value as ContentType) : undefined;
}

export type LibraryView = "grid" | "list";
export const VIEW_COOKIE = "library-view";
