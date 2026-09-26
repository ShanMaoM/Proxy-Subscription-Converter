import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { apiRequest } from "../lib/api";
import { ErrorBanner } from "./ErrorBanner";

type AccessPage = {
  items: {
    id: number;
    ip: string;
    method: string;
    format: string;
    statusCode: number;
    createdAt: string;
  }[];
  nextCursor: number | null;
  total: number;
  retentionDays: number;
  maxRecords: number;
};
export function OutputAccessLogs({ profileId }: { profileId: string }) {
  const [before, setBefore] = useState<number>();
  const logs = useQuery({
    queryKey: ["output", "access", profileId, before],
    queryFn: () =>
      apiRequest<AccessPage>(
        `/api/output/profiles/${profileId}/access-logs?limit=50${before ? `&before=${before}` : ""}`,
      ),
  });
  return (
    <section className="panel access-log-panel">
      <div className="table-toolbar">
        <div>
          <h2>访问记录</h2>
          <span>
            保留最近 30 天，每个输出最多 10,000 条。记录 IP、时间和请求结果。
          </span>
        </div>
        <button
          className="secondary-button"
          disabled={logs.isFetching}
          onClick={() => {
            if (before) setBefore(undefined);
            else void logs.refetch();
          }}
        >
          刷新记录
        </button>
      </div>
      <ErrorBanner error={logs.error} />
      {logs.isPending ? (
        <p className="access-empty">正在读取…</p>
      ) : logs.data?.items.length ? (
        <>
          <div className="access-table">
            <div className="access-row access-header">
              <span>访问时间</span>
              <span>IP 地址</span>
              <span>请求</span>
              <span>结果</span>
            </div>
            {logs.data.items.map((entry) => (
              <div className="access-row" key={entry.id}>
                <time data-label="访问时间" dateTime={entry.createdAt}>
                  {new Date(entry.createdAt).toLocaleString("zh-CN", {
                    hour12: false,
                  })}
                </time>
                <code data-label="IP 地址">{entry.ip}</code>
                <span data-label="请求">
                  {entry.method} · {entry.format}
                </span>
                <span
                  data-label="结果"
                  className={entry.statusCode >= 400 ? "access-failed" : ""}
                >
                  {entry.statusCode}
                  {entry.statusCode >= 400 ? " 失败" : " 成功"}
                </span>
              </div>
            ))}
          </div>
          <div className="access-pagination">
            <span>共 {logs.data.total} 条</span>
            <div>
              {before && (
                <button
                  className="text-button"
                  onClick={() => setBefore(undefined)}
                >
                  返回最新
                </button>
              )}
              <button
                className="secondary-button"
                disabled={!logs.data.nextCursor}
                onClick={() => setBefore(logs.data!.nextCursor!)}
              >
                较早记录
              </button>
            </div>
          </div>
        </>
      ) : (
        !logs.error && (
          <p className="access-empty">
            暂无访问。客户端请求这个订阅链接后，会在这里留下记录。
          </p>
        )
      )}
    </section>
  );
}
