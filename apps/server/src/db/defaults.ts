import { nanoid } from "nanoid";

import { outputProfileOptionsSchema } from "@subscription-converter/shared";

import type { DatabaseConnection } from "./database";
import { outputProfiles } from "./schema";

export const defaultClashProfileId = "default-clash";
export const defaultShadowrocketProfileId = "default-shadowrocket";

export function ensureDefaultOutputProfiles(database: DatabaseConnection) {
  // Seed a fresh installation only; deleted profiles must not reappear on restart.
  if (database.db.select().from(outputProfiles).limit(1).get()) return;
  const now = new Date();
  const defaults = [
    {
      id: defaultClashProfileId,
      name: "Clash / Mihomo",
      targetClient: "clash" as const,
    },
    {
      id: defaultShadowrocketProfileId,
      name: "Shadowrocket（实验性）",
      targetClient: "shadowrocket" as const,
    },
  ];

  for (const profile of defaults) {
    database.db
      .insert(outputProfiles)
      .values({
        ...profile,
        token: nanoid(32),
        enabled: true,
        optionsJson: JSON.stringify(outputProfileOptionsSchema.parse({})),
        createdAt: now,
        updatedAt: now,
      })
      .run();
  }
}
