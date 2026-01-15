let isEnabled = true;
let activeInput = null;
let triggerBtn = null;
let panel = null;
let tooltip = null;

// 定时器
let closeTimer = null;
let showTimer = null;

// === 新增：动画定时器 (防止快速操作时动画错乱) ===
let panelAnimTimer = null;
let tooltipAnimTimer = null;

// 记录鼠标最后位置
let lastMouseX = 0;
let lastMouseY = 0;

// 输入法状态
let isComposing = false;

// 缓存与快照
let config = { limit: 20, timeout: 120000 };
const historyCache = new WeakMap();
const dirtyInputs = new Set();
const inputSnapshot = new WeakMap();

const DEBOUNCE_DELAY = 800;

// ==========================================
// 1. 基础工具函数
// ==========================================

function safeStorageGet(keys, callback) {
    if (!chrome.runtime?.id) return;
    try {
        chrome.storage.local.get(keys, callback);
    } catch (e) {
        console.warn("[InputSaver] Storage读取失败:", e);
    }
}

function safeStorageSet(data, callback) {
    if (!chrome.runtime?.id) return;
    try {
        chrome.storage.local.set(data, callback);
    } catch (e) {
        console.warn("[InputSaver] Storage写入失败:", e);
    }
}

function escapeHtml(text) {
    if (typeof text !== 'string') return "";
    return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#039;");
}

// === 核心修改：优雅关闭 UI ===
function removeUI() {
    // 停止所有追踪
    stopGlobalTracker();
    hideTooltip(); // 先关 tooltip

    // 如果面板或按钮存在，且没有正在关闭中
    if (panel && panel.classList.contains('is-visible') && !panel.classList.contains('is-exiting')) {
        // 1. 标记为离场状态 (触发 CSS 动画)
        panel.classList.add('is-exiting');
        panel.classList.remove('is-visible');

        if (triggerBtn) {
            triggerBtn.classList.add('is-exiting');
            triggerBtn.classList.remove('is-visible');
        }

        // 2. 清除旧定时器
        if (panelAnimTimer) clearTimeout(panelAnimTimer);

        // 3. 等待动画结束 (200ms 和 CSS 对应)
        panelAnimTimer = setTimeout(() => {
            if (panel) {
                panel.style.display = 'none';
                panel.classList.remove('is-exiting');
            }
            if (triggerBtn) {
                triggerBtn.style.display = 'none';
                triggerBtn.classList.remove('is-exiting');
            }
        }, 200);
    } else {
        // 还没显示出来就关掉了，直接隐藏
        if (panel) {
            panel.style.display = 'none';
            panel.classList.remove('is-visible', 'is-exiting');
        }
        if (triggerBtn) {
            triggerBtn.style.display = 'none';
            triggerBtn.classList.remove('is-visible', 'is-exiting');
        }
    }
}

// === 核心修改：优雅隐藏 Tooltip ===
function hideTooltip() {
    if (tooltip && tooltip.classList.contains('is-visible') && !tooltip.classList.contains('is-exiting')) {
        tooltip.classList.add('is-exiting');
        tooltip.classList.remove('is-visible');

        if (tooltipAnimTimer) clearTimeout(tooltipAnimTimer);

        tooltipAnimTimer = setTimeout(() => {
            if (tooltip) {
                tooltip.style.display = 'none';
                tooltip.classList.remove('is-exiting');
            }
        }, 150); // 略快于面板 (150ms)
    } else if (tooltip && !tooltip.classList.contains('is-exiting')) {
        // 只有非 exiting 状态才强行隐藏，防止打断动画
        tooltip.style.display = 'none';
    }
}

