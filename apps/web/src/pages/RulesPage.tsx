import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Braces,
  GripVertical,
  Pencil,
  Plus,
  ShieldAlert,
  Trash2,
} from "lucide-react";
import { Fragment, useEffect, useState, type DragEvent } from "react";

import type { UserRule } from "@subscription-converter/shared";

import { ErrorBanner } from "../components/ErrorBanner";
import { RuleModal, type RuleDraftInput } from "../components/RuleModal";
import { PageHeader } from "../components/PageHeader";
import { apiRequest } from "../lib/api";
import type { ManagedOutputProfile } from "../types/output";

const defaultPolicies = ["PROXY", "AUTO", "DIRECT", "REJECT"];

type DropPosition = "before" | "after";
type DropMarker = { targetRuleId: string; position: DropPosition };

export function RulesPage({
  profileId,
  profileName,
  onBack,
}: { profileId?: string; profileName?: string; onBack?: () => void } = {}) {
  const rulesKey = profileId ? ["output", "rules", profileId] : ["rules"];
  const rulesUrl = profileId
    ? `/api/output/profiles/${profileId}/rules`
    : "/api/rules";
  const queryClient = useQueryClient();
  const [showCreate, setShowCreate] = useState(false);
  const [editingRule, setEditingRule] = useState<UserRule>();
  const [draftRules, setDraftRules] = useState<UserRule[]>([]);
  const [isDirty, setIsDirty] = useState(false);
  const [draggedRuleId, setDraggedRuleId] = useState<string | null>(null);
  const [dropMarker, setDropMarker] = useState<DropMarker | null>(null);
  const rules = useQuery({
    queryKey: rulesKey,
    queryFn: () => apiRequest<UserRule[]>(rulesUrl),
  });
  const profiles = useQuery({
    queryKey: ["output", "profiles"],
    queryFn: () => apiRequest<ManagedOutputProfile[]>("/api/output/profiles"),
  });
  const saveRules = useMutation({
    mutationFn: (rulesToSave: UserRule[]) =>
      apiRequest<UserRule[]>(rulesUrl, {
        method: "PUT",
        body: JSON.stringify({
          rules: rulesToSave.map((rule) => ({
            id: rule.id.startsWith("draft-") ? undefined : rule.id,
            ruleType: rule.ruleType,
            noResolve: rule.noResolve ?? false,
            value: rule.value,
            policy: rule.policy,
            enabled: rule.enabled,
            note: rule.note,
          })),
        }),
      }),
    onSuccess: (savedRules) => {
      setDraftRules(savedRules);
      setIsDirty(false);
      setDraggedRuleId(null);
      setDropMarker(null);
      queryClient.setQueryData(rulesKey, savedRules);
      if (profileId)
        void queryClient.invalidateQueries({
          queryKey: ["output", "profiles"],
        });
      void queryClient.invalidateQueries({ queryKey: ["output", "preview"] });
      void queryClient.invalidateQueries({
        queryKey: ["output", "availability"],
      });
    },
  });

  useEffect(() => {
    if (rules.data && !isDirty) {
      setDraftRules(rules.data);
    }
  }, [isDirty, rules.data]);

  const visibleRules = draftRules;
  const clashProfile = profiles.data?.find((profile) =>
    profileId ? profile.id === profileId : profile.id === "default-clash",
  );
  const applicableProfiles = profileId
    ? clashProfile
      ? [clashProfile]
      : []
    : (profiles.data?.filter((profile) => profile.targetClient === "clash") ??
      []);
  const customPolicies = [
    ...new Set(
      applicableProfiles.flatMap((profile) =>
        profile.options.proxyGroups.map((group) => group.name),
      ),
    ),
  ];
  const ruleProviders = [
    ...new Set(
      applicableProfiles.flatMap((profile) =>
        Object.keys(profile.options.ruleProviders),
      ),
    ),
  ].sort((left, right) => left.localeCompare(right));
  const policies = [...new Set([...defaultPolicies, ...customPolicies])];
  const operationError = saveRules.error;

  const replaceDraftRules = (nextRules: UserRule[]) => {
    setDraftRules(normalizeSortOrder(nextRules));
    setIsDirty(true);
    saveRules.reset();
  };

  const upsertDraftRule = (input: RuleDraftInput, rule?: UserRule) => {
    const now = new Date().toISOString();
    if (rule) {
      replaceDraftRules(
        visibleRules.map((item) =>
          item.id === rule.id ? { ...item, ...input, updatedAt: now } : item,
        ),
      );
      setEditingRule(undefined);
      return;
    }

    replaceDraftRules([
      ...visibleRules,
      {
        id: createDraftRuleId(),
        ...input,
        enabled: true,
        sortOrder: visibleRules.length,
        createdAt: now,
        updatedAt: now,
      },
    ]);
    setShowCreate(false);
  };

  const toggleDraftRule = (rule: UserRule) => {
    replaceDraftRules(
      visibleRules.map((item) =>
        item.id === rule.id
          ? {
              ...item,
              enabled: !item.enabled,
              updatedAt: new Date().toISOString(),
            }
          : item,
      ),
    );
  };

  const deleteDraftRule = (rule: UserRule) => {
    if (!window.confirm("确定删除这条规则吗？")) return;
    replaceDraftRules(visibleRules.filter((item) => item.id !== rule.id));
  };

  const resetDraft = () => {
    setDraftRules(rules.data ?? []);
    setIsDirty(false);
    setDraggedRuleId(null);
    setDropMarker(null);
    saveRules.reset();
  };

  const saveDraft = () => {
    saveRules.mutate(normalizeSortOrder(visibleRules));
  };

  const dropRule = (targetRuleId: string, position: DropPosition) => {
    if (!draggedRuleId || draggedRuleId === targetRuleId) return;
    const draggedRule = visibleRules.find((rule) => rule.id === draggedRuleId);
    if (!draggedRule) return;
    const withoutDragged = visibleRules.filter(
      (rule) => rule.id !== draggedRuleId,
    );
    const targetIndex = withoutDragged.findIndex(
      (rule) => rule.id === targetRuleId,
    );
    if (targetIndex < 0) return;
    const insertIndex = position === "after" ? targetIndex + 1 : targetIndex;
    const nextRules = [...withoutDragged];
    nextRules.splice(insertIndex, 0, draggedRule);
    replaceDraftRules(nextRules);
    setDraggedRuleId(null);
    setDropMarker(null);
  };

  const startDrag = (event: DragEvent<HTMLElement>, rule: UserRule) => {
    setDraggedRuleId(rule.id);
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("text/plain", rule.id);
  };

  const updateDropMarker = (
    event: DragEvent<HTMLElement>,
    targetRuleId: string,
  ) => {
    event.preventDefault();
    if (!draggedRuleId || draggedRuleId === targetRuleId) return;
    event.dataTransfer.dropEffect = "move";
    setDropMarker({
      targetRuleId,
      position: getDropPosition(event),
    });
  };

  const renderDropPlaceholder = (
    targetRuleId: string,
    position: DropPosition,
  ) => {
    if (
      !draggedRuleId ||
      draggedRuleId === targetRuleId ||
      dropMarker?.targetRuleId !== targetRuleId ||
      dropMarker.position !== position
    ) {
      return null;
    }
    return (
      <div
        aria-hidden="true"
        className="rule-drop-placeholder"
        onDragOver={(event) => {
          event.preventDefault();
          event.dataTransfer.dropEffect = "move";
          setDropMarker({ targetRuleId, position });
        }}
        onDrop={(event) => {
          event.preventDefault();
          dropRule(targetRuleId, position);
        }}
      >
        松开后移动到这里
      </div>
    );
  };

  return (
    <div className="page">
      <PageHeader
        title={profileName ? `${profileName}的规则` : "规则编辑"}
        description={
          profileName
            ? "只影响当前输出，保存后生效。"
            : "全局规则供选择“使用全局规则”的输出共用。"
        }
        actions={
          <>
            {onBack && (
              <button
                className="secondary-button"
                onClick={() => {
                  if (
                    !isDirty ||
                    window.confirm("独立规则尚未保存，确定返回吗？")
                  )
                    onBack();
                }}
              >
                返回输出
              </button>
            )}
            <button
              type="button"
              className="secondary-button"
              disabled={!isDirty || saveRules.isPending}
              onClick={resetDraft}
            >
              放弃更改
            </button>
            <button
              type="button"
              className="primary-button"
              disabled={!isDirty || saveRules.isPending || rules.isPending}
              onClick={saveDraft}
            >
              {saveRules.isPending ? "正在保存..." : "保存规则"}
            </button>
            <button
              type="button"
              className="primary-button"
              onClick={() => setShowCreate(true)}
            >
              <Plus size={17} />
              新增规则
            </button>
          </>
        }
      />
      <div className="info-banner">
        <ShieldAlert size={19} />
        <div>
          <strong>MATCH 是最终兜底</strong>
          <span>
            只能启用一条 MATCH，并且必须排在所有启用规则之后；保存时会统一校验。
          </span>
        </div>
      </div>
      <ErrorBanner error={rules.error ?? profiles.error ?? operationError} />
      <section className="panel table-panel">
        <div className="table-toolbar">
          <div>
            <strong>{visibleRules.length} 条规则</strong>
            <span>
              {isDirty
                ? "有未保存更改，点击“保存规则”后才会生效"
                : customPolicies.length > 0
                  ? `可分流到 ${customPolicies.join("、")}`
                  : "输出时自动忽略已禁用项目"}
            </span>
          </div>
        </div>
        {rules.isPending ? (
          <div className="list-empty">正在读取规则...</div>
        ) : visibleRules.length ? (
          <div className="rules-list">
            {visibleRules.map((rule, index) => (
              <Fragment key={rule.id}>
                {renderDropPlaceholder(rule.id, "before")}
                <article
                  className={`rule-row ${
                    draggedRuleId === rule.id ? "dragging" : ""
                  }`}
                  draggable={!saveRules.isPending}
                  onDragEnd={() => {
                    setDraggedRuleId(null);
                    setDropMarker(null);
                  }}
                  onDragOver={(event) => updateDropMarker(event, rule.id)}
                  onDragStart={(event) => startDrag(event, rule)}
                  onDrop={(event) => {
                    event.preventDefault();
                    const position =
                      dropMarker?.targetRuleId === rule.id
                        ? dropMarker.position
                        : getDropPosition(event);
                    dropRule(rule.id, position);
                  }}
                >
                  <div className="rule-order">
                    <span className="rule-drag-handle" aria-hidden="true">
                      <GripVertical size={15} />
                    </span>
                    <span>{String(index + 1).padStart(2, "0")}</span>
                  </div>
                  <span className="rule-type">{rule.ruleType}</span>
                  <div className="rule-value">
                    <strong>{rule.value ?? "所有剩余流量"}</strong>
                    <small>
                      {rule.noResolve ? "不触发 DNS 解析 · " : ""}
                      {rule.note || "无备注"}
                    </small>
                  </div>
                  <span className={`policy-chip ${rule.policy.toLowerCase()}`}>
                    {rule.policy}
                  </span>
                  <div className="row-actions">
                    <button
                      type="button"
                      className="icon-action"
                      aria-label={`编辑 ${rule.ruleType} ${
                        rule.value ?? rule.policy
                      }`}
                      onClick={() => setEditingRule(rule)}
                    >
                      <Pencil size={15} />
                    </button>
                    <button
                      type="button"
                      className={`toggle ${rule.enabled ? "on" : ""}`}
                      aria-label={`${rule.enabled ? "禁用" : "启用"} ${
                        rule.ruleType
                      } ${rule.value ?? rule.policy}`}
                      onClick={() => toggleDraftRule(rule)}
                    >
                      <span />
                    </button>
                    <button
                      type="button"
                      className="icon-action danger"
                      aria-label={`删除 ${rule.ruleType} ${
                        rule.value ?? rule.policy
                      }`}
                      onClick={() => deleteDraftRule(rule)}
                    >
                      <Trash2 size={16} />
                    </button>
                  </div>
                </article>
                {renderDropPlaceholder(rule.id, "after")}
              </Fragment>
            ))}
          </div>
        ) : (
          <div className="list-empty">
            <span className="empty-illustration">
              <Braces size={25} />
            </span>
            <strong>还没有自定义规则</strong>
            <p>添加域名、CIDR、GEOIP 或 MATCH 规则来控制最终输出。</p>
          </div>
        )}
      </section>
      {showCreate && (
        <RuleModal
          policies={policies}
          ruleProviders={ruleProviders}
          onClose={() => setShowCreate(false)}
          onSave={(input) => upsertDraftRule(input)}
        />
      )}
      {editingRule && (
        <RuleModal
          policies={policies}
          ruleProviders={ruleProviders}
          rule={editingRule}
          onClose={() => setEditingRule(undefined)}
          onSave={(input) => upsertDraftRule(input, editingRule)}
        />
      )}
    </div>
  );
}

function normalizeSortOrder(rules: UserRule[]) {
  return rules.map((rule, sortOrder) => ({ ...rule, sortOrder }));
}

function createDraftRuleId() {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return `draft-${crypto.randomUUID()}`;
  }
  return `draft-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function getDropPosition(event: DragEvent<HTMLElement>): DropPosition {
  const rect = event.currentTarget.getBoundingClientRect();
  return event.clientY < rect.top + rect.height / 2 ? "before" : "after";
}
