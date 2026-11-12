#!/usr/bin/env python3
"""做多濾網研究：在回測期間內，逐一檢驗常見技術指標「狀態條件」成立時進場做多的表現。

做法
  - 樣本：2024-01-01 起、上市櫃普通股、當日 20 日均量 ≥ 100 張的每一個「個股 × 交易日」。
  - 進場：當日收盤；報酬一律扣除交易成本（手續費 0.1425% × 2、證交稅 0.3%）。
  - 兩種出場：持有 20 日；停利 15%／停損 10%（最多 20 日）。另附持有 5、10 日。
  - 選股效果：每天比較「符合條件的個股平均報酬 − 當天全體個股平均報酬」，再對每日差值做
    Newey-West（落後 20 期）t 檢定 → 排除大盤漲跌的影響，只看條件本身的選股力。
  - 大盤條件：比較條件成立日與不成立日的「全體個股平均報酬」，同樣用 Newey-West t。
  - 穩定度：分 2024／2025／2026 三年各自的超額報酬。
本檔為一次性研究工具，不影響每日掃描。
"""
import json
import sys
import time
from pathlib import Path

import numpy as np
import pandas as pd

sys.path.insert(0, str(Path(__file__).parent))
import scan  # noqa: E402

START = "2022-09-01"        # 多抓一段暖機（MA240、52 週高點）
H = 20
V_MIN = 100
NW_LAG = 20

def ema(s, n):
    return s.ewm(alpha=2 / (n + 1), adjust=False).mean()


def wilder_rsi(c, n):
    d = c.diff()
    up = d.clip(lower=0).ewm(alpha=1 / n, adjust=False).mean()
    dn = (-d.clip(upper=0)).ewm(alpha=1 / n, adjust=False).mean()
    return 100 * up / (up + dn)


def macd3(h, l, c):
    """三竹 MACD：DI=(H+L+2C)/4，DIF=EMA12−EMA26，MACD=EMA9(DIF)，OSC=DIF−MACD。"""
    di = (h + l + 2 * c) / 4
    dif = ema(di, 12) - ema(di, 26)
    sig = ema(dif, 9)
    return dif, sig, dif - sig


def kd(h, l, c, n=9):
    lo, hi = l.rolling(n).min(), h.rolling(n).max()
    rsv = (100 * (c - lo) / (hi - lo)).fillna(50)
    k = rsv.ewm(alpha=1 / 3, adjust=False).mean()
    return k, k.ewm(alpha=1 / 3, adjust=False).mean()


def frame(rows):
    """rows → 還原價 DataFrame（index=日期）。"""
    df = pd.DataFrame(rows)
    df["date"] = pd.to_datetime(df["date"])
    df = df.set_index("date").sort_index()
    f = (df["adj"] / df["close"]).where(df["adj"].notna() & (df["close"] > 0), 1.0)
    o = df["open"].where(df["open"].notna() & (df["open"] > 0), df["close"])
    return pd.DataFrame({"o": o * f, "h": df["high"] * f, "l": df["low"] * f, "c": df["close"] * f,
                         "v": df["volume"].fillna(0)})


def weekly(d):
    """上週（已完成的最近一週）的週線狀態，對齊到每個交易日。"""
    per = d.index.to_period("W-SUN")
    w = d.groupby(per).agg(c=("c", "last"), h=("h", "max"), l=("l", "min"))
    w["ma10"], w["ma30"] = w.c.rolling(10).mean(), w.c.rolling(30).mean()
    w["rsi"] = wilder_rsi(w.c, 6)
    _, _, w["osc"] = macd3(w.h, w.l, w.c)
    out = pd.DataFrame({
        "w_gt10": w.c > w.ma10, "w_gt30": w.c > w.ma30, "w_ma30up": w.ma30 > w.ma30.shift(1),
        "w_up": w.c > w.c.shift(1), "w_rsi50": w.rsi > 50, "w_rsi70": w.rsi > 70, "w_osc": w.osc > 0,
    })
    prev = out.shift(1).fillna(False)                       # 用「上一週」
    return prev.reindex(per).set_index(d.index).astype(bool)