// === 核心修改：优雅显示 Tooltip
function showTooltip(content, targetEl) {
    if (!tooltip) return;

    const inner = tooltip.querySelector('.is-tooltip-content');
    if (!inner) return;

    // 1. 状态记录
    const isAlreadyVisible = tooltip.classList.contains('is-visible') && !tooltip.classList.contains('is-exiting');
    let startRect = null;

    if (isAlreadyVisible) {
        startRect = tooltip.getBoundingClientRect();
    } else {
        tooltip.classList.remove('is-exiting');
        if (tooltipAnimTimer) clearTimeout(tooltipAnimTimer);
    }

    // 2. 准备测量环境 (Measure Phase)
    tooltip.style.transition = 'none';

    // 初始化样式：确保无限制、无滚动条干扰
    tooltip.style.width = 'auto';
    tooltip.style.height = 'auto';
    tooltip.style.maxWidth = '';
    tooltip.style.maxHeight = '';
    tooltip.style.overflow = 'visible';

    // 重置内胆
    inner.style.width = '';
    inner.style.height = '';
    inner.style.minWidth = '';
    inner.style.overflowY = 'hidden';
    inner.innerText = content;

    tooltip.style.display = 'block';

    // 3. 计算屏幕布局限制 (Constraints)
    const rect = targetEl.getBoundingClientRect();
    const panelRect = panel.getBoundingClientRect();
    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;
    const gap = 2;

    // 水平逻辑
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

    // 设置最大宽度限制
    const finalMaxWidth = Math.min(Math.max(limitWidth, 300), 600);
    tooltip.style.maxWidth = `${finalMaxWidth}px`;

    // 确定水平位置
    if (spaceRight < minDesiredWidth && spaceRight < spaceLeft) {
        left = panelRect.left - tooltip.offsetWidth - gap;
    }
    if (left < 5) left = 5;

    // -----------------------------------------------------------
    // [核心修复]：三步测量法 (The "Expand-and-Shrink" Technique)
    // -----------------------------------------------------------

    // Step A: 初步测量
    // 此时浏览器可能因为预留滚动条空间而把文字挤换行
    const rawRect = tooltip.getBoundingClientRect();

    // Step B: 暴力扩容 (Expansion)
    // 强行加宽 5px (超过一般滚动条宽度 2px)，消除占位影响
    // 这一步是为了让被挤成 2 行的文字变回 1 行
    tooltip.style.width = `${rawRect.width + 5}px`;

    // Step C: 精确测量 (Refined Measurement)
    // 现在文字排版正常了，我们读取 scrollWidth/scrollHeight 获取真实内容尺寸
    // +1px 缓冲用于边框/亚像素
    const realContentWidth = Math.ceil(inner.scrollWidth) + 1;
    const realContentHeight = Math.ceil(inner.scrollHeight) + 1;

    // 最终尺寸：不能超过最大限制
    const finalWidth = Math.min(realContentWidth, finalMaxWidth);
    // 高度先用真实高度，后面再校验屏幕垂直空间
    let finalHeight = realContentHeight;

    // -----------------------------------------------------------

    // 垂直逻辑 & 滚动开启判断
    let top = rect.top;
    let finalMaxHeightStyle = '';
    let shouldScroll = false;

    // 重新应用高度限制逻辑
    if (top + finalHeight > viewportHeight - 10) {
        top = viewportHeight - finalHeight - 10;
    }
    if (top < 10) {
        top = 10;
        const availableHeight = viewportHeight - 20;
        finalMaxHeightStyle = `${availableHeight}px`;
        // 只有当真实高度确实超过屏幕可用高度时，才开启滚动
        // 这里的判定比 offsetHeight 更准确
        if (finalHeight > availableHeight) {
            shouldScroll = true;
        }
    }

    // 4. 应用锁定 (Lock)
    // 内胆尺寸锁定为计算出的精确尺寸
    inner.style.width = `${finalWidth}px`;

    // 如果需要滚动，内胆高度保持自动撑开(或者设为 max)，外壳限制高度
    // 如果不需要滚动，内胆高度锁死
    inner.style.height = `${finalHeight}px`;
    inner.style.overflowY = shouldScroll ? 'auto' : 'hidden';

    // 5. 准备动画目标样式
    const targetStyle = {
        width: `${finalWidth}px`,
        height: `${finalHeight}px`,
        left: `${left}px`,
        top: `${top}px`,
        maxHeight: finalMaxHeightStyle || 'none',
        overflow: 'hidden'
    };

    // 6. 执行动画
    if (isAlreadyVisible && startRect) {
        // A. 回溯
        tooltip.style.width = `${startRect.width}px`;
        tooltip.style.height = `${startRect.height}px`;
        tooltip.style.left = `${startRect.left}px`;
        tooltip.style.top = `${startRect.top}px`;
        tooltip.style.overflow = 'hidden';

        void tooltip.offsetHeight;

        // C. 播放
        tooltip.style.transition = '';
        tooltip.style.width = targetStyle.width;
        tooltip.style.height = targetStyle.height;
        tooltip.style.left = targetStyle.left;
        tooltip.style.top = targetStyle.top;

        if (targetStyle.maxHeight !== 'none') {
            tooltip.style.maxHeight = targetStyle.maxHeight;
        } else {
            tooltip.style.maxHeight = '';
        }

    } else {
        // 首次显示
        tooltip.style.transition = 'none';
        tooltip.style.top = targetStyle.top;
        tooltip.style.left = targetStyle.left;

        tooltip.style.width = targetStyle.width;
        tooltip.style.height = targetStyle.height;

        if (targetStyle.maxHeight !== 'none') {
            tooltip.style.maxHeight = targetStyle.maxHeight;
        }

        void tooltip.offsetHeight;
        tooltip.style.transition = '';
        tooltip.classList.add('is-visible');
    }
}

