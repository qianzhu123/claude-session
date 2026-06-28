/* ============================================
   Claude Code Session Viewer - Frontend Logic
   ============================================ */

(function () {
    'use strict';

    // --- State ---
    let currentProject = '';
    let currentSessionId = '';
    let sessionsData = [];
    let cacheHits = 0;
    let cacheMisses = 0;

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
    const agentMode = document.getElementById('agent-mode');
    const agentPermission = document.getElementById('agent-permission');
    const agentSessionId = document.getElementById('agent-session-id');
    const agentCwd = document.getElementById('agent-cwd');
    const agentPrompt = document.getElementById('agent-prompt');
    const generatedAgentCommand = document.getElementById('generated-agent-command');
    const refreshLocalBtn = document.getElementById('refresh-local-btn');
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
    const agentCreateResult = document.getElementById('agent-create-result');
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

    function buildAgentCommand() {
        if (!generatedAgentCommand) return;

        const mode = agentMode?.value || 'start';
        const permission = agentPermission?.value || 'default';
        const sessionId = agentSessionId?.value.trim() || '<session-id>';
        const cwd = agentCwd?.value.trim();
        const prompt = agentPrompt?.value.trim();

        const parts = ['claude'];
        if (mode === 'resume') {
            parts.push('-r', sessionId);
        }
        if (permission !== 'default') {
            parts.push('--permission-mode', permission);
        }
        if (prompt) {
            parts.push(quoteArg(prompt));
        }

        let command = parts.join(' ');
        if (cwd) {
            command = `cd /d ${quoteArg(cwd)} && ${command}`;
        }
        generatedAgentCommand.textContent = command;
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
        `);
        renderResourceList(skillList, catalog.skills, '未发现本地 Skill', item => `
            <strong>${escapeHtml(item.name)}</strong>
            <span>${escapeHtml(item.scope)} · ${escapeHtml(item.description || 'no description')}</span>
            <code>${escapeHtml(item.path || '')}</code>
        `);
        renderResourceList(agentList, catalog.agents, '未发现本地 Agent', item => `
            <strong>${escapeHtml(item.name)}</strong>
            <span>${escapeHtml(item.scope)} · ${escapeHtml(item.description || 'no description')}</span>
            <code>${escapeHtml(item.path || '')}</code>
        `);
        renderResourceList(commandList, catalog.commands, '未发现本地 slash command', item => `
            <strong>/${escapeHtml(item.name)}</strong>
            <span>${escapeHtml(item.scope)}</span>
            <code>${escapeHtml(item.path || '')}</code>
        `);
    }

    async function loadLocalCatalog(refresh = false) {
        try {
            const catalog = refresh
                ? await apiPost('/api/local/refresh', {})
                : await api('/api/local/catalog');
            renderLocalCatalog(catalog);
            if (refresh) showToast('本地索引已刷新');
        } catch (e) {
            console.error('Failed to load local catalog:', e);
            showToast(`本地索引读取失败：${e.message}`);
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

            if (projects.length === 0) {
                projectSelect.innerHTML = '<option value="">未找到项目</option>';
                return;
            }

            projects.forEach(p => {
                const opt = document.createElement('option');
                opt.value = p.id;
                opt.textContent = `${p.name} (${p.sessionCount})`;
                projectSelect.appendChild(opt);
            });

            // Auto-select first project
            currentProject = projects[0].id;
            projectSelect.value = currentProject;
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

            card.innerHTML = `
                <div class="session-card-title" title="${escapeHtml(s.title)}">${escapeHtml(s.title)}</div>
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
            resumeCmd.textContent = `claude -r ${id}`;
            if (agentSessionId) {
                agentSessionId.value = id;
                if (agentMode) agentMode.value = 'resume';
                buildAgentCommand();
            }

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

    [agentMode, agentPermission, agentSessionId, agentCwd, agentPrompt].forEach(el => {
        if (el) {
            el.addEventListener('input', buildAgentCommand);
            el.addEventListener('change', buildAgentCommand);
        }
    });

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
                    source: readValue('skill-search-source'),
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

    if (backHomeBtn) {
        backHomeBtn.addEventListener('click', showHome);
    }

    // --- Event listeners ---
    projectSelect.addEventListener('change', () => {
        currentProject = projectSelect.value;
        currentSessionId = '';
        conversationView.style.display = 'none';
        welcomeState.style.display = 'flex';
        loadSessions();
    });

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
    loadLocalCatalog();
    loadProjects();
})();
