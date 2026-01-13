// ==========================================
// 1. 全局变量与配置
// ==========================================
let isEnabled = true;
let activeInput = null;
let triggerBtn = null;
let panel = null;
let tooltip = null;

// 定时器
let closeTimer = null;
let showTimer = null;

// 鼠标位置
let lastMouseX = 0;
let lastMouseY = 0;

// 缓存与快照
let config = { limit: 20, timeout: 120000 };
const historyCache = new WeakMap();
const dirtyInputs = new Set();
const inputSnapshot = new WeakMap();

const DEBOUNCE_DELAY = 800;

// ==========================================
// 2. 基础工具函数 (提前定义，防止报错)
// ==========================================

// 安全读取 Storage (防止 Context Invalidated 崩溃)
function safeStorageGet(keys, callback) {
    // 检查扩展上下文是否有效
    if (!chrome.runtime?.id) {
        console.warn("[InputSaver] 扩展上下文已失效，请刷新页面。");
        return;
    }
    try {
        chrome.storage.local.get(keys, callback);
    } catch (e) {
        console.warn("[InputSaver] Storage读取失败:", e);
    }
}

// 安全写入 Storage
function safeStorageSet(data, callback) {
    if (!chrome.runtime?.id) return;
    try {
        chrome.storage.local.set(data, callback);
    } catch (e) {
        console.warn("[InputSaver] Storage写入失败:", e);
    }
}

// HTML 转义 (防 XSS)
function escapeHtml(text) {
    if (typeof text !== 'string') return "";
    return text.replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
}

// 关闭所有 UI
function removeUI() {
    if (triggerBtn) triggerBtn.style.display = 'none';
    if (panel) panel.style.display = 'none';
    hideTooltip();
    stopGlobalTracker();
}

// 隐藏悬浮窗
function hideTooltip() {
    if (tooltip) tooltip.style.display = 'none';
}

// 获取元素选择器
function getSelector(el) {
    if (el.name) return `[name="${el.name}"]`;
    if (el.id) return `#${el.id}`;
    let path = [];
    while (el.nodeType === Node.ELEMENT_NODE && el.tagName !== 'HTML') {
        let index = 1;
        let sibling = el.previousElementSibling;
        while (sibling) {
            if (sibling.tagName === el.tagName) index++;
            sibling = sibling.previousElementSibling;
        }
        path.unshift(`${el.tagName}:nth-of-type(${index})`);
        el = el.parentNode;
    }
    return path.join(' > ');
}

function getStorageKey(target) {
    const domain = window.location.hostname;
    const selector = getSelector(target);
    return `hist_${domain}::${selector}`;
}

function debounce(func, wait) {
    let timeout;
    return function (...args) {
        clearTimeout(timeout);
        timeout = setTimeout(() => func.apply(this, args), wait);
    };
}

// 演变检测算法 (增加空值保护)
function isEvolution(oldStr, newStr) {
    // 强制转为字符串，防止 undefined 报错
    oldStr = oldStr || "";
    newStr = newStr || "";

    const lenOld = oldStr.length;
    const lenNew = newStr.length;
    const maxLen = Math.max(lenOld, lenNew);
    const diff = Math.abs(lenOld - lenNew);

    if (maxLen === 0) return false; // 都是空，无所谓
    if (diff > maxLen * 0.5) return false;

    if (oldStr.includes(newStr)) {
        // 删除保护
        if (diff < 10 || (diff / lenOld) < 0.15) return true;
        return false;
    }
    if (newStr.includes(oldStr)) return true;

    const checkLimit = 500;
    const limit = Math.min(lenOld, lenNew, checkLimit);
    let commonPrefixLen = 0;

    // 这里的循环现在安全了，因为 oldStr/newStr 必定是字符串
    for (let i = 0; i < limit; i++) {
        if (oldStr[i] === newStr[i]) commonPrefixLen++;
        else break;
    }
    if (commonPrefixLen >= checkLimit || (commonPrefixLen / maxLen) > 0.6) return true;

    return false;
}

// ==========================================
// 3. 核心逻辑 (内存缓存与保存)
// ==========================================