// ... 辅助函数 getSelector, getStorageKey, debounce ...
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

function isEvolution(oldStr, newStr) {
    oldStr = oldStr || "";
    newStr = newStr || "";

    const lenOld = oldStr.length;
    const lenNew = newStr.length;
    const maxLen = Math.max(lenOld, lenNew);
    const diff = Math.abs(lenOld - lenNew);

    if (maxLen === 0) return false;

    // 追加检测
    if (newStr.includes(oldStr)) return true;

    // 差异过大检测
    if (diff > maxLen * 0.5) return false;

    if (oldStr.includes(newStr)) {
        if (diff < 10 || (diff / lenOld) < 0.15) return true;
        return false;
    }

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

// ... 核心逻辑 loadConfig, loadHistoryToMemory ...
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

chrome.runtime.onMessage.addListener((msg) => {
    if (msg.action === "toggleState") {
        isEnabled = msg.state;
        removeUI();
    }
});

function loadHistoryToMemory(target, callback) {
    const key = getStorageKey(target);
    safeStorageGet([key], (res) => {
        const history = (res && res[key]) ? res[key] : [];
        historyCache.set(target, { key: key, data: history });
        if (callback) callback(history);
    });
}

function processInputSync(target, isForceNew = false, contentOverride = null) {
    if (!isEnabled) return;
    if (target.type === 'password') return;

    let content = contentOverride;
    if (content === null) {
        content = target.value;
        if (target.isContentEditable) content = target.innerText;
    }
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

// ... 事件监听 compositionstart, end, input, focus, blur, unload ...
document.addEventListener('compositionstart', () => { isComposing = true; }, true);
document.addEventListener('compositionend', (e) => {
    isComposing = false;
    handleInputEvent(e.target);
}, true);

function handleInputEvent(t) {
    if (!(t.matches('input, textarea') || t.isContentEditable)) return;
    if (isComposing) return;

    let currentVal = t.value;
    if (t.isContentEditable) currentVal = t.innerText;
    currentVal = currentVal || "";

    const lastVal = inputSnapshot.get(t) || "";
    const lengthDiff = lastVal.length - currentVal.length;

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
}

document.addEventListener('input', (e) => handleInputEvent(e.target), true);

document.addEventListener('focus', (e) => {
    const t = e.target;
    if (t.matches('input, textarea') || t.isContentEditable) {
        loadHistoryToMemory(t, () => {
            let val = t.value;
            if (t.isContentEditable) val = t.innerText;
            val = val || "";
            if (val) inputSnapshot.set(t, val);
            processInputSync(t, true);
            debouncedFlush();
        });
    }
}, true);

document.addEventListener('blur', (e) => {
    const t = e.target;
    if (t.matches('input, textarea') || t.isContentEditable) {
        isComposing = false;
        processInputSync(t, false);
        flushDirtyData();
    }
}, true);

window.addEventListener('beforeunload', () => {
    if (dirtyInputs.size === 0) return;
    const dataToSave = {};
    dirtyInputs.forEach(target => {
        const cacheEntry = historyCache.get(target);
        if (cacheEntry) dataToSave[cacheEntry.key] = cacheEntry.data;
    });
    if (chrome.runtime?.id) {
        chrome.storage.local.set(dataToSave);
    }
});

document.addEventListener('dblclick', (e) => {
    if (!isEnabled) return;
    const t = e.target;
    if ((t.matches('input:not([type="password"]), textarea') || t.isContentEditable)) {
        activeInput = t;
        if (!historyCache.has(t)) {
            loadHistoryToMemory(t, () => showTriggerButton(t));
        } else {
            showTriggerButton(t);
        }
    }
});

document.addEventListener('mousedown', (e) => {
    const clickedPanel = panel && panel.contains(e.target);
    const clickedTooltip = tooltip && tooltip.contains(e.target);
    const clickedBtn = triggerBtn && triggerBtn.contains(e.target);
    const clickedInput = e.target === activeInput;

    if (clickedPanel || clickedTooltip || clickedBtn || clickedInput) return;
    removeUI();
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
            if (hoveringPanel || hoveringTooltip) return;
            removeUI();
        }
    }
}, true);

