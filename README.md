# 自用订阅转换器

一个可通过 Docker 部署的订阅管理后台。将多个 Clash/Mihomo YAML、节点 URI 或 Base64 订阅合并，按设备分别配置输出链接、节点筛选和分流规则。

适合个人管理自己的订阅，不提供代理服务器、节点账号或公开注册。生成的订阅需要导入相应客户端使用。

## 功能

- **订阅源管理**：远程链接、上传文件、粘贴文本；支持启停、手动刷新和远程订阅定时刷新。流量与到期时间取决于上游是否提供信息。
- **多个独立输出**：每个输出拥有自己的链接、token、名称、文件名和启用状态，可以独立选择来源。
- **节点筛选**：按名称包含词、排除词和协议筛选，排除优先；比较完整连接配置去重，同名的不同节点自动重命名。
- **分流配置**：Clash YAML 支持全局或独立规则、自定义策略组、规则集、上游规则开关和兜底策略。规则编辑后需要显式保存。
- **规则类型**：支持域名、IPv4/IPv6、来源 IP、ASN、端口、网络、进程等 33 种原子规则；部分目标 IP 规则支持 `no-resolve`。
- **订阅检查**：查看生成结果、来源缓存、刷新失败、节点数量、流量和到期信息。
- **访问记录**：按输出查看访问 IP、时间、请求方法、格式和状态码。
- **维护与迁移**：操作日志、JSON 配置备份与恢复；SQLite 持久化，启动时自动执行数据库迁移。

### 输出格式与兼容范围

| 输出 | 内容 | 当前范围 |
| --- | --- | --- |
| `.yaml` / `.yml` | Clash/Mihomo 配置 | 保留合法节点对象及上游 `hosts`，生成策略组和规则，并输出适用的 DNS、规则集配置；具体协议由客户端内核支持 |
| `.txt` | Base64 编码的节点 URI 列表 | SS、VMess、Trojan、VLESS、Hysteria2 的已实现字段；不包含分流规则 |
| `.conf` | 实验性 Shadowrocket 明文 URI 列表 | SS、Trojan、VMess；不是完整的 Shadowrocket 配置文件 |

URI 输入识别 `ss://`、`vmess://`、`trojan://`、`vless://`、`hysteria2://`，也支持将这些 URI 整体进行 Base64 编码。并非所有协议扩展字段都已支持，不能承诺任意配置无损互转。

使用较新协议、复杂传输参数或依赖 `hosts` 的节点时，优先选择 YAML。AnyTLS 节点可以随 YAML 保留，目前不支持转换为本项目的 URI 输出。SS 插件只转换已支持的参数；无法完整表示时会跳过并提示。

转换时不保留上游 `proxy-groups`，会使用本项目配置的策略组。仅有 `proxy-providers`、没有内联 `proxies` 的配置，目前不会自动下载其中的节点提供者。上游 `hosts` 冲突时保留先读到的映射并给出警告；URI 输出只处理显式映射与别名链，多地址取第一个，无法表达完整的通配与回退语义。

**“订阅可用性检查”不是节点测速**：它检查缓存和配置能否生成，不探测真实节点连通性。最终连接效果需要在客户端确认。

## Docker 快速启动

需要 Docker Engine / Docker Desktop，以及支持 `docker compose` 命令的 Compose 插件。使用 Linux 容器。通过 Docker 部署时，宿主机不需要额外安装 Node.js 或 pnpm。

以下命令均在项目根目录执行。

### 1. 创建环境文件

首次部署时复制模板。Windows PowerShell：

```powershell
Copy-Item .env.docker.example .env.docker
```

Linux / macOS：

```bash
cp .env.docker.example .env.docker
```

编辑 `.env.docker`，至少替换以下两项，不要使用模板中的占位值：

```dotenv
ADMIN_USERNAME=admin
ADMIN_PASSWORD=这里替换成你自己的强密码
SESSION_SECRET=这里替换成至少32个字符的随机密钥
PUBLIC_BASE_URL=http://localhost:8080
WEB_ORIGIN=http://localhost:8080
APP_PORT=8080
```

可在 PowerShell 中生成随机密钥，将输出自行填入 `SESSION_SECRET`：

```powershell
$bytes = New-Object byte[] 32
$rng = [System.Security.Cryptography.RandomNumberGenerator]::Create()
$rng.GetBytes($bytes)
[Convert]::ToBase64String($bytes)
$rng.Dispose()
```

