document.addEventListener('DOMContentLoaded', () => {
    loadAllHistory();

    // 刷新按钮
    document.getElementById('refresh').addEventListener('click', loadAllHistory);

    // 新增：全局清空按钮逻辑
    document.getElementById('clearAllMain').addEventListener('click', () => {
        if (confirm('【严重警告】\n\n确定要清空所有网站的输入历史吗？\n此操作不可恢复！')) {
            chrome.storage.local.clear(() => {
                loadAllHistory(); // 清空后重新加载列表(显示空白)
            });
        }
    });
});

function loadAllHistory() {
    const container = document.getElementById('container');
    container.innerHTML = '正在加载...';

    chrome.storage.local.get(null, (items) => {
        container.innerHTML = '';

        const keys = Object.keys(items).filter(k => k.startsWith('hist_'));

        if (keys.length === 0) {
            container.innerHTML = '<p style="text-align:center;color:#666;margin-top:50px;">暂无任何历史记录。</p>';
            return;
        }

        let allEntries = [];
        keys.forEach(key => {
            const historyList = items[key];
            if (Array.isArray(historyList)) {
                historyList.forEach(entry => {
                    entry._storageKey = key;
                    allEntries.push(entry);
                });
            }
        });

        allEntries.sort((a, b) => b.timestamp - a.timestamp);

        allEntries.forEach(entry => {
            const div = document.createElement('div');
            div.className = 'card';

            let hostname = '未知页面';
            try { if (entry.url) hostname = new URL(entry.url).hostname; } catch (e) { }
            const timeStr = new Date(entry.timestamp).toLocaleString();

            // 构建卡片 HTML，包含一个复制按钮
            div.innerHTML = `
                <button class="copy-btn" data-content="${escapeHtml(entry.content)}">复制内容</button>
                <div class="card-header">
                    <div style="display:flex;align-items:center;">
                        <span>来源: <a href="${entry.url}" target="_blank" class="card-url" title="${entry.url}">${hostname}</a></span>
                    </div>
                    <span>${timeStr}</span>
                </div>
                <div class="card-content">${escapeHtml(entry.content)}</div>
            `;

            container.appendChild(div);
        });

        // 统一绑定复制事件（比在循环里一个个绑更高效）
        const copyBtns = document.querySelectorAll('.copy-btn');
        copyBtns.forEach(btn => {
            btn.addEventListener('click', (e) => {
                // 因为 escapeHtml 转义过，为了复制原始内容，建议直接用 storage 里的数据
                // 但为了简化，这里我们反转义一下，或者直接从 DOM 拿不太安全
                // 最好的方式是上面 innerHTML 渲染时不要把 content 放在 data 属性里（太长）
                // 修正方案：从下面的 card-content 拿文本

                const contentDiv = e.target.parentElement.querySelector('.card-content');
                const textToCopy = contentDiv.innerText; // innerText 会自动处理转义字符的还原

                navigator.clipboard.writeText(textToCopy).then(() => {
                    const originalText = e.target.innerText;
                    e.target.innerText = '已复制!';
                    e.target.style.background = '#4caf50';
                    setTimeout(() => {
                        e.target.innerText = originalText;
                        e.target.style.background = '';
                    }, 1500);
                });
            });
        });
    });
}

function escapeHtml(text) {
    if (!text) return "";
    return text
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
}