import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus } from "lucide-react";
import { useState } from "react";
import { ErrorBanner } from "../components/ErrorBanner";
import { PageHeader } from "../components/PageHeader";
import { OutputProfileModal } from "../components/OutputProfileModal";
import { OutputProfileView } from "../components/OutputProfileView";
import { apiRequest } from "../lib/api";
import type { ManagedOutputProfile } from "../types/output";
import { RulesPage } from "./RulesPage";

export function OutputPage({
  initialProfileId,
}: {
  initialProfileId?: string;
}) {
  const client = useQueryClient();
  const [selectedId, setSelectedId] = useState(initialProfileId ?? "");
  const [modal, setModal] = useState<"create" | "rename">();
  const [editingRules, setEditingRules] = useState(false);
  const [dirty, setDirty] = useState(false);
  const confirmLeave = () =>
    !dirty || window.confirm("当前输出有未保存的设置，确定离开吗？");
  const profiles = useQuery({
    queryKey: ["output", "profiles"],
    queryFn: () => apiRequest<ManagedOutputProfile[]>("/api/output/profiles"),
  });
  const selected =
    profiles.data?.find((profile) => profile.id === selectedId) ??
    profiles.data?.find((profile) => profile.id === "default-clash") ??
    profiles.data?.[0];
  const saved = async (profile: ManagedOutputProfile) => {
    await client.invalidateQueries({ queryKey: ["output", "profiles"] });
    setSelectedId(profile.id);
    setModal(undefined);
  };
  if (editingRules && selected)
    return (
      <RulesPage
        key={selected.id}
        profileId={selected.id}
        profileName={selected.name}
        onBack={() => setEditingRules(false)}
      />
    );
  return (
    <div className="page">
      <PageHeader
        title="订阅输出"
        description="每个输出有独立链接，可分别选择来源、规则和策略组。"
        actions={
          <button
            className="primary-button"
            onClick={() => {
              if (confirmLeave()) setModal("create");
            }}
          >
            <Plus size={17} />
            新增输出
          </button>
        }
      />
      <ErrorBanner error={profiles.error} />
      {profiles.isPending ? (
        <div className="panel">正在读取输出配置…</div>
      ) : (
        selected && (
          <>
            <div className="profile-picker">
              <label>
                <span>当前输出</span>
                <select
                  aria-label="当前输出"
                  value={selected.id}
                  onChange={(event) => {
                    if (confirmLeave()) setSelectedId(event.target.value);
                  }}
                >
                  {profiles.data?.map((profile) => (
                    <option key={profile.id} value={profile.id}>
                      {profile.name}
                      {profile.enabled ? "" : "（已停用）"}
                    </option>
                  ))}
                </select>
              </label>
              <span>{profiles.data?.length} 个输出 · 每个链接单独记录访问</span>
            </div>
            <OutputProfileView
              onDirtyChange={setDirty}
              key={selected.id}
              profile={selected}
              canDelete={(profiles.data?.length ?? 0) > 1}
              onRename={() => setModal("rename")}
              onDeleted={() => setSelectedId("")}
              onEditRules={() => setEditingRules(true)}
            />
          </>
        )
      )}
      {modal && (
        <OutputProfileModal
          profile={modal === "rename" ? selected : undefined}
          onClose={() => setModal(undefined)}
          onSaved={(profile) => void saved(profile)}
        />
      )}
    </div>
  );
}
