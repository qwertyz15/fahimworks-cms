"use client";

import { Smile } from "lucide-react";
import { cn } from "@/lib/utils";
import { PopoverButton } from "./popover";

const EMOJIS = [
  "📋", "✅", "🚀", "🗓️", "✍️", "🤝", "📚", "💡", "🎯", "📈", "🧠", "🤖",
  "🛠️", "🐞", "🧪", "📦", "🗂️", "📝", "📌", "⭐", "🔥", "🌱", "🏁", "💼",
  "💰", "🧾", "📣", "🎬", "📷", "🎨", "🎵", "🏠", "✈️", "🍎", "💪", "🧘",
  "📖", "🔬", "🌍", "⚙️", "🔒", "🧩", "🗺️", "🕒", "💬", "❤️", "🎓", "🏆",
];

/** Pick an emoji icon (or remove it). */
export function EmojiPicker({ value, onChange, size = "lg" }: { value: string | null; onChange: (v: string | null) => void; size?: "lg" | "md" }) {
  return (
    <PopoverButton
      label={value ? "Change icon" : "Add icon"}
      className={cn("flex shrink-0 items-center justify-center rounded-lg hover:bg-muted", size === "lg" ? "size-12 text-4xl" : "size-9 text-2xl")}
      content={(close) => (
        <div className="w-72 p-1">
          <div className="grid grid-cols-8 gap-0.5" role="listbox" aria-label="Icons">
            {EMOJIS.map((e) => (
              <button key={e} type="button" role="option" aria-selected={e === value} aria-label={e} onClick={() => (onChange(e), close())} className={cn("rounded-md p-1 text-xl hover:bg-muted", e === value && "bg-muted")}>
                {e}
              </button>
            ))}
          </div>
          {value && (
            <button type="button" onClick={() => (onChange(null), close())} className="mt-1 w-full rounded-md px-2 py-1 text-left text-xs text-muted-foreground hover:bg-muted">
              Remove icon
            </button>
          )}
        </div>
      )}
    >
      {value ?? <Smile className="size-6 text-muted-foreground/60" />}
    </PopoverButton>
  );
}