def features(d):
    c, h, l, o, v = d.c, d.h, d.l, d.o, d.v
    X = {}
    ma = {n: c.rolling(n).mean() for n in (5, 10, 20, 60, 120, 240)}
    for n in (10, 20, 60, 120, 240):
        X[f"gt_ma{n}"] = c > ma[n]
    X["ma20_up"] = ma[20] > ma[20].shift(1)
    X["ma60_up"] = ma[60] > ma[60].shift(1)
    X["ma_align"] = (ma[10] > ma[20]) & (ma[20] > ma[60])
    X["ma_align_full"] = (c > ma[10]) & (ma[10] > ma[20]) & (ma[20] > ma[60]) & (ma[60] > ma[120])
    X["ma_bear"] = (ma[10] < ma[20]) & (ma[20] < ma[60])
    r6, r14 = wilder_rsi(c, 6), wilder_rsi(c, 14)
    X["rsi6_gt50"], X["rsi6_gt70"], X["rsi6_gt80"] = r6 > 50, r6 > 70, r6 >= 80
    X["rsi6_lt30"], X["rsi6_lt20"] = r6 < 30, r6 <= 20
    X["rsi6_up70"] = (r6 > 70) & (r6 > r6.shift(1))
    X["rsi14_gt50"], X["rsi14_gt70"] = r14 > 50, r14 > 70
    dif, sig, osc = macd3(h, l, c)
    X["osc_pos"], X["dif_pos"], X["macd_pos"] = osc > 0, dif > 0, sig > 0
    X["osc_up"] = osc > osc.shift(1)
    X["osc_cross"] = (osc > 0) & (osc.shift(1) <= 0)
    k, dd = kd(h, l, c)
    X["kd_gold"], X["k_gt80"], X["k_lt20"] = k > dd, k > 80, k < 20
    for n, ths in ((20, (0, .10, .20)), (60, (0, .20, .50)), (120, (0, .30))):
        r = c / c.shift(n) - 1
        d[f"ret{n}"] = r
        for th in ths:
            X[f"ret{n}_gt{int(th * 100)}"] = r > th
    X["ret20_lt-10"] = d["ret20"] < -.10
    for n in (10, 20, 30, 60, 120, 240):
        X[f"newhigh{n}"] = c > c.shift(1).rolling(n).max()
    X["newlow20"] = c < c.shift(1).rolling(20).min()
    hi240 = h.rolling(240).max()
    X["near_hi240"] = c >= hi240 * 0.90
    X["far_hi240"] = c <= hi240 * 0.70
    b20 = c / ma[20] - 1
    X["bias20_gt10"], X["bias20_lt-10"], X["bias60_gt20"] = b20 > .10, b20 < -.10, (c / ma[60] - 1) > .20
    rng = h.shift(1).rolling(20).max() / l.shift(1).rolling(20).min() - 1
    X["rng20_le10"], X["rng20_le15"], X["rng20_ge40"] = rng <= .10, rng <= .15, rng >= .40
    X["box_break15"] = (rng <= .15) & (c > h.shift(1).rolling(20).max())
    sd = c.rolling(20).std(ddof=0)
    X["bb_up"], X["bb_dn"] = c > ma[20] + 2 * sd, c < ma[20] - 2 * sd
    X["bb_narrow"] = (4 * sd / ma[20]) < .10
    tr = pd.concat([h - l, (h - c.shift(1)).abs(), (l - c.shift(1)).abs()], axis=1).max(axis=1)
    atr = tr.ewm(alpha=1 / 14, adjust=False).mean() / c
    X["atr_lt2"], X["atr_gt5"] = atr < .02, atr > .05
    v5, v20, v60 = v.rolling(5).mean(), v.rolling(20).mean(), v.rolling(60).mean()
    X["vol_15x"], X["vol_2x"], X["vol_half"] = v > 1.5 * v20.shift(1), v > 2 * v20.shift(1), v < .5 * v20.shift(1)
    X["v5_gt_v20"], X["v20_gt_v60"] = v5 > v20, v20 > v60
    chg = c / c.shift(1) - 1
    X["up_vol"] = (chg > 0) & X["vol_15x"]
    X["day_up5"], X["day_dn5"] = chg > .05, chg < -.05
    X["red3"] = (c / o - 1) > .03
    X["gap_up"] = l > h.shift(1)
    X["liq1000"] = v20 / 1000 >= 1000
    X = pd.DataFrame(X).fillna(False).astype(bool)
    X = pd.concat([X, weekly(d)], axis=1)
    X["v20"] = v20 / 1000
    for n in (60, 120):
        X[f"ret{n}"] = d[f"ret{n}"]
    return X


