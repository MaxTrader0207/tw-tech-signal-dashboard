# 台股技術訊號多空儀表板

全市場上市櫃普通股的均線交叉、RSI(6)、MACD 柱狀體多空訊號，採三竹股市計算公式。

- **後台**：GitHub Actions 每個交易日收盤後掃描全部上市櫃普通股（約 1,800 檔），資料來源為 Yahoo Finance，結果寫成 JSON 存到 `data` 分支。
- **前端**：GitHub Pages 靜態頁（電腦版 `/`、手機版 `/m/`），只讀取後台產生的 JSON，提供日期切換、市場／產業／均量篩選、除息影響排除、新增訊號、自選股、歷史回測與個股查詢。
- **資料**：存在獨立的 `data` 分支（每次單一提交覆蓋，不累積歷史），由 Actions 組合後部署到 Pages。

## 目錄

```
.github/workflows/scan.yml   每日排程（台北 14:50，17:30 補跑）＋手動執行
scripts/scan.py              清單 → Yahoo 日線 → 計算 → 輸出 JSON
scripts/indicators.py        三竹公式 MA／RSI／MACD、逐日訊號與交集分組
docs/index.html              電腦版
docs/m/index.html            手機版
docs/assets/core.js          兩版共用邏輯（篩選、交集、標記、自選股、回測、輸出）
docs/assets/desktop.js       電腦版畫面
docs/assets/mobile.js        手機版畫面
data 分支                    latest.json／index.json／history/（近 60 個交易日）
```

## 部署步驟

1. 新建 repo（例如 `tw-tech-signal-dashboard`），上傳本資料夾全部檔案。
2. **Settings → Actions → General → Workflow permissions** 勾選 **Read and write permissions**。
3. **Settings → Pages**：Build and deployment 的 Source 選 **GitHub Actions**。
4. **Actions → 每日技術訊號掃描 → Run workflow**，手動跑第一次（約 5～15 分鐘）。
5. 完成後開啟 `https://<帳號>.github.io/tw-tech-signal-dashboard/`。

## 資料與判定

| 項目 | 說明 |
| --- | --- |
| 股票清單 | 證交所 ISIN 公告頁（上市 strMode=2、上櫃 strMode=4），CFICode = ESVUFR 的 4 碼普通股；失敗時改用 TWSE／TPEx OpenAPI |
| 日線 | yfinance 批次下載近兩年日線與配息，失敗者改以 Yahoo chart API 逐檔補抓 |
| 盤中 K 棒 | 台北時間 14:30 前不採用當日 K 棒 |
| 排除 | 無資料、未達 110 個交易日、最新資料非當日（停牌） |
| 保護機制 | 清單少於 1,000 檔或有效檔數少於 500 檔時中止，不覆蓋既有資料 |
| 除息 | 近 5 個交易日內依 Yahoo 配息與還原因子偵測；以還原權息價重算，原始價有、還原價沒有的訊號標為「除息影響」 |
| 在榜天數 | 逐日重算訊號，計算連續出現的交易日數（最多 10） |
| 歷史回測 | 近 2 年各訊號（含交集組合）首日出現後持有 3／5／10／20 日的勝率與平均報酬（還原權息價），依事件當日 20 日均量分組，附同期全體個股基準 |

## 本機執行

```bash
pip install -r requirements.txt
python scripts/scan.py
cd docs && python -m http.server 8000   # 開 http://localhost:8000（資料在 docs/data）
```

> 本專案僅供技術分析研究，不構成投資建議。
