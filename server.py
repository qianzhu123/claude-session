#!/usr/bin/env python3
"""Claude Code Session Viewer - HTTP Server

Serves a web UI for browsing Claude Code conversation sessions.
Reads JSONL session files from ~/.claude/projects/ and caches parsed data as JSON.
"""

import http.server
import json
import os
import stat
import sys
import time
import webbrowser
from urllib.parse import urlparse, parse_qs
from pathlib import Path

# --- Configuration ---
PORT = 8080
CLAUDE_DIR = Path.home() / ".claude"
PROJECTS_DIR = CLAUDE_DIR / "projects"
CACHE_DIR = Path(__file__).parent / "cache"
STATIC_DIR = Path(__file__).parent / "static"


def ensure_cache_dir():
    CACHE_DIR.mkdir(parents=True, exist_ok=True)


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
                                    content_parts.append(f"🔧 {tool_name}({input_preview})")
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

    # Auto-detect current project
    cwd = os.getcwd()
    project_id = cwd.replace(":", "--").replace(os.sep.replace("\\", "/"), "-")
    if os.sep == "\\":
        project_id = cwd.replace(":", "--").replace("\\", "-")

    cache_str = str(CACHE_DIR)
    projects_str = str(PROJECTS_DIR)
    print(f"╔══════════════════════════════════════════════╗")
    print(f"║   Claude Code Session Viewer                 ║")
    print(f"╠══════════════════════════════════════════════╣")
    print(f"║  URL:     http://localhost:{PORT}              ║")
    print(f"║  CWD:     {cwd:<33s}║")
    print(f"║  Cache:   {cache_str:<33s}║")
    print(f"║  Projects: {projects_str:<31s}║")
    print(f"╚══════════════════════════════════════════════╝")
    print()

    server = http.server.HTTPServer(("127.0.0.1", PORT), RequestHandler)
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
