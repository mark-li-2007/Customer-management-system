# CRM 客户管理演示版

React + TypeScript + Vite + Ant Design 前端，Express + SQLite 后端。

## 本地运行

```bash
npm install
npm run dev
```

- 前端：http://localhost:5173
- 后端 API：http://localhost:4174/api

## DeepSeek AI 配置

复制 `.env.example` 为本地 `.env` 并填写 DeepSeek API Key：

```bash
DEEPSEEK_API_KEY=你的key
DEEPSEEK_BASE_URL=https://api.deepseek.com
DEEPSEEK_MODEL=deepseek-chat
```

`.env` 已在 `.gitignore` 中，不会提交到仓库。

## 演示账号

应用内置角色切换，不需要注册登录。可切换管理员、销售主管、销售 A、销售 B 演示权限与业务规则。
