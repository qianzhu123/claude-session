#!/usr/bin/env python3
"""Run due agent automation tasks once.

Windows Task Scheduler should call this script every minute. Cron evaluation and
agent task ownership stay in local JSON files so tasks remain discoverable in
the web UI.
"""

import subprocess
import sys
from pathlib import Path


ROOT = Path(__file__).resolve().parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

import server  # noqa: E402


def due_tasks(now_tuple=None):
    tasks = server.read_json_file(server.AGENT_TASKS_PATH, [])
    if not isinstance(tasks, list):
        return []
    result = []
    for task in tasks:
        if not isinstance(task, dict) or not task.get("enabled", True):
            continue
        try:
            if server.cron_matches(task.get("cron", ""), now_tuple):
                result.append(task)
        except ValueError:
            continue
    return result


def run_task(task, runner=None):
    runner = runner or subprocess.run
    command = server.build_agent_task_run_command(task)
    started_at = server.now_timestamp()
    result = runner(command, shell=True, capture_output=True, text=True, check=False)
    record = {
        "id": server.stable_id("run", task.get("agentName", ""), task.get("id", "")),
        "taskId": task.get("id", ""),
        "agentName": task.get("agentName", ""),
        "agentPath": task.get("agentPath", ""),
        "projectRoot": task.get("projectRoot", ""),
        "command": command,
        "startedAt": started_at,
        "finishedAt": server.now_timestamp(),
        "returnCode": result.returncode,
        "stdout": result.stdout[-4000:] if result.stdout else "",
        "stderr": result.stderr[-4000:] if result.stderr else "",
    }
    server.append_json_record(server.AGENT_RUNS_PATH, record)
    return record


def main():
    ran = 0
    for task in due_tasks():
        run_task(task)
        ran += 1
    print(f"agent_scheduler ran {ran} task(s)")


if __name__ == "__main__":
    main()
