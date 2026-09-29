import "server-only";
import { generateKeyBetween } from "fractional-indexing";
import { Prisma } from "@/generated/prisma/client";
import { LIMITS, type PropertyConfig, type PropertyDef, type PropertyValue, type RelationConfig } from "@/lib/db-properties";
import { afterChange, defsOf, patchValues, recomputeDatabase, type Client } from "./compute";

/**
 * Relations. A link is stored twice: as a PageRelation row (keyed by the
 * pair's primary property) and as page-id arrays in pages.values on both
 * sides, which is what views read. Every change here keeps the two in step
 * and recalculates the rollups that read the links.
 */

export class RelationError extends Error {}

type Page = { id: string; databaseId: string | null; workspaceId: string; values: Prisma.JsonValue };

const idsOf = (values: Prisma.JsonValue, propId: string): string[] => {
  const v = ((values ?? {}) as Record<string, PropertyValue>)[propId];
  return Array.isArray(v) ? (v as string[]) : [];
};
const json = (v: unknown) => v as Prisma.InputJsonValue;

/** Rows for the primary side of a relation pair: (primary property, from, to). */
function edge(prop: PropertyDef, pageId: string, otherId: string) {
  const cfg = prop.config.relation!;
  return cfg.primary === false && cfg.pairedId ? { propertyId: cfg.pairedId, fromPageId: otherId, toPageId: pageId } : { propertyId: prop.id, fromPageId: pageId, toPageId: otherId };
}

/**
 * Set the pages a relation links `page` to. Ids that aren't rows of the
 * target database are dropped; `limit: one` keeps the first. Returns the
 * other pages whose values changed (for the client to refresh).
 */
export async function setRelation(c: Client, page: Page, prop: PropertyDef, raw: string[]): Promise<Set<string>> {
  const cfg = prop.config.relation;
  if (prop.type !== "RELATION" || !cfg) throw new RelationError("That property isn't a relation.");
  const wantedIds = [...new Set(raw)].slice(0, cfg.limit === "one" ? 1 : LIMITS.relations);
  const valid = wantedIds.length ? await c.page.findMany({ where: { id: { in: wantedIds }, databaseId: cfg.databaseId, workspaceId: page.workspaceId }, select: { id: true } }) : [];
  const ok = new Set(valid.map((v) => v.id));
  const next = wantedIds.filter((id) => ok.has(id) && !(id === page.id && cfg.pairedId === prop.id));
  const prev = idsOf(page.values, prop.id);
  const added = next.filter((id) => !prev.includes(id));
  const removed = prev.filter((id) => !next.includes(id));
  if (!added.length && !removed.length && prev.length === next.length && prev.every((id, i) => id === next[i])) return new Set();

  const values = { ...((page.values ?? {}) as Record<string, PropertyValue>) };
  if (next.length) values[prop.id] = next;
  else delete values[prop.id];
  await c.page.update({ where: { id: page.id }, data: { values: json(values) } });

  if (removed.length) await c.pageRelation.deleteMany({ where: { OR: removed.map((id) => edge(prop, page.id, id)) } });
  if (added.length) await c.pageRelation.createMany({ data: added.map((id) => ({ ...edge(prop, page.id, id), position: next.indexOf(id) })), skipDuplicates: true });

  const touched = new Set<string>();
  // The other side of a two-way relation.
  const pairedId = cfg.pairedId;
  const paired = pairedId ? await c.databaseProperty.findUnique({ where: { id: pairedId } }) : null;
  const displaced: string[] = [];
  if (paired && pairedId) {
    const pairedCfg = (paired.config as PropertyConfig | null)?.relation;
    const others = await c.page.findMany({ where: { id: { in: [...added, ...removed] } }, select: { id: true, values: true } });
    const patches = [];
    for (const o of others) {
      let list = idsOf(o.values, pairedId).filter((x) => x !== page.id);
      if (added.includes(o.id)) {
        if (pairedCfg?.limit === "one") {
          // That page could only point at one row: unlink it from the previous one.
          displaced.push(...list);
          list = [];
        }
        list.push(page.id);
      }
      patches.push(list.length ? { id: o.id, set: { [pairedId]: list }, del: [] } : { id: o.id, set: {}, del: [pairedId] });
      touched.add(o.id);
    }
    await patchValues(c, patches);
    if (displaced.length) {
      // The previously linked rows lose their link to those pages.
      const lost = await c.page.findMany({ where: { id: { in: displaced } }, select: { id: true, values: true } });
      const moved = new Set(added);
      await patchValues(
        c,
        lost.map((l) => {
          const list = idsOf(l.values, prop.id).filter((x) => !moved.has(x));
          return list.length ? { id: l.id, set: { [prop.id]: list }, del: [] } : { id: l.id, set: {}, del: [prop.id] };
        }),
      );
      await c.pageRelation.deleteMany({ where: { OR: lost.flatMap((l) => added.map((a) => edge(prop, l.id, a))) } });
      for (const l of lost) touched.add(l.id);
    }
  }

  // Rollups over this relation (this page, and displaced rows), then the other side's.
  for (const id of await afterChange(c, page.databaseId!, [page.id, ...displaced], new Set([prop.id]))) touched.add(id);
  if (paired && pairedId && touched.size) {
    const others = [...touched].filter((id) => added.includes(id) || removed.includes(id));
    for (const id of await afterChange(c, paired.databaseId, others, new Set([pairedId]))) touched.add(id);
  }
  for (const id of displaced) touched.add(id);
  touched.delete(page.id);
  return touched;
}

