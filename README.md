# Claude Code 会话查看器

本地 Web 界面浏览 Claude Code 的会话记录。

## 快速开始

双击 `start.bat` 或手动启动：

```bash
cd D:\code\myweb\claude-session-viewer
python server.py
```

浏览器访问 http://localhost:8080

## 功能

- 📋 浏览所有项目和会话列表
- 💬 查看完整对话内容（用户消息 + AI 回复）
- 🔄 智能缓存 — 会话未改变时直接从本地 JSON 缓存读取
- 📋 一键复制 `claude -r <session-id>` 恢复命令
- 🧰 首页管理常用 MCP / Skill 下载与查看命令
- 🛡️ 生成启动或恢复会话命令，可配置权限模式、工作目录和提示词
- 🗂️ 启动时扫描本地 MCP、Skill、Agent 和 slash command，并保存到 `data/catalog.json`
- 📥 支持粘贴 MCP JSON 生成 `claude mcp add-json` 命令
- 📦 支持根据 Git 仓库 URL 生成 Skill 安装命令
- ⏱️ 通过表单参数生成 Windows Task Scheduler 或 `/loop` 命令
- 🤖 通过表单创建项目级或用户级 Agent Markdown 文件
- 📣 配置 QQ 机器人推送 profile，调用 OpenAI-compatible 模型生成提醒，并创建系统定时任务
- 🔍 搜索过滤会话
- 🎨 遵循 Anthropic 设计规范（cream canvas + coral accent）

## 技术栈

- Python 标准库 `http.server`（零第三方依赖）
- 纯 HTML + CSS + JS（零构建工具）

## 缓存机制

首次加载会话时解析 JSONL 文件并保存到 `cache/` 目录为 JSON 文件。
后续加载时通过文件指纹（大小 + 修改时间）判断是否需要重新解析：
- 未改变 → 直接返回缓存（毫秒级响应）
- 有改变 → 重新解析并更新缓存

## 本地数据

启动 `server.py` 时会扫描当前工作目录和 `~/.claude`，并把本地索引写入 `data/catalog.json`。
首页表单保存的 MCP JSON 导入记录、Skill 安装记录、提示词设置、QQ 推送 profile 和定时任务参数也写入 `data/`，用于下次快速读取。
`data/` 是本机状态目录，已加入 `.gitignore`。

QQ 推送 profile 的 API Key、Bot Token 等敏感字段只保存在 `data/qq_push_config.json`，创建的 Windows 计划任务只引用 profile 名称，不把密钥写入 `schtasks` 命令。

## 快捷键

- `/` — 聚焦搜索框
- `Esc` — 返回欢迎页面
- 在终端使用 `claude -r <session-id>` 恢复对话

## Git

本目录已初始化为 Git 仓库，默认分支为 `main`。`.gitignore` 会排除本地缓存、Python 编译产物和常见构建输出。