// 初始化配置
function loadConfig() {
    safeStorageGet(['extensionEnabled', 'maxHistoryLimit', 'sessionTimeout'], (res) => {
        if (!res) return;
        isEnabled = res.extensionEnabled !== false;

        let limit = parseInt(res.maxHistoryLimit);
        if (isNaN(limit) || limit < 3) limit = 20;
        if (limit > 100) limit = 100;
        config.limit = limit;

        let timeout = parseInt(res.sessionTimeout);
        if (isNaN(timeout) || timeout < 10000) timeout = 120000;
        config.timeout = timeout;
    });
}
loadConfig();

// 监听消息
chrome.runtime.onMessage.addListener((msg) => {
    if (msg.action === "toggleState") {
        isEnabled = msg.state;
        removeUI();
    }
});

// 加载历史到内存
function loadHistoryToMemory(target, callback) {
    const key = getStorageKey(target);
    safeStorageGet([key], (res) => {
        const history = (res && res[key]) ? res[key] : [];
        historyCache.set(target, { key: key, data: history });
        if (callback) callback(history);
    });
}

// 处理输入 (同步更新内存)
function processInputSync(target, isForceNew = false, contentOverride = null) {
    if (!isEnabled) return;
    if (target.type === 'password') return;

    let content = contentOverride;
    if (content === null) {
        content = target.value;
        if (target.isContentEditable) content = target.innerText;
    }
    // 确保 content 是字符串
    content = content || "";
    if (content.trim() === '') return;

    let cacheEntry = historyCache.get(target);
    if (!cacheEntry) {
        cacheEntry = { key: getStorageKey(target), data: [] };
        historyCache.set(target, cacheEntry);
    }

    const history = cacheEntry.data;
    const now = Date.now();
    const latest = history[0];

    let shouldCreateNew = true;

    if (latest) {
        if (latest.content === content) {
            latest.timestamp = now;
            shouldCreateNew = false;
        } else if (!isForceNew) {
            const timeDiff = now - latest.timestamp;
            if (timeDiff < config.timeout) {
                if (isEvolution(latest.content, content)) {
                    latest.content = content;
                    latest.timestamp = now;
                    shouldCreateNew = false;
                }
            }
        }
    }

    if (shouldCreateNew) {
        history.unshift({
            content: content,
            timestamp: now,
            url: window.location.href
        });
    }

    if (history.length > config.limit) history.pop();
    dirtyInputs.add(target);
}

// 刷盘 (硬盘写入)
function flushDirtyData() {
    if (dirtyInputs.size === 0) return;

    const dataToSave = {};
    const processedTargets = [];

    dirtyInputs.forEach(target => {
        const cacheEntry = historyCache.get(target);
        if (cacheEntry) {
            dataToSave[cacheEntry.key] = cacheEntry.data;
            processedTargets.push(target);
        }
    });

    safeStorageSet(dataToSave, () => {
        processedTargets.forEach(t => dirtyInputs.delete(t));
    });
}

const debouncedFlush = debounce(flushDirtyData, DEBOUNCE_DELAY);

// ==========================================
// 4. 全局雷达与UI判定 (解决自动关闭问题)
// ==========================================

function startGlobalTracker() {
    document.removeEventListener('mousemove', globalMouseHandler);
    document.addEventListener('mousemove', globalMouseHandler);
}

function stopGlobalTracker() {
    document.removeEventListener('mousemove', globalMouseHandler);
}

function isPointInRect(x, y, element, buffer = 0) {
    if (!element || element.style.display === 'none') return false;
    const rect = element.getBoundingClientRect();
    return (
        x >= rect.left - buffer &&
        x <= rect.right + buffer &&
        y >= rect.top - buffer &&
        y <= rect.bottom + buffer
    );
}

function globalMouseHandler(e) {
    const x = e.clientX;
    const y = e.clientY;
    const inPanel = isPointInRect(x, y, panel, 40);
    const inTooltip = isPointInRect(x, y, tooltip, 40);
    const inBtn = isPointInRect(x, y, triggerBtn, 40);

    if (inPanel || inTooltip || inBtn) {
        if (closeTimer) { clearTimeout(closeTimer); closeTimer = null; }
    } else {
        if (!closeTimer) {
            closeTimer = setTimeout(() => {
                hideTooltip();
                // 仅关闭 tooltip, 保留 panel
            }, 300);
        }
    }
}

