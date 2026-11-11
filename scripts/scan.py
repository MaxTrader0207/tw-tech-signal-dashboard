"""台股技術訊號 每日全市場掃描（GitHub Actions 後台）

流程：
  1. 取得上市＋上櫃普通股清單（證交所 ISIN 公告頁；失敗時改用 TWSE／TPEx OpenAPI）
  2. 從 Yahoo Finance 下載近一年日線（yfinance 批次下載；失敗者改用 chart API 逐檔補抓）
  3. 以三竹公式計算 MA／RSI(6)／MACD 並判定多空條件
  4. 輸出 docs/data/latest.json、docs/data/history/<日期>.json、docs/data/index.json
"""

import datetime as dt
import html
import json
import re
import sys
import time
from array import array
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

import numpy as np
import pandas as pd
import requests
import yfinance as yf

sys.path.insert(0, str(Path(__file__).resolve().parent))
from indicators import MA_N, MIN_BARS, analyze, last_week_state, signal_series, weekly_series, wk_bull, x_group  # noqa: E402

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "docs" / "data"
HIST = DATA / "history"
KEEP_DAYS = 60                     # 保留歷史天數
BATCH = 80                         # yfinance 每批檔數
MIN_FRESH = 500                    # 有效檔數低於此值視為抓取異常，不覆蓋資料
LIST_CACHE_DAYS = 7                # 股票清單（含產業別）快取天數；期間內以 OpenAPI 增減個股
TPE = dt.timezone(dt.timedelta(hours=8))
INTRADAY_CUTOFF = dt.time(14, 30)  # 台北時間 14:30 前不採用當日 K 棒
EX_WINDOW = 5                      # 近 N 個交易日內有除息者標示
STREAK_MAX = 10                    # 在榜天數最多回推 N 日（≥N 顯示 N+）
VOL_AVG_N = 20                     # 均量天數
DATA_START = "2023-06-01"          # Yahoo 下載起日：回測起日前需約 110 個交易日暖機（日線指標、週線 MA10／RSI6）
BT_START = "2024-01-01"            # 歷史回測只統計此日（含）之後出現的訊號
HORIZONS = (3, 5, 10, 20)          # 回測持有天數（多空相同）
V_THRESH = (0, 100, 500, 1000, 5000)  # 回測依事件當日 20 日均量（張）分組，對應前端均量門檻
UA = {"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
                    "(KHTML, like Gecko) Chrome/124.0 Safari/537.36"}
MKT_NAME = {"TWSE": "上市", "TPEx": "上櫃"}


def log(*a):
    print(*a, flush=True)


# ---------------------------------------------------------------- 1. 股票清單
def is_common(code):
    return bool(re.fullmatch(r"\d{4}", code)) and not code.startswith("00")


SKIPPED = set()   # ISIN 中 4 碼但非普通股（TDR 等），日常 OpenAPI 增補時排除


def isin_list(mode, market):
    """證交所 ISIN 公告頁：strMode=2 上市、4 上櫃；以 CFICode=ESVUFR 篩選普通股。"""
    r = requests.get(f"https://isin.twse.com.tw/isin/C_public.jsp?strMode={mode}",
                     headers=UA, timeout=60)
    r.raise_for_status()
    page = r.content.decode("cp950", errors="ignore")
    out = []
    for tr in re.findall(r"<tr[^>]*>(.*?)</tr>", page, re.S | re.I):
        tds = [html.unescape(re.sub(r"<[^>]+>", "", td)).strip()
               for td in re.findall(r"<td[^>]*>(.*?)</td>", tr, re.S | re.I)]
        if len(tds) < 6:
            continue
        m = re.match(r"^(\d{4})[\s　]+(.+)$", tds[0])
        if not m:
            continue
        if tds[5] != "ESVUFR" or not is_common(m.group(1)):
            SKIPPED.add(m.group(1))
            continue
        out.append({"id": m.group(1), "name": m.group(2).strip(), "mkt": market, "ind": tds[4]})
    return out


