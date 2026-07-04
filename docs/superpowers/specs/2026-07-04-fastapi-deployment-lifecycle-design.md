# FastAPI 部署生命周期设计

## 目标

将第一版 FastAPI 后端纳入现有 Cloudflare Quick Tunnel 部署生命周期，确保一次启动能够同时提供 Next.js 页面和 `/survey-api/*` 调研接口，一次停止能够安全关闭全部项目进程与端口。

## 架构

公网入口保持不变：cloudflared 只连接 `http://127.0.0.1:3000`。Next.js 的全局 Proxy 继续承担认证，认证通过后由 Rewrite 将 `/survey-api/*` 转发到只监听 `127.0.0.1:8000` 的 FastAPI。

FastAPI 不直接暴露给 Cloudflare、局域网或公网，因此不需要 CORS，也不新增第二条 Tunnel。

## 生命周期

启动顺序：

1. 校验 Node.js、Cloudflare、Python 3.14.6、后端虚拟环境和端口。
2. 构建 Next.js。
3. 启动 FastAPI，记录 PID，并验证 `/api/health`。
4. 启动 Next.js，记录 PID，并验证首页认证和 `/survey-api/health`。
5. 启动 Cloudflare Quick Tunnel，并验证公网认证及代理后的后端健康检查。

任一步失败时按反向顺序回滚。正常停止顺序为 Tunnel、Next.js、FastAPI。

## 进程和端口安全

- FastAPI 固定监听 `127.0.0.1:8000`。
- Next.js 固定监听 `127.0.0.1:3000`。
- 每个进程使用独立 PID 文件和日志。
- 停止前必须同时匹配 PID、工作目录和命令特征，拒绝终止身份不符的进程。
- 状态检查必须覆盖三个进程、临时公网 URL，以及 3000/8000 两个监听端口。
- 完整停止验证必须确认 PID 文件、匹配进程、临时 URL 和两个端口全部消失。

## 配置

部署配置新增：

- `BACKEND_HOST=127.0.0.1`
- `BACKEND_PORT=8000`（默认值，可在端口冲突时调整）
- `SURVEY_BACKEND_URL=http://127.0.0.1:8000`（必须与 Host/Port 一致）

脚本强制 `BACKEND_HOST` 为 loopback，并校验端口范围及 Rewrite URL 与 Host/Port 一致，避免 FastAPI 误监听公网接口或 Next.js Rewrite 指向外部地址。已有私密 `deploy.env` 不由初始化脚本覆盖；缺少新字段时给出明确修复提示。

## 健康检查

- FastAPI 直连：`GET http://127.0.0.1:8000/api/health` 返回 200。
- Next.js 代理：携带部署凭据请求 `GET http://127.0.0.1:3000/survey-api/health` 返回 200。
- 未认证代理请求返回 401。
- 公网代理：携带部署凭据请求 `${public_url}/survey-api/health` 返回 200。

## 测试

部署契约测试先验证 FastAPI 进程角色、启动/回滚/停止顺序、双端口检查、后端前置条件和代理健康检查。之后运行 Shell 语法检查、现有部署认证测试、后端测试、前端测试、类型检查和生产构建。

在本机已有有效部署配置时，还执行真实的一键启动、直连/代理健康检查、状态查询和一键停止；无论验证中途是否失败，都必须清理本轮进程。

## 明确限制

后端继续使用内存仓储。FastAPI 停止或重启后，运行和历史记录会丢失；本次只修复部署生命周期，不引入数据库、进程守护或高可用。
