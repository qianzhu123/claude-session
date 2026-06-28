#!/usr/bin/env python3
"""Claude Code Session Viewer - HTTP Server

Serves a web UI for browsing Claude Code conversation sessions.
Reads JSONL session files from ~/.claude/projects/ and caches parsed data as JSON.
"""

import http.server
import json
import os
import re
import shutil
import stat
import subprocess
import sys
import time
import urllib.parse
import urllib.request
import webbrowser
from urllib.parse import urlparse, parse_qs
from pathlib import Path

# --- Configuration ---
PORT = 8080
CLAUDE_DIR = Path.home() / ".claude"
PROJECTS_DIR = CLAUDE_DIR / "projects"
CACHE_DIR = Path(__file__).parent / "cache"
STATIC_DIR = Path(__file__).parent / "static"
DATA_DIR = Path(__file__).parent / "data"
CATALOG_PATH = DATA_DIR / "catalog.json"
TASKS_PATH = DATA_DIR / "tasks.json"
MCP_IMPORTS_PATH = DATA_DIR / "mcp_imports.json"
SKILL_INSTALLS_PATH = DATA_DIR / "skill_installs.json"
PROMPT_SETTINGS_PATH = DATA_DIR / "prompt_settings.json"
QQ_PUSH_CONFIG_PATH = DATA_DIR / "qq_push_config.json"
QQ_PUSH_RUNS_PATH = DATA_DIR / "qq_push_runs.json"
AGENT_TASKS_PATH = DATA_DIR / "agent_tasks.json"
AGENT_CONNECTIONS_PATH = DATA_DIR / "agent_connections.json"
AGENT_RUNS_PATH = DATA_DIR / "agent_runs.json"


def ensure_cache_dir():
    CACHE_DIR.mkdir(parents=True, exist_ok=True)


def ensure_data_dir():
    DATA_DIR.mkdir(parents=True, exist_ok=True)


def read_json_file(path, fallback):
    try:
        with open(path, "r", encoding="utf-8") as f:
            return json.load(f)
    except (OSError, json.JSONDecodeError):
        return fallback


def write_json_file(path, data):
    ensure_data_dir()
    with open(path, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)
        f.write("\n")


def append_json_record(path, record):
    records = read_json_file(path, [])
    if not isinstance(records, list):
        records = []
    records.append(record)
    write_json_file(path, records)
    return records


def now_timestamp():
    return time.strftime("%Y-%m-%dT%H:%M:%S%z")


def parse_frontmatter(text):
    if not text.startswith("---\n"):
        return {}
    end = text.find("\n---", 4)
    if end == -1:
        return {}
    meta = {}
    for line in text[4:end].splitlines():
        if ":" not in line:
            continue
        key, value = line.split(":", 1)
        meta[key.strip()] = value.strip().strip('"').strip("'")
    return meta


def safe_name(value):
    name = re.sub(r"[^A-Za-z0-9_-]+", "-", str(value or "").strip()).strip("-")
    if not name:
        raise ValueError("Name is required")
    return name


def stable_id(prefix, *parts):
    raw = "-".join(str(part or "") for part in parts) + f"-{int(time.time() * 1000)}"
    return f"{prefix}-{safe_name(raw)[:80]}"


def scan_skill_dir(base_dir, scope):
    skills = []
    if not base_dir.exists():
        return skills
    for skill_md in sorted(base_dir.glob("*/SKILL.md")):
        text = skill_md.read_text(encoding="utf-8", errors="replace")
        meta = parse_frontmatter(text)
        skills.append({
            "name": meta.get("name") or skill_md.parent.name,
            "description": meta.get("description", ""),
            "scope": scope,
            "path": str(skill_md.parent),
            "sourceType": "direct",
        })
    for skill_md in sorted(base_dir.glob("*/skills/*/SKILL.md")):
        text = skill_md.read_text(encoding="utf-8", errors="replace")
        meta = parse_frontmatter(text)
        bundle_dir = skill_md.parent.parent.parent
        top_level_target = base_dir / skill_md.parent.name
        if top_level_target.exists():
            continue
        skills.append({
            "name": meta.get("name") or skill_md.parent.name,
            "description": meta.get("description", ""),
            "scope": scope,
            "path": str(skill_md.parent),
            "sourceType": "bundle",
            "bundle": bundle_dir.name,
            "bundlePath": str(bundle_dir),
            "activatable": not top_level_target.exists(),
        })
    return skills


def find_bundle_skill_dirs(bundle_dir):
    bundle_dir = Path(bundle_dir)
    candidates = []
    if (bundle_dir / "skills").exists():
        candidates.extend((bundle_dir / "skills").glob("*/SKILL.md"))
    candidates.extend(bundle_dir.glob("*/SKILL.md"))
    unique = []
    seen = set()
    for skill_md in sorted(candidates):
        parent = skill_md.parent.resolve()
        if parent in seen:
            continue
        seen.add(parent)
        unique.append(skill_md.parent)
    return unique


def activate_skill_bundle(bundle_path, claude_dir=None):
    claude_dir = Path(claude_dir or CLAUDE_DIR)
    bundle_dir = Path(bundle_path).expanduser()
    if not bundle_dir.exists():
        raise ValueError("bundlePath does not exist")

    skill_root = claude_dir / "skills"
    skill_root.mkdir(parents=True, exist_ok=True)
    skill_dirs = find_bundle_skill_dirs(bundle_dir)
    if not skill_dirs:
        raise ValueError("No nested SKILL.md files found in bundlePath")

    results = []
    activated = 0
    skipped = 0
    for source_dir in skill_dirs:
        skill_name = safe_name(source_dir.name)
        target_dir = skill_root / skill_name
        if target_dir.exists():
            skipped += 1
            results.append({
                "name": skill_name,
                "source": str(source_dir),
                "target": str(target_dir),
                "status": "exists",
            })
            continue
        shutil.copytree(source_dir, target_dir)
        activated += 1
        results.append({
            "name": skill_name,
            "source": str(source_dir),
            "target": str(target_dir),
            "status": "activated",
        })

    return {
        "bundlePath": str(bundle_dir),
        "activated": activated,
        "skipped": skipped,
        "skills": results,
    }


def organize_skill_bundle(bundle_path, claude_dir=None):
    claude_dir = Path(claude_dir or CLAUDE_DIR)
    bundle_dir = Path(bundle_path).expanduser()
    if not bundle_dir.exists():
        raise ValueError("bundlePath does not exist")
    if not find_bundle_skill_dirs(bundle_dir):
        raise ValueError("No nested SKILL.md files found in bundlePath")

    target_root = claude_dir / "skill-bundles"
    target_root.mkdir(parents=True, exist_ok=True)
    target_dir = target_root / bundle_dir.name
    if target_dir.exists():
        suffix = time.strftime("%Y%m%d-%H%M%S")
        target_dir = target_root / f"{bundle_dir.name}-{suffix}"

    shutil.move(str(bundle_dir), str(target_dir))
    return {
        "status": "moved",
        "source": str(bundle_dir),
        "target": str(target_dir),
    }


def scan_agent_dir(base_dir, scope):
    agents = []
    if not base_dir.exists():
        return agents
    for agent_file in sorted(base_dir.glob("*.md")):
        text = agent_file.read_text(encoding="utf-8", errors="replace")
        meta = parse_frontmatter(text)
        agents.append({
            "name": meta.get("name") or agent_file.stem,
            "description": meta.get("description", ""),
            "model": meta.get("model", ""),
            "tools": meta.get("tools", ""),
            "scope": scope,
            "path": str(agent_file),
        })
    return agents


def scan_command_dir(base_dir, scope):
    commands = []
    if not base_dir.exists():
        return commands
    for command_file in sorted(base_dir.glob("*.md")):
        commands.append({
            "name": command_file.stem,
            "scope": scope,
            "path": str(command_file),
        })
    return commands


def scan_mcp_file(path, scope):
    config = read_json_file(path, {})
    servers = config.get("mcpServers", {}) if isinstance(config, dict) else {}
    if not isinstance(servers, dict):
        return []
    result = []
    for name, definition in sorted(servers.items()):
        if not isinstance(definition, dict):
            definition = {"value": definition}
        result.append({
            "name": name,
            "scope": scope,
            "path": str(path),
            "transport": definition.get("type") or ("http" if definition.get("url") else "stdio"),
            "command": definition.get("command", ""),
            "url": definition.get("url", ""),
            "args": definition.get("args", []),
        })
    return result


def decode_project_id(project_id):
    project_id = str(project_id or "").strip()
    if not project_id:
        return ""
    return project_id.replace("--", ":\\").replace("-", "\\")


def resolve_catalog_project_root(project_root="", project_id="", fallback=None):
    manual_root = str(project_root or "").strip()
    if manual_root:
        return Path(manual_root).expanduser()
    decoded = decode_project_id(project_id)
    if decoded:
        return Path(decoded)
    return Path(fallback or os.getcwd())


