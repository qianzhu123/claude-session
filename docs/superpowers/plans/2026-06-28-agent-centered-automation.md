# Agent-Centered Automation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the first agent-centered automation implementation: sparse first screen, selected-agent gated schedules and connections, cron-backed task records, scheduler command creation, and project-aware recovery commands.

**Architecture:** Keep existing `server.py` as the HTTP API layer and local data manager, add a focused `agent_scheduler.py` runner for cron task execution, and keep static UI in `static/index.html`, `static/app.js`, and `static/style.css`. Agent Markdown files remain the source of truth; local JSON files store viewer automation metadata keyed by agent identity.

**Tech Stack:** Python standard library, Windows `schtasks`, static HTML/CSS/JS, `unittest`.

---

### Task 1: Agent Automation Data Model

**Files:**
- Modify: `server.py`
- Test: `tests/test_local_catalog.py`

- [ ] Add failing tests for cron validation, agent task save/filter, session policy command generation, and connection save/filter.
- [ ] Run `python -m unittest tests.test_local_catalog -v` and verify the new tests fail because functions are missing.
- [ ] Implement `validate_cron`, `save_agent_task`, `load_agent_workspace`, `build_agent_task_run_command`, and `save_agent_connection`.
- [ ] Run `python -m unittest tests.test_local_catalog -v` and verify all tests pass.

### Task 2: Scheduler Runner

**Files:**
- Create: `agent_scheduler.py`
- Modify: `server.py`
- Test: `tests/test_local_catalog.py`

- [ ] Add failing tests for one-minute scheduler task command generation and due cron matching.
- [ ] Run the focused tests and verify failure.
- [ ] Implement scheduler install command generation and a minimal scheduler script that reads `data/agent_tasks.json`, runs due enabled tasks, and records `data/agent_runs.json`.
- [ ] Run unit tests and `python -m py_compile server.py agent_scheduler.py qq_push_task.py`.

### Task 3: Project-Aware Sessions

**Files:**
- Modify: `server.py`
- Modify: `static/app.js`
- Test: `tests/test_local_catalog.py`

- [ ] Add failing tests that session list records include project display path and a `cd /d <projectRoot> && claude -r <sessionId>` recovery command.
- [ ] Implement project path metadata in `get_sessions_list`.
- [ ] Update rendered session cards to display project path and use project-aware resume commands.
- [ ] Run Python and JS checks.

### Task 4: Agent-Gated UI

**Files:**
- Modify: `static/index.html`
- Modify: `static/app.js`
- Modify: `static/style.css`
- Test: `tests/test_local_catalog.py`

- [ ] Add failing HTML tests: first-load-only sections have gated classes, agent task controls exist, connection controls exist, and select readability CSS exists.
- [ ] Implement selected-agent state in `app.js`.
- [ ] Hide schedule and connection sections until an agent is selected.
- [ ] Add agent-bound task form with cron, session policy, prompt, and connection selection.
- [ ] Add agent-bound connection form with QQ, WeChat push, and webhook options.
- [ ] Fix select/readability CSS.
- [ ] Run unit tests and `node --check static/app.js`.

### Task 5: Browser Validation and Commit

**Files:**
- Verify all changed files.

- [ ] Restart local server.
- [ ] Use Browser plugin to verify first load is sparse.
- [ ] Set project root to `D:\code\myweb\English`, select `english-learning-agent`, and verify schedule and connection sections appear.
- [ ] Verify select text is readable and no console errors are logged.
- [ ] Run `python -m unittest tests.test_local_catalog -v`, `python -m py_compile server.py agent_scheduler.py qq_push_task.py`, and `node --check static/app.js`.
- [ ] Commit implementation.