def openapi_list(market):
    if market == "TWSE":
        url, kid, kname = "https://openapi.twse.com.tw/v1/exchangeReport/STOCK_DAY_ALL", "Code", "Name"
    else:
        url, kid, kname = ("https://www.tpex.org.tw/openapi/v1/tpex_mainboard_daily_close_quotes",
                           "SecuritiesCompanyCode", "CompanyName")
    r = requests.get(url, headers=UA, timeout=60)
    r.raise_for_status()
    out = []
    for row in r.json():
        code = str(row.get(kid, "")).strip()
        if is_common(code):
            out.append({"id": code, "name": str(row.get(kname, "")).strip(), "mkt": market, "ind": ""})
    return out


def _full_list(mode, market, floor):
    lst = []
    t0 = time.time()
    try:
        lst = isin_list(mode, market)
        log(f"[清單] ISIN {MKT_NAME[market]} {len(lst)} 檔（{time.time() - t0:.0f}s）")
    except Exception as e:  # noqa: BLE001
        log(f"[清單] ISIN {MKT_NAME[market]} 失敗（{time.time() - t0:.0f}s）：{e}")
    if len(lst) < floor:
        try:
            lst = openapi_list(market)
            log(f"[清單] OpenAPI {MKT_NAME[market]} {len(lst)} 檔")
        except Exception as e:  # noqa: BLE001
            log(f"[清單] OpenAPI {MKT_NAME[market]} 失敗：{e}")
    return lst


def _dedupe(stocks):
    seen, uniq = set(), []
    for s in stocks:
        if s["id"] not in seen:
            seen.add(s["id"])
            uniq.append(s)
    return uniq


def stock_universe(now):
    """股票清單：快取 LIST_CACHE_DAYS 天（含產業別），期間內以 OpenAPI 補新上市、剔除已下市。"""
    cache = DATA / "universe.json"
    today = now.date()
    if cache.exists():
        try:
            c = json.loads(cache.read_text(encoding="utf-8"))
            age = (today - dt.date.fromisoformat(c["date"])).days
            if 0 <= age < LIST_CACHE_DAYS and len(c["stocks"]) >= 1000:
                stocks = c["stocks"]
                with ThreadPoolExecutor(2) as ex:
                    res = list(ex.map(lambda m: _try(openapi_list, m), ("TWSE", "TPEx")))
                if all(res):
                    live = {s["id"]: s for lst in res for s in lst}
                    known = {s["id"] for s in stocks}
                    skip = set(c.get("skip", []))
                    kept = [s for s in stocks if s["id"] in live]
                    added = [live[i] for i in live if i not in known and i not in skip]
                    log(f"[清單] 使用 {c['date']} 快取 {len(stocks)} 檔；OpenAPI 新增 {len(added)}、剔除 {len(stocks) - len(kept)}")
                    return _dedupe(kept + added)
                log(f"[清單] 使用 {c['date']} 快取 {len(stocks)} 檔（OpenAPI 無回應，未增減）")
                return stocks
        except Exception as e:  # noqa: BLE001
            log(f"[清單] 快取讀取失敗：{e}")
    with ThreadPoolExecutor(2) as ex:
        parts = list(ex.map(lambda a: _full_list(*a), ((2, "TWSE", 500), (4, "TPEx", 300))))
    stocks = _dedupe(parts[0] + parts[1])
    if len(stocks) >= 1000:
        cache.parent.mkdir(parents=True, exist_ok=True)
        cache.write_text(json.dumps({"date": today.isoformat(), "stocks": stocks, "skip": sorted(SKIPPED)}, ensure_ascii=False,
                                    separators=(",", ":")), encoding="utf-8")
    return stocks


def _try(fn, *a):
    try:
        return fn(*a)
    except Exception as e:  # noqa: BLE001
        log(f"[清單] {fn.__name__}{a} 失敗：{e}")
        return None


# ---------------------------------------------------------------- 2. Yahoo 日線
def ysym(s):
    return s["id"] + (".TW" if s["mkt"] == "TWSE" else ".TWO")


def _num(x):
    try:
        x = float(x)
    except (TypeError, ValueError):
        return None
    return None if x != x else x  # NaN → None


