/**
 * PageIndex Chat UI - Frontend Application
 */

// Socket.IO connection
let socket;
let currentDocId = null;
let currentModelType = 'text';
let useMemory = true;
let isStreaming = false;

// Initialize application
document.addEventListener('DOMContentLoaded', () => {
    initSocket();
    loadDocuments();
    loadConfig();
    setupDragDrop();
    setupEventListeners();
});

// Setup additional event listeners
function setupEventListeners() {
    // Model toggle buttons
    const textModelBtn = document.getElementById('textModelBtn');
    const visionModelBtn = document.getElementById('visionModelBtn');

    if (textModelBtn) {
        textModelBtn.addEventListener('click', () => switchModel('text'));
        console.log('textModelBtn listener added');
    } else {
        console.error('textModelBtn not found');
    }

    if (visionModelBtn) {
        visionModelBtn.addEventListener('click', () => switchModel('vision'));
        console.log('visionModelBtn listener added');
    } else {
        console.error('visionModelBtn not found');
    }

    // Settings button
    const settingsBtn = document.getElementById('settingsBtn');
    if (settingsBtn) {
        settingsBtn.addEventListener('click', openSettingsModal);
        console.log('settingsBtn listener added');
    } else {
        console.error('settingsBtn not found');
    }

    // Memory toggle
    const memoryToggle = document.getElementById('memoryToggle');
    if (memoryToggle) {
        memoryToggle.addEventListener('change', (e) => toggleMemory(e.target.checked));
    }

    // Upload area click
    const uploadArea = document.getElementById('uploadArea');
    const fileInput = document.getElementById('fileInput');
    if (uploadArea && fileInput) {
        uploadArea.addEventListener('click', () => {
            console.log('Upload area clicked');
            fileInput.click();
        });
        fileInput.addEventListener('change', (e) => {
            if (e.target.files && e.target.files[0]) {
                uploadDocument(e.target.files[0]);
            }
        });
        console.log('uploadArea listener added');
    } else {
        console.error('uploadArea or fileInput not found');
    }

    // Chat input and send button
    const chatInput = document.getElementById('chatInput');
    const sendBtn = document.getElementById('sendBtn');
    if (chatInput) {
        chatInput.addEventListener('keydown', handleKeyDown);
    }
    if (sendBtn) {
        sendBtn.addEventListener('click', sendMessage);
    }

    // Save settings button
    const saveSettingsBtn = document.getElementById('saveSettingsBtn');
    if (saveSettingsBtn) {
        saveSettingsBtn.addEventListener('click', () => {
            if (window.saveSettings) {
                window.saveSettings();
            }
        });
    }

    console.log('Event listeners setup complete');
}

// Initialize Socket.IO
function initSocket() {
    socket = io();

    socket.on('connect', () => {
        console.log('Connected to server');
    });

    socket.on('disconnect', () => {
        console.log('Disconnected from server');
    });

    socket.on('connected', (data) => {
        console.log('Socket connected:', data);
    });

    socket.on('status', (data) => {
        updateStatus(data.status);
    });

    socket.on('thinking', (data) => {
        showThinking(data.content);
    });

    socket.on('thinking_chunk', (data) => {
        appendToThinking(data.content);
    });

    socket.on('nodes', (data) => {
        showNodes(data.nodes);
    });

    socket.on('chunk', (data) => {
        appendToResponse(data.content);
    });

    socket.on('response', (data) => {
        setResponse(data.content);
    });

    socket.on('done', () => {
        finishResponse();
    });

    socket.on('error', (data) => {
        showError(data.message);
    });

    socket.on('history', (data) => {
        displayHistory(data.history);
    });

    socket.on('history_cleared', (data) => {
        if (currentDocId === data.doc_id) {
            clearChatDisplay();
        }
    });
}

// Load documents list
async function loadDocuments() {
    try {
        const response = await fetch('/api/documents');
        const data = await response.json();
        renderDocuments(data.documents);
    } catch (error) {
        console.error('Error loading documents:', error);
    }
}