def build_local_catalog(project_root=None, claude_dir=None, home_config=None):
    project_root = Path(project_root or os.getcwd())
    if claude_dir is None:
        claude_dir = CLAUDE_DIR
        home_config = Path.home() / ".claude.json" if home_config is None else Path(home_config)
    else:
        claude_dir = Path(claude_dir)
        home_config = claude_dir.parent / ".claude.json" if home_config is None else Path(home_config)

    mcp_servers = []
    mcp_servers.extend(scan_mcp_file(project_root / ".mcp.json", "project"))
    mcp_servers.extend(scan_mcp_file(claude_dir / "mcp.json", "user"))
    mcp_servers.extend(scan_mcp_file(home_config, "user"))

    skills = []
    skills.extend(scan_skill_dir(project_root / ".claude" / "skills", "project"))
    skills.extend(scan_skill_dir(claude_dir / "skills", "user"))

    agents = []
    agents.extend(scan_agent_dir(project_root / ".claude" / "agents", "project"))
    agents.extend(scan_agent_dir(claude_dir / "agents", "user"))

    commands = []
    commands.extend(scan_command_dir(project_root / ".claude" / "commands", "project"))
    commands.extend(scan_command_dir(claude_dir / "commands", "user"))

    catalog = {
        "generatedAt": time.strftime("%Y-%m-%dT%H:%M:%S%z"),
        "projectRoot": str(project_root),
        "claudeDir": str(claude_dir),
        "mcpServers": mcp_servers,
        "skills": skills,
        "agents": agents,
        "commands": commands,
        "tasks": read_json_file(TASKS_PATH, []),
        "mcpImports": read_json_file(MCP_IMPORTS_PATH, []),
        "skillInstalls": read_json_file(SKILL_INSTALLS_PATH, []),
        "promptSettings": load_prompt_settings(),
        "qqPush": load_qq_push_summary(),
        "agentTasks": read_json_file(AGENT_TASKS_PATH, []),
        "agentConnections": [sanitize_agent_connection(item) for item in read_json_file(AGENT_CONNECTIONS_PATH, []) if isinstance(item, dict)],
        "agentRuns": read_json_file(AGENT_RUNS_PATH, []),
        "counts": {
            "mcpServers": len(mcp_servers),
            "skills": len(skills),
            "agents": len(agents),
            "commands": len(commands),
        },
    }
    return catalog


def refresh_local_catalog(project_root=None):
    catalog = build_local_catalog(project_root=project_root)
    write_json_file(CATALOG_PATH, catalog)
    return catalog


def load_local_catalog(project_root=None):
    if CATALOG_PATH.exists():
        return read_json_file(CATALOG_PATH, {})
    return refresh_local_catalog(project_root=project_root)


def cmd_quote(value):
    return '"' + str(value).replace('"', '\\"') + '"'


def powershell_quote(value):
    return '"' + str(value).replace("`", "``").replace('"', '`"') + '"'


def schtasks_quote(value):
    return '"' + str(value).replace('"', '""') + '"'


def same_path(left, right):
    if not left or not right:
        return False
    return os.path.normcase(os.path.abspath(str(left))) == os.path.normcase(os.path.abspath(str(right)))


def build_resume_command(project_path, session_id, home_path=None):
    session_id = str(session_id or "").strip()
    project_path = str(project_path or "").strip()
    home_path = Path(home_path or Path.home())
    if not session_id:
        raise ValueError("session_id is required")
    if not project_path or same_path(project_path, home_path):
        return f"claude -r {session_id}"
    return f"Set-Location -LiteralPath {powershell_quote(project_path)}; claude -r {session_id}"


def build_task_command(params):
    task_name = params.get("taskName", "").strip()
    schedule = params.get("schedule", "DAILY").strip().upper()
    start_time = params.get("startTime", "").strip()
    cwd = params.get("cwd", "").strip()
    permission_mode = params.get("permissionMode", "default").strip()
    prompt = params.get("prompt", "").strip()

    if not task_name or not schedule or not start_time or not cwd or not prompt:
        raise ValueError("taskName, schedule, startTime, cwd, and prompt are required")

    claude_parts = ["claude"]
    if permission_mode and permission_mode != "default":
        claude_parts.extend(["--permission-mode", permission_mode])
    claude_parts.append(cmd_quote(prompt))

    task_run = f"cmd /c cd /d {cmd_quote(cwd)} && {' '.join(claude_parts)}"
    return f"schtasks /Create /SC {schedule} /TN {cmd_quote(task_name)} /TR {schtasks_quote(task_run)} /ST {start_time}"


def validate_cron(cron):
    value = str(cron or "").strip()
    fields = value.split()
    if len(fields) != 5:
        raise ValueError("cron must contain exactly five fields")
    field_pattern = re.compile(r"^[A-Za-z0-9*/,\\-]+$")
    for field in fields:
        if not field_pattern.match(field):
            raise ValueError("cron contains unsupported characters")
    return value


def _cron_field_matches(field, value):
    if field == "*":
        return True
    for part in field.split(","):
        if part.startswith("*/"):
            step = int(part[2:])
            if step <= 0:
                return False
            if value % step == 0:
                return True
        elif "-" in part:
            start, end = [int(piece) for piece in part.split("-", 1)]
            if start <= value <= end:
                return True
        elif part.isdigit() and int(part) == value:
            return True
    return False


def cron_matches(cron, when_tuple=None):
    cron = validate_cron(cron)
    if when_tuple is None:
        now = time.localtime()
        values = (now.tm_year, now.tm_mon, now.tm_mday, now.tm_hour, now.tm_min)
    else:
        values = when_tuple
    _, month, day, hour, minute = values
    fields = cron.split()
    python_wday = time.localtime(time.mktime((values[0], month, day, hour, minute, 0, 0, 0, -1))).tm_wday
    cron_wday = (python_wday + 1) % 7
    dow_field = fields[4]
    dow_matches = _cron_field_matches(dow_field, cron_wday) or (cron_wday == 0 and _cron_field_matches(dow_field, 7))
    return (
        _cron_field_matches(fields[0], minute)
        and _cron_field_matches(fields[1], hour)
        and _cron_field_matches(fields[2], day)
        and _cron_field_matches(fields[3], month)
        and dow_matches
    )


def agent_scheduler_script_path():
    return Path(__file__).parent / "agent_scheduler.py"


def build_agent_scheduler_task_run(script_path=None, python_exe=None):
    script = Path(script_path or agent_scheduler_script_path())
    python = python_exe or sys.executable
    return f"cmd /c {cmd_quote(python)} {cmd_quote(str(script))}"


def build_agent_scheduler_task_command(params=None, script_path=None, python_exe=None):
    params = params or {}
    task_name = str(params.get("taskName", "Claude Agent Scheduler")).strip() or "Claude Agent Scheduler"
    command = (
        f"schtasks /Create /SC MINUTE /MO 1 /TN {cmd_quote(task_name)} "
        f"/TR {schtasks_quote(build_agent_scheduler_task_run(script_path=script_path, python_exe=python_exe))}"
    )
    if params.get("force"):
        command += " /F"
    return command


def build_agent_scheduler_task_argv(params=None, script_path=None, python_exe=None):
    params = params or {}
    task_name = str(params.get("taskName", "Claude Agent Scheduler")).strip() or "Claude Agent Scheduler"
    argv = [
        "schtasks",
        "/Create",
        "/SC",
        "MINUTE",
        "/MO",
        "1",
        "/TN",
        task_name,
        "/TR",
        build_agent_scheduler_task_run(script_path=script_path, python_exe=python_exe),
    ]
    if params.get("force"):
        argv.append("/F")
    return argv


def create_agent_scheduler_task(params=None, runner=None):
    runner = runner or subprocess.run
    result = runner(build_agent_scheduler_task_argv(params), capture_output=True, text=True, check=False)
    return {
        "command": build_agent_scheduler_task_command(params),
        "returnCode": result.returncode,
        "stdout": result.stdout,
        "stderr": result.stderr,
        "created": result.returncode == 0,
    }


def sanitize_agent_connection(record):
    clean = dict(record)
    clean.pop("token", None)
    clean["tokenSet"] = bool(record.get("token"))
    return clean


def save_agent_task(params, path=None):
    tasks_path = Path(path or AGENT_TASKS_PATH)
    agent_name = str(params.get("agentName", "")).strip()
    project_root = str(params.get("projectRoot", "")).strip()
    name = str(params.get("name", "")).strip()
    prompt = str(params.get("prompt", "")).strip()
    cron = validate_cron(params.get("cron", ""))
    session_policy = str(params.get("sessionPolicy", "new")).strip() or "new"
    if session_policy not in {"new", "resume"}:
        raise ValueError("sessionPolicy must be new or resume")
    if not agent_name or not project_root or not name or not prompt:
        raise ValueError("agentName, projectRoot, name, and prompt are required")
    if session_policy == "resume" and not str(params.get("resumeSessionId", "")).strip():
        raise ValueError("resumeSessionId is required when sessionPolicy is resume")

    tasks = read_json_file(tasks_path, [])
    if not isinstance(tasks, list):
        tasks = []
    task_id = str(params.get("id", "")).strip() or stable_id("task", agent_name, name)
    existing = next((item for item in tasks if isinstance(item, dict) and item.get("id") == task_id), None)
    record = {
        "id": task_id,
        "agentName": agent_name,
        "agentPath": str(params.get("agentPath", "")).strip(),
        "projectRoot": project_root,
        "name": name,
        "cron": cron,
        "enabled": bool(params.get("enabled", True)),
        "sessionPolicy": session_policy,
        "resumeSessionId": str(params.get("resumeSessionId", "")).strip(),
        "prompt": prompt,
        "connectionIds": params.get("connectionIds") if isinstance(params.get("connectionIds"), list) else [],
        "createdAt": existing.get("createdAt") if existing else now_timestamp(),
        "updatedAt": now_timestamp(),
    }
    tasks = [item for item in tasks if not (isinstance(item, dict) and item.get("id") == task_id)]
    tasks.append(record)
    write_json_file(tasks_path, tasks)
    return record


