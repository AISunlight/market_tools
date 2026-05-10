const http = require("node:http");
const fs = require("node:fs");
const net = require("node:net");
const path = require("node:path");
const tls = require("node:tls");

const PORT = Number(process.env.PORT || 5173);
const ROOT = __dirname;
const CACHE_DIR = path.join(ROOT, "cache");
const CACHE_FILE = path.join(CACHE_DIR, "stock-meta-cache.json");
const CACHE_TTL_MS = Number(process.env.YAHOO_CACHE_TTL_HOURS || 12) * 60 * 60 * 1000;
const YAHOO_PROXY_URL = process.env.YAHOO_PROXY_URL || "http://127.0.0.1:7897";
const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

let yahooSession = {
  cookie: "",
  crumb: "",
  expiresAt: 0
};

let stockCache = loadStockCache();

process.on("uncaughtException", (error) => {
  console.error("Uncaught exception:", error);
});

process.on("unhandledRejection", (error) => {
  console.error("Unhandled rejection:", error);
});

function sendJson(res, status, body) {
  const data = JSON.stringify(body);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store"
  });
  res.end(data);
}

function sendText(res, status, body, contentType = "text/plain; charset=utf-8") {
  res.writeHead(status, { "Content-Type": contentType });
  res.end(body);
}

function loadStockCache() {
  try {
    if (!fs.existsSync(CACHE_FILE)) return {};
    return JSON.parse(fs.readFileSync(CACHE_FILE, "utf8"));
  } catch (error) {
    console.error("Cache read failed:", error.message);
    return {};
  }
}

function saveStockCache() {
  fs.mkdirSync(CACHE_DIR, { recursive: true });
  fs.writeFileSync(CACHE_FILE, JSON.stringify(stockCache, null, 2));
}

function isValidSymbol(symbol) {
  return /^[A-Z0-9.\-=^]{1,24}$/.test(symbol);
}

function parseJsonBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", (chunk) => {
      chunks.push(chunk);
      if (Buffer.concat(chunks).length > 1024 * 1024) {
        reject(new Error("请求体太大。"));
        req.destroy();
      }
    });
    req.on("end", () => {
      try {
        const text = Buffer.concat(chunks).toString("utf8") || "{}";
        resolve(JSON.parse(text));
      } catch {
        reject(new Error("JSON 格式不正确。"));
      }
    });
    req.on("error", reject);
  });
}

function mergeCookies(headers) {
  const setCookie = headers.getSetCookie ? headers.getSetCookie() : [];
  return setCookie.map((item) => item.split(";")[0]).join("; ");
}

async function yahooFetch(url, extraHeaders = {}) {
  const headers = {
    "User-Agent": UA,
    Accept: "application/json,text/plain,*/*",
    ...extraHeaders
  };

  if (!YAHOO_PROXY_URL || YAHOO_PROXY_URL.toLowerCase() === "direct") {
    return fetch(url, { headers });
  }

  return requestThroughHttpProxy(url, headers);
}

function parseHeaderBlock(headerText) {
  const lines = headerText.split("\r\n");
  const statusLine = lines.shift() || "";
  const statusMatch = statusLine.match(/^HTTP\/\d(?:\.\d)?\s+(\d+)/);
  const status = statusMatch ? Number(statusMatch[1]) : 0;
  const headerMap = new Map();
  const setCookie = [];

  for (const line of lines) {
    const index = line.indexOf(":");
    if (index === -1) continue;
    const name = line.slice(0, index).trim().toLowerCase();
    const value = line.slice(index + 1).trim();
    if (name === "set-cookie") setCookie.push(value);
    headerMap.set(name, headerMap.has(name) ? `${headerMap.get(name)}, ${value}` : value);
  }

  return {
    status,
    get(name) {
      return headerMap.get(String(name).toLowerCase()) || null;
    },
    getSetCookie() {
      return setCookie;
    }
  };
}

function splitHeadersAndBody(buffer) {
  const marker = Buffer.from("\r\n\r\n");
  const index = buffer.indexOf(marker);
  if (index === -1) return null;
  return {
    headers: buffer.slice(0, index).toString("latin1"),
    body: buffer.slice(index + marker.length)
  };
}

