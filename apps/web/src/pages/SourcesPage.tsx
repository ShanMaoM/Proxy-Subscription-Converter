import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertTriangle,
  CheckCircle2,
  FileUp,
  Link2,
  Plus,
  RefreshCw,
  Trash2,
  X,
} from "lucide-react";
import { useState, type FormEvent } from "react";

import type { SubscriptionSource } from "@subscription-converter/shared";

import { ErrorBanner } from "../components/ErrorBanner";
import { Modal } from "../components/Modal";
import { PageHeader } from "../components/PageHeader";
import { apiRequest } from "../lib/api";

type SourceType = "remote_url" | "pasted_yaml" | "uploaded_yaml";

const sourceTypeLabels: Record<SourceType, string> = {
  remote_url: "远程链接",
  pasted_yaml: "粘贴 YAML",
  uploaded_yaml: "上传 YAML",
};

const refreshIntervalOptions = [
  { value: "", label: "关闭" },
  { value: "15", label: "每 15 分钟" },
  { value: "60", label: "每小时" },
  { value: "360", label: "每 6 小时" },
  { value: "720", label: "每 12 小时" },
  { value: "1440", label: "每天" },
] as const;

export function SourcesPage() {
  const queryClient = useQueryClient();
  const [showCreate, setShowCreate] = useState(false);
  const sources = useQuery({
    queryKey: ["sources"],
    queryFn: () => apiRequest<SubscriptionSource[]>("/api/sources"),
  });
  const invalidate = () =>
    queryClient.invalidateQueries({ queryKey: ["sources"] });
  void queryClient.invalidateQueries({ queryKey: ["output", "availability"] });
  void queryClient.invalidateQueries({ queryKey: ["output", "preview"] });
  const toggle = useMutation({
    mutationFn: (source: SubscriptionSource) =>
      apiRequest<SubscriptionSource>(`/api/sources/${source.id}`, {
        method: "PATCH",
        body: JSON.stringify({ enabled: !source.enabled }),
      }),
    onSuccess: invalidate,
  });
  const refresh = useMutation({
    mutationFn: (source: SubscriptionSource) =>
      apiRequest(`/api/sources/${source.id}/refresh`, { method: "POST" }),
    onSuccess: invalidate,
  });
  const updateSchedule = useMutation({
    mutationFn: ({
      source,
      refreshIntervalMinutes,
    }: {
      source: SubscriptionSource;
      refreshIntervalMinutes: number | null;
    }) =>
      apiRequest<SubscriptionSource>(`/api/sources/${source.id}`, {
        method: "PATCH",
        body: JSON.stringify({ refreshIntervalMinutes }),
      }),
    onSuccess: invalidate,
  });
  const remove = useMutation({
    mutationFn: (source: SubscriptionSource) =>
      apiRequest<void>(`/api/sources/${source.id}`, { method: "DELETE" }),
    onSuccess: invalidate,
  });

  return (
    <div className="page">
      <PageHeader
        title="订阅源"
        description="集中管理远程订阅、上传文件和粘贴配置。"
        actions={
          <button
            type="button"
            className="primary-button"
            onClick={() => setShowCreate(true)}
          >
            <Plus size={17} />
            新增订阅源
          </button>
        }
      />
      <ErrorBanner
        error={
          sources.error ??
          toggle.error ??
          refresh.error ??
          updateSchedule.error ??
          remove.error
        }
      />
      <section className="panel table-panel">
        <div className="table-toolbar">
          <div>
            <strong>{sources.data?.length ?? 0} 个来源</strong>
            <span>远程 URL 仅显示脱敏版本</span>
          </div>
          <button
            type="button"
            className="secondary-button"
            onClick={() => sources.refetch()}
          >
            <RefreshCw size={16} />
            重新载入
          </button>
        </div>
        {sources.isPending ? (
          <div className="list-empty">正在读取订阅源...</div>
        ) : sources.data?.length ? (
          <div className="data-table">
            <div className="data-row data-header">
              <span>来源</span>
              <span>状态</span>
              <span>节点</span>
              <span>最近刷新</span>
              <span>自动更新</span>
              <span>流量/到期</span>
              <span>操作</span>
            </div>
            {sources.data.map((source) => (
              <div className="data-row" key={source.id}>
                <div className="source-main" data-label="来源">
                  <span
                    className={`source-type-icon ${
                      source.type === "remote_url" ? "remote" : "file"
                    }`}
                  >
                    {source.type === "remote_url" ? (
                      <Link2 size={17} />
                    ) : (
                      <FileUp size={17} />
                    )}
                  </span>
                  <div>
                    <strong>{source.name}</strong>
                    <small>
                      {source.urlMasked ?? sourceTypeLabels[source.type]}
                    </small>
                  </div>
                </div>
                <div data-label="状态">
                  <span
                    className={`status-badge ${source.lastFetchStatus}`}
                    title={source.lastError ?? undefined}
                  >
                    {source.lastFetchStatus === "success" ? (
                      <CheckCircle2 size={13} />
                    ) : source.lastFetchStatus === "failed" ? (
                      <AlertTriangle size={13} />
                    ) : null}
                    {source.lastFetchStatus === "success"
                      ? "正常"
                      : source.lastFetchStatus === "failed"
                        ? "失败"
                        : "未刷新"}
                  </span>
                  {source.lastError && (
                    <small className="row-error">{source.lastError}</small>
                  )}
                </div>
                <span data-label="节点">
                  {source.proxiesCount === null ? "—" : source.proxiesCount}
                </span>
                <span data-label="最近刷新" className="muted-cell">
                  {source.lastFetchedAt
                    ? formatDate(source.lastFetchedAt)
                    : "尚未刷新"}
                </span>
                <div className="refresh-schedule" data-label="自动更新">
                  {source.type === "remote_url" ? (
                    <>
                      <select
                        aria-label={`自动更新 ${source.name}`}
                        value={source.refreshIntervalMinutes ?? ""}
                        disabled={updateSchedule.isPending}
                        onChange={(event) =>
                          updateSchedule.mutate({
                            source,
                            refreshIntervalMinutes: event.target.value
                              ? Number(event.target.value)
                              : null,
                          })
                        }
                      >
                        {refreshIntervalOptions.map((option) => (
                          <option value={option.value} key={option.value}>
                            {option.label}
                          </option>
                        ))}
                      </select>
                      {source.nextRefreshAt && (
                        <small>下次 {formatDate(source.nextRefreshAt)}</small>
                      )}
                    </>
                  ) : (
                    <span className="muted-cell">不适用</span>
                  )}
                </div>
                <div className="traffic-info" data-label="流量/到期">
                  <TrafficSummary source={source} />
                </div>
                <div className="row-actions" data-label="操作">
                  {source.type === "remote_url" && (
                    <button
                      type="button"
                      className="icon-action"
                      title="刷新"
                      aria-label={`刷新 ${source.name}`}
                      disabled={refresh.isPending}
                      onClick={() => refresh.mutate(source)}
                    >
                      <RefreshCw size={16} />
                    </button>
                  )}
                  <button
                    type="button"
                    className={`toggle ${source.enabled ? "on" : ""}`}
                    aria-label={`${source.enabled ? "禁用" : "启用"} ${
                      source.name
                    }`}
                    onClick={() => toggle.mutate(source)}
                  >
                    <span />
                  </button>
                  <button
                    type="button"
                    className="icon-action danger"
                    title="删除"
                    aria-label={`删除 ${source.name}`}
                    onClick={() => {
                      if (window.confirm(`确定删除“${source.name}”吗？`)) {
                        remove.mutate(source);
                      }
                    }}
                  >
                    <Trash2 size={16} />
                  </button>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="list-empty">
            <DatabaseEmpty />
            <strong>还没有订阅源</strong>
            <p>添加远程链接、粘贴 YAML，或从本地上传配置文件。</p>
          </div>
        )}
      </section>
      {showCreate && (
        <CreateSourceModal
          onClose={() => setShowCreate(false)}
          onCreated={() => {
            setShowCreate(false);
            void invalidate();
          }}
        />
      )}
    </div>
  );
}

function CreateSourceModal({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: () => void;
}) {
  const [type, setType] = useState<SourceType>("remote_url");
  const [name, setName] = useState("");
  const [url, setUrl] = useState("");
  const [rawContent, setRawContent] = useState("");
  const [note, setNote] = useState("");
  const [refreshIntervalMinutes, setRefreshIntervalMinutes] = useState("360");
  const create = useMutation({
    mutationFn: () =>
      apiRequest<SubscriptionSource>("/api/sources", {
        method: "POST",
        body: JSON.stringify({
          name,
          type,
          enabled: true,
          note: note || null,
          ...(type === "remote_url" ? { url } : { rawContent }),
          refreshIntervalMinutes:
            type === "remote_url" && refreshIntervalMinutes
              ? Number(refreshIntervalMinutes)
              : null,
        }),
      }),
    onSuccess: onCreated,
  });

  const submit = (event: FormEvent) => {
    event.preventDefault();
    create.mutate();
  };

  return (
    <Modal label="新增订阅源" onClose={onClose}>
      <div className="modal-header">
        <div>
          <h2>新增订阅源</h2>
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
        <ErrorBanner error={create.error} />
        <div className="segmented-control">
          {(Object.keys(sourceTypeLabels) as SourceType[]).map((item) => (
            <button
              type="button"
              key={item}
              className={type === item ? "active" : ""}
              onClick={() => {
                setType(item);
                setRawContent("");
              }}
            >
              {sourceTypeLabels[item]}
            </button>
          ))}
        </div>
        <label>
          <span>名称</span>
          <input
            value={name}
            placeholder="例如：主力订阅"
            onChange={(event) => setName(event.target.value)}
            required
          />
        </label>
        {type === "remote_url" ? (
          <>
            <label>
              <span>订阅 URL</span>
              <input
                type="url"
                value={url}
                placeholder="https://example.com/sub/token"
                onChange={(event) => setUrl(event.target.value)}
                required
              />
            </label>
            <label>
              <span>自动更新</span>
              <select
                aria-label="自动更新周期"
                value={refreshIntervalMinutes}
                onChange={(event) =>
                  setRefreshIntervalMinutes(event.target.value)
                }
              >
                {refreshIntervalOptions.map((option) => (
                  <option value={option.value} key={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
          </>
        ) : type === "pasted_yaml" ? (
          <label>
            <span>YAML 内容</span>
            <textarea
              value={rawContent}
              placeholder="proxies: ..."
              onChange={(event) => setRawContent(event.target.value)}
              required
            />
          </label>
        ) : (
          <label className="file-drop">
            <FileUp size={24} />
            <strong>
              {rawContent ? "文件已读取" : "选择 Clash/Mihomo YAML 文件"}
            </strong>
            <span>文件只在浏览器中读取文本后上传</span>
            <input
              type="file"
              accept=".yaml,.yml,text/yaml,application/yaml"
              onChange={async (event) => {
                const file = event.target.files?.[0];
                if (file) {
                  setRawContent(await file.text());
                  if (!name) setName(file.name.replace(/\.ya?ml$/i, ""));
                }
              }}
              required
            />
          </label>
        )}
        <label>
          <span>备注（可选）</span>
          <input
            value={note}
            placeholder="用途、到期时间或来源说明"
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
              create.isPending ||
              !name ||
              (type === "remote_url" ? !url : !rawContent)
            }
          >
            {create.isPending ? "正在保存..." : "保存订阅源"}
          </button>
        </div>
      </form>
    </Modal>
  );
}

function DatabaseEmpty() {
  return (
    <span className="empty-illustration">
      <Link2 size={25} />
    </span>
  );
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

function formatDay(value: string) {
  return new Intl.DateTimeFormat("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(value));
}

function formatBytes(value: number) {
  const units = ["B", "KB", "MB", "GB", "TB"];
  let size = value;
  let unitIndex = 0;
  while (size >= 1024 && unitIndex < units.length - 1) {
    size /= 1024;
    unitIndex += 1;
  }
  return `${size >= 10 || unitIndex === 0 ? size.toFixed(0) : size.toFixed(1)} ${
    units[unitIndex]
  }`;
}

function TrafficSummary({ source }: { source: SubscriptionSource }) {
  const used =
    source.trafficUpload !== null && source.trafficDownload !== null
      ? source.trafficUpload + source.trafficDownload
      : null;
  const remaining =
    used !== null && source.trafficTotal !== null
      ? Math.max(source.trafficTotal - used, 0)
      : null;

  if (used === null && source.trafficTotal === null && !source.expireAt) {
    return <span className="muted-cell">—</span>;
  }

  return (
    <>
      {used !== null && source.trafficTotal !== null ? (
        <strong>
          已用 {formatBytes(used)} / {formatBytes(source.trafficTotal)}
        </strong>
      ) : source.trafficTotal !== null ? (
        <strong>总额 {formatBytes(source.trafficTotal)}</strong>
      ) : null}
      {remaining !== null && <small>剩余 {formatBytes(remaining)}</small>}
      {source.expireAt && <small>过期 {formatDay(source.expireAt)}</small>}
    </>
  );
}