// Render documents list
function renderDocuments(documents) {
    const container = document.getElementById('documentList');

    if (documents.length === 0) {
        container.innerHTML = `
            <div style="text-align: center; padding: 20px; color: rgba(255,255,255,0.5);">
                <i class="bi bi-file-earmark" style="font-size: 32px;"></i>
                <p style="margin-top: 10px;">暂无文档</p>
            </div>
        `;
        return;
    }

    container.innerHTML = documents.map(doc => `
        <div class="doc-item ${doc.doc_id === currentDocId ? 'active' : ''} ${doc.status === 'error' ? 'error' : ''}" 
             data-doc-id="${doc.doc_id}">
            <div class="doc-name">${doc.filename}</div>
            <div class="doc-status">
                <span class="status-badge status-${doc.status}"></span>
                ${getStatusText(doc.status)}
                ${doc.status === 'error' && doc.error_message ? `<span title="${doc.error_message}"><i class="bi bi-info-circle"></i></span>` : ''}
            </div>
            <div class="doc-actions">
                ${doc.status === 'error' ? `
                    <button class="doc-action-btn retry" onclick="event.stopPropagation(); retryUpload('${doc.doc_id}', '${doc.filename}')">
                        <i class="bi bi-arrow-clockwise"></i> 重新上传
                    </button>
                ` : ''}
                <button class="doc-action-btn delete" onclick="event.stopPropagation(); deleteDocument('${doc.doc_id}', '${doc.filename}')">
                    <i class="bi bi-trash"></i> 删除
                </button>
            </div>
        </div>
    `).join('');

    // Add click event listeners to document items
    container.querySelectorAll('.doc-item').forEach(item => {
        item.addEventListener('click', () => selectDocument(item.dataset.docId));
    });
}

// Get status text
function getStatusText(status) {
    const statusMap = {
        'pending': '等待处理',
        'indexing': '正在索引...',
        'indexed': '索引完成',
        'ready': '就绪',
        'error': '错误'
    };
    return statusMap[status] || status;
}

// Select document
async function selectDocument(docId) {
    currentDocId = docId;

    // Update UI
    document.querySelectorAll('.doc-item').forEach(item => {
        item.classList.remove('active');
        if (item.dataset.docId === docId) {
            item.classList.add('active');
        }
    });

    // Clear chat and load history from server
    clearChatDisplay();
    socket.emit('get_history', { doc_id: docId });
    hideEmptyState();
}

// Upload document
async function uploadDocument(file) {
    if (!file || !file.name.toLowerCase().endsWith('.pdf')) {
        alert('请选择 PDF 文件');
        return;
    }

    const formData = new FormData();
    formData.append('file', file);

    try {
        const response = await fetch('/api/documents/upload', {
            method: 'POST',
            body: formData
        });

        const data = await response.json();

        if (data.success) {
            currentDocId = data.document.doc_id;
            loadDocuments();
            hideEmptyState();
            clearChatDisplay();

            // Start polling for status
            pollDocumentStatus(data.document.doc_id);
        } else {
            alert('上传失败: ' + data.error);
        }
    } catch (error) {
        console.error('Upload error:', error);
        alert('上传失败');
    }
}

// Delete document
async function deleteDocument(docId, filename) {
    if (!confirm(`确定要删除文档 "${filename}" 吗？\n这将删除该文档及其所有对话历史。`)) {
        return;
    }

    try {
        const response = await fetch(`/api/documents/${docId}`, {
            method: 'DELETE'
        });

        const data = await response.json();

        if (data.success) {
            // If the deleted document was selected, clear the chat
            if (currentDocId === docId) {
                currentDocId = null;
                clearChatDisplay();
            }
            loadDocuments();
            showNotification('文档已删除');
        } else {
            alert('删除失败: ' + data.error);
        }
    } catch (error) {
        console.error('Delete error:', error);
        alert('删除失败');
    }
}

// Retry upload (for failed documents)
function retryUpload(docId, filename) {
    // First delete the failed document
    deleteDocumentForRetry(docId, filename);
}

// Delete document and then trigger file picker for re-upload
async function deleteDocumentForRetry(docId, filename) {
    try {
        const response = await fetch(`/api/documents/${docId}`, {
            method: 'DELETE'
        });

        const data = await response.json();

        if (data.success) {
            // Clear the current document if it was the failed one
            if (currentDocId === docId) {
                currentDocId = null;
                clearChatDisplay();
            }
            loadDocuments();
            
            // Trigger file picker for re-upload
            const fileInput = document.getElementById('fileInput');
            if (fileInput) {
                fileInput.click();
            }
        } else {
            alert('删除失败: ' + data.error);
        }
    } catch (error) {
        console.error('Delete error:', error);
        alert('删除失败');
    }
}

