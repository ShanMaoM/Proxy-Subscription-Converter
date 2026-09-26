import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";

import { AppShell, type PageId } from "./components/AppShell";
import { ApiError, apiRequest } from "./lib/api";
import { DashboardPage } from "./pages/DashboardPage";
import { LoginPage } from "./pages/LoginPage";
import { OutputPage } from "./pages/OutputPage";
import { RulesPage } from "./pages/RulesPage";
import { SourcesPage } from "./pages/SourcesPage";
import { SystemPage } from "./pages/SystemPage";

type AdminUser = { username: string };

export function App() {
  const queryClient = useQueryClient();
  const [activePage, setActivePage] = useState<PageId>("dashboard");
  const [outputProfileId, setOutputProfileId] = useState<string>();
  const meQuery = useQuery({
    queryKey: ["auth", "me"],
    queryFn: () => apiRequest<AdminUser>("/api/auth/me"),
    retry: false,
  });
  const login = useMutation({
    mutationFn: (credentials: { username: string; password: string }) =>
      apiRequest<AdminUser>("/api/auth/login", {
        method: "POST",
        body: JSON.stringify(credentials),
      }),
    onSuccess: (user) => {
      queryClient.setQueryData(["auth", "me"], user);
    },
  });
  const logout = useMutation({
    mutationFn: () =>
      apiRequest<{ loggedOut: boolean }>("/api/auth/logout", {
        method: "POST",
      }),
    onSettled: () => {
      queryClient.setQueryData(["auth", "me"], null);
    },
  });

  if (meQuery.isPending) {
    return (
      <main className="loading-screen">
        <span className="loading-mark" />
        <p>正在连接控制台...</p>
      </main>
    );
  }

  const user = meQuery.data;
  if (!user) {
    return (
      <LoginPage
        isPending={login.isPending}
        error={
          login.error instanceof ApiError
            ? login.error.message
            : login.error
              ? "登录失败，请稍后重试"
              : undefined
        }
        onLogin={(credentials) => login.mutate(credentials)}
      />
    );
  }

  return (
    <AppShell
      activePage={activePage}
      username={user.username}
      onNavigate={setActivePage}
      onLogout={() => logout.mutate()}
    >
      {activePage === "dashboard" && (
        <DashboardPage
          onNavigate={setActivePage}
          onOpenOutput={(id) => {
            setOutputProfileId(id);
            setActivePage("output");
          }}
        />
      )}
      {activePage === "sources" && <SourcesPage />}
      {activePage === "rules" && <RulesPage />}
      {activePage === "output" && (
        <OutputPage initialProfileId={outputProfileId} />
      )}
      {activePage === "system" && <SystemPage />}
    </AppShell>
  );
}
