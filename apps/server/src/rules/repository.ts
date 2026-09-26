import { asc, eq, max } from "drizzle-orm";

import type { DatabaseConnection } from "../db/database";
import { rules } from "../db/schema";

export class RuleRepository {
  constructor(private readonly database: DatabaseConnection) {}

  list() {
    return this.database.db
      .select()
      .from(rules)
      .orderBy(asc(rules.sortOrder))
      .all();
  }

  findById(id: string) {
    return this.database.db.select().from(rules).where(eq(rules.id, id)).get();
  }

  nextSortOrder() {
    const result = this.database.db
      .select({ value: max(rules.sortOrder) })
      .from(rules)
      .get();
    return (result?.value ?? -1) + 1;
  }

  create(rule: typeof rules.$inferInsert) {
    this.database.db.insert(rules).values(rule).run();
    return this.findById(rule.id)!;
  }

  update(id: string, changes: Partial<typeof rules.$inferInsert>) {
    this.database.db.update(rules).set(changes).where(eq(rules.id, id)).run();
    return this.findById(id);
  }

  delete(id: string) {
    return this.database.db.delete(rules).where(eq(rules.id, id)).run().changes;
  }

  reorder(ids: string[]) {
    this.database.db.transaction((transaction) => {
      ids.forEach((id, index) => {
        transaction
          .update(rules)
          .set({ sortOrder: index, updatedAt: new Date() })
          .where(eq(rules.id, id))
          .run();
      });
    });
    return this.list();
  }

  replaceAll(nextRules: (typeof rules.$inferInsert)[]) {
    this.database.db.transaction((transaction) => {
      transaction.delete(rules).run();
      if (nextRules.length > 0) {
        transaction.insert(rules).values(nextRules).run();
      }
    });
    return this.list();
  }
}