// Poll document status
async function pollDocumentStatus(docId) {
    const poll = async () => {
        try {
            const response = await fetch(`/api/documents/${docId}/status`);
            const data = await response.json();

            loadDocuments();

            if (data.status === 'ready' || data.status === 'error') {
                if (data.status === 'ready') {
                    addSystemMessage('文档索引完成，可以开始对话了！');
                } else {
                    addSystemMessage('文档索引失败: ' + data.error_message);
                }
                return;
            }

            // Continue polling
            setTimeout(poll, 2000);
        } catch (error) {
            console.error('Poll error:', error);
        }
    };

    setTimeout(poll, 1000);
}

// Load configuration
async function loadConfig() {
    try {
        const response = await fetch('/api/config/models');
        const data = await response.json();

        // Set text model config
        const textConfig = data.models.text || {};
        document.getElementById('textModelName').value = textConfig.name || '';
        document.getElementById('textApiKey').value = textConfig.api_key || '';
        document.getElementById('textBaseUrl').value = textConfig.base_url || '';

        // Set vision model config
        const visionConfig = data.models.vision || {};
        document.getElementById('visionModelName').value = visionConfig.name || '';
        document.getElementById('visionApiKey').value = visionConfig.api_key || '';
        document.getElementById('visionBaseUrl').value = visionConfig.base_url || '';

        // Set default model type
        currentModelType = data.default_type || 'text';
        updateModelToggle();
    } catch (error) {
        console.error('Error loading config:', error);
    }
}

// Switch model
function switchModel(modelType) {
    currentModelType = modelType;
    updateModelToggle();
    console.log('Model switched to:', modelType);
}

// Update model toggle UI
function updateModelToggle() {
    const textBtn = document.getElementById('textModelBtn');
    const visionBtn = document.getElementById('visionModelBtn');

    if (currentModelType === 'text') {
        textBtn.classList.add('active');
        visionBtn.classList.remove('active');
    } else {
        textBtn.classList.remove('active');
        visionBtn.classList.add('active');
    }
}

// Toggle memory
function toggleMemory(enabled) {
    useMemory = enabled;
}

// Send message
function sendMessage() {
    const input = document.getElementById('chatInput');
    const message = input.value.trim();

    if (!message || isStreaming) return;

    if (!currentDocId) {
        alert('请先选择或上传文档');
        return;
    }

    // Check document status
    const docItem = document.querySelector(`.doc-item[data-doc-id="${currentDocId}"]`);
    if (docItem) {
        const statusBadge = docItem.querySelector('.status-badge');
        if (statusBadge && !statusBadge.classList.contains('status-ready')) {
            alert('文档尚未准备就绪，请等待索引完成');
            return;
        }
    }

    // Add user message to chat
    addUserMessage(message);
    input.value = '';

    // Show typing indicator
    showTypingIndicator();

    // Send to server
    isStreaming = true;
    updateSendButton();

    if (currentModelType === 'text') {
        socket.emit('chat', {
            doc_id: currentDocId,
            query: message,
            model_type: currentModelType,
            use_memory: useMemory
        });
    } else {
        socket.emit('chat_sync', {
            doc_id: currentDocId,
            query: message,
            model_type: currentModelType,
            use_memory: useMemory
        });
    }
}

// Handle key down
function handleKeyDown(event) {
    if (event.key === 'Enter' && !event.shiftKey) {
        event.preventDefault();
        sendMessage();
    }
}

// Update status display
function updateStatus(status) {
    const typingIndicator = document.getElementById('typingIndicator');
    if (typingIndicator) {
        const statusText = typingIndicator.querySelector('.status-text');
        if (statusText) {
            const statusMap = {
                'preparing': '正在准备文档数据...',
                'prepared': '准备完成',
                'searching': '正在检索相关内容...',
                'answering': '正在生成回答...'
            };
            statusText.textContent = statusMap[status] || '';
        }
    }
}

// Show thinking process
function showThinking(content) {
    const messagesContainer = document.getElementById('chatMessages');
    const typingIndicator = document.getElementById('typingIndicator');

    if (typingIndicator) {
        // Create thinking box before typing indicator
        const thinkingBox = document.createElement('div');
        thinkingBox.className = 'thinking-box';
        thinkingBox.id = 'thinkingBox';
        thinkingBox.innerHTML = `<strong>推理过程</strong><span class="thinking-content">${content}</span>`;
        typingIndicator.before(thinkingBox);
    }
}