// 滚动锁
function addScrollLock(element) {
    element.addEventListener('wheel', (e) => {
        e.stopPropagation();
        const el = element;
        const delta = e.deltaY;
        // 如果内容不需要滚动，禁止事件穿透
        if (el.scrollHeight <= el.clientHeight) {
            e.preventDefault();
            return;
        }
        const isAtTop = el.scrollTop === 0;
        const isAtBottom = Math.abs(el.scrollHeight - el.clientHeight - el.scrollTop) < 1;

        if ((delta < 0 && isAtTop) || (delta > 0 && isAtBottom)) {
            e.preventDefault();
        }
    }, { passive: false });
}

// ==========================================
// 5. 核心事件监听
// ==========================================

// Focus: 初始化内存
document.addEventListener('focus', (e) => {
    const t = e.target;
    if (t.matches('input, textarea') || t.isContentEditable) {
        loadHistoryToMemory(t, () => {
            let val = t.value;
            if (t.isContentEditable) val = t.innerText;
            val = val || ""; // 确保非null

            if (val) inputSnapshot.set(t, val);

            processInputSync(t, true);
            debouncedFlush();
        });
    }
}, true);

// Input: 处理输入
document.addEventListener('input', (e) => {
    const t = e.target;
    if (!(t.matches('input, textarea') || t.isContentEditable)) return;

    let currentVal = t.value;
    if (t.isContentEditable) currentVal = t.innerText;
    currentVal = currentVal || "";

    const lastVal = inputSnapshot.get(t) || "";
    const lengthDiff = lastVal.length - currentVal.length;

    // 紧急抢救
    if (currentVal.trim() === '' && lastVal.trim() !== '') {
        if (lengthDiff > 1 && lastVal.length > 2) {
            processInputSync(t, true, lastVal);
            flushDirtyData();
        }
    }

    if (currentVal.trim() !== '') {
        inputSnapshot.set(t, currentVal);
        processInputSync(t, false);
        debouncedFlush();
    }
}, true);

// Blur: 立即保存
document.addEventListener('blur', (e) => {
    const t = e.target;
    if (t.matches('input, textarea') || t.isContentEditable) {
        processInputSync(t, false);
        flushDirtyData();
    }
}, true);

// Unload: 页面关闭前最后一次保存
window.addEventListener('beforeunload', () => {
    if (dirtyInputs.size === 0) return;
    const dataToSave = {};
    dirtyInputs.forEach(target => {
        const cacheEntry = historyCache.get(target);
        if (cacheEntry) dataToSave[cacheEntry.key] = cacheEntry.data;
    });
    // 直接调用底层 API，不使用 safeStorageSet 以确保同步性尝试
    if (chrome.runtime?.id) {
        chrome.storage.local.set(dataToSave);
    }
});

// UI 触发
document.addEventListener('dblclick', (e) => {
    if (!isEnabled) return;
    const t = e.target;
    if ((t.matches('input:not([type="password"]), textarea') || t.isContentEditable)) {
        activeInput = t;
        // 确保内存就绪
        if (!historyCache.has(t)) {
            loadHistoryToMemory(t, () => showTriggerButton(t));
        } else {
            showTriggerButton(t);
        }
    }
});

// 点击外部关闭
document.addEventListener('mousedown', (e) => {
    // 检查面板、Tooltip、按钮是否被点击
    const clickedPanel = panel && panel.contains(e.target);
    const clickedTooltip = tooltip && tooltip.contains(e.target);
    const clickedBtn = triggerBtn && triggerBtn.contains(e.target);
    const clickedInput = e.target === activeInput;

    if (clickedPanel || clickedTooltip || clickedBtn || clickedInput) {
        return;
    }
    removeUI();
});

// 鼠标移动记录
document.addEventListener('mousemove', (e) => {
    lastMouseX = e.clientX;
    lastMouseY = e.clientY;
}, { passive: true });

// 滚动关闭判定
document.addEventListener('scroll', (e) => {
    if (panel && panel.style.display !== 'none') {
        const isInternalScroll = (panel.contains(e.target) || (tooltip && tooltip.contains(e.target)));
        if (isInternalScroll) {
            globalMouseHandler({ clientX: lastMouseX, clientY: lastMouseY });
        } else {
            const hoveringPanel = isPointInRect(lastMouseX, lastMouseY, panel, 0);
            const hoveringTooltip = isPointInRect(lastMouseX, lastMouseY, tooltip, 0);
            if (hoveringPanel || hoveringTooltip) return;
            removeUI();
        }
    }
}, true);


