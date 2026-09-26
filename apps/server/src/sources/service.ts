import { createHash } from "node:crypto";

import { nanoid } from "nanoid";

import {
  createSubscriptionSourceSchema,
  type CreateSubscriptionSource,
  updateSubscriptionSourceSchema,
} from "@subscription-converter/shared";
import { parseSubscriptionContent } from "@subscription-converter/converter";

import type { AppConfig } from "../config/env";
import {
  fetchRemoteSubscription,
  type RemoteFetcher,
} from "../remote/fetch-subscription";
import {
  decryptSensitiveValue,
  encryptSensitiveValue,
  maskSensitiveUrl,
} from "../security/encryption";
import { sanitizeLogMessage } from "../system/log-sanitizer";
import { SourceRepository } from "./repository";

type StoredSource = NonNullable<ReturnType<SourceRepository["findById"]>>;

export class SourceValidationError extends Error {
  statusCode = 400;
}

function validateRemoteUrl(value: string) {
  const url = new URL(value);
  if (!["http:", "https:"].includes(url.protocol)) {
    throw new SourceValidationError(
      "Remote subscription URL must use HTTP or HTTPS",
    );
  }
  return url.toString();
}

export class SourceService {
  private readonly inFlight = new Map<
    string,
    ReturnType<SourceService["refreshOnce"]>
  >();

  constructor(
    private readonly repository: SourceRepository,
    private readonly config: AppConfig,
    private readonly remoteFetcher: RemoteFetcher = fetchRemoteSubscription,
  ) {}

  list() {
    return this.repository.list().map((source) => this.toResponse(source));
  }

  get(id: string) {
    const source = this.repository.findById(id);
    return source ? this.toResponse(source, true) : undefined;
  }

  create(input: unknown) {
    const source = createSubscriptionSourceSchema.parse(input);
    const now = new Date();
    const remoteUrl =
      source.type === "remote_url" ? validateRemoteUrl(source.url!) : undefined;
    const stored = this.repository.create({
      id: nanoid(),
      name: source.name,
      type: source.type,
      urlEncrypted: remoteUrl
        ? encryptSensitiveValue(remoteUrl, this.getEncryptionSecret())
        : null,
      urlMasked: remoteUrl ? maskSensitiveUrl(remoteUrl) : null,
      rawContent: source.type === "remote_url" ? null : source.rawContent!,
      enabled: source.enabled,
      refreshIntervalMinutes:
        source.type === "remote_url" ? source.refreshIntervalMinutes : null,
      note: source.note ?? null,
      lastFetchStatus: "never",
      createdAt: now,
      updatedAt: now,
    });
    return this.toResponse(stored, true);
  }

  update(id: string, input: unknown) {
    const current = this.repository.findById(id);
    if (!current) {
      return undefined;
    }

    const parsed = updateSubscriptionSourceSchema.parse(input);
    const changes: Parameters<SourceRepository["update"]>[1] = {
      updatedAt: new Date(),
    };

    if (parsed.name !== undefined) changes.name = parsed.name;
    if (parsed.enabled !== undefined) changes.enabled = parsed.enabled;
    if (parsed.refreshIntervalMinutes !== undefined) {
      if (
        current.type !== "remote_url" &&
        parsed.refreshIntervalMinutes !== null
      ) {
        throw new SourceValidationError(
          "Only remote URL sources may enable automatic refresh",
        );
      }
      changes.refreshIntervalMinutes = parsed.refreshIntervalMinutes;
    }
    if (parsed.note !== undefined) changes.note = parsed.note ?? null;
    if (parsed.url !== undefined) {
      if (current.type !== "remote_url") {
        throw new SourceValidationError("Only remote sources can update url");
      }
      const remoteUrl = validateRemoteUrl(parsed.url);
      changes.urlEncrypted = encryptSensitiveValue(
        remoteUrl,
        this.getEncryptionSecret(),
      );
      changes.urlMasked = maskSensitiveUrl(remoteUrl);
    }
    if (parsed.rawContent !== undefined) {
      if (current.type === "remote_url") {
        throw new SourceValidationError(
          "Remote sources cannot update rawContent",
        );
      }
      changes.rawContent = parsed.rawContent;
    }

    const updated = this.repository.update(id, changes);
    return updated ? this.toResponse(updated, true) : undefined;
  }

  delete(id: string) {
    return this.repository.delete(id) > 0;
  }

  listDueForAutoRefresh(now = new Date()) {
    return this.repository
      .list()
      .filter((source) => {
        if (
          source.type !== "remote_url" ||
          !source.enabled ||
          !source.refreshIntervalMinutes
        ) {
          return false;
        }
        const base = source.lastFetchedAt ?? source.createdAt;
        return (
          base.getTime() + source.refreshIntervalMinutes * 60_000 <=
          now.getTime()
        );
      })
      .map((source) => ({ id: source.id, name: source.name }));
  }

