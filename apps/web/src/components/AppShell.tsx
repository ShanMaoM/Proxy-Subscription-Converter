import { ArrowUpRight, LogOut, Menu, ShieldCheck, X } from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";

export type PageId = "dashboard" | "sources" | "rules" | "output" | "system";
const navigation: { id: PageId; label: string }[] = [
  { id: "dashboard", label: "仪表盘" },
  { id: "sources", label: "订阅源" },
  { id: "rules", label: "规则编辑" },
  { id: "output", label: "输出预览" },
  { id: "system", label: "系统维护" },
];

export function AppShell({
  activePage,
  children,
  onLogout,
  onNavigate,
  username,
}: {
  activePage: PageId;
  children: ReactNode;
  onLogout: () => void;
  onNavigate: (page: PageId) => void;
  username: string;
}) {
  const [mobileOpen, setMobileOpen] = useState(false);
  const menuButton = useRef<HTMLButtonElement>(null);
  const main = useRef<HTMLElement>(null);
  const current = navigation.find((item) => item.id === activePage)!;
  useEffect(() => {
    document.title = `${current.label} · Substation`;
  }, [current.label]);
  const navigate = (page: PageId) => {
    onNavigate(page);
    setMobileOpen(false);
    window.scrollTo({ top: 0, behavior: "instant" });
    main.current?.focus({ preventScroll: true });
  };
  return (
    <div className="app-layout">
      <a className="skip-link" href="#main-content">
        跳转到主要内容
      </a>
      <header
        className="global-header"
        onKeyDown={(event) => {
          if (event.key === "Escape" && mobileOpen) {
            setMobileOpen(false);
            menuButton.current?.focus();
          }
        }}
      >
        <div className="global-nav-inner">
          <button
            className="brand-button"
            onClick={() => navigate("dashboard")}
            aria-label="Substation 首页"
          >
            <ShieldCheck size={21} strokeWidth={1.6} />
            <span>Substation</span>
          </button>
          <nav
            id="main-navigation"
            className={`nav-list ${mobileOpen ? "nav-open" : ""}`}
            aria-label="主导航"
          >
            {navigation.map((item) => (
              <button
                type="button"
                key={item.id}
                className={`nav-item ${activePage === item.id ? "active" : ""}`}
                aria-current={activePage === item.id ? "page" : undefined}
                onClick={() => navigate(item.id)}
              >
                {item.label}
              </button>
            ))}
          </nav>
          <div className="account-actions">
            <span className="account-name" title={username}>
              {username}
            </span>
            <button
              className="icon-button"
              type="button"
              aria-label="退出登录"
              onClick={onLogout}
            >
              <LogOut size={17} />
            </button>
            <button
              ref={menuButton}
              className="mobile-menu icon-button"
              type="button"
              aria-label={mobileOpen ? "关闭导航" : "打开导航"}
              aria-expanded={mobileOpen}
              aria-controls="main-navigation"
              onClick={() => setMobileOpen(!mobileOpen)}
            >
              {mobileOpen ? <X size={21} /> : <Menu size={21} />}
            </button>
          </div>
        </div>
      </header>
      <main id="main-content" ref={main} tabIndex={-1} className="content-area">
        {children}
      </main>
      <footer className="app-footer">
        <span>
          Substation <span className="footer-divider">/</span> 订阅管理
        </span>
        <button className="text-button" onClick={() => navigate("system")}>
          备份与维护 <ArrowUpRight size={14} />
        </button>
      </footer>
    </div>
  );
}
