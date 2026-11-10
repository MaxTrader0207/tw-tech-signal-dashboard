"""三竹股市公式指標與多空條件判定（與原前端 JavaScript 版逐行對應）。

MA   ：收盤價簡單移動平均
RSI  ：首段 n 日平均漲跌，之後 Wilder 平滑 UP = UP_prev*(n-1)/n + U/n
MACD ：DI=(H+L+2C)/4，DIF=EMA12(DI)-EMA26(DI)，MACD=EMA9(DIF)，OSC=DIF-MACD
EMA  ：α = 2/(n+1)，以首筆值為起始
"""

MA_N = (30, 60, 100)
CROSS_WIN_BULL = 2   # 多方：收盤黃金交叉均線需發生於近 2 個交易日內
CROSS_WIN_BEAR = 3   # 空方：收盤死亡交叉均線需發生於近 3 個交易日內
MIN_BARS = 110


def sma(a, n):
    out = [None] * len(a)
    s = 0.0
    for i, x in enumerate(a):
        s += x
        if i >= n:
            s -= a[i - n]
        if i >= n - 1:
            out[i] = s / n
    return out


def ema(a, n):
    k = 2 / (n + 1)
    out = [None] * len(a)
    prev = None
    for i, x in enumerate(a):
        if x is None:
            continue
        prev = x if prev is None else prev + k * (x - prev)
        out[i] = prev
    return out


def rsi(c, n):
    out = [None] * len(c)
    if len(c) <= n:
        return out
    up = dn = 0.0
    for i in range(1, n + 1):
        d = c[i] - c[i - 1]
        if d > 0:
            up += d
        else:
            dn -= d
    up /= n
    dn /= n

    def val():
        return 50.0 if (up + dn) == 0 else 100 * up / (up + dn)

    out[n] = val()
    for i in range(n + 1, len(c)):
        d = c[i] - c[i - 1]
        up = (up * (n - 1) + max(d, 0)) / n
        dn = (dn * (n - 1) + max(-d, 0)) / n
        out[i] = val()
    return out


def macd(h, l, c):
    di = [(h[i] + l[i] + 2 * x) / 4 for i, x in enumerate(c)]
    e12, e26 = ema(di, 12), ema(di, 26)
    dif = [e12[i] - e26[i] for i in range(len(di))]
    sig = ema(dif, 9)
    osc = [dif[i] - sig[i] for i in range(len(dif))]
    return dif, sig, osc


def signal_series(rows):
    """逐日計算命中訊號，規則與 analyze 完全相同。

    所有指標皆為因果計算（只用當日及以前資料），因此第 i 日的結果
    等同於 analyze(rows[:i+1])。回傳 (排序過濾後 rows, 每日訊號集合 list)，
    資料不足的日子為 None。
    """
    rows = sorted(
        (r for r in rows if r["close"] > 0 and r["high"] > 0 and r["low"] > 0),
        key=lambda r: r["date"],
    )
    L = len(rows)
    out = [None] * L
    if L < MIN_BARS:
        return rows, out
    c = [float(r["close"]) for r in rows]
    h = [float(r["high"]) for r in rows]
    l = [float(r["low"]) for r in rows]
    mas = {n: sma(c, n) for n in MA_N}
    r6 = rsi(c, 6)
    _, _, osc = macd(h, l, c)
    for i in range(MIN_BARS - 1, L):
        s = set()
        for n, m in mas.items():
            gx = dx = False
            for j in range(i, i - max(CROSS_WIN_BULL, CROSS_WIN_BEAR), -1):
                if m[j - 1] is None:
                    continue
                if j > i - CROSS_WIN_BULL and c[j - 1] <= m[j - 1] and c[j] > m[j]:
                    gx = True
                if j > i - CROSS_WIN_BEAR and c[j - 1] >= m[j - 1] and c[j] < m[j]:
                    dx = True
            slope = m[i] - m[i - 1]
            if gx and slope > 0:
                s.add(f"maBull{n}")
            if dx and slope < 0:
                s.add(f"maBear{n}")
        if r6[i] >= 80:
            s.add("rsiBull")
        if r6[i] <= 20:
            s.add("rsiBear")
        o0, o1, o2 = osc[i], osc[i - 1], osc[i - 2]
        if o1 <= 0 and o0 > 0:
            s.add("macdBullCross")
        if o0 > 0 and o1 > 0 and o0 > o1 and o1 > o2:
            s.add("macdBullExp")
        if o1 >= 0 and o0 < 0:
            s.add("macdBearCross")
        if o0 < 0 and o1 < 0 and o0 < o1 and o1 < o2:
            s.add("macdBearExp")
        out[i] = s
    return rows, out


WEEK_MA = 10
WEEK_RSI = 6


