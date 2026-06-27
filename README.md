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
- ⏱️ 提供定时任务、多 agent 模式和常用 `/` 命令速查
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

## 快捷键

- `/` — 聚焦搜索框
- `Esc` — 返回欢迎页面
- 在终端使用 `claude -r <session-id>` 恢复对话

## Git

本目录已初始化为 Git 仓库，默认分支为 `main`。`.gitignore` 会排除本地缓存、Python 编译产物和常见构建输出。
