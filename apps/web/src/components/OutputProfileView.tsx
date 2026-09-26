import {
  useIsMutating,
  useMutation,
  useQueryClient,
} from "@tanstack/react-query";
import { Check, Copy, RotateCcw } from "lucide-react";
import { useEffect, useState } from "react";
import type { OutputProfileOptions } from "@subscription-converter/shared";
import type { ManagedOutputProfile } from "../types/output";
import { apiRequest } from "../lib/api";
import { ErrorBanner } from "./ErrorBanner";
import { OutputAvailability } from "./OutputAvailability";
import { OutputAccessLogs } from "./OutputAccessLogs";
import { OutputPreview } from "./OutputPreview";
import { OutputScopePanel } from "./OutputScopePanel";
import { ProfileSettingsPanel } from "./ProfileSettingsPanel";

export function OutputProfileView({
  profile,
  canDelete,
  onRename,
  onDeleted,
  onEditRules,
  onDirtyChange,
}: {
  profile: ManagedOutputProfile;
  canDelete: boolean;
  onRename: () => void;
  onDeleted: () => void;
  onEditRules: () => void;
  onDirtyChange: (dirty: boolean) => void;
}) {
  const client = useQueryClient();
  const isSaving =
    useIsMutating({ mutationKey: ["output", "save", profile.id] }) > 0;
  const [scopeDirty, setScopeDirty] = useState(false);
  const [settingsDirty, setSettingsDirty] = useState(false);
  useEffect(() => {
    onDirtyChange(scopeDirty || settingsDirty);
    return () => onDirtyChange(false);
  }, [scopeDirty, settingsDirty, onDirtyChange]);
  const [copied, setCopied] = useState(false);
  const [copyError, setCopyError] = useState<Error>();
  const saved = (next: ManagedOutputProfile) => {
    client.setQueryData<ManagedOutputProfile[]>(
      ["output", "profiles"],
      (current) => current?.map((item) => (item.id === next.id ? next : item)),
    );
    void client.invalidateQueries({ queryKey: ["output", "preview", next.id] });
    void client.invalidateQueries({
      queryKey: ["output", "availability", next.id],
    });
  };
  const update = useMutation({
    mutationKey: ["output", "save", profile.id],
    mutationFn: (changes: {
      options?: OutputProfileOptions;
      enabled?: boolean;
    }) =>
      apiRequest<ManagedOutputProfile>(`/api/output/profiles/${profile.id}`, {
        method: "PATCH",
        body: JSON.stringify(changes),
      }),
    onSuccess: saved,
  });
  const reset = useMutation({
    mutationFn: () =>
      apiRequest<ManagedOutputProfile>(
        `/api/output/${profile.id}/reset-token`,
        { method: "POST" },
      ),
    onSuccess: saved,
  });
  const remove = useMutation({
    mutationFn: () =>
      apiRequest<void>(`/api/output/profiles/${profile.id}`, {
        method: "DELETE",
      }),
    onSuccess: async () => {
      await client.invalidateQueries({ queryKey: ["output", "profiles"] });
      onDeleted();
    },
  });
  const copy = async () => {
    setCopyError(undefined);
    try {
      await navigator.clipboard.writeText(profile.subscriptionUrl);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    } catch {
      setCopyError(new Error("无法访问剪贴板，请选中订阅地址后手动复制。"));
    }
  };
  const scopeKey = JSON.stringify([
    profile.options.sourceIds,
    profile.options.nodeFilter,
    profile.options.customRules,
    profile.targetClient === "shadowrocket"
      ? profile.options.subscriptionFilename
      : null,
  ]);
  return (
    <>
      <ErrorBanner
        error={copyError ?? update.error ?? reset.error ?? remove.error}
      />
      <section className="panel output-link-panel">
        <div className="profile-title-row">
          <h2>{profile.name}</h2>
          <div className="profile-state">
            <span>{profile.enabled ? "已启用" : "已停用"}</span>
            <button
              className={`toggle ${profile.enabled ? "on" : ""}`}
              role="switch"
              aria-checked={profile.enabled}
              aria-label="启用当前输出"
              disabled={isSaving}
              onClick={() => update.mutate({ enabled: !profile.enabled })}
            >
              <span />
            </button>
          </div>
        </div>
        <div className="url-copy-row">
          <code tabIndex={0}>{profile.subscriptionUrl}</code>
          <button className="secondary-button" onClick={copy}>
            {copied ? <Check size={16} /> : <Copy size={16} />}
            {copied ? "已复制" : "复制链接"}
          </button>
        </div>
        {!profile.enabled && (
          <p className="output-paused-note">
            链接已停用。客户端无法获取订阅，仍可在这里调整配置和预览。
          </p>
        )}
        <div className="profile-tools">
          <button className="text-button" onClick={onRename}>
            修改名称
          </button>
          <button
            className="text-button"
            disabled={reset.isPending}
            onClick={() => {
              if (
                window.confirm(
                  "重置后旧链接立即失效，客户端需要更新订阅地址。继续吗？",
                )
              )
                reset.mutate();
            }}
          >
            <RotateCcw size={14} />
            重置公开 token
          </button>
          <button
            className="text-button delete-profile"
            disabled={!canDelete || remove.isPending}
            onClick={() => {
              if (
                window.confirm(
                  `删除“${profile.name}”及其访问记录？订阅链接将立即失效。`,
                )
              )
                remove.mutate();
            }}
          >
            删除输出
          </button>
        </div>
      </section>
      <OutputAvailability profileId={profile.id} />
      <OutputScopePanel
        key={scopeKey}
        profile={profile}
        onSaved={saved}
        onDirtyChange={setScopeDirty}
        onEditRules={() => {
          if (
            !settingsDirty ||
            window.confirm("输出设置尚未保存，确定离开吗？")
          )
            onEditRules();
        }}
      />
      {profile.targetClient === "clash" && (
        <ProfileSettingsPanel
          key={JSON.stringify([
            profile.options.preserveUpstreamRules,
            profile.options.subscriptionFilename,
            profile.options.proxyGroups,
            profile.options.ruleProviders,
            profile.options.matchPolicy,
          ])}
          onDirtyChange={setSettingsDirty}
          options={profile.options}
          isSaving={isSaving}
          onSave={(options) => update.mutate({ options })}
        />
      )}
      <OutputPreview profile={profile} />
      <OutputAccessLogs profileId={profile.id} />
    </>
  );
}