`.env.docker` 属于私密配置，不提交到仓库。**已有部署不要用模板覆盖原文件，也不要直接更换 `SESSION_SECRET`**：这个密钥同时用于解密数据库里的远程订阅地址。

### 2. 构建并启动

```bash
docker compose --env-file .env.docker up -d --build
docker compose --env-file .env.docker ps
```

首次构建需要下载基础镜像、系统包和 JavaScript 依赖，耗时取决于网络。服务启动后打开：

```text
http://localhost:8080
```

使用 `.env.docker` 中的管理员账号、密码登录。首次启动自动建库并创建默认输出，无需另外执行 SQL 或初始化命令。

当前默认部署结构为：

```text
浏览器 / 订阅客户端 → Caddy :8080 → 应用容器 :3000 → SQLite 数据卷
```

应用的 `3000` 端口仅供容器内部访问，对外端口由 `APP_PORT` 决定。修改端口后，需要同时修改 `PUBLIC_BASE_URL`、`WEB_ORIGIN` 中的端口，再执行上述启动命令应用配置。

### 3. 添加来源并获取订阅

1. 在“订阅源”中添加远程链接、上传 YAML 或粘贴节点内容；远程来源先刷新，确保已有可用缓存。
2. 在“输出预览”中选择已有输出，或新增一个输出，按需设置来源和节点筛选。
3. 如果需要分流，使用 YAML 输出，配置策略组、规则集和全局/独立规则，保存修改。
4. 查看预览、警告和可用性检查结果，再复制订阅链接导入客户端。
5. 后续在后台修改配置后，客户端需要更新订阅才能取得最新内容。

输出链接包含访问 token，持有链接即可下载其中的节点。重命名输出不会重置 token；停用、删除或重置 token 会使对应访问失效。

## 部署到服务器

默认 `Caddyfile` 只监听容器内的 HTTP `80` 端口，**不会自动给默认部署配置公网 HTTPS**。从其他设备或公网访问时，应配置带证书的 HTTPS 反向代理，或自行调整 Caddy 的域名、端口和证书持久化配置。

将以下两项设置为实际访问地址，包含非标准端口（如有），不要填写 API 路径：

```dotenv
PUBLIC_BASE_URL=https://sub.example.com
WEB_ORIGIN=https://sub.example.com
```

生产环境登录 Cookie 带有 `Secure` 标记，普通 HTTP 局域网 IP 访问可能出现登录后仍未登录的情况。不要为解决这个问题将生产环境改成开发模式，应使用 HTTPS；默认 `localhost` 地址用于本机访问。

已有 Nginx、Caddy 等反向代理时，可将流量转发到服务器的应用发布端口。如果代理就在同一台宿主机，可将 Compose 的端口发布限制为回环地址，例如 `127.0.0.1:8080:80`，并按实际网络拓扑配置访问。

访问 IP 的可信边界也需要与代理层数一致：当前 Compose 设置 `TRUST_PROXY_HOPS=1`，内置 Caddy 覆盖 `X-Forwarded-For`，记录的是直接连接它的地址。再增加 CDN 或反向代理后，记录可能是上一跳代理 IP；不能仅通过任意透传客户端提供的请求头解决。

## 配置说明

### Docker 环境文件

| 变量 | 说明 |
| --- | --- |
| `ADMIN_USERNAME` | 管理员用户名，默认 `admin` |
| `ADMIN_PASSWORD` | 管理员密码，程序要求至少 8 个字符；部署时自行设置强密码 |
| `SESSION_SECRET` | 至少 32 字符的随机密钥，用于登录会话签名及远程订阅 URL 加密 |
| `PUBLIC_BASE_URL` | 对外订阅链接的地址前缀，应使用客户端可访问的地址 |
| `WEB_ORIGIN` | 管理后台的访问来源，协议、主机和端口应与实际页面一致 |
| `APP_PORT` | 宿主机发布端口，默认 `8080` |

`NODE_ENV`、容器监听地址、数据库路径、静态资源路径和代理信任设置已经在 `docker-compose.yml` 中指定。仅在 `.env.docker` 添加同名变量，不会覆盖 Compose 中写死的设置。

### 本地开发环境文件

本地开发使用根目录 `.env`，与 Docker 使用的 `.env.docker` 分开。

