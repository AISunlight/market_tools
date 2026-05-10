import { listen } from "@tauri-apps/api/event";

const FIELD_STORAGE_KEY = "market-tools.yahoo-stock.visible-fields";
const STATE_STORAGE_KEY = "market-tools.yahoo-stock.state";
const APP_STATE_ID = "yahoo-stock";

const fieldGroups = [
  {
    name: "基础信息",
    fields: [
      { key: "name", label: "Name", className: "name", type: "text" },
      { key: "exchange", label: "Exchange", className: "text-sm", type: "text" },
      { key: "sector", label: "Sector", className: "sector", type: "text" },
      { key: "industry", label: "Industry", className: "industry", type: "text" }
    ]
  },
  {
    name: "估值与盈利",
    fields: [
      { key: "epsForward", label: "EPS (FWD)", className: "num", type: "number" },
      { key: "peForward", label: "PE (FWD)", className: "num", type: "number" },
      { key: "bookValue", label: "Book Value", className: "num", type: "number" },
      { key: "priceToBook", label: "Price/Book", className: "num", type: "number" },
      { key: "targetMeanPrice", label: "Target Mean", className: "num", type: "number" },
      { key: "recommendation", label: "Recommend", className: "text-sm", type: "text" }
    ]
  },
  {
    name: "行情",
    fields: [
      { key: "currentPrice", label: "Current", className: "num", type: "number" },
      { key: "previousClose", label: "Prev. Close", className: "num", type: "number" },
      { key: "open", label: "Open", className: "num", type: "number" },
      { key: "dayHigh", label: "Day High", className: "num", type: "number" },
      { key: "dayLow", label: "Day Low", className: "num", type: "number" },
      { key: "fiftyTwoWeekHigh", label: "52W High", className: "num", type: "number" },
      { key: "fiftyTwoWeekLow", label: "52W Low", className: "num", type: "number" }
    ]
  },
  {
    name: "规模与成交",
    fields: [
      { key: "marketCap", label: "Market Cap", className: "num", type: "currency" },
      { key: "volume", label: "Volume", className: "num", type: "integer" },
      { key: "averageVolume", label: "Avg Volume", className: "num", type: "integer" },
      { key: "sharesOutstanding", label: "Shares Out", className: "num", type: "integer" },
      { key: "floatShares", label: "Float Shares", className: "num", type: "integer" }
    ]
  },
  {
    name: "股息与空头",
    fields: [
      { key: "divRate", label: "Div Rate", className: "num", type: "number" },
      { key: "divYield", label: "Yield", className: "num", type: "percent" },
      { key: "shortInterest", label: "Short Int.", className: "num", type: "percent" },
      { key: "beta", label: "Beta", className: "num", type: "number" }
    ]
  },
  {
    name: "财务质量",
    fields: [
      { key: "profitMargins", label: "Profit Margin", className: "num", type: "percent" },
      { key: "returnOnAssets", label: "Return on Assets", className: "num", type: "percent" },
      { key: "returnOnEquity", label: "Return on Equity", className: "num", type: "percent" },
      { key: "totalRevenue", label: "Revenue (ttm)", className: "num", type: "largeNumber" },
      { key: "netIncomeToCommon", label: "Net Income Common", className: "num", type: "largeNumber" },
      { key: "trailingEps", label: "Diluted EPS (ttm)", className: "num", type: "number" },
      { key: "totalCash", label: "Total Cash", className: "num", type: "largeNumber" },
      { key: "totalDebt", label: "Total Debt", className: "num", type: "largeNumber" },
      { key: "leveredFreeCashFlow", label: "Levered FCF", className: "num", type: "largeNumber" },
      { key: "debtToEquity", label: "Debt/Equity", className: "num", type: "number" },
      { key: "revenueGrowth", label: "Revenue Growth", className: "num", type: "percent" },
      { key: "grossMargins", label: "Gross Margin", className: "num", type: "percent" },
      { key: "operatingMargins", label: "Operating Margin", className: "num", type: "percent" }
    ]
  }
];