def frame_to_rows(df):
    rows = {}
    for idx, r in df.iterrows():
        c, h, l = _num(r.get("Close")), _num(r.get("High")), _num(r.get("Low"))
        if c is None or h is None or l is None:
            continue
        d = pd.Timestamp(idx).strftime("%Y-%m-%d")
        adj, div = _num(r.get("Adj Close")), _num(r.get("Dividends"))
        o = _num(r.get("Open"))
        rows[d] = {"date": d, "open": round(o if o is not None else c, 4),
                   "close": round(c, 4), "high": round(h, 4), "low": round(l, 4),
                   "volume": int(_num(r.get("Volume")) or 0),
                   "adj": None if adj is None else round(adj, 6), "div": div or 0.0}
    return [rows[k] for k in sorted(rows)]


def fetch_yfinance(symbols):
    got = {}
    for i in range(0, len(symbols), BATCH):
        chunk = symbols[i:i + BATCH]
        df = None
        for attempt in range(3):
            try:
                df = yf.download(chunk, start=DATA_START, interval="1d", auto_adjust=False,
                                 actions=True, group_by="ticker", threads=True,
                                 progress=False, timeout=30)
                break
            except Exception as e:  # noqa: BLE001
                log(f"[yfinance] 第 {i // BATCH + 1} 批失敗（{attempt + 1}/3）：{e}")
                time.sleep(10 * (attempt + 1))
        if df is not None and not df.empty:
            multi = isinstance(df.columns, pd.MultiIndex)
            for s in chunk:
                try:
                    sub = df[s] if multi else df
                except KeyError:
                    continue
                rows = frame_to_rows(sub)
                if rows:
                    got[s] = rows
        log(f"[yfinance] {min(i + BATCH, len(symbols))}/{len(symbols)}，累計 {len(got)} 檔")
        time.sleep(1.5)
    return got


def fetch_chart(sess, sym):
    for host in ("query1", "query2"):
        try:
            r = sess.get(f"https://{host}.finance.yahoo.com/v8/finance/chart/{sym}",
                         params={"period1": int(dt.datetime.fromisoformat(DATA_START).replace(tzinfo=TPE).timestamp()),
                                 "period2": int(time.time()) + 86400, "interval": "1d", "events": "div,splits"}, timeout=20)
        except requests.RequestException:
            continue
        if r.status_code == 404:
            return None
        if r.status_code == 429:
            time.sleep(5)
            continue
        if not r.ok:
            continue
        res = ((r.json().get("chart") or {}).get("result") or [None])[0]
        if not res or not res.get("timestamp"):
            return None
        q = res["indicators"]["quote"][0]
        adjc = ((res["indicators"].get("adjclose") or [{}])[0]).get("adjclose") or []
        divs = {}
        for ev in ((res.get("events") or {}).get("dividends") or {}).values():
            divs[dt.datetime.fromtimestamp(ev["date"], TPE).strftime("%Y-%m-%d")] = ev.get("amount") or 0.0
        rows = {}
        for i, ts in enumerate(res["timestamp"]):
            c, h, l = q["close"][i], q["high"][i], q["low"][i]
            if c is None or h is None or l is None:
                continue
            d = dt.datetime.fromtimestamp(ts, TPE).strftime("%Y-%m-%d")
            adj = adjc[i] if i < len(adjc) else None
            o = (q.get("open") or [None] * len(res["timestamp"]))[i]
            rows[d] = {"date": d, "open": round(o if o is not None else c, 4),
                       "close": round(c, 4), "high": round(h, 4), "low": round(l, 4),
                       "volume": int(q["volume"][i] or 0),
                       "adj": None if adj is None else round(adj, 6), "div": divs.get(d, 0.0)}
        return [rows[k] for k in sorted(rows)]
    return None


def fetch_prices(symbols):
    got = fetch_yfinance(symbols)
    missing = [s for s in symbols if s not in got]
    if missing:
        log(f"[chart API] 補抓 {len(missing)} 檔")
        sess = requests.Session()
        sess.headers.update(UA)
        for k, s in enumerate(missing, 1):
            rows = fetch_chart(sess, s)
            if rows:
                got[s] = rows
            if k % 50 == 0:
                log(f"[chart API] {k}/{len(missing)}")
            time.sleep(0.3)
    return got


