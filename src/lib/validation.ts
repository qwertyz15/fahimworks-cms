import { z } from "zod";
import { parseSubmittedUrl } from "./url";

export const CONTENT_TYPES = ["BLOG", "TUTORIAL", "ARTICLE", "PROJECT"] as const;

const trimmed = (max: number) => z.string().trim().max(max);

export const emailSchema = z.string().trim().toLowerCase().max(254).pipe(z.email("Enter a valid email address."));

export const passwordSchema = z
  .string()
  .min(12, "Password must be at least 12 characters.")
  .max(128, "Password must be at most 128 characters.")
  .refine((v) => /[a-z]/.test(v) && /[A-Z]/.test(v), "Use both upper- and lower-case letters.")
  .refine((v) => /\d/.test(v) || /[^A-Za-z0-9]/.test(v), "Include at least one number or symbol.");

export const loginSchema = z.object({
  email: emailSchema,
  password: z.string().min(1, "Password is required.").max(128),
});

export const registerSchema = z
  .object({
    name: trimmed(100).min(1, "Name is required."),
    email: emailSchema,
    password: passwordSchema,
    confirmPassword: z.string(),
  })
  .refine((d) => d.password === d.confirmPassword, { path: ["confirmPassword"], message: "Passwords do not match." });

export const changePasswordSchema = z
  .object({
    currentPassword: z.string().min(1, "Current password is required.").max(128),
    newPassword: passwordSchema,
    confirmPassword: z.string(),
  })
  .refine((d) => d.newPassword === d.confirmPassword, { path: ["confirmPassword"], message: "Passwords do not match." })
  .refine((d) => d.newPassword !== d.currentPassword, { path: ["newPassword"], message: "Choose a different password." });

export const urlSchema = z.string().superRefine((value, ctx) => {
  const res = parseSubmittedUrl(value);
  if (!res.ok) ctx.addIssue({ code: "custom", message: res.error });
});

const optionalUrl = z
  .string()
  .trim()
  .max(2048)
  .transform((v) => (v === "" ? null : v))
  .refine((v) => v === null || parseSubmittedUrl(v).ok, "Enter a valid http(s) URL.")
  .nullable();

/** Comma/newline separated tags → normalised, de-duplicated list. */
export const tagsSchema = z
  .union([z.string(), z.array(z.string())])
  .optional()
  .transform((v) => {
    const list = Array.isArray(v) ? v : (v ?? "").split(/[,\n]/);
    const seen = new Set<string>();
    const out: string[] = [];
    for (const raw of list) {
      const tag = raw.trim().replace(/\s+/g, " ").slice(0, 40);
      const key = tag.toLowerCase();
      if (tag && !seen.has(key)) {
        seen.add(key);
        out.push(tag);
      }
    }
    return out.slice(0, 20);
  });

export const createContentSchema = z.object({
  url: urlSchema,
  type: z.enum(CONTENT_TYPES),
  tags: tagsSchema,
  /** "publish" = extract and publish immediately; "review" = stop at Waiting for approval. */
  intent: z.enum(["publish", "review"]).default("publish"),
  /** Proceed even though duplicate warnings were shown. */
  acknowledgeDuplicates: z.coerce.boolean().optional().default(false),
});

export const updateContentSchema = z.object({
  id: z.string().min(1).max(64),
  url: urlSchema,
  title: trimmed(300).min(1, "Title is required."),
  type: z.enum(CONTENT_TYPES),
  description: trimmed(2000).transform((v) => v || null).nullable(),
  summary: trimmed(5000).transform((v) => v || null).nullable(),
  thumbnail: optionalUrl,
  author: trimmed(200).transform((v) => v || null).nullable(),
  publishDate: z
    .string()
    .trim()
    .transform((v, ctx) => {
      if (!v) return null;
      const d = new Date(v);
      if (Number.isNaN(d.getTime())) {
        ctx.addIssue({ code: "custom", message: "Invalid date." });
        return z.NEVER;
      }
      return d;
    })
    .nullable(),
  tags: tagsSchema,
  featured: z
    .union([z.literal("on"), z.literal("true"), z.literal("false"), z.literal("")])
    .optional()
    .transform((v) => v === "on" || v === "true"),
});

export const settingsSchema = z.object({
  siteName: trimmed(100).min(1, "Site name is required."),
  portfolioUrl: optionalUrl,
  minWordCount: z.coerce.number().int().min(20).max(5000),
  allowRegistration: z.coerce.boolean(),
  publicApiEnabled: z.coerce.boolean(),
  allowedOrigins: z
    .string()
    .optional()
    .transform((v) =>
      (v ?? "")
        .split(/[\s,]+/)
        .map((s) => s.trim().replace(/\/+$/, ""))
        .filter(Boolean),
    )
    .pipe(z.array(z.url({ protocol: /^https?$/, message: "Each origin must be a valid http(s) origin." })).max(20)),
});

export const idSchema = z.string().min(1).max(64);

/** Flatten zod errors to `{ field: firstMessage }` for form display. */
export function fieldErrors(error: z.ZodError): Record<string, string> {
  const out: Record<string, string> = {};
  for (const issue of error.issues) {
    const key = issue.path.join(".") || "_form";
    out[key] ??= issue.message;
  }
  return out;
}
