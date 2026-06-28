#!/usr/bin/env python3
"""Run a saved QQ push profile once.

The scheduled task created by the web UI calls this script with a profile name.
Secrets stay in data/qq_push_config.json instead of the Windows task command.
"""

import argparse
import sys
from pathlib import Path


ROOT = Path(__file__).resolve().parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

import server  # noqa: E402


def main():
    parser = argparse.ArgumentParser(description="Run a Claude Session Viewer QQ push profile")
    parser.add_argument("--profile", required=True, help="Profile name saved in data/qq_push_config.json")
    parser.add_argument("--config", help="Optional config path for testing or custom deployments")
    args = parser.parse_args()

    result = server.run_qq_push_profile(args.profile, config_path=args.config)
    print(f"sent profile={result['profileName']} message_length={len(result['message'])}")


if __name__ == "__main__":
    main()
