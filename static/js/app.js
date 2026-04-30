/**
 * PageIndex Agent — Frontend Application
 * Three-page architecture: Library / Doc-Chat / KB-Chat
 */

// ========================================================================
// Global State
// ========================================================================
const State = {
    socket: null,
    currentPage: 'library',           // 'library' | 'doc-chat' | 'kb-chat'
    modelType: 'text',

    // Library
    documents: [],

    // Doc-chat (single document, potentially multiple sessions)
    docChat: {
        docId: null,
        docInfo: null,
        analysis: null,
        sessions: [],
        activeSessionId: null,
        useMemory: true,
    },

    // KB-chat (multi-doc, multiple sessions)
    kbChat: {
        selectedDocIds: new Set(),
        sessions: [],
        activeSessionId: null,
        docSearchKeyword: '',
        useMemory: true,
    },

    // Streaming
    isStreaming: false,
    streamingRawText: '',

    // Caches
    nodeMapCache: {},
    allPagesCache: {},
    highlightsCache: {},
    activeHighlightNodeId: null,
    _highlightObserver: null,
};

const NODE_COLORS = [
    {bg:'#eef2ff',text:'#4338ca'},{bg:'#ecfdf5',text:'#065f46'},{bg:'#fef3c7',text:'#92400e'},
    {bg:'#fce7f3',text:'#9d174d'},{bg:'#e0f2fe',text:'#075985'},{bg:'#f3e8ff',text:'#6b21a8'},
    {bg:'#fef2f2',text:'#991b1b'},{bg:'#f0fdf4',text:'#166534'},{bg:'#fff7ed',text:'#9a3412'},
    {bg:'#f5f3ff',text:'#5b21b6'},{bg:'#ecfeff',text:'#155e75'},{bg:'#fdf2f8',text:'#831843'},
];

// ========================================================================
// Markdown / KaTeX helpers (unchanged from v1)
// ========================================================================
if (typeof marked !== 'undefined') {
    marked.setOptions({ breaks: true, gfm: true });
}

let _mathStore = [];
function normalizeMathDelimiters(text) {
    if (!text) return '';
    return text.replace(/(^|\n)\[\s*\n([\s\S]*?)\n\](?=\n|$)/g, '$1\\\\[\n$2\n\\\\]');
}
function protectMathDelimiters(text) {
    if (!text) return text;
    _mathStore = [];
    let idx = 0;
    text = text.replace(/\$\$([\s\S]*?)\$\$/g, (m) => { _mathStore.push(m); return `@@MATH_PLACEHOLDER_${idx++}@@`; });
    text = text.replace(/\\\[([\s\S]*?)\\\]/g, (m) => { _mathStore.push(m); return `@@MATH_PLACEHOLDER_${idx++}@@`; });
    text = text.replace(/\\\(([\s\S]*?)\\\)/g, (m) => { _mathStore.push(m); return `@@MATH_PLACEHOLDER_${idx++}@@`; });
    text = text.replace(/(?<![\\$])\$(?!\$)((?:[^$\\]|\\.)+?)\$/g, (m) => { _mathStore.push(m); return `@@MATH_PLACEHOLDER_${idx++}@@`; });
    return text;
}
function restoreMathDelimiters(html) {
    if (!html) return html;
    return html.replace(/@@MATH_PLACEHOLDER_(\d+)@@/g, (_, i) => {
        const original = _mathStore[parseInt(i)] || '';
        const d = document.createElement('div'); d.textContent = original; return d.innerHTML;
    });
}
function renderMarkdown(text) {
    if (!text) return '';
    const normalized = normalizeMathDelimiters(text);
    const protectedText = protectMathDelimiters(normalized);
    if (typeof marked !== 'undefined') {
        let html = marked.parse(protectedText);
        html = restoreMathDelimiters(html);
        html = html.replace(/<table([\s\S]*?<\/table>)/g, '<div class="table-wrapper"><table$1</div>');
        return html;
    }
    return esc(normalized);
}
function renderMathInContainer(container) {
    if (!container || typeof renderMathInElement === 'undefined') return;
    renderMathInElement(container, {
        throwOnError: false,
        delimiters: [
            { left: '$$', right: '$$', display: true },
            { left: '\\[', right: '\\]', display: true },
            { left: '$', right: '$', display: false },
            { left: '\\(', right: '\\)', display: false }
        ]
    });
}
function esc(t) { const d = document.createElement('div'); d.textContent = t == null ? '' : String(t); return d.innerHTML; }

function showNotification(msg, kind = 'success') {
    const n = document.createElement('div');
    const bg = kind === 'error' ? '#ef4444' : '#22c55e';
    n.style.cssText = `position:fixed;top:20px;right:20px;background:${bg};color:white;padding:12px 24px;border-radius:10px;box-shadow:0 4px 15px rgba(0,0,0,0.2);z-index:99999;animation:slideIn .3s ease`;
    n.textContent = msg; document.body.appendChild(n);
    setTimeout(() => { n.style.animation = 'slideOut .3s ease'; setTimeout(() => n.remove(), 300); }, 2500);
}

function fmtTime(ts) {
    if (!ts) return '';
    const d = new Date(ts * 1000);
    const now = new Date();
    const sameDay = d.toDateString() === now.toDateString();
    if (sameDay) return d.toTimeString().slice(0, 5);
    const diff = Math.floor((now - d) / 86400000);
    if (diff < 7) return `${diff}天前`;
    return `${d.getMonth() + 1}/${d.getDate()}`;
}

// ========================================================================
// Bootstrap
// ========================================================================
function safeRun(label, fn) {
    try {
        fn();
        console.log(`%c[boot] ✓ ${label}`, 'color:#10b981');
    } catch (e) {
        console.error(`%c[boot] ✗ ${label}`, 'color:#ef4444;font-weight:bold', e);
    }
}

function bootApp() {
    console.log('%c[PageIndex Agent] booting...', 'color:#6366f1;font-weight:bold;font-size:14px');
    safeRun('initSocket', initSocket);
    safeRun('setupNavTabs', setupNavTabs);
    safeRun('setupLibraryPage', setupLibraryPage);
    safeRun('setupDocChatPage', setupDocChatPage);
    safeRun('setupKbChatPage', setupKbChatPage);
    safeRun('setupModelToggle', setupModelToggle);
    safeRun('setupSettings', setupSettings);
    safeRun('setupSkills', setupSkills);
    safeRun('loadConfig', loadConfig);
    safeRun('loadLibrary', loadLibrary);

    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
            const preview = document.getElementById('pagePreviewModal');
            if (preview && preview.classList.contains('active')) closePagePreviewModal();
        }
    });
    console.log('%c[PageIndex Agent] boot complete.', 'color:#10b981;font-weight:bold');
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', bootApp);
} else {
    // Script ran after DOM is already ready (defensive).
    bootApp();
}

// ========================================================================
// Top Nav Tabs
// ========================================================================
function setupNavTabs() {
    document.querySelectorAll('.nav-tab').forEach(btn => {
        btn.addEventListener('click', () => goToPage(btn.dataset.page));
    });
}

function goToPage(page, opts = {}) {
    State.currentPage = page;
    document.querySelectorAll('.nav-tab').forEach(t =>
        t.classList.toggle('active', t.dataset.page === page));
    document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
    const el = document.getElementById({
        'library': 'pageLibrary',
        'doc-chat': 'pageDocChat',
        'kb-chat': 'pageKbChat',
    }[page]);
    if (el) el.classList.add('active');

    if (page === 'library') {
        loadLibrary();
    } else if (page === 'kb-chat') {
        onEnterKbChat(opts);
    } else if (page === 'doc-chat') {
        onEnterDocChat(opts);
    }
}

// ========================================================================
// Model Toggle
// ========================================================================
function setupModelToggle() {
    document.getElementById('textModelBtn')?.addEventListener('click', () => switchModel('text'));
    document.getElementById('visionModelBtn')?.addEventListener('click', () => switchModel('vision'));
}
function switchModel(t) {
    State.modelType = t;
    document.getElementById('textModelBtn')?.classList.toggle('active', t === 'text');
    document.getElementById('visionModelBtn')?.classList.toggle('active', t === 'vision');
}

// ========================================================================
// Socket
// ========================================================================
function initSocket() {
    if (typeof io === 'undefined') {
        console.warn('[initSocket] socket.io not loaded — CDN blocked? Chat streaming will be unavailable, but UI should still work.');
        return;
    }
    try {
        State.socket = io();
    } catch (e) {
        console.error('[initSocket] io() threw:', e);
        return;
    }
    State.socket.on('connect', () => console.log('Socket connected'));
    State.socket.on('status', d => onStreamStatus(d.status));
    State.socket.on('thinking_chunk', d => onStreamThinking(d.content));
    State.socket.on('nodes', d => onStreamNodes(d.nodes));
    State.socket.on('chunk', d => onStreamChunk(d.content));
    State.socket.on('response', d => onStreamFullResponse(d.content));
    State.socket.on('done', () => onStreamDone(false));
    State.socket.on('stopped', () => onStreamDone(true));
    State.socket.on('error', d => onStreamError(d.message));
    State.socket.on('agent_step', d => onAgentStep(d));
    State.socket.on('agent_decompose', d => onAgentDecompose(d));
    State.socket.on('agent_reflect', d => onAgentReflect(d));
    State.socket.on('history', d => onHistoryReceived(d));
    State.socket.on('history_cleared', d => onHistoryCleared(d));
}

function activeChatUI() {
    if (State.currentPage === 'doc-chat') {
        return {
            messages: document.getElementById('docChatMessages'),
            container: document.getElementById('docChatContainer'),
            input: document.getElementById('docChatInput'),
            sendBtn: document.getElementById('docSendBtn'),
        };
    }
    if (State.currentPage === 'kb-chat') {
        return {
            messages: document.getElementById('kbChatMessages'),
            container: document.getElementById('kbChatContainer'),
            input: document.getElementById('kbChatInput'),
            sendBtn: document.getElementById('kbSendBtn'),
        };
    }
    return null;
}

function scrollChatToBottom() {
    const ui = activeChatUI();
    if (ui?.container) ui.container.scrollTop = ui.container.scrollHeight;
}