// Append to thinking (streaming)
function appendToThinking(content) {
    let thinkingBox = document.getElementById('thinkingBox');
    
    if (!thinkingBox) {
        // Create thinking box if it doesn't exist
        const typingIndicator = document.getElementById('typingIndicator');
        const messagesContainer = document.getElementById('chatMessages');
        
        thinkingBox = document.createElement('div');
        thinkingBox.className = 'thinking-box';
        thinkingBox.id = 'thinkingBox';
        thinkingBox.innerHTML = `<strong>推理过程</strong><span class="thinking-content"></span>`;
        
        if (typingIndicator) {
            typingIndicator.before(thinkingBox);
        } else {
            messagesContainer.appendChild(thinkingBox);
        }
    }
    
    const thinkingContent = thinkingBox.querySelector('.thinking-content');
    if (thinkingContent) {
        thinkingContent.textContent += content;
        scrollToBottom();
    }
}

// Show nodes
function showNodes(nodes) {
    const thinkingBox = document.getElementById('thinkingBox');
    if (thinkingBox) {
        const nodesHtml = `
            <div class="nodes-box">
                <strong>检索节点:</strong> ${nodes.map(n => `<span class="node-tag" data-node-id="${n}" onclick="showNodePreview('${n}')">${n}</span>`).join(' ')}
            </div>
        `;
        thinkingBox.insertAdjacentHTML('afterend', nodesHtml);
    }
}

// Node info cache
let nodeMapCache = {};
let allPagesCache = {};  // Cache all pages for each document

// Show node preview (page image popup)
async function showNodePreview(nodeId) {
    if (!currentDocId) {
        console.error('No document selected');
        return;
    }
    
    // Fetch node info if not cached
    if (!nodeMapCache[currentDocId] || !allPagesCache[currentDocId]) {
        try {
            const response = await fetch(`/api/documents/${currentDocId}/node-info`);
            const data = await response.json();
            if (data.node_map) {
                nodeMapCache[currentDocId] = data.node_map;
                allPagesCache[currentDocId] = data.all_pages || [];
            } else {
                console.error('Failed to load node info:', data.error);
                return;
            }
        } catch (error) {
            console.error('Error fetching node info:', error);
            return;
        }
    }
    
    const nodeMap = nodeMapCache[currentDocId];
    const allPages = allPagesCache[currentDocId];
    const nodeInfo = nodeMap[nodeId];
    
    if (!nodeInfo) {
        console.warn('Node not found:', nodeId);
        showNotification('未找到节点信息');
        return;
    }
    
    // Show preview modal with all pages and scroll to start_index
    showPagePreviewModal(nodeId, nodeInfo, allPages);
}

// Show page preview modal
function showPagePreviewModal(nodeId, nodeInfo, allPages) {
    // Create modal if not exists
    let modal = document.getElementById('pagePreviewModal');
    if (!modal) {
        modal = document.createElement('div');
        modal.id = 'pagePreviewModal';
        modal.className = 'page-preview-modal';
        modal.innerHTML = `
            <div class="page-preview-overlay" onclick="closePagePreviewModal()"></div>
            <div class="page-preview-content">
                <div class="page-preview-header">
                    <h5 class="page-preview-title"></h5>
                    <button class="page-preview-close" onclick="closePagePreviewModal()">
                        <i class="bi bi-x-lg"></i>
                    </button>
                </div>
                <div class="page-preview-body">
                    <div class="page-preview-images"></div>
                </div>
                <div class="page-preview-footer">
                    <div class="page-preview-nav">
                        <button class="page-nav-btn" id="prevPageBtn" onclick="navigatePreviewPage(-1)">
                            <i class="bi bi-chevron-left"></i> 上一页
                        </button>
                        <span class="page-indicator" id="pageIndicator"></span>
                        <button class="page-nav-btn" id="nextPageBtn" onclick="navigatePreviewPage(1)">
                            下一页 <i class="bi bi-chevron-right"></i>
                        </button>
                    </div>
                </div>
            </div>
        `;
        document.body.appendChild(modal);
    }
    
    // Update modal content
    const titleEl = modal.querySelector('.page-preview-title');
    const imagesEl = modal.querySelector('.page-preview-images');
    
    titleEl.textContent = `节点: ${nodeId}${nodeInfo.title ? ' - ' + nodeInfo.title : ''}`;
    
    // Build images - use all pages
    if (!allPages || allPages.length === 0) {
        imagesEl.innerHTML = '<div class="no-pages">无页面图片</div>';
    } else {
        imagesEl.innerHTML = allPages.map((p, idx) => `
            <div class="page-image-container" data-page="${p.page}" data-index="${idx}">
                <img src="${p.url}" alt="Page ${p.page}" class="page-preview-image" onclick="openFullscreenImage('${p.url}')">
                <div class="page-number">第 ${p.page} 页</div>
            </div>
        `).join('');
    }
    
    // Store current pages for navigation
    modal.dataset.pages = JSON.stringify(allPages);
    
    // Calculate initial index based on start_index (1-based to 0-based)
    const startIndex = nodeInfo.start_index || 1;
    const initialIndex = Math.max(0, Math.min(startIndex - 1, allPages.length - 1));
    modal.dataset.currentIndex = initialIndex;
    
    // Update navigation
    updatePreviewNavigation();
    
    // Show modal
    modal.classList.add('active');
    document.body.style.overflow = 'hidden';
    // Add preview-open class to main content for layout adjustment
    document.querySelector('.main-content')?.classList.add('preview-open');
    
    // Scroll to the target page after modal is visible
    setTimeout(() => {
        const containers = modal.querySelectorAll('.page-image-container');
        if (containers[initialIndex]) {
            containers[initialIndex].scrollIntoView({ behavior: 'smooth', block: 'center' });
        }
    }, 100);
}