function decodeChunked(buffer) {
  let offset = 0;
  const chunks = [];

  while (offset < buffer.length) {
    const lineEnd = buffer.indexOf("\r\n", offset, "latin1");
    if (lineEnd === -1) break;
    const sizeText = buffer.slice(offset, lineEnd).toString("latin1").split(";")[0];
    const size = Number.parseInt(sizeText, 16);
    if (!Number.isFinite(size) || size < 0) break;
    offset = lineEnd + 2;
    if (size === 0) break;
    chunks.push(buffer.slice(offset, offset + size));
    offset += size + 2;
  }

  return Buffer.concat(chunks);
}

function normalizeProxyUrl() {
  const proxy = new URL(YAHOO_PROXY_URL);
  if (proxy.protocol !== "http:") {
    throw new Error("当前小工具只支持 http:// 类型的 Clash 代理。");
  }
  return proxy;
}

function requestThroughHttpProxy(targetUrl, headers) {
  return new Promise((resolve, reject) => {
    const target = new URL(targetUrl);
    const proxy = normalizeProxyUrl();
    const proxyPort = Number(proxy.port || 80);
    const socket = net.connect(proxyPort, proxy.hostname);
    const chunks = [];
    let settled = false;

    const fail = (error) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      reject(error);
    };

    socket.setTimeout(30000, () => fail(new Error("连接 Clash 代理超时。")));
    socket.on("error", fail);
    socket.once("connect", () => {
      socket.write(
        `CONNECT ${target.hostname}:443 HTTP/1.1\r\n` +
          `Host: ${target.hostname}:443\r\n` +
          "Proxy-Connection: keep-alive\r\n\r\n"
      );
    });

    let connectBuffer = Buffer.alloc(0);
    const onConnectData = (chunk) => {
      connectBuffer = Buffer.concat([connectBuffer, chunk]);
      const split = splitHeadersAndBody(connectBuffer);
      if (!split) return;

      const connectHeaders = parseHeaderBlock(split.headers);
      socket.off("data", onConnectData);

      if (connectHeaders.status !== 200) {
        fail(new Error(`Clash CONNECT 返回 ${connectHeaders.status}。`));
        return;
      }

      const secureSocket = tls.connect({
        socket,
        servername: target.hostname
      });

      secureSocket.setTimeout(30000, () => fail(new Error("Yahoo 请求超时。")));
      secureSocket.on("error", fail);
      secureSocket.on("data", (data) => chunks.push(data));
      secureSocket.once("end", () => {
        if (settled) return;
        settled = true;
        const responseBuffer = Buffer.concat(chunks);
        const responseSplit = splitHeadersAndBody(responseBuffer);
        if (!responseSplit) {
          reject(new Error("Yahoo 返回格式不完整。"));
          return;
        }

        const parsedHeaders = parseHeaderBlock(responseSplit.headers);
        const isChunked = /chunked/i.test(parsedHeaders.get("transfer-encoding") || "");
        const bodyBuffer = isChunked ? decodeChunked(responseSplit.body) : responseSplit.body;
        const text = bodyBuffer.toString("utf8");

        resolve({
          ok: parsedHeaders.status >= 200 && parsedHeaders.status < 300,
          status: parsedHeaders.status,
          headers: parsedHeaders,
          text: async () => text,
          json: async () => JSON.parse(text)
        });
      });

      const requestHeaders = {
        Host: target.hostname,
        Connection: "close",
        ...headers
      };
      const headerLines = Object.entries(requestHeaders)
        .filter(([, value]) => value !== undefined && value !== null)
        .map(([name, value]) => `${name}: ${value}`)
        .join("\r\n");

      secureSocket.write(`GET ${target.pathname}${target.search} HTTP/1.1\r\n${headerLines}\r\n\r\n`);
    };

    socket.on("data", onConnectData);
  });
}

