import { createApp } from "./app";
import { loadConfig } from "./config/env";

const config = loadConfig();
const server = await createApp({ config });

for (const signal of ["SIGTERM", "SIGINT"] as const) {
  process.once(signal, () => {
    void server.close().catch(() => {
      process.exitCode = 1;
    });
  });
}

try {
  await server.listen({ host: config.HOST, port: config.PORT });
} catch (error) {
  server.log.error(error);
  process.exit(1);
}
