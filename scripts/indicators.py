"""三竹股市公式指標與多空條件判定（與原前端 JavaScript 版逐行對應）。

MA   ：收盤價簡單移動平均
RSI  ：首段 n 日平均漲跌，之後 Wilder 平滑 UP = UP_prev*(n-1)/n + U/n
MACD ：DI=(H+L+2C)/4，DIF=EMA12(DI)-EMA26(DI)，MACD=EMA9(DIF)，OSC=DIF-MACD
EMA  ：α = 2/(n+1)，以首筆值為起始
"""

MA_N = (30, 60, 100)
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
        for i in range(last, last - 3, -1):  # 最近 3 個交易日
            if m[i - 1] is None:
                continue
            if gx is None and c[i - 1] <= m[i - 1] and c[i] > m[i]:
                gx = rows[i]["date"]
            if dx is None and c[i - 1] >= m[i - 1] and c[i] < m[i]:
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