// ==========================================
// 6. UI 构建与渲染逻辑
// ==========================================

function showTriggerButton(target) {
    if (!triggerBtn) {
        triggerBtn = document.createElement('div');
        triggerBtn.id = 'is-trigger-btn';
        triggerBtn.innerHTML = '◷';
        triggerBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            showPanel();
            triggerBtn.style.display = 'none';
        });
        document.body.appendChild(triggerBtn);
    }

    const rect = target.getBoundingClientRect();
    triggerBtn.style.display = 'block';
    triggerBtn.style.top = (rect.top + window.pageYOffset - 12) + 'px';
    triggerBtn.style.left = (rect.right + window.pageXOffset - 12) + 'px';

    startGlobalTracker();
}

function showPanel() {
    if (!panel) {
        panel = document.createElement('div');
        panel.id = 'is-history-panel';
        panel.innerHTML = `
            <div class="is-header" title="按住此处拖动窗口">
                历史记录 
                <span class="is-clear" title="清空">清空此框</span>
            </div>
            <ul class="is-list"></ul>
        `;
        document.body.appendChild(panel);

        panel.addEventListener('mousedown', e => e.stopPropagation());
        const listEl = panel.querySelector('.is-list');
        addScrollLock(listEl);
        const header = panel.querySelector('.is-header');
        setupDraggable(panel, header);

        tooltip = document.createElement('div');
        tooltip.id = 'is-global-tooltip';
        document.body.appendChild(tooltip);
        addScrollLock(tooltip);

        tooltip.addEventListener('scroll', () => {
            if (closeTimer) { clearTimeout(closeTimer); closeTimer = null; }
        });
        tooltip.addEventListener('mousedown', e => e.stopPropagation());

        panel.querySelector('.is-clear').addEventListener('click', (e) => {
            e.stopPropagation();
            if (!activeInput) return;
            if (confirm('确定清空当前输入框的所有记录？')) {
                const key = getStorageKey(activeInput);
                safeStorageSet({ [key]: [] }, () => { // 清空 Storage
                    historyCache.set(activeInput, { key: key, data: [] }); // 清空内存
                    renderList([]);
                });
            }
        });
    }

    const cacheEntry = historyCache.get(activeInput);
    const history = cacheEntry ? cacheEntry.data : [];
    renderList(history);
    adjustPosition(activeInput);

    startGlobalTracker();
}

function setupDraggable(element, handle) {
    let isDragging = false;
    let startX, startY, initialLeft, initialTop;
    handle.addEventListener('mousedown', (e) => {
        if (e.target.classList.contains('is-clear')) return;
        isDragging = true;
        startX = e.clientX;
        startY = e.clientY;
        const rect = element.getBoundingClientRect();
        initialLeft = rect.left;
        initialTop = rect.top;
        handle.style.cursor = 'grabbing';
        e.preventDefault();
        hideTooltip();
    });
    document.addEventListener('mousemove', (e) => {
        if (!isDragging) return;
        const dx = e.clientX - startX;
        const dy = e.clientY - startY;
        element.style.left = `${initialLeft + dx}px`;
        element.style.top = `${initialTop + dy}px`;
    });
    document.addEventListener('mouseup', () => {
        if (isDragging) {
            isDragging = false;
            handle.style.cursor = 'move';
        }
    });
}

function adjustPosition(target) {
    const rect = target.getBoundingClientRect();
    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;
    const gap = 5;

    panel.style.maxHeight = '';
    panel.style.visibility = 'hidden';
    panel.style.display = 'flex';

    const naturalHeight = panel.offsetHeight;
    const panelWidth = panel.offsetWidth;

    const spaceBelow = viewportHeight - rect.bottom - gap;
    const spaceAbove = rect.top - gap;

    let top = 0;
    let setMaxHeight = null;

    if (spaceBelow >= naturalHeight) {
        top = rect.bottom + gap;
    }
    else if (spaceAbove >= naturalHeight) {
        top = rect.top - naturalHeight - gap;
    }
    else {
        if (spaceBelow >= spaceAbove) {
            top = rect.bottom + gap;
            setMaxHeight = spaceBelow - 10;
        } else {
            setMaxHeight = spaceAbove - 10;
            top = rect.top - setMaxHeight - gap;
        }
    }

    let left = rect.left;
    if (left + panelWidth > viewportWidth) {
        left = viewportWidth - panelWidth - 10;
    }
    if (left < 10) left = 10;

    if (setMaxHeight !== null) {
        panel.style.maxHeight = `${setMaxHeight}px`;
    } else {
        panel.style.maxHeight = '';
    }

    panel.style.top = `${top}px`;
    panel.style.left = `${left}px`;
    panel.style.visibility = 'visible';
}

