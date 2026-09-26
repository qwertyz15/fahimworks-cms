import "server-only";
import { randomBytes } from "node:crypto";
import { db } from "@/lib/db";
import { slugify } from "@/lib/utils";

export function tagConnect(names: string[]) {
  return names
    .map((name) => ({ name, slug: slugify(name, 40) }))
    .filter((t, i, all) => t.slug && all.findIndex((o) => o.slug === t.slug) === i)
    .map((t) => ({ where: { slug: t.slug }, create: { name: t.name, slug: t.slug } }));
}

/** Slug derived from the title, suffixed when it collides with another item. */
export async function uniqueSlug(title: string, excludeId?: string): Promise<string> {
  const base = slugify(title, 70);
  for (let attempt = 0; attempt < 5; attempt++) {
    const candidate = attempt === 0 ? base : `${base}-${randomBytes(3).toString("hex")}`;
    const clash = await db.content.findUnique({ where: { slug: candidate }, select: { id: true } });
    if (!clash || clash.id === excludeId) return candidate;
  }
  return `${base}-${randomBytes(6).toString("hex")}`;
}