LABELS = [
    ("gt_ma10", "趨勢", "收盤 > MA10"), ("gt_ma20", "趨勢", "收盤 > MA20"), ("gt_ma60", "趨勢", "收盤 > MA60"),
    ("gt_ma120", "趨勢", "收盤 > MA120"), ("gt_ma240", "趨勢", "收盤 > MA240"),
    ("ma20_up", "趨勢", "MA20 上揚"), ("ma60_up", "趨勢", "MA60 上揚"),
    ("ma_align", "趨勢", "多頭排列 MA10>MA20>MA60"), ("ma_align_full", "趨勢", "完整多頭排列 收盤>MA10>MA20>MA60>MA120"),
    ("ma_bear", "趨勢", "空頭排列 MA10<MA20<MA60"),
    ("w_gt10", "週線", "上週週收 > 週MA10"), ("w_gt30", "週線", "上週週收 > 週MA30"), ("w_ma30up", "週線", "週MA30 上揚"),
    ("w_up", "週線", "上週週線上漲"), ("w_rsi50", "週線", "上週週RSI6 > 50"), ("w_rsi70", "週線", "上週週RSI6 > 70"),
    ("w_osc", "週線", "上週週MACD柱 > 0"),
    ("rsi6_gt50", "RSI", "RSI6 > 50"), ("rsi6_gt70", "RSI", "RSI6 > 70"), ("rsi6_gt80", "RSI", "RSI6 ≥ 80"),
    ("rsi6_up70", "RSI", "RSI6 > 70 且上揚"), ("rsi6_lt30", "RSI", "RSI6 < 30"), ("rsi6_lt20", "RSI", "RSI6 ≤ 20"),
    ("rsi14_gt50", "RSI", "RSI14 > 50"), ("rsi14_gt70", "RSI", "RSI14 > 70"),
    ("osc_pos", "MACD", "MACD柱 > 0"), ("osc_up", "MACD", "MACD柱 放大"), ("osc_cross", "MACD", "MACD柱 當日翻正"),
    ("dif_pos", "MACD", "DIF > 0"), ("macd_pos", "MACD", "MACD慢線 > 0"),
    ("kd_gold", "KD", "K > D"), ("k_gt80", "KD", "K > 80"), ("k_lt20", "KD", "K < 20"),
    ("ret20_gt0", "動能", "近20日漲幅 > 0"), ("ret20_gt10", "動能", "近20日漲幅 > 10%"), ("ret20_gt20", "動能", "近20日漲幅 > 20%"),
    ("ret20_lt-10", "動能", "近20日跌幅 > 10%"),
    ("ret60_gt0", "動能", "近60日漲幅 > 0"), ("ret60_gt20", "動能", "近60日漲幅 > 20%"), ("ret60_gt50", "動能", "近60日漲幅 > 50%"),
    ("ret120_gt0", "動能", "近120日漲幅 > 0"), ("ret120_gt30", "動能", "近120日漲幅 > 30%"),
    ("rs60_top", "相對強度", "近60日漲幅排全市場前 20%"), ("rs60_bot", "相對強度", "近60日漲幅排全市場後 20%"),
    ("rs120_top", "相對強度", "近120日漲幅排全市場前 20%"),
    ("newhigh10", "創高", "收盤創 10 日新高"), ("newhigh20", "創高", "收盤創 20 日新高"),
    ("newhigh30", "創高", "收盤創 30 日新高"), ("newhigh60", "創高", "收盤創 60 日新高"),
    ("newhigh120", "創高", "收盤創 120 日新高"), ("newhigh240", "創高", "收盤創 240 日新高"),
    ("near_hi240", "創高", "距 240 日高點 10% 內"), ("far_hi240", "創高", "低於 240 日高點 30% 以上"),
    ("newlow20", "創高", "收盤創 20 日新低"),
    ("bias20_gt10", "乖離", "MA20 正乖離 > 10%"), ("bias20_lt-10", "乖離", "MA20 負乖離 > 10%"), ("bias60_gt20", "乖離", "MA60 正乖離 > 20%"),
    ("rng20_le10", "波動", "前20日區間 ≤ 10%"), ("rng20_le15", "波動", "前20日區間 ≤ 15%"), ("rng20_ge40", "波動", "前20日區間 ≥ 40%"),
    ("box_break15", "波動", "箱型突破（區間≤15% 且收盤過高）"),
    ("bb_up", "波動", "收盤突破布林上軌"), ("bb_dn", "波動", "收盤跌破布林下軌"), ("bb_narrow", "波動", "布林帶寬 < 10%"),
    ("atr_lt2", "波動", "ATR14 < 2%"), ("atr_gt5", "波動", "ATR14 > 5%"),
    ("vol_15x", "成交量", "成交量 > 1.5 倍 20 日均量"), ("vol_2x", "成交量", "成交量 > 2 倍 20 日均量"),
    ("vol_half", "成交量", "成交量 < 0.5 倍 20 日均量"), ("v5_gt_v20", "成交量", "5日均量 > 20日均量"),
    ("v20_gt_v60", "成交量", "20日均量 > 60日均量"), ("up_vol", "成交量", "價漲量增（上漲且量>1.5倍）"),
    ("liq1000", "成交量", "20日均量 ≥ 1000 張"),
    ("day_up5", "K棒", "當日漲幅 > 5%"), ("day_dn5", "K棒", "當日跌幅 > 5%"), ("red3", "K棒", "實體紅K > 3%"), ("gap_up", "K棒", "向上跳空"),
    ("m_gt20", "大盤", "大盤 > MA20"), ("m_gt60", "大盤", "大盤 > MA60"), ("m_ma60up", "大盤", "大盤 MA60 上揚"),
    ("m_osc", "大盤", "大盤 MACD柱 > 0"), ("m_rsi50", "大盤", "大盤 RSI6 > 50"), ("m_ret20", "大盤", "大盤近20日漲幅 > 0"),
    ("m_lt20", "大盤", "大盤 < MA20"), ("m_rsi30", "大盤", "大盤 RSI6 < 30"),
]
MARKET_KEYS = [k for k, g, _ in LABELS if g == "大盤"]