| 变量 | 默认配置与用途 |
| --- | --- |
| `HOST` / `PORT` | 后端监听 `127.0.0.1:3000` |
| `NODE_ENV` | 后端默认 `development`，共享 `.env` 通常不必设置；Docker 已明确设置为 `production` |
| `DATABASE_URL` | `./data/subscription-converter.sqlite`；通过工作区后端命令启动时位于 `apps/server/data/` |
| `STATIC_ROOT` | 本地开发留空，由 Vite 提供页面；Docker 已配置静态目录 |
| `TRUST_PROXY_HOPS` | 本地直连使用 `0`，当前实现接受 `0` 或 `1` |
| `VITE_API_BASE_URL` | 默认留空，浏览器通过当前页面的同源路径访问 API |
| `VITE_API_PROXY_TARGET` | Vite 开发代理的后端地址，默认 `http://127.0.0.1:3000` |
| `VITE_PORT` | Vite 开发端口，默认 `5173` |

前端读取根目录的 `.env` 及 Vite 对应模式的环境文件；后端启动命令读取根目录 `.env`，进程环境变量优先。`VITE_` 前缀变量用于前端配置，不要将密码或密钥放入其中。

不要在共享 `.env` 中固定 `NODE_ENV=development`，否则可能使前端生产构建使用开发环境。旧环境文件若包含这一行，通常可以移除，让后端和 Vite 各自使用默认值。环境文件与构建模式的区别见 [Vite 环境变量说明](https://vite.dev/guide/env-and-mode)。

## 更新、停止与备份

### 更新与查看日志

替换源码后，在原项目目录中执行：

```bash
docker compose --env-file .env.docker up -d --build
docker compose --env-file .env.docker logs --tail=100 app proxy
```

更新前保留 `.env.docker` 并备份数据。原数据卷不变时，重建容器不会丢失来源、规则和输出 token。改变项目目录名或 Compose 项目名可能使用另一套数据卷；出现空白后台时先检查挂载，不要立即重新初始化。

临时停止、再次启动：

```bash
docker compose --env-file .env.docker stop
docker compose --env-file .env.docker start
```

修改环境变量后，应使用 `up -d` 重建受影响的容器；单独执行 `restart` 不会加载新的环境变量。

**不要用 `docker compose down -v` 做普通更新或清理**，`-v` 会删除项目数据卷。

### 数据存放位置

| 内容 | 存放位置 |
| --- | --- |
| Docker 数据库 | 容器 `/app/data/subscription-converter.sqlite`，持久化到 `subscription_data` 命名卷（实际卷名通常带 Compose 项目前缀） |
| 本地开发数据库 | 默认 `apps/server/data/subscription-converter.sqlite` |
| 本地自动化脚本的临时文件 | 项目根目录 `.tmp/` |

数据库包含节点连接信息、输出 token、远程缓存及访问记录，不能随源码公开。远程订阅 URL 的加密不代表整个数据库已加密。

### 两种备份方式

- **配置迁移**：在“系统维护”中导出 JSON，在新部署中恢复。包含来源、规则、设置和输出 token，远程 URL 会导出为可迁移的明文；不包含管理员环境配置、远程订阅缓存或访问历史。恢复会替换当前配置、清空对应访问记录，远程来源需重新刷新。新部署可使用自己的密钥，恢复时会重新加密 URL。
- **完整备份**：私下保存原 `.env.docker`，并在停止应用后备份整个 `/app/data` 目录或相应数据卷。不要在数据库运行时只复制主 `.sqlite` 文件而遗漏尚未合并的 WAL 数据。直接迁移数据库文件时，需要保留原 `SESSION_SECRET`。

两种备份都属于敏感资料。代码仓库、聊天截图或公开附件不适合保存这些文件。

## 本地开发

需要 Node.js 24 或更高版本、可用的 Corepack。项目在 `package.json` 中固定 pnpm 11.6.0。后端使用 `better-sqlite3` 原生依赖；如当前平台没有可用预编译包，还需要 Python 和 C/C++ 编译工具。Dockerfile 已处理容器内的编译依赖。

首次安装：

```bash
corepack pnpm install --frozen-lockfile
```

从 `.env.example` 复制一份根目录 `.env`，替换其中的管理员密码和随机密钥。不要覆盖已有的本地环境文件。

分别打开两个终端：

```bash
# 终端一：后端
corepack pnpm dev:server
```

```bash
# 终端二：前端
corepack pnpm dev:web
```

浏览器打开 `http://127.0.0.1:5173`，后端为 `http://127.0.0.1:3000`。使用模板时统一使用 `127.0.0.1`，避免与 `localhost` 混用产生 Cookie 或来源不一致。变更后端端口时，同时修改 `VITE_API_PROXY_TARGET`；变更前端端口时，同时修改 `WEB_ORIGIN`。

如 `corepack` 命令不存在，需要为本机 Node.js 环境安装或启用 Corepack，也可直接使用 Docker 部署。无需为了开发启动而提前构建 `dist/`；数据库也会随后端启动自动创建。

### 维护命令

以下是按需手动执行的命令，依赖安装完成后才可运行：

```bash
corepack pnpm typecheck
corepack pnpm lint
corepack pnpm format:check
corepack pnpm build
```

后端和共享包由 TypeScript 源码运行/引用，`build` 会执行类型检查，前端另生成 `apps/web/dist/`；仅生成前端 `dist/` 并不等于启动完整服务。

测试命令仅供后续维护时参考：

```bash
corepack pnpm --filter @subscription-converter/shared test
corepack pnpm --filter @subscription-converter/converter test
corepack pnpm --filter @subscription-converter/server test
corepack pnpm test:browser
```

浏览器脚本目前面向 Windows，自动寻找 Chrome / Edge，也可用 `BROWSER_EXECUTABLE_PATH` 指定浏览器。它会启动独立开发服务，使用 `19100`、`19101` 端口和 `.tmp` 下的测试数据库。Docker 检查脚本会写入测试配置或重启容器，必须使用独立 Compose 项目、端口和数据卷，不要对正式实例运行。

## 目录结构

```text
apps/
  web/              React 管理后台与 Vite 配置
  server/           Fastify API、鉴权、SQLite、迁移与订阅输出
packages/
  shared/           共享类型、校验规则与规则类型目录
  converter/        订阅解析、筛选、去重与格式生成
scripts/            浏览器、Docker 和内核检查脚本
Dockerfile          应用镜像的多阶段构建
Caddyfile           容器内 HTTP 反向代理
docker-compose.yml  应用、代理与数据卷配置
.env.example        本地开发环境模板
.env.docker.example Docker 环境模板
pnpm-lock.yaml      依赖锁文件
```

`memory-bank/` 是本地开发记录，已忽略，不是构建或运行依赖。源码上传不需要携带 `node_modules/`、`.pnpm-store/`、`dist/`、`.tmp/`、真实环境文件或数据库；这些缓存和生成目录也不应作为项目缺文件的判断依据。

## 常见问题

**构建时 APT 下载失败、退出码 100**

查看日志里最早的下载错误，确认 Docker 网络、代理或软件源连通性后重试。Dockerfile 已设置下载重试和 CA 证书，不需要通过关闭证书验证解决。Docker Hub 或 pnpm 下载失败也应先检查 Docker 的网络环境。

**远程订阅刷新失败，但原来能用**

检查上游是否过期、服务器能否访问该订阅、是否已有成功缓存。服务端默认远程拉取超时为 10 秒、响应上限为 2 MiB、最多跟随 3 次重定向。出于 SSRF 防护，私网、回环和部分特殊地址会被拒绝；代理 DNS 若返回 fake-IP，也可能被拦截，不要直接关闭地址校验。

**转换后节点数量减少**

先看节点筛选、去重摘要和转换警告。URI 输出不支持全部协议和插件；尝试 YAML，并确认使用支持对应协议的 Mihomo 内核。YAML 上传不会自动读取 `proxy-providers` 的远程节点。

**能看到节点但连接超时**

在客户端更新订阅，检查节点是否依赖 `hosts`、插件、TLS/SNI 或特殊传输参数。YAML 保留的节点信息更完整。配置能生成并不代表上游账号、网络或节点一定可用，应与原始订阅在相同客户端下对照。

**公开订阅返回 404 或 409**

404 常见于 token 错误、已重置、输出停用/删除或格式与输出类型不匹配；409 可能是所选来源没有内容、输出引用的策略组或规则集缺失。先在后台检查当前输出的预览和可用性提示。

**访问记录中的 IP 是代理地址**

当前内置 Caddy 记录直接连接它的地址。使用多层反向代理或 CDN 后需要专门调整可信代理链，默认配置不会自动识别所有上游代理。

