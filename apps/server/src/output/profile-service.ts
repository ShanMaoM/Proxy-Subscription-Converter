import { nanoid } from "nanoid";
import {
  createOutputProfileSchema,
  outputProfileOptionsSchema,
  outputProfileSchema,
  saveUserRulesSchema,
  updateOutputProfileSchema,
  userRuleSchema,
  type OutputProfileOptions,
} from "@subscription-converter/shared";
import { RuleValidationError, validateRuleSet } from "../rules/service";
import { OutputRepository } from "./repository";

type StoredProfile = NonNullable<ReturnType<OutputRepository["findProfile"]>>;

export class OutputProfileService {
  constructor(private readonly repository: OutputRepository) {}

  list(publicBaseUrl: string) {
    return this.repository
      .listProfiles()
      .map((profile) => this.toResponse(profile, publicBaseUrl));
  }

  create(input: unknown, publicBaseUrl: string) {
    const data = createOutputProfileSchema.parse(input);
    this.validateOptions(data.options);
    const now = new Date();
    const profile = {
      id: nanoid(),
      ...data,
      token: nanoid(32),
      createdAt: now,
      updatedAt: now,
    };
    outputProfileSchema.parse({
      ...profile,
      createdAt: now.toISOString(),
      updatedAt: now.toISOString(),
    });
    return this.toResponse(
      this.repository.createProfile({
        id: profile.id,
        name: profile.name,
        targetClient: profile.targetClient,
        enabled: profile.enabled,
        token: profile.token,
        createdAt: now,
        updatedAt: now,
        optionsJson: JSON.stringify(data.options),
      }),
      publicBaseUrl,
    );
  }

  update(id: string, input: unknown, publicBaseUrl: string) {
    const current = this.repository.findProfile(id);
    if (!current) return undefined;
    const data = updateOutputProfileSchema.parse(input);
    const options =
      data.options ??
      outputProfileOptionsSchema.parse(JSON.parse(current.optionsJson));
    if (data.options) this.validateOptions(options);
    outputProfileSchema.parse({
      ...current,
      ...data,
      options,
      createdAt: current.createdAt.toISOString(),
      updatedAt: current.updatedAt.toISOString(),
    });
    const updated = this.repository.updateProfile(id, {
      ...(data.name !== undefined ? { name: data.name } : {}),
      ...(data.enabled !== undefined ? { enabled: data.enabled } : {}),
      ...(data.options !== undefined
        ? { optionsJson: JSON.stringify(options) }
        : {}),
    });
    return updated ? this.toResponse(updated, publicBaseUrl) : undefined;
  }

  delete(id: string) {
    if (!this.repository.findProfile(id)) return false;
    if (this.repository.listProfiles().length <= 1)
      throw new RuleValidationError(
        "至少保留一个输出配置，可以停用最后一个输出。",
      );
    return this.repository.deleteProfile(id);
  }

  rules(id: string) {
    const profile = this.repository.findProfile(id);
    if (!profile) return undefined;
    const options = outputProfileOptionsSchema.parse(
      JSON.parse(profile.optionsJson),
    );
    return (
      options.customRules ??
      this.repository.listRules().map((rule) =>
        userRuleSchema.parse({
          ...rule,
          createdAt: rule.createdAt.toISOString(),
          updatedAt: rule.updatedAt.toISOString(),
        }),
      )
    );
  }

  saveRules(id: string, input: unknown, publicBaseUrl: string) {
    const current = this.repository.findProfile(id);
    if (!current) return undefined;
    const parsed = saveUserRulesSchema.parse(input);
    const previous = new Map(this.rules(id)!.map((rule) => [rule.id, rule]));
    const used = new Set<string>();
    const now = new Date().toISOString();
    const customRules = parsed.rules.map((rule, sortOrder) => {
      const old = rule.id ? previous.get(rule.id) : undefined;
      const ruleId = old && !used.has(old.id) ? old.id : nanoid();
      used.add(ruleId);
      return userRuleSchema.parse({
        ...rule,
        id: ruleId,
        sortOrder,
        createdAt: old?.createdAt ?? now,
        updatedAt: now,
      });
    });
    const options = outputProfileOptionsSchema.parse(
      JSON.parse(current.optionsJson),
    );
    this.update(id, { options: { ...options, customRules } }, publicBaseUrl);
    return customRules;
  }

  private validateOptions(options: OutputProfileOptions) {
    if (options.customRules) {
      validateRuleSet(options.customRules);
      if (
        new Set(options.customRules.map((rule) => rule.id)).size !==
        options.customRules.length
      )
        throw new RuleValidationError("独立规则 ID 不能重复。");
    }
    if (options.sourceIds) {
      const existing = new Set(this.repository.sourceIds());
      if (options.sourceIds.some((id) => !existing.has(id)))
        throw new RuleValidationError("所选订阅源已不存在，请重新选择。");
      if (new Set(options.sourceIds).size !== options.sourceIds.length)
        throw new RuleValidationError("订阅源不能重复。");
    }
  }

  private toResponse(profile: StoredProfile, publicBaseUrl: string) {
    const options = outputProfileOptionsSchema.parse(
      JSON.parse(profile.optionsJson),
    );
    const filename =
      options.subscriptionFilename ??
      (profile.targetClient === "clash" ? "clash.yaml" : "shadowrocket.conf");
    return {
      id: profile.id,
      name: profile.name,
      targetClient: profile.targetClient,
      enabled: profile.enabled,
      options,
      subscriptionUrl: `${publicBaseUrl.replace(/\/$/, "")}/sub/${profile.token}/${encodeURIComponent(filename)}`,
      createdAt: profile.createdAt.toISOString(),
      updatedAt: profile.updatedAt.toISOString(),
    };
  }
}
