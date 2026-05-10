const NETWORK_OPTIONS = [
  { value: "proxy", label: "自定义代理" },
  { value: "system", label: "系统代理" },
  { value: "direct", label: "直连" }
];

export function createSettingsView(container, { settings, backendReady, onSave }) {
  container.innerHTML = `
    <section class="page-head">
      <div>
        <h1>设置</h1>
        <p>配置所有子应用共享的网络环境和缓存策略。</p>
      </div>
    </section>

    <section class="settings-panel">
      <form id="settingsForm">
        <div class="field">
          <label for="networkMode">网络环境</label>
          <select id="networkMode" name="networkMode">
            ${NETWORK_OPTIONS.map(
              (option) => `<option value="${option.value}" ${settings.networkMode === option.value ? "selected" : ""}>${option.label}</option>`
            ).join("")}
          </select>
        </div>

        <div class="field">
          <label for="proxyUrl">代理地址</label>
          <input id="proxyUrl" name="proxyUrl" value="${escapeAttr(settings.proxyUrl || "")}" placeholder="http://127.0.0.1:7897" />
        </div>

        <div class="field">
          <label for="cacheTtlHours">缓存有效期（小时）</label>
          <input id="cacheTtlHours" name="cacheTtlHours" type="number" min="1" max="168" step="1" value="${settings.cacheTtlHours || 12}" />
        </div>

        <div class="settings-foot">
          <button class="primary" type="submit">保存设置</button>
          <span id="settingsStatus">${backendReady ? "桌面后端已连接" : "浏览器预览模式"}</span>
        </div>
      </form>
    </section>
  `;

  const form = container.querySelector("#settingsForm");
  const mode = container.querySelector("#networkMode");
  const proxyUrl = container.querySelector("#proxyUrl");
  const status = container.querySelector("#settingsStatus");

  function syncProxyState() {
    proxyUrl.disabled = mode.value !== "proxy";
  }

  mode.addEventListener("change", syncProxyState);
  syncProxyState();

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const nextSettings = {
      networkMode: form.networkMode.value,
      proxyUrl: form.proxyUrl.value.trim(),
      cacheTtlHours: Number(form.cacheTtlHours.value || 12)
    };

    status.textContent = "保存中...";
    try {
      await onSave(nextSettings);
      status.textContent = "已保存";
      status.className = "ok";
    } catch (error) {
      status.textContent = error.message || "保存失败";
      status.className = "error";
    }
  });
}

function escapeAttr(value) {
  return String(value).replaceAll("&", "&amp;").replaceAll("\"", "&quot;").replaceAll("<", "&lt;");
}
