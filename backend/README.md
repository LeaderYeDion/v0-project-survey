# Survey Mock Backend

第一版 FastAPI 后端承接原前端 Mock 调研逻辑，包括默认模板、虚拟受访者生成、问卷/访谈运行、进度、统计、历史和导出。

当前使用内存仓储与 Mock Engine，不调用真实模型或数据库。前端刷新不会清除数据；FastAPI 进程重启后数据会丢失。

## 环境初始化

```bash
bash backend/scripts/bootstrap.sh
```

脚本会把 Python 3.14.6 安装到 `backend/.python/`，创建 `backend/.venv/`，并通过 pip 安装运行和测试依赖，不替换系统 Python。

## 启动

只启动后端：

```bash
npm run dev:backend
```

同时启动前后端：

```bash
npm run dev:full
```

默认地址：

- FastAPI：`http://127.0.0.1:8000`
- OpenAPI：`http://127.0.0.1:8000/docs`
- Next.js：`http://127.0.0.1:3000`

可通过 `SURVEY_BACKEND_URL` 修改 Next.js Rewrite 的后端目标。

## 测试

```bash
backend/.venv/bin/python -m pytest backend/tests -v
```

健康检查：

```bash
curl --fail http://127.0.0.1:8000/api/health
curl --fail http://127.0.0.1:3000/survey-api/health
```

## Mock 实现边界

所有 Mock 专属数据与行为统一位于 `app/mocks/`：

- `catalog.py` 管理结构一致的中英文模板、画像、回答、终止与分析标签；
- `engine.py` 管理随机生成、延时、情绪与终止规则。

`app/main.py` 是唯一组合根，负责把 Mock 模板、分析标签和模拟执行实现注入
通用 API 与 Service。`RunService`、统计服务和 API Router 只依赖
`TemplateProvider`、`AnalysisLabels` 与 `SimulationEngine` 协议。

后续接入真实逻辑时，应在组合根替换这三个实现，无需修改 API Router 或
`RunService`。运行创建时会固化 `locale`；只有精确的 `zh-CN` 使用中文，
其他请求头或缺失值均使用英文。