def last_trading_date():
    """證交所每日市場成交資訊（OpenAPI FMTQIK）中的最近交易日；取不到回傳 None。"""
    try:
        r = requests.get("https://openapi.twse.com.tw/v1/exchangeReport/FMTQIK", headers=UA, timeout=30)
        r.raise_for_status()
        ds = []
        for row in r.json():
            d = str(row.get("Date", "")).strip()
            if re.fullmatch(r"\d{7}", d):                      # 民國 yyyMMdd
                ds.append(f"{int(d[:3]) + 1911}-{d[3:5]}-{d[5:7]}")
        return max(ds) if ds else None
    except Exception as e:  # noqa: BLE001
        log(f"[日期] 證交所最近交易日取得失敗：{e}")
        return None


def prev_weekday(d):
    d -= dt.timedelta(days=1)
    while d.weekday() >= 5:
        d -= dt.timedelta(days=1)
    return d


PRE_OPEN = dt.time(9, 0)
LTD = {"v": None, "done": False}   # 證交所最近交易日（只在需要時查一次）


def drop_intraday(rows, now=None):
    """處理未收盤或標錯日期的最新 K 棒（以呼叫當下的台北時間判斷，掃描可能跨過午夜）。

    - 日期晚於今天：一律排除。
    - 開盤前（09:00 前）或週末：今天不可能有真正的 K 棒。Yahoo 午夜後會把前一個交易日的
      K 棒標成今天，若前一個交易日的 K 棒不存在就改回該日期，否則排除。
    - 交易日 09:00～14:30：今天的 K 棒尚未收盤，排除。
    """
    now = dt.datetime.now(TPE)
    today = now.date().isoformat()
    while rows and rows[-1]["date"] > today:
        rows.pop()
    if not rows or rows[-1]["date"] != today:
        return rows
    if now.time() < PRE_OPEN or now.weekday() >= 5:
        if not LTD["done"]:
            LTD["v"], LTD["done"] = last_trading_date(), True
            log(f"[日期] 開盤前／週末執行，證交所最近交易日：{LTD['v'] or '未知（改用前一個工作日）'}")
        prev = LTD["v"] if LTD["v"] and LTD["v"] < today else prev_weekday(now.date()).isoformat()
        last = rows.pop()
        if not rows or rows[-1]["date"] < prev:
            rows.append({**last, "date": prev})
        return rows
    if now.time() < INTRADAY_CUTOFF:
        rows.pop()
    return rows


def target_date(prices):
    """資料日期＝多數個股的最新交易日（避免少數個股的異常 K 棒決定整體日期）。"""
    from collections import Counter
    c = Counter(rows[-1]["date"] for rows in prices.values() if rows)
    if not c:
        return ""
    top = max(c.values())
    return max(d for d, n in c.items() if n >= top * 0.5)   # 與最多者相近時取較新日期


# ---------------------------------------------------------------- 3. 計算與輸出
def r(x, n):
    return None if x is None else round(x, n)


def compact(a):
    sig = {}
    for k, v in a["sig"].items():
        sig[k] = {kk: (r(vv, 4) if isinstance(vv, float) else vv) for kk, vv in v.items()} if isinstance(v, dict) else True
    return {
        "date": a["date"], "close": r(a["close"], 4), "chg": r(a["chg"], 4), "vol": a["vol"],
        "ma": {k: r(v, 4) for k, v in a["ma"].items()},
        "rsi": r(a["rsi"], 4), "dif": r(a["dif"], 4), "macd": r(a["macd"], 4),
        "osc": [r(x, 4) for x in a["osc"]], "sig": sig,
    }


def ex_dividend(rows):
    """近 EX_WINDOW 個交易日內的除息事件：Yahoo 配息紀錄，或還原因子跳動（Adj/Close 比值變化）。"""
    ev = {}
    for i in range(1, len(rows)):
        cur_, prev = rows[i], rows[i - 1]
        if cur_.get("div"):
            ev[cur_["date"]] = cur_["div"]
        if cur_.get("adj") and prev.get("adj") and cur_["close"] and prev["close"]:
            f_prev, f_cur = prev["adj"] / prev["close"], cur_["adj"] / cur_["close"]
            if f_cur > 0 and f_prev / f_cur < 0.9995:
                ev.setdefault(cur_["date"], 0.0)
    recent = {r_["date"] for r_ in rows[-EX_WINDOW:]}
    hits = sorted(d for d in ev if d in recent)
    if not hits:
        return None
    d = hits[-1]
    return {"d": d, "div": round(ev[d], 4) if ev[d] else None}


