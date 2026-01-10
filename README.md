# 🖋️ 文存 WenSaver

**笔墨随心，字句永存**

[![Edge Add-on](https://img.shields.io/badge/Edge_Add--ons-Get_文存-0078D7?logo=microsoft-edge&logoColor=white)](https://microsoftedge.microsoft.com/addons/detail/daehdpjjighepbpjobpdmhhiamjdfend)
[![License](https://img.shields.io/github/license/mashape/apistatus.svg)](LICENSE)
[![Manifest V3](https://img.shields.io/badge/Manifest-V3-blue)](https://developer.chrome.com/docs/extensions/mv3/intro/)

[<img src="https://cdn.jsdelivr.net/gh/ttwjz/Zhan-Picture-Bed/WenSaver/splash-100.png" alt="文存 WenSaver">](https://github.com/ttwjz/WenSaver)&emsp;
[<img src="https://cdn.jsdelivr.net/gh/ttwjz/Zhan-Picture-Bed/WenSaver/get_add-on_edge.png" alt="Get the Add-on Edge">](https://microsoftedge.microsoft.com/addons/detail/daehdpjjighepbpjobpdmhhiamjdfend)

---

> “如文人案头青箱，存字句若珍宝；似智能笔墨侍从，化焦虑为从容。”

**文存 (WenSaver)** 是一款灵感源于古籍智慧的浏览器扩展，致敬先驱者 *Typio Form Recovery*。它能自动守护您在网页输入框中的每一次键入，即使误关页面或浏览器意外崩溃，您的文字亦如砚中余墨，静待归来。

## ✨ 核心功能 (Features)

文存不仅仅是一个简单的自动保存工具，它为现代浏览体验注入了人文温度：

*   **🛡️ 自动保存 (Auto-Save)**
    *   实时备份输入框内容，防丢防崩。采用智能防抖算法与会话合并机制，既保证数据安全，又避免历史记录碎片化。
*   **📂 智慧分存 (Smart Separation)**
    *   基于 `域名 + 元素特征` 生成唯一指纹，每个文本框独立记录历史，互不干扰，精准追溯。
*   **🖱️ 双击唤起 (Double-Click Access)**
    *   双击任意输入框，即可浮现「◷」历史按钮。悬浮窗设计，支持拖拽，交互优雅流畅。
*   **⚡ 一键回填 (One-Click Restore)**
    *   在悬浮面板中预览历史记录，轻击即可瞬间恢复内容，或点击复制按钮存入剪贴板。
*   **🔍 全局统览 (Global History)**
    *   通过扩展图标进入设置页，可查看所有网站的输入历史，沙场点兵，挥斥方遒。
*   **🧹 清痕无迹 (Privacy & Cleanup)**
    *   提供单条删除、单框清空及全局清空功能，隐私掌控尽在指尖。

## 📥 安装使用 (Installation)

### 方式一：应用商店安装（推荐）

直接访问 Microsoft Edge 加载项商店进行安装：
[**👉 获取 文存 WenSaver**](https://microsoftedge.microsoft.com/addons/detail/daehdpjjighepbpjobpdmhhiamjdfend)

### 方式二：本地安装

1. 前往 [Releases](https://github.com/ttwjz/WenSaver/releases) 页面下载最新版本的 `WenSaver.crx`。
2.  打开 Microsoft Edge 或 Chrome 浏览器，访问扩展管理页面：
    *   Edge: `edge://extensions/`
    *   Chrome: `chrome://extensions/`
3.  开启右上角的 **"开发人员模式" (Developer mode)**。
4.  将下载的 `WenSaver.crx` 文件拖入浏览器窗口，完成安装。

### 方式三：手动加载（开发者模式）

如果您想体验 GitHub 上的最新代码或参与开发：

1.  克隆本仓库到本地：
    ```bash
    git clone https://github.com/ttwjz/WenSaver.git
    ```
2.  打开 Microsoft Edge 或 Chrome 浏览器，访问扩展管理页面：
    *   Edge: `edge://extensions/`
    *   Chrome: `chrome://extensions/`
3.  开启右上角的 **"开发人员模式" (Developer mode)**。
4.  点击 **"加载解压缩的扩展" (Load unpacked)**。
5.  选择本项目所在的文件夹即可。

## 📖 使用说明 (Usage)

1.  **加载扩展**：安装后，扩展将自动在后台静默运行。
2.  **自动保存**：在任意网页的输入框（Input, Textarea, ContentEditable）中输入文字，扩展会自动保存。
    *   *注：密码框（type="password"）内容不会被保存。*
3.  **查看/恢复**：
    *   **双击** 输入框，右上角会出现「◷」图标。
    *   点击图标打开悬浮面板。
    *   鼠标悬停在记录上可查看完整内容，点击即可恢复到输入框。
4.  **设置与管理**：
    *   点击浏览器右上角的扩展图标打开 Popup 菜单。
    *   可调整“思考时间”（会话合并间隔）、最大记录条数，或进入全局历史页面。

## 🔒 隐私说明 (Privacy Policy)

我们深知隐私之重，因此郑重承诺：

*   **本地存储**：您输入的所有内容仅存储在您浏览器的 `LocalStorage` (本地设备) 上。
*   **绝无上传**：本扩展**绝不会**将您的任何数据传输至云端或任何第三方服务器。
*   **隐私保护**：本扩展会自动忽略密码输入框的内容。
*   **完全掌控**：您可以随时清空特定输入框的历史，或在设置中一键清空所有数据。

## 🤝 贡献 (Contributing)

欢迎提交 Issue 或 Pull Request 来帮助改进文存。

1.  Fork 本仓库
2.  创建您的特性分支 (`git checkout -b feature/AmazingFeature`)
3.  提交您的修改 (`git commit -m 'Add some AmazingFeature'`)
4.  推送到分支 (`git push origin feature/AmazingFeature`)
5.  发起 Pull Request

## 📄 开源协议 (License)

本项目基于 [MIT 协议](LICENSE) 开源。

---

Made with ❤️ by [zhan](https://github.com/ttwjz/WenSaver)
