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
