import { useMutation } from "@tanstack/react-query";
import { useState } from "react";
import { X } from "lucide-react";
import { apiRequest } from "../lib/api";
import type { ManagedOutputProfile } from "../types/output";
import { ErrorBanner } from "./ErrorBanner";
import { Modal } from "./Modal";

export function OutputProfileModal({
  profile,
  onClose,
  onSaved,
}: {
  profile?: ManagedOutputProfile;
  onClose: () => void;
  onSaved: (profile: ManagedOutputProfile) => void;
}) {
  const [name, setName] = useState(profile?.name ?? "");
  const [format, setFormat] = useState("yaml");
  const save = useMutation({
    mutationFn: () =>
      apiRequest<ManagedOutputProfile>(
        profile ? `/api/output/profiles/${profile.id}` : "/api/output/profiles",
        {
          method: profile ? "PATCH" : "POST",
          body: JSON.stringify(
            profile
              ? { name }
              : {
                  name,
                  targetClient: format === "conf" ? "shadowrocket" : "clash",
                  options: {
                    subscriptionFilename:
                      format === "conf"
                        ? "shadowrocket.conf"
                        : format === "txt"
                          ? "nodes.txt"
                          : "clash.yaml",
                  },
                },
          ),
        },
      ),
    onSuccess: onSaved,
  });
  return (
    <Modal label={profile ? "修改输出名称" : "新增输出"} onClose={onClose}>
      <div className="modal-header">
        <h2>{profile ? "修改输出名称" : "新增输出"}</h2>
        <button className="icon-action" aria-label="关闭" onClick={onClose}>
          <X size={18} />
        </button>
      </div>
      <form
        className="form-stack"
        onSubmit={(event) => {
          event.preventDefault();
          save.mutate();
        }}
      >
        <ErrorBanner error={save.error} />
        <label>
          <span>输出名称</span>
          <input
            value={name}
            maxLength={120}
            placeholder="例如：手机、电脑、备用"
            onChange={(event) => setName(event.target.value)}
            required
          />
        </label>
        {!profile && (
          <label>
            <span>输出格式</span>
            <select
              value={format}
              onChange={(event) => setFormat(event.target.value)}
            >
              <option value="yaml">Clash / Mihomo YAML</option>
              <option value="txt">Base64 节点订阅</option>
              <option value="conf">Shadowrocket（实验性）</option>
            </select>
          </label>
        )}
        <div className="modal-actions">
          <button type="button" className="secondary-button" onClick={onClose}>
            取消
          </button>
          <button
            className="primary-button"
            disabled={!name.trim() || save.isPending}
          >
            {save.isPending ? "保存中…" : profile ? "保存名称" : "创建输出"}
          </button>
        </div>
      </form>
    </Modal>
  );
}
