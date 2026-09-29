import type { OptionColor } from "@/lib/db-properties";

/** Chip colours for select / status options (light + dark). */
export const OPTION_CHIP: Record<OptionColor, string> = {
  gray: "bg-zinc-500/12 text-zinc-700 dark:text-zinc-300",
  brown: "bg-amber-900/12 text-amber-900 dark:bg-amber-700/20 dark:text-amber-200",
  orange: "bg-orange-500/14 text-orange-800 dark:text-orange-300",
  yellow: "bg-yellow-400/25 text-yellow-900 dark:bg-yellow-500/20 dark:text-yellow-200",
  green: "bg-emerald-500/14 text-emerald-800 dark:text-emerald-300",
  blue: "bg-sky-500/14 text-sky-800 dark:text-sky-300",
  purple: "bg-violet-500/14 text-violet-800 dark:text-violet-300",
  pink: "bg-pink-500/14 text-pink-800 dark:text-pink-300",
  red: "bg-red-500/14 text-red-800 dark:text-red-300",
};

export const OPTION_DOT: Record<OptionColor, string> = {
  gray: "bg-zinc-400",
  brown: "bg-amber-800",
  orange: "bg-orange-500",
  yellow: "bg-yellow-500",
  green: "bg-emerald-500",
  blue: "bg-sky-500",
  purple: "bg-violet-500",
  pink: "bg-pink-500",
  red: "bg-red-500",
};
