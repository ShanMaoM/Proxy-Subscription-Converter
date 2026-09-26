import { Eye, EyeOff, ShieldCheck } from "lucide-react";
import { useEffect, useState, type FormEvent } from "react";

export function LoginPage({
  error,
  isPending,
  onLogin,
}: {
  error?: string;
  isPending: boolean;
  onLogin: (credentials: { username: string; password: string }) => void;
}) {
  const [username, setUsername] = useState("admin");
  const [password, setPassword] = useState("");
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    document.title = "登录 · Substation";
  }, []);
  const submit = (event: FormEvent) => {
    event.preventDefault();
    onLogin({ username, password });
  };
  return (
    <div className="login-page">
      <header className="login-global">
        <div>
          <ShieldCheck size={21} strokeWidth={1.6} />
          <strong>Substation</strong>
          <span>订阅管理</span>
        </div>
      </header>
      <main className="login-main">
        <section className="login-panel">
          <form className="login-card" onSubmit={submit}>
            <div>
              <h2>登录控制台</h2>
              <p>使用管理员账号登录。</p>
            </div>
            {error && (
              <div className="alert error" role="alert">
                {error}
              </div>
            )}
            <label>
              <span>管理员账号</span>
              <input
                autoComplete="username"
                value={username}
                onChange={(event) => setUsername(event.target.value)}
                required
              />
            </label>
            <label>
              <span>密码</span>
              <div className="password-field">
                <input
                  type={visible ? "text" : "password"}
                  autoComplete="current-password"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  required
                />
                <button
                  className="password-toggle"
                  type="button"
                  aria-label={visible ? "隐藏密码" : "显示密码"}
                  aria-pressed={visible}
                  onClick={() => setVisible(!visible)}
                >
                  {visible ? <EyeOff size={18} /> : <Eye size={18} />}
                </button>
              </div>
            </label>
            <button className="primary-button full-width" disabled={isPending}>
              {isPending ? "正在验证..." : "进入控制台"}
            </button>
            <small className="login-help">
              使用部署时设置的管理员账号与密码。
            </small>
          </form>
        </section>
      </main>
      <footer className="login-footer">Substation</footer>
    </div>
  );
}