def adjusted_rows(rows):
    """以 Yahoo 還原因子換算還原權息價（最後一日因子歸一）；缺還原價時回傳 None。"""
    if any(not x.get("adj") for x in rows):
        return None
    base = rows[-1]["adj"] / rows[-1]["close"]
    out = []
    for x in rows:
        f = (x["adj"] / x["close"]) / base
        out.append({**x, "close": x["close"] * f, "high": x["high"] * f, "low": x["low"] * f})
    return out


def streaks(flags, keys):
    """各訊號連續出現的交易日數（含今日，最多 STREAK_MAX）。flags 為 signal_series 的逐日結果。"""
    st = {}
    for k in keys:
        n = 0
        for i in range(len(flags) - 1, max(-1, len(flags) - 1 - STREAK_MAX), -1):
            if flags[i] is None or k not in flags[i]:
                break
            n += 1
        st[k] = max(n, 1)
    return st


class Backtest:
    """訊號首日出現後持有 h 日的報酬統計（以還原權息價計算，避免除息干擾）。

    期間：BT_START（2024-01-01）起出現的訊號。
    事件：某訊號在當日出現、前一日沒有（交集組合同理：當日進入該組合）。
    勝率：多方訊號＝上漲機率，空方訊號＝下跌機率（平盤不計）。
    報酬同時給平均數與中位數；中位數不受少數極端值（飆股或還原價異常）影響。
    基準＝同期間所有個股每日的持有報酬。
    """

    def __init__(self):
        # 以欄位陣列儲存（2024 年起約 140 萬筆基準樣本，避免大量 Python 物件占用記憶體）
        self._v20 = array("d")                               # 事件當日 20 日均量（張）
        self._ret = {h: array("d") for h in HORIZONS}       # 持有 h 日報酬，超出資料範圍為 NaN
        self._wb = bytearray()                               # 多方週線條件：上週週收盤 > 週MA30
        self._wd = bytearray()                               # 空方週線條件：上週週收盤跌破週 MA10
        self.ev = {}                                         # 訊號 key -> 基準樣本索引 array("l")
        self.d0, self.d1 = None, None

    def add(self, rows, flags):
        if len(rows) < MIN_BARS + 2:
            return
        px = [r["adj"] for r in rows] if all(r.get("adj") for r in rows) else [r["close"] for r in rows]
        vol = [r.get("volume", 0) for r in rows]
        csum = [0]
        for v in vol:
            csum.append(csum[-1] + v)
        L = len(rows)
        wk_of_row, weeks = weekly_series(rows)
        nan = float("nan")
        for i in range(MIN_BARS, L - min(HORIZONS)):
            if rows[i]["date"] < BT_START:
                continue
            fi, fp = flags[i], flags[i - 1]
            if fi is None or fp is None:
                continue
            lo = max(0, i - VOL_AVG_N + 1)
            idx = len(self._v20)
            self._v20.append((csum[i + 1] - csum[lo]) / (i + 1 - lo) / 1000)
            for h in HORIZONS:
                self._ret[h].append(px[i + h] / px[i] - 1 if i + h < L else nan)
            ws = last_week_state(wk_of_row, weeks, i)
            self._wb.append(1 if wk_bull(ws) else 0)
            self._wd.append(1 if ws and ws[0] < ws[1] else 0)
            events = list(fi - fp)
            for side in ("Bull", "Bear"):
                g = x_group(fi, side)
                if g and g != x_group(fp, side):
                    events.append(f"x{side}{g}")
            for k in events:
                self.ev.setdefault(k, array("l")).append(idx)
            if events:
                d = rows[i]["date"]
                self.d0 = d if self.d0 is None or d < self.d0 else self.d0
                self.d1 = d if self.d1 is None or d > self.d1 else self.d1

    def _stats(self, idx, t, h, bull=None, weekly=False):
        """idx＝事件樣本索引（None 表示基準＝全部樣本）。
        weekly=True：多方只取上週週收盤站上週 MA30 的事件，空方只取上週週收盤跌破週 MA10 的事件。"""
        v20, r = self.V20, self.R[h]
        if idx is not None:
            v20, r = v20[idx], r[idx]
        m = (v20 >= t) & ~np.isnan(r)
        if weekly:
            w = self.WB if bull else self.WD
            m &= (w if idx is None else w[idx])
        xs = r[m]
        n = int(xs.size)
        if not n:
            return [0, None, None, None] if bull is not None else [0, None, None, None, None]
        mean = float(xs.mean()) * 100
        med = float(np.median(xs)) * 100
        up = float((xs > 0).sum()) / n * 100
        dn = float((xs < 0).sum()) / n * 100
        if bull is None:   # 基準：n、平均、上漲%、下跌%、中位數
            return [n, round(mean, 2), round(up, 1), round(dn, 1), round(med, 2)]
        return [n, round(mean, 2), round(up if bull else dn, 1), round(med, 2)]   # n、平均、勝率、中位數

    def result(self):
        self.V20 = np.frombuffer(self._v20, dtype=np.float64)
        self.R = {h: np.frombuffer(a, dtype=np.float64) for h, a in self._ret.items()}
        self.WB = np.frombuffer(bytes(self._wb), dtype=np.uint8).astype(bool)
        self.WD = np.frombuffer(bytes(self._wd), dtype=np.uint8).astype(bool)
        ev = {k: np.frombuffer(a, dtype=np.int64) if a.itemsize == 8 else np.array(a, dtype=np.int64)
              for k, a in self.ev.items()}
        log(f"[回測] {BT_START} 起，基準樣本 {self.V20.size:,} 筆，訊號 {len(ev)} 種")
        return {
            "from": self.d0, "to": self.d1, "h": list(HORIZONS),
            "base": {str(t): {str(h): self._stats(None, t, h) for h in HORIZONS} for t in V_THRESH},
            "by": {str(t): {k: {str(h): self._stats(ix, t, h, "Bull" in k) for h in HORIZONS}
                            for k, ix in ev.items()} for t in V_THRESH},
            "byW": {str(t): {k: {str(h): self._stats(ix, t, h, "Bull" in k, weekly=True) for h in HORIZONS}
                             for k, ix in ev.items()} for t in V_THRESH},
        }