// ========================================================================
//  LIBRARY PAGE
// ========================================================================
function setupLibraryPage() {
    const fileInput = document.getElementById('libraryFileInput');
    const pickFiles = () => fileInput?.click();

    document.getElementById('libraryUploadBtn')?.addEventListener('click', pickFiles);
    document.getElementById('heroUploadBtn')?.addEventListener('click', pickFiles);
    document.getElementById('heroKbBtn')?.addEventListener('click', () => goToPage('kb-chat'));

    fileInput?.addEventListener('change', e => {
        const files = [...(e.target.files || [])];
        files.forEach(f => uploadDocument(f));
        e.target.value = '';
    });

    // Drag & drop anywhere on the library page
    const libraryPage = document.getElementById('pageLibrary');
    if (libraryPage) {
        let dragDepth = 0;
        libraryPage.addEventListener('dragenter', e => {
            if (!e.dataTransfer?.types?.includes('Files')) return;
            e.preventDefault();
            dragDepth++;
            document.querySelector('.lib-dropzone')?.classList.add('dragover');
        });
        libraryPage.addEventListener('dragleave', e => {
            if (!e.dataTransfer?.types?.includes('Files')) return;
            dragDepth = Math.max(0, dragDepth - 1);
            if (dragDepth === 0) {
                document.querySelector('.lib-dropzone')?.classList.remove('dragover');
            }
        });
        libraryPage.addEventListener('dragover', e => {
            if (e.dataTransfer?.types?.includes('Files')) e.preventDefault();
        });
        libraryPage.addEventListener('drop', e => {
            if (!e.dataTransfer?.types?.includes('Files')) return;
            e.preventDefault();
            dragDepth = 0;
            document.querySelector('.lib-dropzone')?.classList.remove('dragover');
            const files = [...(e.dataTransfer.files || [])].filter(f => f.name.toLowerCase().endsWith('.pdf'));
            if (!files.length) { showNotification('只支持 PDF 文件', 'error'); return; }
            files.forEach(f => uploadDocument(f));
        });
    }
}

async function loadLibrary() {
    try {
        const [docsRes, sessRes] = await Promise.all([
            fetch('/api/documents').then(r => r.json()).catch(() => ({ documents: [] })),
            fetch('/api/sessions').then(r => r.json()).catch(() => ({ sessions: [] })),
        ]);
        State.documents = docsRes.documents || [];
        renderLibrary(sessRes.sessions || []);
        // Resume polling for any doc that is still indexing — e.g. after a
        // page refresh or when switching back to the library tab.
        for (const d of State.documents) {
            if (d.status !== 'ready' && d.status !== 'error') {
                ensurePolling(d.doc_id);
            }
        }
    } catch (e) { console.error('Load library error:', e); }
}

// De-dup concurrent pollers for the same doc.
const _activePollers = new Set();
function ensurePolling(docId) {
    if (_activePollers.has(docId)) return;
    _activePollers.add(docId);
    startProgressTick();
    pollDocumentStatus(docId);
}

function renderLibrary(allSessions = []) {
    // --- Update hero stats ---
    const docs = State.documents || [];
    const readyCount = docs.filter(d => d.status === 'ready').length;
    const pageCount = docs.reduce((s, d) => s + (d.page_count || 0), 0);
    const sessionCount = allSessions.length;

    const setStat = (id, v) => {
        const el = document.getElementById(id);
        if (el) {
            // Preserve <span class="unit"> if present
            const unit = el.querySelector('.unit');
            if (unit) {
                el.firstChild.textContent = v;
            } else {
                el.textContent = v;
            }
        }
    };
    setStat('statTotalDocs', docs.length);
    setStat('statReadyDocs', readyCount);
    setStat('statTotalPages', pageCount);
    setStat('statTotalSessions', sessionCount);

    const badge = document.getElementById('docsCountBadge');
    if (badge) badge.textContent = docs.length;

    // --- Render grid ---
    const grid = document.getElementById('libraryGrid');
    if (!grid) return;
    if (docs.length === 0) {
        grid.innerHTML = `
            <div class="lib-dropzone" id="libDropzone">
                <div class="dz-icon"><i class="bi bi-cloud-arrow-up"></i></div>
                <h3>拖拽 PDF 到这里 / 点击上传</h3>
                <p>Agent 会自动解析结构、生成摘要，几十秒后即可开始对话</p>
                <div class="dz-hint">支持批量上传 · 单文件建议 50MB 以内</div>
            </div>`;
        grid.querySelector('#libDropzone')?.addEventListener('click', () => {
            document.getElementById('libraryFileInput')?.click();
        });
        return;
    }
    grid.innerHTML = docs.map(d => renderDocCard(d)).join('');
    grid.querySelectorAll('[data-action="chat"]').forEach(el => {
        el.addEventListener('click', e => {
            e.stopPropagation();
            enterDocChat(el.dataset.docId);
        });
    });
    grid.querySelectorAll('[data-action="delete"]').forEach(el => {
        el.addEventListener('click', e => {
            e.stopPropagation();
            deleteDocument(el.dataset.docId, el.dataset.filename);
        });
    });
    grid.querySelectorAll('[data-action="retry"]').forEach(el => {
        el.addEventListener('click', e => {
            e.stopPropagation();
            retryDocument(el.dataset.docId);
        });
    });
}

function renderDocCard(d) {
    const statusLabel = { pending: '等待处理', indexing: '正在索引', indexed: '索引完成', ready: '就绪', error: '失败' }[d.status] || d.status;
    const summary = d.status === 'ready' && d.analysis_summary ?
        `<div class="doc-card-summary">${esc(d.analysis_summary)}</div>` : '';
    const errorMsg = d.status === 'error' && d.error_message ?
        `<div class="doc-card-error-msg">${esc(d.error_message)}</div>` : '';
    const meta = d.page_count ? `<span>· ${d.page_count} 页</span>` : '';

    // Progress block — only shown while indexing.
    const progressBlock = (d.status !== 'ready' && d.status !== 'error')
        ? renderDocProgress(d) : '';

    let footer = '';
    if (d.status === 'ready') {
        footer = `
            <button class="doc-card-btn chat-btn" data-action="chat" data-doc-id="${d.doc_id}">
                <i class="bi bi-chat-square-text"></i> 对话
            </button>
            <button class="doc-card-btn delete-btn" data-action="delete" data-doc-id="${d.doc_id}" data-filename="${esc(d.filename)}">
                <i class="bi bi-trash3"></i>
            </button>`;
    } else if (d.status === 'error') {
        footer = `
            <button class="doc-card-btn" data-action="retry" data-doc-id="${d.doc_id}">
                <i class="bi bi-arrow-clockwise"></i> 重试
            </button>
            <button class="doc-card-btn delete-btn" data-action="delete" data-doc-id="${d.doc_id}" data-filename="${esc(d.filename)}">
                <i class="bi bi-trash3"></i>
            </button>`;
    } else {
        const stageShort = STAGE_LABEL[d.stage] || '处理中';
        footer = `
            <button class="doc-card-btn" disabled style="opacity:.6;cursor:not-allowed">
                <i class="bi bi-hourglass-split"></i> ${esc(stageShort)}…
            </button>`;
    }

    return `
        <div class="doc-card ${d.status === 'error' ? 'status-error' : ''}">
            <div class="doc-card-top">
                <div class="doc-card-icon"><i class="bi bi-file-earmark-pdf"></i></div>
                <div class="doc-card-name">${esc(d.filename)}</div>
            </div>
            <div class="doc-card-meta">
                <span class="status-badge status-${d.status}"></span>
                <span>${statusLabel}</span>
                ${meta}
            </div>
            ${summary}
            ${progressBlock}
            ${errorMsg}
            <div class="doc-card-footer">${footer}</div>
        </div>`;
}

// Ordered stages + their display labels (Chinese) and nominal progress %.
// Progress % is a rough visual guide — it's intentionally not exposed by the
// backend since we can't measure LLM latency precisely.
const STAGE_ORDER = ['queued', 'parsing', 'toc_detect', 'tree_build', 'image_extract', 'analysis', 'done'];
const STAGE_LABEL = {
    queued:        '已入队',
    parsing:       '解析 PDF',
    toc_detect:    '识别目录',
    tree_build:    '构建结构树',
    image_extract: '渲染页面',
    analysis:      '生成摘要',
    done:          '已完成',
    error:         '失败',
};
// Each stage occupies a [from, to] % band. Within a band we interpolate based
// on elapsed time so the bar visibly creeps forward even while the backend is
// blocked inside an LLM call (never reaches the band's upper bound — that only
// happens when the backend flips to the next stage).
const STAGE_BAND = {
    queued:        [0,  5],
    parsing:       [5, 12],
    toc_detect:    [12, 28],
    tree_build:    [28, 70],   // widest band — usually the longest phase
    image_extract: [70, 90],
    analysis:      [90, 97],
    done:          [100, 100],
};
// How long (seconds) a stage typically takes — used to turn elapsed → progress.
// We use asymptotic easing so it always feels alive but never hits the ceiling.
const STAGE_EXPECTED_SEC = {
    queued: 2, parsing: 5, toc_detect: 15,
    tree_build: 120, image_extract: 30, analysis: 15, done: 1,
};

function stagePercent(stage, startedAt, stageMessage) {
    const band = STAGE_BAND[stage] || [0, 5];
    const [from, to] = band;
    // image_extract / tree_build embed "第 X/Y ..." in the message — parse for
    // exact progress. tree_build's "X" counts node summaries, image_extract's
    // counts pages; either way the fraction is real.
    if ((stage === 'image_extract' || stage === 'tree_build') && stageMessage) {
        const m = /第\s*(\d+)\s*\/\s*(\d+)\s*(页|个节点|节点)?/.exec(stageMessage);
        if (m) {
            const done = parseInt(m[1], 10), total = parseInt(m[2], 10);
            if (total > 0) return from + (to - from) * (done / total);
        }
    }
    if (!startedAt) return from;
    const elapsed = Math.max(0, Date.now() / 1000 - startedAt);
    const expected = STAGE_EXPECTED_SEC[stage] || 30;
    // Ease out: reaches ~86% of the band at `expected` sec, ~95% at 2× expected.
    const ratio = 1 - Math.exp(-elapsed / expected);
    return from + (to - from) * ratio;
}

