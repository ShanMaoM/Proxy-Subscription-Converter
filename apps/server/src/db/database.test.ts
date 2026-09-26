import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { eq } from "drizzle-orm";
import { afterEach, describe, expect, it } from "vitest";

import { createDatabase, initializeDatabase, runMigrations } from "./database";
import { subscriptionSources } from "./schema";

const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe("database initialization", () => {
  it("creates every table and reads an inserted subscription source", () => {
    const directory = mkdtempSync(join(tmpdir(), "subscription-converter-"));
    temporaryDirectories.push(directory);
    const databasePath = join(directory, "app.sqlite");
    const connection = initializeDatabase(databasePath);
    const now = new Date();

    connection.db
      .insert(subscriptionSources)
      .values({
        id: "source-1",
        name: "Test source",
        type: "pasted_yaml",
        rawContent: "proxies: []",
        enabled: true,
        lastFetchStatus: "never",
        createdAt: now,
        updatedAt: now,
      })
      .run();

    const source = connection.db
      .select()
      .from(subscriptionSources)
      .where(eq(subscriptionSources.id, "source-1"))
      .get();

    const tableNames = connection.sqlite
      .prepare(
        "SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name",
      )
      .all()
      .map((row) => (row as { name: string }).name);

    expect(source?.name).toBe("Test source");
    expect(tableNames).toEqual(
      expect.arrayContaining([
        "settings",
        "subscription_sources",
        "subscription_cache",
        "rules",
        "output_profiles",
        "operation_logs",
      ]),
    );
    connection.close();
  });

  it("can initialize again after deleting the database", () => {
    const directory = mkdtempSync(join(tmpdir(), "subscription-converter-"));
    temporaryDirectories.push(directory);
    const databasePath = join(directory, "app.sqlite");

    initializeDatabase(databasePath).close();
    rmSync(databasePath, { force: true });
    rmSync(`${databasePath}-shm`, { force: true });
    rmSync(`${databasePath}-wal`, { force: true });

    const recreated = initializeDatabase(databasePath);
    expect(
      recreated.sqlite
        .prepare(
          "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'settings'",
        )
        .get(),
    ).toBeTruthy();
    recreated.close();
  });

  it("adds source metadata columns to an existing database", () => {
    const connection = createDatabase(":memory:");
    connection.sqlite.exec(`
      CREATE TABLE __migrations (
        id TEXT PRIMARY KEY NOT NULL,
        applied_at INTEGER NOT NULL
      );
      INSERT INTO __migrations (id, applied_at)
      VALUES ('0000_initial', 0);
      CREATE TABLE rules (id TEXT PRIMARY KEY, rule_type TEXT NOT NULL);
      INSERT INTO rules(id,rule_type) VALUES ('old-rule', 'DOMAIN');
      CREATE TABLE subscription_sources (
        id TEXT PRIMARY KEY NOT NULL,
        name TEXT NOT NULL,
        type TEXT NOT NULL,
        enabled INTEGER DEFAULT 1 NOT NULL,
        last_fetch_status TEXT DEFAULT 'never' NOT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );
    `);

    runMigrations(connection);

    const columns = connection.sqlite
      .prepare("PRAGMA table_info(subscription_sources)")
      .all()
      .map((column) => (column as { name: string }).name);
    expect(columns).toContain("refresh_interval_minutes");
    expect(columns).toContain("traffic_upload");
    expect(columns).toContain("traffic_download");
    expect(columns).toContain("traffic_total");
    expect(columns).toContain("expire_at");
    expect(
      connection.sqlite
        .prepare("SELECT no_resolve FROM rules WHERE id = ?")
        .get("old-rule"),
    ).toEqual({ no_resolve: 0 });
    connection.close();
  });
});