function renderList(history) {
    const list = panel.querySelector('.is-list');
    list.innerHTML = '';

    if (history.length === 0) {
        list.innerHTML = '<li style="padding:10px;color:#999;text-align:center">暂无记录</li>';
        return;
    }

    history.forEach((item, index) => {
        const li = document.createElement('li');
        li.className = 'is-item';

        li.innerHTML = `
            <div class="is-item-body">
                <div class="is-text-preview">${escapeHtml(item.content)}</div>
                <div class="is-time">${new Date(item.timestamp).toLocaleString()}</div>
            </div>
            <div class="is-action-btn is-delete-btn" title="删除此条">×</div>
            <div class="is-action-btn is-copy-btn" title="复制内容">❐</div>
        `;

        li.addEventListener('mouseenter', () => {
            if (closeTimer) { clearTimeout(closeTimer); closeTimer = null; }
            if (showTimer) clearTimeout(showTimer);
            showTimer = setTimeout(() => {
                showTooltip(item.content, li);
            }, 60);
        });

        li.addEventListener('click', (e) => {
            if (e.target.classList.contains('is-action-btn')) return;
            if (activeInput.isContentEditable) {
                activeInput.innerText = item.content;
            } else {
                activeInput.value = item.content;
            }
            activeInput.dispatchEvent(new Event('input', { bubbles: true }));
            removeUI();
        });

        const delBtn = li.querySelector('.is-delete-btn');
        delBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            deleteSingleItem(index);
        });

        const copyBtn = li.querySelector('.is-copy-btn');
        copyBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            navigator.clipboard.writeText(item.content).then(() => {
                const originalText = copyBtn.innerText;
                copyBtn.innerText = '✓';
                copyBtn.style.color = '#4caf50';
                setTimeout(() => {
                    copyBtn.innerText = originalText;
                    copyBtn.style.color = '';
                }, 1000);
            });
        });

        list.appendChild(li);
    });
}

function showTooltip(content, targetEl) {
    if (!tooltip) return;
    tooltip.innerText = content;
    tooltip.style.display = 'block';
    tooltip.style.maxWidth = '';
    tooltip.style.maxHeight = '';
    tooltip.style.top = '-9999px';
    tooltip.style.left = '-9999px';

    const rect = targetEl.getBoundingClientRect();
    const panelRect = panel.getBoundingClientRect();
    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;
    const gap = 2;

    const spaceRight = viewportWidth - panelRect.right - gap;
    const spaceLeft = panelRect.left - gap;
    const minDesiredWidth = 300;

    let left = 0;
    let limitWidth = 0;

    if (spaceRight >= minDesiredWidth || spaceRight >= spaceLeft) {
        left = panelRect.right + gap;
        limitWidth = viewportWidth - left - 10;
    } else {
        limitWidth = spaceLeft - 10;
    }

    const finalMaxWidth = Math.min(Math.max(limitWidth, 300), 600);
    tooltip.style.maxWidth = `${finalMaxWidth}px`;

    if (spaceRight < minDesiredWidth && spaceRight < spaceLeft) {
        left = panelRect.left - tooltip.offsetWidth - gap;
    }
    if (left < 5) left = 5;

    const tooltipHeight = tooltip.offsetHeight;
    let top = rect.top;

    if (top + tooltipHeight > viewportHeight - 10) {
        top = viewportHeight - tooltipHeight - 10;
    }
    if (top < 10) {
        top = 10;
        const availableHeight = viewportHeight - 20;
        tooltip.style.maxHeight = `${availableHeight}px`;
    }

    tooltip.style.left = left + 'px';
    tooltip.style.top = top + 'px';
}

function deleteSingleItem(index) {
    let cacheEntry = historyCache.get(activeInput);
    if (cacheEntry) {
        cacheEntry.data.splice(index, 1);
        renderList(cacheEntry.data);
        hideTooltip();
        dirtyInputs.add(activeInput);
        debouncedFlush();
    }
}