def build_agent_task_run_command(task):
    agent_name = safe_name(task.get("agentName", ""))
    project_root = str(task.get("projectRoot", "")).strip()
    prompt = str(task.get("prompt", "")).strip()
    session_policy = str(task.get("sessionPolicy", "new")).strip() or "new"
    if not project_root or not prompt:
        raise ValueError("projectRoot and prompt are required")
    claude_parts = ["claude"]
    if session_policy == "resume":
        session_id = str(task.get("resumeSessionId", "")).strip()
        if not session_id:
            raise ValueError("resumeSessionId is required when sessionPolicy is resume")
        claude_parts.extend(["-r", session_id])
    claude_parts.extend(["--agent", agent_name, cmd_quote(prompt)])
    return f"cd /d {cmd_quote(project_root)} && {' '.join(claude_parts)}"


def _as_list(value):
    if value is None:
        return []
    return value if isinstance(value, list) else [value]


def _task_schedule_label(triggers):
    labels = []
    for trigger in _as_list(triggers):
        if not isinstance(trigger, dict):
            continue
        start = trigger.get("StartBoundary") or trigger.get("startBoundary") or ""
        if start:
            labels.append(str(start).replace("T", " "))
    return ", ".join(labels)


def normalize_scheduled_task_record(record, project_root):
    actions = _as_list(record.get("Actions") or record.get("actions"))
    action = actions[0] if actions and isinstance(actions[0], dict) else {}
    task_name = str(record.get("TaskName") or record.get("taskName") or "").strip()
    task_path = str(record.get("TaskPath") or record.get("taskPath") or "\\").strip() or "\\"
    return {
        "id": f"external-{safe_name(task_name)}",
        "source": "windows-scheduled-task",
        "taskName": task_name,
        "taskPath": task_path,
        "state": str(record.get("State") or record.get("state") or ""),
        "description": str(record.get("Description") or record.get("description") or ""),
        "schedule": _task_schedule_label(record.get("Triggers") or record.get("triggers")),
        "command": str(action.get("Execute") or action.get("execute") or ""),
        "arguments": str(action.get("Arguments") or action.get("arguments") or ""),
        "workingDirectory": str(action.get("WorkingDirectory") or action.get("workingDirectory") or project_root),
        "lastRunTime": str(record.get("LastRunTime") or record.get("lastRunTime") or ""),
        "nextRunTime": str(record.get("NextRunTime") or record.get("nextRunTime") or ""),
        "lastTaskResult": record.get("LastTaskResult") if record.get("LastTaskResult") is not None else record.get("lastTaskResult", ""),
        "controllable": True,
    }


def discover_windows_agent_tasks(project_root, runner=None):
    project_root = str(project_root or "").strip()
    if not project_root or os.name != "nt":
        return []
    runner = runner or subprocess.run
    script = f"""
$ProjectRoot = {powershell_quote(project_root)}
$RootLower = $ProjectRoot.ToLowerInvariant()
Get-ScheduledTask | Where-Object {{
    $matched = $false
    foreach ($action in $_.Actions) {{
        $haystack = (($action.WorkingDirectory + ' ' + $action.Arguments) -as [string]).ToLowerInvariant()
        if ($haystack.Contains($RootLower)) {{ $matched = $true }}
    }}
    $matched
}} | ForEach-Object {{
    $info = $null
    try {{ $info = Get-ScheduledTaskInfo -TaskPath $_.TaskPath -TaskName $_.TaskName }} catch {{ }}
    [pscustomobject]@{{
        TaskName = $_.TaskName
        TaskPath = $_.TaskPath
        State = $_.State.ToString()
        Description = $_.Description
        Actions = @($_.Actions | ForEach-Object {{ [pscustomobject]@{{ Execute = $_.Execute; Arguments = $_.Arguments; WorkingDirectory = $_.WorkingDirectory }} }})
        Triggers = @($_.Triggers | ForEach-Object {{ [pscustomobject]@{{ StartBoundary = $_.StartBoundary; Enabled = $_.Enabled }} }})
        LastRunTime = if ($info -and $info.LastRunTime) {{ $info.LastRunTime.ToString('yyyy-MM-dd HH:mm:ss') }} else {{ '' }}
        NextRunTime = if ($info -and $info.NextRunTime) {{ $info.NextRunTime.ToString('yyyy-MM-dd HH:mm:ss') }} else {{ '' }}
        LastTaskResult = if ($info) {{ $info.LastTaskResult }} else {{ '' }}
    }}
}} | ConvertTo-Json -Depth 6 -Compress
"""
    try:
        result = runner(
            ["powershell", "-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", script],
            capture_output=True,
            text=True,
            check=False,
            timeout=20,
        )
    except (OSError, subprocess.TimeoutExpired):
        return []
    if result.returncode != 0 or not result.stdout.strip():
        return []
    try:
        records = json.loads(result.stdout)
    except json.JSONDecodeError:
        return []
    return [
        normalize_scheduled_task_record(item, project_root)
        for item in _as_list(records)
        if isinstance(item, dict) and (item.get("TaskName") or item.get("taskName"))
    ]


def build_windows_task_control_argv(task_name, action):
    task_name = str(task_name or "").strip()
    action = str(action or "").strip().lower()
    if not task_name:
        raise ValueError("taskName is required")
    if action == "run":
        return ["schtasks", "/Run", "/TN", task_name]
    if action == "stop":
        return ["schtasks", "/End", "/TN", task_name]
    if action == "enable":
        return ["schtasks", "/Change", "/TN", task_name, "/ENABLE"]
    if action == "disable":
        return ["schtasks", "/Change", "/TN", task_name, "/DISABLE"]
    raise ValueError("action must be run, stop, enable, or disable")


def control_windows_task(task_name, action, runner=None):
    runner = runner or subprocess.run
    argv = build_windows_task_control_argv(task_name, action)
    result = runner(argv, capture_output=True, text=True, check=False)
    return {
        "taskName": task_name,
        "action": action,
        "command": " ".join(cmd_quote(part) if " " in part else part for part in argv),
        "returnCode": result.returncode,
        "stdout": result.stdout,
        "stderr": result.stderr,
        "ok": result.returncode == 0,
        "updatedAt": now_timestamp(),
    }


def _read_text_tail(path, max_chars=4000):
    path = Path(path)
    if not path.exists() or not path.is_file():
        return ""
    text = path.read_text(encoding="utf-8", errors="replace")
    return text[-max_chars:]


def discover_agent_daily_plan(project_root):
    project_root = Path(project_root) if project_root else Path()
    plan_dir = project_root / "Agent_Daily_Plans"
    result = {
        "path": str(plan_dir),
        "exists": plan_dir.exists(),
        "planFiles": [],
        "latestJson": None,
        "latestMarkdown": "",
        "qqTargets": {},
        "logs": {},
    }
    if not plan_dir.exists():
        return result

    json_files = sorted(
        [path for path in plan_dir.glob("*.json") if path.name != "qq_targets.json"],
        key=lambda p: p.stat().st_mtime,
        reverse=True,
    )
    md_files = sorted(plan_dir.glob("*.md"), key=lambda p: p.stat().st_mtime, reverse=True)
    for path in (json_files + md_files)[:10]:
        result["planFiles"].append({
            "name": path.name,
            "path": str(path),
            "updatedAt": time.strftime("%Y-%m-%dT%H:%M:%S", time.localtime(path.stat().st_mtime)),
            "size": path.stat().st_size,
        })
    for path in json_files:
        if path.name == "qq_targets.json":
            continue
        try:
            result["latestJson"] = json.loads(path.read_text(encoding="utf-8"))
            result["latestJsonPath"] = str(path)
            break
        except json.JSONDecodeError:
            continue
    if md_files:
        result["latestMarkdownPath"] = str(md_files[0])
        result["latestMarkdown"] = _read_text_tail(md_files[0], max_chars=3000)
    qq_targets = plan_dir / "qq_targets.json"
    if qq_targets.exists():
        try:
            result["qqTargets"] = json.loads(qq_targets.read_text(encoding="utf-8"))
        except json.JSONDecodeError:
            result["qqTargets"] = {}
    log_dir = plan_dir / "logs"
    if log_dir.exists():
        for log_file in sorted(log_dir.glob("*.log"), key=lambda p: p.stat().st_mtime, reverse=True)[:5]:
            result["logs"][log_file.name] = _read_text_tail(log_file, max_chars=2000)
    return result