def market_features(d):
    c = d.c
    ma20, ma60 = c.rolling(20).mean(), c.rolling(60).mean()
    r6 = wilder_rsi(c, 6)
    _, _, osc = macd3(d.h, d.l, c)
    return pd.DataFrame({"m_gt20": c > ma20, "m_gt60": c > ma60, "m_ma60up": ma60 > ma60.shift(1), "m_osc": osc > 0,
                         "m_rsi50": r6 > 50, "m_ret20": c / c.shift(20) - 1 > 0, "m_lt20": c < ma20, "m_rsi30": r6 < 30})


def outcomes(d):
    c = d.c
    out = {}
    for hh in (5, 10, 20):
        out[f"r{hh}"] = scan.long_net(c.shift(-hh) / c - 1)
    arr = [d[x].to_numpy(dtype=float) for x in ("o", "h", "l", "c")]
    hold = (c.shift(-H) / c - 1).to_numpy()
    for tp in (0.10, 0.15):
        first, ret = scan.tpsl_returns(*arr, tp)
        out[f"tp{int(tp * 100)}"] = scan.long_net(np.where(first < H, ret, hold))
    return pd.DataFrame(out, index=d.index)


def nw_t(x, lag=NW_LAG):
    x = np.asarray(x, dtype=float)
    x = x[~np.isnan(x)]
    n = x.size
    if n < 30:
        return None, None
    m = x.mean()
    e = x - m
    var = e @ e / n
    for k in range(1, min(lag, n - 1) + 1):
        var += 2 * (1 - k / (lag + 1)) * (e[k:] @ e[:-k]) / n
    se = np.sqrt(max(var, 1e-18) / n)
    return float(m), float(m / se)


def nw_reg_t(y, x, lag=NW_LAG):
    """y = a + b·x 的 b 與 Newey-West t（x 為 0/1）。"""
    y, x = np.asarray(y, float), np.asarray(x, float)
    ok = ~np.isnan(y)
    y, x = y[ok], x[ok]
    n = y.size
    xd = x - x.mean()
    sxx = xd @ xd
    if n < 60 or sxx < 1e-9:
        return None, None
    b = xd @ y / sxx
    u = xd * (y - y.mean() - b * xd)
    var = u @ u
    for k in range(1, lag + 1):
        var += 2 * (1 - k / (lag + 1)) * (u[k:] @ u[:-k])
    return float(b), float(b / (np.sqrt(max(var, 1e-18)) / sxx))


