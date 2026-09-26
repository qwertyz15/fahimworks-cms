/**
 * Summary generation. The default provider is extractive (no external calls).
 * Swap in an AI-backed provider later by implementing `SummaryProvider` and
 * passing it to `setSummaryProvider()` at startup.
 */

export interface SummaryInput {
  title: string;
  description?: string | null;
  text: string;
}

export interface SummaryProvider {
  name: string;
  summarize(input: SummaryInput): Promise<string>;
}

const MAX = 320;

export const extractiveSummary: SummaryProvider = {
  name: "extractive",
  async summarize({ description, text }) {
    if (description && description.length >= 80) return clip(description);
    const sentences = text
      .replace(/\s+/g, " ")
      .split(/(?<=[.!?])\s+(?=[A-Z0-9“"(])/)
      .map((s) => s.trim())
      .filter((s) => s.split(" ").length >= 6);
    let out = "";
    for (const s of sentences) {
      if ((out + " " + s).trim().length > MAX) break;
      out = (out + " " + s).trim();
    }
    return clip(out || description || text);
  },
};

function clip(value: string) {
  const v = value.trim();
  if (v.length <= MAX) return v;
  const cut = v.slice(0, MAX);
  return `${cut.slice(0, Math.max(cut.lastIndexOf(" "), MAX - 40)).trimEnd()}…`;
}

let provider: SummaryProvider = extractiveSummary;

export function setSummaryProvider(next: SummaryProvider) {
  provider = next;
}

export async function summarize(input: SummaryInput): Promise<string> {
  try {
    return await provider.summarize(input);
  } catch (err) {
    console.error(`[summary] provider "${provider.name}" failed, falling back to extractive`, err);
    return extractiveSummary.summarize(input);
  }
}