/**
 * Pages of a database are about to be deleted (or were archived / restored):
 * drop them from every relation pointing at them and recalculate the rollups
 * that counted them. Returns the pages whose values changed.
 */
export async function detachPages(c: Client, databaseId: string, workspaceId: string, pageIds: string[], mode: "delete" | "archive"): Promise<Set<string>> {
  const touched = new Set<string>();
  if (!pageIds.length) return touched;
  const relations = await c.databaseProperty.findMany({ where: { type: "RELATION", database: { workspaceId } }, select: { id: true, databaseId: true, config: true } });
  const gone = new Set(pageIds);
  for (const r of relations) {
    if ((r.config as PropertyConfig | null)?.relation?.databaseId !== databaseId) continue;
    const hits = await c.$queryRaw<{ id: string; values: Prisma.JsonValue }[]>`
      SELECT "id", "values" FROM "pages" WHERE "database_id" = ${r.databaseId} AND ("values" -> ${r.id}::text) ?| ${pageIds}::text[]`;
    const affected = hits.filter((h) => !(mode === "delete" && gone.has(h.id) && r.databaseId === databaseId));
    if (!affected.length) continue;
    if (mode === "delete") {
      await patchValues(
        c,
        affected.map((h) => {
          const list = idsOf(h.values, r.id).filter((x) => !gone.has(x));
          return list.length ? { id: h.id, set: { [r.id]: list }, del: [] } : { id: h.id, set: {}, del: [r.id] };
        }),
      );
    }
    for (const h of affected) touched.add(h.id);
    for (const id of await afterChange(c, r.databaseId, affected.map((h) => h.id), new Set([r.id]))) touched.add(id);
  }
  for (const id of pageIds) touched.delete(id);
  return touched;
}

// ── Relation properties ───────────────────────────────────────────────────

/** Config for a new relation: checks the target and, for two-way, creates the paired property. */
export async function createRelationProperty(
  tx: Prisma.TransactionClient,
  input: { databaseId: string; workspaceId: string; name: string; position: string; relation: { databaseId: string; limit: "one" | "many"; twoWay: boolean; pairedName?: string } },
): Promise<PropertyDef> {
  const target = await tx.database.findFirst({ where: { id: input.relation.databaseId, workspaceId: input.workspaceId }, select: { id: true, title: true } });
  if (!target) throw new RelationError("Pick a database to link to.");
  const source = await tx.database.findUniqueOrThrow({ where: { id: input.databaseId }, select: { title: true } });
  const config: RelationConfig = { databaseId: target.id, limit: input.relation.limit, pairedId: null, primary: true };
  const prop = await tx.databaseProperty.create({ data: { databaseId: input.databaseId, name: input.name, type: "RELATION", config: json({ relation: config }), position: input.position } });
  if (input.relation.twoWay) {
    const paired = await createPaired(tx, target.id, prop.id, input.databaseId, (input.relation.pairedName?.trim() || source.title).slice(0, LIMITS.propertyName));
    config.pairedId = paired.id;
    await tx.databaseProperty.update({ where: { id: prop.id }, data: { config: json({ relation: config }) } });
  }
  return { id: prop.id, name: prop.name, type: "RELATION", config: { relation: config }, isTitle: false };
}

async function createPaired(tx: Prisma.TransactionClient, targetDbId: string, sourcePropId: string, sourceDbId: string, name: string) {
  const count = await tx.databaseProperty.count({ where: { databaseId: targetDbId } });
  if (count >= LIMITS.properties) throw new RelationError(`The other database already has ${LIMITS.properties} properties.`);
  const positions = (await tx.databaseProperty.findMany({ where: { databaseId: targetDbId }, select: { position: true } })).map((p) => p.position).sort();
  // Self-relations get a distinct name for the reverse side.
  const taken = new Set((await tx.databaseProperty.findMany({ where: { databaseId: targetDbId }, select: { name: true } })).map((p) => p.name));
  let finalName = name;
  for (let i = 2; taken.has(finalName); i++) finalName = `${name} ${i}`;
  return tx.databaseProperty.create({
    data: {
      databaseId: targetDbId,
      name: finalName,
      type: "RELATION",
      config: json({ relation: { databaseId: sourceDbId, limit: "many", pairedId: sourcePropId, primary: false } satisfies RelationConfig }),
      position: generateKeyBetween(positions.at(-1) ?? null, null),
    },
  });
}