async function getYahooSession() {
  if (yahooSession.cookie && yahooSession.crumb && Date.now() < yahooSession.expiresAt) {
    return yahooSession;
  }

  const cookieResponse = await yahooFetch("https://fc.yahoo.com", {
    Accept: "text/html,application/xhtml+xml"
  });
  const cookie = mergeCookies(cookieResponse.headers);

  if (!cookie) {
    throw new Error("Yahoo 没有返回可用 cookie。");
  }

  const crumbResponse = await yahooFetch("https://query1.finance.yahoo.com/v1/test/getcrumb", {
    Cookie: cookie,
    Accept: "text/plain,*/*"
  });
  const crumb = (await crumbResponse.text()).trim();

  if (!crumbResponse.ok || crumb.startsWith("<")) {
    throw new Error("Yahoo crumb 获取失败，可能是当前网络区域被 Yahoo 限制。");
  }

  yahooSession = {
    cookie,
    crumb,
    expiresAt: Date.now() + 30 * 60 * 1000
  };
  return yahooSession;
}

function raw(value) {
  if (value && typeof value === "object" && "raw" in value) return value.raw;
  if (value && typeof value === "object") return null;
  return value;
}

function numberOrNull(value) {
  const n = raw(value);
  return Number.isFinite(n) ? n : null;
}

function pickSummary(data) {
  return data?.quoteSummary?.result?.[0] || {};
}

async function getSummary(symbol) {
  const session = await getYahooSession();
  const modules = [
    "assetProfile",
    "summaryDetail",
    "defaultKeyStatistics",
    "financialData",
    "price"
  ].join(",");
  const url =
    `https://query1.finance.yahoo.com/v10/finance/quoteSummary/${encodeURIComponent(symbol)}` +
    `?modules=${modules}&crumb=${encodeURIComponent(session.crumb)}`;

  const response = await yahooFetch(url, { Cookie: session.cookie });
  const text = await response.text();

  if (!response.ok) {
    let message = `Yahoo quoteSummary 返回 ${response.status}`;
    try {
      const parsed = JSON.parse(text);
      message = parsed?.finance?.error?.description || message;
    } catch {
      if (text.includes("Yahoo’s suite of services will no longer be accessible from mainland China")) {
        message = "Yahoo 当前网络区域不可访问。";
      }
    }
    throw new Error(message);
  }

  return JSON.parse(text);
}

