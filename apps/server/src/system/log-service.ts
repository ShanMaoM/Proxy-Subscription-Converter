import { desc } from "drizzle-orm";
import { nanoid } from "nanoid";

import type { DatabaseConnection } from "../db/database";
import { operationLogs } from "../db/schema";
import { sanitizeLogMessage, sanitizeLogMetadata } from "./log-sanitizer";

export type OperationLogLevel = "info" | "warn" | "error";

export class OperationLogService {
  constructor(private readonly database: DatabaseConnection) {}

  record(input: {
    level?: OperationLogLevel;
    action: string;
    message: string;
    metadata?: unknown;
  }) {
    try {
      this.database.db
        .insert(operationLogs)
        .values({
          id: nanoid(),
          level: input.level ?? "info",
          action: input.action,
          message: sanitizeLogMessage(input.message),
          metadataJson:
            input.metadata === undefined
              ? null
              : JSON.stringify(sanitizeLogMetadata(input.metadata)),
          createdAt: new Date(),
        })
        .run();
    } catch {
      // Operational logging must never prevent the requested action.
    }
  }

  list(limit = 100) {
    return this.database.db
      .select()
      .from(operationLogs)
      .orderBy(desc(operationLogs.createdAt))
      .limit(Math.min(Math.max(limit, 1), 200))
      .all()
      .map((entry) => ({
        id: entry.id,
        level: entry.level,
        action: entry.action,
        message: entry.message,
        metadata: entry.metadataJson
          ? (JSON.parse(entry.metadataJson) as unknown)
          : null,
        createdAt: entry.createdAt.toISOString(),
      }));
  }
}
