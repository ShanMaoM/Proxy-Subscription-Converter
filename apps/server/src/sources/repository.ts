import { desc, eq } from "drizzle-orm";

import type { DatabaseConnection } from "../db/database";
import { subscriptionCache, subscriptionSources } from "../db/schema";

export type SourceInsert = typeof subscriptionSources.$inferInsert;
export type SourceUpdate = Partial<
  Omit<SourceInsert, "id" | "createdAt" | "updatedAt">
> & { updatedAt: Date };

export class SourceRepository {
  constructor(private readonly database: DatabaseConnection) {}

  list() {
    return this.database.db
      .select()
      .from(subscriptionSources)
      .orderBy(desc(subscriptionSources.createdAt))
      .all();
  }

  findById(id: string) {
    return this.database.db
      .select()
      .from(subscriptionSources)
      .where(eq(subscriptionSources.id, id))
      .get();
  }

  findLatestCache(sourceId: string) {
    return this.database.db
      .select()
      .from(subscriptionCache)
      .where(eq(subscriptionCache.sourceId, sourceId))
      .orderBy(desc(subscriptionCache.fetchedAt))
      .limit(1)
      .get();
  }

  create(source: SourceInsert) {
    this.database.db.insert(subscriptionSources).values(source).run();
    return this.findById(source.id)!;
  }

  update(id: string, changes: SourceUpdate) {
    this.database.sqlite.transaction(() => {
      if (changes.urlEncrypted !== undefined) {
        this.database.db
          .delete(subscriptionCache)
          .where(eq(subscriptionCache.sourceId, id))
          .run();
        changes = {
          ...changes,
          lastFetchedAt: null,
          lastFetchStatus: "never",
          lastError: null,
          trafficUpload: null,
          trafficDownload: null,
          trafficTotal: null,
          expireAt: null,
        };
      }
      this.database.db
        .update(subscriptionSources)
        .set(changes)
        .where(eq(subscriptionSources.id, id))
        .run();
    })();
    return this.findById(id);
  }

  saveRefresh(
    entry: typeof subscriptionCache.$inferInsert,
    changes: SourceUpdate,
  ) {
    return this.database.sqlite.transaction(() => {
      this.database.db
        .delete(subscriptionCache)
        .where(eq(subscriptionCache.sourceId, entry.sourceId))
        .run();
      this.database.db.insert(subscriptionCache).values(entry).run();
      const source = this.update(entry.sourceId, changes)!;
      return { source, cache: this.findLatestCache(entry.sourceId)! };
    })();
  }

  delete(id: string) {
    return this.database.db
      .delete(subscriptionSources)
      .where(eq(subscriptionSources.id, id))
      .run().changes;
  }
}
