import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  CheckCircle2,
  Download,
  FileJson,
  History,
  RefreshCw,
  Upload,
} from "lucide-react";
import { useState } from "react";

import { ErrorBanner } from "../components/ErrorBanner";
import { PageHeader } from "../components/PageHeader";
import { apiRequest } from "../lib/api";

type OperationLog = {
  id: string;
  level: "info" | "warn" | "error";
  action: string;
  message: string;
  metadata: unknown;
  createdAt: string;
};

type ConfigurationBackup = {
  version: 1;
  exportedAt: string;
  settings: unknown[];
  sources: unknown[];
  rules: unknown[];
  outputProfiles: unknown[];
};

type RestoreResult = {
  settings: number;
  sources: number;
  rules: number;
  outputProfiles: number;
};

export function SystemPage() {
  const queryClient = useQueryClient();
  const [selectedBackup, setSelectedBackup] = useState<{
    name: string;
    data: unknown;
  }>();
  const [fileError, setFileError] = useState<Error>();
  const logs = useQuery({
    queryKey: ["system", "logs"],
    queryFn: () => apiRequest<OperationLog[]>("/api/system/logs?limit=100"),
  });
  const exportBackup = useMutation({
    mutationFn: () => apiRequest<ConfigurationBackup>("/api/system/backup"),
    onSuccess: (backup) => {
      const date = backup.exportedAt.slice(0, 10);
      const url = URL.createObjectURL(
        new Blob([JSON.stringify(backup, null, 2)], {
          type: "application/json;charset=utf-8",
        }),
      );
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `subscription-converter-backup-${date}.json`;
      anchor.click();
      URL.revokeObjectURL(url);
      void logs.refetch();
    },
  });
  const restoreBackup = useMutation({
    mutationFn: (backup: unknown) =>
      apiRequest<RestoreResult>("/api/system/restore", {
        method: "POST",
        body: JSON.stringify(backup),
      }),
    onSuccess: async () => {
      await queryClient.invalidateQueries();
      setSelectedBackup(undefined);
    },
  });

  const operationError =
    fileError ?? exportBackup.error ?? restoreBackup.error ?? logs.error;

  return (
    <div className="page">
      <PageHeader
        title="系统维护"
        description="导出或恢复配置，并检查最近的管理操作与远程错误。"
      />
      <ErrorBanner error={operationError} fallback="系统维护操作失败" />
      {restoreBackup.data && (
        <div className="alert success page-alert" role="status">
          <CheckCircle2 size={17} />
          <span>
            已恢复 {restoreBackup.data.sources} 个订阅源、
            {restoreBackup.data.rules} 条规则和{" "}
            {restoreBackup.data.outputProfiles} 个输出配置。
          </span>
        </div>
      )}
      <section className="maintenance-grid">
        <article className="panel maintenance-card">
          <span className="maintenance-icon blue">
            <Download size={20} />
          </span>
          <div>
            <h2>导出配置备份</h2>
            <p>
              备份包含订阅源、规则、设置和输出配置，可迁移到使用不同密钥的新部署。
            </p>
          </div>
          <div className="sensitive-note">
            备份包含完整远程 URL 和公开订阅 token，属于敏感文件，请妥善保管。
          </div>
          <button
            type="button"
            className="primary-button"
            disabled={exportBackup.isPending}
            onClick={() => exportBackup.mutate()}
          >
            <Download size={16} />
            {exportBackup.isPending ? "正在导出..." : "下载 JSON 备份"}
          </button>
        </article>
        <article className="panel maintenance-card">
          <span className="maintenance-icon violet">
            <Upload size={20} />
          </span>
          <div>
            <h2>恢复配置备份</h2>
            <p>恢复会替换当前配置并清除订阅访问记录，管理操作日志会保留。</p>
          </div>
          <label className="backup-picker">
            <FileJson size={20} />
            <span>
              <strong>{selectedBackup?.name ?? "选择 JSON 备份"}</strong>
              <small>选择后仍需确认才会恢复</small>
            </span>
            <input
              type="file"
              accept=".json,application/json"
              onChange={async (event) => {
                const file = event.target.files?.[0];
                setFileError(undefined);
                restoreBackup.reset();
                if (!file) {
                  setSelectedBackup(undefined);
                  return;
                }
                try {
                  setSelectedBackup({
                    name: file.name,
                    data: JSON.parse(await file.text()) as unknown,
                  });
                } catch {
                  setSelectedBackup(undefined);
                  setFileError(new Error("所选文件不是有效的 JSON 备份"));
                }
              }}
            />
          </label>
          <button
            type="button"
            className="danger-button"
            disabled={!selectedBackup || restoreBackup.isPending}
            onClick={() => {
              if (
                selectedBackup &&
                window.confirm("恢复会替换当前配置。确认使用所选备份继续吗？")
              ) {
                restoreBackup.mutate(selectedBackup.data);
              }
            }}
          >
            <Upload size={16} />
            {restoreBackup.isPending ? "正在恢复..." : "恢复所选备份"}
          </button>
        </article>
      </section>
      <section className="panel log-panel">
        <div className="table-toolbar">
          <div>
            <strong>操作日志</strong>
            <span>最多显示最近 100 条，敏感字段由服务端统一脱敏</span>
          </div>
          <button
            type="button"
            className="secondary-button"
            onClick={() => logs.refetch()}
          >
            <RefreshCw size={16} />
            重新载入
          </button>
        </div>
        {logs.isPending ? (
          <div className="list-empty">正在读取操作日志...</div>
        ) : logs.data?.length ? (
          <div className="operation-log-list">
            {logs.data.map((entry) => (
              <article className="operation-log-row" key={entry.id}>
                <span className={`log-level ${entry.level}`}>
                  {entry.level}
                </span>
                <div>
                  <strong>{entry.message}</strong>
                  <small>{entry.action}</small>
                </div>
                <time dateTime={entry.createdAt}>
                  {formatDate(entry.createdAt)}
                </time>
              </article>
            ))}
          </div>
        ) : (
          <div className="list-empty">
            <span className="empty-illustration">
              <History size={25} />
            </span>
            <strong>还没有操作日志</strong>
            <p>创建订阅源、修改规则或导出备份后会在这里留下记录。</p>
          </div>
        )}
      </section>
    </div>
  );
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).format(new Date(value));
}
