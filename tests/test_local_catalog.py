import json
import tempfile
import unittest
from pathlib import Path

import server


class LocalCatalogTests(unittest.TestCase):
    def test_build_local_catalog_reads_mcp_skills_agents_and_commands(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            claude_home = root / "home" / ".claude"
            project = root / "project"
            (project / ".claude" / "skills" / "writer").mkdir(parents=True)
            (project / ".claude" / "agents").mkdir(parents=True)
            (project / ".claude" / "commands").mkdir(parents=True)
            claude_home.mkdir(parents=True)

            (project / ".mcp.json").write_text(
                json.dumps({"mcpServers": {"fs": {"command": "node", "args": ["server.js"]}}}),
                encoding="utf-8",
            )
            (project / ".claude" / "skills" / "writer" / "SKILL.md").write_text(
                "---\nname: writer\ndescription: Draft text\n---\n# Writer\n",
                encoding="utf-8",
            )
            (project / ".claude" / "agents" / "reviewer.md").write_text(
                "---\nname: reviewer\ndescription: Review code\nmodel: sonnet\n---\nReview only.\n",
                encoding="utf-8",
            )
            (project / ".claude" / "commands" / "check.md").write_text("# Check\n", encoding="utf-8")

            catalog = server.build_local_catalog(project_root=project, claude_dir=claude_home)

            self.assertEqual(catalog["counts"]["mcpServers"], 1)
            self.assertEqual(catalog["mcpServers"][0]["name"], "fs")
            self.assertEqual(catalog["skills"][0]["name"], "writer")
            self.assertEqual(catalog["agents"][0]["name"], "reviewer")
            self.assertEqual(catalog["commands"][0]["name"], "check")

    def test_create_agent_file_writes_project_agent(self):
        with tempfile.TemporaryDirectory() as tmp:
            project = Path(tmp)
            result = server.create_agent_file(
                {
                    "scope": "project",
                    "name": "qa-reviewer",
                    "description": "Checks regressions",
                    "model": "sonnet",
                    "tools": "Read, Grep, Bash",
                    "prompt": "Review the changed files.",
                },
                project_root=project,
                claude_dir=project / "home" / ".claude",
            )

            created = Path(result["path"])
            self.assertTrue(created.exists())
            text = created.read_text(encoding="utf-8")
            self.assertIn("name: qa-reviewer", text)
            self.assertIn("description: Checks regressions", text)
            self.assertIn("Review the changed files.", text)

    def test_task_command_is_generated_from_parameters(self):
        command = server.build_task_command(
            {
                "taskName": "Claude Daily",
                "schedule": "DAILY",
                "startTime": "09:30",
                "cwd": "D:\\code\\myweb\\demo",
                "permissionMode": "plan",
                "prompt": "Run daily checks",
            }
        )

        self.assertIn('schtasks /Create /SC DAILY /TN "Claude Daily"', command)
        self.assertIn('/ST 09:30', command)
        self.assertIn('cd /d ""D:\\code\\myweb\\demo""', command)
        self.assertIn('claude --permission-mode plan ""Run daily checks""', command)

    def test_mcp_json_import_command_validates_json(self):
        command = server.build_mcp_import_command("browser", '{"command":"npx","args":["browser-mcp"]}')
        self.assertEqual(command, 'claude mcp add-json browser "{\\"command\\":\\"npx\\",\\"args\\":[\\"browser-mcp\\"]}"')

    def test_skill_search_maps_repository_results(self):
        def fake_fetcher(url):
            self.assertIn("api.github.com/search/repositories", url)
            return {
                "items": [
                    {
                        "name": "writer-skill",
                        "html_url": "https://github.com/example/writer-skill",
                        "description": "A Claude Code writing skill",
                        "stargazers_count": 12,
                    }
                ]
            }

        results = server.search_skill_repositories("writer", fetcher=fake_fetcher)

        self.assertEqual(results[0]["name"], "writer-skill")
        self.assertEqual(results[0]["repoUrl"], "https://github.com/example/writer-skill")
        self.assertEqual(results[0]["stars"], 12)


if __name__ == "__main__":
    unittest.main()