def weekly_series(rows):
    """依日線組成週線（週一至週日為一週，週收盤＝該週最後一個交易日收盤）。

    回傳 (wk_of_row, weeks)：
      wk_of_row[i] ＝ 第 i 個交易日所屬週在 weeks 中的索引
      weeks[k]     ＝ {"d": 該週最後交易日, "c": 週收盤, "ma": 週 MA10（不足 10 週為 None）,
                       "r6": 週 RSI(6)（三竹 Wilder 平滑，以週收盤計算；不足 7 週為 None）}
    """
    import datetime as _dt
    weeks, wk_of_row, keys = [], [], []
    for r in rows:
        y, w, _ = _dt.date.fromisoformat(r["date"]).isocalendar()
        k = (y, w)
        if keys and keys[-1] == k:
            weeks[-1]["d"], weeks[-1]["c"] = r["date"], float(r["close"])
        else:
            keys.append(k)
            weeks.append({"d": r["date"], "c": float(r["close"]), "ma": None})
        wk_of_row.append(len(weeks) - 1)
    s = 0.0
    for k, w in enumerate(weeks):
        s += w["c"]
        if k >= WEEK_MA:
            s -= weeks[k - WEEK_MA]["c"]
        if k >= WEEK_MA - 1:
            w["ma"] = s / WEEK_MA
    r = rsi([w["c"] for w in weeks], WEEK_RSI)
    for w, v in zip(weeks, r):
        w["r6"] = v
    return wk_of_row, weeks


def last_week_state(wk_of_row, weeks, i):
    """第 i 個交易日的「上週」週線狀態：
    (上週收盤, 上週週MA10, 上週最後交易日, 前一週週MA10, 上週週RSI6, 前一週週RSI6)；資料不足回傳 None。"""
    k = wk_of_row[i] - 1
    if k < 1 or weeks[k]["ma"] is None or weeks[k - 1]["ma"] is None or weeks[k]["r6"] is None or weeks[k - 1]["r6"] is None:
        return None
    return weeks[k]["c"], weeks[k]["ma"], weeks[k]["d"], weeks[k - 1]["ma"], weeks[k]["r6"], weeks[k - 1]["r6"]


def x_group(sigs, side):
    """交集分組：'3' 三指標共振、'MD' 均線+MACD、'MR' 均線+RSI、'RD' RSI+MACD，未達兩類回傳 None。"""
    m = any(f"ma{side}{n}" in sigs for n in MA_N)
    r = f"rsi{side}" in sigs
    d = f"macd{side}Cross" in sigs or f"macd{side}Exp" in sigs
    if m and r and d:
        return "3"
    if m and d:
        return "MD"
    if m and r:
        return "MR"
    if r and d:
        return "RD"
    return None


def analyze(rows):
    """rows: [{date, close, high, low, volume}]；回傳指標與命中條件，資料不足回傳 None。"""
    rows = sorted(
        (r for r in rows if r["close"] > 0 and r["high"] > 0 and r["low"] > 0),
        key=lambda r: r["date"],
    )
    L = len(rows)
    if L < MIN_BARS:
        return None
    c = [float(r["close"]) for r in rows]
    h = [float(r["high"]) for r in rows]
    l = [float(r["low"]) for r in rows]
    last = L - 1
    res = {
        "date": rows[last]["date"],
        "close": c[last],
        "chg": (c[last] / c[last - 1] - 1) * 100,
        "vol": rows[last].get("volume", 0),
        "ma": {},
        "sig": {},
    }

    for n in MA_N:
        m = sma(c, n)
        res["ma"][str(n)] = m[last]
        gx = dx = None
        for i in range(last, last - max(CROSS_WIN_BULL, CROSS_WIN_BEAR), -1):  # 多方近 2 日、空方近 3 日
            if m[i - 1] is None:
                continue
            if gx is None and i > last - CROSS_WIN_BULL and c[i - 1] <= m[i - 1] and c[i] > m[i]:
                gx = rows[i]["date"]
            if dx is None and i > last - CROSS_WIN_BEAR and c[i - 1] >= m[i - 1] and c[i] < m[i]:
                dx = rows[i]["date"]
        slope = m[last] - m[last - 1]
        if gx and slope > 0:
            res["sig"][f"maBull{n}"] = {"date": gx, "slope": slope}
        if dx and slope < 0:
            res["sig"][f"maBear{n}"] = {"date": dx, "slope": slope}

    r6 = rsi(c, 6)
    res["rsi"] = r6[last]
    if res["rsi"] >= 80:
        res["sig"]["rsiBull"] = True
    if res["rsi"] <= 20:
        res["sig"]["rsiBear"] = True

    dif, sig, osc = macd(h, l, c)
    o0, o1, o2 = osc[last], osc[last - 1], osc[last - 2]
    res["osc"] = [o2, o1, o0]
    res["dif"] = dif[last]
    res["macd"] = sig[last]
    if o1 <= 0 and o0 > 0:
        res["sig"]["macdBullCross"] = True
    if o0 > 0 and o1 > 0 and o0 > o1 and o1 > o2:
        res["sig"]["macdBullExp"] = True
    if o1 >= 0 and o0 < 0:
        res["sig"]["macdBearCross"] = True
    if o0 < 0 and o1 < 0 and o0 < o1 and o1 < o2:
        res["sig"]["macdBearExp"] = True
    return res
