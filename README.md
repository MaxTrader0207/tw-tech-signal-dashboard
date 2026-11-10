# 台股技術訊號多空儀表板

全市場上市櫃普通股的均線交叉、RSI(6)、MACD 柱狀體多空訊號，採三竹股市計算公式。

- **後台**：GitHub Actions 每個交易日收盤後掃描全部上市櫃普通股（約 1,800 檔），資料來源為 Yahoo Finance，結果寫成 JSON 提交回 repo。
- **前端**：GitHub Pages 靜態頁，只讀取後台產生的 JSON，提供日期切換、市場／產業篩選、個股查詢。

## 目錄

```
.github/workflows/scan.yml   每日排程（台北 14:50，17:30 補跑）＋手動執行
scripts/scan.py              清單 → Yahoo 日線 → 計算 → 輸出 JSON
scripts/indicators.py        三竹公式 MA／RSI／MACD 與多空條件
docs/index.html              前端查詢頁（GitHub Pages）
docs/data/latest.json        最新一日結果（由 Actions 產生）
docs/data/history/*.json     近 60 個交易日歷史
docs/data/index.json         可選日期清單
```

## 部署步驟

1. 新建 repo（例如 `tw-tech-signal-dashboard`），上傳本資料夾全部檔案。
2. **Settings → Actions → General → Workflow permissions** 勾選 **Read and write permissions**。
3. **Settings → Pages**：Source 選 **Deploy from a branch**，Branch 選 `main`、資料夾 `/docs`。
4. **Actions → 每日技術訊號掃描 → Run workflow**，手動跑第一次（約 5～15 分鐘）。
5. 完成後開啟 `https://<帳號>.github.io/tw-tech-signal-dashboard/`。

## 資料與判定

| 項目 | 說明 |
| --- | --- |
| 股票清單 | 證交所 ISIN 公告頁（上市 strMode=2、上櫃 strMode=4），CFICode = ESVUFR 的 4 碼普通股；失敗時改用 TWSE／TPEx OpenAPI |
| 日線 | yfinance 批次下載近一年日線，失敗者改以 Yahoo chart API 逐檔補抓 |
| 盤中 K 棒 | 台北時間 14:30 前不採用當日 K 棒 |
| 排除 | 無資料、未達 110 個交易日、最新資料非當日（停牌） |
| 保護機制 | 清單少於 1,000 檔或有效檔數少於 500 檔時中止，不覆蓋既有資料 |

## 本機執行

```bash
pip install -r requirements.txt
python scripts/scan.py
cd docs && python -m http.server 8000   # 開 http://localhost:8000
```

> 本專案僅供技術分析研究，不構成投資建議。
