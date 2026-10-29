import { eq } from 'drizzle-orm';
import type { Executor } from '../../../db/client.js';
import * as t from '../../../db/schema.js';

/** The stored brief JSON of a PR, untouched (`unknown`): the service parses it, so a bad row degrades instead of crashing. */
export async function getBriefJson(db: Executor, prId: string): Promise<unknown | undefined> {
  const [row] = await db.select({ json: t.prBrief.json }).from(t.prBrief).where(eq(t.prBrief.prId, prId)).limit(1);
  return row?.json;
}

/** One brief per PR: insert, or replace the stored JSON. */
export async function upsertBrief(db: Executor, prId: string, json: unknown): Promise<void> {
  await db
    .insert(t.prBrief)
    .values({ prId, json })
    .onConflictDoUpdate({ target: t.prBrief.prId, set: { json } });
}
