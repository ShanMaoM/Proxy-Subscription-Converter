import { asc, desc, eq } from "drizzle-orm";

import type { DatabaseConnection } from "../db/database";
import {
  outputProfiles,
  rules,
  subscriptionCache,
  subscriptionSources,
} from "../db/schema";

export class OutputRepository {
  constructor(private readonly database: DatabaseConnection) {}

  findProfile(id: string) {
    return this.database.db
      .select()
      .from(outputProfiles)
      .where(eq(outputProfiles.id, id))
      .get();
  }

  findProfileByToken(token: string) {
    return this.database.db
      .select()
      .from(outputProfiles)
      .where(eq(outputProfiles.token, token))
      .get();
  }

  listProfiles() {
    return this.database.db
      .select()
      .from(outputProfiles)
      .orderBy(asc(outputProfiles.createdAt), asc(outputProfiles.id))
      .all();
  }

  createProfile(profile: typeof outputProfiles.$inferInsert) {
    this.database.db.insert(outputProfiles).values(profile).run();
    return this.findProfile(profile.id)!;
  }

  updateProfile(
    id: string,
    changes: Partial<typeof outputProfiles.$inferInsert>,
  ) {
    this.database.db
      .update(outputProfiles)
      .set({ ...changes, updatedAt: new Date() })
      .where(eq(outputProfiles.id, id))
      .run();
    return this.findProfile(id);
  }

  deleteProfile(id: string) {
    return (
      this.database.db
        .delete(outputProfiles)
        .where(eq(outputProfiles.id, id))
        .run().changes > 0
    );
  }

  sourceIds() {
    return this.database.db
      .select({ id: subscriptionSources.id })
      .from(subscriptionSources)
      .all()
      .map((source) => source.id);
  }

  updateToken(id: string, token: string) {
    this.database.db
      .update(outputProfiles)
      .set({ token, updatedAt: new Date() })
      .where(eq(outputProfiles.id, id))
      .run();
    return this.findProfile(id);
  }

  listSources() {
    return this.database.db.select().from(subscriptionSources).all();
  }

  listEnabledSources() {
    return this.database.db
      .select()
      .from(subscriptionSources)
      .where(eq(subscriptionSources.enabled, true))
      .all();
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

  listRules() {
    return this.database.db
      .select()
      .from(rules)
      .orderBy(asc(rules.sortOrder))
      .all();
  }
}
