import { nanoid } from "nanoid";

import {
  createUserRuleSchema,
  saveUserRulesSchema,
  updateUserRuleSchema,
  userRuleSchema,
} from "@subscription-converter/shared";

import { RuleRepository } from "./repository";

type StoredRule = NonNullable<ReturnType<RuleRepository["findById"]>>;

export class RuleValidationError extends Error {
  statusCode = 400;

  constructor(message: string) {
    super(message);
    this.name = "RuleValidationError";
  }
}

export function validateRuleSet(
  candidateRules: Array<{
    ruleType: string;
    enabled: boolean;
    sortOrder: number;
  }>,
) {
  const enabled = candidateRules
    .filter((rule) => rule.enabled)
    .sort((left, right) => left.sortOrder - right.sortOrder);
  const matchRules = enabled.filter((rule) => rule.ruleType === "MATCH");

  if (matchRules.length > 1) {
    throw new RuleValidationError("Only one enabled MATCH rule is allowed");
  }
  if (matchRules.length === 1 && enabled.at(-1)?.ruleType !== "MATCH") {
    throw new RuleValidationError("The enabled MATCH rule must be last");
  }
}

export class RuleService {
  constructor(private readonly repository: RuleRepository) {}

  list() {
    return this.repository.list().map(this.toResponse);
  }

  create(input: unknown) {
    const parsed = createUserRuleSchema.parse(input);
    const now = new Date();
    const candidate = {
      id: nanoid(),
      ...parsed,
      noResolve: parsed.noResolve ?? false,
      sortOrder: this.repository.nextSortOrder(),
      createdAt: now,
      updatedAt: now,
    };
    userRuleSchema.parse(this.toResponse(candidate));
    validateRuleSet([...this.repository.list(), candidate]);
    return this.toResponse(this.repository.create(candidate));
  }

  update(id: string, input: unknown) {
    const current = this.repository.findById(id);
    if (!current) return undefined;
    const parsed = updateUserRuleSchema.parse(input);
    const candidate = { ...current, ...parsed, updatedAt: new Date() };
    const normalized = userRuleSchema.parse(this.toResponse(candidate));
    candidate.value = normalized.value;
    validateRuleSet(
      this.repository.list().map((rule) => (rule.id === id ? candidate : rule)),
    );
    return this.toResponse(this.repository.update(id, candidate)!);
  }

  delete(id: string) {
    return this.repository.delete(id) > 0;
  }

  reorder(ids: string[]) {
    const current = this.repository.list();
    const currentIds = new Set(current.map((rule) => rule.id));
    if (
      ids.length !== current.length ||
      new Set(ids).size !== ids.length ||
      ids.some((id) => !currentIds.has(id))
    ) {
      throw new RuleValidationError(
        "Reorder must include every rule exactly once",
      );
    }
    const candidate = ids.map((id, sortOrder) => ({
      ...current.find((rule) => rule.id === id)!,
      sortOrder,
    }));
    validateRuleSet(candidate);
    return this.repository.reorder(ids).map(this.toResponse);
  }

  replaceAll(input: unknown) {
    const parsed = saveUserRulesSchema.parse(input);
    const currentById = new Map(
      this.repository.list().map((rule) => [rule.id, rule]),
    );
    const usedIds = new Set<string>();
    const now = new Date();
    const candidates = parsed.rules.map((rule, sortOrder) => {
      const existing = rule.id ? currentById.get(rule.id) : undefined;
      const id = existing && !usedIds.has(existing.id) ? existing.id : nanoid();
      usedIds.add(id);
      const candidate = {
        id,
        ruleType: rule.ruleType,
        noResolve: rule.noResolve ?? false,
        value: rule.value,
        policy: rule.policy,
        enabled: rule.enabled,
        sortOrder,
        note: rule.note,
        createdAt: existing?.createdAt ?? now,
        updatedAt: now,
      };
      userRuleSchema.parse(this.toResponse(candidate));
      return candidate;
    });
    validateRuleSet(candidates);
    return this.repository.replaceAll(candidates).map(this.toResponse);
  }

  validate(input: unknown) {
    const candidates = userRuleSchema.array().parse(input);
    validateRuleSet(candidates);
    return { valid: true };
  }

  private toResponse(rule: StoredRule) {
    return {
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
    };
  }
}
