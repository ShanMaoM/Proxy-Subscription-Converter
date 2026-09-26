import { BookOpenCheck, Plus, Trash2 } from "lucide-react";
import type { Dispatch, SetStateAction } from "react";

import type { RuleProvider } from "@subscription-converter/shared";

export type EditableRuleProvider = {
  name: string;
  type: RuleProvider["type"];
  behavior: RuleProvider["behavior"];
  interval: string;
  url: string;
  original: RuleProvider;
};

export function toEditableRuleProviders(
  providers: Record<string, RuleProvider>,
): EditableRuleProvider[] {
  return Object.entries(providers).map(([name, provider]) => ({
    name,
    type: provider.type,
    behavior: provider.behavior,
    interval: String(provider.interval),
    url: provider.url ?? "",
    original: provider,
  }));
}

export function toRuleProviderRecord(
  providers: EditableRuleProvider[],
): Record<string, RuleProvider> {
  return Object.fromEntries(
    providers.map(({ name, type, behavior, interval, url, original }) => [
      name.trim(),
      {
        ...original,
        type,
        behavior,
        interval: Number(interval),
        url: url.trim() || undefined,
      },
    ]),
  );
}

export function validateRuleProviders(providers: EditableRuleProvider[]) {
  const names = new Set<string>();
  for (const provider of providers) {
    const name = provider.name.trim();
    if (!name) return "规则集名称不能为空";
    if (!/^[A-Za-z_]+$/.test(name)) {
      return `“${name}”只能包含英文字母和下划线`;
    }
    if (names.has(name)) return "规则集名称不能重复";
    names.add(name);

    if (provider.type === "http" && !provider.url.trim()) {
      return `“${name}”需要填写规则集链接`;
    }
    if (provider.url.trim()) {
      try {
        new URL(provider.url);
      } catch {
        return `“${name}”的规则集链接无效`;
      }
    }

    const interval = Number(provider.interval);
    if (!Number.isInteger(interval) || interval <= 0) {
      return `“${name}”的更新间隔必须是正整数`;
    }
  }
  return undefined;
}

export function RuleProvidersEditor({
  providers,
  setProviders,
}: {
  providers: EditableRuleProvider[];
  setProviders: Dispatch<SetStateAction<EditableRuleProvider[]>>;
}) {
  const updateProvider = (
    index: number,
    changes: Partial<EditableRuleProvider>,
  ) => {
    setProviders((current) =>
      current.map((provider, providerIndex) =>
        providerIndex === index ? { ...provider, ...changes } : provider,
      ),
    );
  };

  return (
    <>
      <div className="group-editor-header">
        <div>
          <strong>规则集管理（Rule Providers）</strong>
          <span>声明 Clash 可下载的规则集，供 RULE-SET 规则直接选择引用。</span>
        </div>
        <button
          type="button"
          className="secondary-button compact-button"
          onClick={() =>
            setProviders((current) => [
              ...current,
              {
                name: "",
                type: "http",
                behavior: "domain",
                url: "",
                interval: "86400",
                original: {
                  type: "http",
                  behavior: "domain",
                  interval: 86_400,
                },
              },
            ])
          }
        >
          <Plus size={15} />
          添加规则集
        </button>
      </div>

      {providers.length === 0 ? (
        <div className="group-editor-empty">
          <BookOpenCheck size={20} />
          <span>尚未声明规则集。</span>
        </div>
      ) : (
        <div className="group-editor-list">
          {providers.map((provider, index) => (
            <article className="group-editor-row rule-provider-row" key={index}>
              <label>
                <span>名称</span>
                <input
                  aria-label={`规则集 ${index + 1} 名称`}
                  value={provider.name}
                  placeholder="例如 gfw_list"
                  onChange={(event) =>
                    updateProvider(index, { name: event.target.value })
                  }
                />
              </label>
              <label>
                <span>行为</span>
                <select
                  aria-label={`规则集 ${index + 1} 行为`}
                  value={provider.behavior}
                  onChange={(event) =>
                    updateProvider(index, {
                      behavior: event.target
                        .value as EditableRuleProvider["behavior"],
                    })
                  }
                >
                  <option value="domain">domain（域名）</option>
                  <option value="ipcidr">ipcidr（IP 网段）</option>
                  <option value="classical">classical（混合）</option>
                </select>
              </label>
              <label className="rule-provider-url-field">
                <span>链接</span>
                <input
                  type="url"
                  aria-label={`规则集 ${index + 1} 链接`}
                  value={provider.url}
                  placeholder="https://example.com/rules.yaml"
                  onChange={(event) =>
                    updateProvider(index, { url: event.target.value })
                  }
                />
              </label>
              <label>
                <span>更新间隔（秒）</span>
                <input
                  type="number"
                  min="1"
                  step="1"
                  aria-label={`规则集 ${index + 1} 更新间隔`}
                  value={provider.interval}
                  onChange={(event) =>
                    updateProvider(index, { interval: event.target.value })
                  }
                />
              </label>
              <button
                type="button"
                className="icon-action danger group-remove"
                aria-label={`删除规则集 ${provider.name || index + 1}`}
                onClick={() =>
                  setProviders((current) =>
                    current.filter(
                      (_, providerIndex) => providerIndex !== index,
                    ),
                  )
                }
              >
                <Trash2 size={16} />
              </button>
            </article>
          ))}
        </div>
      )}
    </>
  );
}
