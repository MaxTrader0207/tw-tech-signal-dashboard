/* 台股技術訊號儀表板 — 電腦版（共用邏輯見 core.js） */
(() => {
const DATA = 'data/';
const $ = id => document.getElementById(id);
const {f2, pct, md, esc, plain, MKT, MA_N, SIG_KEYS} = SC;
let boot = null, cur = null;
let BLOCKS = [];

/* ---------- 基本 UI ---------- */
const tick = () => $('clock').textContent = new Date().toLocaleString('zh-TW', {hour12: false});
tick(); setInterval(tick, 1000);

/* 偏好還原 */
$('v20').value = SC.prefs.get('v20', '100');
$('exx').checked = SC.prefs.get('exx', '') === '1';
$('newOnly').checked = SC.prefs.get('new', '') === '1';
$('watchOnly').checked = SC.prefs.get('watchOnly', '') === '1';
$('wkF').checked = SC.prefs.get('wk', '1') === '1';
const saveOpts = () => {
  SC.prefs.set('v20', $('v20').value);
  SC.prefs.set('exx', $('exx').checked ? '1' : '');
  SC.prefs.set('new', $('newOnly').checked ? '1' : '');
  SC.prefs.set('watchOnly', $('watchOnly').checked ? '1' : '');
  SC.prefs.set('wk', $('wkF').checked ? '1' : '0');
};
const opts = () => ({
  mkt: $('mkt').value, ind: $('ind').value, v20: +$('v20').value,
  exx: $('exx').checked, nw: $('newOnly').checked, watchOnly: $('watchOnly').checked,
  wk: $('wkF').checked, wkStrict: !!cur && (cur.ver || 1) >= 4,
});
const wkOn = () => $('wkF').checked && !!cur && (cur.ver || 1) >= 4;
const wkTitle = key => wkOn() ? `<span class="wkt">${SC.wkSfx(key)}</span>` : '';

/* ---------- 自選股 ---------- */
function syncWatchUI() {
  $('watchInput').value = SC.watch.list().join(' ');
  $('watchInfo').textContent = SC.watch.size ? `共 ${SC.watch.size} 檔` : '尚未設定，可在下方查詢結果點 ☆ 加入';
}
syncWatchUI();

/* ---------- 表格 ---------- */
function table(list, cols, key) {
  if (!list.length) return '<div class="empty">目前無符合條件個股</div>';
  return `<div class="tbl"><table><thead><tr><th>代號</th><th>名稱</th><th>收盤</th><th>漲跌幅</th>${cols.map(c => `<th>${c.h}</th>`).join('')}</tr></thead><tbody>` +
    list.map(s => `<tr${SC.watch.has(s.id) ? ' class="w"' : ''}><td class="id"><a href="#" data-q="${esc(s.id)}">${esc(s.id)}</a></td>` +
      `<td>${SC.star(s)}${esc(s.name)}${SC.marks(s, key)}</td><td class="num">${f2(s.close)}</td><td class="num">${pct(s.chg)}</td>` +
      `${cols.map(c => `<td class="num">${c.v(s)}</td>`).join('')}</tr>`).join('') +
    '</tbody></table></div>';
}

/* ---------- 區塊輸出 ---------- */
function expBtns(key, title, list, cols) {
  const side = /Bull/.test(key) ? '多方' : '空方';
  const i = BLOCKS.push({key, side, title, list: [...list], cols}) - 1;
  const dis = list.length ? '' : ' disabled';
  return `<span class="exp"><button class="xbtn" data-exp="csv" data-b="${i}" title="下載此區塊為 CSV（可用 Excel 開啟）"${dis}>⬇ CSV</button>` +
         `<button class="xbtn" data-exp="copy" data-b="${i}" title="複製此區塊所有股票代號（每行一檔）"${dis}>⧉ 代號</button></span>`;
}
function exportCsv(b) {
  const head = [...SC.CSV_BASE_HEAD, ...b.cols.map(c => plain(c.h))];
  const rows = b.list.map(s => [...SC.csvBase(cur, b.side, b.title, s, b.key), ...b.cols.map(c => plain(c.v(s)))]);
  SC.saveCsv(SC.csvName(cur, b.side, b.key), [head, ...rows], false);
}

const bt = key => SC.btHtml(cur, key, +$('v20').value, {wk: wkOn()});
const cond = (title, list, cols, key) =>
  `<div class="cond"><h4><span>${title}${wkTitle(key)}</span><span class="n">${list.length}</span>${expBtns(key, plain(title) + (wkOn() ? SC.wkSfx(key) : ''), list, cols)}</h4>${bt(key)}${table(list, cols, key)}</div>`;
const box = (cls, badge, title, list, cols, key) =>
  `<div class="mabox ${cls}"><h4><span class="badge">${badge}</span><span class="t">${title}${wkTitle(key)}</span><span class="n">${list.length}</span>${expBtns(key, `${badge}｜${plain(title)}${wkOn() ? SC.wkSfx(key) : ''}`, list, cols)}</h4>${bt(key)}${table(list, cols, key)}</div>`;
const maBox = (n, title, list, cols, key) => box(`ma${n}`, `MA${n}`, title, list, cols, key);

/* ---------- 看板 ---------- */
function render(results) {
  BLOCKS = [];
  const {lists, xi} = SC.build(results);
  const maCols = n => k => [
    {h: `MA${n}`, v: s => f2(s.ma[n])},
    {h: '交叉日', v: s => md(s.sig[k + n].date)},
    {h: '均線斜率', v: s => `<span class="${s.sig[k + n].slope > 0 ? 'up' : 'dn'}">${s.sig[k + n].slope > 0 ? '+' : ''}${s.sig[k + n].slope.toFixed(2)}</span>`},
  ];
  const rsiCols = [{h: 'RSI(6)', v: s => f2(s.rsi)}];
  const oscCols = [
    {h: 'OSC 前2日', v: s => f2(s.osc[0])},
    {h: 'OSC 前1日', v: s => f2(s.osc[1])},
    {h: 'OSC 今日', v: s => `<b class="${s.osc[2] > 0 ? 'up' : 'dn'}">${f2(s.osc[2])}</b>`},
    {h: 'DIF', v: s => f2(s.dif)}, {h: 'MACD', v: s => f2(s.macd)},
  ];
  const xCols = B => [
    {h: '均線', v: s => { const f = SC.fam(s, B); return f.ma.length ? f.ma.map(n => `<span class="mtag" style="background:${SC.MA_COLOR[n]}">${n}</span>`).join(' ') : '—'; }},
    {h: 'RSI(6)', v: s => s.sig['rsi' + B] ? `<b class="${B === 'Bull' ? 'up' : 'dn'}">${f2(s.rsi)}</b>` : f2(s.rsi)},
    {h: 'MACD', v: s => SC.macdTxt(s, B)},
    {h: '訊號', v: s => `<b>${SC.hitCnt(s, B)}</b>`},
  ];
  const uniq = keys => SC.uniq(keys.map(k => lists[k]));

  $('summary').innerHTML = [
    ['掃描檔數', results.length, ''],
    ...(SC.watch.size ? [['⭐ 自選命中', SC.watchHits(results), '']] : []),
    ['交集多方', SC.xTotal(xi, 'Bull'), 'bull'],
    ['交集空方', SC.xTotal(xi, 'Bear'), 'bear'],
    ['均線多方', uniq(['maBull30', 'maBull60', 'maBull100']), 'bull'],
    ['均線空方', uniq(['maBear30', 'maBear60', 'maBear100']), 'bear'],
    ['RSI 多方', lists.rsiBull.length, 'bull'],
    ['RSI 空方', lists.rsiBear.length, 'bear'],
    ['MACD 多方', uniq(['macdBullCross', 'macdBullExp']), 'bull'],
    ['MACD 空方', uniq(['macdBearCross', 'macdBearExp']), 'bear'],
  ].map(([t, v, c]) => `<div class="kpi ${c}"><div class="t">${t}</div><div class="v">${v}</div></div>`).join('');

  const xSide = B => SC.X_GROUPS.map(g => box(g.cls, g.badge, g.title, xi[B][g.f], xCols(B), `x${B}${g.g}`)).join('');

  $('board').innerHTML = `
  <section class="ind xsec">
    <h2>🎯 技術指標交集</h2>
    <div class="def">同時命中兩類以上指標的個股，多空分開計算。三類為：均線（MA30／60／100 任一交叉，表內以 30／60／100 標示）、RSI(6)（≥80／≤20）、MACD（柱狀體翻正／翻負，或連 2 日放大「連增」／減少「連減」）。每檔只列在命中最多的組合中，依訊號數排序。</div>
    <div class="malegend">${SC.X_GROUPS.map(g => `<span><i style="background:${g.color}"></i>${g.badge}</span>`).join('')}</div>
    <div class="sides">
      <div class="side bull"><h3>▲ 多方交集<span class="h3n">${SC.xTotal(xi, 'Bull')} 檔</span></h3>${xSide('Bull')}</div>
      <div class="side bear"><h3>▼ 空方交集<span class="h3n">${SC.xTotal(xi, 'Bear')} 檔</span></h3>${xSide('Bear')}</div>
    </div>
  </section>

  <section class="ind">
    <h2>📈 均線指標</h2>
    <div class="def">日線收盤價與 30／60／100 日均線交叉（近 3 個交易日內發生），並搭配均線方向</div>
    <div class="malegend"><span><i style="background:#f5b83d"></i>MA30 短期</span><span><i style="background:#4da3ff"></i>MA60 中期</span><span><i style="background:#b07cff"></i>MA100 長期</span></div>
    <div class="sides">
      <div class="side bull"><h3>▲ 多方板塊</h3>
        ${MA_N.map(n => maBox(n, `收盤價黃金交叉 MA${n}，且 MA${n} 上揚`, lists['maBull' + n], maCols(n)('maBull'), 'maBull' + n)).join('')}
      </div>
      <div class="side bear"><h3>▼ 空方板塊</h3>
        ${MA_N.map(n => maBox(n, `收盤價死亡交叉 MA${n}，且 MA${n} 下彎`, lists['maBear' + n], maCols(n)('maBear'), 'maBear' + n)).join('')}
      </div>
    </div>
  </section>

  <section class="ind">
    <h2>⚡ RSI 指標</h2>
    <div class="def">RSI 參數 6，日線收盤</div>
    <div class="sides">
      <div class="side bull"><h3>▲ 多方板塊</h3>${cond('RSI(6) ≥ 80', lists.rsiBull, rsiCols, 'rsiBull')}</div>
      <div class="side bear"><h3>▼ 空方板塊</h3>${cond('RSI(6) ≤ 20', lists.rsiBear, rsiCols, 'rsiBear')}</div>
    </div>
  </section>

  <section class="ind">
    <h2>📊 MACD 指標</h2>
    <div class="def">MACD(12,26,9)，柱狀體 OSC＝DIF−MACD，日線</div>
    <div class="malegend"><span><i style="background:#22c7d6"></i>零軸交叉（轉折）</span><span><i style="background:#ff8a3d"></i>柱狀體延續（動能）</span></div>
    <div class="sides">
      <div class="side bull"><h3>▲ 多方板塊</h3>
        ${box('oscx', '交叉', '柱狀體黃金交叉 0（由 ≤0 轉 >0）', lists.macdBullCross, oscCols, 'macdBullCross')}
        ${box('osce', '動能', '柱狀體 > 0，且連續 2 日放大', lists.macdBullExp, oscCols, 'macdBullExp')}
      </div>
      <div class="side bear"><h3>▼ 空方板塊</h3>
        ${box('oscx', '交叉', '柱狀體死亡交叉 0（由 ≥0 轉 <0）', lists.macdBearCross, oscCols, 'macdBearCross')}
        ${box('osce', '動能', '柱狀體 < 0，且連續 2 日減少', lists.macdBearExp, oscCols, 'macdBearExp')}
      </div>
    </div>
  </section>`;
}

/* ---------- 篩選 ---------- */
function fillIndustries() {
  const keep = $('ind').value;
  const inds = [...new Set(cur.stocks.map(s => s.ind).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'zh-Hant'));
  $('ind').innerHTML = '<option value="">全部產業</option>' + inds.map(i => `<option${i === keep ? ' selected' : ''}>${esc(i)}</option>`).join('');
}
function refreshBoard() {
  if (!cur) return;
  render(SC.filter(cur.stocks, opts()));
  if ($('q').value.trim()) query();
}

/* ---------- 個股查詢 ---------- */
function query() {
  const kw = $('q').value.trim();
  if (!kw) { $('queryBox').style.display = 'none'; return; }
  const K = kw.toUpperCase();
  const exact = cur.stocks.filter(s => s.id === K);
  const hits = exact.length ? exact : cur.stocks.filter(s => s.id.startsWith(K) || s.name.includes(kw)).slice(0, 30);
  $('queryBox').style.display = 'block';
  if (!hits.length) {
    $('qInfo').textContent = `「${kw}」無結果：${SC.whyMissing(cur, K, false)}`;
    $('qResult').innerHTML = '';
    return;
  }
  $('qInfo').textContent = `資料日期 ${cur.date}，共 ${hits.length} 檔${hits.length === 30 ? '（最多顯示 30 檔，請輸入更完整的代號或名稱）' : ''}｜點 ☆ 加入自選股`;
  const tags = s => {
    const ks = SIG_KEYS.filter(k => s.sig[k]);
    return ks.length ? ks.map(k => SC.sigTag(s, k)).join('') : '<span class="tag none">無訊號</span>';
  };
  $('qResult').innerHTML = `<div class="tbl"><table><thead><tr>
      <th>代號</th><th>名稱</th><th>自選</th><th>市場</th><th>產業</th><th>收盤</th><th>漲跌幅</th><th>20日均量</th><th>上週週收／週MA10</th>
      <th>MA30</th><th>MA60</th><th>MA100</th><th>RSI(6)</th><th>DIF</th><th>MACD</th><th>OSC</th><th style="text-align:left">命中訊號</th>
    </tr></thead><tbody>` +
    hits.map(s => `<tr${SC.watch.has(s.id) ? ' class="w"' : ''}>
      <td class="id">${esc(s.id)}</td><td>${SC.star(s)}${esc(s.name)}${s.ex ? SC.marks(s, '') : ''}</td>
      <td class="txt"><button class="sbtn${SC.watch.has(s.id) ? ' on' : ''}" data-star="${esc(s.id)}" title="加入／移除自選股">${SC.watch.has(s.id) ? '★' : '☆'}</button></td>
      <td class="txt">${MKT[s.mkt] || ''}</td><td class="txt">${esc(s.ind) || '—'}</td>
      <td class="num">${f2(s.close)}</td><td class="num">${pct(s.chg)}</td><td class="num">${s.v20 == null ? '—' : SC.int(s.v20) + ' 張'}</td><td class="num">${SC.wkCell(s)}</td>
      <td class="num">${f2(s.ma[30])}</td><td class="num">${f2(s.ma[60])}</td><td class="num">${f2(s.ma[100])}</td>
      <td class="num">${f2(s.rsi)}</td><td class="num">${f2(s.dif)}</td><td class="num">${f2(s.macd)}</td>
      <td class="num"><b class="${s.osc[2] > 0 ? 'up' : 'dn'}">${f2(s.osc[2])}</b></td>
      <td class="txt" style="white-space:normal">${tags(s)}</td>
    </tr>`).join('') + '</tbody></table></div>';
}

/* ---------- 切換日期 ---------- */
async function show(date) {
  $('err').textContent = '';
  try {
    cur = await SC.getDay(DATA, boot, date);
    const st = cur.stats || {};
    const ver = cur.ver || 1;
    $('meta').textContent = `資料日期 ${cur.date}｜清單 ${st.universe ?? '—'} 檔，有效 ${st.scanned ?? cur.stocks.length} 檔` +
      `（未取得 ${st.no_data ?? 0}、資料不足 ${st.insufficient ?? 0}、非當日 ${st.stale ?? 0}）｜點選表格代號可查看個股明細` +
      (ver < 2 ? '｜⚠ 此日期為舊格式資料，均量篩選、除息與新增標記不適用' : ver < 3 ? '｜此日期資料尚無歷史回測' : '') +
      (ver < 4 ? '｜⚠ 此日期資料尚無週線資訊，週線濾網不適用' : ver < 5 ? '｜⚠ 此日期為舊版週線條件（多方：週收盤站上週MA10）' : '');
    $('btNote').innerHTML = cur.bt
      ? `<span>📊 歷史回測期間 ${SC.btPeriod(cur)}：訊號首日出現後持有 5／10／20 個交易日，多方看上漲機率、空方看下跌機率；<b style="color:var(--accent)">金色</b>＝高於同期全體個股基準 3 個百分點以上。回測結果隨「20 日均量」篩選切換。</span>`
      : '';
    $('dataDate').textContent = cur.date;
    $('genTime').textContent = cur.generated_at ? new Date(cur.generated_at).toLocaleString('zh-TW', {hour12: false}) : '—';
    fillIndustries();
    refreshBoard();
  } catch (e) {
    $('err').textContent = `無法載入 ${date} 的資料：${e.message}`;
  }
}

async function init() {
  try {
    boot = await SC.boot(DATA);
    if (!boot.latestDate) throw new Error('尚無資料');
    $('date').innerHTML = boot.dates.map(d => `<option value="${d.date}">${d.date}（${d.count} 檔）</option>`).join('');
    const q = new URLSearchParams(location.search).get('q');
    if (q) $('q').value = q;
    await show(boot.latestDate);
  } catch (e) {
    $('meta').textContent = '';
    $('err').textContent = '尚無掃描資料：請到 GitHub repo 的 Actions 分頁手動執行「每日技術訊號掃描」。（' + e.message + '）';
  }
}

/* ---------- 事件 ---------- */
$('date').addEventListener('change', e => show(e.target.value));
$('mkt').addEventListener('change', refreshBoard);
$('ind').addEventListener('change', refreshBoard);
['v20', 'exx', 'newOnly', 'watchOnly', 'wkF'].forEach(id => $(id).addEventListener('change', () => { saveOpts(); refreshBoard(); }));
const applyWatchInput = () => { SC.watch.setAll(SC.parseIds($('watchInput').value)); syncWatchUI(); refreshBoard(); };
$('watchInput').addEventListener('keydown', e => { if (e.key === 'Enter') applyWatchInput(); });
$('watchInput').addEventListener('change', applyWatchInput);
$('qBtn').addEventListener('click', query);
$('q').addEventListener('keydown', e => { if (e.key === 'Enter') query(); });
$('qClr').addEventListener('click', () => { $('q').value = ''; query(); });
$('queryBox').addEventListener('click', e => {
  const st = e.target.closest('[data-star]'); if (!st) return;
  SC.watch.toggle(st.dataset.star); syncWatchUI(); refreshBoard();
});
$('board').addEventListener('click', async e => {
  const x = e.target.closest('button[data-exp]');
  if (x) {
    const b = BLOCKS[+x.dataset.b]; if (!b || !b.list.length) return;
    if (x.dataset.exp === 'csv') { exportCsv(b); SC.flash(x, '✓ 已下載'); }
    else { await SC.copyText(b.list.map(s => s.id).join('\n')); SC.flash(x, `✓ ${b.list.length} 檔`); }
    return;
  }
  const a = e.target.closest('a[data-q]'); if (!a) return;
  e.preventDefault(); $('q').value = a.dataset.q; query();
  $('queryBox').scrollIntoView({behavior: 'smooth', block: 'start'});
});

init();
})();
