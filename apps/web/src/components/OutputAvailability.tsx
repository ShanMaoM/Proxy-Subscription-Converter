import { useQuery } from "@tanstack/react-query";
import { CheckCircle2, CircleAlert, RefreshCw } from "lucide-react";
import { apiRequest } from "../lib/api";
import { ErrorBanner } from "./ErrorBanner";
type Check = {
  key: string;
  title: string;
  status: "ok" | "warning" | "error";
  message: string;
};
type Availability = {
  state: "ready" | "warning" | "error" | "empty" | "disabled";
  checkedAt: string;
  nodeCount: number;
  filteredCount: number;
  checks: Check[];
  sources: {
    id: string;
    name: string;
    status: Check["status"];
    message: string;
    cachedAt: string | null;
  }[];
};
const labels = {
  ready: "可生成订阅",
  warning: "可生成，有提醒",
  error: "无法生成",
  empty: "没有输出节点",
  disabled: "链接已停用",
};
export function OutputAvailability({ profileId }: { profileId: string }) {
  const query = useQuery({
    queryKey: ["output", "availability", profileId],
    queryFn: () =>
      apiRequest<Availability>(
        `/api/output/profiles/${profileId}/availability`,
      ),
  });
  return (
    <section className="panel availability-panel" aria-label="订阅可用性检查">
      <div className="availability-heading">
        <div>
          <h2>订阅可用性</h2>
          <p>检查配置生成、节点数量和来源缓存。不进行节点连通性测试。</p>
        </div>
        <button
          className="secondary-button"
          disabled={query.isFetching}
          onClick={() => void query.refetch()}
        >
          <RefreshCw size={16} />
          {query.isFetching ? "检查中…" : "重新检查"}
        </button>
      </div>
      <ErrorBanner error={query.error} />
      {query.data && !query.isError && (
        <>
          <div className={`availability-result ${query.data.state}`}>
            <strong>
              {query.data.state === "ready" ? (
                <CheckCircle2 size={18} />
              ) : (
                <CircleAlert size={18} />
              )}
              {labels[query.data.state]}
            </strong>
            <span>
              检查于{" "}
              {new Date(query.data.checkedAt).toLocaleTimeString("zh-CN", {
                hour12: false,
              })}
            </span>
          </div>
          <div className="availability-checks">
            {query.data.checks.map((check) => (
              <div key={check.key} data-status={check.status}>
                <span className="check-dot" />
                <strong>{check.title}</strong>
                <span>{check.message}</span>
              </div>
            ))}
          </div>
          {query.data.sources.length > 0 && (
            <details className="availability-sources">
              <summary>来源状态 · {query.data.sources.length} 个</summary>
              {query.data.sources.map((source) => (
                <div
                  key={source.id}
                  className="availability-source"
                  data-status={source.status}
                >
                  <strong>{source.name}</strong>
                  <span>{source.message}</span>
                  {source.cachedAt && (
                    <small>
                      缓存时间：
                      {new Date(source.cachedAt).toLocaleString("zh-CN", {
                        hour12: false,
                      })}
                    </small>
                  )}
                </div>
              ))}
            </details>
          )}
        </>
      )}
    </section>
  );
}