def save_agent_connection(params, path=None):
    connection_path = Path(path or AGENT_CONNECTIONS_PATH)
    agent_name = str(params.get("agentName", "")).strip()
    project_root = str(params.get("projectRoot", "")).strip()
    name = str(params.get("name", "")).strip()
    connection_type = str(params.get("type", "")).strip()
    endpoint = str(params.get("endpoint", "")).strip()
    target = str(params.get("target", "")).strip()
    if not agent_name or not project_root or not name or not connection_type:
        raise ValueError("agentName, projectRoot, name, and type are required")

    connections = read_json_file(connection_path, [])
    if not isinstance(connections, list):
        connections = []
    connection_id = str(params.get("id", "")).strip() or safe_name(name)
    existing = next((item for item in connections if isinstance(item, dict) and item.get("id") == connection_id), None)
    record = {
        "id": connection_id,
        "agentName": agent_name,
        "projectRoot": project_root,
        "name": name,
        "type": connection_type,
        "endpoint": endpoint,
        "target": target,
        "token": str(params.get("token", "")).strip() or (existing.get("token", "") if existing else ""),
        "createdAt": existing.get("createdAt") if existing else now_timestamp(),
        "updatedAt": now_timestamp(),
    }
    connections = [item for item in connections if not (isinstance(item, dict) and item.get("id") == connection_id)]
    connections.append(record)
    write_json_file(connection_path, connections)
    return sanitize_agent_connection(record)


def _filter_agent_records(records, agent_name, project_root):
    return [
        item for item in records
        if isinstance(item, dict)
        and item.get("agentName") == agent_name
        and item.get("projectRoot") == project_root
    ]


def load_agent_workspace(agent_name, project_root, task_path=None, connection_path=None, run_path=None, external_task_loader=None):
    agent_name = str(agent_name or "").strip()
    project_root = str(project_root or "").strip()
    tasks = read_json_file(Path(task_path or AGENT_TASKS_PATH), [])
    connections = read_json_file(Path(connection_path or AGENT_CONNECTIONS_PATH), [])
    runs = read_json_file(Path(run_path or AGENT_RUNS_PATH), [])
    filtered_connections = _filter_agent_records(connections if isinstance(connections, list) else [], agent_name, project_root)
    external_task_loader = external_task_loader or discover_windows_agent_tasks
    return {
        "agentName": agent_name,
        "projectRoot": project_root,
        "tasks": _filter_agent_records(tasks if isinstance(tasks, list) else [], agent_name, project_root),
        "externalTasks": external_task_loader(project_root),
        "connections": [sanitize_agent_connection(item) for item in filtered_connections],
        "runs": _filter_agent_records(runs if isinstance(runs, list) else [], agent_name, project_root),
        "dailyPlan": discover_agent_daily_plan(project_root),
    }


def build_task_run(params):
    cwd = params.get("cwd", "").strip()
    permission_mode = params.get("permissionMode", "default").strip()
    prompt = params.get("prompt", "").strip()

    claude_parts = ["claude"]
    if permission_mode and permission_mode != "default":
        claude_parts.extend(["--permission-mode", permission_mode])
    claude_parts.append(cmd_quote(prompt))
    return f"cmd /c cd /d {cmd_quote(cwd)} && {' '.join(claude_parts)}"


def build_task_argv(params):
    task_name = params.get("taskName", "").strip()
    schedule = params.get("schedule", "DAILY").strip().upper()
    start_time = params.get("startTime", "").strip()
    cwd = params.get("cwd", "").strip()
    prompt = params.get("prompt", "").strip()

    if not task_name or not schedule or not start_time or not cwd or not prompt:
        raise ValueError("taskName, schedule, startTime, cwd, and prompt are required")

    argv = [
        "schtasks",
        "/Create",
        "/SC",
        schedule,
        "/TN",
        task_name,
        "/TR",
        build_task_run(params),
        "/ST",
        start_time,
    ]
    if params.get("force"):
        argv.append("/F")
    return argv


def create_windows_task(params, runner=None):
    runner = runner or subprocess.run
    result = runner(build_task_argv(params), capture_output=True, text=True, check=False)
    return {
        "command": build_task_command(params) + (" /F" if params.get("force") else ""),
        "returnCode": result.returncode,
        "stdout": result.stdout,
        "stderr": result.stderr,
        "created": result.returncode == 0,
    }


def load_qq_push_config(path=None):
    config_path = Path(path or QQ_PUSH_CONFIG_PATH)
    config = read_json_file(config_path, {"profiles": {}})
    if not isinstance(config, dict):
        config = {}
    if not isinstance(config.get("profiles"), dict):
        config["profiles"] = {}
    return config


def write_qq_push_config(config, path=None):
    config_path = Path(path or QQ_PUSH_CONFIG_PATH)
    config_path.parent.mkdir(parents=True, exist_ok=True)
    with open(config_path, "w", encoding="utf-8") as f:
        json.dump(config, f, ensure_ascii=False, indent=2)
        f.write("\n")
    return config


def sanitize_qq_push_profile(profile):
    return {
        "profileName": profile.get("profileName", ""),
        "apiBaseUrl": profile.get("apiBaseUrl", ""),
        "model": profile.get("model", ""),
        "botPlatform": profile.get("botPlatform", ""),
        "botEndpoint": profile.get("botEndpoint", ""),
        "sessionId": profile.get("sessionId", ""),
        "payloadPreset": profile.get("payloadPreset", "generic"),
        "taskPrompt": profile.get("taskPrompt", ""),
        "apiKeySet": bool(profile.get("apiKey")),
        "botTokenSet": bool(profile.get("botToken")),
        "updatedAt": profile.get("updatedAt", ""),
    }


def load_qq_push_summary(path=None):
    config = load_qq_push_config(path=path)
    profiles = [
        sanitize_qq_push_profile(profile)
        for _, profile in sorted(config.get("profiles", {}).items())
        if isinstance(profile, dict)
    ]
    return {
        "profiles": profiles,
        "runs": read_json_file(QQ_PUSH_RUNS_PATH, []),
    }


def save_qq_push_profile(params, path=None):
    profile_name = str(params.get("profileName", "")).strip()
    api_base_url = str(params.get("apiBaseUrl", "")).strip().rstrip("/")
    model = str(params.get("model", "")).strip()
    api_key = str(params.get("apiKey", "")).strip()
    bot_endpoint = str(params.get("botEndpoint", "")).strip()
    session_id = str(params.get("sessionId", "")).strip()

    if not profile_name or not api_base_url or not model:
        raise ValueError("profileName, apiBaseUrl, and model are required")
    if not api_base_url.startswith(("http://", "https://")):
        raise ValueError("apiBaseUrl must start with http:// or https://")
    if bot_endpoint and not bot_endpoint.startswith(("http://", "https://")):
        raise ValueError("botEndpoint must start with http:// or https://")

    config = load_qq_push_config(path=path)
    existing = config["profiles"].get(profile_name, {})
    if not isinstance(existing, dict):
        existing = {}
    profile = {
        "profileName": profile_name,
        "apiBaseUrl": api_base_url,
        "apiKey": api_key or existing.get("apiKey", ""),
        "model": model,
        "botPlatform": str(params.get("botPlatform", "generic")).strip() or "generic",
        "botEndpoint": bot_endpoint,
        "botToken": str(params.get("botToken", "")).strip() or existing.get("botToken", ""),
        "sessionId": session_id,
        "payloadPreset": str(params.get("payloadPreset", "generic")).strip() or "generic",
        "payloadTemplate": str(params.get("payloadTemplate", "")).strip(),
        "taskPrompt": str(params.get("taskPrompt", "")).strip(),
        "updatedAt": time.strftime("%Y-%m-%dT%H:%M:%S%z"),
    }
    config["profiles"][profile_name] = profile
    write_qq_push_config(config, path=path)
    return sanitize_qq_push_profile(profile)


def qq_push_script_path():
    return Path(__file__).parent / "qq_push_task.py"


def build_qq_push_task_run(params, script_path=None, python_exe=None):
    profile_name = str(params.get("profileName", "")).strip()
    if not profile_name:
        raise ValueError("profileName is required")
    script = Path(script_path or qq_push_script_path())
    python = python_exe or sys.executable
    return f"cmd /c {cmd_quote(python)} {cmd_quote(str(script))} --profile {cmd_quote(profile_name)}"


def build_qq_push_task_command(params, script_path=None, python_exe=None):
    task_name = str(params.get("taskName", "")).strip()
    schedule = str(params.get("schedule", "DAILY")).strip().upper()
    start_time = str(params.get("startTime", "")).strip()
    if not task_name or not schedule or not start_time:
        raise ValueError("taskName, schedule, and startTime are required")
    command = (
        f"schtasks /Create /SC {schedule} /TN {cmd_quote(task_name)} "
        f"/TR {schtasks_quote(build_qq_push_task_run(params, script_path=script_path, python_exe=python_exe))} "
        f"/ST {start_time}"
    )
    if params.get("force"):
        command += " /F"
    return command


