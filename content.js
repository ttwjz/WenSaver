let isEnabled = true;
let activeInput = null;
let triggerBtn = null;
let panel = null;
let tooltip = null;

// 定时器
let closeTimer = null;
let showTimer = null;
let lastMouseX = 0;
let lastMouseY = 0;

// === 新增：快照存储 (用于记录输入框“变空前”的值) ===
// 使用 WeakMap，这样当 DOM 元素被移除时，内存会自动回收
const inputSnapshot = new WeakMap();

const DEBOUNCE_DELAY = 500;

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

function debounce(func, wait) {
    let timeout;
    return function (...args) {
        clearTimeout(timeout);
        timeout = setTimeout(() => func.apply(this, args), wait);
    };
}

// === 核心逻辑：智能保存 ===
// 参数 contentOverride: 如果传递了字符串，则直接保存该字符串，不读取 target.value
const saveInput = (target, isForceNew = false, contentOverride = null) => {
    if (!isEnabled) return;
    if (target.type === 'password') return;

    // 1. 确定要保存的内容
    let content = contentOverride;
    if (content === null) {
        content = target.value;
        if (target.isContentEditable) {
            content = target.innerText;
        }
    }

    if (!content || content.trim() === '') return;

    const domain = window.location.hostname;
    const selector = getSelector(target);
    const storageKey = `hist_${domain}::${selector}`;

    chrome.storage.local.get([storageKey, 'maxHistoryLimit', 'sessionTimeout'], (result) => {
        let history = result[storageKey] || [];

        let limit = parseInt(result.maxHistoryLimit);
        if (isNaN(limit) || limit < 3) limit = 20;
        if (limit > 100) limit = 100;

        let timeoutMs = parseInt(result.sessionTimeout);
        if (isNaN(timeoutMs) || timeoutMs < 10000) timeoutMs = 120000;

        const now = Date.now();
        const latest = history[0];

        let shouldCreateNew = true;

        if (latest) {
            if (latest.content === content) {
                latest.timestamp = now;
                shouldCreateNew = false;
            }
            else if (!isForceNew) {
                const timeDiff = now - latest.timestamp;
                if (timeDiff < timeoutMs) {
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

        if (history.length > limit) history.pop();

        chrome.storage.local.set({ [storageKey]: history });
    });
};

function isEvolution(oldStr, newStr) {
    if (!oldStr || !newStr) return false;
    const lenOld = oldStr.length;
    const lenNew = newStr.length;
    const maxLen = Math.max(lenOld, lenNew);
    const diff = Math.abs(lenOld - lenNew);

    if (diff > maxLen * 0.5) return false;

    if (oldStr.includes(newStr)) {
        if (diff < 10 || (diff / lenOld) < 0.15) return true;
        return false;
    }
    if (newStr.includes(oldStr)) return true;

    const checkLimit = 500;
    const limit = Math.min(lenOld, lenNew, checkLimit);
    let commonPrefixLen = 0;
    for (let i = 0; i < limit; i++) {
        if (oldStr[i] === newStr[i]) commonPrefixLen++;
        else break;
    }
    if (commonPrefixLen >= checkLimit || (commonPrefixLen / maxLen) > 0.6) return true;

    return false;
}

// 防抖保存（正常打字流）
const debouncedSave = debounce((target) => {
    saveInput(target, false);
}, DEBOUNCE_DELAY);

// === 核心修复：输入事件处理 ===
document.addEventListener('input', (e) => {
    const t = e.target;
    if (!(t.matches('input, textarea') || t.isContentEditable)) return;

    // 获取当前实时的值
    let currentVal = t.value;
    if (t.isContentEditable) currentVal = t.innerText;

    // 确保 currentVal 是字符串，防止 null 报错
    if (currentVal === null || currentVal === undefined) currentVal = "";

    // 1. 获取之前的快照 (内存操作，极快)
    const lastVal = inputSnapshot.get(t) || "";

    // 2. 紧急抢救判定 (Anti-Data-Loss):
    // 只有同时满足以下条件才立即保存：
    // A. 当前变空了
    // B. 之前有内容
    // C. 之前的内容长度 > 2 (避免保存 "H" 这种退格残留)
    // D. (关键) 长度变化 > 1 (说明不是按退格键一个字一个字删的，而是全选删除或脚本清空)
    const lengthDiff = lastVal.length - currentVal.length;

    if (currentVal.trim() === '' && lastVal.trim() !== '') {
        // 如果是一次性删除了超过 1 个字符 (比如全选删除)，或者原来的内容很长
        // 或者是被网页脚本瞬间清空的
        if (lengthDiff > 1 && lastVal.length > 2) {
            saveInput(t, true, lastVal);
        }
    }

    // 3. 更新快照 (纯内存操作，无性能损耗)
    // 只要有内容就更新，为下一次可能的意外做准备
    if (currentVal.trim() !== '') {
        inputSnapshot.set(t, currentVal);
    }

    // 4. 正常触发防抖保存
    // 只有当前有内容时才放入防抖队列
    if (currentVal.trim() !== '') {
        debouncedSave(t);
    }
}, true);

// === 核心修复：回车键立即保存 ===
// 很多表单回车就是提交，这时候 debounce 来不及跑
document.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
        const t = e.target;
        if (t.matches('input, textarea') || t.isContentEditable) {
            // 立即保存当前内容，不强制新建（允许合并）
            saveInput(t, false);
        }
    }
}, true);

document.addEventListener('focus', (e) => {
    const t = e.target;
    if (t.matches('input, textarea') || t.isContentEditable) {
        // 聚焦时，把当前内容存入快照，作为起点
        let val = t.value;
        if (t.isContentEditable) val = t.innerText;
        if (val) inputSnapshot.set(t, val);

        saveInput(t, true);
    }
}, true);

document.addEventListener('blur', (e) => {
    const t = e.target;
    if (t.matches('input, textarea') || t.isContentEditable) {
        saveInput(t, false);
    }
}, true);


// --- UI Logic (保持不变) ---

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