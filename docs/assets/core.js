/* 台股技術訊號儀表板 — 電腦版與手機版共用核心
 * 常數、格式、資料讀取、篩選、交集分組、標記、自選股、回測顯示、輸出都在這裡，
 * 兩個頁面只負責版面，判讀規則改這一處即可同步。
 */
(function (global) {
'use strict';
const SC = {};

/* ---------- 常數 ---------- */
SC.MA_N = [30, 60, 100];
SC.MA_COLOR = {30: '#f5b83d', 60: '#4da3ff', 100: '#b07cff'};
SC.X_FAM_KEYS = ['maBull30', 'maBull60', 'maBull100', 'maBear30', 'maBear60', 'maBear100',
  'rsiBull', 'rsiBear', 'macdBullCross', 'macdBullExp', 'macdBearCross', 'macdBearExp'];
/* 多方「箱型突破」：前 20 個交易日最高／最低價差 ≤ 15%，當日收盤 > 區間最高價；不列入交集 */
/* 多方「RSI 動能」：上週週 RSI6 > 50、日線 RSI6 > 70 且上揚；不列入交集 */
SC.MOM_TITLE = '上週週 RSI(6) > 50，日線 RSI(6) > 70 且上揚';
SC.BOX_TITLE = '前 20 日整理區間（高低差 ≤ 15%），今日收盤突破區間高點';
SC.SIG_KEYS = ['maBull30', 'maBull60', 'maBull100', 'boxBull', 'maBear30', 'maBear60', 'maBear100',
  'rsiBull', 'rsiBullMom', 'rsiBear', 'macdBullCross', 'macdBullExp', 'macdBearCross', 'macdBearExp'];
SC.SIG_LABEL = {
  maBull30: '黃金交叉 MA30', maBull60: '黃金交叉 MA60', maBull100: '黃金交叉 MA100', boxBull: '箱型突破',
  maBear30: '死亡交叉 MA30', maBear60: '死亡交叉 MA60', maBear100: '死亡交叉 MA100',
  rsiBull: 'RSI(6) ≥ 80', rsiBullMom: 'RSI 動能', rsiBear: 'RSI(6) ≤ 20',
  macdBullCross: 'OSC 翻正', macdBullExp: 'OSC 連 2 日放大',
  macdBearCross: 'OSC 翻負', macdBearExp: 'OSC 連 2 日減少',
};
SC.FILE_LABEL = {
  maBull30: 'MA30_黃金交叉', maBull60: 'MA60_黃金交叉', maBull100: 'MA100_黃金交叉', boxBull: '箱型突破（一個月整理區間15%內）',
  maBear30: 'MA30_死亡交叉', maBear60: 'MA60_死亡交叉', maBear100: 'MA100_死亡交叉',
  rsiBull: 'RSI6_80以上', rsiBullMom: 'RSI動能（週RSI6大於50、日RSI6大於70且上揚）', rsiBear: 'RSI6_20以下',
  macdBullCross: 'MACD_柱狀體翻正', macdBullExp: 'MACD_柱狀體連2日放大',
  macdBearCross: 'MACD_柱狀體翻負', macdBearExp: 'MACD_柱狀體連2日減少',
  xBull3: '交集_三指標共振', xBullMD: '交集_均線+MACD', xBullMR: '交集_均線+RSI', xBullRD: '交集_RSI+MACD',
  xBear3: '交集_三指標共振', xBearMD: '交集_均線+MACD', xBearMR: '交集_均線+RSI', xBearRD: '交集_RSI+MACD',
};
/* 交集組合：key = `x${side}${g}`，list 取自 xi[side][f] */
SC.X_GROUPS = [
  {g: '3', f: 'all', cls: 'x3', badge: '三指標共振', title: '均線＋RSI＋MACD 同時命中', color: '#ff5fa2'},
  {g: 'MD', f: 'md', cls: 'xmd', badge: '均線＋MACD', title: '兩項命中（不含三指標共振）', color: '#38bdf8'},
  {g: 'MR', f: 'mr', cls: 'xmr', badge: '均線＋RSI', title: '兩項命中（不含三指標共振）', color: '#a3e635'},
  {g: 'RD', f: 'rd', cls: 'xrd', badge: 'RSI＋MACD', title: '兩項命中（不含三指標共振）', color: '#fbbf24'},
];
SC.MKT = {TWSE: '上市', TPEx: '上櫃'};
SC.STREAK_MAX = 10;
SC.V20_OPTIONS = [0, 100, 500, 1000, 5000];
SC.BT_MIN_N = 30;   // 回測樣本少於此數視為不足

/* ---------- 格式 ---------- */
SC.f2 = x => x == null || isNaN(x) ? '—' : (+x).toFixed(2);
SC.cls = x => x > 0 ? 'up' : x < 0 ? 'dn' : '';
SC.pctTxt = x => x == null ? '—' : `${x > 0 ? '+' : ''}${(+x).toFixed(2)}%`;
SC.pct = x => x == null ? '—' : `<span class="${SC.cls(x)}">${SC.pctTxt(x)}</span>`;
SC.md = d => d ? d.slice(5).replace('-', '/') : '—';
SC.esc = s => String(s ?? '').replace(/[&<>"]/g, ch => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;'}[ch]));
SC.plain = h => String(h).replace(/<[^>]+>/g, '').trim();
SC.int = x => x == null ? '—' : Math.round(x).toLocaleString('zh-TW');
SC.csvCell = v => /[",\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : v;

/* ---------- 資料讀取 ---------- */
SC.load = async (base, path) => {
  const r = await fetch(base + path + '?t=' + Math.floor(Date.now() / 60000), {cache: 'no-store'});
  if (!r.ok) throw new Error(`${path}：HTTP ${r.status}`);
  return r.json();
};
/* 讀日期清單與最新資料；回傳 {latestDate, dates, cache} */
SC.boot = async base => {
  const cache = {};
  try {
    const idx = await SC.load(base, 'index.json');
    return {latestDate: idx.latest, dates: idx.dates || [], cache};
  } catch (e) {
    const lt = await SC.load(base, 'latest.json');
    cache[lt.date] = lt;
    return {latestDate: lt.date, dates: [{date: lt.date, count: lt.stocks.length}], cache};
  }
};
SC.getDay = async (base, boot, date) => {
  if (!boot.cache[date]) boot.cache[date] = await SC.load(base, date === boot.latestDate ? 'latest.json' : `history/${date}.json`);
  return boot.cache[date];
};

/* ---------- 偏好與自選股（存在本機瀏覽器） ---------- */
SC.prefs = {
  get(k, d) { try { const v = localStorage.getItem('sig_' + k); return v == null ? d : v; } catch (e) { return d; } },
  set(k, v) { try { localStorage.setItem('sig_' + k, v); } catch (e) {} },
};
SC.watch = (() => {
  let set = new Set();
  try { set = new Set(JSON.parse(localStorage.getItem('sig_watch') || '[]')); } catch (e) {}
  const save = () => { try { localStorage.setItem('sig_watch', JSON.stringify([...set])); } catch (e) {} };
  return {
    has: id => set.has(id),
    toggle(id) { set.has(id) ? set.delete(id) : set.add(id); save(); return set.has(id); },
    setAll(ids) { set = new Set(ids); save(); },
    list: () => [...set],
    get size() { return set.size; },
  };
})();
SC.parseIds = text => [...new Set(String(text).toUpperCase().split(/[\s,，、;；]+/).map(x => x.replace(/\.(TW|TWO)$/, '').trim()).filter(Boolean))];

/* ---------- 指標分類 ---------- */
SC.fam = (s, B) => ({
  ma: SC.MA_N.filter(n => s.sig['ma' + B + n]),
  rsi: !!s.sig['rsi' + B],
  macd: ['Cross', 'Exp'].filter(t => s.sig['macd' + B + t]),
});
SC.hitCnt = (s, B) => { const f = SC.fam(s, B); return f.ma.length + (f.rsi ? 1 : 0) + f.macd.length; };
SC.macdTxt = (s, B) => SC.fam(s, B).macd.map(t => t === 'Cross' ? (B === 'Bull' ? '翻正' : '翻負') : (B === 'Bull' ? '連增' : '連減')).join('＋') || '—';

/* ---------- 篩選 ----------
 * o = {mkt, ind, v20, exx, nw, watchOnly, wk, wkStrict}
 *   wk：週線濾網——多方訊號需上週週收盤 > 上週週 MA30 且上週週 MACD 柱狀體 > 0，空方訊號需上週週收盤跌破上週週 MA30
 *   wkStrict：資料有週線欄位（ver ≥ 4）時，缺週線資料的個股不保留訊號
 * 回傳的個股物件 sig 已依「排除除息影響／只看新增」過濾（原物件不變）。 */
/* 標的範圍：全市場（上市櫃普通股）／0050 成分股／中型100 成分股／ETF 標的池（ETF 本身，idx=etf，不計入全市場）
 * ver 19 起個股帶 idx；回測另有 bt.u 分組，ETF 標的池的成本以證交稅 0.1% 計 */
SC.UNIV = {tw50: '0050 成分股', mid100: '中型100 成分股', etf: 'ETF 標的池'};
SC.univ = '';
SC.btOf = cur => {
  const bt = cur && cur.bt;
  if (!bt) return null;
  const u = SC.univ && bt.u && bt.u[SC.univ];
  return u ? {...bt, ...u, uName: SC.UNIV[SC.univ]} : bt;
};
SC.filter = (stocks, o) => {
  const out = [];
  for (const s of stocks) {
    if (o.univ ? s.idx !== o.univ : s.idx === 'etf') continue;
    if (o.mkt && s.mkt !== o.mkt) continue;
    if (o.ind && s.ind !== o.ind) continue;
    if (o.v20 && s.v20 != null && s.v20 < o.v20) continue;
    if (o.watchOnly && !SC.watch.has(s.id)) continue;
    let sig = s.sig;
    const wkOn = o.wk && (s.wk || o.wkStrict);
    if ((o.exx && s.exHit) || (o.nw && s.st) || wkOn) {
      sig = {};
      for (const k in s.sig) {
        if (o.exx && s.exHit && s.exHit.includes(k)) continue;
        if (o.nw && s.st && s.st[k] !== 1) continue;
        if (wkOn && !SC.wkPass(s, /Bull/.test(k) ? 'Bull' : 'Bear')) continue;
        sig[k] = s.sig[k];
      }
    }
    out.push(sig === s.sig ? s : {...s, sig});
  }
  return out;
};

/* ---------- 週線 ---------- */
// 多方週線條件：上週週收盤 > 週MA30 且週MACD柱 > 0（ver 14）；舊資料沿用當時產生的 bull／rise／up
SC.wkBull = s => !!s.wk && (s.wk.bull != null ? s.wk.bull : s.wk.rise != null ? s.wk.rise : !!s.wk.up);
SC.wkPass = (s, B) => !!(s.wk && (B === 'Bull' ? SC.wkBull(s) : s.wk.dn));
SC.wkSfx = key => /Bull/.test(key) ? '＋上週週收站上週MA30且週MACD柱>0' : '＋上週週收跌破週MA30';
SC.wkRed = s => !!s.wk && s.wk.o != null && s.wk.c > s.wk.o;
SC.wkAbove30 = s => !!s.wk && s.wk.ma30 != null && s.wk.c > s.wk.ma30;
SC.r6Arrow = s => s.wk && s.wk.rp != null ? (s.wk.r6 > s.wk.rp ? '↑' : s.wk.r6 < s.wk.rp ? '↓' : '→') : '';
SC.wkArrow = s => s.wk && s.wk.mp != null ? (s.wk.ma > s.wk.mp ? '↑' : s.wk.ma < s.wk.mp ? '↓' : '→') : '';
SC.wkCell = s => s.wk ? `<span class="${s.wk.c < s.wk.ma ? 'dn' : 'up'}">${SC.f2(s.wk.c)}</span><small> / </small>` +
  `<span class="${s.wk.mp == null ? '' : s.wk.ma > s.wk.mp ? 'up' : 'dn'}">${SC.f2(s.wk.ma)}${SC.wkArrow(s)}</span>` +
  (s.wk.ma30 != null ? `<small>｜MA30 </small><span class="${SC.wkAbove30(s) ? 'up' : 'dn'}">${SC.f2(s.wk.ma30)}</span>` : '') +
  (s.wk.osc != null ? `<small>｜柱 </small><span class="${s.wk.osc > 0 ? 'up' : 'dn'}">${SC.f2(s.wk.osc)}</span>` : '') : '—';

/* 自選股置頂（穩定排序，保留原順序） */
SC.watchFirst = arr => {
  if (!SC.watch.size) return arr;
  const a = [], b = [];
  for (const s of arr) (SC.watch.has(s.id) ? a : b).push(s);
  return a.concat(b);
};

/* 各訊號清單與交集分組 */
SC.build = results => {
  const lists = {};
  SC.SIG_KEYS.forEach(k => lists[k] = results.filter(s => s.sig[k]).sort((a, b) => b.chg - a.chg));
  lists.rsiBull.sort((a, b) => b.rsi - a.rsi);
  lists.rsiBear.sort((a, b) => a.rsi - b.rsi);
  SC.SIG_KEYS.forEach(k => lists[k] = SC.watchFirst(lists[k]));
  const xi = {};
  for (const B of ['Bull', 'Bear']) {
    const o = {all: [], md: [], mr: [], rd: []};
    results.forEach(s => {
      const f = SC.fam(s, B), m = f.ma.length > 0, r = f.rsi, d = f.macd.length > 0;
      if (m && r && d) o.all.push(s); else if (m && d) o.md.push(s); else if (m && r) o.mr.push(s); else if (r && d) o.rd.push(s);
    });
    for (const k in o) {
      o[k].sort((x, y) => SC.hitCnt(y, B) - SC.hitCnt(x, B) || (B === 'Bull' ? y.chg - x.chg : x.chg - y.chg));
      o[k] = SC.watchFirst(o[k]);
    }
    xi[B] = o;
  }
  return {lists, xi};
};
SC.xTotal = (xi, B) => Object.values(xi[B]).reduce((n, a) => n + a.length, 0);
SC.uniq = arrays => new Set(arrays.flatMap(a => a.map(s => s.id))).size;
SC.watchHits = results => results.filter(s => SC.watch.has(s.id) && Object.keys(s.sig).length).length;

/* ---------- 標記：自選、新增／連 N、除息 ---------- */
SC.sideKeys = (s, key) => {
  const m = /^x(Bull|Bear)/.exec(key || '');
  return m ? SC.X_FAM_KEYS.filter(k => k.includes(m[1]) && s.sig[k]) : (key ? [key] : []);
};
SC.streakOf = (s, key) => {
  if (!s.st) return null;
  const v = SC.sideKeys(s, key).map(k => s.st[k]).filter(Boolean);
  return v.length ? Math.min(...v) : null;
};
SC.exHitOf = (s, key) => !!(s.exHit && SC.sideKeys(s, key).some(k => s.exHit.includes(k)));
SC.runTxt = n => n == null ? '' : n === 1 ? '新' : n >= SC.STREAK_MAX ? `連${SC.STREAK_MAX}+` : `連${n}`;
SC.star = s => SC.watch.has(s.id) ? '<span class="star" title="自選股">★</span>' : '';
SC.marks = (s, key) => {
  let h = '';
  const n = SC.streakOf(s, key);
  if (n === 1) h += '<span class="mk new" title="今日新出現的訊號">新</span>';
  else if (n) h += `<span class="mk run" title="已連續 ${n} 個交易日">${SC.runTxt(n)}</span>`;
  if (s.ex) {
    const hit = SC.exHitOf(s, key);
    const tip = `${SC.md(s.ex.d)} 除息${s.ex.div ? ' ' + s.ex.div + ' 元' : ''}${hit ? '；以還原權息價計算時此訊號不成立' : ''}`;
    h += `<span class="mk ex${hit ? ' hit' : ''}" title="${tip}">${hit ? '⚠' : ''}除息</span>`;
  }
  return h;
};
SC.sigTag = (s, k) =>
  `<span class="tag ${/Bull/.test(k) ? 'bull' : 'bear'}">${/Bull/.test(k) ? '▲' : '▼'} ${SC.SIG_LABEL[k]}` +
  `${/^ma(Bull|Bear)/.test(k) && s.sig[k] && s.sig[k].date ? ' ' + SC.md(s.sig[k].date) : ''}` +
  `${s.st && s.st[k] ? '・' + SC.runTxt(s.st[k]) : ''}${s.exHit && s.exHit.includes(k) ? '・⚠除息影響' : ''}</span>`;

/* ---------- 歷史回測 ----------
 * 勝率：多方訊號＝做多淨報酬 > 0 的機率；空方訊號＝放空淨報酬 > 0 的機率（ver 17 起扣除交易成本；舊資料為漲／跌機率）。基準＝同期所有個股每日持有報酬。 */
SC.bt = (cur, key, v20, wk) => {
  const bt = SC.btOf(cur);
  if (!bt || !bt.by) return null;
  const t = String(SC.V20_OPTIONS.includes(+v20) ? +v20 : 0);
  const src = wk && bt.byW ? bt.byW : bt.by;
  const d = (src[t] || {})[key];
  const base = bt.base[t] || {};
  const bull = /Bull/.test(key);
  const rows = bt.h.map(h => {
    const v = d && d[String(h)] || [0, null, null];
    const b = base[String(h)] || [0, null, null];
    const baseWin = b[2] == null ? null : (bull ? b[2] : (b[3] != null ? b[3] : 100 - b[2]));   // 空方基準＝下跌率（不含平盤）
    // 報酬優先用中位數（不受極端值影響），舊資料沒有中位數時退回平均數
    const med = v[3] != null ? v[3] : null;
    // ver 17 起回測為扣除交易成本的淨報酬；空方為放空淨報酬（正值＝放空獲利），基準取 b[6]
    const net = !!bt.cost;
    const baseRet = net && !bull ? b[6] : (b[4] != null ? b[4] : b[1]);
    return {h, n: v[0], avg: v[1], med, ret: med != null ? med : v[1],
            retLabel: med == null ? '均報' : net ? (bull ? '淨中位' : '放空淨中位') : '中位報酬',
            win: v[2], baseWin, baseRet};
  });
  return {rows, n: rows[0].n, bull, uName: bt.uName, net: !!bt.cost, cost: bt.cost, from: bt.from, to: bt.to, wk: !!(wk && bt.byW)};
};
SC.btHtml = (cur, key, v20, opts = {}) => {
  const r = SC.bt(cur, key, v20, opts.wk);
  if (!r) return '';
  if (!r.n) return `<div class="bt"><span class="bt-h">📊 歷史回測</span><span class="bt-na">期間內無此訊號</span></div>`;
  const few = r.n < SC.BT_MIN_N;
  const items = r.rows.map(x => {
    if (x.win == null) return '';
    const diff = x.baseWin == null ? 0 : x.win - x.baseWin;
    const c = few ? '' : diff >= 3 ? 'good' : diff <= -3 ? 'poor' : '';
    const rc = x.ret > 0 ? 'up' : x.ret < 0 ? 'dn' : '';
    const tip = `平均報酬 ${x.avg > 0 ? '+' : ''}${x.avg.toFixed(2)}%；基準${x.retLabel} ${x.baseRet == null ? '—' : (x.baseRet > 0 ? '+' : '') + x.baseRet.toFixed(2) + '%'}`;
    return `<span class="bt-i" title="${tip}"><em>${x.h}日</em>${r.net ? (r.bull ? '獲利' : '放空獲利') : r.bull ? '漲' : '跌'}機率 <b class="${c}">${x.win.toFixed(0)}%</b>` +
      `${opts.short ? '' : `<small>（基準 ${x.baseWin == null ? '—' : x.baseWin.toFixed(0) + '%'}）</small>`}` +
      ` ${x.retLabel} <b class="${rc}">${x.ret > 0 ? '+' : ''}${x.ret.toFixed(2)}%</b></span>`;
  }).join('');
  return `<div class="bt" title="近 ${r.from || ''}～${r.to || ''} 期間，訊號首日出現後持有 N 日的表現（還原權息價）。${r.net ? SC.costTxt(r.cost) + '多方看做多獲利機率、空方看放空獲利機率' : '多方看上漲機率、空方看下跌機率'}；基準為同期所有個股。">` +
    `<span class="bt-h">📊 歷史回測${r.uName ? '・' + r.uName : ''}${r.wk ? '（含週線條件）' : ''}${r.net ? '<small>・已扣成本</small>' : ''} <small>n=${SC.int(r.n)}${few ? '・樣本不足' : ''}</small></span>${items}</div>` + SC.tpslHtml(cur, key, v20, opts);
};
/* 多方停利停損回測：進場＝訊號日收盤，停利（5／10／15% 各自測算）、停損 −10%，最多持有 N 日（未觸發則第 N 日收盤出場）
 * 以表格並列各停利級距：每格＝勝率（淨報酬 > 0）／平均淨報酬；滑鼠移上可看停利、停損出場比例與基準 */
SC.tpslHtml = (cur, key, v20, opts = {}) => {
  const B = SC.btOf(cur);
  let T = B && B.tpsl;
  if (!T || !/Bull/.test(key)) return '';
  if (!T.lv) T = {sl: T.sl, tps: [T.tp], lv: {[T.tp]: T}};      // ver 16–17：單一停利 5%
  const t = String(SC.V20_OPTIONS.includes(+v20) ? +v20 : 0);
  const pick = L => ({d: ((opts.wk && L.byW ? L.byW : L.by)[t] || {})[key], b: L.base[t] || {}});
  const P = T.tps.map(tp => ({tp, ...pick(T.lv[String(tp)])}));
  const n = P[0].d && (P[0].d[String(B.h[0])] || [0])[0];
  if (!n) return '';
  const few = n < SC.BT_MIN_N, net = !!B.cost;
  const sg = v => (v > 0 ? '+' : '') + v.toFixed(2) + '%';
  const cell = (x, h) => {
    const v = x.d[String(h)], b = x.b[String(h)];
    if (!v || v[2] == null) return '<td>—</td>';
    const diff = b && b[2] != null ? v[1] - b[1] : 0;          // 以平均淨報酬相對基準判斷亮色
    const c = few ? '' : diff >= 1 ? 'good' : diff <= -1 ? 'poor' : '';
    const tip = `停利 ${x.tp}%・${h}日：勝率 ${v[2].toFixed(1)}%、${net ? '平均淨報酬' : '平均報酬'} ${sg(v[1])}、中位 ${sg(v[3])}；` +
      `停利出場 ${v[4].toFixed(0)}%、停損出場 ${v[5].toFixed(0)}%、到期出場 ${(100 - v[4] - v[5]).toFixed(0)}%｜` +
      `基準：勝率 ${b && b[2] != null ? b[2].toFixed(1) + '%' : '—'}、平均 ${b && b[1] != null ? sg(b[1]) : '—'}`;
    return `<td title="${tip}"><b class="${c}">${v[2].toFixed(0)}%</b><span class="${v[1] > 0 ? 'up' : v[1] < 0 ? 'dn' : ''}">${sg(v[1])}</span></td>`;
  };
  const rows = B.h.map(h => `<tr><th>${h}日</th>${P.map(x => cell(x, h)).join('')}</tr>`).join('');
  return `<div class="bt tp" title="訊號日收盤進場；之後最高觸及停利價出場、最低觸及 −${T.sl}% 停損（跳空則以開盤價出場；同日兩者皆觸及視為先停損），最多持有 N 日，未觸發則第 N 日收盤出場。各格＝勝率（${net ? '淨' : ''}報酬 > 0）／平均${net ? '淨' : ''}報酬；金色＝平均報酬高於同期全體個股基準 1 個百分點以上。${SC.costTxt(B.cost)}">` +
    `<span class="bt-h">🎯 停利／停損 ${T.sl}%${B.uName ? '・' + B.uName : ''}${opts.wk ? '（含週線條件）' : ''}${net ? '<small>・已扣成本</small>' : ''} <small>n=${SC.int(n)}${few ? '・樣本不足' : ''}</small></span>` +
    `<table class="tpt"><thead><tr><th></th>${P.map(x => `<th>停利 ${x.tp}%</th>`).join('')}</tr></thead><tbody>${rows}</tbody></table></div>`;
};
SC.costTxt = c => c ? `已扣交易成本：手續費 ${c.fee}%（買賣各一次）、證交稅 ${c.tax}%（賣出）${c.lend ? `、融券借券費 ${c.lend}%（放空）` : ''}。` : '';
SC.btPeriod = cur => cur && cur.bt && cur.bt.from ? `${cur.bt.from}～${cur.bt.to}` : '';

/* ---------- 查無原因 ---------- */
SC.whyMissing = (cur, K, filtered) => {
  const ex = cur.excluded || {};
  return (ex.no_data || []).includes(K) ? 'Yahoo 查無日線資料'
    : (ex.insufficient || []).includes(K) ? '資料未達 110 個交易日（可能為新上市櫃）'
    : (ex.stale || []).includes(K) ? '最新資料非當日（可能停牌）'
    : filtered ? '不在目前的篩選範圍內' : '不在上市櫃普通股清單內';
};

/* ---------- 輸出 ---------- */
SC.CSV_BASE_HEAD = ['資料日期', '多空', '條件', '代號', '名稱', '市場', '產業', '收盤', '漲跌幅(%)', '20日均量(張)', '在榜天數', '除息日', '除息影響', '自選股', '上週週收盤', '上週週MA10', '前一週週MA10', '上週週RSI6', '前一週週RSI6', '上週週MACD柱狀體', '上週週開盤', '上週週MA30'];
SC.csvBase = (cur, side, title, s, key) => [
  cur.date, side, title, s.id, s.name, SC.MKT[s.mkt] || '', s.ind || '', SC.f2(s.close),
  s.chg == null ? '' : s.chg.toFixed(2), s.v20 ?? '', SC.streakOf(s, key) ?? '',
  s.ex ? s.ex.d : '', SC.exHitOf(s, key) ? '是' : '', SC.watch.has(s.id) ? '是' : '',
  s.wk ? SC.f2(s.wk.c) : '', s.wk ? SC.f2(s.wk.ma) : '', s.wk && s.wk.mp != null ? SC.f2(s.wk.mp) : '',
  s.wk && s.wk.r6 != null ? SC.f2(s.wk.r6) : '', s.wk && s.wk.rp != null ? SC.f2(s.wk.rp) : '', s.wk && s.wk.osc != null ? SC.f2(s.wk.osc) : '',
  s.wk && s.wk.o != null ? SC.f2(s.wk.o) : '', s.wk && s.wk.ma30 != null ? SC.f2(s.wk.ma30) : ''];
SC.csvName = (cur, side, key) => `技術訊號_${cur.date}_${side}_${SC.FILE_LABEL[key] || key}.csv`;
SC.saveCsv = (name, rows, share) => {
  const csv = '﻿' + rows.map(r => r.map(SC.csvCell).join(',')).join('\r\n');
  const file = new File([csv], name, {type: 'text/csv'});
  if (share && navigator.canShare && navigator.canShare({files: [file]})) {
    navigator.share({files: [file], title: name}).catch(() => {});
    return;
  }
  const url = URL.createObjectURL(file);
  const a = Object.assign(document.createElement('a'), {href: url, download: name});
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1500);
};
SC.copyText = async text => {
  try { await navigator.clipboard.writeText(text); }
  catch (e) {
    const t = Object.assign(document.createElement('textarea'), {value: text});
    t.style.position = 'fixed'; t.style.opacity = '0';
    document.body.appendChild(t); t.select(); document.execCommand('copy'); t.remove();
  }
};
SC.flash = (btn, msg) => {
  const o = btn.textContent; btn.textContent = msg; btn.classList.add('done');
  setTimeout(() => { btn.textContent = o; btn.classList.remove('done'); }, 1500);
};

global.SC = SC;
})(window);