def build_qq_push_task_argv(params, script_path=None, python_exe=None):
    task_name = str(params.get("taskName", "")).strip()
    schedule = str(params.get("schedule", "DAILY")).strip().upper()
    start_time = str(params.get("startTime", "")).strip()
    if not task_name or not schedule or not start_time:
        raise ValueError("taskName, schedule, and startTime are required")
    argv = [
        "schtasks",
        "/Create",
        "/SC",
        schedule,
        "/TN",
        task_name,
        "/TR",
        build_qq_push_task_run(params, script_path=script_path, python_exe=python_exe),
        "/ST",
        start_time,
    ]
    if params.get("force"):
        argv.append("/F")
    return argv


def create_qq_push_task(params, runner=None):
    runner = runner or subprocess.run
    result = runner(build_qq_push_task_argv(params), capture_output=True, text=True, check=False)
    return {
        "command": build_qq_push_task_command(params),
        "returnCode": result.returncode,
        "stdout": result.stdout,
        "stderr": result.stderr,
        "created": result.returncode == 0,
    }


def _session_value(session_id):
    value = str(session_id or "").strip()
    if ":" in value:
        return value.split(":", 1)[1]
    return value


def _replace_template_values(value, replacements):
    if isinstance(value, str):
        for key, replacement in replacements.items():
            value = value.replace("{" + key + "}", replacement)
        return value
    if isinstance(value, list):
        return [_replace_template_values(item, replacements) for item in value]
    if isinstance(value, dict):
        return {key: _replace_template_values(item, replacements) for key, item in value.items()}
    return value


def render_qq_payload(payload_preset, payload_template, session_id, message):
    preset = str(payload_preset or "generic").strip()
    plain_session = _session_value(session_id)
    if preset == "onebot_group":
        return {"group_id": plain_session, "message": message}
    if preset == "onebot_private":
        return {"user_id": plain_session, "message": message}
    if preset == "qq_channel":
        return {"channel_id": plain_session, "content": message}
    if preset == "custom":
        if not payload_template:
            raise ValueError("payloadTemplate is required for custom preset")
        parsed = json.loads(payload_template)
        return _replace_template_values(parsed, {"sessionId": session_id, "plainSessionId": plain_session, "message": message})
    return {"sessionId": session_id, "message": message}


def openai_chat_url(api_base_url):
    base = str(api_base_url or "").strip().rstrip("/")
    if base.endswith("/chat/completions"):
        return base
    if base.endswith("/v1"):
        return f"{base}/chat/completions"
    return f"{base}/v1/chat/completions"


def http_json_post(url, payload, headers=None, timeout=60):
    data = json.dumps(payload, ensure_ascii=False).encode("utf-8")
    request = urllib.request.Request(
        url,
        data=data,
        headers={"Content-Type": "application/json", **(headers or {})},
        method="POST",
    )
    with urllib.request.urlopen(request, timeout=timeout) as response:
        body = response.read().decode("utf-8", errors="replace")
        if not body:
            return {}
        return json.loads(body)


def extract_chat_message(response):
    choices = response.get("choices", []) if isinstance(response, dict) else []
    if choices:
        message = choices[0].get("message", {})
        content = message.get("content", "")
        if isinstance(content, str):
            return content.strip()
    return ""


def build_qq_push_context():
    tasks = read_json_file(TASKS_PATH, [])
    recent_tasks = tasks[-5:] if isinstance(tasks, list) else []
    lines = ["本地记录的最近任务："]
    if not recent_tasks:
        lines.append("- 暂无本地任务记录")
    for task in recent_tasks:
        if not isinstance(task, dict):
            continue
        name = task.get("taskName") or task.get("profileName") or "unnamed"
        prompt = task.get("prompt") or task.get("taskPrompt") or task.get("command") or ""
        lines.append(f"- {name}: {prompt}")
    return "\n".join(lines)


def generate_qq_push_message(profile, http_post=None):
    http_post = http_post or http_json_post
    api_key = profile.get("apiKey", "")
    if not api_key:
        raise ValueError("apiKey is required for QQ push profile")
    task_prompt = profile.get("taskPrompt") or "根据本地上下文总结我当前需要做的事项，输出一条适合 QQ 推送的简短提醒。"
    payload = {
        "model": profile["model"],
        "messages": [
            {
                "role": "system",
                "content": "你是一个定时提醒助手。只输出需要推送给用户的内容，保持简洁、可执行。",
            },
            {
                "role": "user",
                "content": f"{task_prompt}\n\n{build_qq_push_context()}",
            },
        ],
    }
    response = http_post(
        openai_chat_url(profile["apiBaseUrl"]),
        payload,
        {"Authorization": f"Bearer {api_key}"},
    )
    message = extract_chat_message(response)
    if not message:
        raise ValueError("model response did not contain a message")
    return message


def send_qq_push_message(profile, message, http_post=None):
    http_post = http_post or http_json_post
    endpoint = profile.get("botEndpoint", "")
    if not endpoint:
        raise ValueError("botEndpoint is required before sending QQ messages")
    payload = render_qq_payload(
        profile.get("payloadPreset", "generic"),
        profile.get("payloadTemplate", ""),
        profile.get("sessionId", ""),
        message,
    )
    headers = {}
    if profile.get("botToken"):
        headers["Authorization"] = f"Bearer {profile['botToken']}"
    return http_post(endpoint, payload, headers)


def run_qq_push_profile(profile_name, config_path=None, http_post=None):
    config = load_qq_push_config(path=config_path)
    profile = config.get("profiles", {}).get(profile_name)
    if not isinstance(profile, dict):
        raise ValueError(f"QQ push profile not found: {profile_name}")
    message = generate_qq_push_message(profile, http_post=http_post)
    send_result = send_qq_push_message(profile, message, http_post=http_post)
    record = {
        "profileName": profile_name,
        "message": message,
        "sendResult": send_result,
        "createdAt": time.strftime("%Y-%m-%dT%H:%M:%S%z"),
    }
    append_json_record(QQ_PUSH_RUNS_PATH, record)
    return record


def build_loop_command(params):
    interval = params.get("interval", "").strip()
    prompt = params.get("prompt", "").strip()
    if not interval or not prompt:
        raise ValueError("interval and prompt are required")
    return f"/loop every {interval} {prompt}"


def build_mcp_import_command(name, json_text):
    mcp_name = safe_name(name)
    parsed = json.loads(json_text)
    if not isinstance(parsed, dict):
        raise ValueError("MCP JSON must be an object")
    compact = json.dumps(parsed, ensure_ascii=False, separators=(",", ":")).replace('"', '\\"')
    return f'claude mcp add-json {mcp_name} "{compact}"'


def build_skill_install_command(params):
    repo_url = params.get("repoUrl", "").strip()
    skill_name = safe_name(params.get("skillName") or Path(repo_url).stem.replace(".git", ""))
    if not repo_url:
        raise ValueError("repoUrl is required")
    destination = f"%USERPROFILE%\\.claude\\skills\\{skill_name}"
    return f"git clone {cmd_quote(repo_url)} {cmd_quote(destination)}"


def install_skill_repository(params, claude_dir=None, runner=None):
    repo_url = params.get("repoUrl", "").strip()
    skill_name = safe_name(params.get("skillName") or Path(repo_url).stem.replace(".git", ""))
    if not repo_url:
        raise ValueError("repoUrl is required")
    if not repo_url.startswith(("https://", "http://", "git@")):
        raise ValueError("repoUrl must be a Git repository URL")

    claude_dir = Path(claude_dir or CLAUDE_DIR)
    target_dir = claude_dir / "skills" / skill_name
    if target_dir.exists():
        raise ValueError(f"Skill target already exists: {target_dir}")
    target_dir.parent.mkdir(parents=True, exist_ok=True)

    runner = runner or subprocess.run
    result = runner(["git", "clone", repo_url, str(target_dir)], capture_output=True, text=True, check=False)
    return {
        "name": skill_name,
        "repoUrl": repo_url,
        "path": str(target_dir),
        "command": build_skill_install_command({"skillName": skill_name, "repoUrl": repo_url}),
        "returnCode": result.returncode,
        "stdout": result.stdout,
        "stderr": result.stderr,
        "installed": result.returncode == 0,
    }


def github_json_fetcher(url):
    req = urllib.request.Request(url, headers={
        "Accept": "application/vnd.github+json",
        "User-Agent": "claude-session-viewer",
    })
    with urllib.request.urlopen(req, timeout=10) as resp:
        return json.loads(resp.read().decode("utf-8"))


def public_url_fetcher(url):
    req = urllib.request.Request(url, headers={
        "Accept": "application/json,text/html;q=0.9,*/*;q=0.8",
        "User-Agent": "claude-session-viewer",
    })
    with urllib.request.urlopen(req, timeout=10) as resp:
        text = resp.read().decode("utf-8", errors="replace")
        content_type = resp.headers.get("Content-Type", "")
        if "json" in content_type.lower():
            return json.loads(text)
        try:
            return json.loads(text)
        except json.JSONDecodeError:
            return text


def _first_list(data):
    if isinstance(data, list):
        return data
    if not isinstance(data, dict):
        return []
    for key in ("items", "results", "data", "skills", "plugins"):
        value = data.get(key)
        if isinstance(value, list):
            return value
    return []