// ==========================================
// 5. UI 渲染与控制 (部分修改)
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
    // 如果正在执行退出动画，也视为有效区域，防止动画中途鼠标划过导致逻辑错乱
    if (element.classList.contains('is-exiting')) return false;

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
                // 如果鼠标在任何一个上面，都不要关
                // 这里再做一次严谨检查，因为 setTimeout 有延时
                // 注意：这里不需要传参，使用最新的 DOM 状态
                // 暂时简单处理：只关 tooltip
                hideTooltip();
                // 面板通常需要点击外部才关闭，或者这里也关闭？
                // 你的需求似乎是“防丢失”，所以保持面板打开比较好
            }, 300);
        }
    }
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

// === 修改：showTriggerButton ===
function showTriggerButton(target) {
    if (!triggerBtn) {
        triggerBtn = document.createElement('div');
        triggerBtn.id = 'is-trigger-btn';
        triggerBtn.innerHTML = '◷';
        triggerBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            showPanel();
            // 点击后按钮消失 (也加动画)
            triggerBtn.classList.add('is-exiting');
            triggerBtn.classList.remove('is-visible');
            setTimeout(() => {
                if (triggerBtn) {
                    triggerBtn.style.display = 'none';
                    triggerBtn.classList.remove('is-exiting');
                }
            }, 200);
        });
        document.body.appendChild(triggerBtn);
    }

    const rect = target.getBoundingClientRect();
    triggerBtn.style.display = 'block';
    triggerBtn.style.top = (rect.top + window.pageYOffset - 12) + 'px';
    triggerBtn.style.left = (rect.right + window.pageXOffset - 12) + 'px';

    // 强制重绘，触发 transition
    requestAnimationFrame(() => {
        triggerBtn.classList.remove('is-exiting');
        triggerBtn.classList.add('is-visible');
    });

    startGlobalTracker();
}

// === 修改：showPanel ===
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

        // 创建外壳和内胆
        tooltip = document.createElement('div');
        tooltip.id = 'is-global-tooltip';

        // 创建内胆
        const innerContent = document.createElement('div');
        innerContent.className = 'is-tooltip-content';
        tooltip.appendChild(innerContent); // 塞进去

        document.body.appendChild(tooltip);

        // 滚动锁加在外壳上(防止冒泡)，但监听滚动事件要加在内胆上(因为 overflow 在内胆)
        addScrollLock(tooltip);

        // 监听内胆滚动
        innerContent.addEventListener('scroll', () => {
            if (closeTimer) { clearTimeout(closeTimer); closeTimer = null; }
        });

        tooltip.addEventListener('mousedown', e => e.stopPropagation());

        panel.querySelector('.is-clear').addEventListener('click', (e) => {
            e.stopPropagation();
            if (!activeInput) return;
            if (confirm('确定清空当前输入框的所有记录？')) {
                const key = getStorageKey(activeInput);
                safeStorageSet({ [key]: [] }, () => {
                    historyCache.set(activeInput, { key: key, data: [] });
                    renderList([]);
                });
            }
        });
    }

    const cacheEntry = historyCache.get(activeInput);
    const history = cacheEntry ? cacheEntry.data : [];
    renderList(history);
    adjustPosition(activeInput);

    // 触发进场动画
    if (panelAnimTimer) clearTimeout(panelAnimTimer);
    panel.style.display = 'flex'; // 先显示
    panel.classList.remove('is-exiting');

    requestAnimationFrame(() => {
        panel.classList.add('is-visible');
    });

    startGlobalTracker();
}

// ... setupDraggable, adjustPosition, renderList, deleteSingleItem 保持不变 ...
// (代码太长省略，请保留原有的逻辑，只需注意它们内部没有特殊动画逻辑)
// 记得把最后几个函数的代码也补上，或者直接用上一版的内容，只要把上面改过的 removeUI/show/hide 替换即可。

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