/** Turn two-way on (create + fill the paired property) or off (delete it, keep the links). */
export async function setTwoWay(tx: Prisma.TransactionClient, prop: PropertyDef & { databaseId: string }, twoWay: boolean, pairedName?: string) {
  const cfg = prop.config.relation!;
  if (twoWay && !cfg.pairedId) {
    const source = await tx.database.findUniqueOrThrow({ where: { id: prop.databaseId }, select: { title: true } });
    const paired = await createPaired(tx, cfg.databaseId, prop.id, prop.databaseId, (pairedName?.trim() || source.title).slice(0, LIMITS.propertyName));
    // Fill the reverse arrays from the links.
    const links = await tx.pageRelation.findMany({ where: { propertyId: prop.id }, select: { fromPageId: true, toPageId: true }, orderBy: { position: "asc" } });
    const reverse = new Map<string, string[]>();
    for (const l of links) reverse.set(l.toPageId, [...(reverse.get(l.toPageId) ?? []), l.fromPageId]);
    await patchValues(tx, [...reverse].map(([id, list]) => ({ id, set: { [paired.id]: list }, del: [] })));
    return { ...cfg, pairedId: paired.id, primary: true };
  }
  if (!twoWay && cfg.pairedId) {
    const pairedId = cfg.pairedId;
    if (cfg.primary === false) {
      // The links are keyed by the property being removed: re-key them to this one.
      await tx.$executeRaw`UPDATE "page_relations" SET "property_id" = ${prop.id}, "from_page_id" = "to_page_id", "to_page_id" = "from_page_id" WHERE "property_id" = ${pairedId}`;
    }
    const paired = await tx.databaseProperty.findUnique({ where: { id: pairedId }, select: { databaseId: true } });
    if (paired) {
      await tx.$executeRaw`UPDATE "pages" SET "values" = "values" - ${pairedId}::text WHERE "database_id" = ${paired.databaseId}`;
      await tx.databaseProperty.delete({ where: { id: pairedId } });
      await recomputeDatabase(tx, paired.databaseId);
    }
    return { ...cfg, pairedId: null, primary: true };
  }
  return cfg;
}

/** Delete a relation property and its pair (values and links go too). */
export async function deleteRelationProperty(tx: Prisma.TransactionClient, prop: PropertyDef & { databaseId: string }) {
  const pairedId = prop.config.relation?.pairedId;
  const paired = pairedId ? await tx.databaseProperty.findUnique({ where: { id: pairedId }, select: { id: true, databaseId: true } }) : null;
  for (const p of [{ id: prop.id, databaseId: prop.databaseId }, ...(paired ? [paired] : [])]) {
    await tx.pageRelation.deleteMany({ where: { propertyId: p.id } });
    await tx.$executeRaw`UPDATE "pages" SET "values" = "values" - ${p.id}::text WHERE "database_id" = ${p.databaseId}`;
    await tx.databaseProperty.delete({ where: { id: p.id } });
  }
  const dbs = new Set([prop.databaseId, ...(paired ? [paired.databaseId] : [])]);
  for (const d of dbs) await recomputeDatabase(tx, d);
}

/** A database is being deleted: remove relations elsewhere that point at it. */
export async function dropRelationsInto(tx: Prisma.TransactionClient, databaseId: string, workspaceId: string) {
  const relations = await tx.databaseProperty.findMany({ where: { type: "RELATION", database: { workspaceId }, NOT: { databaseId } }, select: { id: true, databaseId: true, config: true } });
  const dbs = new Set<string>();
  for (const r of relations) {
    if ((r.config as PropertyConfig | null)?.relation?.databaseId !== databaseId) continue;
    await tx.$executeRaw`UPDATE "pages" SET "values" = "values" - ${r.id}::text WHERE "database_id" = ${r.databaseId}`;
    await tx.databaseProperty.delete({ where: { id: r.id } });
    dbs.add(r.databaseId);
  }
  for (const d of dbs) await recomputeDatabase(tx, d);
}

/** Title / icon / archived state of related pages, for relation chips. */
export interface RelatedPage {
  title: string;
  icon: string | null;
  databaseId: string | null;
  archived: boolean;
}

export async function relatedPages(c: Client, defs: PropertyDef[], rows: { values: Record<string, PropertyValue> }[]): Promise<Record<string, RelatedPage>> {
  const rel = defs.filter((d) => d.type === "RELATION");
  const ids = new Set<string>();
  for (const r of rows) for (const d of rel) for (const id of (r.values[d.id] as string[] | undefined) ?? []) if (typeof id === "string") ids.add(id);
  if (!ids.size) return {};
  const pages = await c.page.findMany({ where: { id: { in: [...ids] } }, select: { id: true, title: true, icon: true, databaseId: true, archivedAt: true } });
  return Object.fromEntries(pages.map((p) => [p.id, { title: p.title, icon: p.icon, databaseId: p.databaseId, archived: !!p.archivedAt }]));
}

export { defsOf };
