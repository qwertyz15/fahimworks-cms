"use client";

import StarterKit from "@tiptap/starter-kit";
import CodeBlockLowlight from "@tiptap/extension-code-block-lowlight";
import { TableKit } from "@tiptap/extension-table";
import { CharacterCount, Placeholder } from "@tiptap/extensions";
import { ReactNodeViewRenderer } from "@tiptap/react";
import { common, createLowlight } from "lowlight";
import { CodeBlockView } from "./code-block-view";
import { TaskItem, TaskList } from "@tiptap/extension-list";
import { Figure } from "./figure";
import { Attachment, NamedHighlight, TextColorMark, VideoEmbed, VideoFile } from "./rich-nodes";
import { SlashCommand } from "./slash-menu";

export const lowlight = createLowlight(common);

export function notebookExtensions() {
  return [
    StarterKit.configure({
      codeBlock: false, // replaced by the syntax-highlighting code block below
      heading: { levels: [1, 2, 3] },
      link: {
        openOnClick: false,
        autolink: true,
        defaultProtocol: "https",
        protocols: ["http", "https", "mailto"],
        HTMLAttributes: { rel: "noopener noreferrer nofollow", target: "_blank" },
      },
    }),
    CodeBlockLowlight.extend({
      addNodeView() {
        return ReactNodeViewRenderer(CodeBlockView);
      },
    }).configure({ lowlight, defaultLanguage: "plaintext" }),
    TableKit.configure({ table: { resizable: false } }),
    Figure,
    TaskList,
    TaskItem.configure({ nested: true }),
    TextColorMark,
    NamedHighlight,
    VideoEmbed,
    VideoFile,
    Attachment,
    Placeholder.configure({
      placeholder: ({ node }) => (node.type.name === "heading" ? "Heading" : "Write, or type '/' for blocks…"),
    }),
    CharacterCount,
    SlashCommand,
  ];
}
