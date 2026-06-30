/* ============================================
   Claude Code Session Viewer - Frontend Logic
   ============================================ */

(function () {
    'use strict';

    // --- State ---
    let currentProject = '';
    let currentProjectPath = '';
    let currentSessionId = '';
    let sessionsData = [];
    let cacheHits = 0;
    let cacheMisses = 0;
    let activeCatalogKind = 'agents';
    let currentCatalog = null;

    // --- DOM refs ---
    const projectSelect = document.getElementById('project-select');
    const sessionList = document.getElementById('session-list');
    const sessionCount = document.getElementById('session-count');
    const searchInput = document.getElementById('search-input');
    const refreshBtn = document.getElementById('refresh-btn');
    const contentArea = document.getElementById('content-area');
    const welcomeState = document.getElementById('welcome-state');
    const conversationView = document.getElementById('conversation-view');
    const conversationTitle = document.getElementById('conversation-title');
    const metaMessages = document.getElementById('meta-messages');
    const metaTime = document.getElementById('meta-time');
    const metaCache = document.getElementById('meta-cache');
    const resumeCmd = document.getElementById('resume-cmd');
    const copyResumeBtn = document.getElementById('copy-resume-btn');
    const messagesContainer = document.getElementById('messages-container');
    const toast = document.getElementById('toast');
    const toastMsg = document.getElementById('toast-msg');
    const agentPermission = document.getElementById('agent-permission');
    const agentModel = document.getElementById('agent-model');
    const agentEffort = document.getElementById('agent-effort');
    const agentCustomModelWrap = document.getElementById('agent-custom-model-wrap');
    const agentCustomModel = document.getElementById('agent-custom-model');
    const agentCwd = document.getElementById('agent-cwd');
    const agentPrompt = document.getElementById('agent-prompt');
    const agentExtraFlags = document.getElementById('agent-extra-flags');
    const generatedAgentCommand = document.getElementById('generated-agent-command');
    const refreshLocalBtn = document.getElementById('refresh-local-btn');
    const catalogProjectRoot = document.getElementById('catalog-project-root');
    const catalogProjectRootSelect = document.getElementById('catalog-project-root-select');
    const catalogProjectRootPills = document.getElementById('catalog-project-root-pills');
    const catalogKindTabs = document.getElementById('catalog-kind-tabs');
    const catalogActiveKindLabel = document.getElementById('catalog-active-kind-label');
    const catalogActiveTitle = document.getElementById('catalog-active-title');
    const catalogUpdated = document.getElementById('catalog-updated');
    const mcpList = document.getElementById('mcp-list');
    const skillList = document.getElementById('skill-list');
    const agentList = document.getElementById('agent-list');
    const commandList = document.getElementById('command-list');
    const contextMenu = document.getElementById('context-menu');
    const backHomeBtn = document.getElementById('back-home-btn');

    // --- API helpers ---
    async function api(url) {
        const resp = await fetch(url);
        if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
        return resp.json();
    }

    async function apiPost(url, payload) {
        const resp = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload || {}),
        });
        const data = await resp.json();
        if (!resp.ok) throw new Error(data.error || `HTTP ${resp.status}`);
        return data;
    }

    // --- Toast ---
    function showToast(msg) {
        toastMsg.textContent = msg;
        toast.style.display = 'block';
        toast.style.animation = 'none';
        void toast.offsetWidth;
        toast.style.animation = 'toast-in 0.2s ease, toast-out 0.2s ease 1.8s forwards';
        setTimeout(() => {
            toast.style.display = 'none';
        }, 2200);
    }

    function showContextMenu(x, y, items) {
        if (!contextMenu) return;
        hideContextMenu();
        contextMenu.innerHTML = '';
        items.forEach(item => {
            const button = document.createElement('button');
            button.type = 'button';
            button.textContent = item.label;
            button.addEventListener('click', () => {
                hideContextMenu();
                item.action();
            });
            contextMenu.appendChild(button);
        });
        contextMenu.style.left = `${x}px`;
        contextMenu.style.top = `${y}px`;
        contextMenu.style.display = 'block';
    }

    function hideContextMenu() {
        if (contextMenu) contextMenu.style.display = 'none';
    }

    // --- Format helpers ---
    function formatTime(ts) {
        if (!ts) return '';
        try {
            const d = new Date(ts);
            if (isNaN(d.getTime())) return ts;
            return formatTimestamp(ts);
        } catch {
            return ts;
        }
    }

    function formatTimestamp(ts) {
        if (!ts) return '';
        try {
            const d = new Date(ts);
            if (isNaN(d.getTime())) return ts;
            const pad = (n) => String(n).padStart(2, '0');
            return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}-${pad(d.getMinutes())}-${pad(d.getSeconds())}`;
        } catch {
            return ts;
        }
    }

    function formatFileSize(bytes) {
        if (bytes < 1024) return bytes + ' B';
        if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
        return (bytes / 1024 / 1024).toFixed(1) + ' MB';
    }

    // Simple markdown-like rendering
    function renderContent(text) {
        if (!text) return '';
        let html = escapeHtml(text);

        // Code blocks: ```...```
        html = html.replace(/```(\w*)\n?([\s\S]*?)```/g, (_, lang, code) => {
            return `<pre><code class="lang-${lang}">${code.trim()}</code></pre>`;
        });

        // Inline code: `...`
        html = html.replace(/`([^`]+)`/g, '<code>$1</code>');

        // Bold: **...**
        html = html.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');

        // Italic: *...*
        html = html.replace(/(?<!\*)\*([^*]+)\*(?!\*)/g, '<em>$1</em>');

        // Links: [text](url)
        html = html.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');

        // Tool use pattern: [Tool] ToolName(...)
        html = html.replace(/\[Tool\] (\w+)\(([\s\S]*?\))/g, (match, name, input) => {
            return `<div class="tool-use-block">[Tool] ${escapeHtml(name)}(${escapeHtml(input)})</div>`;
        });

        // Paragraphs (double newline)
        const parts = html.split(/\n\n+/);
        html = parts
            .map(part => {
                part = part.trim();
                if (!part) return '';
                if (part.startsWith('<pre>') || part.startsWith('<div class="tool-use')) return part;
                part = part.replace(/\n/g, '<br>');
                return `<p>${part}</p>`;
            })
            .filter(Boolean)
            .join('');

        return html;
    }

    function escapeHtml(text) {
        const map = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' };
        return String(text).replace(/[&<>"']/g, c => map[c]);
    }

    function quoteArg(value) {
        const normalized = String(value || '').trim();
        if (!normalized) return '';
        return `"${normalized.replace(/"/g, '\\"')}"`;
    }

    function quotePowerShell(value) {
        const normalized = String(value || '').trim();
        if (!normalized) return '';
        return `"${normalized.replace(/`/g, '``').replace(/"/g, '`"')}"`;
    }

    function normalizePath(value) {
        return String(value || '').trim().replace(/\//g, '\\').replace(/\\+$/, '').toLowerCase();
    }

    function isDefaultHomePath(value) {
        return normalizePath(value) === 'c:\\users\\light';
    }

    function withPowerShellLocation(cwd, command) {
        if (!cwd || isDefaultHomePath(cwd)) return command;
        return `Set-Location -LiteralPath ${quotePowerShell(cwd)}; ${command}`;
    }

    function buildAgentCommand() {
        if (!generatedAgentCommand) return;

        const model = agentModel?.value || '';
        const effort = agentEffort?.value || '';
        const permission = agentPermission?.value || 'default';
        const cwd = agentCwd?.value.trim();
        const prompt = agentPrompt?.value.trim();
        const extraFlags = agentExtraFlags?.value.trim();

        const parts = ['claude'];

        if (model) {
            if (model === 'custom') {
                const customModel = agentCustomModel?.value.trim();
                if (customModel) parts.push('--model', customModel);
            } else {
                parts.push('--model', model);
            }
        }

        if (effort) {
            parts.push('--effort', effort);
        }

        if (permission !== 'default') {
            parts.push('--permission-mode', permission);
        }

        if (prompt) {
            parts.push(quoteArg(prompt));
        }

        if (extraFlags) {
            parts.push(extraFlags);
        }

        let command = parts.join(' ');
        if (cwd) {
            command = withPowerShellLocation(cwd, command);
        }
        generatedAgentCommand.textContent = command;
    }

    function showHome() {
        currentSessionId = '';
        if (history.replaceState) history.replaceState(null, '', location.pathname);
        document.querySelectorAll('.session-card').forEach(el => el.classList.remove('active'));
        if (conversationView) conversationView.style.display = 'none';
        if (welcomeState) welcomeState.style.display = 'flex';
        if (contentArea) contentArea.scrollTop = 0;
    }

    function readValue(id) {
        const el = document.getElementById(id);
        return el ? el.value.trim() : '';
    }

    function setValue(id, value) {
        const el = document.getElementById(id);
        if (el && value !== undefined && value !== null) el.value = value;
    }

    function encodeData(value) {
        return encodeURIComponent(JSON.stringify(value || {}));
    }

    function decodeData(value) {
        try {
            return JSON.parse(decodeURIComponent(value || '%7B%7D'));
        } catch {
            return {};
        }
    }

    async function openLocalPath(path) {
        if (!path) {
            showToast('缺少本地路径');
            return;
        }
        try {
            const resp = await fetch('/api/open-path', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ path }),
            });
            if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
        } catch (e) {
            showToast(`打开路径失败：${e.message}`);
        }
    }

    function renderResourceList(container, items, emptyText, formatter, kind = '') {
        if (!container) return;
        container.innerHTML = '';
        if (!items || items.length === 0) {
            container.innerHTML = `<div class="resource-empty">${escapeHtml(emptyText)}</div>`;
            return;
        }
        items.slice(0, 20).forEach(item => {
            const row = document.createElement('div');
            row.className = 'resource-row' + (item.disabled ? ' is-disabled' : '');
            row.dataset.menuKind = kind;
            row.dataset.menuItem = encodeData(item);
            row.innerHTML = formatter(item);
            container.appendChild(row);
        });
    }

    function renderLocalCatalog(catalog) {
        if (!catalog || !catalog.counts) return;
        currentCatalog = catalog;
        const counts = catalog.counts;
        if (catalogUpdated) {
            catalogUpdated.innerHTML = `已读取本地索引：<code>data/catalog.json</code>，更新时间 ${escapeHtml(catalog.generatedAt || '')}`;
        }
        document.querySelectorAll('[data-count-key]').forEach(node => {
            node.textContent = counts[node.dataset.countKey] || 0;
        });
        renderResourceList(mcpList, catalog.mcpServers, '未发现本地 MCP 配置', item => `
            <strong>${escapeHtml(item.name)}</strong>
            <span>${item.disabled ? '<b class="resource-status disabled">已禁用</b> · ' : ''}${escapeHtml(item.scope)} · ${escapeHtml(item.transport || '')}</span>
            <code>${escapeHtml(item.command || item.url || item.path || '')}</code>
        `, 'mcp');
        renderResourceList(skillList, catalog.skills, '未发现本地 Skill', item => `
            <strong>${escapeHtml(item.name)}</strong>
            <span>${item.disabled ? '<b class="resource-status disabled">已禁用</b> · ' : ''}${escapeHtml(item.scope)} · ${escapeHtml(item.description || 'no description')}</span>
            <code>${escapeHtml(item.originalPath || item.path || '')}</code>
        `, 'skill');
        renderResourceList(agentList, catalog.agents, '未发现本地 Agent', item => `
            <strong>${escapeHtml(item.name)}</strong>
            <span>${escapeHtml(item.scope)} · ${escapeHtml(item.description || 'no description')}</span>
            <code>${escapeHtml(item.path || '')}</code>
        `, 'agent');
        renderResourceList(commandList, catalog.commands, '未发现本地 slash command', item => `
            <strong>/${escapeHtml(item.name)}</strong>
            <span>${escapeHtml(item.scope)}</span>
            <code>${escapeHtml(item.path || '')}</code>
        `, 'command');
        setActiveCatalogKind(activeCatalogKind);
    }

    function setActiveCatalogKind(kind = 'agents') {
        activeCatalogKind = kind;
        const map = {
            agents: { list: agentList, label: 'Agents', title: '本地 Agent' },
            commands: { list: commandList, label: 'Commands', title: 'Slash Commands' },
            mcp: { list: mcpList, label: 'MCP', title: 'MCP Servers' },
            skills: { list: skillList, label: 'Skills', title: 'Skills' },
        };
        Object.entries(map).forEach(([key, meta]) => {
            meta.list?.classList.toggle('active', key === kind);
        });
        document.querySelectorAll('[data-catalog-kind]').forEach(button => {
            button.classList.toggle('active', button.dataset.catalogKind === kind);
        });
        if (catalogActiveKindLabel) catalogActiveKindLabel.textContent = map[kind]?.label || 'Local Index';
        if (catalogActiveTitle) catalogActiveTitle.textContent = map[kind]?.title || '选中分类后直接展示';
    }

    function currentCatalogRoot() {
        return readValue('catalog-project-root') || currentProjectPath || '';
    }

    async function loadLocalCatalog(refresh = false) {
        try {
            const projectRoot = currentCatalogRoot();
            const catalog = refresh
                ? await (await fetch('/api/local/refresh', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ project: currentProject, projectRoot }),
                })).json()
                : await api(`/api/local/catalog?project=${encodeURIComponent(currentProject)}&projectRoot=${encodeURIComponent(projectRoot)}`);
            renderLocalCatalog(catalog);
            if (catalogProjectRoot && catalog.projectRoot) {
                catalogProjectRoot.value = catalog.projectRoot;
            }
            if (refresh) showToast('本地索引已刷新');
        } catch (e) {
            console.error('Failed to load local catalog:', e);
            showToast(`本地索引读取失败：${e.message}`);
        }
    }

    // --- Context menu items ---
    function contextItemsFor(kind, item) {
        if (kind === 'session') {
            return [
                { label: '编辑', action: () => showEditSessionDialog(item) },
                { label: '删除', action: () => showDeleteSessionDialog(item) },
            ];
        }
        if (kind === 'mcp') {
            return [
                {
                    label: item.disabled ? '启用 MCP' : '禁用 MCP',
                    action: async () => {
                        try {
                            await apiPost('/api/mcp/enabled', {
                                name: item.name,
                                path: item.path,
                                scope: item.scope,
                                enabled: !!item.disabled,
                                projectRoot: currentCatalogRoot(),
                            });
                            showToast(item.disabled ? 'MCP 已启用' : 'MCP 已禁用');
                            loadLocalCatalog(true);
                        } catch (e) {
                            showToast(`MCP 状态修改失败：${e.message}`);
                        }
                    },
                },
                { label: '打开配置位置', action: () => openLocalPath(item.path || '') },
                { label: '复制 MCP 名称', action: () => copyText(item.name || '') },
                {
                    label: '删除 MCP',
                    action: async () => {
                        if (!confirm(`删除 MCP：${item.name}？`)) return;
                        try {
                            await apiPost('/api/mcp/delete', {
                                name: item.name,
                                path: item.path,
                                projectRoot: currentCatalogRoot(),
                            });
                            showToast('MCP 已删除');
                            loadLocalCatalog(true);
                        } catch (e) {
                            showToast(`删除 MCP 失败：${e.message}`);
                        }
                    },
                },
            ];
        }
        if (kind === 'skill') {
            return [
                {
                    label: item.disabled ? '启用 Skill' : '禁用 Skill',
                    action: async () => {
                        try {
                            await apiPost('/api/skills/enabled', {
                                name: item.name,
                                path: item.path,
                                scope: item.scope,
                                sourceType: item.sourceType,
                                enabled: !!item.disabled,
                                projectRoot: currentCatalogRoot(),
                            });
                            showToast(item.disabled ? 'Skill 已启用' : 'Skill 已禁用');
                            loadLocalCatalog(true);
                        } catch (e) {
                            showToast(`Skill 状态修改失败：${e.message}`);
                        }
                    },
                },
                { label: '打开 Skill 文件', action: () => openLocalPath(item.path || '') },
                { label: '复制 Skill 路径', action: () => copyText(item.path || '') },
                {
                    label: '删除 Skill',
                    action: async () => {
                        if (!confirm(`删除 Skill：${item.name}？`)) return;
                        try {
                            await apiPost('/api/skills/delete', {
                                path: item.path,
                                projectRoot: currentCatalogRoot(),
                            });
                            showToast('Skill 已删除');
                            loadLocalCatalog(true);
                        } catch (e) {
                            showToast(`删除 Skill 失败：${e.message}`);
                        }
                    },
                },
            ];
        }
        if (kind === 'agent') {
            return [
                { label: '查看详情', action: () => showAgentDetailDialog(item) },
                { label: '打开 Agent 文件', action: () => openLocalPath(item.path || '') },
            ];
        }
        if (kind === 'mcp') {
            // mcp already has entries, nothing extra needed
        }
        return [];
    }

    // --- Agent detail dialog ---
    async function showAgentDetailDialog(item) {
        const backdrop = document.createElement('div');
        backdrop.className = 'modal-backdrop';
        backdrop.innerHTML = `
            <div class="agent-detail-card action-modal-card">
                <div class="agent-detail-header">
                    <div>
                        <div class="agent-detail-kicker">Agent · ${escapeHtml(item.scope || 'local')}</div>
                        <h2>${escapeHtml(item.name || '')}</h2>
                        <p>${escapeHtml(item.path || '')}</p>
                    </div>
                    <button class="btn-icon" data-modal-close title="关闭">×</button>
                </div>
                <div class="agent-detail-body">
                    <section class="agent-detail-section">
                        <div class="agent-detail-section-title">
                            <span>设置</span>
                            <button class="btn-secondary" id="agent-detail-save">保存 Agent</button>
                        </div>
                        <div class="agent-settings-grid">
                            <label><span>名称</span><input id="agent-detail-name" type="text" value="${escapeHtml(item.name || '')}"></label>
                            <label><span>模型</span><input id="agent-detail-model" type="text" value="${escapeHtml(item.model || '')}" placeholder="sonnet / opus / free/glm-5.1"></label>
                            <label class="wide"><span>描述</span><input id="agent-detail-description" type="text" value="${escapeHtml(item.description || '')}"></label>
                            <label class="wide"><span>工具</span><input id="agent-detail-tools" type="text" value="${escapeHtml(item.tools || '')}" placeholder="Read, Write, Bash"></label>
                            <label class="wide"><span>提示词</span><textarea id="agent-detail-prompt" rows="10">加载中...</textarea></label>
                        </div>
                    </section>
                    <section class="agent-detail-section">
                        <div class="agent-detail-section-title">
                            <span>定时任务</span>
                            <button class="btn-secondary" id="agent-task-add">新增本地 Cron 任务</button>
                        </div>
                        <div id="agent-detail-tasks-content" class="agent-task-stack"><span class="resource-empty">加载中...</span></div>
                    </section>
                    <section class="agent-detail-section">
                        <div class="agent-detail-section-title"><span>计划与连接</span></div>
                        <div id="agent-detail-plan-content" class="agent-plan-grid"><span class="resource-empty">加载中...</span></div>
                    </section>
                </div>
            </div>
        `;
        document.body.appendChild(backdrop);

        const closeDialog = () => backdrop.remove();
        backdrop.querySelector('[data-modal-close]').addEventListener('click', closeDialog);
        backdrop.addEventListener('click', (e) => { if (e.target === backdrop) closeDialog(); });

        const promptInput = backdrop.querySelector('#agent-detail-prompt');
        const tasksEl = backdrop.querySelector('#agent-detail-tasks-content');
        const planEl = backdrop.querySelector('#agent-detail-plan-content');

        let agentFile = { ...item, prompt: '' };
        let workspace = { tasks: [], externalTasks: [], connections: [], runs: [], dailyPlan: {} };

        async function refreshWorkspace() {
            try {
                workspace = await api(`/api/agent-workspace?agentName=${encodeURIComponent(item.name)}&projectRoot=${encodeURIComponent(currentCatalogRoot())}`);
                renderAgentTaskEditor(workspace);
                renderAgentPlanSummary(workspace);
            } catch (e) {
                tasksEl.innerHTML = `<div class="resource-empty">读取任务失败：${escapeHtml(e.message)}</div>`;
                planEl.innerHTML = `<div class="resource-empty">读取计划失败：${escapeHtml(e.message)}</div>`;
            }
        }

        try {
            agentFile = await api(`/api/agent-file?path=${encodeURIComponent(item.path)}`);
            setValue('agent-detail-name', agentFile.name || item.name || '');
            setValue('agent-detail-description', agentFile.description || '');
            setValue('agent-detail-model', agentFile.model || '');
            setValue('agent-detail-tools', agentFile.tools || '');
            promptInput.value = agentFile.prompt || '';
        } catch (e) {
            promptInput.value = `读取失败：${e.message}`;
        }

        backdrop.querySelector('#agent-detail-save').addEventListener('click', async () => {
            try {
                const record = await apiPost('/api/agents/update', {
                    path: item.path,
                    name: readValue('agent-detail-name'),
                    description: readValue('agent-detail-description'),
                    model: readValue('agent-detail-model'),
                    tools: readValue('agent-detail-tools'),
                    prompt: readValue('agent-detail-prompt'),
                    projectRoot: currentCatalogRoot(),
                });
                item.name = record.name;
                showToast('Agent 已保存');
                loadLocalCatalog(true);
            } catch (e) {
                showToast(`Agent 保存失败：${e.message}`);
            }
        });

        backdrop.querySelector('#agent-task-add').addEventListener('click', () => {
            const draft = {
                id: '',
                agentName: readValue('agent-detail-name') || item.name,
                agentPath: item.path,
                projectRoot: currentCatalogRoot(),
                name: 'Daily check',
                cron: '30 7 * * *',
                enabled: true,
                sessionPolicy: 'new',
                prompt: 'Run the configured daily task.',
            };
            workspace.tasks = [draft, ...(workspace.tasks || [])];
            renderAgentTaskEditor(workspace);
        });

        function renderAgentTaskEditor(data) {
            const localTasks = data.tasks || [];
            const externalTasks = data.externalTasks || [];
            let html = '';
            if (localTasks.length) {
                html += `<div class="agent-task-group-title">本地 Cron 任务</div>`;
                html += localTasks.map(task => `
                    <div class="agent-task-card" data-local-task="${escapeHtml(encodeData(task))}">
                        <div class="agent-task-card-head">
                            <input class="agent-task-name" value="${escapeHtml(task.name || '')}" placeholder="任务名称">
                            <select class="agent-task-enabled">
                                <option value="true" ${task.enabled !== false ? 'selected' : ''}>启用</option>
                                <option value="false" ${task.enabled === false ? 'selected' : ''}>停用</option>
                            </select>
                        </div>
                        <div class="agent-task-grid">
                            <label><span>Cron</span><input class="agent-task-cron" value="${escapeHtml(task.cron || '30 7 * * *')}"></label>
                            <label><span>会话策略</span><select class="agent-task-policy"><option value="new" ${task.sessionPolicy !== 'resume' ? 'selected' : ''}>新会话</option><option value="resume" ${task.sessionPolicy === 'resume' ? 'selected' : ''}>恢复会话</option></select></label>
                            <label class="wide"><span>恢复会话 ID</span><input class="agent-task-resume" value="${escapeHtml(task.resumeSessionId || '')}"></label>
                            <label class="wide"><span>任务目标</span><textarea class="agent-task-prompt" rows="3">${escapeHtml(task.prompt || '')}</textarea></label>
                        </div>
                        <div class="button-row">
                            <button class="btn-secondary" data-agent-task-save>保存任务</button>
                            ${task.id ? '<button class="btn-secondary" data-agent-task-delete>删除任务</button>' : ''}
                        </div>
                    </div>
                `).join('');
            }
            if (externalTasks.length) {
                html += `<div class="agent-task-group-title">Windows 计划任务</div>`;
                html += externalTasks.map(task => `
                    <div class="agent-task-card external">
                        <div class="agent-task-card-head">
                            <strong>${escapeHtml(task.taskName || '')}</strong>
                            <span>${escapeHtml(task.state || '')}</span>
                        </div>
                        <div class="agent-task-meta">${escapeHtml(task.schedule || '')}</div>
                        <code>${escapeHtml([task.command, task.arguments].filter(Boolean).join(' '))}</code>
                        <div class="button-row">
                            <button class="btn-secondary" data-external-task="${escapeHtml(task.taskName || '')}" data-external-action="run">运行</button>
                            <button class="btn-secondary" data-external-task="${escapeHtml(task.taskName || '')}" data-external-action="enable">启用</button>
                            <button class="btn-secondary" data-external-task="${escapeHtml(task.taskName || '')}" data-external-action="disable">停用</button>
                            <button class="btn-secondary" data-external-task="${escapeHtml(task.taskName || '')}" data-external-action="stop">停止</button>
                        </div>
                    </div>
                `).join('');
            }
            tasksEl.innerHTML = html || `<div class="resource-empty">未找到相关定时任务。可点击“新增本地 Cron 任务”创建。</div>`;
        }

        function renderAgentPlanSummary(data) {
            const plan = data.dailyPlan || {};
            const connections = data.connections || [];
            const runs = data.runs || [];
            planEl.innerHTML = `
                <div class="agent-plan-card"><strong>计划目录</strong><code>${escapeHtml(plan.path || '')}</code><span>${plan.exists ? '已发现' : '未发现'}</span></div>
                <div class="agent-plan-card"><strong>最新计划</strong><code>${escapeHtml(plan.latestJsonPath || plan.latestMarkdownPath || '无')}</code><span>${escapeHtml(plan.latestJson?.date || '')}</span></div>
                <div class="agent-plan-card"><strong>连接</strong><span>${connections.length} 个</span><code>${escapeHtml(connections.map(c => c.name || c.type).join(', ') || '无')}</code></div>
                <div class="agent-plan-card"><strong>运行记录</strong><span>${runs.length} 条</span><code>${escapeHtml((runs[0]?.updatedAt || runs[0]?.createdAt || ''))}</code></div>
            `;
        }

        tasksEl.addEventListener('click', async (e) => {
            const saveBtn = e.target.closest('[data-agent-task-save]');
            const deleteBtn = e.target.closest('[data-agent-task-delete]');
            const externalBtn = e.target.closest('[data-external-task]');
            try {
                if (saveBtn || deleteBtn) {
                    const card = e.target.closest('[data-local-task]');
                    const original = decodeData(card.dataset.localTask);
                    if (deleteBtn) {
                        if (!confirm('删除这个本地 Agent 定时任务？')) return;
                        await apiPost('/api/agent-tasks/delete', { id: original.id, agentName: item.name, projectRoot: currentCatalogRoot() });
                        showToast('任务已删除');
                        await refreshWorkspace();
                        return;
                    }
                    const payload = {
                        id: original.id || '',
                        agentName: readValue('agent-detail-name') || item.name,
                        agentPath: item.path,
                        projectRoot: currentCatalogRoot(),
                        name: card.querySelector('.agent-task-name').value.trim(),
                        cron: card.querySelector('.agent-task-cron').value.trim(),
                        enabled: card.querySelector('.agent-task-enabled').value === 'true',
                        sessionPolicy: card.querySelector('.agent-task-policy').value,
                        resumeSessionId: card.querySelector('.agent-task-resume').value.trim(),
                        prompt: card.querySelector('.agent-task-prompt').value.trim(),
                    };
                    await apiPost('/api/agent-tasks', payload);
                    showToast('任务已保存');
                    await refreshWorkspace();
                } else if (externalBtn) {
                    await apiPost('/api/external-agent-tasks/control', {
                        taskName: externalBtn.dataset.externalTask,
                        action: externalBtn.dataset.externalAction,
                    });
                    showToast('计划任务操作已执行');
                    await refreshWorkspace();
                }
            } catch (err) {
                showToast(`任务操作失败：${err.message}`);
            }
        });

        await refreshWorkspace();
    }

    // Delegated click on agent resource rows to open detail
    document.addEventListener('click', (e) => {
        const row = e.target.closest('.resource-row[data-menu-kind="agent"]');
        if (!row) return;
        // Ignore if it was a button inside the row
        if (e.target.closest('button')) return;
        const item = decodeData(row.dataset.menuItem);
        if (item && item.name) showAgentDetailDialog(item);
    });

    // --- Session edit dialog ---
    function showEditSessionDialog(item) {
        const currentTitle = item.titleAlias || item.originalTitle || item.title || '';
        const backdrop = document.createElement('div');
        backdrop.className = 'modal-backdrop';
        backdrop.innerHTML = `
            <div class="action-modal-card" style="width:min(420px,100%);">
                <div class="modal-header">
                    <h3>编辑会话名称</h3>
                </div>
                <div class="modal-form">
                    <label style="display:flex;flex-direction:column;gap:8px;">
                        <span style="font-size:12px;font-weight:500;color:var(--colors-muted);">会话名称</span>
                        <input type="text" id="edit-session-name" value="${escapeHtml(currentTitle)}" style="width:100%;min-height:40px;border:1px solid var(--colors-surface-cream-strong);border-radius:var(--r-md);background:var(--colors-canvas);color:var(--colors-ink);font-family:var(--font-body);font-size:14px;padding:9px 12px;" />
                    </label>
                </div>
                <div class="modal-actions" style="display:flex;justify-content:flex-end;gap:8px;margin-top:16px;">
                    <button class="btn-secondary" data-modal-cancel>取消</button>
                    <button class="btn-primary" data-modal-confirm>保存</button>
                </div>
            </div>
        `;
        document.body.appendChild(backdrop);

        const input = backdrop.querySelector('#edit-session-name');
        input.focus();
        input.select();

        backdrop.querySelector('[data-modal-cancel]').addEventListener('click', () => backdrop.remove());
        backdrop.addEventListener('click', (e) => { if (e.target === backdrop) backdrop.remove(); });
        backdrop.querySelector('[data-modal-confirm]').addEventListener('click', async () => {
            const newTitle = input.value.trim();
            try {
                await fetch('/api/sessions/meta', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        projectId: item.projectId,
                        sessionId: item.id,
                        titleAlias: newTitle,
                    }),
                });
                showToast('会话名称已更新');
                backdrop.remove();
                loadSessions();
            } catch (e) {
                showToast(`更新失败：${e.message}`);
            }
        });
        input.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') backdrop.querySelector('[data-modal-confirm]').click();
            if (e.key === 'Escape') backdrop.remove();
        });
    }

    // --- Session delete dialog ---
    function showDeleteSessionDialog(item) {
        const backdrop = document.createElement('div');
        backdrop.className = 'modal-backdrop';
        backdrop.innerHTML = `
            <div class="action-modal-card" style="width:min(460px,100%);">
                <div class="modal-header">
                    <h3>删除会话</h3>
                </div>
                <div class="modal-form">
                    <p style="font-size:14px;color:var(--colors-body);margin-bottom:16px;">确定要删除会话「${escapeHtml(item.title)}」吗？</p>
                    <div style="display:flex;flex-direction:column;gap:12px;">
                        <button class="btn-secondary" data-delete="soft" style="width:100%;display:flex;flex-direction:column;align-items:flex-start;padding:14px 16px;border:1px solid var(--colors-surface-cream-strong);border-radius:var(--r-lg);background:var(--colors-canvas);cursor:pointer;text-align:left;transition:all 0.15s ease;">
                            <strong style="font-size:14px;color:var(--colors-ink);">在界面中删除</strong>
                            <span style="font-size:12px;color:var(--colors-muted);margin-top:4px;">标记为已删除，不再显示，会话文件仍保留在磁盘</span>
                        </button>
                        <button class="btn-secondary" data-delete="local" style="width:100%;display:flex;flex-direction:column;align-items:flex-start;padding:14px 16px;border:1px solid rgba(198,69,69,0.3);border-radius:var(--r-lg);background:#fef8f8;cursor:pointer;text-align:left;transition:all 0.15s ease;">
                            <strong style="font-size:14px;color:var(--colors-error);">本地删除（移至回收站）</strong>
                            <span style="font-size:12px;color:var(--colors-muted);margin-top:4px;">将文件移至系统回收站，可从回收站恢复</span>
                        </button>
                    </div>
                </div>
                <div class="modal-actions" style="display:flex;justify-content:flex-end;gap:8px;margin-top:16px;">
                    <button class="btn-secondary" data-modal-cancel>取消</button>
                </div>
            </div>
        `;
        document.body.appendChild(backdrop);

        backdrop.querySelector('[data-modal-cancel]').addEventListener('click', () => backdrop.remove());
        backdrop.addEventListener('click', (e) => { if (e.target === backdrop) backdrop.remove(); });

        // Soft delete (hide from UI)
        backdrop.querySelector('[data-delete="soft"]').addEventListener('click', async () => {
            try {
                const resp = await fetch('/api/sessions/delete', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        projectId: item.projectId,
                        sessionId: item.id,
                    }),
                });
                if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
                showToast('会话已从界面中删除');
                backdrop.remove();
                // If viewing the deleted session, go home
                if (currentSessionId === item.id) showHome();
                loadSessions();
            } catch (e) {
                showToast(`删除失败：${e.message}`);
            }
        });

        // Local delete (recycle bin)
        backdrop.querySelector('[data-delete="local"]').addEventListener('click', async () => {
            try {
                const resp = await fetch('/api/sessions/delete-local', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        projectId: item.projectId,
                        sessionId: item.id,
                    }),
                });
                if (!resp.ok) {
                    const err = await resp.json().catch(() => ({}));
                    throw new Error(err.error || `HTTP ${resp.status}`);
                }
                showToast('会话文件已移至回收站');
                backdrop.remove();
                if (currentSessionId === item.id) showHome();
                loadSessions();
            } catch (e) {
                showToast(`删除失败：${e.message}`);
            }
        });
    }

    // --- Recycle bin dialog ---
    async function showRecycleBinDialog() {
        const backdrop = document.createElement('div');
        backdrop.className = 'modal-backdrop';
        backdrop.innerHTML = `
            <div class="action-modal-card recycle-bin-card" style="width:min(640px,100%);">
                <div class="modal-header" style="border-bottom:1px solid var(--colors-surface-cream-strong);padding-bottom:var(--sp-md);">
                    <div style="display:flex;align-items:center;gap:var(--sp-sm);">
                        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--colors-primary)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                            <polyline points="3 6 5 6 21 6"/>
                            <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>
                        </svg>
                        <h3 style="font-family:var(--font-display);font-size:22px;font-weight:400;color:var(--colors-ink);letter-spacing:0;margin:0;">会话回收站</h3>
                    </div>
                    <button class="btn-icon" data-modal-close title="关闭" style="width:32px;height:32px;border-color:var(--colors-surface-cream-strong);">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
                    </button>
                </div>
                <div class="recycle-bin-body" style="max-height:min(480px,60vh);overflow-y:auto;padding:var(--sp-md) 0;">
                    <div class="loading" style="padding:var(--sp-xxl);">加载中</div>
                </div>
                <div style="padding:var(--sp-md) 0 0;border-top:1px solid var(--colors-surface-cream-strong);display:flex;justify-content:flex-end;">
                    <span class="recycle-bin-count" style="font-size:12px;color:var(--colors-muted);"></span>
                </div>
            </div>
        `;
        document.body.appendChild(backdrop);

        const closeDialog = () => backdrop.remove();
        backdrop.querySelector('[data-modal-close]').addEventListener('click', closeDialog);
        backdrop.addEventListener('click', (e) => { if (e.target === backdrop) closeDialog(); });

        // Load deleted sessions
        const body = backdrop.querySelector('.recycle-bin-body');
        const countEl = backdrop.querySelector('.recycle-bin-count');
        try {
            const deleted = await api('/api/sessions/deleted');
            if (!deleted || deleted.length === 0) {
                body.innerHTML = `<div class="resource-empty" style="text-align:center;padding:var(--sp-xxl);color:var(--colors-muted-soft);font-size:14px;">回收站为空，没有已删除的会话</div>`;
                countEl.textContent = '0 项';
                return;
            }
            countEl.textContent = `${deleted.length} 项`;
            body.innerHTML = '';
            deleted.forEach(item => {
                const row = document.createElement('div');
                row.className = 'recycle-bin-row';
                const title = item.titleAlias || `Session ${item.sessionId.slice(0, 8)}...`;
                const proj = item.projectPath || item.projectId;
                const delTime = item.updatedAt ? formatTimestamp(item.updatedAt) : '未知';
                const delMethod = item.deleteMethod === 'local' ? '本地删除' : '界面删除';
                const hasBackup = !!item.backupFile;
                row.innerHTML = `
                    <div class="recycle-bin-info">
                        <div class="recycle-bin-title">${escapeHtml(title)}</div>
                        <div class="recycle-bin-meta">
                            <span>${escapeHtml(proj)}</span>
                            <span class="recycle-bin-badge ${item.deleteMethod}">${delMethod}</span>
                            <span>${delTime}</span>
                        </div>
                    </div>
                    <div class="recycle-bin-actions">
                        ${item.deleteMethod === 'soft' ? `<button class="btn-mini recycle-restore-btn" data-sid="${escapeHtml(item.sessionId)}" data-pid="${escapeHtml(item.projectId)}">恢复</button>` : ''}
                        ${hasBackup ? `<button class="btn-mini recycle-trash-btn" data-sid="${escapeHtml(item.sessionId)}" data-pid="${escapeHtml(item.projectId)}" style="color:var(--colors-error);border-color:rgba(198,69,69,0.3);">移至回收站</button>` : ''}
                    </div>
                `;
                body.appendChild(row);
            });

            // Restore buttons
            backdrop.querySelectorAll('.recycle-restore-btn').forEach(btn => {
                btn.addEventListener('click', async () => {
                    try {
                        const resp = await fetch('/api/sessions/restore', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ projectId: btn.dataset.pid, sessionId: btn.dataset.sid }),
                        });
                        if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
                        showToast('会话已恢复');
                        closeDialog();
                        loadSessions();
                    } catch (e) {
                        showToast(`恢复失败：${e.message}`);
                    }
                });
            });

            // Trash backup buttons
            backdrop.querySelectorAll('.recycle-trash-btn').forEach(btn => {
                btn.addEventListener('click', async () => {
                    try {
                        const resp = await fetch('/api/sessions/trash-backup', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ projectId: btn.dataset.pid, sessionId: btn.dataset.sid }),
                        });
                        if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
                        showToast('备份已移至回收站');
                        closeDialog();
                        loadSessions();
                    } catch (e) {
                        showToast(`操作失败：${e.message}`);
                    }
                });
            });
        } catch (e) {
            body.innerHTML = `<div class="resource-empty" style="text-align:center;padding:var(--sp-xxl);color:var(--colors-error);">加载失败：${escapeHtml(e.message)}</div>`;
        }
    }

    async function copyText(text) {
        const normalized = String(text || '').replace(/`n/g, '\n');
        if (!normalized.trim()) return;

        try {
            await navigator.clipboard.writeText(normalized);
            showToast('已复制到剪贴板');
        } catch {
            const textarea = document.createElement('textarea');
            textarea.value = normalized;
            textarea.setAttribute('readonly', '');
            textarea.style.position = 'fixed';
            textarea.style.opacity = '0';
            document.body.appendChild(textarea);
            textarea.select();
            try {
                document.execCommand('copy');
                showToast('已复制到剪贴板');
            } catch {
                showToast('复制失败，请手动选择复制');
            } finally {
                textarea.remove();
            }
        }
    }

    // --- Load projects ---
    async function loadProjects() {
        try {
            const projects = await api('/api/projects');
            projectSelect.innerHTML = '';
            if (catalogProjectRootSelect) catalogProjectRootSelect.innerHTML = '';

            if (projects.length === 0) {
                projectSelect.innerHTML = '<option value="">未找到项目</option>';
                if (catalogProjectRootSelect) catalogProjectRootSelect.innerHTML = '<option value="">未找到项目</option>';
                return;
            }

            projects.forEach(p => {
                const opt = document.createElement('option');
                opt.value = p.id;
                opt.dataset.path = p.path || p.name || '';
                opt.textContent = `${p.name} (${p.sessionCount})`;
                projectSelect.appendChild(opt);
                if (catalogProjectRootSelect) {
                    const rootOpt = document.createElement('option');
                    rootOpt.value = p.path || p.name || '';
                    rootOpt.textContent = `${p.name} (${p.sessionCount})`;
                    catalogProjectRootSelect.appendChild(rootOpt);
                }
                if (catalogProjectRootPills) {
                    const pill = document.createElement('button');
                    pill.type = 'button';
                    pill.className = 'catalog-project-pill';
                    pill.dataset.projectRoot = p.path || p.name || '';
                    pill.title = p.path || p.name || '';
                    pill.innerHTML = `<span>${escapeHtml(p.name)}</span><small>${p.sessionCount} 会话</small>`;
                    catalogProjectRootPills.appendChild(pill);
                }
            });

            // Auto-select first project
            currentProject = projects[0].id;
            currentProjectPath = projects[0].path || projects[0].name || '';
            projectSelect.value = currentProject;
            if (catalogProjectRoot && !catalogProjectRoot.value.trim()) {
                catalogProjectRoot.value = currentProjectPath;
            }
            if (catalogProjectRootSelect) catalogProjectRootSelect.value = currentProjectPath;
            document.querySelectorAll('.catalog-project-pill').forEach(pill => {
                pill.classList.toggle('active', normalizePath(pill.dataset.projectRoot) === normalizePath(currentProjectPath));
            });
            loadLocalCatalog(true);
            loadSessions();
        } catch (e) {
            console.error('Failed to load projects:', e);
            projectSelect.innerHTML = '<option value="">加载失败</option>';
        }
    }

    // --- Load sessions ---
    async function loadSessions() {
        if (!currentProject) return;

        sessionList.innerHTML = '<div class="loading">加载中</div>';
        refreshBtn.classList.add('spinning');

        try {
            sessionsData = await api(`/api/sessions?project=${encodeURIComponent(currentProject)}`);
            sessionCount.textContent = sessionsData.length;
            renderSessionList(sessionsData);
        } catch (e) {
            console.error('Failed to load sessions:', e);
            sessionList.innerHTML = '<div class="empty-state"><p>加载会话失败</p></div>';
        } finally {
            refreshBtn.classList.remove('spinning');
        }
    }

    // --- Render session list ---
    function renderSessionList(sessions) {
        sessionList.innerHTML = '';

        if (sessions.length === 0) {
            sessionList.innerHTML = '<div class="empty-state"><p>暂无会话</p></div>';
            return;
        }

        sessions.forEach(s => {
            const card = document.createElement('div');
            card.className = 'session-card' + (s.id === currentSessionId ? ' active' : '');
            card.dataset.id = s.id;
            card.dataset.menuKind = 'session';
            card.dataset.menuItem = encodeData(s);

            card.innerHTML = `
                <div class="session-card-title" title="${escapeHtml(s.title)}">${escapeHtml(s.title)}</div>
                <div class="session-project" title="${escapeHtml(s.projectPath || '')}">${escapeHtml(s.projectPath || currentProjectPath || '')}</div>
                <div class="session-card-meta">
                    <span class="msg-count">${s.messageCount} 条</span>
                    <span class="time">${formatTime(s.lastTimestamp)}</span>
                    <span style="margin-left:auto;font-size:11px;color:var(--colors-muted-soft)">${formatFileSize(s.fileSize)}</span>
                </div>
            `;

            card.addEventListener('click', () => {
                selectSession(s.id);
            });

            sessionList.appendChild(card);
        });
    }

    // --- Search filter ---
    searchInput.addEventListener('input', () => {
        const q = searchInput.value.toLowerCase().trim();
        if (!q) {
            renderSessionList(sessionsData);
            return;
        }
        const filtered = sessionsData.filter(s =>
            s.title.toLowerCase().includes(q) || s.id.toLowerCase().includes(q)
        );
        renderSessionList(filtered);
    });

    // --- Select session ---
    async function selectSession(id) {
        currentSessionId = id;
        if (history.replaceState) history.replaceState(null, '', location.pathname + '#session-' + id);

        // Update active state
        document.querySelectorAll('.session-card').forEach(el => {
            el.classList.toggle('active', el.dataset.id === id);
        });

        // Show conversation view
        welcomeState.style.display = 'none';
        conversationView.style.display = 'flex';
        messagesContainer.innerHTML = '<div class="loading">加载对话中</div>';

        try {
            const data = await api(`/api/session/${id}?project=${encodeURIComponent(currentProject)}`);

            // Update header — use aliased title if available
            const sessionMeta = sessionsData.find(s => s.id === id);
            const displayTitle = sessionMeta?.titleAlias || data.aiTitle || `会话 ${id.slice(0, 8)}`;
            conversationTitle.textContent = displayTitle;
            metaMessages.textContent = `${data.messageCount} 条消息`;
            metaTime.textContent = data.messages.length > 0
                ? formatTimestamp(data.messages[data.messages.length - 1].timestamp)
                : '';
            metaCache.textContent = data.cacheHit ? '缓存命中' : '新解析';
            metaCache.className = 'meta-badge ' + (data.cacheHit ? 'cache-hit' : 'cache-miss');

            // Update resume command
            resumeCmd.textContent = sessionMeta?.resumeCommand || withPowerShellLocation(currentProjectPath, `claude -r ${id}`);

            // Render messages
            renderMessages(data.messages);

            if (data.cacheHit) cacheHits++;
            else cacheMisses++;
            console.log(`[Cache] hit=${cacheHits} miss=${cacheMisses} total=${cacheHits + cacheMisses}`);
        } catch (e) {
            console.error('Failed to load session:', e);
            messagesContainer.innerHTML = '<div class="empty-state"><p>加载会话失败</p></div>';
        }
    }

    // --- Render messages ---
    function renderMessages(messages) {
        messagesContainer.innerHTML = '';

        if (!messages || messages.length === 0) {
            messagesContainer.innerHTML = '<div class="empty-state"><p>此会话暂无消息</p></div>';
            return;
        }

        messages.forEach(msg => {
            const bubble = document.createElement('div');
            bubble.className = `message-bubble ${msg.type}`;

            const role = msg.type === 'user' ? '用户' : 'Claude';
            const time = formatTimestamp(msg.timestamp);

            let extraInfo = '';
            if (msg.type === 'assistant') {
                if (msg.model) {
                    extraInfo += `<span class="model-badge">${escapeHtml(msg.model)}</span>`;
                }
                if (msg.usage) {
                    const inp = msg.usage.input_tokens || msg.usage.cache_read_input_tokens || 0;
                    const out = msg.usage.output_tokens || 0;
                    if (inp || out) {
                        extraInfo += `<div class="token-usage">tokens: ${inp}→${out}</div>`;
                    }
                }
            }

            bubble.innerHTML = `
                <div class="message-role">${role}${extraInfo}</div>
                <div class="message-content">${renderContent(msg.content)}</div>
                <div class="message-time">${time}</div>
            `;

            messagesContainer.appendChild(bubble);
        });

        // Scroll to bottom
        messagesContainer.scrollTop = 0;
    }

    // --- Copy resume command ---
    copyResumeBtn.addEventListener('click', async () => {
        const cmd = resumeCmd.textContent;
        try {
            await navigator.clipboard.writeText(cmd);
            copyResumeBtn.classList.add('copied');
            copyResumeBtn.querySelector('span').textContent = '已复制';
            showToast('已复制到剪贴板');
            setTimeout(() => {
                copyResumeBtn.classList.remove('copied');
                copyResumeBtn.querySelector('span').textContent = '复制';
            }, 2000);
        } catch {
            const range = document.createRange();
            range.selectNode(resumeCmd);
            window.getSelection().removeAllRanges();
            window.getSelection().addRange(range);
            try {
                document.execCommand('copy');
                showToast('已复制到剪贴板');
            } catch {
                showToast('复制失败，请手动选择复制');
            }
        }
    });

    document.addEventListener('click', (e) => {
        const trigger = e.target.closest('[data-copy], [data-copy-text]');
        if (!trigger) return;

        if (trigger.dataset.copyText) {
            copyText(trigger.dataset.copyText);
            return;
        }

        const target = document.querySelector(trigger.dataset.copy);
        if (target) {
            copyText(target.textContent);
        }
    });

    [agentModel, agentEffort, agentPermission, agentCwd, agentPrompt, agentExtraFlags].forEach(el => {
        if (el) {
            el.addEventListener('input', buildAgentCommand);
            el.addEventListener('change', () => {
                // Toggle custom model input visibility
                if (el === agentModel && agentCustomModelWrap) {
                    agentCustomModelWrap.style.display = agentModel.value === 'custom' ? '' : 'none';
                }
                buildAgentCommand();
            });
        }
    });

    if (agentCustomModel) {
        agentCustomModel.addEventListener('input', buildAgentCommand);
    }

    if (agentPrompt) {
        agentPrompt.addEventListener('input', () => {
            agentPrompt.dataset.autoPrompt = 'false';
        });
    }

    if (refreshLocalBtn) {
        refreshLocalBtn.addEventListener('click', () => loadLocalCatalog(true));
    }

    if (backHomeBtn) {
        backHomeBtn.addEventListener('click', showHome);
    }

    const recycleBinBtn = document.getElementById('recycle-bin-btn');
    if (recycleBinBtn) {
        recycleBinBtn.addEventListener('click', showRecycleBinDialog);
    }

    document.addEventListener('contextmenu', (e) => {
        const sessionCard = e.target.closest('.session-card');
        const resourceRow = e.target.closest('.resource-row');
        const target = sessionCard || resourceRow;
        if (!target) return;

        let kind, item;
        if (sessionCard) {
            kind = target.dataset.menuKind;
            item = decodeData(target.dataset.menuItem);
        } else if (resourceRow) {
            kind = target.dataset.menuKind || '';
            item = decodeData(target.dataset.menuItem);
        }

        const items = contextItemsFor(kind, item);
        if (items.length === 0) return;
        e.preventDefault();
        showContextMenu(e.clientX, e.clientY, items);
    });

    document.addEventListener('click', (e) => {
        if (!e.target.closest('.context-menu')) hideContextMenu();
    });

    // Hide context menu on any scroll (capture phase catches all scrollable children)
    document.addEventListener('scroll', () => hideContextMenu(), true);
    window.addEventListener('wheel', () => hideContextMenu(), { passive: true });
    window.addEventListener('resize', () => hideContextMenu());
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') hideContextMenu();
    });

    // --- Event listeners ---
    projectSelect.addEventListener('change', () => {
        currentProject = projectSelect.value;
        currentProjectPath = projectSelect.selectedOptions[0]?.dataset.path || '';
        if (catalogProjectRoot) {
            catalogProjectRoot.value = currentProjectPath;
        }
        if (catalogProjectRootSelect) {
            catalogProjectRootSelect.value = currentProjectPath;
        }
        document.querySelectorAll('.catalog-project-pill').forEach(pill => {
            pill.classList.toggle('active', normalizePath(pill.dataset.projectRoot) === normalizePath(currentProjectPath));
        });
        currentSessionId = '';
        conversationView.style.display = 'none';
        welcomeState.style.display = 'flex';
        loadLocalCatalog(true);
        loadSessions();
    });

    if (catalogProjectRoot) {
        catalogProjectRoot.addEventListener('change', () => {
            if (catalogProjectRootSelect) catalogProjectRootSelect.value = catalogProjectRoot.value;
            loadLocalCatalog(true);
        });
    }

    if (catalogProjectRootSelect) {
        catalogProjectRootSelect.addEventListener('change', () => {
            if (catalogProjectRoot) catalogProjectRoot.value = catalogProjectRootSelect.value;
            document.querySelectorAll('.catalog-project-pill').forEach(pill => {
                pill.classList.toggle('active', normalizePath(pill.dataset.projectRoot) === normalizePath(catalogProjectRootSelect.value));
            });
            loadLocalCatalog(true);
        });
    }

    if (catalogProjectRootPills) {
        catalogProjectRootPills.addEventListener('click', (e) => {
            const pill = e.target.closest('.catalog-project-pill');
            if (!pill) return;
            const root = pill.dataset.projectRoot || '';
            if (catalogProjectRoot) catalogProjectRoot.value = root;
            if (catalogProjectRootSelect) catalogProjectRootSelect.value = root;
            document.querySelectorAll('.catalog-project-pill').forEach(item => item.classList.toggle('active', item === pill));
            loadLocalCatalog(true);
        });
    }

    if (catalogKindTabs) {
        catalogKindTabs.addEventListener('click', (e) => {
            const button = e.target.closest('[data-catalog-kind]');
            if (!button) return;
            setActiveCatalogKind(button.dataset.catalogKind || 'agents');
        });
    }

    refreshBtn.addEventListener('click', () => {
        loadSessions();
        // If viewing a session, reload it; otherwise stay on home
        if (currentSessionId) {
            selectSession(currentSessionId);
        }
    });

    // --- Handle hash-based initial session navigation ---
    function navigateFromHash() {
        const hash = location.hash;
        if (hash && hash.startsWith('#session-')) {
            const sessionId = hash.replace('#session-', '');
            if (sessionId && currentProject) {
                selectSession(sessionId);
            }
        }
    }

    window.addEventListener('hashchange', () => {
        const hash = location.hash;
        if (hash && hash.startsWith('#session-')) {
            const sessionId = hash.replace('#session-', '');
            if (sessionId && sessionId !== currentSessionId && currentProject) {
                selectSession(sessionId);
            }
        } else if (!hash && currentSessionId) {
            showHome();
        }
    });

    document.addEventListener('click', (e) => {
        const dot = e.target.closest('[data-section-target]');
        if (!dot) return;
        const section = document.getElementById(dot.dataset.sectionTarget);
        if (section) section.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });

    contentArea?.addEventListener('scroll', () => {
        const sections = Array.from(document.querySelectorAll('.fullpage-section')).filter(section => getComputedStyle(section).display !== 'none');
        if (!sections.length) return;
        const contentRect = contentArea.getBoundingClientRect();
        let activeId = sections[0].id;
        let smallestOffset = Number.POSITIVE_INFINITY;
        sections.forEach(section => {
            const rect = section.getBoundingClientRect();
            const offset = Math.abs(rect.top - contentRect.top);
            if (offset < smallestOffset) {
                smallestOffset = offset;
                activeId = section.id;
            }
        });
        document.querySelectorAll('.fullpage-dot').forEach(dot => {
            dot.classList.toggle('active', dot.dataset.sectionTarget === activeId);
        });
    }, { passive: true });

    // --- Keyboard shortcuts ---
    document.addEventListener('keydown', (e) => {
        // Ctrl+R: refresh
        if (e.ctrlKey && e.key === 'r') {
            e.preventDefault();
            refreshBtn.click();
        }
        // Escape: go back to welcome
        if (e.key === 'Escape') {
            showHome();
        }
        // /: focus search
        if (e.key === '/' && !e.ctrlKey && !e.altKey) {
            if (document.activeElement !== searchInput) {
                e.preventDefault();
                searchInput.focus();
            }
        }
    });

    // --- Init ---
    buildAgentCommand();
    loadLocalCatalog();
    loadProjects().then(() => {
        navigateFromHash();
    });
})();