def build_payload(stocks, prices, now):
    results, no_data, short = [], [], []
    bt = Backtest()
    cleaned = {k: drop_intraday(list(v)) for k, v in prices.items() if v}
    tdate = target_date(cleaned)
    log(f"[日期] 資料日期 {tdate}")
    for s in stocks:
        rows = cleaned.get(ysym(s))
        if not rows:
            no_data.append(s["id"])
            continue
        rows = [x for x in rows if x["date"] <= tdate]       # 比資料日期更新的 K 棒截掉
        a = analyze(rows)
        if not a:
            short.append(s["id"])
            continue
        item = {"id": s["id"], "name": s["name"], "mkt": s["mkt"], "ind": s["ind"]}
        item.update(compact(a))
        vols = [x["volume"] for x in rows[-VOL_AVG_N:]]
        item["v20"] = round(sum(vols) / len(vols) / 1000) if vols else 0      # 20 日均量（張）
        srows, flags = signal_series(rows)
        bt.add(srows, flags)
        wk_of_row, weeks = weekly_series(srows)
        ws = last_week_state(wk_of_row, weeks, len(srows) - 1)
        if ws:   # 多方條件＝上週週收盤 > 週 MA30；空方條件＝上週週收盤跌破週 MA10
            item["wk"] = {"d": ws[2], "o": r(ws[7], 4), "c": r(ws[0], 4), "ma": r(ws[1], 4), "mp": r(ws[3], 4),
                          "ma30": r(ws[8], 4), "r6": r(ws[4], 2), "rp": r(ws[5], 2), "osc": r(ws[6], 4),
                          "rise": ws[1] > ws[3], "bull": wk_bull(ws), "dn": ws[0] < ws[1]}
        if a["sig"]:
            item["st"] = streaks(flags, list(a["sig"]))
        ex = ex_dividend(rows)
        if ex:
            item["ex"] = ex
            adj = adjusted_rows(rows)
            aa = analyze(adj) if adj else None
            if aa is not None:
                hit = [k for k in a["sig"] if k not in aa["sig"]]
                if hit:
                    item["exHit"] = hit        # 原始價有、還原價沒有 → 除息造成的訊號
        results.append(item)

    max_date = max((x["date"] for x in results), default="")
    fresh = [x for x in results if x["date"] == max_date]
    stale = [x["id"] for x in results if x["date"] != max_date]
    for x in fresh:
        del x["date"]
    fresh.sort(key=lambda x: x["id"])
    return {
        "date": max_date,
        "ver": 13,                      # …10：新增 maBull10；11：週MACD柱>0；12：多方週線條件改為週K收紅且站上週MA30；13：移除 maBull10、多方週線條件改為週收站上週MA30
        "generated_at": now.isoformat(timespec="seconds"),
        "source": "Yahoo Finance 日線與配息（yfinance）；股票清單：臺灣證券交易所 ISIN 公告／OpenAPI",
        "stats": {
            "universe": len(stocks), "fetched": len(prices), "scanned": len(fresh),
            "no_data": len(no_data), "insufficient": len(short), "stale": len(stale),
        },
        "excluded": {"no_data": no_data, "insufficient": short, "stale": stale},
        "bt": bt.result(),
        "stocks": fresh,
    }