  refresh(id: string) {
    const pending = this.inFlight.get(id);
    if (pending) return pending;
    const request = this.refreshOnce(id);
    this.inFlight.set(id, request);
    const cleanup = () => this.inFlight.delete(id);
    void request.then(cleanup, cleanup);
    return request;
  }

  private async refreshOnce(id: string) {
    const source = this.repository.findById(id);
    if (!source) {
      return undefined;
    }
    if (source.type !== "remote_url" || !source.urlEncrypted) {
      throw new SourceValidationError(
        "Only remote URL sources can be refreshed",
      );
    }

    const attemptedAt = new Date();
    try {
      const url = decryptSensitiveValue(
        source.urlEncrypted,
        this.getEncryptionSecret(),
      );
      const fetched = await this.remoteFetcher(url);
      const content = typeof fetched === "string" ? fetched : fetched.content;
      const subscriptionUserInfo =
        typeof fetched === "string" ? null : fetched.subscriptionUserInfo;
      const contentHash = createHash("sha256").update(content).digest("hex");
      const proxiesCount = parseSubscriptionContent(content).proxies.length;
      const current = this.repository.findById(id);
      if (!current) return undefined;
      if (
        current.urlEncrypted !== source.urlEncrypted ||
        current.updatedAt.getTime() !== source.updatedAt.getTime()
      ) {
        throw Object.assign(
          new Error("Source changed during refresh; please retry"),
          { statusCode: 409 },
        );
      }
      const { cache, source: updated } = this.repository.saveRefresh(
        {
          id: nanoid(),
          sourceId: source.id,
          content,
          contentHash,
          proxiesCount,
          fetchedAt: attemptedAt,
          createdAt: attemptedAt,
        },
        {
          lastFetchedAt: attemptedAt,
          lastFetchStatus: "success",
          lastError: null,
          trafficUpload: subscriptionUserInfo?.upload ?? null,
          trafficDownload: subscriptionUserInfo?.download ?? null,
          trafficTotal: subscriptionUserInfo?.total ?? null,
          expireAt: subscriptionUserInfo?.expireAt ?? null,
          updatedAt: attemptedAt,
        },
      );

      return {
        source: this.toResponse(updated),
        cache: {
          contentHash: cache.contentHash,
          fetchedAt: cache.fetchedAt.toISOString(),
        },
      };
    } catch (error) {
      const message = sanitizeLogMessage(
        error instanceof Error ? error.message : "Remote refresh failed",
      );
      const current = this.repository.findById(source.id);
      if (
        current?.urlEncrypted === source.urlEncrypted &&
        current.updatedAt.getTime() === source.updatedAt.getTime()
      )
        this.repository.update(source.id, {
          lastFetchedAt: attemptedAt,
          lastFetchStatus: "failed",
          lastError: message,
          updatedAt: attemptedAt,
        });
      if (error instanceof Error) {
        error.message = message;
        throw error;
      }
      throw new Error(message, { cause: error });
    }
  }

  private getEncryptionSecret() {
    if (!this.config.SESSION_SECRET) {
      throw new Error(
        "SESSION_SECRET is required to encrypt subscription URLs",
      );
    }
    return this.config.SESSION_SECRET;
  }

  private toResponse(source: StoredSource, includeRawContent = false) {
    const cache = this.repository.findLatestCache(source.id);
    const nextRefreshAt =
      source.type === "remote_url" &&
      source.enabled &&
      source.refreshIntervalMinutes
        ? new Date(
            (source.lastFetchedAt ?? source.createdAt).getTime() +
              source.refreshIntervalMinutes * 60_000,
          ).toISOString()
        : null;
    return {
      id: source.id,
      name: source.name,
      type: source.type,
      urlMasked: source.urlMasked,
      rawContent:
        includeRawContent && source.type !== "remote_url"
          ? source.rawContent
          : undefined,
      enabled: source.enabled,
      refreshIntervalMinutes: source.refreshIntervalMinutes,
      nextRefreshAt,
      trafficUpload: source.trafficUpload,
      trafficDownload: source.trafficDownload,
      trafficTotal: source.trafficTotal,
      expireAt: source.expireAt?.toISOString() ?? null,
      note: source.note,
      lastFetchedAt: source.lastFetchedAt?.toISOString() ?? null,
      lastFetchStatus: source.lastFetchStatus,
      lastError: source.lastError,
      proxiesCount: cache?.proxiesCount ?? null,
      createdAt: source.createdAt.toISOString(),
      updatedAt: source.updatedAt.toISOString(),
    };
  }
}

export type SourceCreateInput = CreateSubscriptionSource;
