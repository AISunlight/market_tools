import { invoke } from "@tauri-apps/api/core";
import "./styles.css";
import { apps } from "./registry.js";
import { createSettingsView } from "./settings.js";

const DEFAULT_SETTINGS = {
  networkMode: "proxy",
  proxyUrl: "http://127.0.0.1:7897",
  cacheTtlHours: 12,
  concurrency: 4
};

const state = {
  route: "yahoo-stock",
  settings: { ...DEFAULT_SETTINGS },
  backendReady: Boolean(window.__TAURI_INTERNALS__)
};

const root = document.querySelector("#app");

async function backendInvoke(command, payload) {
  if (!state.backendReady) {
    throw new Error("当前在浏览器预览模式；请用 npm run tauri:dev 启动桌面端以调用 Tauri 后端。");
  }
  return invoke(command, payload);
}

async function loadSettings() {
  if (!state.backendReady) {
    const saved = localStorage.getItem("market-tools-settings");
    state.settings = saved ? { ...DEFAULT_SETTINGS, ...JSON.parse(saved) } : { ...DEFAULT_SETTINGS };
    return;
  }
  state.settings = { ...DEFAULT_SETTINGS, ...(await backendInvoke("get_settings")) };
}

async function saveSettings(settings) {
  state.settings = { ...state.settings, ...settings };
  if (!state.backendReady) {
    localStorage.setItem("market-tools-settings", JSON.stringify(state.settings));
    return state.settings;
  }
  return backendInvoke("save_settings", { settings: state.settings });
}

function shell() {
  const appItems = apps
    .map(
      (app) => `
        <button class="nav-item ${state.route === app.id ? "active" : ""}" data-route="${app.id}">
          <span class="nav-icon">${app.icon}</span>
          <span>${app.name}</span>
        </button>
      `
    )
    .join("");

  root.innerHTML = `
    <aside class="sidebar">
      <div class="brand">
        <div class="brand-mark">MT</div>
        <div>
          <div class="brand-title">Market Tools</div>
          <div class="brand-subtitle">桌面工具集</div>
        </div>
      </div>
      <nav>
        ${appItems}
        <button class="nav-item ${state.route === "settings" ? "active" : ""}" data-route="settings">
          <span class="nav-icon">⚙</span>
          <span>设置</span>
        </button>
      </nav>
      <div class="sidebar-note">
        网络：${networkLabel(state.settings)}
      </div>
    </aside>
    <main class="workspace" id="workspace"></main>
  `;

  root.querySelectorAll("[data-route]").forEach((button) => {
    button.addEventListener("click", () => {
      state.route = button.dataset.route;
      render();
    });
  });
}

function networkLabel(settings) {
  if (settings.networkMode === "direct") return "直连";
  if (settings.networkMode === "system") return "系统代理";
  return settings.proxyUrl || "自定义代理";
}

function render() {
  shell();
  const workspace = document.querySelector("#workspace");

  if (state.route === "settings") {
    createSettingsView(workspace, {
      settings: state.settings,
      backendReady: state.backendReady,
      onSave: async (nextSettings) => {
        await saveSettings(nextSettings);
        render();
      }
    });
    return;
  }

  const selected = apps.find((app) => app.id === state.route) || apps[0];
  selected.mount(workspace, {
    settings: state.settings,
    invoke: backendInvoke,
    backendReady: state.backendReady
  });
}

loadSettings().then(render).catch((error) => {
  root.innerHTML = `<div class="fatal">${error.message || "启动失败"}</div>`;
});
