import { mountYahooStockApp } from "./apps/yahooStock.js";

export const apps = [
  {
    id: "yahoo-stock",
    name: "Yahoo 股票",
    description: "批量查询股票 meta 信息并导出",
    icon: "Y",
    mount: mountYahooStockApp
  }
];
