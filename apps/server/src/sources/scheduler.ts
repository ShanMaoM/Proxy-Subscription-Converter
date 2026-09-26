import type { FastifyBaseLogger } from "fastify";

import type { OperationLogService } from "../system/log-service";
import type { SourceService } from "./service";
import { sanitizeLogMessage } from "../system/log-sanitizer";

type RefreshService = Pick<SourceService, "listDueForAutoRefresh" | "refresh">;

export class SourceRefreshScheduler {
  private timer?: NodeJS.Timeout;
  private pending?: Promise<void>;
  private stopping = false;

  constructor(
    private readonly sources: RefreshService,
    private readonly logs?: OperationLogService,
    private readonly logger?: FastifyBaseLogger,
    private readonly checkIntervalMs = 60_000,
  ) {}

  start() {
    if (this.timer) return;
    this.stopping = false;
    void this.runDue();
    this.timer = setInterval(() => void this.runDue(), this.checkIntervalMs);
    this.timer.unref();
  }

  async stop() {
    this.stopping = true;
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
    await this.pending;
  }

  runDue(now = new Date()) {
    if (this.pending) return this.pending;
    if (this.stopping) return Promise.resolve();
    this.pending = this.run(now).finally(() => {
      this.pending = undefined;
    });
    return this.pending;
  }

  private async run(now: Date) {
    try {
      for (const source of this.sources.listDueForAutoRefresh(now)) {
        if (this.stopping) break;
        try {
          const result = await this.sources.refresh(source.id);
          if (!result) continue;
          this.logs?.record({
            action: "source.auto-refresh",
            message: `Source automatically refreshed: ${source.name}`,
            metadata: {
              sourceId: source.id,
              proxiesCount: result.source.proxiesCount,
            },
          });
        } catch (error) {
          const message = sanitizeLogMessage(
            error instanceof Error ? error.message : "Automatic refresh failed",
          );
          this.logs?.record({
            level: "error",
            action: "source.auto-refresh",
            message,
            metadata: { sourceId: source.id },
          });
          this.logger?.warn(
            { sourceId: source.id, error: message },
            "Automatic source refresh failed",
          );
        }
      }
    } catch {
      this.logger?.warn("Unable to scan sources for automatic refresh");
    }
  }
}