def analyse(P, log=print):
    """P：合併後的樣本 DataFrame（欄位含 date、各條件布林欄、r5/r10/r20/tp10/tp15）。"""
    P = P.sort_values("date").reset_index(drop=True)
    P["year"] = P["date"].dt.year
    for n in (60, 120):                                             # 橫斷面相對強度
        rk = P.groupby("date")[f"ret{n}"].rank(pct=True)
        P[f"rs{n}_top"] = (rk >= .8).fillna(False)
        if n == 60:
            P["rs60_bot"] = (rk <= .2).fillna(False)
    OUT = ("r5", "r10", "r20", "tp10", "tp15")
    codes, days = pd.factorize(P["date"])
    nd = len(days)
    cnt_all = np.bincount(codes, minlength=nd).astype(float)
    day_all = {o: np.bincount(codes, weights=P[o].to_numpy(), minlength=nd) / cnt_all for o in OUT}
    base = {o: float(P[o].mean()) for o in OUT}
    yrs = sorted(P["year"].unique())
    ymask = {y: (P["year"] == y).to_numpy() for y in yrs}
    ybase = {y: {o: float(P.loc[ymask[y], o].mean()) for o in OUT} for y in yrs}
    R = {o: P[o].to_numpy() for o in OUT}
    N = len(P)

    def stat(m, key=None, market=False):
        n = int(m.sum())
        if n < 300:
            return None
        res = {"n": n, "cov": round(n / N * 100, 1)}
        for o in OUT:
            x = R[o][m]
            res[o] = {"mean": round(float(x.mean()) * 100, 2), "ex": round((float(x.mean()) - base[o]) * 100, 2)}
            if o in ("r20", "tp15"):
                res[o]["win"] = round(float((x > 0).mean()) * 100, 1)
                res[o]["med"] = round(float(np.median(x)) * 100, 2)
        for o in ("r20", "tp15"):
            c1 = np.bincount(codes[m], minlength=nd).astype(float)
            s1 = np.bincount(codes[m], weights=R[o][m], minlength=nd)
            if market:                                              # 擇時：條件日 vs 非條件日的全體平均
                b, t = nw_reg_t(day_all[o], (c1 > 0).astype(float))
                res[o]["t"] = None if t is None else round(t, 2)
                res[o]["spread"] = None if b is None else round(b * 100, 2)
            else:                                                   # 選股：同日相對全體的超額
                ok = c1 >= 5
                d = s1[ok] / c1[ok] - day_all[o][ok]
                mu, t = nw_t(d)
                res[o]["t"] = None if t is None else round(t, 2)
                res[o]["spread"] = None if mu is None else round(mu * 100, 2)
                res[o]["days"] = int(ok.sum())
            res[o]["yr"] = {str(y): (round((float(R[o][m & ymask[y]].mean()) - ybase[y][o]) * 100, 2)
                                     if (m & ymask[y]).sum() >= 100 else None) for y in yrs}
        return res

    M = {k: P[k].to_numpy(dtype=bool) for k, _, _ in LABELS if k in P.columns}
    singles = {}
    for k, g, lab in LABELS:
        if k not in M:
            continue
        s = stat(M[k], k, market=(g == "大盤"))
        if s:
            singles[k] = {"grp": g, "label": lab, **s}
    log(f"[研究] 單一條件 {len(singles)} 個")

    # 兩兩組合：從選股效果為正的條件中挑前段，加上大盤條件
    def score(s):
        return (s["tp15"]["spread"] or -9) + (s["r20"]["spread"] or -9)
    cand = [k for k, s in sorted(singles.items(), key=lambda kv: -score(kv[1]))
            if s["grp"] != "大盤" and (s["tp15"]["t"] or 0) > 1 and s["cov"] >= 1][:22]
    mk = [k for k in MARKET_KEYS if k in singles]
    pairs = []
    keys = cand + mk
    for i, a in enumerate(keys):
        for b in keys[i + 1:]:
            if a in mk and b in mk:
                continue
            m = M[a] & M[b]
            if m.sum() < 3000:
                continue
            s = stat(m)
            if s:
                pairs.append({"a": a, "b": b, "label": f"{singles[a]['label']} ＋ {singles[b]['label']}", **s})
    pairs.sort(key=lambda s: -(s["tp15"]["ex"] + s["r20"]["ex"]))
    log(f"[研究] 兩兩組合 {len(pairs)} 個")
    # 三條件：對前 12 組再加一個候選
    triples = []
    seen = set()
    for p in pairs[:12]:
        for c3 in keys:
            if c3 in (p["a"], p["b"]):
                continue
            kk = tuple(sorted((p["a"], p["b"], c3)))
            if kk in seen:
                continue
            seen.add(kk)
            m = M[p["a"]] & M[p["b"]] & M[c3]
            if m.sum() < 2000:
                continue
            s = stat(m)
            if s:
                triples.append({"k": kk, "label": " ＋ ".join(singles[x]["label"] for x in kk), **s})
    triples.sort(key=lambda s: -(s["tp15"]["ex"] + s["r20"]["ex"]))
    # 創 N 日新高 × 跳空／長紅 的固定對照表
    focus = []
    for n in (10, 20, 30, 60, 120, 240):
        nh = M[f"newhigh{n}"]
        for tag, m in (("單獨", nh), ("＋向上跳空", nh & M["gap_up"]), ("＋當日漲幅>5%", nh & M["day_up5"]),
                       ("＋跳空＋漲幅>5%", nh & M["gap_up"] & M["day_up5"])):
            s = stat(m)
            if s:
                focus.append({"n_days": n, "tag": tag, "label": f"創 {n} 日新高{tag}", **s})
    return {"focus": focus,"n": N, "days": nd, "from": str(days.min().date()), "to": str(days.max().date()),
            "base": {o: round(base[o] * 100, 2) for o in OUT},
            "base_win": {o: round(float((R[o] > 0).mean()) * 100, 1) for o in ("r20", "tp15")},
            "ybase": {str(y): {o: round(ybase[y][o] * 100, 2) for o in OUT} for y in yrs},
            "ycount": {str(y): int(ymask[y].sum()) for y in yrs},
            "singles": singles, "cand": cand, "pairs": pairs[:40], "triples": triples[:25]}


