use chrono::Utc;
use reqwest::{Client, Proxy};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::HashMap;
use std::fs;
use std::path::PathBuf;
use std::time::{Duration, SystemTime, UNIX_EPOCH};
use tauri::{AppHandle, Manager};

const USER_AGENT: &str = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct AppSettings {
    network_mode: String,
    proxy_url: String,
    cache_ttl_hours: u64,
    concurrency: u64,
}

impl Default for AppSettings {
    fn default() -> Self {
        Self {
            network_mode: "proxy".to_string(),
            proxy_url: "http://127.0.0.1:7897".to_string(),
            cache_ttl_hours: 12,
            concurrency: 4,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct StockData {
    symbol: String,
    name: String,
    exchange: String,
    sector: Option<String>,
    industry: Option<String>,
    eps_forward: Option<f64>,
    pe_forward: Option<f64>,
    div_rate: Option<f64>,
    div_yield: Option<f64>,
    short_interest: Option<f64>,
    market_cap: Option<f64>,
    volume: Option<f64>,
    previous_close: Option<f64>,
    current_price: Option<f64>,
    open: Option<f64>,
    day_high: Option<f64>,
    day_low: Option<f64>,
    fifty_two_week_high: Option<f64>,
    fifty_two_week_low: Option<f64>,
    beta: Option<f64>,
    shares_outstanding: Option<f64>,
    float_shares: Option<f64>,
    average_volume: Option<f64>,
    target_mean_price: Option<f64>,
    recommendation: Option<String>,
    book_value: Option<f64>,
    price_to_book: Option<f64>,
    debt_to_equity: Option<f64>,
    revenue_growth: Option<f64>,
    gross_margins: Option<f64>,
    operating_margins: Option<f64>,
    profit_margins: Option<f64>,
    return_on_assets: Option<f64>,
    return_on_equity: Option<f64>,
    total_revenue: Option<f64>,
    net_income_to_common: Option<f64>,
    trailing_eps: Option<f64>,
    total_cash: Option<f64>,
    total_debt: Option<f64>,
    levered_free_cash_flow: Option<f64>,
    fetched_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct CacheEntry {
    cached_at: u64,
    data: StockData,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct StockResult {
    symbol: String,
    name: Option<String>,
    exchange: Option<String>,
    sector: Option<String>,
    industry: Option<String>,
    eps_forward: Option<f64>,
    pe_forward: Option<f64>,
    div_rate: Option<f64>,
    div_yield: Option<f64>,
    short_interest: Option<f64>,
    market_cap: Option<f64>,
    volume: Option<f64>,
    previous_close: Option<f64>,
    current_price: Option<f64>,
    open: Option<f64>,
    day_high: Option<f64>,
    day_low: Option<f64>,
    fifty_two_week_high: Option<f64>,
    fifty_two_week_low: Option<f64>,
    beta: Option<f64>,
    shares_outstanding: Option<f64>,
    float_shares: Option<f64>,
    average_volume: Option<f64>,
    target_mean_price: Option<f64>,
    recommendation: Option<String>,
    book_value: Option<f64>,
    price_to_book: Option<f64>,
    debt_to_equity: Option<f64>,
    revenue_growth: Option<f64>,
    gross_margins: Option<f64>,
    operating_margins: Option<f64>,
    profit_margins: Option<f64>,
    return_on_assets: Option<f64>,
    return_on_equity: Option<f64>,
    total_revenue: Option<f64>,
    net_income_to_common: Option<f64>,
    trailing_eps: Option<f64>,
    total_cash: Option<f64>,
    total_debt: Option<f64>,
    levered_free_cash_flow: Option<f64>,
    fetched_at: Option<String>,
    status: String,
    cache: String,
    cached_at: Option<u64>,
    error: Option<String>,
    hint: Option<String>,
    warning: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct BatchResult {
    results: Vec<StockResult>,
    count: usize,
    cache_ttl_hours: u64,
}

#[derive(Debug)]
struct YahooSession {
    cookie: String,
    crumb: String,
}

#[tauri::command]
fn get_settings(app: AppHandle) -> Result<AppSettings, String> {
    Ok(read_settings(&app))
}

#[tauri::command]
fn save_settings(app: AppHandle, settings: AppSettings) -> Result<AppSettings, String> {
    write_json(settings_path(&app)?, &settings)?;
    Ok(settings)
}

#[tauri::command]
async fn fetch_stock_batch(app: AppHandle, symbols: Vec<String>, refresh: bool) -> Result<BatchResult, String> {
    let settings = read_settings(&app);
    let mut cache = read_cache(&app)?;
    let client = build_client(&settings)?;
    let ttl_ms = settings.cache_ttl_hours.max(1) * 60 * 60 * 1000;
    let mut session: Option<YahooSession> = None;
    let mut results = Vec::new();

    let mut unique = Vec::new();
    for symbol in symbols {
        let clean = symbol.trim().to_uppercase();
        if !clean.is_empty() && !unique.contains(&clean) {
            unique.push(clean);
        }
        if unique.len() >= 200 {
            break;
        }
    }

    for symbol in unique {
        let result = get_stock_cached(
            &client,
            &settings,
            &mut cache,
            &mut session,
            symbol,
            refresh,
            ttl_ms,
        )
        .await;
        results.push(result);
    }

    write_json(cache_path(&app)?, &cache)?;
    Ok(BatchResult {
        count: results.len(),
        results,
        cache_ttl_hours: settings.cache_ttl_hours,
    })
}

#[tauri::command]
fn export_csv(app: AppHandle, filename: String, content: String) -> Result<String, String> {
    let downloads = app.path().download_dir().map_err(|error| error.to_string())?;
    let safe_name = sanitize_filename(&filename);
    let path = unique_path(downloads.join(safe_name));
    fs::write(&path, content.as_bytes()).map_err(|error| error.to_string())?;
    Ok(path.to_string_lossy().to_string())
}

#[tauri::command]
fn load_app_state(app: AppHandle, app_id: String) -> Result<Value, String> {
    let path = app_state_path(&app, &app_id)?;
    Ok(read_json(path).unwrap_or(Value::Null))
}

#[tauri::command]
fn save_app_state(app: AppHandle, app_id: String, state: Value) -> Result<(), String> {
    let path = app_state_path(&app, &app_id)?;
    write_json(path, &state)
}

async fn get_stock_cached(
    client: &Client,
    settings: &AppSettings,
    cache: &mut HashMap<String, CacheEntry>,
    session: &mut Option<YahooSession>,
    symbol: String,
    refresh: bool,
    ttl_ms: u64,
) -> StockResult {
    if !is_valid_symbol(&symbol) {
        return error_result(symbol, "股票代码格式不正确。".to_string(), settings);
    }

    let now = now_ms();
    if !refresh {
        if let Some(entry) = cache.get(&symbol) {
            if now.saturating_sub(entry.cached_at) < ttl_ms {
                return ok_result(symbol, entry.data.clone(), "hit", Some(entry.cached_at), None);
            }
        }
    }

    match fetch_stock_meta(client, session, &symbol).await {
        Ok(data) => {
            cache.insert(
                symbol.clone(),
                CacheEntry {
                    cached_at: now,
                    data: data.clone(),
                },
            );
            ok_result(symbol, data, "miss", Some(now), None)
        }
        Err(error) => {
            if let Some(entry) = cache.get(&symbol) {
                ok_result(symbol, entry.data.clone(), "stale", Some(entry.cached_at), Some(error))
            } else {
                error_result(symbol, error, settings)
            }
        }
    }
}

async fn fetch_stock_meta(client: &Client, session: &mut Option<YahooSession>, symbol: &str) -> Result<StockData, String> {
    if session.is_none() {
        *session = Some(get_yahoo_session(client).await?);
    }
    let session_ref = session.as_ref().ok_or("Yahoo session 初始化失败。")?;
    let modules = "assetProfile,summaryDetail,defaultKeyStatistics,financialData,price";
    let summary_url = format!(
        "https://query1.finance.yahoo.com/v10/finance/quoteSummary/{}?modules={}&crumb={}",
        urlencoding::encode(symbol),
        modules,
        urlencoding::encode(&session_ref.crumb)
    );

    let summary: Value = client
        .get(summary_url)
        .header("Cookie", &session_ref.cookie)
        .send()
        .await
        .map_err(|error| error.to_string())?
        .error_for_status()
        .map_err(|error| error.to_string())?
        .json()
        .await
        .map_err(|error| error.to_string())?;

    let chart_url = format!("https://query1.finance.yahoo.com/v8/finance/chart/{}", urlencoding::encode(symbol));
    let chart_future = client
        .get(chart_url)
        .send()
        .await
        .ok()
        .and_then(|response| response.error_for_status().ok())
        .map(|response| response.json::<Value>());
    let chart = match chart_future {
        Some(future) => future.await.unwrap_or(Value::Null),
        None => Value::Null,
    };

    normalize_stock(symbol, &summary, &chart)
}

async fn get_yahoo_session(client: &Client) -> Result<YahooSession, String> {
    let cookie_response = client
        .get("https://fc.yahoo.com")
        .header("Accept", "text/html,application/xhtml+xml")
        .send()
        .await
        .map_err(|error| error.to_string())?;
    let cookie = cookie_response
        .headers()
        .get_all(reqwest::header::SET_COOKIE)
        .iter()
        .filter_map(|value| value.to_str().ok())
        .filter_map(|value| value.split(';').next())
        .collect::<Vec<_>>()
        .join("; ");

    if cookie.is_empty() {
        return Err("Yahoo 没有返回可用 cookie。".to_string());
    }

    let crumb = client
        .get("https://query1.finance.yahoo.com/v1/test/getcrumb")
        .header("Cookie", &cookie)
        .header("Accept", "text/plain,*/*")
        .send()
        .await
        .map_err(|error| error.to_string())?
        .text()
        .await
        .map_err(|error| error.to_string())?
        .trim()
        .to_string();

    if crumb.is_empty() || crumb.starts_with('<') {
        return Err("Yahoo crumb 获取失败，请检查设置页里的网络环境。".to_string());
    }

    Ok(YahooSession { cookie, crumb })
}

fn normalize_stock(symbol: &str, summary: &Value, chart: &Value) -> Result<StockData, String> {
    let root = summary
        .pointer("/quoteSummary/result/0")
        .ok_or("没有找到这个代码的数据。")?;
    let chart_meta = chart.pointer("/chart/result/0/meta").unwrap_or(&Value::Null);

    Ok(StockData {
        symbol: symbol.to_string(),
        name: raw_string(root.pointer("/price/longName"))
            .or_else(|| raw_string(root.pointer("/price/shortName")))
            .unwrap_or_else(|| symbol.to_string()),
        exchange: raw_string(root.pointer("/price/exchangeName"))
            .or_else(|| raw_string(root.pointer("/price/exchange")))
            .or_else(|| raw_string(chart_meta.get("exchangeName")))
            .unwrap_or_default(),
        sector: raw_string(root.pointer("/assetProfile/sector")),
        industry: raw_string(root.pointer("/assetProfile/industry")),
        eps_forward: raw_number(root.pointer("/defaultKeyStatistics/forwardEps"))
            .or_else(|| raw_number(root.pointer("/financialData/forwardEps"))),
        pe_forward: raw_number(root.pointer("/summaryDetail/forwardPE"))
            .or_else(|| raw_number(root.pointer("/defaultKeyStatistics/forwardPE"))),
        div_rate: raw_number(root.pointer("/summaryDetail/dividendRate")),
        div_yield: raw_number(root.pointer("/summaryDetail/dividendYield")),
        short_interest: raw_number(root.pointer("/defaultKeyStatistics/shortPercentOfFloat")),
        market_cap: raw_number(root.pointer("/price/marketCap")),
        volume: raw_number(root.pointer("/price/regularMarketVolume")).or_else(|| raw_number(chart_meta.get("regularMarketVolume"))),
        previous_close: raw_number(root.pointer("/summaryDetail/previousClose")).or_else(|| raw_number(chart_meta.get("previousClose"))),
        current_price: raw_number(root.pointer("/financialData/currentPrice")).or_else(|| raw_number(root.pointer("/price/regularMarketPrice"))),
        open: raw_number(root.pointer("/summaryDetail/open")).or_else(|| raw_number(chart_meta.get("regularMarketPrice"))),
        day_high: raw_number(root.pointer("/summaryDetail/dayHigh")),
        day_low: raw_number(root.pointer("/summaryDetail/dayLow")),
        fifty_two_week_high: raw_number(root.pointer("/summaryDetail/fiftyTwoWeekHigh")),
        fifty_two_week_low: raw_number(root.pointer("/summaryDetail/fiftyTwoWeekLow")),
        beta: raw_number(root.pointer("/summaryDetail/beta")).or_else(|| raw_number(root.pointer("/defaultKeyStatistics/beta"))),
        shares_outstanding: raw_number(root.pointer("/defaultKeyStatistics/sharesOutstanding")),
        float_shares: raw_number(root.pointer("/defaultKeyStatistics/floatShares")),
        average_volume: raw_number(root.pointer("/summaryDetail/averageVolume")),
        target_mean_price: raw_number(root.pointer("/financialData/targetMeanPrice")),
        recommendation: raw_string(root.pointer("/financialData/recommendationKey")),
        book_value: raw_number(root.pointer("/defaultKeyStatistics/bookValue")),
        price_to_book: raw_number(root.pointer("/defaultKeyStatistics/priceToBook")),
        debt_to_equity: raw_number(root.pointer("/financialData/debtToEquity")),
        revenue_growth: raw_number(root.pointer("/financialData/revenueGrowth")),
        gross_margins: raw_number(root.pointer("/financialData/grossMargins")),
        operating_margins: raw_number(root.pointer("/financialData/operatingMargins")),
        profit_margins: raw_number(root.pointer("/financialData/profitMargins")).or_else(|| raw_number(root.pointer("/defaultKeyStatistics/profitMargins"))),
        return_on_assets: raw_number(root.pointer("/financialData/returnOnAssets")),
        return_on_equity: raw_number(root.pointer("/financialData/returnOnEquity")),
        total_revenue: raw_number(root.pointer("/financialData/totalRevenue")),
        net_income_to_common: raw_number(root.pointer("/defaultKeyStatistics/netIncomeToCommon")),
        trailing_eps: raw_number(root.pointer("/defaultKeyStatistics/trailingEps")),
        total_cash: raw_number(root.pointer("/financialData/totalCash")),
        total_debt: raw_number(root.pointer("/financialData/totalDebt")),
        levered_free_cash_flow: raw_number(root.pointer("/financialData/freeCashflow")).or_else(|| raw_number(root.pointer("/financialData/operatingCashflow"))),
        fetched_at: Utc::now().to_rfc3339(),
    })
}

fn raw_number(value: Option<&Value>) -> Option<f64> {
    match value? {
        Value::Number(number) => number.as_f64(),
        Value::Object(map) => map.get("raw").and_then(Value::as_f64),
        _ => None,
    }
}

fn raw_string(value: Option<&Value>) -> Option<String> {
    match value? {
        Value::String(text) => Some(text.to_string()),
        Value::Object(map) => map.get("raw").and_then(Value::as_str).map(str::to_string),
        _ => None,
    }
}

fn build_client(settings: &AppSettings) -> Result<Client, String> {
    let mut builder = Client::builder()
        .user_agent(USER_AGENT)
        .cookie_store(true)
        .timeout(Duration::from_secs(30));

    if settings.network_mode == "proxy" && !settings.proxy_url.trim().is_empty() {
        builder = builder.proxy(Proxy::all(settings.proxy_url.trim()).map_err(|error| error.to_string())?);
    } else if settings.network_mode == "direct" {
        builder = builder.no_proxy();
    }

    builder.build().map_err(|error| error.to_string())
}

fn read_settings(app: &AppHandle) -> AppSettings {
    read_json(settings_path(app).unwrap_or_default()).unwrap_or_default()
}

fn read_cache(app: &AppHandle) -> Result<HashMap<String, CacheEntry>, String> {
    Ok(read_json(cache_path(app)?).unwrap_or_default())
}

fn read_json<T>(path: PathBuf) -> Option<T>
where
    T: for<'de> Deserialize<'de>,
{
    fs::read_to_string(path)
        .ok()
        .and_then(|text| serde_json::from_str(&text).ok())
}

fn write_json<T: Serialize>(path: PathBuf, value: &T) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|error| error.to_string())?;
    }
    let text = serde_json::to_string_pretty(value).map_err(|error| error.to_string())?;
    fs::write(path, text).map_err(|error| error.to_string())
}

fn data_dir(app: &AppHandle) -> Result<PathBuf, String> {
    app.path().app_data_dir().map_err(|error| error.to_string())
}

fn settings_path(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(data_dir(app)?.join("settings.json"))
}

fn cache_path(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(data_dir(app)?.join("stock-meta-cache.json"))
}

fn app_state_path(app: &AppHandle, app_id: &str) -> Result<PathBuf, String> {
    let safe_id = app_id
        .chars()
        .map(|ch| {
            if ch.is_ascii_alphanumeric() || ch == '-' || ch == '_' {
                ch
            } else {
                '_'
            }
        })
        .collect::<String>();
    let filename = if safe_id.is_empty() { "app".to_string() } else { safe_id };
    Ok(data_dir(app)?.join("app-state").join(format!("{filename}.json")))
}

fn is_valid_symbol(symbol: &str) -> bool {
    !symbol.is_empty()
        && symbol.len() <= 24
        && symbol
            .chars()
            .all(|ch| ch.is_ascii_uppercase() || ch.is_ascii_digit() || ".-=^".contains(ch))
}

fn sanitize_filename(filename: &str) -> String {
    let cleaned = filename
        .chars()
        .map(|ch| match ch {
            '<' | '>' | ':' | '"' | '/' | '\\' | '|' | '?' | '*' => '_',
            _ => ch,
        })
        .collect::<String>()
        .trim()
        .trim_matches('.')
        .to_string();

    if cleaned.is_empty() {
        "stock-meta.csv".to_string()
    } else if cleaned.to_lowercase().ends_with(".csv") {
        cleaned
    } else {
        format!("{cleaned}.csv")
    }
}

fn unique_path(path: PathBuf) -> PathBuf {
    if !path.exists() {
        return path;
    }

    let parent = path.parent().map(PathBuf::from).unwrap_or_default();
    let stem = path
        .file_stem()
        .and_then(|value| value.to_str())
        .unwrap_or("stock-meta")
        .to_string();
    let ext = path.extension().and_then(|value| value.to_str()).unwrap_or("csv");

    for index in 1..1000 {
        let candidate = parent.join(format!("{stem}-{index}.{ext}"));
        if !candidate.exists() {
            return candidate;
        }
    }

    parent.join(format!("{stem}-{}.{}", now_ms(), ext))
}

fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64
}

fn ok_result(symbol: String, data: StockData, cache: &str, cached_at: Option<u64>, warning: Option<String>) -> StockResult {
    StockResult {
        symbol,
        name: Some(data.name),
        exchange: Some(data.exchange),
        sector: data.sector,
        industry: data.industry,
        eps_forward: data.eps_forward,
        pe_forward: data.pe_forward,
        div_rate: data.div_rate,
        div_yield: data.div_yield,
        short_interest: data.short_interest,
        market_cap: data.market_cap,
        volume: data.volume,
        previous_close: data.previous_close,
        current_price: data.current_price,
        open: data.open,
        day_high: data.day_high,
        day_low: data.day_low,
        fifty_two_week_high: data.fifty_two_week_high,
        fifty_two_week_low: data.fifty_two_week_low,
        beta: data.beta,
        shares_outstanding: data.shares_outstanding,
        float_shares: data.float_shares,
        average_volume: data.average_volume,
        target_mean_price: data.target_mean_price,
        recommendation: data.recommendation,
        book_value: data.book_value,
        price_to_book: data.price_to_book,
        debt_to_equity: data.debt_to_equity,
        revenue_growth: data.revenue_growth,
        gross_margins: data.gross_margins,
        operating_margins: data.operating_margins,
        profit_margins: data.profit_margins,
        return_on_assets: data.return_on_assets,
        return_on_equity: data.return_on_equity,
        total_revenue: data.total_revenue,
        net_income_to_common: data.net_income_to_common,
        trailing_eps: data.trailing_eps,
        total_cash: data.total_cash,
        total_debt: data.total_debt,
        levered_free_cash_flow: data.levered_free_cash_flow,
        fetched_at: Some(data.fetched_at),
        status: "ok".to_string(),
        cache: cache.to_string(),
        cached_at,
        error: None,
        hint: None,
        warning,
    }
}

fn error_result(symbol: String, error: String, settings: &AppSettings) -> StockResult {
    StockResult {
        symbol,
        name: None,
        exchange: None,
        sector: None,
        industry: None,
        eps_forward: None,
        pe_forward: None,
        div_rate: None,
        div_yield: None,
        short_interest: None,
        market_cap: None,
        volume: None,
        previous_close: None,
        current_price: None,
        open: None,
        day_high: None,
        day_low: None,
        fifty_two_week_high: None,
        fifty_two_week_low: None,
        beta: None,
        shares_outstanding: None,
        float_shares: None,
        average_volume: None,
        target_mean_price: None,
        recommendation: None,
        book_value: None,
        price_to_book: None,
        debt_to_equity: None,
        revenue_growth: None,
        gross_margins: None,
        operating_margins: None,
        profit_margins: None,
        return_on_assets: None,
        return_on_equity: None,
        total_revenue: None,
        net_income_to_common: None,
        trailing_eps: None,
        total_cash: None,
        total_debt: None,
        levered_free_cash_flow: None,
        fetched_at: None,
        status: "error".to_string(),
        cache: "none".to_string(),
        cached_at: None,
        error: Some(error),
        hint: Some(format!(
            "当前网络模式：{}，代理：{}。请在设置页调整网络环境。",
            settings.network_mode, settings.proxy_url
        )),
        warning: None,
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![
            get_settings,
            save_settings,
            fetch_stock_batch,
            export_csv,
            load_app_state,
            save_app_state
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

fn main() {
    run();
}
