import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import Mock

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

    def test_nested_plugin_skills_are_indexed_as_bundle_skills(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            claude_home = root / "home" / ".claude"
            nested_skill = claude_home / "skills" / "cherrystudio-skills" / "skills" / "pdf"
            nested_skill.mkdir(parents=True)
            nested_skill.joinpath("SKILL.md").write_text(
                "---\nname: pdf\ndescription: Work with PDF files\n---\n# PDF\n",
                encoding="utf-8",
            )

            catalog = server.build_local_catalog(project_root=root / "project", claude_dir=claude_home)

            self.assertEqual(catalog["counts"]["skills"], 1)
            self.assertEqual(catalog["skills"][0]["name"], "pdf")
            self.assertEqual(catalog["skills"][0]["sourceType"], "bundle")
            self.assertEqual(catalog["skills"][0]["bundle"], "cherrystudio-skills")

    def test_activate_skill_bundle_copies_missing_nested_skills(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            claude_home = root / ".claude"
            bundle = claude_home / "skills" / "cherrystudio-skills"
            source = bundle / "skills" / "pdf"
            source.mkdir(parents=True)
            source.joinpath("SKILL.md").write_text("# PDF\n", encoding="utf-8")

            result = server.activate_skill_bundle(str(bundle), claude_dir=claude_home)

            self.assertEqual(result["activated"], 1)
            self.assertTrue((claude_home / "skills" / "pdf" / "SKILL.md").exists())
            self.assertEqual(result["skills"][0]["status"], "activated")

    def test_activate_skill_bundle_skips_existing_top_level_skill(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            claude_home = root / ".claude"
            bundle = claude_home / "skills" / "cherrystudio-skills"
            (bundle / "skills" / "pdf").mkdir(parents=True)
            (bundle / "skills" / "pdf" / "SKILL.md").write_text("# PDF bundled\n", encoding="utf-8")
            (claude_home / "skills" / "pdf").mkdir(parents=True)
            (claude_home / "skills" / "pdf" / "SKILL.md").write_text("# PDF existing\n", encoding="utf-8")

            result = server.activate_skill_bundle(str(bundle), claude_dir=claude_home)

            self.assertEqual(result["activated"], 0)
            self.assertEqual(result["skipped"], 1)
            self.assertEqual((claude_home / "skills" / "pdf" / "SKILL.md").read_text(encoding="utf-8"), "# PDF existing\n")

    def test_create_windows_task_executes_schtasks_with_arguments(self):
        runner = Mock()
        runner.return_value.returncode = 0
        runner.return_value.stdout = "SUCCESS"
        runner.return_value.stderr = ""

        result = server.create_windows_task(
            {
                "taskName": "Claude Daily",
                "schedule": "DAILY",
                "startTime": "09:30",
                "cwd": "D:\\code\\myweb\\demo",
                "permissionMode": "plan",
                "prompt": "Run daily checks",
                "force": True,
            },
            runner=runner,
        )

        args = runner.call_args.args[0]
        self.assertEqual(args[:6], ["schtasks", "/Create", "/SC", "DAILY", "/TN", "Claude Daily"])
        self.assertIn("/TR", args)
        self.assertIn("/F", args)
        self.assertEqual(result["returnCode"], 0)
        self.assertEqual(result["stdout"], "SUCCESS")

    def test_skills_sh_search_maps_api_results(self):
        def fake_fetcher(url):
            self.assertIn("skills.sh/api/search", url)
            return {
                "results": [
                    {
                        "name": "pdf",
                        "description": "PDF skill",
                        "repo": "vercel-labs/agent-skills",
                        "url": "https://skills.sh/vercel-labs/agent-skills/pdf",
                    }
                ]
            }

        results = server.search_skill_repositories("pdf", source="skills-sh", fetcher=fake_fetcher)

        self.assertEqual(results[0]["name"], "pdf")
        self.assertEqual(results[0]["repoUrl"], "https://github.com/vercel-labs/agent-skills")
        self.assertTrue(results[0]["installable"])

    def test_install_skill_repository_runs_git_clone(self):
        runner = Mock()
        runner.return_value.returncode = 0
        runner.return_value.stdout = "cloned"
        runner.return_value.stderr = ""

        with tempfile.TemporaryDirectory() as tmp:
            claude_home = Path(tmp) / ".claude"
            result = server.install_skill_repository(
                {"skillName": "writer", "repoUrl": "https://github.com/example/writer.git"},
                claude_dir=claude_home,
                runner=runner,
            )

        self.assertEqual(runner.call_args.args[0], [
            "git",
            "clone",
            "https://github.com/example/writer.git",
            str(claude_home / "skills" / "writer"),
        ])
        self.assertEqual(result["returnCode"], 0)

    def test_claude_plugins_search_extracts_installable_github_links(self):
        def fake_fetcher(url):
            self.assertIn("claude-plugins.com", url)
            return '<a href="https://github.com/example/pdf-skill">PDF Skill</a>'

        results = server.search_skill_repositories("pdf", source="claude-plugins", fetcher=fake_fetcher)

        self.assertEqual(results[0]["repoUrl"], "https://github.com/example/pdf-skill")
        self.assertTrue(results[0]["installable"])

    def test_skill_search_all_sources_deduplicates_installable_results(self):
        def fake_fetcher(url):
            if "api.github.com" in url:
                return {
                    "items": [
                        {
                            "name": "pdf-skill",
                            "html_url": "https://github.com/example/pdf-skill",
                            "description": "PDF from GitHub",
                            "stargazers_count": 7,
                        }
                    ]
                }
            if "skills.sh" in url:
                return {"results": [{"name": "pdf", "repo": "example/pdf-skill"}]}
            if "clawhub.dev" in url:
                return {"data": [{"name": "doc-pdf", "repoUrl": "https://github.com/example/doc-pdf"}]}
            if "claude-plugins.com" in url:
                return '<a href="https://github.com/example/pdf-skill">PDF Skill</a>'
            return {}

        results = server.search_skill_repositories("pdf", source="all", fetcher=fake_fetcher)
        repo_urls = [item["repoUrl"] for item in results]

        self.assertEqual(repo_urls.count("https://github.com/example/pdf-skill"), 1)
        self.assertIn("https://github.com/example/doc-pdf", repo_urls)
        self.assertTrue(all(item["installable"] for item in results))

    def test_prompt_settings_support_global_and_session_override(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "prompt_settings.json"

            global_settings = server.save_prompt_setting(
                {"scope": "global", "prompt": "Always answer in Chinese."},
                path=path,
            )
            session_settings = server.save_prompt_setting(
                {"scope": "session", "sessionId": "abc123", "prompt": "Focus on tests."},
                path=path,
            )

            self.assertEqual(global_settings["globalPrompt"], "Always answer in Chinese.")
            self.assertEqual(session_settings["sessionPrompts"]["abc123"], "Focus on tests.")
            self.assertEqual(server.effective_prompt("abc123", path=path), "Focus on tests.")
            self.assertEqual(server.effective_prompt("missing", path=path), "Always answer in Chinese.")

    def test_organize_skill_bundle_moves_bundle_out_of_skills_root(self):
        with tempfile.TemporaryDirectory() as tmp:
            claude_home = Path(tmp) / ".claude"
            bundle = claude_home / "skills" / "cherrystudio-skills"
            (bundle / "skills" / "pdf").mkdir(parents=True)
            (bundle / "skills" / "pdf" / "SKILL.md").write_text("# PDF\n", encoding="utf-8")

            result = server.organize_skill_bundle(str(bundle), claude_dir=claude_home)

            self.assertFalse(bundle.exists())
            self.assertTrue((claude_home / "skill-bundles" / "cherrystudio-skills" / "skills" / "pdf" / "SKILL.md").exists())
            self.assertEqual(result["status"], "moved")

    def test_home_page_has_return_home_button_for_conversation_view(self):
        html = (Path(__file__).resolve().parents[1] / "static" / "index.html").read_text(encoding="utf-8")

        self.assertIn('id="back-home-btn"', html)
        self.assertIn("返回首页", html)

    def test_home_page_uses_unified_skill_search_and_prompt_controls(self):
        html = (Path(__file__).resolve().parents[1] / "static" / "index.html").read_text(encoding="utf-8")

        self.assertNotIn('id="skill-search-source"', html)
        self.assertIn('id="prompt-scope"', html)
        self.assertIn('id="save-prompt-btn"', html)

    def test_home_page_has_qq_push_controls(self):
        html = (Path(__file__).resolve().parents[1] / "static" / "index.html").read_text(encoding="utf-8")

        self.assertIn('id="qq-profile-name"', html)
        self.assertIn('id="qq-api-base-url"', html)
        self.assertIn('id="qq-payload-preset"', html)
        self.assertIn('id="qq-create-task-btn"', html)

    def test_qq_push_profile_saves_secrets_locally_and_returns_sanitized_status(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "qq_push_config.json"

            result = server.save_qq_push_profile(
                {
                    "profileName": "QQ 4",
                    "apiBaseUrl": "https://52mx.net",
                    "apiKey": "sk-secret",
                    "model": "free/glm-5.1",
                    "botEndpoint": "http://127.0.0.1:3000/send_group_msg",
                    "botToken": "bot-secret",
                    "sessionId": "group:123",
                    "payloadPreset": "generic",
                    "taskPrompt": "Summarize my current tasks.",
                },
                path=path,
            )

            self.assertEqual(result["profileName"], "QQ 4")
            self.assertTrue(result["apiKeySet"])
            self.assertTrue(result["botTokenSet"])
            self.assertNotIn("sk-secret", json.dumps(result))

            saved = json.loads(path.read_text(encoding="utf-8"))
            self.assertEqual(saved["profiles"]["QQ 4"]["apiKey"], "sk-secret")
            self.assertEqual(saved["profiles"]["QQ 4"]["botToken"], "bot-secret")

    def test_qq_push_task_command_does_not_expose_secrets(self):
        command = server.build_qq_push_task_command(
            {
                "profileName": "QQ 4",
                "taskName": "QQ Reminder",
                "schedule": "DAILY",
                "startTime": "09:00",
                "force": True,
            },
            script_path=Path("D:/code/myweb/claude-session-viewer/qq_push_task.py"),
            python_exe="C:/Python/python.exe",
        )

        self.assertIn('schtasks /Create /SC DAILY /TN "QQ Reminder"', command)
        self.assertIn("qq_push_task.py", command)
        self.assertIn("QQ 4", command)
        self.assertIn("/F", command)
        self.assertNotIn("sk-", command)

    def test_render_qq_payload_preset_for_onebot_group(self):
        payload = server.render_qq_payload(
            "onebot_group",
            "",
            session_id="123456",
            message="Daily summary",
        )

        self.assertEqual(payload, {"group_id": "123456", "message": "Daily summary"})


if __name__ == "__main__":
    unittest.main()
