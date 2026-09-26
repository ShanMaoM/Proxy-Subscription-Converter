import { Plus, Route, Save, Settings2, Trash2 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import type {
  OutputProfileOptions,
  ProxyGroup,
} from "@subscription-converter/shared";

import {
  RuleProvidersEditor,
  toEditableRuleProviders,
  toRuleProviderRecord,
  validateRuleProviders,
  type EditableRuleProvider,
} from "./RuleProvidersEditor";

type EditableGroup = ProxyGroup & { filter: string };

function toEditableGroups(groups: ProxyGroup[]): EditableGroup[] {
  return groups.map((group) => ({
    ...group,
    filter: group.filter ?? "",
  }));
}

function validateGroups(groups: EditableGroup[]) {
  const names = new Set<string>();
  for (const group of groups) {
    if (!group.name.trim()) return "策略组名称不能为空";
    const normalized = group.name.trim().toLocaleLowerCase();
    if (names.has(normalized)) return "策略组名称不能重复";
    names.add(normalized);
    if (group.filter) {
      try {
        new RegExp(group.filter, "i");
      } catch {
        return `“${group.name}”的过滤正则无效`;
      }
    }
  }
  return undefined;
}

function validateSubscriptionFilename(filename: string) {
  if (!filename.trim()) return undefined;
  return /^[^/"\\\r\n]+$/.test(filename)
    ? undefined
    : "订阅文件名不能包含路径分隔符、引号或换行";
}

export function ProfileSettingsPanel({
  isSaving,
  onSave,
  options,
  onDirtyChange,
}: {
  isSaving: boolean;
  onSave: (options: OutputProfileOptions) => void;
  options: OutputProfileOptions;
  onDirtyChange?: (dirty: boolean) => void;
}) {
  const [preserveUpstreamRules, setPreserveUpstreamRules] = useState(
    options.preserveUpstreamRules,
  );
  const [subscriptionFilename, setSubscriptionFilename] = useState(
    options.subscriptionFilename ?? "",
  );
  const [groups, setGroups] = useState<EditableGroup[]>(
    toEditableGroups(options.proxyGroups),
  );
  const [providers, setProviders] = useState<EditableRuleProvider[]>(
    toEditableRuleProviders(options.ruleProviders),
  );
  const [matchPolicy, setMatchPolicy] = useState(options.matchPolicy);

  const validationError = useMemo(
    () =>
      validateSubscriptionFilename(subscriptionFilename) ??
      validateGroups(groups) ??
      validateRuleProviders(providers),
    [groups, providers, subscriptionFilename],
  );
  const changed =
    matchPolicy !== options.matchPolicy ||
    preserveUpstreamRules !== options.preserveUpstreamRules ||
    subscriptionFilename !== (options.subscriptionFilename ?? "") ||
    JSON.stringify(groups) !==
      JSON.stringify(toEditableGroups(options.proxyGroups)) ||
    JSON.stringify(providers) !==
      JSON.stringify(toEditableRuleProviders(options.ruleProviders));
  useEffect(() => {
    onDirtyChange?.(changed);
    return () => onDirtyChange?.(false);
  }, [changed, onDirtyChange]);

  const updateGroup = (index: number, changes: Partial<EditableGroup>) => {
    setGroups((current) =>
      current.map((group, groupIndex) =>
        groupIndex === index ? { ...group, ...changes } : group,
      ),
    );
  };

  return (
    <section className="panel profile-settings-panel">
      <div className="settings-heading">
        <div>
          <span className="section-kicker">
            <Settings2 size={15} />
            输出设置
          </span>
          <h2>规则与策略组</h2>
          <p>保存后应用到预览配置和订阅链接。</p>
        </div>
        <button
          type="button"
          className="primary-button"
          disabled={!changed || Boolean(validationError) || isSaving}
          onClick={() =>
            onSave({
              ...options,
              preserveUpstreamRules,
              matchPolicy,
              subscriptionFilename: subscriptionFilename.trim() || undefined,
              proxyGroups: groups.map((group) => ({
                ...group,
                name: group.name.trim(),
                filter: group.filter.trim() || undefined,
              })),
              ruleProviders: toRuleProviderRecord(providers),
            })
          }
        >
          <Save size={16} />
          {isSaving ? "正在保存" : "保存设置"}
        </button>
      </div>

      <div className="setting-row setting-row-static">
        <div>
          <strong>上游订阅分组已移除</strong>
          <span>
            导入订阅时只提取节点，不复制机场自带的策略组；输出仅包含这里配置的组和
            PROXY/AUTO。
          </span>
        </div>
        <span className="setting-status">只保留节点</span>
      </div>

      <div className="setting-row">
        <div>
          <strong>保留上游规则</strong>
          <span>关闭后只输出本系统配置的规则，最后仍会自动补上 MATCH。</span>
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={preserveUpstreamRules}
          aria-label="保留上游规则"
          className={`toggle ${preserveUpstreamRules ? "on" : ""}`}
          onClick={() => setPreserveUpstreamRules((current) => !current)}
        >
          <span />
        </button>
      </div>

      <div className="setting-row filename-setting-row">
        <div>
          <strong>订阅文件名</strong>
          <span>
            例如 `custom-clash.yaml` 或 `nodes.txt`；.txt 会输出 Base64
            节点订阅。
          </span>
        </div>
        <input
          className="filename-input"
          value={subscriptionFilename}
          placeholder="clash.yaml"
          onChange={(event) => setSubscriptionFilename(event.target.value)}
        />
      </div>

      <div className="setting-row filename-setting-row">
        <div>
          <strong>默认兜底策略</strong>
          <span>没有启用的 MATCH 规则时使用。</span>
        </div>
        <select
          className="filename-input"
          aria-label="默认兜底策略"
          value={matchPolicy}
          onChange={(event) => setMatchPolicy(event.target.value)}
        >
          {[
            ...new Set([
              "PROXY",
              "AUTO",
              "DIRECT",
              "REJECT",
              matchPolicy,
              ...groups.map((group) => group.name),
            ]),
          ].map((policy) => (
            <option key={policy} value={policy}>
              {policy}
            </option>
          ))}
        </select>
      </div>
      <div className="group-editor-header">
        <div>
          <strong>自定义代理策略组</strong>
          <span>使用正则按节点名称筛选，例如 US|United States|美。</span>
        </div>
        <button
          type="button"
          className="secondary-button compact-button"
          onClick={() =>
            setGroups((current) => [
              ...current,
              {
                name: `策略组 ${current.length + 1}`,
                type: "select",
                filter: "",
                proxies: [],
              },
            ])
          }
        >
          <Plus size={15} />
          添加策略组
        </button>
      </div>

      {groups.length === 0 ? (
        <div className="group-editor-empty">
          <Route size={20} />
          <span>尚未配置自定义策略组。</span>
        </div>
      ) : (
        <div className="group-editor-list">
          {groups.map((group, index) => (
            <article className="group-editor-row" key={index}>
              <label>
                <span>名称</span>
                <input
                  aria-label={`策略组 ${index + 1} 名称`}
                  value={group.name}
                  placeholder="例如 OpenAI"
                  onChange={(event) =>
                    updateGroup(index, { name: event.target.value })
                  }
                />
              </label>
              <label>
                <span>类型</span>
                <select
                  aria-label={`策略组 ${index + 1} 类型`}
                  value={group.type}
                  onChange={(event) =>
                    updateGroup(index, {
                      type: event.target.value as ProxyGroup["type"],
                    })
                  }
                >
                  <option value="select">手动选择</option>
                  <option value="url-test">自动测速</option>
                  <option value="fallback">故障转移</option>
                  <option value="load-balance">负载均衡</option>
                </select>
              </label>
              <label className="group-filter-field">
                <span>节点名称过滤正则</span>
                <input
                  aria-label={`策略组 ${index + 1} 过滤正则`}
                  value={group.filter}
                  placeholder="US|United States|美"
                  onChange={(event) =>
                    updateGroup(index, { filter: event.target.value })
                  }
                />
              </label>
              <button
                type="button"
                className="icon-action danger group-remove"
                aria-label={`删除策略组 ${group.name}`}
                onClick={() =>
                  setGroups((current) =>
                    current.filter((_, groupIndex) => groupIndex !== index),
                  )
                }
              >
                <Trash2 size={16} />
              </button>
            </article>
          ))}
        </div>
      )}
      <RuleProvidersEditor providers={providers} setProviders={setProviders} />
      {validationError && (
        <p className="settings-validation-error">{validationError}</p>
      )}
    </section>
  );
}
