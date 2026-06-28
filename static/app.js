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
    let promptSettings = { globalPrompt: '', sessionPrompts: {} };
    let selectedAgent = null;

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
    const conversationMeta = document.getElementById('conversation-meta');
    const metaMessages = document.getElementById('meta-messages');
    const metaTime = document.getElementById('meta-time');
    const metaCache = document.getElementById('meta-cache');
    const resumeCmd = document.getElementById('resume-cmd');
    const copyResumeBtn = document.getElementById('copy-resume-btn');
    const messagesContainer = document.getElementById('messages-container');
    const toast = document.getElementById('toast');
    const toastMsg = document.getElementById('toast-msg');
    const focusSearchBtn = document.getElementById('focus-search-btn');
    const agentPermission = document.getElementById('agent-permission');
    const agentCwd = document.getElementById('agent-cwd');
    const agentPrompt = document.getElementById('agent-prompt');
    const generatedAgentCommand = document.getElementById('generated-agent-command');
    const refreshLocalBtn = document.getElementById('refresh-local-btn');
    const catalogProjectRoot = document.getElementById('catalog-project-root');
    const catalogProjectRootSelect = document.getElementById('catalog-project-root-select');
    const useSelectedProjectRootBtn = document.getElementById('use-selected-project-root-btn');
    const catalogUpdated = document.getElementById('catalog-updated');
    const localSummary = document.getElementById('local-summary');
    const mcpList = document.getElementById('mcp-list');
    const skillList = document.getElementById('skill-list');
    const agentList = document.getElementById('agent-list');
    const commandList = document.getElementById('command-list');
    const mcpImportBtn = document.getElementById('mcp-import-btn');
    const mcpCommand = document.getElementById('mcp-command');
    const skillSearchBtn = document.getElementById('skill-search-btn');
    const skillSearchResults = document.getElementById('skill-search-results');
    const skillInstallBtn = document.getElementById('skill-install-btn');
    const skillCloneBtn = document.getElementById('skill-clone-btn');
    const activateSkillBundleBtn = document.getElementById('activate-skill-bundle-btn');
    const organizeSkillBundleBtn = document.getElementById('organize-skill-bundle-btn');
    const skillCommand = document.getElementById('skill-command');
    const skillActionResult = document.getElementById('skill-action-result');
    const saveTaskBtn = document.getElementById('save-task-btn');
    const createTaskBtn = document.getElementById('create-task-btn');
    const taskCommand = document.getElementById('task-command');
    const createAgentBtn = document.getElementById('create-agent-btn');
    const updateAgentBtn = document.getElementById('update-agent-btn');
    const agentCreateResult = document.getElementById('agent-create-result');
    const backHomeBtn = document.getElementById('back-home-btn');
    const promptScope = document.getElementById('prompt-scope');
    const promptSessionId = document.getElementById('prompt-session-id');
    const promptSettingText = document.getElementById('prompt-setting-text');
    const savePromptBtn = document.getElementById('save-prompt-btn');
    const loadEffectivePromptBtn = document.getElementById('load-effective-prompt-btn');
    const promptSettingResult = document.getElementById('prompt-setting-result');
    const effectivePromptLabel = document.getElementById('effective-prompt-label');
    const effectivePromptPreview = document.getElementById('effective-prompt-preview');
    const qqSaveProfileBtn = document.getElementById('qq-save-profile-btn');
    const qqRunOnceBtn = document.getElementById('qq-run-once-btn');
    const qqSaveTaskBtn = document.getElementById('qq-save-task-btn');
    const qqCreateTaskBtn = document.getElementById('qq-create-task-btn');
    const qqTaskCommand = document.getElementById('qq-task-command');
    const qqProfileResult = document.getElementById('qq-profile-result');
    const qqModel = document.getElementById('qq-model');
    const qqCustomModelWrap = document.getElementById('qq-custom-model-wrap');
    const qqPayloadPreset = document.getElementById('qq-payload-preset');
    const qqPayloadTemplateWrap = document.getElementById('qq-payload-template-wrap');
    const toggleLocalToolsBtn = document.getElementById('toggle-local-tools-btn');
    const selectedAgentName = document.getElementById('selected-agent-name');
    const selectedAgentPath = document.getElementById('selected-agent-path');
    const selectedAgentSummary = document.getElementById('selected-agent-summary');
    const agentTaskList = document.getElementById('agent-task-list');
    const externalAgentTaskList = document.getElementById('external-agent-task-list');
    const agentDailyPlanList = document.getElementById('agent-daily-plan-list');
    const agentConnectionList = document.getElementById('agent-connection-list');
    const saveAgentTaskBtn = document.getElementById('save-agent-task-btn');
    const createAgentSchedulerBtn = document.getElementById('create-agent-scheduler-btn');
    const agentSchedulerCommand = document.getElementById('agent-scheduler-command');
    const saveAgentConnectionBtn = document.getElementById('save-agent-connection-btn');
    const openMcpModalBtn = document.getElementById('open-mcp-modal-btn');
    const openSkillModalBtn = document.getElementById('open-skill-modal-btn');
    const contextMenu = document.getElementById('context-menu');
    const actionModal = document.getElementById('action-modal');
    const actionModalTitle = document.getElementById('action-modal-title');
    const actionModalBody = document.getElementById('action-modal-body');
    const actionModalSubmit = document.getElementById('action-modal-submit');
    const actionModalCancel = document.getElementById('action-modal-cancel');
    const actionModalClose = document.getElementById('action-modal-close');
    let modalSubmitHandler = null;

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
            body: JSON.stringify(payload),
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
        // force reflow
        void toast.offsetWidth;
        toast.style.animation = 'toast-in 0.2s ease, toast-out 0.2s ease 1.8s forwards';
        setTimeout(() => {
            toast.style.display = 'none';
        }, 2200);
    }

    function openModal(title, bodyHtml, onSubmit) {
        if (!actionModal) return;
        actionModalTitle.textContent = title;
        actionModalBody.innerHTML = bodyHtml;
        modalSubmitHandler = onSubmit;
        actionModal.style.display = 'flex';
    }

    function closeModal() {
        if (!actionModal) return;
        actionModal.style.display = 'none';
        actionModalBody.innerHTML = '';
        modalSubmitHandler = null;
    }

    function showContextMenu(x, y, items) {
        if (!contextMenu) return;
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
            const now = new Date();
            const diffMs = now - d;
            const diffDays = Math.floor(diffMs / 86400000);

            if (diffDays === 0) {
                return d.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
            } else if (diffDays === 1) {
                return '昨天';
            } else if (diffDays < 7) {
                return `${diffDays}天前`;
            } else {
                return d.toLocaleDateString('zh-CN', { month: 'short', day: 'numeric' });
            }
        } catch {
            return ts;
        }
    }

    function formatTimestamp(ts) {
        if (!ts) return '';
        try {
            const d = new Date(ts);
            if (isNaN(d.getTime())) return ts;
            return d.toLocaleString('zh-CN', {
                year: 'numeric',
                month: '2-digit',
                day: '2-digit',
                hour: '2-digit',
                minute: '2-digit',
                second: '2-digit',
            });
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
        // Split by double newline, wrap non-empty segments in <p>
        const parts = html.split(/\n\n+/);
        html = parts
            .map(part => {
                part = part.trim();
                if (!part) return '';
                // Don't wrap pre/code blocks in <p>
                if (part.startsWith('<pre>') || part.startsWith('<div class="tool-use')) return part;
                // Convert single newlines to <br>
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

        const permission = agentPermission?.value || 'default';
        const cwd = agentCwd?.value.trim();
        const prompt = agentPrompt?.value.trim();

        const parts = ['claude'];
        if (permission !== 'default') {
            parts.push('--permission-mode', permission);
        }
        if (prompt) {
            parts.push(quoteArg(prompt));
        }

        let command = parts.join(' ');
        if (cwd) {
            command = withPowerShellLocation(cwd, command);
        }
        generatedAgentCommand.textContent = command;
    }

    function getEffectivePrompt(sessionId = '') {
        const sessionPrompt = sessionId && promptSettings.sessionPrompts
            ? promptSettings.sessionPrompts[sessionId]
            : '';
        return sessionPrompt || promptSettings.globalPrompt || '';
    }

    function renderPromptSettings(sessionId = currentSessionId) {
        if (promptSessionId) promptSessionId.value = sessionId || '';
        const prompt = getEffectivePrompt(sessionId);
        if (effectivePromptPreview) effectivePromptPreview.textContent = prompt;
        if (effectivePromptLabel) {
            effectivePromptLabel.textContent = sessionId && promptSettings.sessionPrompts?.[sessionId]
                ? `当前会话 ${sessionId} 使用会话提示词。`
                : '当前使用全局默认提示词。';
        }
        if (promptSettingText && promptSettingText.dataset.dirty !== 'true') {
            promptSettingText.value = prompt;
        }
    }

    function applyEffectivePrompt(sessionId = currentSessionId) {
        const prompt = getEffectivePrompt(sessionId);
        if (prompt && agentPrompt && (agentPrompt.dataset.autoPrompt === 'true' || !agentPrompt.value.trim())) {
            agentPrompt.value = prompt;
            agentPrompt.dataset.autoPrompt = 'true';
            buildAgentCommand();
        }
        renderPromptSettings(sessionId);
    }

    function showHome() {
        currentSessionId = '';
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

    function clearSelectedAgent() {
        selectedAgent = null;
        setAgentGatedVisible(false);
        if (selectedAgentName) selectedAgentName.textContent = '未选择 Agent';
        if (selectedAgentPath) selectedAgentPath.textContent = '';
        if (selectedAgentSummary) selectedAgentSummary.textContent = '选择一个 Agent 后，才能配置它的定时任务、QQ/微信连接和运行记录。';
        [agentTaskList, externalAgentTaskList, agentDailyPlanList, agentConnectionList].forEach(container => {
            if (container) container.innerHTML = '';
        });
    }

    function selectedQqModel() {
        const model = readValue('qq-model');
        return model === 'custom' ? readValue('qq-custom-model') : model;
    }

    function qqProfilePayload() {
        return {
            profileName: readValue('qq-profile-name'),
            apiBaseUrl: readValue('qq-api-base-url'),
            apiKey: readValue('qq-api-key'),
            model: selectedQqModel(),
            botPlatform: readValue('qq-bot-platform'),
            botEndpoint: readValue('qq-bot-endpoint'),
            botToken: readValue('qq-bot-token'),
            sessionId: readValue('qq-session-id'),
            payloadPreset: readValue('qq-payload-preset'),
            payloadTemplate: readValue('qq-payload-template'),
            taskPrompt: readValue('qq-task-prompt'),
        };
    }

    function qqTaskPayload() {
        return {
            profileName: readValue('qq-profile-name'),
            taskName: readValue('qq-task-name'),
            schedule: readValue('qq-task-schedule'),
            startTime: readValue('qq-task-time'),
            force: readValue('qq-task-force') === 'true',
        };
    }

    function renderQqPushSummary(summary) {
        const profiles = summary?.profiles || [];
        const profile = profiles.find(item => item.profileName === readValue('qq-profile-name')) || profiles[0];
        if (!profile) return;
        setValue('qq-profile-name', profile.profileName);
        setValue('qq-api-base-url', profile.apiBaseUrl);
        setValue('qq-bot-platform', profile.botPlatform || 'generic');
        setValue('qq-bot-endpoint', profile.botEndpoint);
        setValue('qq-session-id', profile.sessionId);
        setValue('qq-payload-preset', profile.payloadPreset || 'generic');
        setValue('qq-task-prompt', profile.taskPrompt);
        if (qqModel && [...qqModel.options].some(option => option.value === profile.model)) {
            setValue('qq-model', profile.model);
        } else if (profile.model) {
            setValue('qq-model', 'custom');
            setValue('qq-custom-model', profile.model);
        }
        if (qqProfileResult) {
            const apiState = profile.apiKeySet ? '模型密钥已保存' : '未保存模型密钥';
            const botState = profile.botTokenSet ? 'Bot Token 已保存' : '未保存 Bot Token';
            qqProfileResult.textContent = `${apiState}；${botState}。`;
        }
        updateQqConditionalFields();
    }

    function updateQqConditionalFields() {
        if (qqCustomModelWrap) {
            qqCustomModelWrap.style.display = readValue('qq-model') === 'custom' ? '' : 'none';
        }
        if (qqPayloadTemplateWrap) {
            qqPayloadTemplateWrap.style.display = readValue('qq-payload-preset') === 'custom' ? '' : 'none';
        }
    }

    function renderResourceList(container, items, emptyText, formatter) {
        if (!container) return;
        container.innerHTML = '';
        if (!items || items.length === 0) {
            container.innerHTML = `<div class="resource-empty">${escapeHtml(emptyText)}</div>`;
            return;
        }
        items.slice(0, 20).forEach(item => {
            const row = document.createElement('div');
            row.className = 'resource-row';
            row.innerHTML = formatter(item);
            container.appendChild(row);
        });
    }

    function agentPayloadBase() {
        if (!selectedAgent) throw new Error('请先选择 Agent');
        return {
            agentName: selectedAgent.name,
            agentPath: selectedAgent.path,
            projectRoot: selectedAgent.projectRoot || currentCatalogRoot(),
        };
    }

    function setAgentGatedVisible(visible) {
        document.querySelectorAll('.agent-gated').forEach(section => {
            section.classList.toggle('is-locked', !visible);
        });
    }

    function renderAgentWorkspace(workspace) {
        if (!agentTaskList || !agentConnectionList) return;
        const tasks = workspace?.tasks || [];
        const externalTasks = workspace?.externalTasks || [];
        const connections = workspace?.connections || [];
        const detectedConnections = [];
        const qqTargets = workspace?.dailyPlan?.qqTargets || {};
        if (qqTargets && Object.keys(qqTargets).length) {
            const detectedTarget = qqTargets.group || qqTargets.user || qqTargets.channel || qqTargets.last?.target_id || '';
            const detectedType = qqTargets.group ? 'group' : (qqTargets.user ? 'user' : (qqTargets.channel ? 'channel' : (qqTargets.last?.target_type || 'group')));
            detectedConnections.push({
                id: 'detected-qq-openapi',
                name: '已检测 QQ OpenAPI 连接',
                type: 'qq-openapi',
                targetType: detectedType,
                target: detectedTarget,
                source: 'Agent_Daily_Plans/qq_targets.json',
                tokenSet: false,
                appSecretSet: false,
            });
        }
        renderResourceList(agentTaskList, tasks, '当前 Agent 尚未配置定时任务', item => `
            <strong>${escapeHtml(item.name || item.id)}</strong>
            <span>${escapeHtml(item.cron || '')} · ${escapeHtml(item.sessionPolicy || 'new')} · ${item.enabled === false ? '停用' : '启用'}</span>
            <code>${escapeHtml(item.prompt || '')}</code>
            <button class="btn-mini" data-edit-agent-task="${escapeHtml(encodeData(item))}">编辑</button>
        `);
        renderResourceList(externalAgentTaskList, externalTasks, '当前项目未发现关联的 Windows 计划任务', item => `
            <strong>${escapeHtml(item.taskName || item.id)}</strong>
            <span>${escapeHtml(item.state || '')} · ${escapeHtml(item.schedule || '')} · last=${escapeHtml(String(item.lastTaskResult ?? ''))}</span>
            <code>${escapeHtml([item.command, item.arguments].filter(Boolean).join(' '))}</code>
            <div class="button-row compact-actions">
                <button class="btn-mini" data-external-task-action="run" data-external-task-name="${escapeHtml(item.taskName || '')}">运行</button>
                <button class="btn-mini" data-external-task-action="stop" data-external-task-name="${escapeHtml(item.taskName || '')}">停止</button>
                <button class="btn-mini" data-external-task-action="enable" data-external-task-name="${escapeHtml(item.taskName || '')}">启用</button>
                <button class="btn-mini" data-external-task-action="disable" data-external-task-name="${escapeHtml(item.taskName || '')}">停用</button>
            </div>
        `);
        renderDailyPlan(workspace?.dailyPlan);
        renderResourceList(agentConnectionList, [...detectedConnections, ...connections], '当前 Agent 尚未配置连接', item => `
            <strong>${escapeHtml(item.name || item.id)}</strong>
            <span>${escapeHtml(item.type || '')} · ${escapeHtml(item.targetType || '')} · ${item.appSecretSet ? 'Secret 已保存' : '未保存 Secret'} · ${item.tokenSet ? 'Token 已保存' : '无 Token'}</span>
            <code>${escapeHtml(item.endpoint || item.target || '')}</code>
            ${item.source ? `<span>${escapeHtml(item.source)}</span>` : ''}
            <button class="btn-mini" data-edit-agent-connection="${escapeHtml(encodeData(item))}">编辑</button>
        `);
    }

    function renderDailyPlan(plan) {
        if (!agentDailyPlanList) return;
        if (!plan?.exists) {
            agentDailyPlanList.innerHTML = '<div class="resource-empty">未发现 Agent_Daily_Plans 目录</div>';
            return;
        }
        const schedule = plan.latestJson?.schedule || {};
        const rows = Object.entries(schedule).map(([key, item]) => ({
            key,
            time: item?.time || '',
            title: item?.title || key,
            task: item?.task || '',
            note: item?.note || '',
        }));
        if (!rows.length) {
            agentDailyPlanList.innerHTML = '<div class="resource-empty">已发现计划目录，但没有可读取的最新计划 JSON</div>';
            return;
        }
        agentDailyPlanList.innerHTML = '';
        rows.forEach(item => {
            const row = document.createElement('div');
            row.className = 'resource-row plan-row';
            row.innerHTML = `
                <strong>${escapeHtml(item.time)} ${escapeHtml(item.title)}</strong>
                <span>${escapeHtml(item.key)}</span>
                <code>${escapeHtml(item.task)}</code>
                ${item.note ? `<p>${escapeHtml(item.note)}</p>` : ''}
            `;
            agentDailyPlanList.appendChild(row);
        });
        if (plan.qqTargets && Object.keys(plan.qqTargets).length) {
            const row = document.createElement('div');
            row.className = 'resource-row';
            row.innerHTML = `
                <strong>QQ target</strong>
                <code>${escapeHtml(JSON.stringify(plan.qqTargets))}</code>
            `;
            agentDailyPlanList.appendChild(row);
        }
    }

    async function selectAgent(agent) {
        selectedAgent = {
            name: agent.name,
            path: agent.path,
            scope: agent.scope,
            description: agent.description || '',
            projectRoot: currentCatalogRoot(),
        };
        if (selectedAgentName) selectedAgentName.textContent = selectedAgent.name;
        if (selectedAgentPath) selectedAgentPath.textContent = selectedAgent.path || '';
        if (selectedAgentSummary) {
            selectedAgentSummary.textContent = `${selectedAgent.name} 已选中。现在可以配置 Cron 定时任务、连接和运行策略。`;
        }
        setAgentGatedVisible(true);
        try {
            const workspace = await api(`/api/agent-workspace?agentName=${encodeURIComponent(selectedAgent.name)}&projectRoot=${encodeURIComponent(selectedAgent.projectRoot)}`);
            renderAgentWorkspace(workspace);
        } catch (e) {
            showToast(`读取 Agent 工作区失败：${e.message}`);
        }
        document.getElementById('selected-agent-panel')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }

    function fillAgentTaskForm(item) {
        setValue('agent-task-id', item.id || '');
        setValue('agent-task-name', item.name || '');
        setValue('agent-task-cron', item.cron || '30 7 * * *');
        setValue('agent-task-session-policy', item.sessionPolicy || 'new');
        setValue('agent-task-enabled', item.enabled === false ? 'false' : 'true');
        setValue('agent-task-resume-session', item.resumeSessionId || '');
        setValue('agent-task-prompt', item.prompt || '');
    }

    function fillAgentConnectionForm(item) {
        setValue('agent-connection-id', item.id === 'detected-qq-openapi' ? '' : (item.id || ''));
        setValue('agent-connection-name', item.name || '');
        setValue('agent-connection-type', item.type || 'qq-openapi');
        setValue('agent-connection-app-id', item.appId || '');
        setValue('agent-connection-app-secret', '');
        setValue('agent-connection-endpoint', item.endpoint || '');
        setValue('agent-connection-target-type', item.targetType || 'group');
        setValue('agent-connection-target', item.target || '');
        setValue('agent-connection-token', '');
    }

    function fillAgentEditor(agent) {
        setValue('create-agent-path', agent.path || '');
        setValue('create-agent-name', agent.name || '');
        setValue('create-agent-description', agent.description || '');
        setValue('create-agent-model', agent.model || '');
        setValue('create-agent-tools', agent.tools || '');
        setValue('create-agent-prompt', agent.prompt || '');
        if (agentCreateResult) agentCreateResult.textContent = agent.path ? `正在编辑：${agent.path}` : 'Agent 会写入本地 .claude/agents 或用户 agents 目录。';
    }

    function renderLocalCatalog(catalog) {
        if (!catalog || !catalog.counts) return;
        const counts = catalog.counts;
        if (catalogUpdated) {
            catalogUpdated.innerHTML = `已读取本地索引：<code>data/catalog.json</code>，更新时间 ${escapeHtml(catalog.generatedAt || '')}`;
        }
        if (localSummary) {
            localSummary.innerHTML = `
                <div><strong>${counts.mcpServers || 0}</strong><span>MCP</span></div>
                <div><strong>${counts.skills || 0}</strong><span>Skills</span></div>
                <div><strong>${counts.agents || 0}</strong><span>Agents</span></div>
                <div><strong>${counts.commands || 0}</strong><span>Commands</span></div>
            `;
        }
        renderResourceList(mcpList, catalog.mcpServers, '未发现本地 MCP 配置', item => `
            <strong>${escapeHtml(item.name)}</strong>
            <span>${escapeHtml(item.scope)} · ${escapeHtml(item.transport || '')}</span>
            <code>${escapeHtml(item.command || item.url || item.path || '')}</code>
            <span class="row-menu-target" data-menu-kind="mcp" data-menu-item="${escapeHtml(encodeData(item))}"></span>
        `);
        renderResourceList(skillList, catalog.skills, '未发现本地 Skill', item => `
            <strong>${escapeHtml(item.name)}</strong>
            <span>${escapeHtml(item.scope)} · ${escapeHtml(item.description || 'no description')}</span>
            <code>${escapeHtml(item.path || '')}</code>
            <span class="row-menu-target" data-menu-kind="skill" data-menu-item="${escapeHtml(encodeData(item))}"></span>
        `);
        renderResourceList(agentList, catalog.agents, '未发现本地 Agent', item => `
            <strong>${escapeHtml(item.name)}</strong>
            <span>${escapeHtml(item.scope)} · ${escapeHtml(item.description || 'no description')}</span>
            <code>${escapeHtml(item.path || '')}</code>
            <button class="btn-mini" data-select-agent="${escapeHtml(item.name)}" data-agent-path="${escapeHtml(item.path || '')}" data-agent-scope="${escapeHtml(item.scope || '')}" data-agent-description="${escapeHtml(item.description || '')}">选择</button>
            <button class="btn-mini" data-edit-agent-path="${escapeHtml(item.path || '')}">编辑文件</button>
            <span class="row-menu-target" data-menu-kind="agent" data-menu-item="${escapeHtml(encodeData(item))}"></span>
        `);
        renderResourceList(commandList, catalog.commands, '未发现本地 slash command', item => `
            <strong>/${escapeHtml(item.name)}</strong>
            <span>${escapeHtml(item.scope)}</span>
            <code>${escapeHtml(item.path || '')}</code>
        `);
    }

    function currentCatalogRoot() {
        return readValue('catalog-project-root') || currentProjectPath || '';
    }

    async function loadLocalCatalog(refresh = false) {
        try {
            const projectRoot = currentCatalogRoot();
            const catalog = refresh
                ? await apiPost('/api/local/refresh', { project: currentProject, projectRoot })
                : await api(`/api/local/catalog?project=${encodeURIComponent(currentProject)}&projectRoot=${encodeURIComponent(projectRoot)}`);
            if (catalog.promptSettings) {
                promptSettings = catalog.promptSettings;
                renderPromptSettings();
                applyEffectivePrompt();
            }
            if (catalog.qqPush) {
                renderQqPushSummary(catalog.qqPush);
            }
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

    async function openLocalPath(path) {
        if (!path) {
            showToast('缺少本地路径');
            return;
        }
        try {
            await apiPost('/api/open-path', { path });
        } catch (e) {
            showToast(`打开路径失败：${e.message}`);
        }
    }

    function openMcpEditor(item = {}) {
        const definition = item.definition || {};
        const defaultPath = item.path || `${currentCatalogRoot()}\\.mcp.json`;
        openModal('添加或编辑 MCP', `
            <div class="form-grid modal-form">
                <label><span>名称</span><input id="modal-mcp-name" type="text" value="${escapeHtml(item.name || '')}" placeholder="browser"></label>
                <label class="wide"><span>配置文件</span><input id="modal-mcp-path" type="text" value="${escapeHtml(defaultPath)}" placeholder=".mcp.json 路径"></label>
                <label class="wide"><span>MCP JSON</span><textarea id="modal-mcp-json" rows="8" placeholder='{"command":"npx","args":["browser-mcp"]}'>${escapeHtml(JSON.stringify(definition, null, 2))}</textarea></label>
            </div>
        `, async () => {
            const result = await apiPost('/api/mcp/save', {
                name: readValue('modal-mcp-name'),
                path: readValue('modal-mcp-path'),
                json: readValue('modal-mcp-json'),
                projectRoot: currentCatalogRoot(),
            });
            if (mcpCommand) mcpCommand.textContent = `saved ${result.name} -> ${result.path}`;
            closeModal();
            showToast('MCP 已保存');
            loadLocalCatalog(true);
        });
    }

    function openSkillInstaller() {
        openModal('搜索并安装 Skill', `
            <div class="form-grid modal-form">
                <label class="wide"><span>关键词</span><input id="modal-skill-query" type="text" placeholder="例如 pdf, browser, notion"></label>
                <label class="wide inline-action"><button class="btn-secondary" id="modal-skill-search-btn" type="button">搜索公开来源</button></label>
                <label><span>Skill 名称</span><input id="modal-skill-name" type="text" placeholder="可留空自动推断"></label>
                <label class="wide"><span>Git 仓库 URL</span><input id="modal-skill-repo" type="text" placeholder="https://github.com/org/repo.git"></label>
                <div class="wide search-results" id="modal-skill-results"></div>
            </div>
        `, async () => {
            const result = await apiPost('/api/skills/install', {
                skillName: readValue('modal-skill-name'),
                repoUrl: readValue('modal-skill-repo'),
            });
            if (skillCommand) skillCommand.textContent = result.command || result.path || '';
            closeModal();
            showToast(result.installed ? 'Skill 已安装' : 'Skill 安装失败');
            loadLocalCatalog(true);
        });

        const searchButton = document.getElementById('modal-skill-search-btn');
        const resultsBox = document.getElementById('modal-skill-results');
        if (!searchButton || !resultsBox) return;
        searchButton.addEventListener('click', async () => {
            resultsBox.innerHTML = '<div class="resource-empty">搜索中...</div>';
            try {
                const data = await apiPost('/api/skills/search', {
                    query: readValue('modal-skill-query'),
                    source: 'all',
                });
                if (!data.results || data.results.length === 0) {
                    resultsBox.innerHTML = '<div class="resource-empty">未找到匹配仓库</div>';
                    return;
                }
                resultsBox.innerHTML = '';
                data.results.forEach(result => {
                    const row = document.createElement('div');
                    row.className = 'search-result-row';
                    const repoUrl = result.repoUrl || result.sourceUrl || '';
                    const action = result.installable
                        ? `<button class="btn-mini" type="button" data-modal-skill-name="${escapeHtml(result.name)}" data-modal-skill-repo="${escapeHtml(repoUrl)}">使用</button>`
                        : `<a class="btn-mini" href="${escapeHtml(repoUrl)}" target="_blank" rel="noopener">打开</a>`;
                    row.innerHTML = `
                        <div>
                            <strong>${escapeHtml(result.name)}</strong>
                            <span>${escapeHtml(result.source || 'source')} · ${escapeHtml(result.description || 'no description')}</span>
                            <code>${escapeHtml(repoUrl)}</code>
                        </div>
                        ${action}
                    `;
                    resultsBox.appendChild(row);
                });
            } catch (e) {
                resultsBox.innerHTML = `<div class="resource-empty">搜索失败：${escapeHtml(e.message)}</div>`;
            }
        });
    }

    async function saveSessionMeta(session, patch) {
        await apiPost('/api/sessions/meta', {
            projectId: session.projectId || currentProject,
            sessionId: session.id,
            titleAlias: session.titleAlias || '',
            hidden: false,
            ...patch,
        });
        await loadSessions();
    }

    function openSessionEditor(item) {
        const currentPrompt = promptSettings.sessionPrompts?.[item.id] || '';
        openModal('编辑会话', `
            <div class="form-grid modal-form">
                <label class="wide"><span>会话名称</span><input id="modal-session-title" type="text" value="${escapeHtml(item.titleAlias || item.title || '')}"></label>
                <label class="wide"><span>会话提示词</span><textarea id="modal-session-prompt" rows="8" placeholder="留空则使用全局提示词">${escapeHtml(currentPrompt)}</textarea></label>
                <label class="wide"><span>原始会话 ID</span><input type="text" value="${escapeHtml(item.id || '')}" disabled></label>
            </div>
        `, async () => {
            await saveSessionMeta(item, { titleAlias: readValue('modal-session-title') });
            promptSettings = await apiPost('/api/prompts', {
                scope: 'session',
                sessionId: item.id,
                prompt: readValue('modal-session-prompt'),
            });
            renderPromptSettings(item.id);
            closeModal();
            showToast('会话设置已保存');
        });
    }

    function contextItemsFor(kind, item) {
        if (kind === 'session') {
            return [
                { label: '编辑会话', action: () => openSessionEditor(item) },
                { label: '复制恢复命令', action: () => copyText(item.resumeCommand || '') },
                {
                    label: '删除会话到本地备份',
                    action: async () => {
                        if (!confirm('会话文件会移到 data/deleted_sessions，本操作不会永久删除。是否继续？')) return;
                        try {
                            await apiPost('/api/sessions/delete', {
                                projectId: item.projectId || currentProject,
                                sessionId: item.id,
                                titleAlias: item.titleAlias || item.title || '',
                            });
                            await loadSessions();
                            showToast('会话已移入本地备份');
                        } catch (e) {
                            showToast(`删除会话失败：${e.message}`);
                        }
                    },
                },
            ];
        }
        if (kind === 'mcp') {
            return [
                { label: '编辑 MCP', action: () => openMcpEditor(item) },
                { label: '打开配置位置', action: () => openLocalPath(item.path || '') },
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
                { label: '编辑 Skill 文件', action: () => openLocalPath(item.path || '') },
                { label: '复制 Skill 路径', action: () => copyText(item.path || '') },
                {
                    label: '删除 Skill',
                    action: async () => {
                        if (!confirm(`删除 Skill 目录：${item.name}？`)) return;
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
                { label: '选择 Agent', action: () => selectAgent(item) },
                {
                    label: '编辑 Agent',
                    action: async () => {
                        try {
                            const agent = await api(`/api/agent-file?path=${encodeURIComponent(item.path || '')}`);
                            fillAgentEditor(agent);
                            document.querySelectorAll('.secondary-tools').forEach(section => section.classList.remove('is-collapsed'));
                            document.getElementById('agent-creator')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
                        } catch (e) {
                            showToast(`读取 Agent 失败：${e.message}`);
                        }
                    },
                },
                { label: '打开 Agent 文件', action: () => openLocalPath(item.path || '') },
            ];
        }
        return [];
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
            });

            // Auto-select first project
            currentProject = projects[0].id;
            currentProjectPath = projects[0].path || projects[0].name || '';
            projectSelect.value = currentProject;
            if (catalogProjectRoot && !catalogProjectRoot.value.trim()) {
                catalogProjectRoot.value = currentProjectPath;
            }
            if (catalogProjectRootSelect) catalogProjectRootSelect.value = currentProjectPath;
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
        clearSelectedAgent();

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

            // Update header
            conversationTitle.textContent = data.aiTitle || `会话 ${id.slice(0, 8)}`;
            metaMessages.textContent = `${data.messageCount} 条消息`;
            metaTime.textContent = data.messages.length > 0
                ? formatTimestamp(data.messages[data.messages.length - 1].timestamp)
                : '';
            metaCache.textContent = data.cacheHit ? '缓存命中' : '新解析';
            metaCache.className = 'meta-badge ' + (data.cacheHit ? 'cache-hit' : 'cache-miss');

            // Update resume command
            const sessionMeta = sessionsData.find(s => s.id === id);
            resumeCmd.textContent = sessionMeta?.resumeCommand || withPowerShellLocation(currentProjectPath, `claude -r ${id}`);
            if (promptSessionId) promptSessionId.value = id;
            if (promptScope) promptScope.value = 'session';
            if (agentPrompt?.dataset.autoPrompt === 'true' || !agentPrompt?.value.trim()) {
                agentPrompt.dataset.autoPrompt = 'true';
            }
            applyEffectivePrompt(id);

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
            // Fallback
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

    [agentPermission, agentCwd, agentPrompt].forEach(el => {
        if (el) {
            el.addEventListener('input', buildAgentCommand);
            el.addEventListener('change', buildAgentCommand);
        }
    });

    if (agentPrompt) {
        agentPrompt.addEventListener('input', () => {
            agentPrompt.dataset.autoPrompt = 'false';
        });
    }

    if (promptSettingText) {
        promptSettingText.addEventListener('input', () => {
            promptSettingText.dataset.dirty = 'true';
        });
    }

    if (focusSearchBtn) {
        focusSearchBtn.addEventListener('click', () => {
            searchInput.focus();
        });
    }

    if (refreshLocalBtn) {
        refreshLocalBtn.addEventListener('click', () => loadLocalCatalog(true));
    }

    if (mcpImportBtn) {
        mcpImportBtn.addEventListener('click', async () => {
            try {
                const result = await apiPost('/api/mcp/import-json', {
                    name: readValue('mcp-name'),
                    json: readValue('mcp-json'),
                });
                mcpCommand.textContent = result.command;
                showToast('MCP 导入命令已保存');
                loadLocalCatalog();
            } catch (e) {
                showToast(`MCP JSON 错误：${e.message}`);
            }
        });
    }

    if (skillInstallBtn) {
        skillInstallBtn.addEventListener('click', async () => {
            try {
                const result = await apiPost('/api/skills/install-command', {
                    skillName: readValue('skill-name'),
                    repoUrl: readValue('skill-repo'),
                });
                skillCommand.textContent = result.command;
                showToast('Skill 安装命令已保存');
                loadLocalCatalog();
            } catch (e) {
                showToast(`Skill 参数错误：${e.message}`);
            }
        });
    }

    if (skillCloneBtn) {
        skillCloneBtn.addEventListener('click', async () => {
            const repoUrl = readValue('skill-repo');
            if (!repoUrl) {
                showToast('请先选择或输入 Git 仓库 URL');
                return;
            }
            if (!confirm(`将 git clone 到本机 Claude skills 目录：\n${repoUrl}`)) return;
            try {
                const result = await apiPost('/api/skills/install', {
                    skillName: readValue('skill-name'),
                    repoUrl,
                });
                skillCommand.textContent = result.command || '';
                if (skillActionResult) {
                    skillActionResult.textContent = result.installed
                        ? `已安装：${result.path}`
                        : `安装失败：${result.stderr || result.stdout || 'git clone failed'}`;
                }
                showToast(result.installed ? 'Skill 已安装' : 'Skill 安装失败');
                loadLocalCatalog(true);
            } catch (e) {
                showToast(`Skill 安装失败：${e.message}`);
            }
        });
    }

    if (activateSkillBundleBtn) {
        activateSkillBundleBtn.addEventListener('click', async () => {
            try {
                const result = await apiPost('/api/skills/activate-bundle', {
                    bundlePath: readValue('skill-bundle-path'),
                });
                if (skillActionResult) {
                    skillActionResult.textContent = `Bundle 已处理：激活 ${result.activated} 个，跳过 ${result.skipped} 个。`;
                }
                skillCommand.textContent = `activated=${result.activated} skipped=${result.skipped}`;
                showToast('本地 Bundle 已激活');
                loadLocalCatalog(true);
            } catch (e) {
                showToast(`Bundle 激活失败：${e.message}`);
            }
        });
    }

    if (organizeSkillBundleBtn) {
        organizeSkillBundleBtn.addEventListener('click', async () => {
            const bundlePath = readValue('skill-bundle-path');
            if (!bundlePath) {
                showToast('请先输入 Bundle 路径');
                return;
            }
            if (!confirm(`将把 Bundle 移出 skills 根目录并保存在 skill-bundles：\n${bundlePath}`)) return;
            try {
                const result = await apiPost('/api/skills/organize-bundle', { bundlePath });
                const bundlePathInput = document.getElementById('skill-bundle-path');
                if (bundlePathInput) bundlePathInput.value = result.target || bundlePath;
                if (skillActionResult) {
                    skillActionResult.textContent = `Bundle 已整理：${result.target}`;
                }
                skillCommand.textContent = result.target || '';
                showToast('Bundle 目录已整理');
                loadLocalCatalog(true);
            } catch (e) {
                showToast(`Bundle 整理失败：${e.message}`);
            }
        });
    }

    if (skillSearchBtn) {
        skillSearchBtn.addEventListener('click', async () => {
            if (!skillSearchResults) return;
            skillSearchResults.innerHTML = '<div class="resource-empty">搜索中...</div>';
            try {
                const data = await apiPost('/api/skills/search', {
                    query: readValue('skill-search-query'),
                    source: 'all',
                });
                if (!data.results || data.results.length === 0) {
                    skillSearchResults.innerHTML = '<div class="resource-empty">未找到匹配仓库</div>';
                    return;
                }
                skillSearchResults.innerHTML = '';
                data.results.forEach(result => {
                    const row = document.createElement('div');
                    row.className = 'search-result-row';
                    const sourceUrl = result.sourceUrl || result.repoUrl || '';
                    const action = result.installable
                        ? `<button class="btn-mini" data-use-skill-name="${escapeHtml(result.name)}" data-use-skill-repo="${escapeHtml(result.repoUrl)}">使用</button>`
                        : `<a class="btn-mini" href="${escapeHtml(sourceUrl)}" target="_blank" rel="noopener">打开</a>`;
                    row.innerHTML = `
                        <div>
                            <strong>${escapeHtml(result.name)}</strong>
                            <span>${escapeHtml(result.source || 'source')} · ${escapeHtml(result.description || 'no description')} · ${escapeHtml(result.stars || 0)} stars</span>
                            <code>${escapeHtml(result.repoUrl || sourceUrl || '')}</code>
                        </div>
                        ${action}
                    `;
                    skillSearchResults.appendChild(row);
                });
            } catch (e) {
                skillSearchResults.innerHTML = `<div class="resource-empty">搜索失败：${escapeHtml(e.message)}</div>`;
            }
        });
    }

    document.addEventListener('click', (e) => {
        const useSkill = e.target.closest('[data-use-skill-repo]');
        if (!useSkill) return;
        const skillNameInput = document.getElementById('skill-name');
        const skillRepoInput = document.getElementById('skill-repo');
        if (skillNameInput) skillNameInput.value = useSkill.dataset.useSkillName || '';
        if (skillRepoInput) skillRepoInput.value = useSkill.dataset.useSkillRepo || '';
        showToast('已填入 Skill 安装表单');
    });

    document.addEventListener('click', (e) => {
        const agentButton = e.target.closest('[data-select-agent]');
        if (!agentButton) return;
        selectAgent({
            name: agentButton.dataset.selectAgent || '',
            path: agentButton.dataset.agentPath || '',
            scope: agentButton.dataset.agentScope || '',
            description: agentButton.dataset.agentDescription || '',
        });
    });

    document.addEventListener('click', async (e) => {
        const editButton = e.target.closest('[data-edit-agent-path]');
        if (!editButton) return;
        const path = editButton.dataset.editAgentPath || '';
        if (!path) return;
        try {
            const agent = await api(`/api/agent-file?path=${encodeURIComponent(path)}`);
            fillAgentEditor(agent);
            document.querySelectorAll('.secondary-tools').forEach(section => section.classList.remove('is-collapsed'));
            if (toggleLocalToolsBtn) toggleLocalToolsBtn.textContent = '隐藏本地工具';
            document.getElementById('automation-agent-patterns')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
        } catch (err) {
            showToast(`读取 Agent 文件失败：${err.message}`);
        }
    });

    document.addEventListener('click', (e) => {
        const taskButton = e.target.closest('[data-edit-agent-task]');
        if (!taskButton) return;
        fillAgentTaskForm(decodeData(taskButton.dataset.editAgentTask));
        showToast('已填入 Agent 任务表单');
    });

    document.addEventListener('click', (e) => {
        const connectionButton = e.target.closest('[data-edit-agent-connection]');
        if (!connectionButton) return;
        fillAgentConnectionForm(decodeData(connectionButton.dataset.editAgentConnection));
        showToast('已填入连接表单；Secret/Token 不会回显');
    });

    document.addEventListener('click', async (e) => {
        const taskButton = e.target.closest('[data-external-task-action]');
        if (!taskButton) return;
        const taskName = taskButton.dataset.externalTaskName || '';
        const action = taskButton.dataset.externalTaskAction || '';
        if (!taskName || !action) return;
        if (!confirm(`将对 Windows 计划任务执行 ${action}：\n${taskName}`)) return;
        try {
            const result = await apiPost('/api/external-agent-tasks/control', { taskName, action });
            showToast(result.ok ? `任务已执行：${action}` : `任务执行失败：${result.stderr || result.stdout || result.returnCode}`);
            if (selectedAgent) {
                const workspace = await api(`/api/agent-workspace?agentName=${encodeURIComponent(selectedAgent.name)}&projectRoot=${encodeURIComponent(selectedAgent.projectRoot)}`);
                renderAgentWorkspace(workspace);
            }
        } catch (err) {
            showToast(`任务控制失败：${err.message}`);
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

    if (toggleLocalToolsBtn) {
        toggleLocalToolsBtn.addEventListener('click', () => {
            const collapsed = document.querySelector('#prompt-settings-panel')?.classList.contains('is-collapsed');
            document.querySelectorAll('.secondary-tools').forEach(section => {
                section.classList.toggle('is-collapsed', !collapsed);
            });
            toggleLocalToolsBtn.textContent = collapsed ? '隐藏本地工具' : '显示本地工具';
        });
    }

    if (saveTaskBtn) {
        saveTaskBtn.addEventListener('click', async () => {
            try {
                const result = await apiPost('/api/tasks', {
                    type: readValue('task-type'),
                    taskName: readValue('task-name'),
                    schedule: readValue('task-schedule'),
                    startTime: readValue('task-time'),
                    interval: readValue('task-interval'),
                    cwd: readValue('task-cwd'),
                    permissionMode: readValue('task-permission'),
                    prompt: readValue('task-prompt'),
                    force: readValue('task-force') === 'true',
                });
                taskCommand.textContent = result.command;
                showToast('任务命令已保存');
                loadLocalCatalog();
            } catch (e) {
                showToast(`任务参数错误：${e.message}`);
            }
        });
    }

    if (createTaskBtn) {
        createTaskBtn.addEventListener('click', async () => {
            if (readValue('task-type') === 'loop') {
                showToast('/loop 需要在 Claude 会话内运行，不能注册为系统任务');
                return;
            }
            if (!confirm('将调用 Windows schtasks 创建系统定时任务。是否继续？')) return;
            try {
                const result = await apiPost('/api/tasks/create', {
                    type: readValue('task-type'),
                    taskName: readValue('task-name'),
                    schedule: readValue('task-schedule'),
                    startTime: readValue('task-time'),
                    cwd: readValue('task-cwd'),
                    permissionMode: readValue('task-permission'),
                    prompt: readValue('task-prompt'),
                    force: readValue('task-force') === 'true',
                });
                taskCommand.textContent = result.command;
                showToast(result.created ? '系统定时任务已创建' : '系统定时任务创建失败');
                loadLocalCatalog(true);
            } catch (e) {
                showToast(`创建系统任务失败：${e.message}`);
            }
        });
    }

    if (createAgentBtn) {
        createAgentBtn.addEventListener('click', async () => {
            try {
                const result = await apiPost('/api/agents', {
                    project: currentProject,
                    projectRoot: currentCatalogRoot(),
                    scope: readValue('create-agent-scope'),
                    name: readValue('create-agent-name'),
                    description: readValue('create-agent-description'),
                    model: readValue('create-agent-model'),
                    tools: readValue('create-agent-tools'),
                    prompt: readValue('create-agent-prompt'),
                });
                agentCreateResult.textContent = `已创建：${result.path}`;
                showToast('Agent 文件已创建');
                loadLocalCatalog(true);
            } catch (e) {
                showToast(`Agent 参数错误：${e.message}`);
            }
        });
    }

    if (updateAgentBtn) {
        updateAgentBtn.addEventListener('click', async () => {
            try {
                const result = await apiPost('/api/agents/update', {
                    projectRoot: currentCatalogRoot(),
                    path: readValue('create-agent-path'),
                    name: readValue('create-agent-name'),
                    description: readValue('create-agent-description'),
                    model: readValue('create-agent-model'),
                    tools: readValue('create-agent-tools'),
                    prompt: readValue('create-agent-prompt'),
                });
                if (agentCreateResult) agentCreateResult.textContent = `已保存：${result.path}`;
                showToast('Agent 文件已更新');
                loadLocalCatalog(true);
            } catch (e) {
                showToast(`Agent 修改失败：${e.message}`);
            }
        });
    }

    if (saveAgentTaskBtn) {
        saveAgentTaskBtn.addEventListener('click', async () => {
            try {
                const base = agentPayloadBase();
                const result = await apiPost('/api/agent-tasks', {
                    ...base,
                    id: readValue('agent-task-id'),
                    name: readValue('agent-task-name'),
                    cron: readValue('agent-task-cron'),
                    sessionPolicy: readValue('agent-task-session-policy') || 'new',
                    resumeSessionId: readValue('agent-task-resume-session'),
                    prompt: readValue('agent-task-prompt'),
                    enabled: readValue('agent-task-enabled') !== 'false',
                });
                setValue('agent-task-id', result.id || '');
                showToast(`Agent 任务已保存：${result.name}`);
                const workspace = await api(`/api/agent-workspace?agentName=${encodeURIComponent(base.agentName)}&projectRoot=${encodeURIComponent(base.projectRoot)}`);
                renderAgentWorkspace(workspace);
            } catch (e) {
                showToast(`保存 Agent 任务失败：${e.message}`);
            }
        });
    }

    if (createAgentSchedulerBtn) {
        createAgentSchedulerBtn.addEventListener('click', async () => {
            if (!confirm('将创建一个每分钟运行的 Windows Scheduler，用于检查 Agent cron 任务。是否继续？')) return;
            try {
                const result = await apiPost('/api/agent-tasks/create-scheduler', {
                    taskName: 'Claude Agent Scheduler',
                    force: true,
                });
                if (agentSchedulerCommand) agentSchedulerCommand.textContent = result.command;
                showToast(result.created ? 'Agent Cron Scheduler 已创建' : 'Agent Cron Scheduler 创建失败');
            } catch (e) {
                showToast(`创建 Scheduler 失败：${e.message}`);
            }
        });
    }

    if (saveAgentConnectionBtn) {
        saveAgentConnectionBtn.addEventListener('click', async () => {
            try {
                const base = agentPayloadBase();
                const result = await apiPost('/api/agent-connections', {
                    ...base,
                    id: readValue('agent-connection-id'),
                    name: readValue('agent-connection-name'),
                    type: readValue('agent-connection-type'),
                    appId: readValue('agent-connection-app-id'),
                    appSecret: readValue('agent-connection-app-secret'),
                    endpoint: readValue('agent-connection-endpoint'),
                    targetType: readValue('agent-connection-target-type'),
                    target: readValue('agent-connection-target'),
                    token: readValue('agent-connection-token'),
                });
                setValue('agent-connection-id', result.id || '');
                showToast(`连接已保存：${result.name}`);
                const workspace = await api(`/api/agent-workspace?agentName=${encodeURIComponent(base.agentName)}&projectRoot=${encodeURIComponent(base.projectRoot)}`);
                renderAgentWorkspace(workspace);
            } catch (e) {
                showToast(`保存连接失败：${e.message}`);
            }
        });
    }

    if (qqSaveProfileBtn) {
        qqSaveProfileBtn.addEventListener('click', async () => {
            try {
                const result = await apiPost('/api/qq-push/profile', qqProfilePayload());
                if (qqProfileResult) {
                    qqProfileResult.textContent = `已保存 ${result.profileName}；模型密钥：${result.apiKeySet ? '已保存' : '未保存'}；Bot Token：${result.botTokenSet ? '已保存' : '未保存'}。`;
                }
                showToast('QQ 推送配置已保存');
                loadLocalCatalog(true);
            } catch (e) {
                showToast(`QQ 推送配置保存失败：${e.message}`);
            }
        });
    }

    if (qqRunOnceBtn) {
        qqRunOnceBtn.addEventListener('click', async () => {
            if (!confirm('将立即调用模型 API 并向 QQ 机器人接口发送消息。是否继续？')) return;
            try {
                await apiPost('/api/qq-push/profile', qqProfilePayload());
                const result = await apiPost('/api/qq-push/run', { profileName: readValue('qq-profile-name') });
                if (qqProfileResult) {
                    qqProfileResult.textContent = `已推送 ${result.profileName}，消息长度 ${result.message.length}。`;
                }
                showToast('QQ 推送已执行');
            } catch (e) {
                showToast(`QQ 推送失败：${e.message}`);
            }
        });
    }

    if (qqSaveTaskBtn) {
        qqSaveTaskBtn.addEventListener('click', async () => {
            try {
                const result = await apiPost('/api/qq-push/task', qqTaskPayload());
                qqTaskCommand.textContent = result.command;
                showToast('QQ 定时任务命令已保存');
                loadLocalCatalog(true);
            } catch (e) {
                showToast(`QQ 定时任务参数错误：${e.message}`);
            }
        });
    }

    if (qqCreateTaskBtn) {
        qqCreateTaskBtn.addEventListener('click', async () => {
            if (!confirm('将调用 Windows schtasks 创建 QQ 推送计划任务。是否继续？')) return;
            try {
                await apiPost('/api/qq-push/profile', qqProfilePayload());
                const result = await apiPost('/api/qq-push/task/create', qqTaskPayload());
                qqTaskCommand.textContent = result.command;
                showToast(result.created ? 'QQ 系统定时任务已创建' : 'QQ 系统定时任务创建失败');
                loadLocalCatalog(true);
            } catch (e) {
                showToast(`创建 QQ 系统任务失败：${e.message}`);
            }
        });
    }

    if (qqModel) {
        qqModel.addEventListener('change', updateQqConditionalFields);
    }

    if (qqPayloadPreset) {
        qqPayloadPreset.addEventListener('change', updateQqConditionalFields);
    }

    if (savePromptBtn) {
        savePromptBtn.addEventListener('click', async () => {
            try {
                const scope = readValue('prompt-scope') || 'global';
                const result = await apiPost('/api/prompts', {
                    scope,
                    sessionId: readValue('prompt-session-id'),
                    prompt: readValue('prompt-setting-text'),
                });
                promptSettings = result;
                if (promptSettingText) promptSettingText.dataset.dirty = 'false';
                renderPromptSettings(readValue('prompt-session-id') || currentSessionId);
                applyEffectivePrompt(readValue('prompt-session-id') || currentSessionId);
                if (promptSettingResult) promptSettingResult.textContent = '提示词已保存到本地 data/prompt_settings.json。';
                showToast('提示词已保存');
            } catch (e) {
                showToast(`提示词保存失败：${e.message}`);
            }
        });
    }

    if (loadEffectivePromptBtn) {
        loadEffectivePromptBtn.addEventListener('click', () => {
            const prompt = getEffectivePrompt(readValue('prompt-session-id') || currentSessionId);
            if (agentPrompt) {
                agentPrompt.value = prompt;
                agentPrompt.dataset.autoPrompt = 'false';
                buildAgentCommand();
            }
            showToast('已填入当前命令提示词');
        });
    }

    if (promptScope) {
        promptScope.addEventListener('change', () => {
            const scope = readValue('prompt-scope') || 'global';
            const sessionId = readValue('prompt-session-id') || currentSessionId;
            const prompt = scope === 'session'
                ? (promptSettings.sessionPrompts?.[sessionId] || '')
                : (promptSettings.globalPrompt || '');
            if (promptSettingText) {
                promptSettingText.value = prompt;
                promptSettingText.dataset.dirty = 'false';
            }
        });
    }

    if (backHomeBtn) {
        backHomeBtn.addEventListener('click', showHome);
    }

    if (actionModalSubmit) {
        actionModalSubmit.addEventListener('click', async () => {
            if (!modalSubmitHandler) return;
            try {
                await modalSubmitHandler();
            } catch (e) {
                showToast(`操作失败：${e.message}`);
            }
        });
    }

    [actionModalCancel, actionModalClose].forEach(button => {
        if (button) button.addEventListener('click', closeModal);
    });

    if (actionModal) {
        actionModal.addEventListener('click', (e) => {
            if (e.target === actionModal) closeModal();
        });
    }

    if (openMcpModalBtn) {
        openMcpModalBtn.addEventListener('click', () => openMcpEditor());
    }

    if (openSkillModalBtn) {
        openSkillModalBtn.addEventListener('click', openSkillInstaller);
    }

    document.addEventListener('contextmenu', (e) => {
        const sessionCard = e.target.closest('.session-card');
        const rowTarget = e.target.closest('.resource-row')?.querySelector('.row-menu-target');
        const target = sessionCard || rowTarget;
        if (!target) return;
        const kind = target.dataset.menuKind;
        const item = decodeData(target.dataset.menuItem);
        const items = contextItemsFor(kind, item);
        if (items.length === 0) return;
        e.preventDefault();
        showContextMenu(e.clientX, e.clientY, items);
    });

    document.addEventListener('click', (e) => {
        if (!e.target.closest('.context-menu')) hideContextMenu();
        const modalSkill = e.target.closest('[data-modal-skill-repo]');
        if (modalSkill) {
            setValue('modal-skill-name', modalSkill.dataset.modalSkillName || '');
            setValue('modal-skill-repo', modalSkill.dataset.modalSkillRepo || '');
            showToast('已填入 Skill 安装信息');
        }
    });

    // --- Event listeners ---
    projectSelect.addEventListener('change', () => {
        currentProject = projectSelect.value;
        currentProjectPath = projectSelect.selectedOptions[0]?.dataset.path || '';
        clearSelectedAgent();
        if (catalogProjectRoot) {
            catalogProjectRoot.value = currentProjectPath;
        }
        if (catalogProjectRootSelect) {
            catalogProjectRootSelect.value = currentProjectPath;
        }
        currentSessionId = '';
        conversationView.style.display = 'none';
        welcomeState.style.display = 'flex';
        loadLocalCatalog(true);
        loadSessions();
    });

    if (useSelectedProjectRootBtn) {
        useSelectedProjectRootBtn.addEventListener('click', () => {
            if (catalogProjectRoot) {
                catalogProjectRoot.value = currentProjectPath;
            }
            loadLocalCatalog(true);
        });
    }

    if (catalogProjectRoot) {
        catalogProjectRoot.addEventListener('change', () => {
            clearSelectedAgent();
            if (catalogProjectRootSelect) catalogProjectRootSelect.value = catalogProjectRoot.value;
            loadLocalCatalog(true);
        });
    }

    if (catalogProjectRootSelect) {
        catalogProjectRootSelect.addEventListener('change', () => {
            if (catalogProjectRoot) catalogProjectRoot.value = catalogProjectRootSelect.value;
            clearSelectedAgent();
            loadLocalCatalog(true);
        });
    }

    refreshBtn.addEventListener('click', () => {
        loadSessions();
        if (currentSessionId) {
            selectSession(currentSessionId);
        }
    });

    // --- Keyboard shortcuts ---
    document.addEventListener('keydown', (e) => {
        // Ctrl+R or F5: refresh
        if ((e.ctrlKey && e.key === 'r') || e.key === 'F5') {
            // Let browser handle F5, only intercept Ctrl+R
            if (e.ctrlKey) {
                e.preventDefault();
                refreshBtn.click();
            }
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
    updateQqConditionalFields();
    loadLocalCatalog();
    loadProjects();
})();
