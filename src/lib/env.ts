import "server-only";
import { z } from "zod";

const boolish = z
  .enum(["true", "false", "1", "0", ""])
  .optional()
  .transform((v) => v === "true" || v === "1");

const schema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  DATABASE_URL: z.string().min(1, "DATABASE_URL is required"),
  AUTH_SECRET: z.string().min(32, "AUTH_SECRET must be at least 32 characters"),
  ALLOW_PRIVATE_NETWORK_FETCH: boolish,
  TRUSTED_PROXY_HOPS: z.coerce.number().int().min(0).max(10).default(1),
  SCREENSHOT_URL_TEMPLATE: z.string().optional().default(""),
  FETCH_TIMEOUT_MS: z.coerce.number().int().min(1000).max(60000).default(10000),
  FETCH_MAX_BYTES: z.coerce.number().int().min(64 * 1024).max(50 * 1024 * 1024).default(5 * 1024 * 1024),
  FETCH_USER_AGENT: z.string().default("PortfolioCMS/1.0 (+content import)"),
});

export type Env = z.infer<typeof schema>;

let cached: Env | undefined;

/** Validated server environment. Throws on first access if misconfigured. */
export function env(): Env {
  if (cached) return cached;
  const parsed = schema.safeParse(process.env);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `  - ${i.path.join(".")}: ${i.message}`).join("\n");
    throw new Error(`Invalid environment configuration:\n${issues}`);
  }
  if (parsed.data.NODE_ENV === "production" && parsed.data.ALLOW_PRIVATE_NETWORK_FETCH) {
    console.warn("[security] ALLOW_PRIVATE_NETWORK_FETCH is enabled in production. This permits SSRF to internal hosts.");
  }
  cached = parsed.data;
  return cached;
}
