import { useQuery } from "@tanstack/react-query";
import { Download, RefreshCw } from "lucide-react";
import { apiRequest } from "../lib/api";
import type { ManagedOutputProfile } from "../types/output";
import { ErrorBanner } from "./ErrorBanner";

type Preview = {
  content: string;
  format: "yaml" | "txt" | "conf";
  summary: {
    inputCount?: number;
    filteredCount?: number;
    finalCount?: number;
    groupCount?: number;
    ruleCount?: number;
    supportedCount?: number;
    skippedCount?: number;
    duplicateCount: number;
  };
  warnings: string[];
};
export function OutputPreview({ profile }: { profile: ManagedOutputProfile }) {
  const preview = useQuery({
    queryKey: ["output", "preview", profile.id],
    queryFn: () =>
      apiRequest<Preview>(`/api/output/profiles/${profile.id}/preview`),
  });
  const download = () => {
    if (!preview.data || preview.isError || preview.isFetching) return;
    const url = URL.createObjectURL(
      new Blob([preview.data.content], { type: "text/plain;charset=utf-8" }),
    );
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = decodeURIComponent(
      new URL(profile.subscriptionUrl).pathname.split("/").at(-1)!,
    );
    anchor.click();
    URL.revokeObjectURL(url);
  };
  const stats =
    preview.data?.format === "yaml"
      ? [
          ["最终节点", preview.data.summary.finalCount],
          ["规则", preview.data.summary.ruleCount],
          ["代理分组", preview.data.summary.groupCount],
        ]
      : [
          ["支持节点", preview.data?.summary.supportedCount],
          ["跳过节点", preview.data?.summary.skippedCount],
          ["重复节点", preview.data?.summary.duplicateCount],
        ];
  return (
    <div className="output-preview">
      <ErrorBanner error={preview.error} />
      {preview.data && !preview.isError && (
        <section className="summary-grid">
          {stats.map(([label, value]) => (
            <article className="summary-card" key={label}>
              <div>
                <small>{label}</small>
                <strong>{value ?? 0}</strong>
              </div>
            </article>
          ))}
        </section>
      )}
      <section className="panel yaml-panel">
        <div className="yaml-toolbar">
          <div>
            <strong>配置预览</strong>
            {preview.data && !preview.isError && (
              <small>
                输入 {preview.data.summary.inputCount ?? 0} 个 · 筛选排除{" "}
                {preview.data.summary.filteredCount ?? 0} 个 · 去重{" "}
                {preview.data.summary.duplicateCount} 个
              </small>
            )}
            <small>
              {preview.data?.format === "yaml"
                ? "Clash / Mihomo YAML"
                : preview.data?.format === "txt"
                  ? "Base64 节点订阅"
                  : "Shadowrocket（实验性）"}
            </small>
          </div>
          <div className="page-actions">
            <button
              className="secondary-button"
              disabled={preview.isFetching}
              onClick={() => void preview.refetch()}
            >
              <RefreshCw size={16} />
              {preview.isFetching ? "正在生成..." : "重新生成"}
            </button>
            <button
              className="secondary-button"
              disabled={!preview.data || preview.isError || preview.isFetching}
              onClick={download}
            >
              <Download size={16} />
              {preview.data?.format === "yaml" ? "下载 YAML" : "下载订阅"}
            </button>
          </div>
        </div>
        {preview.isPending ? (
          <p className="access-empty">正在生成预览…</p>
        ) : (
          preview.data &&
          !preview.isError && (
            <>
              {preview.data.warnings.length > 0 && (
                <div className="warning-list">
                  {preview.data.warnings.map((warning, index) => (
                    <span key={index}>{warning}</span>
                  ))}
                </div>
              )}
              <pre tabIndex={0} aria-label="生成的订阅内容">
                <code>{preview.data.content || "当前没有可输出的节点。"}</code>
              </pre>
            </>
          )
        )}
      </section>
    </div>
  );
}
