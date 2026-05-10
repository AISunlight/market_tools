# Market Tools Desktop

一个基于 Tauri 的桌面工具集，用来承载多个市场数据类小应用。当前内置的第一个子应用是 **Yahoo 股票批量查询**。

## 功能

- 桌面端应用壳，左侧导航可切换不同子应用
- 独立设置页，可配置所有子应用共享的网络环境
- Yahoo 股票子应用支持批量输入股票代码、自动填充数据、导出 CSV
- Tauri 后端负责请求 Yahoo Finance，并做本地文件缓存
- 子应用通过注册表扩展，后续可以继续增加同类型工具

## 目录结构

```text
.
├─ src/                     # 前端应用
│  ├─ main.js               # 应用壳、路由、设置加载
│  ├─ registry.js           # 子应用注册表
│  ├─ settings.js           # 设置页面
│  ├─ styles.css            # 全局样式
│  └─ apps/
│     └─ yahooStock.js      # Yahoo 股票子应用
├─ src-tauri/               # Tauri / Rust 后端
│  ├─ src/main.rs           # 设置、网络请求、缓存、Tauri 命令
│  ├─ tauri.conf.json       # Tauri 配置
│  └─ Cargo.toml            # Rust 依赖
├─ server.js                # 旧版 Node 本地服务，保留作兼容
└─ README.md
```

## 前置环境

前端预览只需要 Node.js：

```powershell
node -v
npm -v
```

运行 Tauri 桌面端还需要：

- Rust / Cargo：<https://rustup.rs/>
- Visual Studio Build Tools，并安装 MSVC 与 Windows SDK
- WebView2 Runtime，Windows 现代系统通常已自带

可用下面命令检查 Tauri 环境：

```powershell
npx tauri info
```

如果你本机需要通过 Clash 下载 Rust 依赖，不要把代理写进仓库配置。可以在当前终端临时设置：

```powershell
$env:HTTPS_PROXY="http://127.0.0.1:7897"
$env:HTTP_PROXY="http://127.0.0.1:7897"
```

GitHub Actions 环境不需要这个代理。

## 安装

```powershell
npm install
```

## 前端预览

只看前端界面时运行：

```powershell
npm run dev
```

默认地址：

```text
http://127.0.0.1:5174
```

注意：前端预览模式不能调用 Tauri Rust 后端，因此 Yahoo 查询功能需要在 Tauri 桌面端里使用。

## 运行桌面端

安装好 Rust 与 Visual Studio Build Tools 后运行：

```powershell
npm run tauri:dev
```

打包桌面应用：

```powershell
npm run tauri:build
```

## 打包 macOS 软件包

macOS 的 `.app` / `.dmg` 需要在 macOS 系统上构建。Windows 不能直接产出可运行的 macOS 包。

项目已内置 GitHub Actions 工作流：

```text
.github/workflows/build-macos.yml
```

触发方式：

- 推送任意分支会自动触发构建
- 也可以在 Actions 页面手动运行 `Build macOS package`

构建完成后，GitHub Releases 会自动创建一个预发布版本，名称类似：

```text
Build 12 · main · <commit-sha>
```

Release 中会包含四个下载文件：

- Apple Silicon / ARM64：
  - `Market-Tools-arm64.dmg`
  - `Market-Tools-arm64.app.zip`
- Intel / x64：
  - `Market-Tools-intel.dmg`
  - `Market-Tools-intel.app.zip`

Actions Artifacts 中也会保留同样的构建结果。

本地如果在 macOS 上构建：

```bash
npm ci
npm run tauri:icon
npm run tauri:build -- --target aarch64-apple-darwin
npm run tauri:build -- --target x86_64-apple-darwin
```

构建产物通常位于：

```text
src-tauri/target/aarch64-apple-darwin/release/bundle/macos/
src-tauri/target/aarch64-apple-darwin/release/bundle/dmg/
src-tauri/target/x86_64-apple-darwin/release/bundle/macos/
src-tauri/target/x86_64-apple-darwin/release/bundle/dmg/
```

## 设置页

设置页用于配置所有子应用共享的网络环境：

- **自定义代理**：默认 `http://127.0.0.1:7897`，适合 Clash mixed/http 端口
- **系统代理**：使用系统网络配置
- **直连**：不使用代理
- **缓存有效期**：默认 12 小时
- **Yahoo 查询并发数量**：默认 4，可在 1 到 20 之间调整

如果你使用 Clash，请确认 Yahoo 相关域名会走代理节点：

```text
query1.finance.yahoo.com
query2.finance.yahoo.com
fc.yahoo.com
```

## Yahoo 股票子应用

支持的操作：

- 批量粘贴股票代码
- 像 Excel 一样编辑 Symbol 列
- 查询后自动填充：
  - Sector
  - Industry
  - EPS (FWD)
  - PE (FWD)
  - Div Rate
  - Yield
  - Short Interest
  - Market Cap
  - Volume
  - Prev. Close
- 导出 CSV，Excel 可直接打开
- 强制刷新，跳过缓存重新请求 Yahoo

## 本地缓存

Yahoo 股票数据由 Tauri 后端缓存到应用数据目录：

```text
stock-meta-cache.json
```

缓存有效期由设置页的“缓存有效期”控制。缓存命中时，表格的 Note 列会显示 `cache hit`。

## 扩展子应用

新增子应用时，在 `src/apps` 下创建一个模块，例如：

```text
src/apps/myTool.js
```

模块导出一个 mount 函数：

```js
export function mountMyTool(container, context) {
  container.innerHTML = "<h1>My Tool</h1>";
}
```

然后在 `src/registry.js` 注册：

```js
import { mountMyTool } from "./apps/myTool.js";

export const apps = [
  {
    id: "my-tool",
    name: "My Tool",
    description: "新的市场数据工具",
    icon: "M",
    mount: mountMyTool
  }
];
```

每个子应用都会收到统一的 `context`：

```js
{
  settings,      // 当前设置
  invoke,        // Tauri 后端命令调用函数
  backendReady   // 是否运行在 Tauri 桌面端
}
```

如果子应用需要新的后端能力，可以在 `src-tauri/src/main.rs` 中新增 Tauri command，并加入 `invoke_handler`。

## 旧版服务

旧版 Node 服务仍保留在 `server.js`，方便回退或对比：

```powershell
npm run legacy:start
```

使用 Clash 默认代理端口：

```powershell
npm run legacy:start:proxy
```