function renderDocProgress(d) {
    const stage = d.stage || (d.status === 'indexed' ? 'image_extract' : 'queued');
    const msg = d.stage_message || STAGE_LABEL[stage] || '正在处理...';
    const pct = stagePercent(stage, d.stage_started_at, d.stage_message);
    const elapsedTxt = formatElapsed(d.stage_started_at);
    return `
        <div class="doc-card-progress" data-stage="${esc(stage)}" data-started-at="${d.stage_started_at || 0}" data-stage-message="${esc(msg)}">
            <div class="doc-card-progress-text">
                <span class="stage-msg">${esc(msg)}</span>
                <span class="stage-elapsed">${elapsedTxt}</span>
            </div>
            <div class="doc-card-progress-bar">
                <div class="fill" style="width:${pct.toFixed(1)}%"></div>
            </div>
        </div>`;
}

function formatElapsed(startedAt) {
    if (!startedAt) return '';
    const secs = Math.max(0, Math.floor(Date.now() / 1000 - startedAt));
    if (secs < 60) return `${secs}s`;
    const m = Math.floor(secs / 60);
    const s = secs % 60;
    return `${m}m${s.toString().padStart(2, '0')}s`;
}

// Local-only tick: every 500ms, refresh elapsed text and progress bar width for
// every visible in-flight card. This lets the UI feel alive even when the
// backend hasn't pushed a new stage update (e.g. long LLM calls).
let _progressTickTimer = null;
function startProgressTick() {
    if (_progressTickTimer) return;
    _progressTickTimer = setInterval(() => {
        const nodes = document.querySelectorAll('.doc-card-progress');
        if (!nodes.length) {
            clearInterval(_progressTickTimer);
            _progressTickTimer = null;
            return;
        }
        for (const node of nodes) {
            const stage = node.dataset.stage;
            const startedAt = parseFloat(node.dataset.startedAt || '0');
            const msg = node.dataset.stageMessage || '';
            const elapsedEl = node.querySelector('.stage-elapsed');
            const fillEl = node.querySelector('.doc-card-progress-bar .fill');
            if (elapsedEl) elapsedEl.textContent = formatElapsed(startedAt);
            if (fillEl) {
                const pct = stagePercent(stage, startedAt, msg);
                fillEl.style.width = pct.toFixed(1) + '%';
            }
        }
    }, 500);
}

async function uploadDocument(file) {
    if (!file || !file.name.toLowerCase().endsWith('.pdf')) {
        showNotification('请选择 PDF 文件', 'error'); return;
    }
    const fd = new FormData();
    fd.append('file', file);
    try {
        const r = await fetch('/api/documents/upload', { method: 'POST', body: fd });
        const d = await r.json();
        if (d.success) {
            showNotification(`"${file.name}" 已上传，正在索引...`);
            await loadLibrary();
            ensurePolling(d.document.doc_id);
        } else {
            showNotification('上传失败: ' + d.error, 'error');
        }
    } catch (e) {
        console.error('Upload error:', e);
        showNotification('上传失败', 'error');
    }
}

async function pollDocumentStatus(docId) {
    // Poll at 1s cadence while indexing. Refresh the full library only when
    // the document flips to a terminal state — otherwise just patch the card.
    const poll = async () => {
        try {
            const r = await fetch(`/api/documents/${docId}/status`);
            const d = await r.json();
            if (d.error) { _activePollers.delete(docId); return; }

            const terminal = (d.status === 'ready' || d.status === 'error');
            if (State.currentPage === 'library') {
                if (terminal) {
                    await loadLibrary();
                } else {
                    patchDocCardStatus(docId, d);
                }
            }
            if (terminal) { _activePollers.delete(docId); return; }
            setTimeout(poll, 1000);
        } catch { setTimeout(poll, 2500); }
    };
    setTimeout(poll, 800);
}

// Replace a single doc card's meta + progress in-place so the grid doesn't flicker.
function patchDocCardStatus(docId, statusData) {
    const grid = document.getElementById('libraryGrid');
    if (!grid) return;
    const cards = grid.querySelectorAll('.doc-card');
    for (const card of cards) {
        const chatBtn = card.querySelector(`[data-doc-id="${docId}"]`);
        if (!chatBtn) continue;
        // Rebuild just the progress block.
        const filenameEl = card.querySelector('.doc-card-name');
        const filename = filenameEl ? filenameEl.textContent : '';
        const fake = {
            doc_id: docId,
            filename,
            status: statusData.status,
            stage: statusData.stage,
            stage_message: statusData.stage_message,
            stage_started_at: statusData.stage_started_at,
            page_count: statusData.page_count,
        };
        const oldProgress = card.querySelector('.doc-card-progress');
        const newHtml = renderDocProgress(fake);
        if (oldProgress) {
            oldProgress.outerHTML = newHtml;
        } else {
            const footer = card.querySelector('.doc-card-footer');
            if (footer) footer.insertAdjacentHTML('beforebegin', newHtml);
        }
        break;
    }
}

async function deleteDocument(docId, filename) {
    if (!confirm(`确定删除「${filename}」的索引吗？相关聊天记录会保留但无法继续提问。`)) return;
    try {
        const r = await fetch(`/api/documents/${docId}`, { method: 'DELETE' });
        const d = await r.json();
        if (d.success) {
            showNotification('文档已删除');
            State.kbChat.selectedDocIds.delete(docId);
            await loadLibrary();
        } else {
            showNotification('删除失败: ' + d.error, 'error');
        }
    } catch (e) { showNotification('删除失败', 'error'); }
}

async function retryDocument(docId) {
    await deleteDocument(docId, State.documents.find(d => d.doc_id === docId)?.filename || '');
    document.getElementById('libraryFileInput')?.click();
}

// ========================================================================
//  DOC-CHAT PAGE  (single document, multi-session)
// ========================================================================
function setupDocChatPage() {
    document.getElementById('docBackBtn')?.addEventListener('click', () => goToPage('library'));
    document.getElementById('docNewSessionBtn')?.addEventListener('click', () => startNewDocSession());
    document.getElementById('docMemoryToggle')?.addEventListener('change', e => {
        State.docChat.useMemory = e.target.checked;
    });
    document.getElementById('docChatInput')?.addEventListener('keydown', e => handleChatKeydown(e, 'doc-chat'));
    document.getElementById('docSendBtn')?.addEventListener('click', () => sendChatMessage('doc-chat'));
}

async function enterDocChat(docId) {
    State.docChat.docId = docId;
    State.docChat.activeSessionId = null;
    goToPage('doc-chat');
}

async function onEnterDocChat() {
    const docId = State.docChat.docId;
    if (!docId) { goToPage('library'); return; }

    // Load doc info
    try {
        const r = await fetch(`/api/documents/${docId}`);
        const data = await r.json();
        State.docChat.docInfo = data.document;
    } catch (e) {
        showNotification('无法加载文档信息', 'error');
        goToPage('library'); return;
    }

    // Header
    document.getElementById('docChatFilename').textContent = State.docChat.docInfo.filename;
    document.getElementById('docChatMeta').textContent =
        State.docChat.docInfo.page_count ? `${State.docChat.docInfo.page_count} 页` : '';

    // Load analysis (non-blocking)
    loadDocAnalysis(docId);

    // Load sessions
    await loadDocSessions();

    // Clear chat area, show landing (analysis)
    renderDocChatLandingOrMessages();
}

async function loadDocAnalysis(docId) {
    try {
        const r = await fetch(`/api/documents/${docId}/analysis`);
        if (r.ok) {
            const d = await r.json();
            State.docChat.analysis = d.analysis;
        } else {
            State.docChat.analysis = null;
        }
    } catch { State.docChat.analysis = null; }
    renderDocChatLandingOrMessages();
}

async function loadDocSessions() {
    const docId = State.docChat.docId;
    try {
        const r = await fetch(`/api/sessions?mode=single&doc_id=${encodeURIComponent(docId)}`);
        const data = await r.json();
        State.docChat.sessions = data.sessions || [];
    } catch { State.docChat.sessions = []; }
    renderDocSessionsList();
}

function renderDocSessionsList() {
    const list = document.getElementById('docSessionsList');
    if (!list) return;
    const sessions = State.docChat.sessions;
    if (!sessions.length) {
        list.innerHTML = '<div class="sessions-empty">暂无历史对话<br>发送消息后自动创建</div>';
        return;
    }
    list.innerHTML = sessions.map(s => `
        <div class="session-item ${s.session_id === State.docChat.activeSessionId ? 'active' : ''}" data-session-id="${s.session_id}">
            <div class="session-item-body">
                <div class="session-item-title">${esc(s.title || '新对话')}</div>
                <div class="session-item-meta">${s.message_count || 0} 条 · ${fmtTime(s.updated_at)}</div>
            </div>
            <button class="session-item-del" data-session-id="${s.session_id}" title="删除">
                <i class="bi bi-trash3"></i>
            </button>
        </div>`).join('');
    list.querySelectorAll('.session-item').forEach(el => {
        el.addEventListener('click', (e) => {
            if (e.target.closest('.session-item-del')) return;
            openDocSession(el.dataset.sessionId);
        });
    });
    list.querySelectorAll('.session-item-del').forEach(el => {
        el.addEventListener('click', async (e) => {
            e.stopPropagation();
            await deleteSession(el.dataset.sessionId, 'doc');
        });
    });
}

function renderDocChatLandingOrMessages() {
    const landing = document.getElementById('docAnalysisLanding');
    const messages = document.getElementById('docChatMessages');
    if (!landing || !messages) return;
    if (State.docChat.activeSessionId) {
        landing.classList.add('hidden');
        messages.style.display = '';
    } else {
        landing.classList.remove('hidden');
        messages.innerHTML = '';
        messages.style.display = 'none';
        renderDocAnalysisLanding();
    }
}

