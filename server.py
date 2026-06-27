#!/usr/bin/env python3
"""Claude Code Session Viewer - HTTP Server

Serves a web UI for browsing Claude Code conversation sessions.
Reads JSONL session files from ~/.claude/projects/ and caches parsed data as JSON.
"""

import http.server
import json
import os
import re
import stat
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
        })
    return skills


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


def schtasks_quote(value):
    return '"' + str(value).replace('"', '""') + '"'


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


def github_json_fetcher(url):
    req = urllib.request.Request(url, headers={
        "Accept": "application/vnd.github+json",
        "User-Agent": "claude-session-viewer",
    })
    with urllib.request.urlopen(req, timeout=10) as resp:
        return json.loads(resp.read().decode("utf-8"))


def search_skill_repositories(query, fetcher=None):
    term = str(query or "").strip()
    if not term:
        raise ValueError("query is required")
    fetcher = fetcher or github_json_fetcher
    search_query = f'{term} "SKILL.md" "Claude Code"'
    encoded = urllib.parse.urlencode({
        "q": search_query,
        "sort": "stars",
        "order": "desc",
        "per_page": "10",
    })
    data = fetcher(f"https://api.github.com/search/repositories?{encoded}")
    results = []
    for item in data.get("items", []):
        results.append({
            "name": item.get("name", ""),
            "repoUrl": item.get("html_url", ""),
            "description": item.get("description", ""),
            "stars": item.get("stargazers_count", 0),
        })
    return results


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
            display_name = d.name.replace("--", ":").replace("-", os.sep)
            session_count = len(list(d.glob("*.jsonl")))
            projects.append({
                "id": d.name,
                "name": display_name,
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
            self._json_response(load_local_catalog(project_root=os.getcwd()))
        elif path == "/api/tasks":
            self._json_response(read_json_file(TASKS_PATH, []))
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
                self._json_response(refresh_local_catalog(project_root=os.getcwd()))
            elif path == "/api/tasks":
                command_type = payload.get("type", "schtasks")
                command = build_loop_command(payload) if command_type == "loop" else build_task_command(payload)
                record = dict(payload)
                record["command"] = command
                record["createdAt"] = time.strftime("%Y-%m-%dT%H:%M:%S%z")
                append_json_record(TASKS_PATH, record)
                refresh_local_catalog(project_root=os.getcwd())
                self._json_response(record, 201)
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
            elif path == "/api/skills/search":
                self._json_response({"results": search_skill_repositories(payload.get("query", ""))})
            elif path == "/api/agents":
                record = create_agent_file(payload, project_root=Path(os.getcwd()), claude_dir=CLAUDE_DIR)
                refresh_local_catalog(project_root=os.getcwd())
                self._json_response(record, 201)
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
