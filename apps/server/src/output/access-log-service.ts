import { isIP } from "node:net";
import type { DatabaseConnection } from "../db/database";

export const accessLogRetentionDays = 30;
export const accessLogLimit = 10_000;
type AccessRow = {
  id: number;
  ip: string;
  method: string;
  format: string;
  statusCode: number;
  createdAt: number;
};

export class AccessLogService {
  constructor(private readonly database: DatabaseConnection) {}

  record(
    profileId: string,
    ip: string,
    method: string,
    format: string,
    statusCode: number,
  ) {
    const normalizedIp = ip.startsWith("::ffff:") ? ip.slice(7) : ip;
    if (!isIP(normalizedIp)) return;
    this.database.sqlite.transaction(() => {
      this.database.sqlite
        .prepare(
          `INSERT INTO subscription_access_logs
        (profile_id, ip, method, format, status_code, created_at)
        SELECT ?, ?, ?, ?, ?, ? WHERE EXISTS (SELECT 1 FROM output_profiles WHERE id = ?)`,
        )
        .run(
          profileId,
          normalizedIp,
          method,
          format,
          statusCode,
          Date.now(),
          profileId,
        );
      this.prune(profileId);
    })();
  }

  list(profileId: string, before: number | undefined, limit: number) {
    this.prune(profileId);
    const rows = this.database.sqlite
      .prepare(
        `SELECT id, ip, method, format, status_code AS statusCode, created_at AS createdAt
      FROM subscription_access_logs WHERE profile_id = ? AND id < ? ORDER BY id DESC LIMIT ?`,
      )
      .all(
        profileId,
        before ?? Number.MAX_SAFE_INTEGER,
        limit + 1,
      ) as AccessRow[];
    const items = rows.slice(0, limit).map((row) => ({
      ...row,
      createdAt: new Date(row.createdAt).toISOString(),
    }));
    const { total } = this.database.sqlite
      .prepare(
        "SELECT COUNT(*) AS total FROM subscription_access_logs WHERE profile_id = ?",
      )
      .get(profileId) as { total: number };
    return {
      items,
      nextCursor: rows.length > limit ? items.at(-1)!.id : null,
      total,
      retentionDays: accessLogRetentionDays,
      maxRecords: accessLogLimit,
    };
  }

  private prune(profileId: string) {
    this.database.sqlite
      .prepare("DELETE FROM subscription_access_logs WHERE created_at < ?")
      .run(Date.now() - accessLogRetentionDays * 86_400_000);
    this.database.sqlite
      .prepare(
        `DELETE FROM subscription_access_logs WHERE profile_id = ? AND id < COALESCE(
      (SELECT id FROM subscription_access_logs WHERE profile_id = ? ORDER BY id DESC LIMIT 1 OFFSET ?), 0)`,
      )
      .run(profileId, profileId, accessLogLimit - 1);
  }
}
