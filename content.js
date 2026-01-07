let isEnabled = true;
let activeInput = null;
let triggerBtn = null;
let panel = null;
let tooltip = null;

// 定时器
let closeTimer = null;
let showTimer = null;

// 记录鼠标最后位置
let lastMouseX = 0;
let lastMouseY = 0;

// === 配置常量 ===
const SESSION_TIMEOUT = 2 * 60 * 1000; // 2分钟：判断是否为同一次编辑会话
const DEBOUNCE_DELAY = 800; // 打字时的防抖延迟

chrome.storage.local.get(['extensionEnabled'], (res) => {
    isEnabled = res.extensionEnabled !== false;
});

chrome.runtime.onMessage.addListener((msg) => {
    if (msg.action === "toggleState") {
        isEnabled = msg.state;
        removeUI();
    }
});

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

// 防抖函数
function debounce(func, wait) {
    let timeout;
    return function (...args) {
        clearTimeout(timeout);
        timeout = setTimeout(() => func.apply(this, args), wait);
    };
}

// === 核心逻辑：智能保存 ===
// isForceNew: 是否强制创建新条目（用于 focus 时保存初始状态）
const saveInput = (target, isForceNew = false) => {
    if (!isEnabled) return;
    if (target.type === 'password') return;

    let content = target.value;
    if (target.isContentEditable) {
        content = target.innerText;
    }

    if (!content || content.trim() === '') return;

    const domain = window.location.hostname;
    const selector = getSelector(target);
    const storageKey = `hist_${domain}::${selector}`;

    chrome.storage.local.get([storageKey, 'maxHistoryLimit'], (result) => {
        let history = result[storageKey] || [];

        // 获取限制数量
        let limit = parseInt(result.maxHistoryLimit);
        if (isNaN(limit) || limit < 3) limit = 20;
        if (limit > 100) limit = 100;

        const now = Date.now();
        const latest = history[0]; // 获取最近的一条记录

        // --- 智能保存策略 ---
        let shouldCreateNew = true;

        if (latest) {
            // 1. 如果内容完全一样，只更新时间戳，不新增
            if (latest.content === content) {
                latest.timestamp = now;
                shouldCreateNew = false;
            }
            // 2. 如果不是强制新建，且满足“会话合并”条件
            else if (!isForceNew) {
                const timeDiff = now - latest.timestamp;

                // 条件A: 距离上次修改小于2分钟 (处于连续编辑流中)
                // 条件B: 并不是完全重写 (简单的判断长度变化，或者直接信任时间间隔)
                // 这里我们主要信任时间间隔，认为是同一波思考
                if (timeDiff < SESSION_TIMEOUT) {
                    // ==> 执行合并：覆盖上一条记录
                    latest.content = content;
                    latest.timestamp = now;
                    shouldCreateNew = false;
                }
            }
        }

        if (shouldCreateNew) {
            // 新增一条记录
            history.unshift({
                content: content,
                timestamp: now,
                url: window.location.href
            });
        }

        // 限制数量
        if (history.length > limit) history.pop();

        chrome.storage.local.set({ [storageKey]: history });
    });
};

// 1. 输入事件：防抖保存 (处理打字过程)
const debouncedSave = debounce((e) => {
    const t = e.target;
    if (t.matches('input, textarea') || t.isContentEditable) {
        saveInput(t, false); // false 表示尝试合并会话
    }
}, DEBOUNCE_DELAY);

document.addEventListener('input', debouncedSave, true);

// 2. 聚焦事件：保存初始状态 (解决问题1)
document.addEventListener('focus', (e) => {
    const t = e.target;
    if (t.matches('input, textarea') || t.isContentEditable) {
        // true 表示强制检查是否需要存为新条目（如果是新内容的话）
        // 这样当你点进一个有内容的框，它会被立即存下来作为“恢复点”
        saveInput(t, true);
    }
}, true); // 使用 capture 捕获，确保能监听到

// 3. 失焦事件：立即保存最终状态 (解决问题2的尾巴)
document.addEventListener('blur', (e) => {
    const t = e.target;
    if (t.matches('input, textarea') || t.isContentEditable) {
        // 立即执行，不防抖。
        // 此时一般不需要强制新建，允许合并到刚才的会话中，做最后一次更新
        saveInput(t, false);
    }
}, true);