async function getChartMeta(symbol) {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}`;
  const response = await yahooFetch(url);
  if (!response.ok) return {};
  const data = await response.json();
  return data?.chart?.result?.[0]?.meta || {};
}

function normalizeStockData(symbol, summaryData, chartMeta) {
  const summary = pickSummary(summaryData);
  if (!summary.price && !summary.assetProfile) {
    throw new Error("没有找到这个代码的数据。");
  }

  const profile = summary.assetProfile || {};
  const detail = summary.summaryDetail || {};
  const stats = summary.defaultKeyStatistics || {};
  const financial = summary.financialData || {};
  const price = summary.price || {};

  return {
    symbol,
    name: raw(price.longName) || raw(price.shortName) || symbol,
    exchange: raw(price.exchangeName) || raw(price.exchange) || chartMeta.exchangeName || "",
    sector: profile.sector || null,
    industry: profile.industry || null,
    epsForward: numberOrNull(stats.forwardEps) ?? numberOrNull(financial.forwardEps),
    peForward: numberOrNull(detail.forwardPE) ?? numberOrNull(stats.forwardPE),
    divRate: numberOrNull(detail.dividendRate),
    divYield: numberOrNull(detail.dividendYield),
    shortInterest: numberOrNull(stats.shortPercentOfFloat),
    marketCap: numberOrNull(price.marketCap),
    volume: numberOrNull(price.regularMarketVolume) ?? numberOrNull(chartMeta.regularMarketVolume),
    previousClose: numberOrNull(detail.previousClose) ?? numberOrNull(chartMeta.previousClose),
    fetchedAt: new Date().toISOString()
  };
}

async function fetchStockMeta(symbol) {
  const [summaryData, chartMeta] = await Promise.all([
    getSummary(symbol),
    getChartMeta(symbol).catch(() => ({}))
  ]);
  return normalizeStockData(symbol, summaryData, chartMeta);
}

async function getStockCached(symbol, forceRefresh = false) {
  const cleanSymbol = symbol.trim().toUpperCase();
  if (!isValidSymbol(cleanSymbol)) {
    return { symbol: cleanSymbol, status: "error", error: "股票代码格式不正确。" };
  }

  const cached = stockCache[cleanSymbol];
  const now = Date.now();
  if (!forceRefresh && cached?.data && now - cached.cachedAt < CACHE_TTL_MS) {
    return { ...cached.data, status: "ok", cache: "hit", cachedAt: cached.cachedAt };
  }

  try {
    const data = await fetchStockMeta(cleanSymbol);
    stockCache[cleanSymbol] = {
      cachedAt: now,
      data
    };
    saveStockCache();
    return { ...data, status: "ok", cache: "miss", cachedAt: now };
  } catch (error) {
    if (cached?.data) {
      return {
        ...cached.data,
        status: "ok",
        cache: "stale",
        cachedAt: cached.cachedAt,
        warning: error.message || "Yahoo 查询失败，已使用旧缓存。"
      };
    }

    return {
      symbol: cleanSymbol,
      status: "error",
      cache: "none",
      error: error.message || "Yahoo 查询失败。",
      proxy: YAHOO_PROXY_URL || "direct",
      hint:
        "确认 Clash 对 query1.finance.yahoo.com、query2.finance.yahoo.com、fc.yahoo.com 走代理节点，" +
        "或用 YAHOO_PROXY_URL=http://127.0.0.1:你的端口 指定 Clash HTTP/mixed 端口。"
    };
  }
}

async function handleStock(req, res, symbol) {
  const result = await getStockCached(symbol, new URL(req.url, `http://${req.headers.host}`).searchParams.get("refresh") === "1");
  sendJson(res, result.status === "ok" ? 200 : 502, result);
}

async function handleBatch(req, res) {
  try {
    const body = await parseJsonBody(req);
    const symbols = Array.isArray(body.symbols) ? body.symbols : [];
    const uniqueSymbols = [...new Set(symbols.map((item) => String(item).trim().toUpperCase()).filter(Boolean))];
    const limitedSymbols = uniqueSymbols.slice(0, 200);
    const forceRefresh = body.refresh === true;
    const results = [];

    for (const symbol of limitedSymbols) {
      results.push(await getStockCached(symbol, forceRefresh));
    }

    sendJson(res, 200, {
      results,
      count: results.length,
      cacheTtlHours: CACHE_TTL_MS / 60 / 60 / 1000
    });
  } catch (error) {
    sendJson(res, 400, { error: error.message || "批量请求失败。" });
  }
}

function serveStatic(req, res) {
  const pathname = new URL(req.url, `http://${req.headers.host}`).pathname;
  const filePath = pathname === "/" ? path.join(ROOT, "index.html") : path.join(ROOT, pathname);
  const resolved = path.resolve(filePath);

  if (!resolved.startsWith(ROOT)) {
    sendText(res, 403, "Forbidden");
    return;
  }

  fs.readFile(resolved, (error, data) => {
    if (error) {
      sendText(res, 404, "Not found");
      return;
    }

    const ext = path.extname(resolved).toLowerCase();
    const contentType = ext === ".html" ? "text/html; charset=utf-8" : "application/octet-stream";
    res.writeHead(200, { "Content-Type": contentType });
    res.end(data);
  });
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const stockMatch = url.pathname.match(/^\/api\/stock\/([^/]+)$/);

  if (req.method === "GET" && stockMatch) {
    handleStock(req, res, decodeURIComponent(stockMatch[1]));
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/stocks") {
    handleBatch(req, res);
    return;
  }

  if (req.method === "GET") {
    serveStatic(req, res);
    return;
  }

  sendText(res, 405, "Method not allowed");
});

server.listen(PORT, () => {
  console.log(`Stock meta app: http://localhost:${PORT}`);
});
