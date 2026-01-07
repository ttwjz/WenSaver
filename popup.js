document.addEventListener('DOMContentLoaded', () => {
    const toggle = document.getElementById('toggleSwitch');
    const limitInput = document.getElementById('limitInput');
    const minInput = document.getElementById('timeoutMin');
    const secInput = document.getElementById('timeoutSec');

    const viewBtn = document.getElementById('viewAll');
    const clearBtn = document.getElementById('clearAll');

    // 默认值常量
    const DEFAULT_LIMIT = 20;
    const DEFAULT_TIMEOUT_MS = 2 * 60 * 1000; // 默认2分钟
    const MIN_TIMEOUT_SEC = 10;
    const MAX_TIMEOUT_SEC = 2 * 60 * 60; // 2小时

    // 1. 初始化数据加载
    chrome.storage.local.get(['extensionEnabled', 'maxHistoryLimit', 'sessionTimeout'], (res) => {
        // 开关
        const isEnabled = res.extensionEnabled !== false;
        toggle.checked = isEnabled;
        updateIconState(isEnabled);

        // 数量限制
        limitInput.value = res.maxHistoryLimit || DEFAULT_LIMIT;

        // 时间间隔 (存储的是毫秒，需要转换为分秒显示)
        let ms = res.sessionTimeout;
        if (ms === undefined || ms === null) ms = DEFAULT_TIMEOUT_MS;

        const totalSeconds = Math.floor(ms / 1000);
        const minutes = Math.floor(totalSeconds / 60);
        const seconds = totalSeconds % 60;

        minInput.value = minutes;
        secInput.value = seconds;
    });

    // 2. 监听开关
    toggle.addEventListener('change', () => {
        const newState = toggle.checked;
        chrome.storage.local.set({ extensionEnabled: newState });
        updateIconState(newState);
        notifyContentScript({ action: "toggleState", state: newState });
    });

    // 3. 监听数量限制修改
    limitInput.addEventListener('change', () => {
        let val = parseInt(limitInput.value);
        if (isNaN(val) || val < 3) val = 3;
        if (val > 100) val = 100;
        limitInput.value = val;
        chrome.storage.local.set({ maxHistoryLimit: val });
    });

    // 4. 监听时间修改 (分钟或秒改变时都触发校验保存)
    function handleTimeChange() {
        let m = parseInt(minInput.value) || 0;
        let s = parseInt(secInput.value) || 0;

        // 保证非负
        m = Math.max(0, m);
        s = Math.max(0, s);

        // 计算总秒数
        let totalSec = m * 60 + s;

        // 校验范围
        if (totalSec < MIN_TIMEOUT_SEC) totalSec = MIN_TIMEOUT_SEC;
        if (totalSec > MAX_TIMEOUT_SEC) totalSec = MAX_TIMEOUT_SEC;

        // 反算回分秒显示 (为了修正用户的错误输入，比如输入了 0分 5秒，要自动变成 0分 10秒)
        const finalMin = Math.floor(totalSec / 60);
        const finalSec = totalSec % 60;

        minInput.value = finalMin;
        secInput.value = finalSec;

        // 存入毫秒
        chrome.storage.local.set({ sessionTimeout: totalSec * 1000 });
    }

    minInput.addEventListener('change', handleTimeChange);
    secInput.addEventListener('change', handleTimeChange);

    // --- 辅助函数 ---

    function updateIconState(isOn) {
        chrome.action.setBadgeText({ text: "" });
        const iconPath = isOn ? "icon.png" : "icon-off.png";
        chrome.action.setIcon({ path: { "16": iconPath, "48": iconPath, "128": iconPath } });
    }

    function notifyContentScript(message) {
        chrome.tabs.query({}, (tabs) => {
            tabs.forEach(tab => {
                chrome.tabs.sendMessage(tab.id, message).catch(() => { });
            });
        });
    }

    viewBtn.addEventListener('click', () => chrome.runtime.openOptionsPage());

    clearBtn.addEventListener('click', () => {
        if (confirm('警告：这将删除所有网站的所有输入历史，且无法恢复！')) {
            // 获取当前设置以便保留
            chrome.storage.local.get(['extensionEnabled', 'maxHistoryLimit', 'sessionTimeout'], (settings) => {
                chrome.storage.local.clear(() => {
                    chrome.storage.local.set(settings); // 恢复设置
                    alert('所有记录已清空');
                });
            });
        }
    });
});