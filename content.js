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

// 常量
const DEBOUNCE_DELAY = 800;

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

// === 核心优化：智能演变检测算法 ===
function isEvolution(oldStr, newStr) {
    if (!oldStr || !newStr) return false;

    const lenOld = oldStr.length;
    const lenNew = newStr.length;
    const maxLen = Math.max(lenOld, lenNew);
    const diff = Math.abs(lenOld - lenNew);

    // 1. 性能截断：如果长度变化极其巨大（超过50%），直接视为重写，无需后续计算
    if (diff > maxLen * 0.5) return false;

    // 2. 删除保护 (Significant Deletion Protection)
    // 如果是删除操作 (新内容是旧内容的子集)
    if (oldStr.includes(newStr)) {
        // 如果删除量很小 (小于10个字 或者 小于总长度的15%)，认为是修饰，允许覆盖
        // 否则 (删除了大段落)，为了安全起见，返回 false (新建条目，保留原版)
        if (diff < 10 || (diff / lenOld) < 0.15) {
            return true;
        }
        return false;
    }

    // 3. 追加操作 (Addition)
    // 如果是追加 (旧内容是新内容的子集)，通常是思路延续，允许覆盖
    if (newStr.includes(oldStr)) {
        return true;
    }

    // 4. 修改操作 (Prefix Check with Limit)
    // 性能优化：只检查前 500 个字符。如果前 500 个字符一致，基本就是同一篇
    const checkLimit = 500;
    const limit = Math.min(lenOld, lenNew, checkLimit);

    let commonPrefixLen = 0;
    for (let i = 0; i < limit; i++) {
        if (oldStr[i] === newStr[i]) commonPrefixLen++;
        else break;
    }

    // 阈值优化：使用比例而不是固定字符数
    // 如果公共前缀超过了 60% (或者超过了 checkLimit，说明开头长文一致)，视为同一语境
    if (commonPrefixLen >= checkLimit || (commonPrefixLen / maxLen) > 0.6) {
        return true;
    }

    return false;
}

// === 核心逻辑：智能保存 ===
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
            // 1. 内容完全一致：仅更新时间
            if (latest.content === content) {
                latest.timestamp = now;
                shouldCreateNew = false;
            }
            // 2. 尝试合并
            else if (!isForceNew) {
                const timeDiff = now - latest.timestamp;

                // 时间在允许范围内
                if (timeDiff < timeoutMs) {
                    // 并且内容演变判定通过 (是相似内容的修改，且没有大幅删除)
                    if (isEvolution(latest.content, content)) {
                        latest.content = content;
                        latest.timestamp = now;
                        shouldCreateNew = false;
                    }
                    // 否则 (大幅删除或重写)，shouldCreateNew 保持 true
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

const debouncedSave = debounce((e) => {
    const t = e.target;
    if (t.matches('input, textarea') || t.isContentEditable) {
        saveInput(t, false);
    }
}, DEBOUNCE_DELAY);

document.addEventListener('input', debouncedSave, true);

document.addEventListener('focus', (e) => {
    const t = e.target;
    if (t.matches('input, textarea') || t.isContentEditable) {
        saveInput(t, true);
    }
}, true);

document.addEventListener('blur', (e) => {
    const t = e.target;
    if (t.matches('input, textarea') || t.isContentEditable) {
        saveInput(t, false);
    }
}, true);


// --- UI Logic (完全保持不变) ---

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