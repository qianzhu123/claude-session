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

    def test_decode_project_id_resolves_claude_project_directory_name(self):
        self.assertEqual(server.decode_project_id("D--code-myweb-English"), "D:\\code\\myweb\\English")
        self.assertEqual(server.decode_project_id("C--Users-Light"), "C:\\Users\\Light")

    def test_resolve_catalog_project_root_prefers_manual_path(self):
        with tempfile.TemporaryDirectory() as tmp:
            manual = Path(tmp) / "English"
            manual.mkdir()

            result = server.resolve_catalog_project_root(project_root=str(manual), project_id="C--Users-Light", fallback="D:\\fallback")

            self.assertEqual(result, manual)

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

    def test_read_and_update_agent_file(self):
        with tempfile.TemporaryDirectory() as tmp:
            project = Path(tmp)
            result = server.create_agent_file(
                {
                    "scope": "project",
                    "name": "english-learning-agent",
                    "description": "Old description",
                    "model": "sonnet",
                    "tools": "Read, Grep",
                    "prompt": "Old prompt.",
                },
                project_root=project,
                claude_dir=project / "home" / ".claude",
            )

            loaded = server.read_agent_file(result["path"])
            self.assertEqual(loaded["name"], "english-learning-agent")
            self.assertEqual(loaded["model"], "sonnet")
            self.assertEqual(loaded["tools"], "Read, Grep")
            self.assertEqual(loaded["prompt"], "Old prompt.")

            updated = server.update_agent_file(
                {
                    "path": result["path"],
                    "name": "english-learning-agent",
                    "description": "New description",
                    "model": "opus",
                    "tools": "Read, Grep, Bash",
                    "prompt": "New prompt.",
                }
            )

            self.assertEqual(updated["model"], "opus")
            text = Path(result["path"]).read_text(encoding="utf-8")
            self.assertIn("model: opus", text)
            self.assertIn("New prompt.", text)

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

    def test_mcp_save_and_delete_updates_config_file(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / ".mcp.json"
            saved = server.save_mcp_server(
                {
                    "name": "browser",
                    "path": str(path),
                    "json": '{"command":"npx","args":["browser-mcp"]}',
                }
            )

            self.assertEqual(saved["name"], "browser")
            config = json.loads(path.read_text(encoding="utf-8"))
            self.assertEqual(config["mcpServers"]["browser"]["command"], "npx")

            deleted = server.delete_mcp_server({"name": "browser", "path": str(path)})

            self.assertTrue(deleted["deleted"])
            config = json.loads(path.read_text(encoding="utf-8"))
            self.assertNotIn("browser", config["mcpServers"])

    def test_mcp_disable_and_enable_moves_definition_between_config_and_disabled_list(self):
        with tempfile.TemporaryDirectory() as tmp:
            original_disabled_mcp_path = server.DISABLED_MCP_SERVERS_PATH
            try:
                server.DISABLED_MCP_SERVERS_PATH = Path(tmp) / "disabled_mcp_servers.json"
                path = Path(tmp) / ".mcp.json"
                path.write_text(
                    json.dumps({"mcpServers": {"browser": {"command": "npx", "args": ["browser-mcp"]}}}),
                    encoding="utf-8",
                )

                disabled = server.set_mcp_server_enabled({"name": "browser", "path": str(path), "enabled": False})

                self.assertFalse(disabled["enabled"])
                config = json.loads(path.read_text(encoding="utf-8"))
                self.assertNotIn("browser", config["mcpServers"])
                disabled_records = json.loads(server.DISABLED_MCP_SERVERS_PATH.read_text(encoding="utf-8"))
                self.assertEqual(disabled_records[0]["definition"]["command"], "npx")

                enabled = server.set_mcp_server_enabled({"name": "browser", "path": str(path), "enabled": True})

                self.assertTrue(enabled["enabled"])
                config = json.loads(path.read_text(encoding="utf-8"))
                self.assertEqual(config["mcpServers"]["browser"]["command"], "npx")
                self.assertEqual(json.loads(server.DISABLED_MCP_SERVERS_PATH.read_text(encoding="utf-8")), [])
            finally:
                server.DISABLED_MCP_SERVERS_PATH = original_disabled_mcp_path

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

    def test_skill_disable_and_enable_moves_directory_out_of_active_skills(self):
        with tempfile.TemporaryDirectory() as tmp:
            original_data_dir = server.DATA_DIR
            original_disabled_skills_path = server.DISABLED_SKILLS_PATH
            try:
                root = Path(tmp)
                server.DATA_DIR = root / "data"
                server.DISABLED_SKILLS_PATH = server.DATA_DIR / "disabled_skills.json"
                project = root / "project"
                skill_dir = project / ".claude" / "skills" / "writer"
                skill_dir.mkdir(parents=True)
                (skill_dir / "SKILL.md").write_text(
                    "---\nname: writer\ndescription: Write drafts\n---\n# Writer\n",
                    encoding="utf-8",
                )

                disabled = server.set_skill_enabled({"path": str(skill_dir), "projectRoot": str(project), "enabled": False})

                self.assertFalse(disabled["enabled"])
                self.assertFalse(skill_dir.exists())
                disabled_path = Path(disabled["path"])
                self.assertTrue((disabled_path / "SKILL.md").exists())

                enabled = server.set_skill_enabled({"path": str(disabled_path), "name": "writer", "enabled": True})

                self.assertTrue(enabled["enabled"])
                self.assertTrue((skill_dir / "SKILL.md").exists())
                self.assertEqual(json.loads(server.DISABLED_SKILLS_PATH.read_text(encoding="utf-8")), [])
            finally:
                server.DATA_DIR = original_data_dir
                server.DISABLED_SKILLS_PATH = original_disabled_skills_path

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

    def test_home_page_uses_unified_catalog_and_agent_prompt_controls(self):
        root = Path(__file__).resolve().parents[1]
        html = (root / "static" / "index.html").read_text(encoding="utf-8")
        js = (root / "static" / "app.js").read_text(encoding="utf-8")

        self.assertNotIn('id="skill-search-source"', html)
        self.assertIn('id="catalog-kind-tabs"', html)
        self.assertIn('data-catalog-kind="skills"', html)
        self.assertIn('id="agent-prompt"', html)
        self.assertIn('id="agent-detail-prompt"', js)
        self.assertIn('id="agent-detail-save"', js)

    def test_home_page_keeps_qq_push_controls_out_of_initial_view(self):
        root = Path(__file__).resolve().parents[1]
        html = (root / "static" / "index.html").read_text(encoding="utf-8")
        css = (root / "static" / "style.css").read_text(encoding="utf-8")

        self.assertNotIn('id="qq-profile-name"', html)
        self.assertNotIn('id="qq-api-base-url"', html)
        self.assertNotIn('id="qq-payload-preset"', html)
        self.assertIn("#qq-push-panel", css)

    def test_home_page_has_local_catalog_project_root_control(self):
        html = (Path(__file__).resolve().parents[1] / "static" / "index.html").read_text(encoding="utf-8")

        self.assertIn('id="catalog-project-root"', html)
        self.assertIn('id="catalog-project-root-select"', html)
        self.assertNotIn('id="use-selected-project-root-btn"', html)

    def test_home_page_has_resource_action_modal_and_context_menu(self):
        root = Path(__file__).resolve().parents[1]
        html = (root / "static" / "index.html").read_text(encoding="utf-8")
        js = (root / "static" / "app.js").read_text(encoding="utf-8")

        self.assertIn('id="context-menu"', html)
        self.assertIn("function showContextMenu", js)
        self.assertIn("'/api/mcp/enabled'", js)
        self.assertIn("'/api/skills/enabled'", js)
        self.assertIn("禁用 MCP", js)
        self.assertIn("禁用 Skill", js)
        self.assertNotIn('id="open-mcp-modal-btn"', html)
        self.assertNotIn('id="open-skill-modal-btn"', html)
        self.assertNotIn('id="toggle-local-tools-btn"', html)
        self.assertNotIn('id="focus-search-btn"', html)

    def test_home_page_has_agent_gated_automation_controls(self):
        root = Path(__file__).resolve().parents[1]
        html = (root / "static" / "index.html").read_text(encoding="utf-8")
        css = (root / "static" / "style.css").read_text(encoding="utf-8")
        js = (root / "static" / "app.js").read_text(encoding="utf-8")

        self.assertIn('id="agent-detail-model"', js)
        self.assertIn('id="agent-detail-tools"', js)
        self.assertIn('class="agent-task-cron"', js)
        self.assertIn('data-external-task', js)
        self.assertIn('id="agent-detail-plan-content"', js)
        self.assertIn('class="fullpage-dot active"', html)
        self.assertIn('class="workspace-section local-catalog-section fullpage-section"', html)
        self.assertIn(".agent-detail-card", css)
        self.assertIn("scroll-snap-type", css)
        self.assertIn("select option", css)

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

    def test_agent_task_requires_agent_and_accepts_cron(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "agent_tasks.json"

            record = server.save_agent_task(
                {
                    "agentName": "english-learning-agent",
                    "agentPath": "D:\\code\\myweb\\English\\.claude\\agents\\english-learning-agent.md",
                    "projectRoot": "D:\\code\\myweb\\English",
                    "name": "Morning English",
                    "cron": "30 7 * * *",
                    "sessionPolicy": "new",
                    "prompt": "Prepare today's English plan.",
                    "connectionIds": ["qq-main"],
                },
                path=path,
            )

            self.assertEqual(record["agentName"], "english-learning-agent")
            self.assertEqual(record["cron"], "30 7 * * *")
            self.assertTrue(record["enabled"])
            self.assertEqual(json.loads(path.read_text(encoding="utf-8"))[0]["id"], record["id"])

    def test_delete_agent_task_removes_matching_record(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "agent_tasks.json"
            server.write_json_file(path, [
                {"id": "task-1", "agentName": "english-learning-agent", "projectRoot": "D:\\code\\myweb\\English"},
                {"id": "task-2", "agentName": "other-agent", "projectRoot": "D:\\code\\myweb\\English"},
            ])

            result = server.delete_agent_task(
                {"id": "task-1", "agentName": "english-learning-agent", "projectRoot": "D:\\code\\myweb\\English"},
                path=path,
            )

            self.assertTrue(result["deleted"])
            self.assertEqual([item["id"] for item in server.read_json_file(path, [])], ["task-2"])

    def test_agent_task_resume_and_new_commands_are_project_aware(self):
        new_command = server.build_agent_task_run_command(
            {
                "agentName": "english-learning-agent",
                "projectRoot": "D:\\code\\myweb\\English",
                "sessionPolicy": "new",
                "prompt": "Run daily plan",
            }
        )
        resume_command = server.build_agent_task_run_command(
            {
                "agentName": "english-learning-agent",
                "projectRoot": "D:\\code\\myweb\\English",
                "sessionPolicy": "resume",
                "resumeSessionId": "abc123",
                "prompt": "Continue daily plan",
            }
        )

        self.assertIn('cd /d "D:\\code\\myweb\\English"', new_command)
        self.assertIn('claude --agent english-learning-agent "Run daily plan"', new_command)
        self.assertIn('claude -r abc123 --agent english-learning-agent "Continue daily plan"', resume_command)

    def test_agent_workspace_filters_tasks_connections_and_runs(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            task_path = root / "agent_tasks.json"
            connection_path = root / "agent_connections.json"
            run_path = root / "agent_runs.json"
            server.write_json_file(task_path, [
                {"id": "task-1", "agentName": "english-learning-agent", "projectRoot": "D:\\code\\myweb\\English"},
                {"id": "task-2", "agentName": "other-agent", "projectRoot": "D:\\code\\myweb\\English"},
            ])
            server.write_json_file(connection_path, [
                {"id": "conn-1", "agentName": "english-learning-agent", "projectRoot": "D:\\code\\myweb\\English"},
                {"id": "conn-2", "agentName": "other-agent", "projectRoot": "D:\\code\\myweb\\English"},
            ])
            server.write_json_file(run_path, [
                {"id": "run-1", "agentName": "english-learning-agent", "projectRoot": "D:\\code\\myweb\\English"},
                {"id": "run-2", "agentName": "other-agent", "projectRoot": "D:\\code\\myweb\\English"},
            ])

            workspace = server.load_agent_workspace(
                "english-learning-agent",
                "D:\\code\\myweb\\English",
                task_path=task_path,
                connection_path=connection_path,
                run_path=run_path,
            )

            self.assertEqual([item["id"] for item in workspace["tasks"]], ["task-1"])
            self.assertEqual([item["id"] for item in workspace["connections"]], ["conn-1"])
            self.assertEqual([item["id"] for item in workspace["runs"]], ["run-1"])

    def test_agent_workspace_discovers_project_windows_tasks_and_daily_plan(self):
        with tempfile.TemporaryDirectory() as tmp:
            project = Path(tmp) / "English"
            plan_dir = project / "Agent_Daily_Plans"
            plan_dir.mkdir(parents=True)
            (project / "tools" / "english_agent").mkdir(parents=True)
            (plan_dir / "2026-06-28.json").write_text(
                json.dumps(
                    {
                        "date": "2026-06-28",
                        "schedule": {
                            "morning": {"time": "07:45", "title": "晨间词汇", "task": "背单词"},
                            "review": {"time": "22:30", "title": "复盘", "task": "写总结"},
                        },
                    }
                ),
                encoding="utf-8",
            )
            (plan_dir / "2026-06-28.md").write_text("# 2026-06-28\n\nToday's plan", encoding="utf-8")
            (plan_dir / "qq_targets.json").write_text(json.dumps({"group_openid": "group-1"}), encoding="utf-8")
            (plan_dir / "logs").mkdir()
            (plan_dir / "logs" / "qq_listener.log").write_text("line1\nline2\n", encoding="utf-8")

            def fake_discover(_project_root):
                return [
                    {
                        "id": "external-EnglishAgent-Morning",
                        "source": "windows-scheduled-task",
                        "taskName": "EnglishAgent-Morning",
                        "state": "Ready",
                        "schedule": "Daily 07:45",
                        "command": "python",
                        "arguments": f'"{project}\\tools\\english_agent\\daily_agent.py" --output-dir "{plan_dir}" push morning',
                        "workingDirectory": str(project),
                    }
                ]

            workspace = server.load_agent_workspace(
                "english-learning-agent",
                str(project),
                task_path=project / "missing_tasks.json",
                connection_path=project / "missing_connections.json",
                run_path=project / "missing_runs.json",
                external_task_loader=fake_discover,
            )

            self.assertEqual(workspace["externalTasks"][0]["taskName"], "EnglishAgent-Morning")
            self.assertEqual(workspace["dailyPlan"]["latestJson"]["date"], "2026-06-28")
            self.assertEqual(workspace["dailyPlan"]["latestJson"]["schedule"]["morning"]["task"], "背单词")
            self.assertIn("2026-06-28.md", [item["name"] for item in workspace["dailyPlan"]["planFiles"]])
            self.assertEqual(workspace["dailyPlan"]["qqTargets"]["group_openid"], "group-1")
            self.assertIn("line2", workspace["dailyPlan"]["logs"]["qq_listener.log"])

    def test_windows_task_action_builds_control_argv(self):
        self.assertEqual(
            server.build_windows_task_control_argv("EnglishAgent-Morning", "run"),
            ["schtasks", "/Run", "/TN", "EnglishAgent-Morning"],
        )
        self.assertEqual(
            server.build_windows_task_control_argv("EnglishAgent-Morning", "disable"),
            ["schtasks", "/Change", "/TN", "EnglishAgent-Morning", "/DISABLE"],
        )

    def test_agent_connection_saves_sanitized_secret_status(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "agent_connections.json"

            record = server.save_agent_connection(
                {
                    "agentName": "english-learning-agent",
                    "projectRoot": "D:\\code\\myweb\\English",
                    "name": "qq-main",
                    "type": "qq-onebot",
                    "endpoint": "http://127.0.0.1:3000/send_group_msg",
                    "token": "secret-token",
                    "target": "group:123456",
                },
                path=path,
            )

            self.assertEqual(record["name"], "qq-main")
            self.assertTrue(record["tokenSet"])
            self.assertFalse(record["appSecretSet"])
            self.assertNotIn("secret-token", json.dumps(record))
            saved = json.loads(path.read_text(encoding="utf-8"))
            self.assertEqual(saved[0]["token"], "secret-token")

    def test_agent_connection_saves_qq_app_credentials_safely(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "agent_connections.json"

            record = server.save_agent_connection(
                {
                    "agentName": "english-learning-agent",
                    "projectRoot": "D:\\code\\myweb\\English",
                    "name": "qq-openapi",
                    "type": "qq-openapi",
                    "appId": "1024",
                    "appSecret": "secret-value",
                    "targetType": "group",
                    "target": "group-openid",
                },
                path=path,
            )

            self.assertEqual(record["appId"], "1024")
            self.assertEqual(record["targetType"], "group")
            self.assertTrue(record["appSecretSet"])
            self.assertNotIn("secret-value", json.dumps(record))
            saved = json.loads(path.read_text(encoding="utf-8"))
            self.assertEqual(saved[0]["appSecret"], "secret-value")

    def test_cron_matches_due_minute(self):
        self.assertTrue(server.cron_matches("30 7 * * *", (2026, 6, 28, 7, 30)))
        self.assertFalse(server.cron_matches("30 7 * * *", (2026, 6, 28, 7, 31)))
        self.assertTrue(server.cron_matches("*/5 * * * *", (2026, 6, 28, 7, 30)))
        self.assertTrue(server.cron_matches("30 7 * * 0", (2026, 6, 28, 7, 30)))

    def test_scheduler_task_command_runs_agent_scheduler_every_minute(self):
        command = server.build_agent_scheduler_task_command(
            {
                "taskName": "Claude Agent Scheduler",
                "force": True,
            },
            script_path=Path("D:/code/myweb/claude-session-viewer/agent_scheduler.py"),
            python_exe="C:/Python/python.exe",
        )

        self.assertIn('schtasks /Create /SC MINUTE /MO 1 /TN "Claude Agent Scheduler"', command)
        self.assertIn("agent_scheduler.py", command)
        self.assertIn("/F", command)

    def test_session_list_includes_project_path_and_resume_command(self):
        with tempfile.TemporaryDirectory() as tmp:
            original_projects_dir = server.PROJECTS_DIR
            original_cache_dir = server.CACHE_DIR
            original_session_meta_path = server.SESSION_META_PATH
            try:
                root = Path(tmp)
                server.PROJECTS_DIR = root / "projects"
                server.CACHE_DIR = root / "cache"
                server.SESSION_META_PATH = root / "session_meta.json"
                project_id = "D--code-myweb-English"
                project_dir = server.PROJECTS_DIR / project_id
                project_dir.mkdir(parents=True)
                session_file = project_dir / "abc123.jsonl"
                session_file.write_text(
                    json.dumps(
                        {
                            "type": "user",
                            "uuid": "u1",
                            "timestamp": "2026-06-28T07:30:00",
                            "message": {"content": "hello"},
                        }
                    ) + "\n",
                    encoding="utf-8",
                )

                sessions = server.get_sessions_list(project_id)

                self.assertEqual(sessions[0]["projectPath"], "D:\\code\\myweb\\English")
                self.assertEqual(sessions[0]["resumeCommand"], 'Set-Location -LiteralPath "D:\\code\\myweb\\English"; claude -r abc123')
            finally:
                server.PROJECTS_DIR = original_projects_dir
                server.CACHE_DIR = original_cache_dir
                server.SESSION_META_PATH = original_session_meta_path

    def test_session_alias_and_hidden_meta_affects_session_list(self):
        with tempfile.TemporaryDirectory() as tmp:
            original_projects_dir = server.PROJECTS_DIR
            original_cache_dir = server.CACHE_DIR
            original_session_meta_path = server.SESSION_META_PATH
            try:
                root = Path(tmp)
                server.PROJECTS_DIR = root / "projects"
                server.CACHE_DIR = root / "cache"
                server.SESSION_META_PATH = root / "session_meta.json"
                project_id = "D--code-myweb-English"
                project_dir = server.PROJECTS_DIR / project_id
                project_dir.mkdir(parents=True)
                for session_id in ("abc123", "def456"):
                    (project_dir / f"{session_id}.jsonl").write_text(
                        json.dumps({"type": "user", "uuid": session_id, "message": {"content": session_id}}) + "\n",
                        encoding="utf-8",
                    )
                server.save_session_meta_record(
                    {"projectId": project_id, "sessionId": "abc123", "titleAlias": "Renamed session"},
                )
                server.save_session_meta_record(
                    {"projectId": project_id, "sessionId": "def456", "hidden": True},
                )

                sessions = server.get_sessions_list(project_id)

                self.assertEqual([item["id"] for item in sessions], ["abc123"])
                self.assertEqual(sessions[0]["title"], "Renamed session")
            finally:
                server.PROJECTS_DIR = original_projects_dir
                server.CACHE_DIR = original_cache_dir
                server.SESSION_META_PATH = original_session_meta_path

    def test_delete_session_record_moves_jsonl_to_backup(self):
        with tempfile.TemporaryDirectory() as tmp:
            original_projects_dir = server.PROJECTS_DIR
            original_cache_dir = server.CACHE_DIR
            original_data_dir = server.DATA_DIR
            original_session_meta_path = server.SESSION_META_PATH
            try:
                root = Path(tmp)
                server.PROJECTS_DIR = root / "projects"
                server.CACHE_DIR = root / "cache"
                server.DATA_DIR = root / "data"
                server.SESSION_META_PATH = server.DATA_DIR / "session_meta.json"
                project_id = "D--code-myweb-English"
                project_dir = server.PROJECTS_DIR / project_id
                project_dir.mkdir(parents=True)
                session_file = project_dir / "abc123.jsonl"
                session_file.write_text("{}\n", encoding="utf-8")
                server.CACHE_DIR.mkdir(parents=True)
                (server.CACHE_DIR / "abc123.json").write_text("{}", encoding="utf-8")

                result = server.delete_session_record({"projectId": project_id, "sessionId": "abc123"})

                self.assertTrue(result["deleted"])
                self.assertFalse(session_file.exists())
                self.assertFalse((server.CACHE_DIR / "abc123.json").exists())
                self.assertTrue(Path(result["backupPath"]).exists())
                self.assertTrue(server.session_meta_for(project_id, "abc123")["hidden"])
            finally:
                server.PROJECTS_DIR = original_projects_dir
                server.CACHE_DIR = original_cache_dir
                server.DATA_DIR = original_data_dir
                server.SESSION_META_PATH = original_session_meta_path

    def test_home_project_resume_command_omits_cd(self):
        self.assertEqual(server.build_resume_command("C:\\Users\\Light", "abc123", home_path=Path("C:/Users/Light")), "claude -r abc123")


if __name__ == "__main__":
    unittest.main()