// --- 以下 UI 逻辑保持不变 ---

document.addEventListener('dblclick', (e) => {
    if (!isEnabled) return;
    const t = e.target;
    if ((t.matches('input:not([type="password"]), textarea') || t.isContentEditable)) {
        activeInput = t;
        showTriggerButton(activeInput);
    }
});

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
                chrome.storage.local.remove(key, () => renderList([]));
            }
        });
    }

    const storageKey = getStorageKey(activeInput);
    chrome.storage.local.get([storageKey], (res) => {
        renderList(res[storageKey] || []);
        adjustPosition(activeInput);
    });

    startGlobalTracker();
}

function addScrollLock(element) {
    element.addEventListener('wheel', (e) => {
        e.stopPropagation();
        const el = element;
        const delta = e.deltaY;
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
        if (closeTimer) {
            clearTimeout(closeTimer);
            closeTimer = null;
        }
    } else {
        if (!closeTimer) {
            closeTimer = setTimeout(() => {
                hideTooltip();
            }, 300);
        }
    }
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

function getStorageKey(input) {
    return `hist_${window.location.hostname}::${getSelector(input)}`;
}

function adjustPosition(target) {
    const rect = target.getBoundingClientRect();
    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;
    panel.style.visibility = 'hidden';
    panel.style.display = 'flex';
    const panelHeight = panel.offsetHeight;
    const panelWidth = panel.offsetWidth;
    let top = rect.bottom + 5;
    let left = rect.left;
    if (rect.bottom + panelHeight + 10 > viewportHeight && rect.top > panelHeight + 10) {
        top = rect.top - panelHeight - 5;
    }
    if (left + panelWidth > viewportWidth) {
        left = viewportWidth - panelWidth - 20;
    }
    if (left < 0) left = 10;
    panel.style.top = top + 'px';
    panel.style.left = left + 'px';
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

    const rect = targetEl.getBoundingClientRect();
    const panelRect = panel.getBoundingClientRect();
    const viewportWidth = window.innerWidth;

    let left = panelRect.right + 2;
    let top = rect.top;

    if (left + 300 > viewportWidth) {
        left = panelRect.left - tooltip.offsetWidth - 2;
    }

    if (left < 5) left = 5;

    const tooltipHeight = tooltip.offsetHeight || 100;
    if (top + tooltipHeight > window.innerHeight) {
        top = window.innerHeight - tooltipHeight - 10;
    }
    if (top < 0) top = 5;

    tooltip.style.left = left + 'px';
    tooltip.style.top = top + 'px';
}

function hideTooltip() {
    if (tooltip) tooltip.style.display = 'none';
}

function deleteSingleItem(index) {
    const key = getStorageKey(activeInput);
    chrome.storage.local.get([key], (res) => {
        let history = res[key] || [];
        history.splice(index, 1);
        chrome.storage.local.set({ [key]: history }, () => {
            renderList(history);
            hideTooltip();
        });
    });
}

function removeUI() {
    if (triggerBtn) triggerBtn.style.display = 'none';
    if (panel) panel.style.display = 'none';
    hideTooltip();
    stopGlobalTracker();
}

function escapeHtml(text) {
    if (!text) return "";
    return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

document.addEventListener('mousedown', (e) => {
    if ((tooltip && tooltip.contains(e.target)) || (panel && panel.contains(e.target))) return;
    if (e.target !== triggerBtn && e.target !== activeInput) {
        removeUI();
    }
});

document.addEventListener('mousemove', (e) => {
    lastMouseX = e.clientX;
    lastMouseY = e.clientY;
}, { passive: true });

document.addEventListener('scroll', (e) => {
    if (panel && panel.style.display !== 'none') {
        const isInternalScroll = (panel.contains(e.target) || (tooltip && tooltip.contains(e.target)));
        if (isInternalScroll) {
            globalMouseHandler({ clientX: lastMouseX, clientY: lastMouseY });
        } else {
            const hoveringPanel = isPointInRect(lastMouseX, lastMouseY, panel, 0);
            const hoveringTooltip = isPointInRect(lastMouseX, lastMouseY, tooltip, 0);
            if (hoveringPanel || hoveringTooltip) {
                return;
            }
            removeUI();
        }
    }
}, true);