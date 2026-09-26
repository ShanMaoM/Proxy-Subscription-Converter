import { useIsMutating, useMutation, useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import type {
  SubscriptionSource,
  UserRule,
} from "@subscription-converter/shared";
import type { ManagedOutputProfile } from "../types/output";
import { apiRequest } from "../lib/api";
import { ErrorBanner } from "./ErrorBanner";

export function OutputScopePanel({
  profile,
  onSaved,
  onEditRules,
  onDirtyChange,
}: {
  profile: ManagedOutputProfile;
  onSaved: (profile: ManagedOutputProfile) => void;
  onEditRules: () => void;
  onDirtyChange: (dirty: boolean) => void;
}) {
  const isSaving =
    useIsMutating({ mutationKey: ["output", "save", profile.id] }) > 0;
  const sources = useQuery({
    queryKey: ["sources"],
    queryFn: () => apiRequest<SubscriptionSource[]>("/api/sources"),
  });
  const rules = useQuery({
    queryKey: ["rules"],
    queryFn: () => apiRequest<UserRule[]>("/api/rules"),
  });
  const [sourceIds, setSourceIds] = useState<string[] | null>(
    profile.options.sourceIds ?? null,
  );
  const [globalRules, setGlobalRules] = useState(
    profile.options.customRules == null,
  );
  const [filename, setFilename] = useState(
    profile.options.subscriptionFilename ?? "shadowrocket.conf",
  );
  const [includeKeywords, setIncludeKeywords] = useState(
    (profile.options.nodeFilter?.includeKeywords ?? []).join(", "),
  );
  const [excludeKeywords, setExcludeKeywords] = useState(
    (profile.options.nodeFilter?.excludeKeywords ?? []).join(", "),
  );
  const [protocols, setProtocols] = useState(
    profile.options.nodeFilter?.protocols?.join(", ") ?? "",
  );
  const [restrictProtocols, setRestrictProtocols] = useState(
    profile.options.nodeFilter?.protocols != null,
  );
  const split = (value: string) => [
    ...new Set(
      value
        .split(/[,，\n]/)
        .map((item) => item.trim())
        .filter(Boolean),
    ),
  ];
  const nodeFilter = {
    includeKeywords: split(includeKeywords),
    excludeKeywords: split(excludeKeywords),
    protocols: restrictProtocols
      ? split(protocols).map((value) => value.toLowerCase())
      : null,
  };
  const filterChanged =
    JSON.stringify(nodeFilter) !==
    JSON.stringify(
      profile.options.nodeFilter ?? {
        includeKeywords: [],
        excludeKeywords: [],
        protocols: null,
      },
    );
  const changed =
    filterChanged ||
    JSON.stringify(sourceIds) !==
      JSON.stringify(profile.options.sourceIds ?? null) ||
    globalRules !== (profile.options.customRules == null) ||
    (profile.targetClient === "shadowrocket" &&
      filename !==
        (profile.options.subscriptionFilename ?? "shadowrocket.conf"));
  useEffect(() => {
    onDirtyChange(changed);
    return () => onDirtyChange(false);
  }, [changed, onDirtyChange]);
  const save = useMutation({
    mutationKey: ["output", "save", profile.id],
    mutationFn: () =>
      apiRequest<ManagedOutputProfile>(`/api/output/profiles/${profile.id}`, {
        method: "PATCH",
        body: JSON.stringify({
          options: {
            ...profile.options,
            sourceIds,
            nodeFilter,
            ...(profile.targetClient === "clash"
              ? {
                  customRules: globalRules
                    ? null
                    : (profile.options.customRules ?? rules.data ?? []),
                }
              : { subscriptionFilename: filename }),
          },
        }),
      }),
    onSuccess: onSaved,
  });
  const missingIds =
    sourceIds?.filter(
      (id) => !sources.data?.some((source) => source.id === id),
    ) ?? [];
  return (
    <section className="panel scope-panel">
      <div className="settings-heading">
        <div>
          <h2>使用范围</h2>
          <p>只影响当前输出。停用的来源不会参与生成。</p>
        </div>
        <button
          className="primary-button"
          disabled={
            !changed ||
            isSaving ||
            sources.isPending ||
            (profile.targetClient === "clash" && !globalRules && !rules.data)
          }
          onClick={() => save.mutate()}
        >
          {save.isPending ? "保存中…" : "保存使用范围"}
        </button>
      </div>
      <ErrorBanner error={save.error ?? sources.error ?? rules.error} />
      <div className="scope-content">
        <label>
          <span>订阅来源</span>
          <select
            aria-label="订阅来源"
            value={sourceIds === null ? "all" : "selected"}
            onChange={(event) =>
              setSourceIds(
                event.target.value === "all"
                  ? null
                  : (sources.data
                      ?.filter((source) => source.enabled)
                      .map((source) => source.id) ?? []),
              )
            }
          >
            <option value="all">所有已启用来源（包含以后新增的来源）</option>
            <option value="selected">指定来源</option>
          </select>
        </label>
        {sourceIds !== null && (
          <div className="source-checklist">
            {sources.data?.map((source) => (
              <label key={source.id}>
                <input
                  type="checkbox"
                  checked={sourceIds.includes(source.id)}
                  onChange={(event) =>
                    setSourceIds(
                      event.target.checked
                        ? [...sourceIds, source.id]
                        : sourceIds.filter((id) => id !== source.id),
                    )
                  }
                />
                <span>
                  {source.name}
                  {source.enabled ? "" : "（已停用）"}
                </span>
              </label>
            ))}
            {missingIds.map((id) => (
              <label key={id}>
                <input
                  type="checkbox"
                  checked
                  onChange={() =>
                    setSourceIds(sourceIds.filter((item) => item !== id))
                  }
                />
                <span>已删除的来源（取消勾选后保存）</span>
              </label>
            ))}
            {!sourceIds.length && <p>未选择来源，将生成空节点配置。</p>}
          </div>
        )}
        <div className="node-filter-editor">
          <div>
            <h3>节点筛选</h3>
            <p className="field-help">
              按节点名称和协议筛选，仅影响当前输出。名称包含任一保留词即入选，排除词优先；不区分大小写。
            </p>
          </div>
          <div className="form-grid">
            <label>
              <span>保留名称关键词</span>
              <input
                aria-label="保留名称关键词"
                value={includeKeywords}
                placeholder="香港, HK, 日本, JP"
                onChange={(event) => setIncludeKeywords(event.target.value)}
              />
              <small>
                逗号分隔，留空保留全部名称。地区通过名称关键词匹配。
              </small>
            </label>
            <label>
              <span>排除名称关键词</span>
              <input
                aria-label="排除名称关键词"
                value={excludeKeywords}
                placeholder="到期, 剩余流量, 测试"
                onChange={(event) => setExcludeKeywords(event.target.value)}
              />
              <small>命中任意排除词的节点不会进入订阅。</small>
            </label>
          </div>
          <div className="form-grid">
            <label>
              <span>节点协议</span>
              <select
                aria-label="节点协议"
                value={restrictProtocols ? "selected" : "all"}
                onChange={(event) =>
                  setRestrictProtocols(event.target.value === "selected")
                }
              >
                <option value="all">所有协议</option>
                <option value="selected">指定协议</option>
              </select>
            </label>
            {restrictProtocols && (
              <label>
                <span>保留协议</span>
                <input
                  aria-label="保留协议"
                  value={protocols}
                  placeholder="ss, vmess, vless, trojan, hysteria2"
                  onChange={(event) => setProtocols(event.target.value)}
                />
                <small>逗号分隔；留空不会输出任何节点。</small>
              </label>
            )}
          </div>
          {filterChanged && (
            <p className="field-help">
              保存使用范围后，预览和可用性检查会更新筛选结果。
            </p>
          )}
        </div>
        {profile.targetClient === "clash" ? (
          <div className="profile-rule-scope">
            <label>
              <span>自定义规则</span>
              <select
                aria-label="自定义规则"
                value={globalRules ? "global" : "custom"}
                onChange={(event) =>
                  setGlobalRules(event.target.value === "global")
                }
              >
                <option value="global">使用全局规则</option>
                <option value="custom">使用独立规则</option>
              </select>
            </label>
            <p>
              {globalRules
                ? "跟随“规则编辑”页的更新。"
                : "首次保存时复制全局规则，之后独立编辑。规则与策略组仅用于 YAML 输出。"}
            </p>
            {!globalRules && (
              <button
                className="secondary-button"
                disabled={changed || profile.options.customRules == null}
                onClick={onEditRules}
              >
                编辑独立规则
              </button>
            )}
          </div>
        ) : (
          <label>
            <span>订阅文件名</span>
            <input
              value={filename}
              onChange={(event) => setFilename(event.target.value)}
              placeholder="shadowrocket.conf"
            />
          </label>
        )}
      </div>
    </section>
  );
}