function renderDocAnalysisLanding() {
    const el = document.getElementById('docAnalysisLanding');
    if (!el) return;
    const a = State.docChat.analysis;
    if (!a) {
        el.innerHTML = `
            <div class="analysis-landing-empty">
                <i class="bi bi-hourglass-split"></i>
                <div>文档智能分析生成中，稍后刷新查看…</div>
                <div style="margin-top:20px">
                    <button class="btn btn-sm btn-outline-primary" onclick="startNewDocSession()">
                        <i class="bi bi-chat-square-dots"></i> 直接开始对话
                    </button>
                </div>
            </div>`;
        return;
    }
    const findings = (a.key_findings || []).map(f => `<li>${esc(f)}</li>`).join('');
    const topics = (a.main_topics || []).map(t => `<li>${esc(t)}</li>`).join('');
    const questions = (a.suggested_questions || []).map(q =>
        `<button class="suggest-btn" data-q="${esc(q)}">${esc(q)}</button>`
    ).join('');
    el.innerHTML = `
        <div class="analysis-card-block">
            <div class="analysis-card-title-big">
                <i class="bi bi-stars"></i> 文档智能分析
            </div>
            <div class="analysis-summary-text">${esc(a.summary || '')}</div>
            <div class="analysis-grid">
                ${findings ? `<div class="analysis-card"><div class="analysis-card-title"><i class="bi bi-bookmark-star"></i> 关键发现</div><ul>${findings}</ul></div>` : ''}
                ${topics ? `<div class="analysis-card"><div class="analysis-card-title"><i class="bi bi-tags"></i> 主要主题</div><ul>${topics}</ul></div>` : ''}
            </div>
        </div>
        ${questions ? `
        <div class="suggest-questions-block">
            <div class="suggest-questions-title"><i class="bi bi-chat-left-quote"></i> 推荐问题</div>
            <div class="suggest-questions">${questions}</div>
        </div>` : ''}`;
    el.querySelectorAll('.suggest-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            const q = btn.dataset.q;
            const input = document.getElementById('docChatInput');
            if (input) input.value = q;
            sendChatMessage('doc-chat');
        });
    });
}

async function startNewDocSession() {
    State.docChat.activeSessionId = null;
    renderDocSessionsList();
    renderDocChatLandingOrMessages();
    document.getElementById('docChatInput')?.focus();
}

async function openDocSession(sessionId) {
    State.docChat.activeSessionId = sessionId;
    renderDocSessionsList();
    document.getElementById('docAnalysisLanding').classList.add('hidden');
    const messages = document.getElementById('docChatMessages');
    messages.style.display = '';
    messages.innerHTML = '<div style="text-align:center;padding:30px;color:var(--text-secondary)">加载对话中...</div>';
    State.socket.emit('get_history', { session_id: sessionId });
}

// ========================================================================
//  KB-CHAT PAGE
// ========================================================================
function setupKbChatPage() {
    document.getElementById('kbNewSessionBtn')?.addEventListener('click', () => startNewKbSession());
    document.getElementById('kbMemoryToggle')?.addEventListener('change', e => {
        State.kbChat.useMemory = e.target.checked;
    });
    document.getElementById('kbChatInput')?.addEventListener('keydown', e => handleChatKeydown(e, 'kb-chat'));
    document.getElementById('kbSendBtn')?.addEventListener('click', () => sendChatMessage('kb-chat'));
    document.getElementById('kbSelectAllBtn')?.addEventListener('click', () => {
        if (State.kbChat.activeSessionId) return;   // locked when session is active
        const list = State.documents.filter(d => d.status === 'ready').map(d => d.doc_id);
        State.kbChat.selectedDocIds = new Set(list);
        renderKbDocList();
        updateKbTopbar();
    });
    document.getElementById('kbClearAllBtn')?.addEventListener('click', () => {
        if (State.kbChat.activeSessionId) return;
        State.kbChat.selectedDocIds.clear();
        renderKbDocList();
        updateKbTopbar();
    });
    document.getElementById('kbDocSearch')?.addEventListener('input', e => {
        State.kbChat.docSearchKeyword = (e.target.value || '').toLowerCase();
        renderKbDocList();
    });
}

async function onEnterKbChat() {
    await loadLibrary();
    await loadKbSessions();
    renderKbDocList();
    updateKbTopbar();
    // default: nothing selected, no session
    renderKbMessagesEmpty();
}

async function loadKbSessions() {
    try {
        const r = await fetch('/api/sessions?mode=kb');
        const data = await r.json();
        State.kbChat.sessions = data.sessions || [];
    } catch { State.kbChat.sessions = []; }
    renderKbSessionsList();
}

function renderKbDocList() {
    const list = document.getElementById('kbDocList');
    if (!list) return;
    const kw = State.kbChat.docSearchKeyword;
    const readyDocs = State.documents.filter(d => d.status === 'ready');
    const shown = kw ? readyDocs.filter(d => d.filename.toLowerCase().includes(kw)) : readyDocs;

    const sessionActive = !!State.kbChat.activeSessionId;

    if (!readyDocs.length) {
        list.innerHTML = '<div style="padding:16px;text-align:center;color:rgba(255,255,255,0.4);font-size:12px">暂无就绪文档<br>请先到知识库上传</div>';
        return;
    }
    if (!shown.length) {
        list.innerHTML = '<div style="padding:16px;text-align:center;color:rgba(255,255,255,0.4);font-size:12px">无匹配结果</div>';
        return;
    }
    list.innerHTML = shown.map(d => {
        const checked = State.kbChat.selectedDocIds.has(d.doc_id);
        const pc = d.page_count ? `${d.page_count}页` : '';
        return `
            <label class="kb-doc-item ${sessionActive ? 'disabled' : ''}" data-doc-id="${d.doc_id}">
                <input type="checkbox" ${checked ? 'checked' : ''} ${sessionActive ? 'disabled' : ''} data-doc-id="${d.doc_id}">
                <span class="kb-doc-item-name" title="${esc(d.filename)}">${esc(d.filename)}</span>
                <span class="kb-doc-item-meta">${pc}</span>
            </label>`;
    }).join('');
    list.querySelectorAll('input[type="checkbox"]').forEach(cb => {
        cb.addEventListener('change', e => {
            const id = cb.dataset.docId;
            if (cb.checked) State.kbChat.selectedDocIds.add(id);
            else State.kbChat.selectedDocIds.delete(id);
            updateKbTopbar();
        });
    });

    const totalReady = readyDocs.length;
    document.getElementById('kbSelectInfo').textContent =
        `${State.kbChat.selectedDocIds.size} / ${totalReady}`;
}

function renderKbSessionsList() {
    const list = document.getElementById('kbSessionsList');
    if (!list) return;
    if (!State.kbChat.sessions.length) {
        list.innerHTML = '<div class="sessions-empty">暂无对话</div>';
        return;
    }
    list.innerHTML = State.kbChat.sessions.map(s => `
        <div class="session-item ${s.session_id === State.kbChat.activeSessionId ? 'active' : ''}" data-session-id="${s.session_id}">
            <div class="session-item-body">
                <div class="session-item-title">${esc(s.title || '新对话')}</div>
                <div class="session-item-meta">${(s.doc_ids || []).length} 文档 · ${s.message_count || 0} 条 · ${fmtTime(s.updated_at)}</div>
            </div>
            <button class="session-item-del" data-session-id="${s.session_id}" title="删除">
                <i class="bi bi-trash3"></i>
            </button>
        </div>`).join('');
    list.querySelectorAll('.session-item').forEach(el => {
        el.addEventListener('click', (e) => {
            if (e.target.closest('.session-item-del')) return;
            openKbSession(el.dataset.sessionId);
        });
    });
    list.querySelectorAll('.session-item-del').forEach(el => {
        el.addEventListener('click', async (e) => {
            e.stopPropagation();
            await deleteSession(el.dataset.sessionId, 'kb');
        });
    });
}

function updateKbTopbar() {
    const bar = document.getElementById('kbChatTopbar');
    if (!bar) return;
    if (State.kbChat.activeSessionId) {
        const sess = State.kbChat.sessions.find(s => s.session_id === State.kbChat.activeSessionId);
        if (!sess) { bar.innerHTML = ''; return; }
        const docNames = (sess.doc_ids || []).map(did => {
            const d = State.documents.find(x => x.doc_id === did);
            return d ? { name: d.filename, ok: d.status === 'ready' } : { name: did, ok: false };
        });
        const chips = docNames.map(x =>
            `<span class="active-chip ${x.ok ? '' : 'disabled'}" title="${x.ok ? '' : '文档已删除'}">
                <i class="bi bi-file-earmark-pdf"></i>${esc(x.name)}
            </span>`).join('');
        bar.innerHTML = `<i class="bi bi-chat-square-dots"></i> 当前对话：${chips}`;
    } else {
        const count = State.kbChat.selectedDocIds.size;
        if (count === 0) {
            bar.innerHTML = `<i class="bi bi-info-circle"></i> 请从左侧选择至少一份文档，或点击「新建对话」`;
        } else {
            bar.innerHTML = `<i class="bi bi-check-circle"></i> 已选 <strong style="margin:0 4px;color:var(--primary)">${count}</strong> 份文档，发送消息即开始新对话`;
        }
    }
}

function startNewKbSession() {
    State.kbChat.activeSessionId = null;
    renderKbSessionsList();
    renderKbDocList();
    renderKbMessagesEmpty();
    updateKbTopbar();
    document.getElementById('kbChatInput')?.focus();
}

function renderKbMessagesEmpty() {
    const mc = document.getElementById('kbChatMessages');
    if (!mc) return;
    mc.innerHTML = `
        <div class="empty-landing">
            <div class="empty-hero-icon"><i class="bi bi-chat-square-dots"></i></div>
            <h4>知识库问答</h4>
            <p>从左侧勾选需要参与对话的文档，Agent 将在多个文档间检索、对比并综合回答。</p>
        </div>`;
}

