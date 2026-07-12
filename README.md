# Claude Session Viewer

A local web interface for browsing Claude Code session history and managing related local Claude tooling.

## Quick Start

Double-click `start.bat`, or start the server manually:

```bash
cd .
python server.py
```

Then open http://localhost:8080 in your browser.

## Features

- Browse Claude Code projects and session lists.
- View full conversation content, including user messages and assistant replies.
- Use local JSON caching so unchanged sessions load from cache quickly.
- Copy `claude -r <session-id>` recovery commands.
- Manage local MCP servers, skills, agents, and slash commands from the homepage catalog.
- Generate launch and recovery commands with permission mode, working directory, model, and prompt options.
- Scan local MCP, skill, agent, and slash command files at startup and persist the index to `data/catalog.json`.
- Import MCP JSON snippets and generate `claude mcp add-json` commands.
- Search public skill repositories and generate skill installation commands.
- Create project-level or user-level Claude agent Markdown files.
- Edit agent name, description, model, tools, and prompt from the agent detail panel.
- Create, edit, delete, enable, disable, and run agent-bound scheduled tasks.
- Discover existing Windows scheduled tasks and daily plan files for the selected agent.
- Configure QQ push profiles and agent-bound outbound notification workflows.
- Search and filter sessions.
- Follow an Anthropic-inspired visual style with a cream canvas and coral accent system.

## Tech Stack

- Python standard library `http.server`; no required third-party backend dependency.
- Plain HTML, CSS, and JavaScript; no build step.
- Local JSON files for cache, catalog, task, connection, run, and prompt state.

## Cache Model

On first load, the server parses Claude Code JSONL session files and writes normalized JSON cache files into `cache/`.
On later loads, it compares each session file fingerprint by size and modification time:

- Unchanged files return directly from cache.
- Changed files are parsed again and the cache is refreshed.

## Local Data

When `server.py` starts, it scans the current working directory and `~/.claude`, then writes the local tool index to `data/catalog.json`.
Homepage forms and agent workflows also persist local state under `data/`, including MCP import records, skill install records, prompt settings, QQ push profiles, agent tasks, agent connections, and run history.

`data/` is machine-local state and is ignored by Git.

Sensitive QQ push values such as API keys and bot tokens are stored only in `data/qq_push_config.json`.
Windows scheduled task commands reference profile names instead of embedding secrets directly in `schtasks` commands.

## Agent Automation

Claude agent Markdown files remain the source of truth:

- Project agents: `<projectRoot>/.claude/agents/*.md`
- User agents: `%USERPROFILE%\.claude\agents\*.md`

The viewer stores automation metadata in local JSON files keyed by agent identity.
Selecting an agent opens an agent detail workspace where you can inspect or modify:

- Agent prompt and frontmatter settings.
- Local cron-style task records.
- Existing Windows scheduled tasks related to the project.
- Daily plan files and recent run metadata.
- Agent-bound outbound connection settings.

## Keyboard Shortcuts

- `/` focuses the session search field.
- `Esc` returns to the welcome page.
- Use `claude -r <session-id>` in a terminal to resume a session.

## Git

This directory is a Git repository with `main` as the default branch.
`.gitignore` excludes local caches, generated launcher artifacts, Python bytecode, and common build outputs.
