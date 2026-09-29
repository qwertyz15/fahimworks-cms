"use client";

import type { EditorUploadConfig } from "@/components/editor/rich-editor";
import { PageEditor, type PageEditorData } from "./page-editor";

/** A database row opened as a full page. */
export function PageScreen({ data, uploads, articleBaseUrl }: { data: PageEditorData; uploads: EditorUploadConfig; articleBaseUrl: string }) {
  return <PageEditor data={data} uploads={uploads} articleBaseUrl={articleBaseUrl} variant="page" />;
}
