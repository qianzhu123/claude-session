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

    // --- API helpers ---
    async function api(url) {
        const resp = await fetch(url);
        if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
        return resp.json();
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
            currentSessionId = '';
            document.querySelectorAll('.session-card').forEach(el => el.classList.remove('active'));
            conversationView.style.display = 'none';
            welcomeState.style.display = 'flex';
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
    loadProjects();
})();
