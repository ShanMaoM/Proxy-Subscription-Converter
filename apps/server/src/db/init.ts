import { loadConfig } from "../config/env";
import { initializeDatabase, resolveDatabasePath } from "./database";
import { ensureDefaultOutputProfiles } from "./defaults";

const config = loadConfig();
const connection = initializeDatabase(config.DATABASE_URL);
ensureDefaultOutputProfiles(connection);
connection.close();

console.log(
  `Database initialized at ${resolveDatabasePath(config.DATABASE_URL)}`,
);