async function openKbSession(sessionId) {
    State.kbChat.activeSessionId = sessionId;
    const sess = State.kbChat.sessions.find(s => s.session_id === sessionId);
    if (sess) {
        State.kbChat.selectedDocIds = new Set(sess.doc_ids || []);
    }
    renderKbSessionsList();
    renderKbDocList();
    updateKbTopbar();
    const mc = document.getElementById('kbChatMessages');
    mc.innerHTML = '<div style="text-align:center;padding:30px;color:var(--text-secondary)">加载对话中...</div>';
    State.socket.emit('get_history', { session_id: sessionId });
}

// ========================================================================
//  Session CRUD
// ========================================================================
async function createSession(mode, docIds, title) {
    const r = await fetch('/api/sessions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode, doc_ids: docIds, title })
    });
    const d = await r.json();
    if (!r.ok) throw new Error(d.error || 'Session create failed');
    return d.session;
}

async function updateSessionTitle(sessionId, title) {
    try {
        await fetch(`/api/sessions/${sessionId}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ title })
        });
    } catch (e) { console.warn('update session title failed', e); }
}

async function deleteSession(sessionId, scope) {
    if (!confirm('确定删除此对话？')) return;
    try {
        const r = await fetch(`/api/sessions/${sessionId}`, { method: 'DELETE' });
        const d = await r.json();
        if (!d.success) throw new Error(d.error || 'delete failed');
        if (scope === 'doc') {
            if (State.docChat.activeSessionId === sessionId) {
                State.docChat.activeSessionId = null;
                renderDocChatLandingOrMessages();
            }
            await loadDocSessions();
        } else {
            if (State.kbChat.activeSessionId === sessionId) {
                State.kbChat.activeSessionId = null;
                renderKbMessagesEmpty();
                updateKbTopbar();
            }
            await loadKbSessions();
            renderKbDocList();
        }
        showNotification('对话已删除');
    } catch (e) {
        showNotification('删除失败: ' + e.message, 'error');
    }
}

// ========================================================================
//  Chat sending (unified for both doc-chat & kb-chat)
// ========================================================================
function handleChatKeydown(e, page) {
    if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        if (!State.isStreaming) sendChatMessage(page);
    }
}

async function sendChatMessage(page) {
    const ui = page === 'doc-chat' ? {
        input: document.getElementById('docChatInput'),
        messages: document.getElementById('docChatMessages'),
    } : {
        input: document.getElementById('kbChatInput'),
        messages: document.getElementById('kbChatMessages'),
    };

    const text = (ui.input?.value || '').trim();
    if (!text || State.isStreaming) return;

    // Ensure a session exists (lazy-create)
    let sessionId;
    if (page === 'doc-chat') {
        if (!State.docChat.activeSessionId) {
            try {
                const s = await createSession('single', [State.docChat.docId], truncateTitle(text));
                State.docChat.activeSessionId = s.session_id;
                await loadDocSessions();
            } catch (e) {
                showNotification('创建对话失败: ' + e.message, 'error'); return;
            }
        }
        sessionId = State.docChat.activeSessionId;
        // First-time: hide landing, show messages area
        document.getElementById('docAnalysisLanding').classList.add('hidden');
        ui.messages.style.display = '';
        if (ui.messages.innerHTML.trim() === '') ui.messages.innerHTML = '';
    } else {
        if (!State.kbChat.activeSessionId) {
            const docIds = [...State.kbChat.selectedDocIds];
            if (!docIds.length) {
                showNotification('请至少选择一份文档', 'error'); return;
            }
            try {
                const s = await createSession('kb', docIds, truncateTitle(text));
                State.kbChat.activeSessionId = s.session_id;
                await loadKbSessions();
                renderKbDocList();
                updateKbTopbar();
            } catch (e) {
                showNotification('创建对话失败: ' + e.message, 'error'); return;
            }
        }
        sessionId = State.kbChat.activeSessionId;
        if (ui.messages.innerHTML.includes('empty-landing')) ui.messages.innerHTML = '';
    }

    addUserMessage(ui.messages, text);
    ui.input.value = '';
    showTypingIndicator(ui.messages);
    State.isStreaming = true;
    updateSendButton();

    const payload = {
        session_id: sessionId,
        query: text,
        model_type: State.modelType,
        use_memory: page === 'doc-chat' ? State.docChat.useMemory : State.kbChat.useMemory,
    };

    // All modes (text & vision) use the same streaming agent path.
    State.socket.emit('agent_chat', payload);
}

function truncateTitle(text) {
    return text.length > 30 ? text.slice(0, 28) + '…' : text;
}

function stopGenerating() {
    if (State.isStreaming) State.socket.emit('stop_generating');
}

function updateSendButton() {
    const page = State.currentPage;
    const btnId = page === 'doc-chat' ? 'docSendBtn' : 'kbSendBtn';
    const btn = document.getElementById(btnId);
    if (!btn) return;
    if (State.isStreaming) {
        btn.innerHTML = '<i class="bi bi-stop-fill"></i>';
        btn.classList.add('stop-mode');
        btn.onclick = stopGenerating;
    } else {
        btn.innerHTML = '<i class="bi bi-send"></i>';
        btn.classList.remove('stop-mode');
        btn.onclick = () => sendChatMessage(page);
    }
}

// ========================================================================
//  Streaming event handlers
// ========================================================================
function onStreamStatus(status) {
    const msgs = activeChatUI()?.messages;
    if (!msgs) return;
    if (status === 'retry_answering') {
        State.streamingRawText = '';
        msgs.querySelector('#responseContent')?.replaceChildren();
    }
    const ti = msgs.querySelector('.typing-indicator');
    const st = ti?.querySelector('.status-text');
    if (st) st.textContent = {
        preparing: '正在准备文档数据...',
        prepared: '准备完成',
        searching: '正在检索相关内容...',
        answering: '正在生成回答...',
        retrying: 'Agent 正在补充检索...',
        retry_answering: '正在重新生成回答...',
    }[status] || '';
}

function onStreamThinking(content) {
    const msgs = activeChatUI()?.messages; if (!msgs) return;
    let b = msgs.querySelector('#thinkingBox');
    if (!b) {
        const ti = msgs.querySelector('.typing-indicator');
        b = document.createElement('div');
        b.className = 'thinking-box';
        b.id = 'thinkingBox';
        b.innerHTML = '<strong>推理过程</strong><span class="thinking-content"></span>';
        if (ti) ti.before(b); else msgs.appendChild(b);
    }
    const tc = b.querySelector('.thinking-content');
    if (tc) { tc.textContent += content; scrollChatToBottom(); }
}

function onStreamNodes(nodes) {
    const msgs = activeChatUI()?.messages; if (!msgs) return;
    const anchor = msgs.querySelector('#thinkingBox') || msgs.querySelector('#agentTimeline');
    if (!anchor) return;
    const fallbackDoc = State.docChat.docId;   // single-doc fallback
    const h = `<div class="nodes-box"><strong>检索节点:</strong> ${nodes.map(n => {
        const { docId, nodeId, label } = parseNodeRef(n, fallbackDoc);
        return `<span class="node-tag" onclick="showNodePreview('${esc(nodeId)}', '${esc(docId || '')}')">${esc(label)}</span>`;
    }).join(' ')}</div>`;
    anchor.insertAdjacentHTML('afterend', h);
}

// Split "doc_id::node_id" or plain "node_id" into parts.
// Returns { docId, nodeId, label } where label is what the user sees on the tag.
function parseNodeRef(ref, fallbackDocId) {
    if (typeof ref !== 'string') return { docId: fallbackDocId || '', nodeId: String(ref || ''), label: String(ref || '') };
    const idx = ref.indexOf('::');
    if (idx > 0) {
        return {
            docId: ref.slice(0, idx),
            nodeId: ref.slice(idx + 2),
            // In multi-doc (kb) mode show docId:nodeId; in single mode just nodeId.
            label: fallbackDocId && ref.startsWith(fallbackDocId + '::') ? ref.slice(idx + 2) : ref.slice(idx + 2),
        };
    }
    return { docId: fallbackDocId || '', nodeId: ref, label: ref };
}

function onStreamChunk(content) {
    const msgs = activeChatUI()?.messages; if (!msgs) return;
    let rc = msgs.querySelector('#responseContent');
    if (!rc) {
        State.streamingRawText = '';
        msgs.querySelector('.typing-indicator')?.remove();
        const box = document.createElement('div');
        box.className = 'message message-assistant';
        box.id = 'responseBox';
        box.innerHTML = '<div class="message-content" id="responseContent"></div>';
        msgs.appendChild(box);
        rc = msgs.querySelector('#responseContent');
    }
    State.streamingRawText += content;
    rc.innerHTML = renderMarkdown(State.streamingRawText);
    renderMathInContainer(rc);
    scrollChatToBottom();
}

function onStreamFullResponse(content) {
    const msgs = activeChatUI()?.messages; if (!msgs) return;
    msgs.querySelector('.typing-indicator')?.remove();
    const box = document.createElement('div');
    box.className = 'message message-assistant';
    box.innerHTML = `<div class="message-content">${renderMarkdown(content)}</div>`;
    msgs.appendChild(box);
    renderMathInContainer(box.querySelector('.message-content'));
    scrollChatToBottom();
}

function onStreamDone(wasStopped) {
    State.isStreaming = false;
    updateSendButton();
    const msgs = activeChatUI()?.messages;
    if (msgs) {
        msgs.querySelector('.typing-indicator')?.remove();
        const rc = msgs.querySelector('#responseContent');
        if (rc && State.streamingRawText) {
            const finalText = wasStopped ? State.streamingRawText + '\n\n---\n*（已停止生成）*' : State.streamingRawText;
            rc.innerHTML = renderMarkdown(finalText);
            renderMathInContainer(rc);
        }
        ['responseBox', 'responseContent', 'thinkingBox', 'agentTimeline', 'agentSteps'].forEach(id => {
            msgs.querySelector('#' + id)?.removeAttribute('id');
        });
    }
    State.streamingRawText = '';
    // Refresh session list (message_count / updated_at)
    if (State.currentPage === 'doc-chat') loadDocSessions();
    if (State.currentPage === 'kb-chat') loadKbSessions();
}

function onStreamError(msg) {
    State.isStreaming = false; updateSendButton();
    const msgs = activeChatUI()?.messages;
    if (msgs) {
        msgs.querySelector('.typing-indicator')?.remove();
        addSystemMessage(msgs, '错误: ' + msg);
    }
}

// ========================================================================
//  Agent UI
// ========================================================================
function getOrCreateTimeline(msgs) {
    let tl = msgs.querySelector('#agentTimeline');
    if (!tl) {
        const ti = msgs.querySelector('.typing-indicator');
        tl = document.createElement('div');
        tl.className = 'agent-timeline'; tl.id = 'agentTimeline';
        tl.innerHTML = '<div class="agent-timeline-header"><i class="bi bi-robot"></i> Agent 推理过程</div><div id="agentSteps"></div>';
        if (ti) ti.before(tl); else msgs.appendChild(tl);
    }
    return tl;
}

function onAgentStep(d) {
    const msgs = activeChatUI()?.messages; if (!msgs) return;
    getOrCreateTimeline(msgs);
    const sc = msgs.querySelector('#agentSteps'); if (!sc) return;
    const tool = d.tool === 'final_answer' ? '准备回答' : (d.tool || '');
    const docChip = d.doc_id ? `<span class="step-doc-chip"><i class="bi bi-file-earmark"></i> ${esc(docFilenameShort(d.doc_id))}</span>` : '';
    const div = document.createElement('div');
    div.className = 'agent-step';
    div.innerHTML = `
        <div class="step-header">
            <span class="step-number">Step ${d.step || ''}</span>
            <span class="step-tool">${esc(tool)}</span>
            ${docChip}
        </div>
        ${d.thought ? `<div class="step-thought">${esc(d.thought)}</div>` : ''}
        ${d.observation ? `<div class="step-observation">${esc(d.observation)}</div>` : ''}`;
    sc.appendChild(div);
    scrollChatToBottom();
}

function docFilenameShort(docId) {
    const d = State.documents.find(x => x.doc_id === docId);
    if (!d) return docId;
    const fn = d.filename;
    return fn.length > 20 ? fn.slice(0, 18) + '…' : fn;
}

function onAgentDecompose(d) {
    if (!d.needs_decomposition) return;
    const msgs = activeChatUI()?.messages; if (!msgs) return;
    const ti = msgs.querySelector('.typing-indicator');
    const box = document.createElement('div');
    box.className = 'decompose-box';
    const qs = (d.sub_questions || []).map((q, i) => `<div class="sub-question">${i + 1}. ${esc(q)}</div>`).join('');
    box.innerHTML = `<strong><i class="bi bi-diagram-3"></i> 问题分解 (${esc(d.synthesis_strategy || 'direct')})</strong>${qs}`;
    if (ti) ti.before(box); else msgs.appendChild(box);
    scrollChatToBottom();
}

function onAgentReflect(d) {
    const msgs = activeChatUI()?.messages; if (!msgs) return;
    const box = document.createElement('div');
    box.className = 'reflect-box';
    const s = d.score || 0;
    const cls = s < 6 ? 'poor' : s < 8 ? 'medium' : 'good';
    const action = d.action === 'accept' ? '回答质量满足要求' : '正在补充检索...';
    const icon = d.action === 'accept' ? 'bi-check-circle-fill' : 'bi-arrow-repeat';
    const issues = (d.issues || []).map(i => `<li>${esc(i)}</li>`).join('');
    box.innerHTML = `<strong><i class="bi bi-shield-check"></i> 自我检查</strong>
        <span class="reflect-score ${cls}">${s}/10</span>
        <span><i class="bi ${icon}"></i> ${action}</span>
        ${issues ? `<ul style="margin-top:6px;padding-left:18px;font-size:12px;color:#64748b">${issues}</ul>` : ''}`;
    msgs.appendChild(box);
    scrollChatToBottom();
}

// ========================================================================
//  History / Messages
// ========================================================================
function addUserMessage(msgs, content) {
    const d = document.createElement('div');
    d.className = 'message message-user';
    d.innerHTML = `<div class="message-content">${esc(content)}</div>`;
    msgs.appendChild(d);
    scrollChatToBottom();
}

function addSystemMessage(msgs, content) {
    const d = document.createElement('div');
    d.className = 'message message-assistant';
    d.innerHTML = `<div class="message-content" style="background:#fef3c7;color:#92400e"><i class="bi bi-info-circle"></i> ${esc(content)}</div>`;
    msgs.appendChild(d); scrollChatToBottom();
}

function showTypingIndicator(msgs) {
    const ti = document.createElement('div');
    ti.className = 'typing-indicator';
    ti.innerHTML = '<span class="typing-dot"></span><span class="typing-dot"></span><span class="typing-dot"></span><span class="status-text" style="margin-left:10px;font-size:14px;color:#64748b"></span>';
    msgs.appendChild(ti); scrollChatToBottom();
}

function onHistoryReceived(data) {
    const msgs = activeChatUI()?.messages;
    if (!msgs) return;
    msgs.innerHTML = '';
    const history = data.history || [];
    if (!history.length) {
        addSystemMessage(msgs, '这是一个新对话，开始提问吧！');
        return;
    }
    history.forEach(m => appendHistoryMessage(msgs, m));
    scrollChatToBottom();
}

function appendHistoryMessage(msgs, m) {
    if (m.thinking) {
        const steps = parseAgentSteps(m.thinking);
        if (steps.length > 0) {
            const tl = document.createElement('div');
            tl.className = 'agent-timeline';
            tl.innerHTML = '<div class="agent-timeline-header"><i class="bi bi-robot"></i> Agent 推理过程</div>';
            const sc = document.createElement('div');
            steps.forEach(s => {
                const tool = s.tool === 'final_answer' ? '准备回答' : s.tool;
                const div = document.createElement('div');
                div.className = 'agent-step';
                const docChip = s.doc_id ? `<span class="step-doc-chip"><i class="bi bi-file-earmark"></i> ${esc(docFilenameShort(s.doc_id))}</span>` : '';
                div.innerHTML = `
                    <div class="step-header">
                        <span class="step-number">Step ${s.step}</span>
                        <span class="step-tool">${esc(tool)}</span>
                        ${docChip}
                    </div>
                    <div class="step-thought">${esc(s.thought)}</div>`;
                sc.appendChild(div);
            });
            tl.appendChild(sc);
            msgs.appendChild(tl);
        } else {
            const tb = document.createElement('div');
            tb.className = 'thinking-box';
            tb.innerHTML = `<strong>推理过程</strong><span class="thinking-content">${esc(m.thinking)}</span>`;
            msgs.appendChild(tb);
        }
    }
    if (m.nodes?.length > 0) {
        const primaryDoc = State.docChat.docId;
        const nb = document.createElement('div');
        nb.className = 'nodes-box';
        nb.innerHTML = `<strong>检索节点:</strong> ${m.nodes.map(n => {
            const { docId, nodeId, label } = parseNodeRef(n, primaryDoc);
            return `<span class="node-tag" onclick="showNodePreview('${esc(nodeId)}', '${esc(docId || '')}')">${esc(label)}</span>`;
        }).join(' ')}`;
        msgs.appendChild(nb);
    }
    const div = document.createElement('div');
    div.className = `message message-${m.role}`;
    const rendered = m.role === 'assistant' ? renderMarkdown(m.content) : esc(m.content);
    div.innerHTML = `<div class="message-content">${rendered}</div>`;
    msgs.appendChild(div);
    if (m.role === 'assistant') renderMathInContainer(div.querySelector('.message-content'));
}

function parseAgentSteps(thinking) {
    const regex = /^Step\s+(\d+)\s+\[([^\]]+)\](?:\s*\(doc:\s*([^)]+)\))?:\s*(.+)$/gm;
    const steps = [];
    let m;
    while ((m = regex.exec(thinking)) !== null) {
        steps.push({ step: parseInt(m[1]), tool: m[2], doc_id: m[3] || null, thought: m[4] });
    }
    return steps;
}

function onHistoryCleared(data) {
    showNotification('对话已清空');
}

// ========================================================================
//  Settings
// ========================================================================
function setupSettings() {
    document.getElementById('settingsBtn')?.addEventListener('click', () => {
        const el = document.getElementById('settingsModal');
        if (el) new bootstrap.Modal(el).show();
    });
    document.getElementById('saveSettingsBtn')?.addEventListener('click', saveSettings);
}

async function loadConfig() {
    try {
        const r = await fetch('/api/config/models');
        const d = await r.json();
        const tm = d.models?.text || {}, vm = d.models?.vision || {};
        document.getElementById('textModelName').value = tm.name || '';
        document.getElementById('textApiKey').value = tm.api_key || '';
        document.getElementById('textBaseUrl').value = tm.base_url || '';
        document.getElementById('visionModelName').value = vm.name || '';
        document.getElementById('visionApiKey').value = vm.api_key || '';
        document.getElementById('visionBaseUrl').value = vm.base_url || '';
        State.modelType = d.default_type || 'text';
        switchModel(State.modelType);
    } catch (e) { console.error('load config', e); }
}

async function saveSettings() {
    const tc = {
        name: document.getElementById('textModelName').value,
        api_key: document.getElementById('textApiKey').value,
        base_url: document.getElementById('textBaseUrl').value,
        type: 'text',
    };
    const vc = {
        name: document.getElementById('visionModelName').value,
        api_key: document.getElementById('visionApiKey').value,
        base_url: document.getElementById('visionBaseUrl').value,
        type: 'vision',
    };
    try {
        await fetch('/api/config/models/text', {
            method: 'PUT', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(tc)
        });
        await fetch('/api/config/models/vision', {
            method: 'PUT', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(vc)
        });
        bootstrap.Modal.getInstance(document.getElementById('settingsModal'))?.hide();
        showNotification('配置已保存');
    } catch { showNotification('保存配置失败', 'error'); }
}

// ========================================================================
//  Skills
// ========================================================================
let _skillsCache = [];

function setupSkills() {
    document.getElementById('skillsBtn')?.addEventListener('click', () => {
        loadSkills();
        new bootstrap.Modal(document.getElementById('skillsModal')).show();
    });
    document.getElementById('skillFileInput')?.addEventListener('change', e => {
        const f = e.target.files?.[0];
        if (f) uploadSkillFile(f);
        e.target.value = '';
    });
}

async function loadSkills() {
    try {
        const r = await fetch('/api/skills');
        const d = await r.json();
        _skillsCache = d.skills || [];
        renderSkillsGrid();
    } catch (e) { console.warn('load skills', e); }
}

function renderSkillsGrid() {
    const grid = document.getElementById('skillsGrid');
    if (!grid) return;
    if (!_skillsCache.length) {
        grid.innerHTML = '<div style="grid-column:1/-1;padding:30px;text-align:center;color:var(--text-secondary)">暂无 Skill，点击右上角「新建」或「上传」</div>';
        return;
    }
    grid.innerHTML = _skillsCache.map(s => `
        <div class="skill-card">
            <div class="skill-toggle ${s.enabled ? 'active' : ''}" data-id="${esc(s.skill_id)}" data-enabled="${s.enabled ? 'true' : 'false'}"></div>
            <div class="skill-card-body" data-id="${esc(s.skill_id)}">
                <div class="skill-card-name">${esc(s.name)}</div>
                <div class="skill-card-desc">${esc(s.description || '无描述')}</div>
            </div>
            <button class="skill-card-edit" data-id="${esc(s.skill_id)}" title="编辑"><i class="bi bi-pencil"></i></button>
        </div>`).join('');
    grid.querySelectorAll('.skill-toggle').forEach(el => {
        el.addEventListener('click', async e => {
            e.stopPropagation();
            await toggleSkillEnabled(el.dataset.id, el.dataset.enabled !== 'true');
        });
    });
    grid.querySelectorAll('.skill-card-body').forEach(el =>
        el.addEventListener('click', () => openSkillEditor(el.dataset.id)));
    grid.querySelectorAll('.skill-card-edit').forEach(el =>
        el.addEventListener('click', e => { e.stopPropagation(); openSkillEditor(el.dataset.id); }));
}

async function toggleSkillEnabled(skillId, enabled) {
    try {
        await fetch(`/api/skills/${skillId}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ enabled })
        });
        const s = _skillsCache.find(x => x.skill_id === skillId);
        if (s) s.enabled = enabled;
        renderSkillsGrid();
    } catch (e) { console.error('toggle skill', e); }
}

