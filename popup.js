document.addEventListener('DOMContentLoaded', () => {
    const toggle = document.getElementById('toggleSwitch');
    const limitInput = document.getElementById('limitInput');
    const viewBtn = document.getElementById('viewAll');
    const clearBtn = document.getElementById('clearAll');

    // 1. 初始化数据
    chrome.storage.local.get(['extensionEnabled', 'maxHistoryLimit'], (res) => {
        // 开关状态
        const isEnabled = res.extensionEnabled !== false;
        toggle.checked = isEnabled;
        updateIconState(isEnabled);

        // 限制数量 (默认20)
        if (res.maxHistoryLimit) {
            limitInput.value = res.maxHistoryLimit;
        }
    });

    // 2. 监听开关
    toggle.addEventListener('change', () => {
        const newState = toggle.checked;
        chrome.storage.local.set({ extensionEnabled: newState });
        updateIconState(newState);
        notifyContentScript({ action: "toggleState", state: newState });
    });

    // 3. 监听数字修改
    limitInput.addEventListener('change', () => {
        let val = parseInt(limitInput.value);
        // 范围限制 3-100
        if (isNaN(val) || val < 3) val = 3;
        if (val > 100) val = 100;

        limitInput.value = val;
        chrome.storage.local.set({ maxHistoryLimit: val });
    });

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
            // 清空时保留设置项
            chrome.storage.local.get(['extensionEnabled', 'maxHistoryLimit'], (settings) => {
                chrome.storage.local.clear(() => {
                    chrome.storage.local.set(settings); // 恢复设置
                    alert('所有记录已清空');
                });
            });
        }
    });
});