def build(prices, stocks, index_rows, log=print):
    mkt = market_features(frame(index_rows)).fillna(False).astype(bool)
    parts = []
    for i, s in enumerate(stocks, 1):
        rows = prices.get(scan.ysym(s))
        if not rows or len(rows) < 150:
            continue
        d = frame(rows)
        d = d[(d.c > 0) & d.c.notna()]
        if len(d) < 150:
            continue
        X = features(d)
        Y = outcomes(d)
        Z = pd.concat([X, Y], axis=1)
        Z = Z[(Z.index >= scan.BT_START) & (Z["v20"] >= V_MIN) & Z["r20"].notna() & Z["tp15"].notna()]
        if Z.empty:
            continue
        Z = Z.join(mkt, how="left")
        Z[mkt.columns] = Z[mkt.columns].fillna(False).astype(bool)
        Z["date"] = Z.index
        parts.append(Z.reset_index(drop=True))
        if i % 400 == 0:
            log(f"[研究] 特徵 {i}/{len(stocks)}")
    P = pd.concat(parts, ignore_index=True)
    for o in ("r5", "r10", "r20", "tp10", "tp15"):
        P[o] = P[o].astype("float64")
    log(f"[研究] 樣本 {len(P):,} 筆，{P['date'].nunique()} 個交易日")
    return P


def main():
    import datetime as dt
    scan.DATA_START = START
    now = dt.datetime.now(scan.TPE)
    stocks = [s for s in scan.stock_universe(now) if not s.get("etf")]
    syms = [scan.ysym(s) for s in stocks]
    t0 = time.time()
    prices = scan.fetch_prices(syms + ["^TWII"])
    prices = {k: scan.drop_intraday(list(v)) for k, v in prices.items() if v}
    idx = prices.get("^TWII")
    src = "加權指數 ^TWII"
    if not idx or len(idx) < 300:
        idx = scan.fetch_prices(["0050.TW"]).get("0050.TW")
        src = "0050（^TWII 取不到）"
    scan.log(f"[研究] 行情 {time.time() - t0:.0f}s，大盤來源：{src}，{len(idx)} 根")
    P = build(prices, stocks, idx, scan.log)
    res = analyse(P, scan.log)
    res["market_src"] = src
    out = Path("research_filters.json")
    out.write_text(json.dumps(res, ensure_ascii=False), encoding="utf-8")
    scan.log(f"[研究] 完成，輸出 {out}（{out.stat().st_size / 1024:.0f} KB）")


if __name__ == "__main__":
    main()