def _github_repo_url(value):
    value = str(value or "").strip()
    if not value:
        return ""
    if value.startswith(("http://", "https://", "git@")):
        return value
    if re.match(r"^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$", value):
        return f"https://github.com/{value}"
    return ""


def _catalog_link_result(source, term, url):
    return [{
        "name": f"Open {source} search",
        "repoUrl": "",
        "sourceUrl": url,
        "description": f"Open {source} and inspect results for '{term}'. Install is enabled only when a Git repository URL is available.",
        "stars": "",
        "source": source,
        "installable": False,
    }]


def _github_results_from_text(text, source):
    if not isinstance(text, str):
        return []
    repo_urls = []
    seen = set()
    for match in re.finditer(r"https://github\.com/([A-Za-z0-9_.-]+)/([A-Za-z0-9_.-]+)", text):
        repo_url = f"https://github.com/{match.group(1)}/{match.group(2).removesuffix('.git')}"
        if repo_url in seen:
            continue
        seen.add(repo_url)
        repo_urls.append(repo_url)
    results = []
    for repo_url in repo_urls[:10]:
        results.append({
            "name": Path(repo_url).name,
            "repoUrl": repo_url,
            "sourceUrl": repo_url,
            "description": f"GitHub repository discovered from {source}",
            "stars": "",
            "source": source,
            "installable": True,
        })
    return results


def _github_search_results(term, fetcher, source_label="github"):
    search_query = f'{term} "SKILL.md" "Claude Code"'
    encoded = urllib.parse.urlencode({
        "q": search_query,
        "sort": "stars",
        "order": "desc",
        "per_page": "10",
    })
    data = fetcher(f"https://api.github.com/search/repositories?{encoded}")
    results = []
    for item in _first_list(data):
        repo_url = item.get("html_url", "")
        results.append({
            "name": item.get("name", ""),
            "repoUrl": repo_url,
            "sourceUrl": repo_url,
            "description": item.get("description", ""),
            "stars": item.get("stargazers_count", 0),
            "source": source_label,
            "installable": bool(repo_url),
        })
    return results


def _installable_or_github_fallback(results, term, fetcher, source, link_url):
    if any(item.get("installable") for item in results):
        return results
    try:
        fallback = _github_search_results(term, fetcher, f"{source} fallback")
        if fallback:
            return fallback
    except Exception:
        pass
    return results or _catalog_link_result(source, term, link_url)


def _dedupe_search_results(results):
    deduped = []
    seen = set()
    for item in results:
        key = item.get("repoUrl") or item.get("sourceUrl") or item.get("name")
        if not key or key in seen:
            continue
        seen.add(key)
        deduped.append(item)
    return deduped


def search_skill_repositories(query, source="github", fetcher=None):
    term = str(query or "").strip()
    if not term:
        raise ValueError("query is required")
    fetcher = fetcher or public_url_fetcher
    source = str(source or "github").strip().lower()
    results = []

    if source == "all":
        combined = []
        for current_source in ("github", "skills-sh", "clawhub", "claude-plugins"):
            try:
                combined.extend(search_skill_repositories(term, source=current_source, fetcher=fetcher))
            except Exception:
                continue
        installable = [item for item in _dedupe_search_results(combined) if item.get("installable")]
        return installable or _dedupe_search_results(combined)

    if source == "github":
        return _github_search_results(term, fetcher)

    if source == "skills-sh":
        encoded = urllib.parse.urlencode({"q": term})
        link_url = f"https://skills.sh/search?q={urllib.parse.quote(term)}"
        try:
            data = fetcher(f"https://skills.sh/api/search?{encoded}")
        except Exception:
            try:
                data = fetcher(link_url)
                return _installable_or_github_fallback(_github_results_from_text(data, "skills.sh"), term, fetcher, "skills.sh", link_url)
            except Exception:
                return _installable_or_github_fallback([], term, fetcher, "skills.sh", link_url)
        for item in _first_list(data):
            repo_url = _github_repo_url(item.get("repoUrl") or item.get("repository") or item.get("repo") or item.get("github"))
            source_url = item.get("url") or item.get("href") or repo_url
            results.append({
                "name": item.get("name") or item.get("title") or Path(repo_url).stem,
                "repoUrl": repo_url,
                "sourceUrl": source_url,
                "description": item.get("description") or item.get("summary") or "",
                "stars": item.get("stars") or item.get("stargazers_count") or "",
                "source": "skills.sh",
                "installable": bool(repo_url),
            })
        return _installable_or_github_fallback(results, term, fetcher, "skills.sh", link_url)

    if source == "clawhub":
        encoded = urllib.parse.urlencode({"q": term})
        link_url = f"https://www.clawhub.dev/search?q={urllib.parse.quote(term)}"
        try:
            data = fetcher(f"https://www.clawhub.dev/api/v1/skills?{encoded}")
        except Exception:
            try:
                data = fetcher(link_url)
                return _installable_or_github_fallback(_github_results_from_text(data, "clawhub"), term, fetcher, "clawhub", link_url)
            except Exception:
                return _installable_or_github_fallback([], term, fetcher, "clawhub", link_url)
        for item in _first_list(data):
            repo_url = _github_repo_url(item.get("repoUrl") or item.get("repository") or item.get("repo") or item.get("githubUrl"))
            source_url = item.get("url") or item.get("homepage") or repo_url
            results.append({
                "name": item.get("name") or item.get("title") or Path(repo_url).stem,
                "repoUrl": repo_url,
                "sourceUrl": source_url,
                "description": item.get("description") or item.get("summary") or "",
                "stars": item.get("stars") or item.get("stargazers_count") or "",
                "source": "clawhub",
                "installable": bool(repo_url),
            })
        return _installable_or_github_fallback(results, term, fetcher, "clawhub", link_url)

    if source == "claude-plugins":
        link_url = f"https://claude-plugins.com/search?q={urllib.parse.quote(term)}"
        try:
            data = fetcher(link_url)
            return _installable_or_github_fallback(_github_results_from_text(data, "claude-plugins"), term, fetcher, "claude-plugins", link_url)
        except Exception:
            return _installable_or_github_fallback([], term, fetcher, "claude-plugins", link_url)

    raise ValueError("Unsupported skill search source")


def load_prompt_settings(path=None):
    settings_path = Path(path or PROMPT_SETTINGS_PATH)
    settings = read_json_file(settings_path, {"globalPrompt": "", "sessionPrompts": {}})
    if not isinstance(settings, dict):
        settings = {}
    if not isinstance(settings.get("sessionPrompts"), dict):
        settings["sessionPrompts"] = {}
    settings["globalPrompt"] = str(settings.get("globalPrompt", ""))
    return settings


def write_prompt_settings(settings, path=None):
    settings_path = Path(path or PROMPT_SETTINGS_PATH)
    settings_path.parent.mkdir(parents=True, exist_ok=True)
    with open(settings_path, "w", encoding="utf-8") as f:
        json.dump(settings, f, ensure_ascii=False, indent=2)
        f.write("\n")
    return settings


def save_prompt_setting(params, path=None):
    scope = str(params.get("scope", "global")).strip()
    prompt = str(params.get("prompt", "")).strip()
    settings = load_prompt_settings(path=path)
    if scope == "global":
        settings["globalPrompt"] = prompt
    elif scope == "session":
        session_id = str(params.get("sessionId", "")).strip()
        if not session_id:
            raise ValueError("sessionId is required for session prompt")
        if prompt:
            settings["sessionPrompts"][session_id] = prompt
        else:
            settings["sessionPrompts"].pop(session_id, None)
    else:
        raise ValueError("scope must be global or session")
    return write_prompt_settings(settings, path=path)


def effective_prompt(session_id="", path=None):
    settings = load_prompt_settings(path=path)
    session_id = str(session_id or "").strip()
    if session_id and settings["sessionPrompts"].get(session_id):
        return settings["sessionPrompts"][session_id]
    return settings.get("globalPrompt", "")


def create_agent_file(params, project_root=None, claude_dir=None):
    project_root = Path(project_root or os.getcwd())
    claude_dir = Path(claude_dir or CLAUDE_DIR)
    scope = params.get("scope", "project")
    name = safe_name(params.get("name", ""))
    description = params.get("description", "").strip()
    model = params.get("model", "").strip()
    tools = params.get("tools", "").strip()
    prompt = params.get("prompt", "").strip()
    if not description or not prompt:
        raise ValueError("description and prompt are required")

    target_dir = project_root / ".claude" / "agents" if scope == "project" else claude_dir / "agents"
    target_dir.mkdir(parents=True, exist_ok=True)
    target = target_dir / f"{name}.md"

    frontmatter = ["---", f"name: {name}", f"description: {description}"]
    if model:
        frontmatter.append(f"model: {model}")
    if tools:
        frontmatter.append(f"tools: {tools}")
    frontmatter.append("---")
    text = "\n".join(frontmatter) + "\n\n" + prompt.rstrip() + "\n"
    target.write_text(text, encoding="utf-8")
    return {"name": name, "scope": scope, "path": str(target)}