// Close page preview modal
function closePagePreviewModal() {
    const modal = document.getElementById('pagePreviewModal');
    if (modal) {
        modal.classList.remove('active');
        document.body.style.overflow = '';
        // Remove preview-open class from main content
        document.querySelector('.main-content')?.classList.remove('preview-open');
    }
}

// Navigate preview pages
function navigatePreviewPage(direction) {
    const modal = document.getElementById('pagePreviewModal');
    if (!modal) return;
    
    const pages = JSON.parse(modal.dataset.pages || '[]');
    let currentIndex = parseInt(modal.dataset.currentIndex) || 0;
    
    currentIndex += direction;
    if (currentIndex < 0) currentIndex = 0;
    if (currentIndex >= pages.length) currentIndex = pages.length - 1;
    
    modal.dataset.currentIndex = currentIndex;
    
    // Scroll to page
    const containers = modal.querySelectorAll('.page-image-container');
    if (containers[currentIndex]) {
        containers[currentIndex].scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
    
    updatePreviewNavigation();
}

// Update preview navigation state
function updatePreviewNavigation() {
    const modal = document.getElementById('pagePreviewModal');
    if (!modal) return;
    
    const pages = JSON.parse(modal.dataset.pages || '[]');
    const currentIndex = parseInt(modal.dataset.currentIndex) || 0;
    const indicator = document.getElementById('pageIndicator');
    const prevBtn = document.getElementById('prevPageBtn');
    const nextBtn = document.getElementById('nextPageBtn');
    
    if (pages.length > 0) {
        indicator.textContent = `${currentIndex + 1} / ${pages.length}`;
        prevBtn.disabled = currentIndex === 0;
        nextBtn.disabled = currentIndex === pages.length - 1;
    } else {
        indicator.textContent = '0 / 0';
        prevBtn.disabled = true;
        nextBtn.disabled = true;
    }
}

// Open image in fullscreen
function openFullscreenImage(url) {
    const overlay = document.createElement('div');
    overlay.className = 'fullscreen-image-overlay';
    overlay.onclick = () => overlay.remove();
    overlay.innerHTML = `
        <img src="${url}" class="fullscreen-image">
        <button class="fullscreen-close" onclick="this.parentElement.remove()">
            <i class="bi bi-x-lg"></i>
        </button>
    `;
    document.body.appendChild(overlay);
}

// Append to response (streaming)
function appendToResponse(content) {
    // Check if response content element already exists
    let responseContent = document.getElementById('responseContent');

    if (!responseContent) {
        // Remove typing indicator
        const typingIndicator = document.getElementById('typingIndicator');
        if (typingIndicator) {
            typingIndicator.remove();
        }

        // Create response box with id for future reference
        const messagesContainer = document.getElementById('chatMessages');
        const responseBox = document.createElement('div');
        responseBox.className = 'message message-assistant';
        responseBox.id = 'responseBox';
        responseBox.innerHTML = `
            <div class="message-content" id="responseContent"></div>
        `;
        messagesContainer.appendChild(responseBox);
        
        responseContent = document.getElementById('responseContent');
    }

    if (responseContent) {
        responseContent.textContent += content;
        scrollToBottom();
    }
}

// Set response (non-streaming)
function setResponse(content) {
    const typingIndicator = document.getElementById('typingIndicator');
    if (typingIndicator) {
        typingIndicator.remove();
    }

    const messagesContainer = document.getElementById('chatMessages');
    const responseBox = document.createElement('div');
    responseBox.className = 'message message-assistant';
    responseBox.innerHTML = `<div class="message-content">${escapeHtml(content)}</div>`;
    messagesContainer.appendChild(responseBox);

    scrollToBottom();
}

// Finish response
function finishResponse() {
    isStreaming = false;
    updateSendButton();

    // Remove typing indicator only (keep thinking box)
    const typingIndicator = document.getElementById('typingIndicator');
    if (typingIndicator) {
        typingIndicator.remove();
    }
    
    // Remove the id from responseBox so next message creates a new one
    const responseBox = document.getElementById('responseBox');
    if (responseBox) {
        responseBox.removeAttribute('id');
    }
    const responseContent = document.getElementById('responseContent');
    if (responseContent) {
        responseContent.removeAttribute('id');
    }
    
    // Remove the id from thinkingBox so next message creates a new one
    const thinkingBox = document.getElementById('thinkingBox');
    if (thinkingBox) {
        thinkingBox.removeAttribute('id');
    }
}

// Show error
function showError(message) {
    isStreaming = false;
    updateSendButton();

    const typingIndicator = document.getElementById('typingIndicator');
    if (typingIndicator) {
        typingIndicator.remove();
    }

    addSystemMessage('错误: ' + message);
}

// Add user message
function addUserMessage(content) {
    hideEmptyState();

    const messagesContainer = document.getElementById('chatMessages');
    const messageDiv = document.createElement('div');
    messageDiv.className = 'message message-user';
    messageDiv.innerHTML = `<div class="message-content">${escapeHtml(content)}</div>`;
    messagesContainer.appendChild(messageDiv);

    scrollToBottom();
}

// Add system message
function addSystemMessage(content) {
    const messagesContainer = document.getElementById('chatMessages');
    const messageDiv = document.createElement('div');
    messageDiv.className = 'message message-assistant';
    messageDiv.innerHTML = `
        <div class="message-content" style="background: #fef3c7; color: #92400e;">
            <i class="bi bi-info-circle"></i> ${content}
        </div>
    `;
    messagesContainer.appendChild(messageDiv);

    scrollToBottom();
}

// Show typing indicator
function showTypingIndicator() {
    const messagesContainer = document.getElementById('chatMessages');
    const indicator = document.createElement('div');
    indicator.className = 'typing-indicator';
    indicator.id = 'typingIndicator';
    indicator.innerHTML = `
        <span class="typing-dot"></span>
        <span class="typing-dot"></span>
        <span class="typing-dot"></span>
        <span class="status-text" style="margin-left: 10px; font-size: 14px; color: #64748b;"></span>
    `;
    messagesContainer.appendChild(indicator);
    scrollToBottom();
}

// Update send button state
function updateSendButton() {
    const btn = document.getElementById('sendBtn');
    btn.disabled = isStreaming;
}

// Display chat history
function displayHistory(history) {
    if (!history || history.length === 0) return;

    hideEmptyState();

    const messagesContainer = document.getElementById('chatMessages');
    messagesContainer.innerHTML = '';

    history.forEach(msg => {
        // Add thinking box if present (before assistant message)
        if (msg.thinking) {
            const thinkingBox = document.createElement('div');
            thinkingBox.className = 'thinking-box';
            thinkingBox.innerHTML = `<strong>推理过程</strong><span class="thinking-content">${escapeHtml(msg.thinking)}</span>`;
            messagesContainer.appendChild(thinkingBox);
        }
        
        // Add nodes box if present (before assistant message)
        if (msg.nodes && msg.nodes.length > 0) {
            const nodesBox = document.createElement('div');
            nodesBox.className = 'nodes-box';
            nodesBox.innerHTML = `<strong>检索节点:</strong> ${msg.nodes.map(n => `<span class="node-tag" data-node-id="${n}" onclick="showNodePreview('${n}')">${n}</span>`).join(' ')}`;
            messagesContainer.appendChild(nodesBox);
        }
        
        // Add message
        const messageDiv = document.createElement('div');
        messageDiv.className = `message message-${msg.role}`;
        messageDiv.innerHTML = `<div class="message-content">${escapeHtml(msg.content)}</div>`;
        messagesContainer.appendChild(messageDiv);
    });

    scrollToBottom();
}

// Clear chat display
function clearChatDisplay() {
    const messagesContainer = document.getElementById('chatMessages');
    messagesContainer.innerHTML = `
        <div class="empty-state" id="emptyState">
            <i class="bi bi-chat-dots"></i>
            <h5>开始对话</h5>
            <p>输入问题开始与文档对话</p>
        </div>
    `;
}

// Hide empty state
function hideEmptyState() {
    const emptyState = document.getElementById('emptyState');
    if (emptyState) {
        emptyState.remove();
    }
}

// Open settings modal
function openSettingsModal() {
    const modalEl = document.getElementById('settingsModal');
    if (modalEl) {
        const modal = new bootstrap.Modal(modalEl);
        modal.show();
    } else {
        console.error('Settings modal not found');
    }
}

// Save settings - make it global
window.saveSettings = async function () {
    const textConfig = {
        name: document.getElementById('textModelName').value,
        api_key: document.getElementById('textApiKey').value,
        base_url: document.getElementById('textBaseUrl').value,
        type: 'text'
    };

    const visionConfig = {
        name: document.getElementById('visionModelName').value,
        api_key: document.getElementById('visionApiKey').value,
        base_url: document.getElementById('visionBaseUrl').value,
        type: 'vision'
    };

    try {
        await fetch('/api/config/models/text', {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(textConfig)
        });

        await fetch('/api/config/models/vision', {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(visionConfig)
        });

        const modalEl = document.getElementById('settingsModal');
        const modal = bootstrap.Modal.getInstance(modalEl);
        if (modal) {
            modal.hide();
        }
        showNotification('配置已保存');
    } catch (error) {
        console.error('Error saving config:', error);
        alert('保存配置失败');
    }
};

// Setup drag and drop
function setupDragDrop() {
    const uploadArea = document.getElementById('uploadArea');

    if (!uploadArea) {
        console.error('Upload area not found for drag drop setup');
        return;
    }

    ['dragenter', 'dragover', 'dragleave', 'drop'].forEach(eventName => {
        uploadArea.addEventListener(eventName, preventDefaults, false);
    });

    function preventDefaults(e) {
        e.preventDefault();
        e.stopPropagation();
    }

    ['dragenter', 'dragover'].forEach(eventName => {
        uploadArea.addEventListener(eventName, () => {
            uploadArea.style.borderColor = 'white';
            uploadArea.style.background = 'rgba(255,255,255,0.1)';
        });
    });

    ['dragleave', 'drop'].forEach(eventName => {
        uploadArea.addEventListener(eventName, () => {
            uploadArea.style.borderColor = 'rgba(255,255,255,0.3)';
            uploadArea.style.background = 'transparent';
        });
    });

    uploadArea.addEventListener('drop', (e) => {
        const file = e.dataTransfer.files[0];
        uploadDocument(file);
    });

    console.log('Drag drop setup complete');
}

// Scroll to bottom
function scrollToBottom() {
    const container = document.getElementById('chatContainer');
    container.scrollTop = container.scrollHeight;
}

// Escape HTML
function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

// Show notification
function showNotification(message) {
    const notification = document.createElement('div');
    notification.style.cssText = `
        position: fixed;
        top: 20px;
        right: 20px;
        background: #22c55e;
        color: white;
        padding: 12px 24px;
        border-radius: 10px;
        box-shadow: 0 4px 15px rgba(0,0,0,0.2);
        z-index: 9999;
        animation: slideIn 0.3s ease;
    `;
    notification.textContent = message;
    document.body.appendChild(notification);

    setTimeout(() => {
        notification.style.animation = 'slideOut 0.3s ease';
        setTimeout(() => notification.remove(), 300);
    }, 2000);
}

// Add animations
const style = document.createElement('style');
style.textContent = `
    @keyframes slideIn {
        from { transform: translateX(100%); opacity: 0; }
        to { transform: translateX(0); opacity: 1; }
    }
    @keyframes slideOut {
        from { transform: translateX(0); opacity: 1; }
        to { transform: translateX(100%); opacity: 0; }
    }
`;
document.head.appendChild(style);