const fieldDefs = fieldGroups.flatMap((group) => group.fields);
const fieldByKey = Object.fromEntries(fieldDefs.map((field) => [field.key, field]));
const defaultVisibleFields = [
  "name",
  "sector",
  "industry",
  "epsForward",
  "peForward",
  "divRate",
  "divYield",
  "shortInterest",
  "marketCap",
  "volume",
  "previousClose",
  "profitMargins",
  "returnOnAssets",
  "returnOnEquity",
  "totalRevenue",
  "netIncomeToCommon",
  "trailingEps",
  "totalCash",
  "totalDebt",
  "leveredFreeCashFlow"
];
const financialHighlightFields = [
  "profitMargins",
  "returnOnAssets",
  "returnOnEquity",
  "totalRevenue",
  "netIncomeToCommon",
  "trailingEps",
  "totalCash",
  "totalDebt",
  "leveredFreeCashFlow"
];

const decimal = new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 });
const integer = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 });
const compactCurrency = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  notation: "compact",
  maximumFractionDigits: 2
});

export function mountYahooStockApp(container, context) {
  const localState = loadLocalState();
  const state = {
    rows: localState?.rows || rowsFromSymbols(["TSLA", "NVDA", "AAPL"]),
    activeCell: null,
    visibleFields: localState?.visibleFields || loadVisibleFields(),
    bulkInput: localState?.bulkInput || "TSLA\nNVDA\nAAPL",
    history: normalizeHistory(localState?.history),
    columnWidths: localState?.columnWidths || {},
    saveTimer: null,
    loadedRemoteState: false,
    highlightSymbols: new Set()
  };

  container.innerHTML = `
    <section class="page-head">
      <div>
        <h1>Yahoo 股票</h1>
        <p>批量输入股票代码，自动填充 Yahoo Finance 数据，并按需选择字段导出 CSV。</p>
      </div>
      <div class="page-badge">${context.backendReady ? "Tauri 后端" : "预览模式"}</div>
    </section>

    <section class="tool-panel">
      <textarea id="bulkInput" spellcheck="false" placeholder="每行一个代码，也支持逗号、空格或直接从 Excel 粘贴">${escapeHtml(state.bulkInput)}</textarea>
      <div class="actions">
        <button id="loadSymbols" class="primary" type="button">填入表格</button>
        <button id="appendSymbols" type="button">追加去重</button>
        <button id="fetchAll" type="button">查询全部</button>
        <button id="fieldConfig" type="button">字段配置</button>
        <button id="undoTable" type="button">恢复历史</button>
        <button id="addRows" type="button">加 10 行</button>
        <button id="clearTable" type="button">清空</button>
        <button id="exportCsv" type="button">导出 CSV</button>
        <button id="refreshRows" type="button">强制刷新</button>
      </div>
    </section>

    <section id="fieldPanel" class="field-panel" hidden>
      <div class="field-panel-head">
        <div>
          <strong>字段配置</strong>
          <span id="fieldCount"></span>
        </div>
        <div class="field-panel-actions">
          <button id="selectAllFields" type="button">全选</button>
          <button id="resetFields" type="button">默认</button>
          <button id="closeFields" type="button">完成</button>
        </div>
      </div>
      <div id="fieldGroups" class="field-groups"></div>
    </section>

    <div class="statusbar">
      <div id="status">准备就绪。</div>
      <div id="summary">0 个代码</div>
    </div>

    <div id="progressWrap" class="progress-wrap" hidden>
      <div class="progress-meta">
        <span id="progressText">0/0</span>
        <span id="progressCurrent"></span>
      </div>
      <div class="progress-track"><div id="progressBar" class="progress-bar"></div></div>
    </div>

    <section class="table-wrap">
      <table class="sheet">
        <thead id="thead"></thead>
        <tbody id="tbody"></tbody>
      </table>
    </section>
  `;

  const thead = container.querySelector("#thead");
  const tbody = container.querySelector("#tbody");
  const bulkInput = container.querySelector("#bulkInput");
  const statusEl = container.querySelector("#status");
  const summaryEl = container.querySelector("#summary");
  const fieldPanel = container.querySelector("#fieldPanel");
  const fieldGroupsEl = container.querySelector("#fieldGroups");
  const fieldCount = container.querySelector("#fieldCount");
  const progressWrap = container.querySelector("#progressWrap");
  const progressText = container.querySelector("#progressText");
  const progressCurrent = container.querySelector("#progressCurrent");
  const progressBar = container.querySelector("#progressBar");
  const buttons = {
    loadSymbols: container.querySelector("#loadSymbols"),
    appendSymbols: container.querySelector("#appendSymbols"),
    fetchAll: container.querySelector("#fetchAll"),
    fieldConfig: container.querySelector("#fieldConfig"),
    undoTable: container.querySelector("#undoTable"),
    selectAllFields: container.querySelector("#selectAllFields"),
    resetFields: container.querySelector("#resetFields"),
    closeFields: container.querySelector("#closeFields"),
    addRows: container.querySelector("#addRows"),
    clearTable: container.querySelector("#clearTable"),
    exportCsv: container.querySelector("#exportCsv"),
    refreshRows: container.querySelector("#refreshRows")
  };

  function visibleColumns() {
    return ["symbol", ...state.visibleFields, "status", "note"];
  }

  function renderHeader() {
    const ths = [
      `<th class="rownum">#</th>`,
      ...visibleColumns().map((key) => {
        const label = key === "symbol" ? "Symbol" : key === "status" ? "Status" : key === "note" ? "Note" : fieldByKey[key]?.label || key;
        const className = key === "symbol" ? "symbol" : key === "status" ? "status" : key === "note" ? "note" : fieldByKey[key]?.className || "";
        const width = state.columnWidths[key] || defaultColumnWidth(key, label);
        return `<th class="${className}" data-key="${key}" style="width:${width}px;min-width:${width}px"><span>${label}</span><button class="col-resizer" type="button" aria-label="调整 ${label} 列宽"></button></th>`;
      })
    ].join("");
    thead.innerHTML = `<tr>${ths}</tr>`;
    bindColumnResizers();
  }

  function bindColumnResizers() {
    thead.querySelectorAll(".col-resizer").forEach((handle) => {
      handle.addEventListener("pointerdown", (event) => {
        const th = event.currentTarget.closest("th");
        const key = th.dataset.key;
        const startX = event.clientX;
        const startWidth = th.getBoundingClientRect().width;
        th.classList.add("resizing");
        handle.setPointerCapture(event.pointerId);

        const move = (moveEvent) => {
          const width = Math.max(72, Math.round(startWidth + moveEvent.clientX - startX));
          state.columnWidths[key] = width;
          applyColumnWidth(key, width);
        };
        const up = () => {
          th.classList.remove("resizing");
          handle.removeEventListener("pointermove", move);
          handle.removeEventListener("pointerup", up);
          handle.removeEventListener("pointercancel", up);
          schedulePersist();
        };

        handle.addEventListener("pointermove", move);
        handle.addEventListener("pointerup", up);
        handle.addEventListener("pointercancel", up);
      });
    });
  }

  function applyColumnWidth(key, width) {
    container.querySelectorAll(`[data-key="${key}"]`).forEach((cell) => {
      cell.style.width = `${width}px`;
      cell.style.minWidth = `${width}px`;
    });
  }

  function renderRows() {
    renderHeader();
    tbody.innerHTML = "";
    state.rows.forEach((row, rowIndex) => {
      const tr = document.createElement("tr");
      if (row.symbol && state.highlightSymbols.has(row.symbol)) {
        tr.classList.add("row-highlight");
      }
      const rowNum = document.createElement("td");
      rowNum.className = "rownum";
      rowNum.textContent = rowIndex + 1;
      tr.append(rowNum);

      visibleColumns().forEach((key) => {
        const td = document.createElement("td");
        td.dataset.row = rowIndex;
        td.dataset.key = key;
        td.className = classForColumn(key, row);
        const label = key === "symbol" ? "Symbol" : key === "status" ? "Status" : key === "note" ? "Note" : fieldByKey[key]?.label || key;
        const width = state.columnWidths[key] || defaultColumnWidth(key, label);
        td.style.width = `${width}px`;
        td.style.minWidth = `${width}px`;
        td.textContent = displayValue(row, key);
        if (key === "symbol") {
          td.contentEditable = "true";
          td.addEventListener("input", handleSymbolEdit);
          td.addEventListener("paste", handleCellPaste);
          td.addEventListener("focus", () => {
            state.activeCell = td;
          });
        }
        tr.append(td);
      });

      tbody.append(tr);
    });
    updateSummary();
  }

  function renderFieldPanel() {
    fieldGroupsEl.innerHTML = fieldGroups
      .map(
        (group) => `
          <fieldset>
            <legend>${group.name}</legend>
            ${group.fields
              .map(
                (field) => `
                  <label class="field-check">
                    <input type="checkbox" value="${field.key}" ${state.visibleFields.includes(field.key) ? "checked" : ""}>
                    <span>${field.label}</span>
                  </label>
                `
              )
              .join("")}
          </fieldset>
        `
      )
      .join("");
    updateFieldCount();

    fieldGroupsEl.querySelectorAll("input[type='checkbox']").forEach((checkbox) => {
      checkbox.addEventListener("change", () => {
        const selected = [...fieldGroupsEl.querySelectorAll("input[type='checkbox']:checked")].map((item) => item.value);
        state.visibleFields = selected.length ? selected : ["name"];
        saveVisibleFields(state.visibleFields);
        schedulePersist();
        renderRows();
        updateFieldCount();
      });
    });
  }

  function updateFieldCount() {
    fieldCount.textContent = `已选择 ${state.visibleFields.length}/${fieldDefs.length} 个字段`;
  }

  function setStatus(message, type = "") {
    statusEl.textContent = message;
    statusEl.className = type;
  }

  function updateSummary() {
    const symbols = state.rows.filter((row) => row.symbol).length;
    const ok = state.rows.filter((row) => row.status === "ok").length;
    const errors = state.rows.filter((row) => row.status === "error").length;
    summaryEl.textContent = `${symbols} 个代码 · ${ok} 成功 · ${errors} 失败 · ${state.visibleFields.length} 字段 · ${state.history.length} 历史`;
  }

  function handleSymbolEdit(event) {
    const row = state.rows[Number(event.currentTarget.dataset.row)];
    row.symbol = event.currentTarget.textContent.trim().toUpperCase();
    row.status = "";
    row.note = "";
    schedulePersist();
    updateSummary();
  }

  function handleCellPaste(event) {
    const symbols = parseSymbols(event.clipboardData.getData("text"));
    if (symbols.length <= 1) return;
    event.preventDefault();
    pushHistory("粘贴代码");
    const start = Number(event.currentTarget.dataset.row);
    ensureRowCount(state.rows, start + symbols.length);
    symbols.forEach((symbol, index) => {
      state.rows[start + index] = blankRow(symbol);
    });
    schedulePersist();
    renderRows();
  }

  function applyResult(result) {
    state.rows.forEach((row, index) => {
      if (row.symbol !== result.symbol) return;
      if (result.status !== "ok") {
        state.rows[index] = { ...row, status: "error", note: result.error || result.hint || "查询失败" };
        return;
      }
      state.rows[index] = {
        ...row,
        ...result,
        status: "ok",
        note: result.cache === "hit" ? "cache hit" : result.cache === "stale" ? `stale cache: ${result.warning || ""}` : "fetched"
      };
    });
  }

  async function fetchRows(forceRefresh = false) {
    const symbols = [...new Set(state.rows.map((row) => row.symbol.trim().toUpperCase()).filter(Boolean))];
    if (!symbols.length) {
      setStatus("没有可查询的股票代码。", "error");
      return;
    }

    state.rows.forEach((row) => {
      if (row.symbol) {
        row.status = "loading";
        row.note = forceRefresh ? "refreshing" : "querying";
      }
    });
    renderRows();
    setButtonsDisabled(true);
    setStatus(`正在查询 ${symbols.length} 个代码...`);
    setProgress(0, symbols.length, "准备开始");

    try {
      const results = await fetchSymbolsConcurrent(symbols, forceRefresh);
      schedulePersist();
      renderRows();
      const ok = results.filter((item) => item.status === "ok").length;
      const hit = results.filter((item) => item.cache === "hit").length;
      setStatus(`完成：${ok}/${results.length} 成功，${hit} 个来自缓存。`, ok ? "ok" : "error");
    } catch (error) {
      state.rows.forEach((row) => {
        if (row.status === "loading") {
          row.status = "error";
          row.note = error.message || String(error);
        }
      });
      renderRows();
      setStatus(error.message || String(error), "error");
    } finally {
      setButtonsDisabled(false);
      window.setTimeout(() => {
        progressWrap.hidden = true;
      }, 1200);
    }
  }

  async function fetchSymbolsConcurrent(symbols, forceRefresh) {
    const concurrency = clampNumber(Number(context.settings?.concurrency || 4), 1, 20);
    const requestId = `stock-${Date.now()}-${Math.random().toString(16).slice(2)}`;
    const unlisten = context.backendReady
      ? await listen("stock-query-progress", (event) => {
          const progress = event.payload || {};
          if (progress.requestId !== requestId) return;
          const labelSymbol = progress.symbol ? `${progress.symbol} ` : "";
          setProgress(
            progress.done || 0,
            progress.total || symbols.length,
            `${labelSymbol}${progress.status || "完成"} · 并发 ${progress.concurrency || concurrency}`
          );
        })
      : null;

    try {
      setProgress(0, symbols.length, `批量查询已提交 · 并发 ${concurrency}`);
      const data = await context.invoke("fetch_stock_batch", { symbols, refresh: forceRefresh, requestId });
      const results = data.results || [];
      results.forEach(applyResult);
      renderRows();
      setProgress(results.length, symbols.length, `查询完成 · 并发 ${concurrency}`);
      return results;
    } finally {
      if (unlisten) unlisten();
    }
  }

  function setProgress(done, total, label) {
    progressWrap.hidden = false;
    progressText.textContent = `${done}/${total}`;
    progressCurrent.textContent = label || "";
    progressBar.style.width = total ? `${Math.round((done / total) * 100)}%` : "0%";
  }

  function setButtonsDisabled(disabled) {
    Object.entries(buttons).forEach(([key, button]) => {
      if (key === "fieldConfig" || key === "closeFields" || key === "selectAllFields" || key === "resetFields") return;
      button.disabled = disabled;
    });
  }

  async function exportCsv() {
    const exportColumns = visibleColumns();
    const exportHeaders = exportColumns.map((key) =>
      key === "symbol" ? "Symbol" : key === "status" ? "Status" : key === "note" ? "Note" : fieldByKey[key]?.label || key
    );
    const lines = [exportHeaders, ...state.rows.filter((row) => row.symbol).map((row) => exportColumns.map((key) => rawExportValue(row, key)))]
      .map((line) => line.map(csvEscape).join(","));
    const content = "\uFEFF" + lines.join("\r\n");
    const filename = `stock-meta-${new Date().toISOString().slice(0, 10)}.csv`;

    if (context.backendReady) {
      try {
        const path = await context.invoke("export_csv", { filename, content });
        setStatus(`CSV 已导出：${path}`, "ok");
      } catch (error) {
        setStatus(error.message || String(error), "error");
      }
      return;
    }

    const blob = new Blob([content], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    document.body.append(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
    setStatus("CSV 已导出。", "ok");
  }

  buttons.loadSymbols.addEventListener("click", () => {
    const symbols = parseSymbols(bulkInput.value);
    pushHistory("填入表格");
    state.rows = rowsFromSymbols(symbols);
    state.highlightSymbols = new Set(symbols);
    schedulePersist();
    renderRows();
    setStatus(`已填入 ${symbols.length} 个代码。`);
  });
  buttons.appendSymbols.addEventListener("click", () => {
    const symbols = parseSymbols(bulkInput.value);
    const existing = new Set(state.rows.map((row) => row.symbol).filter(Boolean));
    const additions = symbols.filter((symbol) => !existing.has(symbol));
    if (!additions.length) {
      setStatus("没有可追加的新代码。");
      return;
    }
    pushHistory("追加代码");
    trimTrailingBlankRows(state.rows);
    additions.forEach((symbol) => state.rows.push(blankRow(symbol)));
    ensureRowCount(state.rows, Math.max(20, state.rows.length));
    state.highlightSymbols = new Set(additions);
    schedulePersist();
    renderRows();
    setStatus(`已追加 ${additions.length} 个新代码。`, "ok");
  });
  buttons.fetchAll.addEventListener("click", () => fetchRows(false));
  buttons.refreshRows.addEventListener("click", () => fetchRows(true));
  buttons.fieldConfig.addEventListener("click", () => {
    fieldPanel.hidden = !fieldPanel.hidden;
  });
  buttons.closeFields.addEventListener("click", () => {
    fieldPanel.hidden = true;
  });
  buttons.selectAllFields.addEventListener("click", () => {
    state.visibleFields = fieldDefs.map((field) => field.key);
    saveVisibleFields(state.visibleFields);
    schedulePersist();
    renderFieldPanel();
    renderRows();
  });
  buttons.resetFields.addEventListener("click", () => {
    state.visibleFields = [...defaultVisibleFields];
    saveVisibleFields(state.visibleFields);
    schedulePersist();
    renderFieldPanel();
    renderRows();
  });
  buttons.addRows.addEventListener("click", () => {
    pushHistory("加 10 行");
    ensureRowCount(state.rows, state.rows.length + 10);
    schedulePersist();
    renderRows();
  });
  buttons.clearTable.addEventListener("click", () => {
    pushHistory("清空");
    state.rows = rowsFromSymbols([]);
    state.highlightSymbols = new Set();
    schedulePersist();
    renderRows();
    setStatus("已清空。");
  });
  buttons.exportCsv.addEventListener("click", exportCsv);
  buttons.undoTable.addEventListener("click", () => {
    const snapshot = state.history.shift();
    if (!snapshot) {
      setStatus("没有可恢复的历史。");
      return;
    }
    state.rows = normalizeRows(snapshot.rows);
    state.highlightSymbols = new Set();
    schedulePersist();
    renderRows();
    setStatus(`已恢复：${snapshot.label || "历史记录"}`, "ok");
  });

  bulkInput.addEventListener("input", () => {
    state.bulkInput = bulkInput.value;
    schedulePersist();
  });

  container.addEventListener("keydown", (event) => {
    if (event.key !== "Enter" || !state.activeCell) return;
    event.preventDefault();
    const row = Number(state.activeCell.dataset.row);
    pushHistory("新增行");
    ensureRowCount(state.rows, row + 2);
    schedulePersist();
    renderRows();
    const next = tbody.querySelector(`[data-row="${row + 1}"][data-key="symbol"]`);
    if (next) next.focus();
  });

  renderFieldPanel();
  renderRows();
  hydratePersistedState();

  async function hydratePersistedState() {
    if (!context.backendReady) return;
    try {
      const persisted = await context.invoke("load_app_state", { appId: APP_STATE_ID });
      if (!persisted || typeof persisted !== "object") return;
      if (Array.isArray(persisted.rows)) {
        state.rows = normalizeRows(persisted.rows);
      }
      if (typeof persisted.bulkInput === "string") {
        state.bulkInput = persisted.bulkInput;
        bulkInput.value = persisted.bulkInput;
      }
      if (Array.isArray(persisted.visibleFields)) {
        const valid = persisted.visibleFields.filter((key) => fieldByKey[key]);
        if (valid.length) {
          state.visibleFields = ensureFinancialHighlights(valid);
          saveVisibleFields(state.visibleFields);
        }
      }
      state.history = normalizeHistory(persisted.history);
      if (persisted.columnWidths && typeof persisted.columnWidths === "object") {
        state.columnWidths = normalizeColumnWidths(persisted.columnWidths);
      }
      state.highlightSymbols = new Set();
      state.loadedRemoteState = true;
      renderFieldPanel();
      renderRows();
      setStatus("已恢复上次保存的数据。", "ok");
    } catch (error) {
      setStatus(`读取持久化数据失败：${error.message || String(error)}`, "error");
    }
  }

  function schedulePersist() {
    window.clearTimeout(state.saveTimer);
    state.saveTimer = window.setTimeout(() => {
      persistState();
    }, 250);
  }

  async function persistState() {
    const payload = {
      version: 1,
      savedAt: new Date().toISOString(),
      rows: state.rows,
      visibleFields: state.visibleFields,
      bulkInput: state.bulkInput,
      history: state.history,
      columnWidths: state.columnWidths
    };

    localStorage.setItem(STATE_STORAGE_KEY, JSON.stringify(payload));
    if (!context.backendReady) return;

    try {
      await context.invoke("save_app_state", { appId: APP_STATE_ID, state: payload });
    } catch (error) {
      setStatus(`保存持久化数据失败：${error.message || String(error)}`, "error");
    }
  }

  function pushHistory(label) {
    state.history.unshift({
      label,
      savedAt: new Date().toISOString(),
      rows: cloneRows(state.rows)
    });
    state.history = state.history.slice(0, 20);
  }
}

function blankRow(symbol = "") {
  return {
    symbol,
    name: "",
    exchange: "",
    sector: "",
    industry: "",
    epsForward: null,
    peForward: null,
    divRate: null,
    divYield: null,
    shortInterest: null,
    marketCap: null,
    volume: null,
    previousClose: null,
    currentPrice: null,
    open: null,
    dayHigh: null,
    dayLow: null,
    fiftyTwoWeekHigh: null,
    fiftyTwoWeekLow: null,
    beta: null,
    sharesOutstanding: null,
    floatShares: null,
    averageVolume: null,
    targetMeanPrice: null,
    recommendation: "",
    bookValue: null,
    priceToBook: null,
    debtToEquity: null,
    revenueGrowth: null,
    grossMargins: null,
    operatingMargins: null,
    profitMargins: null,
    returnOnAssets: null,
    returnOnEquity: null,
    totalRevenue: null,
    netIncomeToCommon: null,
    trailingEps: null,
    totalCash: null,
    totalDebt: null,
    leveredFreeCashFlow: null,
    status: "",
    note: ""
  };
}

function rowsFromSymbols(symbols) {
  const rows = symbols.map((symbol) => blankRow(symbol));
  ensureRowCount(rows, 20);
  return rows;
}

function normalizeRows(rows) {
  const normalized = rows
    .filter((row) => row && typeof row === "object")
    .map((row) => ({ ...blankRow(), ...row, symbol: String(row.symbol || "").toUpperCase() }));
  ensureRowCount(normalized, 20);
  return normalized;
}

function cloneRows(rows) {
  return rows.map((row) => ({ ...row }));
}

function normalizeHistory(history) {
  if (!Array.isArray(history)) return [];
  return history
    .filter((item) => item && typeof item === "object" && Array.isArray(item.rows))
    .slice(0, 20)
    .map((item) => ({
      label: String(item.label || "历史记录"),
      savedAt: String(item.savedAt || ""),
      rows: cloneRows(normalizeRows(item.rows))
    }));
}

function normalizeColumnWidths(widths) {
  if (!widths || typeof widths !== "object") return {};
  return Object.fromEntries(
    Object.entries(widths)
      .filter(([key, value]) => (key === "symbol" || key === "status" || key === "note" || fieldByKey[key]) && Number.isFinite(Number(value)))
      .map(([key, value]) => [key, Math.max(72, Math.min(420, Math.round(Number(value))))])
  );
}

function defaultColumnWidth(key, label) {
  const titleWidth = String(label).length * 8 + 34;
  if (key === "symbol") return Math.max(116, titleWidth);
  if (key === "name") return Math.max(220, titleWidth);
  if (key === "sector" || key === "industry") return Math.max(180, titleWidth);
  if (key === "status") return Math.max(130, titleWidth);
  if (key === "note") return Math.max(260, titleWidth);
  if (fieldByKey[key]?.type === "text") return Math.max(128, titleWidth);
  return Math.max(118, titleWidth);
}

function trimTrailingBlankRows(rows) {
  while (rows.length && !rows[rows.length - 1].symbol) {
    rows.pop();
  }
}

function ensureRowCount(rows, count) {
  while (rows.length < count) rows.push(blankRow());
}

function parseSymbols(text) {
  return [...new Set(text.split(/[\s,;，；]+/).map((item) => item.trim().toUpperCase()).filter(Boolean))];
}

function loadLocalState() {
  try {
    const saved = JSON.parse(localStorage.getItem(STATE_STORAGE_KEY) || "null");
    if (!saved || typeof saved !== "object") return null;
    return {
      rows: Array.isArray(saved.rows) ? normalizeRows(saved.rows) : null,
      visibleFields: Array.isArray(saved.visibleFields) ? ensureFinancialHighlights(saved.visibleFields.filter((key) => fieldByKey[key])) : null,
      bulkInput: typeof saved.bulkInput === "string" ? saved.bulkInput : null,
      history: normalizeHistory(saved.history),
      columnWidths: normalizeColumnWidths(saved.columnWidths)
    };
  } catch {
    return null;
  }
}

function loadVisibleFields() {
  try {
    const saved = JSON.parse(localStorage.getItem(FIELD_STORAGE_KEY) || "null");
    if (Array.isArray(saved)) {
      const valid = saved.filter((key) => fieldByKey[key]);
      if (valid.length) return ensureFinancialHighlights(valid);
    }
  } catch {
    // Ignore invalid user configuration.
  }
  return [...defaultVisibleFields];
}

function saveVisibleFields(fields) {
  localStorage.setItem(FIELD_STORAGE_KEY, JSON.stringify(fields));
}

function ensureFinancialHighlights(fields) {
  const next = [...fields];
  financialHighlightFields.forEach((key) => {
    if (!next.includes(key)) next.push(key);
  });
  return next;
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll("\"", "&quot;");
}

function classForColumn(key, row) {
  const classes = [key];
  if (key === "symbol") classes.push("symbol");
  if (key === "status") classes.push("status");
  if (key === "note") classes.push("note");
  if (fieldByKey[key]?.className) classes.push(fieldByKey[key].className);
  if (key === "status") {
    if (row.status === "loading") classes.push("cell-loading");
    if (row.status === "ok") classes.push("cell-ok");
    if (row.status === "error") classes.push("cell-error");
  }
  return classes.join(" ");
}

function displayValue(row, key) {
  if (key === "symbol" || key === "status" || key === "note") return row[key] ?? "";
  const field = fieldByKey[key];
  if (!field) return row[key] ?? "";
  if (field.type === "percent") return fmtPercent(row[key]);
  if (field.type === "currency") return fmtCurrency(row[key]);
  if (field.type === "largeNumber") return fmtLargeNumber(row[key]);
  if (field.type === "integer") return fmtInteger(row[key]);
  if (field.type === "number") return fmtNumber(row[key]);
  return row[key] ?? "";
}

function rawExportValue(row, key) {
  const field = fieldByKey[key];
  if (field?.type === "percent") return Number.isFinite(row[key]) ? row[key] * 100 : "";
  return row[key] ?? "";
}

function fmtNumber(value) {
  return Number.isFinite(value) ? decimal.format(value) : "";
}

function fmtInteger(value) {
  return Number.isFinite(value) ? integer.format(value) : "";
}

function fmtPercent(value) {
  return Number.isFinite(value) ? `${decimal.format(value * 100)}%` : "";
}

function fmtCurrency(value) {
  return Number.isFinite(value) ? compactCurrency.format(value) : "";
}

function fmtLargeNumber(value) {
  return Number.isFinite(value) ? compactCurrency.format(value).replace("$", "") : "";
}

function csvEscape(value) {
  const text = String(value ?? "");
  if (/[",\r\n]/.test(text)) return `"${text.replaceAll("\"", "\"\"")}"`;
  return text;
}

function clampNumber(value, min, max) {
  if (!Number.isFinite(value)) return min;
  return Math.max(min, Math.min(max, Math.round(value)));
}
