import {
  generateBase64Subscription,
  generateClashYaml,
  generateShadowrocketConfig,
  type ClashInputSource,
} from "@subscription-converter/converter";
import {
  outputProfileOptionsSchema,
  userRuleSchema,
} from "@subscription-converter/shared";
import { nanoid } from "nanoid";

import { OutputProfileService } from "./profile-service";
import { OutputRepository } from "./repository";

export class OutputNotReadyError extends Error {
  statusCode = 409;

  constructor(message: string) {
    super(message);
    this.name = "OutputNotReadyError";
  }
}

export class OutputService {
  constructor(private readonly repository: OutputRepository) {}

  generate(profileId: string, allowDisabled = false) {
    const profile = this.repository.findProfile(profileId);
    if (
      !profile ||
      (!allowDisabled && !profile.enabled) ||
      profile.targetClient !== "clash"
    ) {
      return undefined;
    }

    const options = outputProfileOptionsSchema.parse(
      JSON.parse(profile.optionsJson),
    );
    const sources = this.getSources(options);
    const rules =
      options.customRules ??
      this.repository.listRules().map((rule) =>
        userRuleSchema.parse({
          id: rule.id,
          ruleType: rule.ruleType,
          noResolve: rule.noResolve,
          value: rule.value,
          policy: rule.policy,
          enabled: rule.enabled,
          sortOrder: rule.sortOrder,
          note: rule.note,
          createdAt: rule.createdAt.toISOString(),
          updatedAt: rule.updatedAt.toISOString(),
        }),
      );

    const result = generateClashYaml({ sources, rules, options });
    const policies = new Set([
      "DIRECT",
      "REJECT",
      "REJECT-DROP",
      "PASS",
      "COMPATIBLE",
      ...(result.config["proxy-groups"] as { name: string }[]).map(
        (group) => group.name,
      ),
      ...(result.config.proxies as { name: string }[]).map(
        (proxy) => proxy.name,
      ),
    ]);
    const enabledRules = rules.filter((rule) => rule.enabled);
    const matchPolicy =
      enabledRules.find((rule) => rule.ruleType === "MATCH")?.policy ??
      options.matchPolicy;
    if (
      [...enabledRules.map((rule) => rule.policy), matchPolicy].some(
        (policy) => !policies.has(policy),
      )
    ) {
      throw new OutputNotReadyError(
        "当前输出缺少规则引用的策略组，请配置对应策略组或使用独立规则。",
      );
    }
    const providers = result.config["rule-providers"] as
      | Record<string, unknown>
      | undefined;
    if (
      enabledRules.some(
        (rule) =>
          rule.ruleType === "RULE-SET" &&
          (!rule.value || !providers?.[rule.value]),
      )
    ) {
      throw new OutputNotReadyError(
        "当前输出缺少规则引用的规则集，请配置对应规则集或使用独立规则。",
      );
    }
    return { profile, ...result };
  }

  generateByToken(token: string, targetClient: "clash") {
    const profile = this.repository.findProfileByToken(token);
    if (!profile || profile.targetClient !== targetClient || !profile.enabled) {
      return undefined;
    }
    return this.generate(profile.id);
  }

  generateShadowrocket(profileId: string, allowDisabled = false) {
    const profile = this.repository.findProfile(profileId);
    if (
      !profile ||
      (!allowDisabled && !profile.enabled) ||
      profile.targetClient !== "shadowrocket"
    ) {
      return undefined;
    }
    const options = outputProfileOptionsSchema.parse(
      JSON.parse(profile.optionsJson),
    );
    return {
      profile,
      ...generateShadowrocketConfig({
        sources: this.getSources(options),
        nodeFilter: options.nodeFilter,
      }),
    };
  }

  generateShadowrocketByToken(token: string) {
    const profile = this.repository.findProfileByToken(token);
    if (
      !profile ||
      profile.targetClient !== "shadowrocket" ||
      !profile.enabled
    ) {
      return undefined;
    }
    return this.generateShadowrocket(profile.id);
  }

  generateBase64ByToken(token: string) {
    const profile = this.repository.findProfileByToken(token);
    if (!profile || profile.targetClient !== "clash" || !profile.enabled) {
      return undefined;
    }
    const options = outputProfileOptionsSchema.parse(
      JSON.parse(profile.optionsJson),
    );
    return {
      profile,
      ...generateBase64Subscription({
        sources: this.getSources(options),
        nodeFilter: options.nodeFilter,
      }),
    };
  }

  listProfiles(publicBaseUrl: string) {
    return new OutputProfileService(this.repository).list(publicBaseUrl);
  }

  resetToken(profileId: string) {
    return this.repository.updateToken(profileId, nanoid(32));
  }

  preview(profileId: string) {
    const profile = this.repository.findProfile(profileId);
    if (!profile) return undefined;
    const options = outputProfileOptionsSchema.parse(
      JSON.parse(profile.optionsJson),
    );
    if (profile.targetClient === "shadowrocket") {
      const result = this.generateShadowrocket(profileId, true)!;
      return {
        content: result.content,
        format: "conf" as const,
        summary: result.summary,
        warnings: result.warnings,
      };
    }
    if (options.subscriptionFilename?.toLowerCase().endsWith(".txt")) {
      const result = generateBase64Subscription({
        sources: this.getSources(options),
        nodeFilter: options.nodeFilter,
      });
      return {
        content: result.content,
        format: "txt" as const,
        summary: result.summary,
        warnings: result.warnings,
      };
    }
    const result = this.generate(profileId, true)!;
    return {
      content: result.yaml,
      format: "yaml" as const,
      summary: result.summary,
      warnings: result.warnings,
    };
  }

  private getSources(
    options: ReturnType<typeof outputProfileOptionsSchema.parse>,
  ) {
    const sources: ClashInputSource[] = [];
    const selectedIds =
      options.sourceIds == null ? null : new Set(options.sourceIds);
    for (const source of this.repository.listEnabledSources()) {
      if (selectedIds && !selectedIds.has(source.id)) continue;
      const content =
        source.type === "remote_url"
          ? this.repository.findLatestCache(source.id)?.content
          : source.rawContent;
      if (!content) {
        throw new OutputNotReadyError(
          `Source "${source.name}" has no available content`,
        );
      }
      sources.push({ sourceName: source.name, content });
    }
    return sources;
  }
}
