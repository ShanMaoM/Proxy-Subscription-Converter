import { useState, type FormEvent } from "react";
import { X } from "lucide-react";
import {
  ruleDefinitions,
  noResolveRuleTypes,
  normalizeRuleValue,
  ruleValueError,
  type UserRule,
} from "@subscription-converter/shared";
import { Modal } from "./Modal";
export type RuleDraftInput = Pick<
  UserRule,
  "ruleType" | "value" | "policy" | "note" | "noResolve"
>;

export function RuleModal({
  policies,
  ruleProviders,
  rule,
  onClose,
  onSave,
}: {
  policies: string[];
  ruleProviders: string[];
  rule?: UserRule;
  onClose: () => void;
  onSave: (input: RuleDraftInput) => void;
}) {
  const [ruleType, setRuleType] = useState<UserRule["ruleType"]>(
    rule?.ruleType ?? "DOMAIN-SUFFIX",
  );
  const [value, setValue] = useState(rule?.value ?? "");
  const [policy, setPolicy] = useState(rule?.policy ?? "PROXY");
  const [noResolve, setNoResolve] = useState(rule?.noResolve ?? false);
  const [validationError, setValidationError] = useState<string>();
  const definition = ruleDefinitions.find((item) => item[0] === ruleType)!;
  const canSkipDns = noResolveRuleTypes.includes(ruleType);
  const [note, setNote] = useState(rule?.note ?? "");
  const providerOptions =
    value && !ruleProviders.includes(value)
      ? [value, ...ruleProviders]
      : ruleProviders;
  const ruleSetValueIsValid =
    ruleType !== "RULE-SET" || ruleProviders.includes(value);

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const normalized =
      ruleType === "MATCH" ? null : normalizeRuleValue(ruleType, value);
    const error = ruleValueError(ruleType, normalized, canSkipDns && noResolve);
    if (error) {
      setValidationError(error);
      return;
    }
    onSave({
      ruleType,
      value: normalized,
      noResolve: canSkipDns && noResolve,
      policy,
      note: note || null,
    });
  };

  return (
    <Modal label="规则编辑" onClose={onClose}>
      <div className="modal-header">
        <div>
          <h2>{rule ? "编辑规则" : "新增规则"}</h2>
        </div>
        <button
          className="icon-action"
          type="button"
          aria-label="关闭"
          onClick={onClose}
        >
          <X size={18} />
        </button>
      </div>
      <form className="form-stack" onSubmit={submit}>
        <div className="form-grid">
          <label>
            <span>规则类型</span>
            <select
              className="rule-type-select"
              value={ruleType}
              onChange={(event) => {
                const nextType = event.target.value as typeof ruleType;
                setRuleType(nextType);
                setValidationError(undefined);

                if (nextType === "MATCH") {
                  setValue("");
                } else if (nextType === "RULE-SET") {
                  setValue(ruleProviders[0] ?? "");
                } else if (nextType === "NETWORK") {
                  setValue("tcp");
                } else if (ruleType === "RULE-SET" || ruleType === "NETWORK") {
                  setValue("");
                }
              }}
            >
              {[...new Set(ruleDefinitions.map((item) => item[2]))].map(
                (group) => (
                  <optgroup key={group} label={group}>
                    {ruleDefinitions
                      .filter((item) => item[2] === group)
                      .map(([type, label]) => (
                        <option key={type} value={type}>
                          {label} · {type}
                        </option>
                      ))}
                  </optgroup>
                ),
              )}
            </select>
          </label>
          <label>
            <span>策略目标</span>
            <select
              value={policy}
              onChange={(event) => setPolicy(event.target.value)}
            >
              {policies.map((item) => (
                <option key={item} value={item}>
                  {item}
                </option>
              ))}
            </select>
          </label>
        </div>
        {ruleType !== "MATCH" && (
          <label>
            <span>匹配值</span>
            {ruleType === "RULE-SET" ? (
              <select
                value={value}
                onChange={(event) => {
                  setValue(event.target.value);
                  setValidationError(undefined);
                }}
                required
              >
                {ruleProviders.length === 0 && (
                  <option value="" disabled>
                    请先在输出设置中添加规则集
                  </option>
                )}
                {providerOptions.map((provider) => (
                  <option
                    key={provider}
                    value={provider}
                    disabled={!ruleProviders.includes(provider)}
                  >
                    {provider}
                    {!ruleProviders.includes(provider) ? "（当前未配置）" : ""}
                  </option>
                ))}
              </select>
            ) : ruleType === "NETWORK" ? (
              <select
                aria-label="匹配值"
                value={value}
                onChange={(event) => setValue(event.target.value)}
              >
                <option value="tcp">TCP</option>
                <option value="udp">UDP</option>
              </select>
            ) : (
              <input
                value={value}
                placeholder={`例如：${definition[3]}`}
                onChange={(event) => setValue(event.target.value)}
                required
              />
            )}
          </label>
        )}
        <p className="field-help">
          {ruleType.includes("CIDR")
            ? "可填写单个 IP 或网段；单个 IPv4 自动补 /32，IPv6 自动补 /128。来源 IP 指发起连接的设备，目标 IP 指访问的服务器。"
            : ruleType.includes("PORT")
              ? "支持单端口、范围和多项，例如 80/443/8000-9000。"
              : ruleType === "MATCH"
                ? "匹配剩余流量，请将这条规则放在最后。"
                : "按列表顺序匹配，先匹配的规则先执行。扩展类型需要 Mihomo 支持。"}
        </p>
        {canSkipDns && (
          <label className="check-field">
            <input
              type="checkbox"
              checked={noResolve}
              onChange={(event) => setNoResolve(event.target.checked)}
            />
            <span>
              不触发 DNS 解析（no-resolve）
              <small>仅匹配已有 IP 的连接，避免为这条规则额外查询域名。</small>
            </span>
          </label>
        )}
        {validationError && (
          <p className="error-banner" role="alert">
            {validationError}
          </p>
        )}
        <label>
          <span>备注（可选）</span>
          <input
            value={note}
            placeholder="说明这条规则的用途"
            onChange={(event) => setNote(event.target.value)}
          />
        </label>
        <div className="modal-actions">
          <button type="button" className="secondary-button" onClick={onClose}>
            取消
          </button>
          <button
            className="primary-button"
            disabled={
              (ruleType !== "MATCH" && !value.trim()) || !ruleSetValueIsValid
            }
          >
            {rule ? "更新草稿" : "添加到草稿"}
          </button>
        </div>
      </form>
    </Modal>
  );
}
