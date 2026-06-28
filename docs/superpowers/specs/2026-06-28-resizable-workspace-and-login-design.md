# 可拖拽工作区与独立登录页设计

## 目标

在不改变问卷、访谈、分析、历史和导出数据流的前提下：

1. 让桌面端左、中、右三个工作区可以通过分隔线自由调整宽度；
2. 用与模式选择入口一致的独立登录页替代浏览器原生 Basic Auth 对话框；
3. 保持现有 Quick Tunnel 启停、认证健康检查和 fail-closed 安全边界有效。

## 当前根因

- `app/page.tsx` 在桌面布局中把左右侧栏固定为 `340px`，中间区域仅使用剩余宽度；项目虽已有 `react-resizable-panels` 和 ShadCN 封装，但尚未接入工作区。
- `proxy.ts` 对未认证请求直接返回带 `WWW-Authenticate` 的 `401`，浏览器因此显示不可定制的原生登录对话框。

## 桌面工作区设计

仅在 `>= 1200px` 的既有桌面布局中使用 `ResizablePanelGroup`：

- 左、中、右默认比例为 `24 / 52 / 24`；
- 左右栏最小比例为 `18`、最大比例为 `40`；
- 中间栏最小比例为 `34`；
- 两条分隔线有明确的悬停、聚焦和拖拽反馈，并支持组件原生键盘操作；
- 使用稳定的 `autoSaveId` 在浏览器中记忆用户最后一次布局；
- 每个 Panel 内继续使用现有 `min-h-0/min-w-0/overflow-hidden` 滚动模型。

移动端 Tabs 和平板端 Sheet 完全保持现有结构，不引入横向拖拽。

## 登录与会话设计

### 浏览器流程

1. 部署认证关闭时，所有请求保持当前直接放行行为；
2. 部署认证开启且配置缺失时，继续返回 `503`，防止误配置后裸奔；
3. 未认证的 HTML 页面导航重定向到 `/login?next=<原路径>`；
4. `/login` 展示居中卡片、品牌标识、用户名和密码输入框，视觉沿用启动模式选择入口；
5. 登录接口对账号密码做常量时间比较，失败只返回通用错误；
6. 成功后签发 `HttpOnly`、`SameSite=Strict` 的签名 Cookie，并跳转到经过校验的站内路径；
7. 会话有效期为 12 小时，签名密钥来自现有部署密码；密码轮换会立即使旧会话失效。

### 部署兼容

- 现有 Basic Authorization 验证继续保留，供 `deploy/scripts/start.sh` 的本地及公网健康检查使用；
- 普通 HTML 页面缺少凭据时不再返回 Basic Auth challenge，因此浏览器不会弹出原生登录框；
- 非 HTML 请求在未认证时继续返回 `401`，维持脚本和 API 的明确失败语义；
- `/login`、登录接口及登录页所需的 Next.js 静态资源允许未认证访问，但不暴露调研数据。

### Cookie 格式

Cookie 值为 `<签发时间>.<HMAC-SHA256 签名>`。校验包括：

- 格式正确；
- 签发时间不是未来时间；
- 未超过 12 小时；
- 使用常量时间比较验证签名。

## 文件边界

- `lib/deployment-auth.mjs`：凭据比较、会话签发/校验和安全跳转路径；
- `proxy.ts`：请求分类、兼容 Basic Auth、Cookie 校验和登录重定向；
- `app/api/auth/login/route.ts`：登录提交与 Cookie 写入；
- `app/login/page.tsx`、`app/login/login-form.tsx`：独立登录页面和表单交互；
- `lib/workspace-layout.mjs`：桌面三栏比例常量；
- `app/page.tsx`：仅替换桌面三栏承载结构；
- `deploy/tests/basic-auth.test.mjs`、`tests/workspace-layout.test.mjs`：认证和布局契约测试。

## 错误与安全处理

- 登录失败不区分用户名或密码错误；
- `next` 仅接受以单个 `/` 开头的站内路径，拒绝 `//` 和外部 URL；
- 所有认证失败响应禁用缓存；
- 登录 Cookie 不保存明文密码；
- 公网仍依赖 Quick Tunnel HTTPS，账号密码不得复用于其他网站；
- 本轮不扩展多用户、角色、找回密码、审计或速率限制。

## 验证

### 自动化

- 会话签发、过期、篡改、密码轮换和安全跳转测试；
- Proxy 的关闭认证、缺失配置、HTML 重定向、Cookie 放行、Basic Auth 兼容及非 HTML `401` 测试；
- 三栏默认/最小/最大比例契约测试；
- `node --test`、`npx tsc --noEmit`、`npm run lint`、`npm run build` 和 `git diff --check`。

### Browser

- 未登录访问首页进入独立登录页，不出现原生认证弹窗；
- 错误凭据留在登录页并显示通用错误；
- 正确凭据进入模式选择入口；
- 1440 和 1200 px 下两条分隔线可拖动，三栏内容随之重排且没有页面级溢出；
- 刷新后保留桌面栏宽；
- 390、768、1024 px 的移动 Tabs、平板 Sheet 和主流程保持原行为；
- 控制台无新增 error。

## 文档同步

更新 README、`docs/PROJECT_ITERATION.md`、`deploy/README.md`、`deploy/ARCHITECTURE.md`、`deploy/RUNBOOK.md`、`deploy/SECURITY.md` 和故障排查说明，明确浏览器登录页、Cookie 会话与 Basic Auth 健康检查兼容边界。