def dump(path, obj):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(obj, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")


def write_outputs(payload):
    """寫出資料；若新資料日期比現有最新資料還舊（例如 Yahoo 換日時段暫時少一根 K 棒），保留現有資料不覆蓋。"""
    date = payload["date"]
    cur = DATA / "latest.json"
    if cur.exists():
        try:
            oldp = json.loads(cur.read_text(encoding="utf-8"))
            old = oldp.get("date", "")
            if old and date < old:
                log(f"[保護] 新資料日期 {date} 早於現有 {old}，疑似 Yahoo 資料暫時缺漏，保留現有個股資料不覆蓋")
                if payload.get("bt"):                 # 回測統計與最新一天無關，仍更新到現有資料
                    oldp["bt"] = payload["bt"]
                    dump(cur, oldp)
                    log("[保護] 已更新現有資料的歷史回測統計")
                return False
        except Exception:  # noqa: BLE001
            pass
    dump(DATA / "latest.json", payload)
    dump(HIST / f"{date}.json", payload)

    files = sorted(HIST.glob("*.json"), reverse=True)
    for old in files[KEEP_DAYS:]:
        old.unlink()
    dates = []
    for f in files[:KEEP_DAYS]:
        try:
            p = json.loads(f.read_text(encoding="utf-8"))
            dates.append({"date": p["date"], "count": len(p["stocks"])})
        except Exception:  # noqa: BLE001
            continue
    dump(DATA / "index.json", {"latest": date, "dates": dates})
    return True


def main():
    now = dt.datetime.now(TPE)
    log(f"開始掃描 {now:%Y-%m-%d %H:%M}（台北）")
    t0 = time.time()
    stocks = stock_universe(now)
    if len(stocks) < 1000:
        sys.exit(f"股票清單只有 {len(stocks)} 檔，疑似來源異常，中止。")
    t1 = time.time()
    prices = fetch_prices([ysym(s) for s in stocks])
    t2 = time.time()
    payload = build_payload(stocks, prices, now)
    log(f"[耗時] 清單 {t1 - t0:.0f}s、行情 {t2 - t1:.0f}s、計算 {time.time() - t2:.0f}s")
    log(f"資料日期 {payload['date']}，統計 {payload['stats']}")
    if payload["stats"]["scanned"] < MIN_FRESH:
        sys.exit(f"有效檔數僅 {payload['stats']['scanned']}，疑似 Yahoo 抓取異常，不覆蓋既有資料。")
    write_outputs(payload)
    log("完成")


if __name__ == "__main__":
    main()