function openSkillEditor(skillId) {
    const modal = new bootstrap.Modal(document.getElementById('skillEditorModal'));
    const titleEl = document.getElementById('skillEditorTitle');
    const nameEl = document.getElementById('skillEditorName');
    const descEl = document.getElementById('skillEditorDesc');
    const contentEl = document.getElementById('skillEditorContent');
    const idEl = document.getElementById('skillEditorId');
    const deleteBtn = document.getElementById('skillDeleteBtn');
    const previewPane = document.getElementById('skillPreviewPane');
    if (previewPane) previewPane.style.display = 'none';

    if (skillId) {
        const s = _skillsCache.find(x => x.skill_id === skillId);
        if (!s) return;
        titleEl.textContent = '编辑 Skill';
        nameEl.value = s.name;
        descEl.value = s.description || '';
        contentEl.value = s.content || '';
        idEl.value = s.skill_id;
        deleteBtn.style.display = 'inline-flex';
    } else {
        titleEl.textContent = '新建 Skill';
        nameEl.value = ''; descEl.value = ''; contentEl.value = '';
        idEl.value = '';
        deleteBtn.style.display = 'none';
    }
    modal.show();
}

async function saveSkill() {
    const id = document.getElementById('skillEditorId')?.value;
    const name = document.getElementById('skillEditorName')?.value?.trim();
    const description = document.getElementById('skillEditorDesc')?.value?.trim();
    const content = document.getElementById('skillEditorContent')?.value?.trim();
    if (!name) { showNotification('请输入 Skill 名称', 'error'); return; }
    try {
        if (id) {
            await fetch(`/api/skills/${id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name, description, content }) });
        } else {
            await fetch('/api/skills', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name, description, content }) });
        }
        bootstrap.Modal.getInstance(document.getElementById('skillEditorModal'))?.hide();
        await loadSkills();
        showNotification(id ? 'Skill 已更新' : 'Skill 已创建');
    } catch (e) { showNotification('保存失败: ' + e.message, 'error'); }
}

async function deleteCurrentSkill() {
    const id = document.getElementById('skillEditorId')?.value;
    if (!id) return;
    if (!confirm('确定删除此 Skill?')) return;
    try {
        await fetch(`/api/skills/${id}`, { method: 'DELETE' });
        bootstrap.Modal.getInstance(document.getElementById('skillEditorModal'))?.hide();
        await loadSkills();
        showNotification('Skill 已删除');
    } catch (e) { showNotification('删除失败', 'error'); }
}

async function uploadSkillFile(file) {
    if (!file || !file.name.endsWith('.md')) { showNotification('仅支持 .md 文件', 'error'); return; }
    const fd = new FormData(); fd.append('file', file);
    try {
        const r = await fetch('/api/skills/upload', { method: 'POST', body: fd });
        const d = await r.json();
        if (d.success) { await loadSkills(); showNotification('Skill 已导入'); }
        else showNotification('上传失败: ' + (d.error || '未知错误'), 'error');
    } catch (e) { showNotification('上传失败', 'error'); }
}

function toggleSkillPreview() {
    const pane = document.getElementById('skillPreviewPane');
    const editor = document.getElementById('skillEditorContent');
    if (!pane || !editor) return;
    if (pane.style.display === 'none') {
        pane.style.display = 'block';
        pane.innerHTML = typeof marked !== 'undefined' ? marked.parse(editor.value || '') : esc(editor.value || '');
        document.getElementById('skillPreviewToggle').classList.add('active');
    } else {
        pane.style.display = 'none';
        document.getElementById('skillPreviewToggle').classList.remove('active');
    }
}

// Expose for inline handlers
window.saveSkill = saveSkill;
window.deleteCurrentSkill = deleteCurrentSkill;
window.toggleSkillPreview = toggleSkillPreview;
window.openSkillEditor = openSkillEditor;
window.startNewDocSession = startNewDocSession;

// ========================================================================
//  Page preview modal (per-document, unchanged core logic)
// ========================================================================
async function showNodePreview(nodeId, docId) {
    if (!docId) docId = State.docChat.docId;
    if (!docId) return;
    if (!State.nodeMapCache[docId] || !State.allPagesCache[docId]) {
        try {
            const r = await fetch(`/api/documents/${docId}/node-info`);
            const d = await r.json();
            if (d.node_map) {
                State.nodeMapCache[docId] = d.node_map;
                State.allPagesCache[docId] = d.all_pages || [];
            } else return;
        } catch { return; }
    }
    const info = State.nodeMapCache[docId]?.[nodeId];
    if (!info) { showNotification('未找到节点信息', 'error'); return; }
    showPagePreviewModal(docId, nodeId, info, State.allPagesCache[docId]);
}
window.showNodePreview = showNodePreview;

function buildPageNodeMap(nodeMap) {
    const pageNodes = {};
    if (!nodeMap) return pageNodes;
    Object.entries(nodeMap).forEach(([nid, info], idx) => {
        const s = info.start_index || 1;
        const e = info.end_index || s;
        const color = NODE_COLORS[idx % NODE_COLORS.length];
        for (let p = s; p <= e; p++) {
            if (!pageNodes[p]) pageNodes[p] = [];
            pageNodes[p].push({ id: nid, title: info.title || nid, color });
        }
    });
    return pageNodes;
}

function getNodeColor(nodeId, nodeMap) {
    const keys = Object.keys(nodeMap || {});
    const idx = keys.indexOf(nodeId);
    return NODE_COLORS[(idx >= 0 ? idx : 0) % NODE_COLORS.length];
}

function showPagePreviewModal(docId, nodeId, nodeInfo, allPages) {
    let modal = document.getElementById('pagePreviewModal');
    if (!modal) {
        modal = document.createElement('div');
        modal.id = 'pagePreviewModal';
        modal.className = 'page-preview-modal';
        modal.innerHTML = `<div class="page-preview-content">
            <div class="page-preview-header">
                <h5 class="page-preview-title"></h5>
                <div class="page-preview-header-actions">
                    <button class="highlight-toggle-btn" id="highlightToggleBtn" title="点击节点标签以高亮"><i class="bi bi-highlighter"></i></button>
                    <button class="page-preview-close"><i class="bi bi-x-lg"></i></button>
                </div>
            </div>
            <div class="node-info-card" id="nodeInfoCard"></div>
            <div class="page-preview-body"><div class="page-preview-images"></div></div>
            <div class="page-preview-footer"><div class="page-preview-nav">
                <button class="page-nav-btn" id="prevPageBtn"><i class="bi bi-chevron-left"></i> 上一页</button>
                <span class="page-indicator" id="pageIndicator"></span>
                <button class="page-nav-btn" id="nextPageBtn">下一页 <i class="bi bi-chevron-right"></i></button>
            </div></div></div>`;
        document.body.appendChild(modal);
        modal.querySelector('.page-preview-close').addEventListener('click', closePagePreviewModal);
        modal.querySelector('#prevPageBtn').addEventListener('click', () => navPage(-1));
        modal.querySelector('#nextPageBtn').addEventListener('click', () => navPage(1));
        modal.querySelector('#highlightToggleBtn').addEventListener('click', () => toggleHighlights());
    }

    State.activeHighlightNodeId = null;
    modal.dataset.docId = docId;
    updateHighlightToggleBtn();

    const nMap = State.nodeMapCache[docId] || {};
    const pageNodeMap = buildPageNodeMap(nMap);
    const currentStart = nodeInfo.start_index || 1;
    const currentEnd = nodeInfo.end_index || currentStart;
    const nodeColor = getNodeColor(nodeId, nMap);

    const docInfo = State.documents.find(x => x.doc_id === docId);
    modal.querySelector('.page-preview-title').textContent = docInfo?.filename || 'PDF 预览';

    const infoCard = modal.querySelector('#nodeInfoCard');
    infoCard.innerHTML = `
        <div class="node-info-badge" style="background:${nodeColor.bg};color:${nodeColor.text}">${esc(nodeId)}</div>
        <div class="node-info-detail">
            <div class="node-info-title">${esc(nodeInfo.title || '未命名节点')}</div>
            <div class="node-info-meta">
                <span><i class="bi bi-file-earmark"></i> 第 ${currentStart}–${currentEnd} 页</span>
            </div>
            ${nodeInfo.summary ? `<div class="node-info-summary">${esc(nodeInfo.summary)}</div>` : ''}
        </div>`;

    const imgs = modal.querySelector('.page-preview-images');
    if (!allPages?.length) {
        imgs.innerHTML = '<div style="padding:40px;text-align:center;color:var(--text-secondary)">无页面图片</div>';
    } else {
        imgs.innerHTML = allPages.map((p, i) => {
            const pageNum = p.page;
            const isCurrent = pageNum >= currentStart && pageNum <= currentEnd;
            const nodes = pageNodeMap[pageNum] || [];
            const tags = nodes.map(n => {
                const isActive = n.id === nodeId;
                const label = n.title.length > 20 ? n.title.slice(0, 18) + '…' : n.title;
                return `<span class="page-node-tag${isActive ? ' active-node' : ''}" data-node-id="${n.id}" `
                    + `style="background:${n.color.bg};color:${n.color.text}" `
                    + `title="点击高亮 ${esc(n.id + ': ' + n.title)}">`
                    + `<span class="page-node-tag-id">${n.id}</span> ${esc(label)}</span>`;
            }).join('');
            return `<div class="page-image-container${isCurrent ? ' current-node-page' : ''}" data-index="${i}">`
                + `<img src="${p.url}" alt="Page ${pageNum}" class="page-preview-image">`
                + (tags ? `<div class="page-node-tags">${tags}</div>` : '')
                + `<div class="page-number">第 ${pageNum} 页</div></div>`;
        }).join('');
        imgs.querySelectorAll('.page-preview-image').forEach(img => {
            img.addEventListener('click', () => openFullscreen(img.src));
        });
        imgs.querySelectorAll('.page-node-tag').forEach(tag => {
            tag.addEventListener('click', e => {
                e.stopPropagation();
                activateNodeHighlight(tag.dataset.nodeId);
            });
        });
    }

    modal.dataset.pages = JSON.stringify(allPages);
    const si = Math.max(0, Math.min(currentStart - 1, allPages.length - 1));
    modal.dataset.currentIndex = si;
    updatePageNav();
    modal.classList.add('active');
    document.querySelector('.main-content.preview-open')?.classList.remove('preview-open');
    const main = document.querySelector('.page.active .main-content');
    main?.classList.add('preview-open');

    initHighlightsForModal(modal, nMap, docId);
    setTimeout(() => {
        const target = modal.querySelectorAll('.page-image-container')[si];
        const scrollParent = modal.querySelector('.page-preview-body');
        if (target && scrollParent) scrollParent.scrollTop = target.offsetTop - scrollParent.offsetTop;
    }, 100);
}

async function initHighlightsForModal(modal, nMap, docId) {
    const hlData = await fetchTextHighlights(docId);
    if (!hlData) return;
    if (State._highlightObserver) { State._highlightObserver.disconnect(); State._highlightObserver = null; }
    State._highlightObserver = new ResizeObserver(() => {
        if (State.activeHighlightNodeId) {
            redrawAllHighlights(modal, hlData, nMap, State.activeHighlightNodeId);
        }
    });
    const body = modal.querySelector('.page-preview-body');
    if (body) State._highlightObserver.observe(body);
}

async function fetchTextHighlights(docId) {
    if (State.highlightsCache[docId]) return State.highlightsCache[docId];
    try {
        const r = await fetch(`/api/documents/${docId}/text-highlights`);
        if (r.ok) {
            const d = await r.json();
            State.highlightsCache[docId] = d;
            return d;
        }
    } catch (e) { console.error('Highlights fetch:', e); }
    return null;
}

function drawHighlightsOnPage(container, pageNum, hlData, nodeMap, targetNodeId) {
    container.querySelectorAll('.highlight-canvas').forEach(c => c.remove());
    if (!targetNodeId || !hlData) return;
    const pageInfo = hlData.pages?.[String(pageNum)];
    if (!pageInfo || !pageInfo.blocks?.length) return;
    const hasTarget = pageInfo.blocks.some(b => b.node_id === targetNodeId);
    if (!hasTarget) return;
    const img = container.querySelector('.page-preview-image');
    if (!img || !img.naturalWidth) return;

    const canvas = document.createElement('canvas');
    canvas.className = 'highlight-canvas';
    const displayW = img.clientWidth, displayH = img.clientHeight;
    canvas.width = displayW; canvas.height = displayH;
    canvas.style.width = displayW + 'px'; canvas.style.height = displayH + 'px';
    container.insertBefore(canvas, img.nextSibling);

    const ctx = canvas.getContext('2d');
    const scale = hlData.scale || 2.0;
    const sx = displayW / (pageInfo.width * scale);
    const sy = displayH / (pageInfo.height * scale);
    const nodeKeys = Object.keys(nodeMap || {});
    const colorIdx = nodeKeys.indexOf(targetNodeId);
    const color = NODE_COLORS[(colorIdx >= 0 ? colorIdx : 0) % NODE_COLORS.length];
    const rgb = hexToRgb(color.text) || { r: 79, g: 70, b: 229 };

    for (const block of pageInfo.blocks) {
        if (block.node_id !== targetNodeId) continue;
        const [x0, y0, x1, y1] = block.bbox;
        ctx.fillStyle = `rgba(${rgb.r},${rgb.g},${rgb.b},0.18)`;
        ctx.fillRect(x0 * scale * sx, y0 * scale * sy, (x1 - x0) * scale * sx, (y1 - y0) * scale * sy);
    }
}

function hexToRgb(hex) {
    if (!hex || hex[0] !== '#') return null;
    const v = parseInt(hex.slice(1), 16);
    return { r: (v >> 16) & 255, g: (v >> 8) & 255, b: v & 255 };
}

function redrawAllHighlights(modal, hlData, nodeMap, targetNodeId) {
    modal.querySelectorAll('.page-image-container').forEach(c => {
        const idx = parseInt(c.dataset.index);
        drawHighlightsOnPage(c, idx + 1, hlData, nodeMap, targetNodeId);
    });
}

function clearAllHighlights() {
    const modal = document.getElementById('pagePreviewModal');
    if (modal) modal.querySelectorAll('.highlight-canvas').forEach(c => c.remove());
    State.activeHighlightNodeId = null;
    updateHighlightToggleBtn();
    updateActiveNodeTags();
}

function activateNodeHighlight(nodeId) {
    if (State.activeHighlightNodeId === nodeId) { clearAllHighlights(); return; }
    State.activeHighlightNodeId = nodeId;
    const modal = document.getElementById('pagePreviewModal');
    if (!modal) return;
    const docId = modal.dataset.docId;
    const nMap = State.nodeMapCache[docId] || {};
    const hlData = State.highlightsCache[docId];
    redrawAllHighlights(modal, hlData, nMap, nodeId);
    updateHighlightToggleBtn();
    updateActiveNodeTags();
}

function toggleHighlights() {
    if (State.activeHighlightNodeId) clearAllHighlights();
}

function updateHighlightToggleBtn() {
    const btn = document.getElementById('highlightToggleBtn');
    if (btn) {
        btn.classList.toggle('active', !!State.activeHighlightNodeId);
        btn.title = State.activeHighlightNodeId ? '清除高亮 (' + State.activeHighlightNodeId + ')' : '点击节点标签以高亮';
    }
}

function updateActiveNodeTags() {
    document.querySelectorAll('.page-node-tag').forEach(tag => {
        tag.classList.toggle('highlight-active', tag.dataset.nodeId === State.activeHighlightNodeId);
    });
}

function closePagePreviewModal() {
    State.activeHighlightNodeId = null;
    if (State._highlightObserver) { State._highlightObserver.disconnect(); State._highlightObserver = null; }
    const m = document.getElementById('pagePreviewModal');
    if (m) {
        m.classList.remove('active');
        document.querySelectorAll('.main-content').forEach(el => el.classList.remove('preview-open'));
    }
}
window.closePagePreviewModal = closePagePreviewModal;

function navPage(dir) {
    const m = document.getElementById('pagePreviewModal'); if (!m) return;
    const pages = JSON.parse(m.dataset.pages || '[]');
    let i = Math.max(0, Math.min(pages.length - 1, (parseInt(m.dataset.currentIndex) || 0) + dir));
    m.dataset.currentIndex = i;
    const target = m.querySelectorAll('.page-image-container')[i];
    const scrollParent = m.querySelector('.page-preview-body');
    if (target && scrollParent) scrollParent.scrollTop = target.offsetTop - scrollParent.offsetTop;
    updatePageNav();
}

function updatePageNav() {
    const m = document.getElementById('pagePreviewModal'); if (!m) return;
    const pages = JSON.parse(m.dataset.pages || '[]');
    const i = parseInt(m.dataset.currentIndex) || 0;
    const ind = document.getElementById('pageIndicator');
    if (ind) ind.textContent = pages.length ? `${i + 1} / ${pages.length}` : '0 / 0';
    const pb = document.getElementById('prevPageBtn'); if (pb) pb.disabled = i === 0;
    const nb = document.getElementById('nextPageBtn'); if (nb) nb.disabled = i >= pages.length - 1;
}

function openFullscreen(url) {
    const o = document.createElement('div');
    o.className = 'fullscreen-image-overlay'; o.onclick = () => o.remove();
    o.innerHTML = `<img src="${url}" class="fullscreen-image"><button class="fullscreen-close"><i class="bi bi-x-lg"></i></button>`;
    o.querySelector('.fullscreen-close').addEventListener('click', e => { e.stopPropagation(); o.remove(); });
    document.body.appendChild(o);
}

// slideIn / slideOut keyframes
const _s = document.createElement('style');
_s.textContent = '@keyframes slideIn{from{transform:translateX(100%);opacity:0}to{transform:translateX(0);opacity:1}}@keyframes slideOut{from{transform:translateX(0);opacity:1}to{transform:translateX(100%);opacity:0}}';
document.head.appendChild(_s);
