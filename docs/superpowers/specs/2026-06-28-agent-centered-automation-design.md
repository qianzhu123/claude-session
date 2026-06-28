# Agent-Centered Automation Design

## Goal

Reshape the Claude Session Viewer homepage into an agent-centered automation workspace. The first screen should be calm and sparse, showing the visual style, current project context, and agent selection or creation. Task scheduling, QQ/WeChat connections, and execution controls should appear only after an agent exists and is selected.

## Current Problem

The current homepage exposes local catalog, MCP, skills, prompts, generic tasks, agent creation, and QQ push configuration at once. This makes the app look like a configuration dump instead of a guided workflow. It also allows users to configure tasks and QQ push profiles before they have chosen which agent should run them.

Project-level agents are now discoverable when the local catalog project root is set, but the task and connection model is still mostly global.

## Core Workflow

1. First load shows a Claude-style visual entry screen with minimal content.
2. User selects or creates an agent.
3. After agent selection, the app reveals that agent's detail workspace:
   - Overview
   - Schedule
   - Connections
   - Runs and sessions
4. Schedules and connections are bound to the selected agent.
5. Existing schedules and connections for the selected agent are listed and can be edited, disabled, or copied as commands.

## First Screen

The first viewport should not show every manager module. It should contain:

- Project root selector.
- Agent list or empty state.
- Create agent entry point.
- A short visual indication of the app style and purpose.

It should not show:

- Cron fields.
- QQ/WeChat connection forms.
- Generic task command builders.
- Long local catalog panels.

If no agent exists for the selected project, the primary action is creating an agent. If agents exist, the primary action is selecting one.

## Page Structure

Use vertically stacked full-screen or near-full-screen sections with soft gradient transitions between sections, inspired by claude.ai style. Sections are not nested cards. Cards remain only for repeated items, modals, and focused controls.

Recommended section order:

1. Agents
2. Selected Agent
3. Schedule
4. Connections
5. Runs and Sessions
6. Local Tools, collapsed or secondary

Sections after the first are hidden or collapsed until an agent is selected.

## Agent Model

The existing Markdown agent files remain the source for Claude Code agents:

- Project agents: `<projectRoot>/.claude/agents/*.md`
- User agents: `%USERPROFILE%\.claude\agents\*.md`

The app should not invent a second agent format. It can store viewer-specific metadata in local JSON files keyed by agent identity.

Agent identity should include:

- `agentName`
- `agentPath`
- `scope`
- `projectRoot`

## Schedule Model

Add a local data file:

```text
data/agent_tasks.json
```

Each task record should include:

```json
{
  "id": "stable-task-id",
  "agentName": "english-learning-agent",
  "agentPath": "D:\\code\\myweb\\English\\.claude\\agents\\english-learning-agent.md",
  "projectRoot": "D:\\code\\myweb\\English",
  "name": "Daily English Plan",
  "cron": "30 7 * * *",
  "enabled": true,
  "sessionPolicy": "new",
  "resumeSessionId": "",
  "prompt": "Prepare and send today's English learning plan.",
  "connectionIds": ["qq-main"],
  "createdAt": "ISO timestamp",
  "updatedAt": "ISO timestamp"
}
```

`sessionPolicy` values:

- `new`: default. Each run starts a new Claude session.
- `resume`: run continues a configured session ID.

The UI should default to `new` because the user's current purpose is daily independent sessions, but every task can choose its own policy.

## Cron Strategy

Windows Task Scheduler does not support full cron syntax. The app should implement cron in a local scheduler script rather than translating every cron expression into `schtasks`.

Recommended approach:

1. Add `agent_scheduler.py`.
2. The app creates one Windows system task that runs every minute.
3. `agent_scheduler.py` reads `data/agent_tasks.json`.
4. It evaluates cron expressions and runs due tasks.
5. It records run history in `data/agent_runs.json`.

This gives the UI real cron support and makes configured agent tasks discoverable in one place.

## Execution Commands

For `sessionPolicy = new`:

```powershell
cd /d <projectRoot> && claude --agent <agentName> "<prompt>"
```

For `sessionPolicy = resume`:

```powershell
cd /d <projectRoot> && claude -r <sessionId> --agent <agentName> "<prompt>"
```

The scheduler should store command output and timestamps. If a new session ID can be inferred from Claude's session files after execution, store it in the run record.

## Connections

Add a local data file:

```text
data/agent_connections.json
```

Connections are not shown until an agent is selected. A connection belongs to one agent or can be marked reusable.

Supported connection types for the first implementation:

- QQ bot via generic HTTP or OneBot/NapCat endpoint.
- WeChat-like push through PushPlus, ServerChan, or generic webhook.
- Generic webhook.

The app should not require QQ/WeChat configuration while creating an agent. Connections are optional capabilities selected by tasks.

Sensitive fields stay in `data/` and are not committed.

## Runs and Sessions

Add a local data file:

```text
data/agent_runs.json
```

Each run should include:

- Task ID.
- Agent identity.
- Project root.
- Scheduled time.
- Started and finished time.
- Return code.
- Output summary.
- Created or resumed session ID when available.

The conversation list should show the project for each session and display the correct recovery command:

```powershell
cd /d <projectRoot> && claude -r <sessionId>
```

## Existing Task Visibility

The selected agent detail view should list:

- Existing tasks bound to that agent.
- Existing connections bound to that agent.
- Recent run records for that agent.

This prevents configuration from becoming hidden after creation.

## UI Fixes

Fix select readability:

- Select background must contrast with option text.
- Placeholder or unselected text must not be the same color as the field background.
- Dark panels should use explicit select/input colors rather than inheriting unreadable values.

Fix layout density:

- No task or connection modules on first load.
- Modules should reveal progressively after agent selection.
- Use full-width sections and gradient transitions between sections.

## API Changes

Likely endpoints:

- `GET /api/agent-workspace?projectRoot=...`
- `POST /api/agent-tasks`
- `POST /api/agent-tasks/create-scheduler`
- `PATCH /api/agent-tasks/<id>`
- `POST /api/agent-connections`
- `PATCH /api/agent-connections/<id>`
- `GET /api/agent-runs?agentName=...&projectRoot=...`

Existing generic task endpoints can remain for backwards compatibility but should move behind a secondary/local-tools section.

## Testing

Unit tests:

- Agent task records require an agent identity.
- Cron validation accepts standard five-field cron.
- Scheduler command generation uses the selected agent and project root.
- New-session and resume-session policies produce different commands.
- Agent workspace filters tasks, connections, and runs by selected agent.
- Conversation list exposes project metadata and recovery command.

Rendered UI checks:

- First load does not show schedule or connection forms.
- Selecting an agent reveals schedules and connections.
- Select fields are readable in light and dark panels.
- The English project agent appears when project root is `D:\code\myweb\English`.

## Initial Implementation Scope

First implementation should include:

1. Agent-centered homepage gating.
2. Selected-agent state.
3. `data/agent_tasks.json`.
4. `data/agent_connections.json`.
5. Cron task form bound to selected agent.
6. Scheduler install command and one-minute Windows scheduler task creation.
7. Basic `agent_scheduler.py` skeleton that can evaluate due tasks and run Claude commands.
8. Conversation list project labels and project-aware recovery command.
9. Select readability fixes.

The first implementation does not need full bidirectional QQ/WeChat bot management. It only needs agent-bound outbound push connections.