def get_projects():
    """List all project directories under ~/.claude/projects/"""
    if not PROJECTS_DIR.exists():
        return []
    projects = []
    for d in sorted(PROJECTS_DIR.iterdir()):
        if d.is_dir():
            # Convert directory name back to path
            # e.g. "C--Users-Light" -> "C:\Users\Light"
            display_name = decode_project_id(d.name)
            session_count = len(list(d.glob("*.jsonl")))
            projects.append({
                "id": d.name,
                "name": display_name,
                "path": display_name,
                "sessionCount": session_count
            })
    return projects


def parse_jsonl(filepath):
    """Parse a JSONL session file and extract conversation messages."""
    messages = []
    ai_title = None
    message_map = {}  # uuid -> message for tree building

    try:
        with open(filepath, "r", encoding="utf-8") as f:
            for line in f:
                line = line.strip()
                if not line:
                    continue
                try:
                    record = json.loads(line)
                except json.JSONDecodeError:
                    continue

                rtype = record.get("type", "")

                if rtype == "ai-title":
                    ai_title = record.get("aiTitle", "")

                elif rtype == "user":
                    content_parts = []
                    raw_content = record.get("message", {}).get("content", "")
                    if isinstance(raw_content, str):
                        content_parts.append(raw_content)
                    elif isinstance(raw_content, list):
                        for part in raw_content:
                            if isinstance(part, dict):
                                if part.get("type") == "text":
                                    content_parts.append(part.get("text", ""))
                                elif part.get("type") == "tool_result":
                                    content_parts.append(f"[Tool Result: {part.get('tool_use_id', 'unknown')}]")

                    msg = {
                        "type": "user",
                        "uuid": record.get("uuid", ""),
                        "parentUuid": record.get("parentUuid"),
                        "timestamp": record.get("timestamp", ""),
                        "content": "\n".join(content_parts),
                        "isMeta": record.get("isMeta", False),
                        "cwd": record.get("cwd", ""),
                        "gitBranch": record.get("gitBranch", ""),
                        "promptSource": record.get("promptSource", ""),
                    }
                    messages.append(msg)
                    message_map[msg["uuid"]] = msg

                elif rtype == "assistant":
                    content_parts = []
                    tool_uses = []
                    raw_content = record.get("message", {}).get("content", [])
                    if isinstance(raw_content, list):
                        for part in raw_content:
                            if isinstance(part, dict):
                                if part.get("type") == "text":
                                    content_parts.append(part.get("text", ""))
                                elif part.get("type") == "tool_use":
                                    tool_name = part.get("name", "")
                                    tool_input = part.get("input", {})
                                    tool_uses.append({
                                        "name": tool_name,
                                        "input": tool_input,
                                        "id": part.get("id", "")
                                    })
                                    # Create a brief display of the tool call
                                    input_preview = json.dumps(tool_input, ensure_ascii=False)
                                    if len(input_preview) > 200:
                                        input_preview = input_preview[:200] + "..."
                                    content_parts.append(f"[Tool] {tool_name}({input_preview})")
                    elif isinstance(raw_content, str):
                        content_parts.append(raw_content)

                    usage = record.get("message", {}).get("usage", {})
                    msg = {
                        "type": "assistant",
                        "uuid": record.get("uuid", ""),
                        "parentUuid": record.get("parentUuid"),
                        "timestamp": record.get("timestamp", ""),
                        "content": "\n".join(content_parts),
                        "toolUses": tool_uses,
                        "model": record.get("message", {}).get("model", ""),
                        "usage": usage,
                        "stopReason": record.get("message", {}).get("stop_reason", ""),
                    }
                    messages.append(msg)
                    message_map[msg["uuid"]] = msg

    except Exception as e:
        print(f"  [ERROR] parsing {filepath}: {e}", file=sys.stderr)

    return {
        "aiTitle": ai_title,
        "messages": messages,
        "messageCount": len(messages),
    }


def get_file_fingerprint(filepath):
    """Get (size, mtime) as a cache fingerprint."""
    try:
        st = os.stat(filepath)
        return (st.st_size, int(st.st_mtime))
    except OSError:
        return (0, 0)


def get_session_cached(session_id, project_id):
    """Get session data with cache support. Returns (data, cache_hit)."""
    # Find the JSONL file
    project_dir = PROJECTS_DIR / project_id
    if not project_dir.exists():
        return None, False

    jsonl_path = project_dir / f"{session_id}.jsonl"
    if not jsonl_path.exists():
        return None, False

    fingerprint = get_file_fingerprint(str(jsonl_path))
    cache_path = CACHE_DIR / f"{session_id}.json"

    # Check cache
    if cache_path.exists():
        try:
            with open(cache_path, "r", encoding="utf-8") as f:
                cached = json.load(f)
            if cached.get("fingerprint") == list(fingerprint):
                return cached, True  # Cache hit
        except (json.JSONDecodeError, KeyError):
            pass  # Invalid cache, re-parse

    # Cache miss - parse the file
    data = parse_jsonl(str(jsonl_path))
    data["sessionId"] = session_id
    data["projectId"] = project_id
    data["fingerprint"] = list(fingerprint)

    # Save to cache
    try:
        CACHE_DIR.mkdir(parents=True, exist_ok=True)
        with open(cache_path, "w", encoding="utf-8") as f:
            json.dump(data, f, ensure_ascii=False, indent=2)
    except Exception as e:
        print(f"  [WARN] failed to write cache: {e}", file=sys.stderr)

    return data, False


def get_sessions_list(project_id):
    """List all sessions for a project with cache-aware metadata."""
    project_dir = PROJECTS_DIR / project_id
    if not project_dir.exists():
        return []

    project_path = decode_project_id(project_id)
    sessions = []
    for jsonl_file in sorted(project_dir.glob("*.jsonl"), key=lambda f: f.stat().st_mtime, reverse=True):
        session_id = jsonl_file.stem
        fingerprint = get_file_fingerprint(str(jsonl_file))
        cache_path = CACHE_DIR / f"{session_id}.json"

        # Try to get title from cache
        ai_title = None
        message_count = 0
        last_timestamp = ""

        if cache_path.exists():
            try:
                with open(cache_path, "r", encoding="utf-8") as f:
                    cached = json.load(f)
                if cached.get("fingerprint") == list(fingerprint):
                    ai_title = cached.get("aiTitle")
                    message_count = cached.get("messageCount", 0)
                    last_timestamp = cached.get("messages", [{}])[-1].get("timestamp", jsonl_file.stat().st_mtime) if cached.get("messages") else ""
                else:
                    # Need to re-parse for title - do a lightweight parse
                    data, _ = get_session_cached(session_id, project_id)
                    if data:
                        ai_title = data.get("aiTitle")
                        message_count = data.get("messageCount", 0)
                        msgs = data.get("messages", [])
                        last_timestamp = msgs[-1].get("timestamp", "") if msgs else ""
            except (json.JSONDecodeError, KeyError):
                pass
        else:
            # No cache at all - parse to get title
            data, _ = get_session_cached(session_id, project_id)
            if data:
                ai_title = data.get("aiTitle")
                message_count = data.get("messageCount", 0)
                msgs = data.get("messages", [])
                last_timestamp = msgs[-1].get("timestamp", "") if msgs else ""

        # Fallback: use first user message as title
        if not ai_title:
            ai_title = f"Session {session_id[:8]}..."

        # Get file modification time as fallback timestamp
        if not last_timestamp:
            mtime = jsonl_file.stat().st_mtime
            last_timestamp = time.strftime("%Y-%m-%dT%H:%M:%S", time.localtime(mtime))

        sessions.append({
            "id": session_id,
            "title": ai_title,
            "messageCount": message_count,
            "lastTimestamp": last_timestamp,
            "fileSize": jsonl_file.stat().st_size,
            "projectId": project_id,
            "projectPath": project_path,
            "resumeCommand": build_resume_command(project_path, session_id),
        })

    return sessions


