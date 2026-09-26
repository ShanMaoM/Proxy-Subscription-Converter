import { AlertCircle } from "lucide-react";

import { ApiError } from "../lib/api";

export function ErrorBanner({
  error,
  fallback = "操作失败，请稍后重试",
}: {
  error: unknown;
  fallback?: string;
}) {
  if (!error) return null;
  const message =
    error instanceof ApiError || error instanceof Error
      ? error.message
      : fallback;

  return (
    <div className="alert error page-alert" role="alert">
      <AlertCircle size={17} />
      <span>{message}</span>
    </div>
  );
}
