import { useQuery } from "@tanstack/react-query";
import { ChevronRight } from "lucide-react";
import type {
  SubscriptionSource,
  UserRule,
} from "@subscription-converter/shared";
import type { PageId } from "../components/AppShell";
import { ErrorBanner } from "../components/ErrorBanner";
import { PageHeader } from "../components/PageHeader";
import { apiRequest } from "../lib/api";
import type { ManagedOutputProfile } from "../types/output";

export function DashboardPage({
  onNavigate,
  onOpenOutput,
}: {
  onNavigate: (page: PageId) => void;
  onOpenOutput: (id: string) => void;
}) {
  const sources = useQuery({
    queryKey: ["sources"],
    queryFn: () => apiRequest<SubscriptionSource[]>("/api/sources"),
  });
  const rules = useQuery({
    queryKey: ["rules"],
    queryFn: () => apiRequest<UserRule[]>("/api/rules"),
  });
  const profiles = useQuery({
    queryKey: ["output", "profiles"],
    queryFn: () => apiRequest<ManagedOutputProfile[]>("/api/output/profiles"),
  });
  const health = useQuery({
    queryKey: ["health"],
    queryFn: () => apiRequest<{ status: string }>("/health"),
    refetchInterval: 30_000,
    retry: false,
  });
  const healthy = health.data?.status === "ok" && !health.isError;
  const failed =
    sources.data?.filter((source) => source.lastFetchStatus === "failed")
      .length ?? 0;
  const enabledSources = sources.data?.filter(
    (source) => source.enabled,
  ).length;
  const enabledRules = rules.data?.filter((rule) => rule.enabled).length;
  const error = sources.error ?? rules.error ?? profiles.error;

  return (
    <div className="page dashboard-page">
      <PageHeader
        title="订阅工作台"
        description="查看订阅源、规则和服务状态。"
        actions={
          <button
            className="primary-button"
            onClick={() => onNavigate("sources")}
          >
            管理来源
          </button>
        }
      />
      <ErrorBanner error={error} />
      <section className="metric-grid" aria-label="订阅概览">
        <article className="metric-card">
          <span className="metric-heading">启用的订阅源</span>
          <strong>
            {sources.isError ? "—" : (enabledSources ?? "—")}
            <small>/ {sources.data?.length ?? "—"}</small>
          </strong>
          <span className="metric-caption">
            {sources.isPending
              ? "读取中"
              : sources.isError
                ? "读取失败"
                : failed
                  ? `${failed} 个来源刷新失败`
                  : `共 ${sources.data?.length ?? 0} 个来源`}
          </span>
        </article>
        <article className="metric-card">
          <span className="metric-heading">已启用规则</span>
          <strong>
            {rules.isError ? "—" : (enabledRules ?? "—")}
            <small>条</small>
          </strong>
          <button
            className="text-button metric-link"
            onClick={() => onNavigate("rules")}
          >
            管理规则 <ChevronRight size={14} />
          </button>
        </article>
        <article className="metric-card">
          <span className="metric-heading">服务状态</span>
          <strong className="metric-status">
            {health.isPending ? "连接中" : healthy ? "运行正常" : "连接异常"}
          </strong>
          <span className="metric-caption">
            {health.isError ? "无法连接服务器" : "每 30 秒检查一次"}
          </span>
        </article>
      </section>
      <div className="dashboard-grid">
        <section
          className="panel dashboard-sources"
          aria-labelledby="dashboard-sources-heading"
        >
          <div className="dashboard-section-heading">
            <h2 id="dashboard-sources-heading">来源概况</h2>
            <button
              className="text-button"
              onClick={() => onNavigate("sources")}
            >
              查看全部 <ChevronRight size={14} />
            </button>
          </div>
          {sources.isPending ? (
            <p className="dashboard-empty">正在读取订阅源…</p>
          ) : sources.isError ? (
            <p className="dashboard-empty">读取失败，请稍后重试。</p>
          ) : sources.data?.length ? (
            <ul className="source-overview-list">
              {sources.data.slice(0, 5).map((source) => (
                <li key={source.id}>
                  <div>
                    <strong>{source.name}</strong>
                    <span>
                      {source.type === "remote_url" ? "远程订阅" : "本地配置"}
                      {source.proxiesCount !== null
                        ? ` · ${source.proxiesCount} 个节点`
                        : ""}
                    </span>
                  </div>
                  <span
                    className={`status-badge ${source.enabled ? source.lastFetchStatus : ""}`}
                  >
                    {!source.enabled
                      ? "已停用"
                      : source.lastFetchStatus === "success"
                        ? "正常"
                        : source.lastFetchStatus === "failed"
                          ? "刷新失败"
                          : "未刷新"}
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <div className="dashboard-empty">
              <p>还没有订阅源。</p>
              <button
                className="text-button"
                onClick={() => onNavigate("sources")}
              >
                添加第一个来源 <ChevronRight size={14} />
              </button>
            </div>
          )}
        </section>
        <section
          className="panel dashboard-outputs"
          aria-labelledby="dashboard-outputs-heading"
        >
          <div className="dashboard-section-heading">
            <h2 id="dashboard-outputs-heading">订阅输出</h2>
          </div>
          {profiles.isPending ? (
            <p className="dashboard-empty">正在读取输出…</p>
          ) : profiles.isError ? (
            <p className="dashboard-empty">读取失败，请稍后重试。</p>
          ) : (
            profiles.data?.map((profile) => (
              <button
                className="output-entry"
                key={profile.id}
                onClick={() => onOpenOutput(profile.id)}
              >
                <span>
                  <strong>{profile.name}</strong>
                  <small>
                    {profile.targetClient === "clash"
                      ? "Clash / Mihomo"
                      : "Shadowrocket"}{" "}
                    · {profile.enabled ? "已启用" : "已停用"}
                  </small>
                </span>
                <ChevronRight size={18} />
              </button>
            ))
          )}
        </section>
      </div>
    </div>
  );
}