class RequestHandler(http.server.SimpleHTTPRequestHandler):
    """Custom handler that serves static files and API endpoints."""

    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(STATIC_DIR), **kwargs)

    def do_GET(self):
        parsed = urlparse(self.path)
        path = parsed.path
        params = parse_qs(parsed.query)

        # API routes
        if path == "/api/projects":
            self._json_response(get_projects())
        elif path == "/api/local/catalog":
            requested_root = params.get("projectRoot", [""])[0]
            requested_project = params.get("project", [""])[0]
            if requested_root or requested_project:
                project_root = resolve_catalog_project_root(
                    project_root=requested_root,
                    project_id=requested_project,
                    fallback=os.getcwd(),
                )
                self._json_response(refresh_local_catalog(project_root=project_root))
            else:
                self._json_response(load_local_catalog(project_root=os.getcwd()))
        elif path == "/api/tasks":
            self._json_response(read_json_file(TASKS_PATH, []))
        elif path == "/api/prompts":
            session_id = params.get("session", [""])[0]
            settings = load_prompt_settings()
            settings["effectivePrompt"] = effective_prompt(session_id)
            self._json_response(settings)
        elif path == "/api/qq-push":
            self._json_response(load_qq_push_summary())
        elif path == "/api/agent-workspace":
            agent_name = params.get("agentName", [""])[0]
            project_root = params.get("projectRoot", [""])[0]
            self._json_response(load_agent_workspace(agent_name, project_root))
        elif path == "/api/sessions":
            project_id = params.get("project", [None])[0]
            if not project_id:
                self._json_response({"error": "Missing 'project' parameter"}, 400)
                return
            self._json_response(get_sessions_list(project_id))
        elif path.startswith("/api/session/"):
            session_id = path.split("/api/session/")[1]
            project_id = params.get("project", [None])[0]
            if not project_id:
                self._json_response({"error": "Missing 'project' parameter"}, 400)
                return
            data, cache_hit = get_session_cached(session_id, project_id)
            if data is None:
                self._json_response({"error": "Session not found"}, 404)
                return
            data["cacheHit"] = cache_hit
            self._json_response(data)
        else:
            # Serve static files
            super().do_GET()

    def do_POST(self):
        parsed = urlparse(self.path)
        path = parsed.path

        try:
            payload = self._read_json_body()
            if path == "/api/local/refresh":
                project_root = resolve_catalog_project_root(
                    project_root=payload.get("projectRoot", ""),
                    project_id=payload.get("project", ""),
                    fallback=os.getcwd(),
                )
                self._json_response(refresh_local_catalog(project_root=project_root))
            elif path == "/api/tasks":
                command_type = payload.get("type", "schtasks")
                command = build_loop_command(payload) if command_type == "loop" else build_task_command(payload)
                record = dict(payload)
                record["command"] = command
                record["createdAt"] = time.strftime("%Y-%m-%dT%H:%M:%S%z")
                append_json_record(TASKS_PATH, record)
                refresh_local_catalog(project_root=os.getcwd())
                self._json_response(record, 201)
            elif path == "/api/tasks/create":
                if payload.get("type", "schtasks") == "loop":
                    raise ValueError("/loop tasks must be run inside Claude; only Windows scheduled tasks can be created here")
                result = create_windows_task(payload)
                record = dict(payload)
                record.update(result)
                record["createdAt"] = time.strftime("%Y-%m-%dT%H:%M:%S%z")
                append_json_record(TASKS_PATH, record)
                refresh_local_catalog(project_root=os.getcwd())
                self._json_response(record, 201 if result["created"] else 500)
            elif path == "/api/mcp/import-json":
                command = build_mcp_import_command(payload.get("name", ""), payload.get("json", ""))
                record = {
                    "name": safe_name(payload.get("name", "")),
                    "command": command,
                    "createdAt": time.strftime("%Y-%m-%dT%H:%M:%S%z"),
                }
                append_json_record(MCP_IMPORTS_PATH, record)
                refresh_local_catalog(project_root=os.getcwd())
                self._json_response(record, 201)
            elif path == "/api/skills/install-command":
                command = build_skill_install_command(payload)
                record = dict(payload)
                record["command"] = command
                record["createdAt"] = time.strftime("%Y-%m-%dT%H:%M:%S%z")
                append_json_record(SKILL_INSTALLS_PATH, record)
                refresh_local_catalog(project_root=os.getcwd())
                self._json_response(record, 201)
            elif path == "/api/skills/install":
                result = install_skill_repository(payload, claude_dir=CLAUDE_DIR)
                record = dict(payload)
                record.update(result)
                record["createdAt"] = time.strftime("%Y-%m-%dT%H:%M:%S%z")
                append_json_record(SKILL_INSTALLS_PATH, record)
                refresh_local_catalog(project_root=os.getcwd())
                self._json_response(record, 201 if result["installed"] else 500)
            elif path == "/api/skills/activate-bundle":
                result = activate_skill_bundle(payload.get("bundlePath", ""), claude_dir=CLAUDE_DIR)
                refresh_local_catalog(project_root=os.getcwd())
                self._json_response(result, 201)
            elif path == "/api/skills/organize-bundle":
                result = organize_skill_bundle(payload.get("bundlePath", ""), claude_dir=CLAUDE_DIR)
                refresh_local_catalog(project_root=os.getcwd())
                self._json_response(result, 201)
            elif path == "/api/skills/search":
                self._json_response({"results": search_skill_repositories(payload.get("query", ""), source=payload.get("source", "github"))})
            elif path == "/api/prompts":
                settings = save_prompt_setting(payload)
                refresh_local_catalog(project_root=os.getcwd())
                self._json_response(settings, 201)
            elif path == "/api/agents":
                project_root = resolve_catalog_project_root(
                    project_root=payload.get("projectRoot", ""),
                    project_id=payload.get("project", ""),
                    fallback=os.getcwd(),
                )
                record = create_agent_file(payload, project_root=project_root, claude_dir=CLAUDE_DIR)
                refresh_local_catalog(project_root=project_root)
                self._json_response(record, 201)
            elif path == "/api/qq-push/profile":
                record = save_qq_push_profile(payload)
                refresh_local_catalog(project_root=os.getcwd())
                self._json_response(record, 201)
            elif path == "/api/qq-push/task":
                command = build_qq_push_task_command(payload)
                record = dict(payload)
                record["type"] = "qq-push"
                record["command"] = command
                record["createdAt"] = time.strftime("%Y-%m-%dT%H:%M:%S%z")
                append_json_record(TASKS_PATH, record)
                refresh_local_catalog(project_root=os.getcwd())
                self._json_response(record, 201)
            elif path == "/api/qq-push/task/create":
                result = create_qq_push_task(payload)
                record = dict(payload)
                record["type"] = "qq-push"
                record.update(result)
                record["createdAt"] = time.strftime("%Y-%m-%dT%H:%M:%S%z")
                append_json_record(TASKS_PATH, record)
                refresh_local_catalog(project_root=os.getcwd())
                self._json_response(record, 201 if result["created"] else 500)
            elif path == "/api/qq-push/run":
                record = run_qq_push_profile(str(payload.get("profileName", "")).strip())
                self._json_response(record, 201)
            elif path == "/api/agent-tasks":
                record = save_agent_task(payload)
                refresh_local_catalog(project_root=payload.get("projectRoot") or os.getcwd())
                self._json_response(record, 201)
            elif path == "/api/agent-connections":
                record = save_agent_connection(payload)
                refresh_local_catalog(project_root=payload.get("projectRoot") or os.getcwd())
                self._json_response(record, 201)
            elif path == "/api/agent-tasks/scheduler-command":
                record = {
                    "command": build_agent_scheduler_task_command(payload),
                    "createdAt": now_timestamp(),
                }
                self._json_response(record, 201)
            elif path == "/api/agent-tasks/create-scheduler":
                result = create_agent_scheduler_task(payload)
                record = dict(payload)
                record.update(result)
                record["createdAt"] = now_timestamp()
                append_json_record(TASKS_PATH, {"type": "agent-scheduler", **record})
                refresh_local_catalog(project_root=os.getcwd())
                self._json_response(record, 201 if result["created"] else 500)
            elif path == "/api/external-agent-tasks/control":
                result = control_windows_task(payload.get("taskName", ""), payload.get("action", ""))
                self._json_response(result, 200 if result["ok"] else 500)
            else:
                self._json_response({"error": "Not found"}, 404)
        except json.JSONDecodeError:
            self._json_response({"error": "Invalid JSON body"}, 400)
        except ValueError as e:
            self._json_response({"error": str(e)}, 400)
        except OSError as e:
            self._json_response({"error": str(e)}, 500)

    def _read_json_body(self):
        length = int(self.headers.get("Content-Length", "0") or "0")
        if length == 0:
            return {}
        body = self.rfile.read(length).decode("utf-8")
        return json.loads(body)

    def _json_response(self, data, code=200):
        body = json.dumps(data, ensure_ascii=False, indent=2).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, format, *args):
        """Override to add timestamp."""
        timestamp = time.strftime("%H:%M:%S")
        print(f"  [{timestamp}] {format % args}")


def main():
    ensure_cache_dir()
    ensure_data_dir()

    # Auto-detect current project
    cwd = os.getcwd()
    project_id = cwd.replace(":", "--").replace(os.sep.replace("\\", "/"), "-")
    if os.sep == "\\":
        project_id = cwd.replace(":", "--").replace("\\", "-")

    cache_str = str(CACHE_DIR)
    data_str = str(DATA_DIR)
    projects_str = str(PROJECTS_DIR)
    refresh_local_catalog(project_root=cwd)
    print("=" * 50)
    print("Claude Code Session Viewer")
    print("=" * 50)
    print(f"URL:      http://localhost:{PORT}")
    print(f"CWD:      {cwd}")
    print(f"Cache:    {cache_str}")
    print(f"Data:     {data_str}")
    print(f"Projects: {projects_str}")
    print("=" * 50)
    print()

    server = http.server.ThreadingHTTPServer(("127.0.0.1", PORT), RequestHandler)
    print(f"  Server started on http://localhost:{PORT}")
    print(f"  Press Ctrl+C to stop\n")

    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\n  Server stopped.")


if __name__ == "__main__":
    # Check for --open flag
    if "--open" in sys.argv:
        webbrowser.open(f"http://localhost:{PORT}")

    main()
