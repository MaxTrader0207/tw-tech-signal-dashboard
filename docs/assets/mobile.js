/* 台股技術訊號儀表板 — 手機版（共用邏輯見 core.js） */
(() => {
const DATA = '../data/';
const PAGE = 30;
const $ = id => document.getElementById(id);
const {f2, md, esc, cls, pctTxt, MKT, MA_N, SIG_KEYS} = SC;
let boot = null, cur = null, results = [], lists = {}, xi = {};
let tab = 'x', side = 'Bull';
const open = new Set(), shown = {};
let BLK = {};
const opt = {exx: false, nw: false, watchOnly: false, wk: true};

/* ---------- 偏好 ---------- */
$('v20').value = SC.prefs.get('v20', '100');
opt.exx = SC.prefs.get('exx', '') === '1';
opt.nw = SC.prefs.get('new', '') === '1';
opt.watchOnly = SC.prefs.get('watchOnly', '') === '1';
opt.wk = SC.prefs.get('wk', '1') === '1';
const saveOpts = () => {
  SC.prefs.set('v20', $('v20').value);
  SC.prefs.set('exx', opt.exx ? '1' : ''); SC.prefs.set('new', opt.nw ? '1' : ''); SC.prefs.set('watchOnly', opt.watchOnly ? '1' : ''); SC.prefs.set('wk', opt.wk ? '1' : '0');
};
const syncTg = () => {
  $('exx').classList.toggle('on', opt.exx);
  $('newOnly').classList.toggle('on', opt.nw);
  $('watchOnly').classList.toggle('on', opt.watchOnly);
  $('wkF').classList.toggle('on', opt.wk);
  $('watchOnly').textContent = `⭐ 只看自選${SC.watch.size ? `（${SC.watch.size}）` : ''}`;
};
syncTg();

/* ---------- 計算 ---------- */
function compute() {
  results = SC.filter(cur.stocks, {mkt: $('mkt').value, ind: $('ind').value, v20: +$('v20').value, exx: opt.exx, nw: opt.nw,
    watchOnly: opt.watchOnly, wk: opt.wk, wkStrict: (cur.ver || 1) >= 4});
  ({lists, xi} = SC.build(results));
}

const wkOn = () => opt.wk && !!cur && (cur.ver || 1) >= 4;
function blocksFor(t, B) {
  const bull = B === 'Bull';
  if (t === 'x') return SC.X_GROUPS.map(g => ({key: `x${B}${g.g}`, cls: g.cls, badge: g.badge, title: g.g === '3' ? g.title : '兩項命中', list: xi[B][g.f], kind: 'x'}));
  if (t === 'ma') return MA_N.map(n => ({
    key: `ma${B}${n}`, cls: `ma${n}`, badge: `MA${n}`, n, kind: 'ma', list: lists[`ma${B}${n}`],
    title: bull ? `收盤價黃金交叉，MA${n} 上揚` : `收盤價死亡交叉，MA${n} 下彎`,
  }));
  if (t === 'rsi') return [{key: `rsi${B}`, cls: 'rsi', badge: 'RSI(6)', kind: 'rsi', list: lists[`rsi${B}`], title: bull ? 'RSI(6) ≥ 80' : 'RSI(6) ≤ 20'}];
  if (t === 'macd') return [
    {key: `macd${B}Cross`, cls: 'oscx', badge: '交叉', kind: 'macd', list: lists[`macd${B}Cross`], title: bull ? '柱狀體由 ≤0 轉 >0' : '柱狀體由 ≥0 轉 <0'},
    {key: `macd${B}Exp`, cls: 'osce', badge: '動能', kind: 'macd', list: lists[`macd${B}Exp`], title: bull ? '柱狀體 >0 且連 2 日放大' : '柱狀體 <0 且連 2 日減少'},
  ];
  return [];
}
const sideCount = (t, B) => SC.uniq(blocksFor(t, B).map(b => b.list));

/* ---------- 卡片 ---------- */
function metrics(b, s, B) {
  if (b.kind === 'ma') {
    const g = s.sig[b.key];
    return `<span>MA${b.n} <b>${f2(s.ma[b.n])}</b></span><span>交叉 <b>${md(g.date)}</b></span><span>斜率 <b class="${cls(g.slope)}">${g.slope > 0 ? '+' : ''}${g.slope.toFixed(2)}</b></span>`;
  }
  if (b.kind === 'rsi') return `<span>RSI(6) <b class="${B === 'Bull' ? 'up' : 'dn'}">${f2(s.rsi)}</b></span><span>OSC <b class="${cls(s.osc[2])}">${f2(s.osc[2])}</b></span>`;
  if (b.kind === 'macd') return `<span>OSC <b>${f2(s.osc[0])}</b> → <b>${f2(s.osc[1])}</b> → <b class="${cls(s.osc[2])}">${f2(s.osc[2])}</b></span><span>DIF <b>${f2(s.dif)}</b></span><span>MACD <b>${f2(s.macd)}</b></span>`;
  const f = SC.fam(s, B);
  const ma = f.ma.length ? f.ma.map(n => `<span class="mt" style="background:${SC.MA_COLOR[n]}">${n}</span>`).join('') : '—';
  return `<span>均線 ${ma}</span><span>RSI <b class="${f.rsi ? (B === 'Bull' ? 'up' : 'dn') : ''}">${f2(s.rsi)}</b></span><span>MACD <b>${SC.macdTxt(s, B)}</b></span><span>訊號 <b>${SC.hitCnt(s, B)}</b></span>`;
}
const row = (s, mhtml, key = '') => `<div class="row${SC.watch.has(s.id) ? ' w' : ''}" data-id="${esc(s.id)}">
  <div class="r1"><span class="code">${esc(s.id)}</span><span class="nm">${SC.star(s)}${esc(s.name)}</span>${SC.marks(s, key)}<span class="px">${f2(s.close)}</span><span class="chg ${cls(s.chg)}">${pctTxt(s.chg)}</span></div>
  <div class="r2">${mhtml}</div></div>`;

function blockBody(b) {
  const bt = SC.btHtml(cur, b.key, +$('v20').value, {short: true, wk: wkOn()});
  if (!b.list.length) return bt + '<div class="none">目前無符合條件個股</div>';
  const n = shown[b.key] || PAGE;
  const rows = b.list.slice(0, n).map(s => row(s, metrics(b, s, side), b.key)).join('');
  const rest = b.list.length - n;
  return bt + `<div class="tools"><button data-exp="copy" data-k="${b.key}">⧉ 複製代號</button><button data-exp="csv" data-k="${b.key}">⬇ CSV</button></div>` +
    rows + (rest > 0 ? `<button class="more" data-more="${b.key}">再顯示 ${Math.min(PAGE, rest)} 檔（尚餘 ${rest} 檔）</button>` : '');
}

/* ---------- 畫面 ---------- */
function renderKpis() {
  const u = (t, B) => sideCount(t, B);
  $('kpis').innerHTML = [
    ['掃描檔數', results.length, ''],
    ...(SC.watch.size ? [['⭐ 自選命中', SC.watchHits(results), '']] : []),
    ['交集多方', u('x', 'Bull'), 'bull'], ['交集空方', u('x', 'Bear'), 'bear'],
    ['均線多方', u('ma', 'Bull'), 'bull'], ['均線空方', u('ma', 'Bear'), 'bear'],
    ['RSI 多方', u('rsi', 'Bull'), 'bull'], ['RSI 空方', u('rsi', 'Bear'), 'bear'],
    ['MACD 多方', u('macd', 'Bull'), 'bull'], ['MACD 空方', u('macd', 'Bear'), 'bear'],
  ].map(([t, v, c]) => `<div class="kpi ${c}"><div class="t">${t}</div><div class="v">${v}</div></div>`).join('');
}

const DESC = {
  x: '同時命中兩類以上指標（均線、RSI、MACD）的個股，每檔只列在命中最多的組合。',
  ma: '日線收盤價與 MA30／60／100 交叉（多方為最近 1 個交易日、空方近 3 個交易日內），並搭配均線方向。',
  rsi: 'RSI 參數 6，日線收盤。',
  macd: 'MACD(12,26,9)，柱狀體 OSC＝DIF−MACD。',
};

function renderMain() {
  if (!cur) return;
  if (tab === 'q') { renderQuery(); return; }
  const bs = blocksFor(tab, side);
  BLK = {}; bs.forEach(b => BLK[b.key] = b);
  if (![...open].some(k => BLK[k])) { const first = bs.find(b => b.list.length); if (first) open.add(first.key); }
  $('main').innerHTML =
    `<div class="desc">${DESC[tab]}${cur.bt ? `　展開區塊可看歷史回測（${SC.btPeriod(cur)}）。` : ''}</div>
     <div class="seg" id="seg">
       <button class="bull ${side === 'Bull' ? 'on' : ''}" data-side="Bull">▲ 多方<span class="c">${sideCount(tab, 'Bull')}</span></button>
       <button class="bear ${side === 'Bear' ? 'on' : ''}" data-side="Bear">▼ 空方<span class="c">${sideCount(tab, 'Bear')}</span></button>
     </div>` +
    bs.map(b => `<section class="blk ${b.cls} ${open.has(b.key) ? 'open' : ''} ${b.list.length ? '' : 'empty'}" data-k="${b.key}">
      <div class="bh" data-toggle="${b.key}"><span class="badge">${b.badge}</span><span class="sp"></span><span class="n">${b.list.length}</span><span class="chev">▶</span><span class="ti">${b.title}${wkOn() ? `<span class="wkt">${SC.wkSfx(b.key)}</span>` : ''}</span></div>
      <div class="bb">${open.has(b.key) ? blockBody(b) : ''}</div></section>`).join('');
  setSegTop();
}

function refreshBlock(key) {
  const sec = document.querySelector(`.blk[data-k="${key}"]`); if (!sec) return;
  sec.classList.toggle('open', open.has(key));
  sec.querySelector('.bb').innerHTML = open.has(key) ? blockBody(BLK[key]) : '';
}
function setSegTop() { document.documentElement.style.setProperty('--seg-top', ($('top').offsetHeight + 6) + 'px'); }

/* ---------- 查詢與自選清單 ---------- */
let qText = '';
const sigSummary = s => {
  const k = SIG_KEYS.filter(k => s.sig[k]);
  return k.length ? `<span>訊號 <b>${k.length}</b></span>` + k.slice(0, 3).map(x => `<span class="${/Bull/.test(x) ? 'up' : 'dn'}">${/Bull/.test(x) ? '▲' : '▼'}${SC.SIG_LABEL[x]}</span>`).join('') : '<span>無訊號</span>';
};
const infoRow = s => row(s, `<span>${MKT[s.mkt] || ''}</span><span>${esc(s.ind) || ''}</span>${s.v20 != null ? `<span>均量 <b>${SC.int(s.v20)}</b> 張</span>` : ''}` + sigSummary(s));

function renderQuery() {
  $('main').innerHTML = `<div class="qbar"><input id="q" type="search" inputmode="search" enterkeyhint="search" placeholder="代號或名稱，如 2330、台積" value="${esc(qText)}" autocomplete="off"><button id="qBtn">查詢</button></div>
    <div class="qinfo" id="qInfo">輸入代號或名稱後按查詢；點選結果可看完整明細，並可加入自選股。</div><div id="qRes"></div>`;
  $('qBtn').onclick = doQuery;
  $('q').addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); doQuery(); $('q').blur(); } });
  if (qText) doQuery(); else renderWatchList();
}
function renderWatchList() {
  const ids = SC.watch.list();
  if (!ids.length) { $('qRes').innerHTML = '<div class="sec2">⭐ 我的自選股 <small>尚未加入</small></div><div class="none" style="padding:0 2px">查詢個股後，在明細右上角點 ☆ 即可加入。</div>'; return; }
  const items = ids.map(id => cur.stocks.find(s => s.id === id)).filter(Boolean);
  const missing = ids.filter(id => !cur.stocks.some(s => s.id === id));
  $('qRes').innerHTML = `<div class="sec2">⭐ 我的自選股 <small>${ids.length} 檔</small></div>` +
    (items.length ? `<div class="qlist">${items.map(infoRow).join('')}</div>` : '') +
    (missing.length ? `<div class="qinfo" style="margin-top:8px">不在今日掃描結果：${missing.map(esc).join('、')}</div>` : '');
}
function doQuery() {
  qText = $('q').value.trim();
  const kw = qText; if (!kw) { $('qInfo').textContent = '輸入代號或名稱後按查詢；點選結果可看完整明細，並可加入自選股。'; renderWatchList(); return; }
  const K = kw.toUpperCase();
  const exact = cur.stocks.filter(s => s.id === K);
  const hits = exact.length ? exact : cur.stocks.filter(s => s.id.startsWith(K) || s.name.includes(kw)).slice(0, 50);
  if (!hits.length) { $('qInfo').textContent = `「${kw}」無結果：${SC.whyMissing(cur, K, false)}`; $('qRes').innerHTML = ''; return; }
  if (exact.length === 1) { $('qInfo').textContent = `資料日期 ${cur.date}`; $('qRes').innerHTML = `<div class="qlist">${infoRow(exact[0])}</div>`; openSheet(exact[0].id); return; }
  $('qInfo').textContent = `共 ${hits.length} 檔${hits.length === 50 ? '（最多顯示 50 檔）' : ''}，點選看明細`;
  $('qRes').innerHTML = `<div class="qlist">${hits.map(infoRow).join('')}</div>`;
}

/* ---------- 明細彈窗 ---------- */
function openSheet(id) {
  const s = cur.stocks.find(x => x.id === id); if (!s) return;
  const ks = SIG_KEYS.filter(k => s.sig[k]);
  const tags = ks.length ? ks.map(k => SC.sigTag(s, k)).join('') : '<span class="tag na">今日無訊號</span>';
  const xb = SC.hitCnt(s, 'Bull'), xr = SC.hitCnt(s, 'Bear');
  const w = SC.watch.has(s.id);
  const cell = (k, v, c = '') => `<div class="cell"><div class="k">${k}</div><div class="v ${c}">${v}</div></div>`;
  $('sheet').innerHTML = `<div class="grab"></div>
    <div class="sh"><div class="ttl"><span class="c">${esc(s.id)}</span><span class="nm">${esc(s.name)}</span>
      <div class="sub">${MKT[s.mkt] || ''}${s.ind ? '｜' + esc(s.ind) : ''}｜資料日期 ${cur.date}</div></div>
      <button class="wbtn${w ? ' on' : ''}" id="shStar" data-id="${esc(s.id)}">${w ? '★ 自選' : '☆ 自選'}</button>
      <button class="x" id="shClose" aria-label="關閉">✕</button></div>
    <div class="pxl"><span class="p">${f2(s.close)}</span><span class="g ${cls(s.chg)}">${pctTxt(s.chg)}</span></div>
    ${s.ex ? `<div class="exnote">💰 ${md(s.ex.d)} 除息${s.ex.div ? ` ${s.ex.div} 元` : ''}${s.exHit ? '。以還原權息價計算時，標示 ⚠ 的訊號不成立，可能是除息跳空造成。' : '，目前訊號不受除息影響。'}</div>` : ''}
    <div class="sec">命中訊號（多方 ${xb}／空方 ${xr}）</div><div class="tags" style="margin-bottom:14px">${tags}</div>
    <div class="grid" style="margin-bottom:14px">${cell('20 日均量', s.v20 == null ? '—' : SC.int(s.v20) + ' 張')}${cell('今日成交量', s.vol == null ? '—' : SC.int(s.vol / 1000) + ' 張')}</div>
    <div class="sec">上週週線${s.wk ? `（${md(s.wk.d)} 當週）` : ''}</div>
    <div class="grid" style="margin-bottom:14px">${cell('週收盤', s.wk ? f2(s.wk.c) : '—', s.wk ? (s.wk.dn ? 'dn' : 'up') : '')}${cell('週 MA10', s.wk ? f2(s.wk.ma) + SC.wkArrow(s) : '—', s.wk && s.wk.mp != null ? (s.wk.ma > s.wk.mp ? 'up' : 'dn') : '')}${cell('前一週 MA10', s.wk && s.wk.mp != null ? f2(s.wk.mp) : '—')}
      ${cell('週開盤', s.wk && s.wk.o != null ? f2(s.wk.o) : '—')}${cell('週 K', s.wk && s.wk.o != null ? (SC.wkRed(s) ? '紅K' : '黑K') : '—', s.wk && s.wk.o != null ? (SC.wkRed(s) ? 'up' : 'dn') : '')}${cell('週 MA30', s.wk && s.wk.ma30 != null ? f2(s.wk.ma30) : '—', s.wk && s.wk.ma30 != null ? (SC.wkAbove30(s) ? 'up' : 'dn') : '')}${cell('多方條件', s.wk ? (SC.wkBull(s) ? '✓ 站上週MA30' : '✗ 未站上週MA30') : '—', s.wk ? (SC.wkBull(s) ? 'up' : '') : '')}${cell('空方條件', s.wk ? (s.wk.dn ? '✓ 收盤跌破' : '✗ 未跌破') : '—', s.wk ? (s.wk.dn ? 'dn' : '') : '')}</div>
    <div class="sec">均線</div>
    <div class="grid">${[10, ...MA_N].filter(n => s.ma[n] != null).map(n => cell('MA' + n, f2(s.ma[n]), s.close > s.ma[n] ? 'up' : 'dn')).join('')}</div>
    <div class="sec">RSI ／ MACD</div>
    <div class="grid">${cell('RSI(6)', f2(s.rsi), s.rsi >= 80 ? 'up' : s.rsi <= 20 ? 'dn' : '')}${cell('DIF', f2(s.dif))}${cell('MACD', f2(s.macd))}
      ${cell('OSC 前2日', f2(s.osc[0]), cls(s.osc[0]))}${cell('OSC 前1日', f2(s.osc[1]), cls(s.osc[1]))}${cell('OSC 今日', f2(s.osc[2]), cls(s.osc[2]))}</div>
    <div class="sec" style="font-weight:400">收盤價高於均線以紅字、低於以綠字顯示。</div>`;
  $('mask').classList.add('on'); $('sheet').classList.add('on'); $('sheet').scrollTop = 0;
  $('shClose').onclick = closeSheet;
  $('shStar').onclick = e => {
    const on = SC.watch.toggle(s.id);
    e.currentTarget.classList.toggle('on', on); e.currentTarget.textContent = on ? '★ 自選' : '☆ 自選';
    watchChanged = true;
  };
  document.body.style.overflow = 'hidden';
  if (!history.state || !history.state.sheet) history.pushState({sheet: 1}, '');
}
let watchChanged = false;
function closeSheet(fromPop) {
  if (!$('sheet').classList.contains('on')) return;
  $('mask').classList.remove('on'); $('sheet').classList.remove('on');
  document.body.style.overflow = '';
  if (fromPop !== true && history.state && history.state.sheet) history.back();
  if (watchChanged) { watchChanged = false; syncTg(); refilter(true); }
}
$('mask').onclick = closeSheet;
window.addEventListener('popstate', () => closeSheet(true));
(() => { let y0 = null;
  $('sheet').addEventListener('touchstart', e => { y0 = $('sheet').scrollTop <= 0 ? e.touches[0].clientY : null; }, {passive: true});
  $('sheet').addEventListener('touchend', e => { if (y0 != null && e.changedTouches[0].clientY - y0 > 90) closeSheet(); y0 = null; }, {passive: true});
})();

/* ---------- 輸出 ---------- */
function exportCsv(b) {
  const B = side, sideTxt = B === 'Bull' ? '多方' : '空方';
  const extraH = {ma: [`MA${b.n}`, '交叉日', '均線斜率'], rsi: ['RSI(6)'], macd: ['OSC 前2日', 'OSC 前1日', 'OSC 今日', 'DIF', 'MACD'], x: ['均線', 'RSI(6)', 'MACD', '訊號']}[b.kind];
  const extra = s => b.kind === 'ma' ? [f2(s.ma[b.n]), md(s.sig[b.key].date), s.sig[b.key].slope.toFixed(2)]
    : b.kind === 'rsi' ? [f2(s.rsi)]
    : b.kind === 'macd' ? [f2(s.osc[0]), f2(s.osc[1]), f2(s.osc[2]), f2(s.dif), f2(s.macd)]
    : [SC.fam(s, B).ma.join(' '), f2(s.rsi), SC.macdTxt(s, B), SC.hitCnt(s, B)];
  const head = [...SC.CSV_BASE_HEAD, ...extraH];
  const rows = b.list.map(s => [...SC.csvBase(cur, sideTxt, `${b.badge}｜${b.title}${wkOn() ? SC.wkSfx(b.key) : ''}`, s, b.key), ...extra(s)]);
  SC.saveCsv(SC.csvName(cur, sideTxt, b.key), [head, ...rows], true);
}

/* ---------- 事件 ---------- */
$('main').addEventListener('click', async e => {
  const sd = e.target.closest('[data-side]');
  if (sd) { if (side !== sd.dataset.side) { side = sd.dataset.side; open.clear(); renderMain(); } return; }
  const tg = e.target.closest('[data-toggle]');
  if (tg) { const k = tg.dataset.toggle; if (!BLK[k].list.length) return; open.has(k) ? open.delete(k) : open.add(k); refreshBlock(k); return; }
  const mo = e.target.closest('[data-more]');
  if (mo) { const k = mo.dataset.more; shown[k] = (shown[k] || PAGE) + PAGE; refreshBlock(k); return; }
  const ex = e.target.closest('[data-exp]');
  if (ex) {
    const b = BLK[ex.dataset.k];
    if (ex.dataset.exp === 'csv') { exportCsv(b); SC.flash(ex, '✓ 已輸出'); }
    else { await SC.copyText(b.list.map(s => s.id).join('\n')); SC.flash(ex, `✓ 已複製 ${b.list.length} 檔`); }
    return;
  }
  const r = e.target.closest('.row[data-id]');
  if (r) openSheet(r.dataset.id);
});
$('tabs').addEventListener('click', e => {
  const t = e.target.closest('[data-tab]'); if (!t || t.dataset.tab === tab) return;
  tab = t.dataset.tab; open.clear();
  document.querySelectorAll('.tab').forEach(x => x.classList.toggle('on', x === t));
  renderMain(); window.scrollTo({top: 0});
});
function refilter(keepOpen) {
  if (!cur) return;
  compute();
  if (!keepOpen) Object.keys(shown).forEach(k => delete shown[k]);
  renderKpis(); renderMain();
}
$('mkt').addEventListener('change', () => refilter());
$('ind').addEventListener('change', () => refilter());
$('v20').addEventListener('change', () => { saveOpts(); refilter(); });
for (const [id, k] of [['wkF', 'wk'], ['exx', 'exx'], ['newOnly', 'nw'], ['watchOnly', 'watchOnly']]) {
  $(id).addEventListener('click', () => { opt[k] = !opt[k]; syncTg(); saveOpts(); refilter(); });
}
$('date').addEventListener('change', e => show(e.target.value));
window.addEventListener('resize', setSegTop);

/* ---------- 啟動 ---------- */
function fillIndustries() {
  const keep = $('ind').value;
  const inds = [...new Set(cur.stocks.map(s => s.ind).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'zh-Hant'));
  $('ind').innerHTML = '<option value="">全部</option>' + inds.map(i => `<option${i === keep ? ' selected' : ''}>${esc(i)}</option>`).join('');
}
async function show(date) {
  $('err').textContent = '';
  try {
    cur = await SC.getDay(DATA, boot, date);
    const st = cur.stats || {};
    const ver = cur.ver || 1;
    const gt = cur.generated_at ? new Date(cur.generated_at).toLocaleString('zh-TW', {hour12: false, month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit'}) : '—';
    $('meta').textContent = `資料日期 ${cur.date}｜有效 ${st.scanned ?? cur.stocks.length} 檔｜更新 ${gt}` +
      (ver < 2 ? '｜⚠ 舊格式資料，均量／除息／新增標記不適用' : ver < 3 ? '｜此日期尚無歷史回測' : '') +
      (ver < 4 ? '｜⚠ 尚無週線資訊，週線濾網不適用' : ver < 5 ? '｜⚠ 舊版週線條件（多方：週收站上週MA10）'
        : ver < 6 ? '｜⚠ 舊版週線條件（多方：週MA10上揚）' : ver < 7 ? '｜⚠ 舊版週線條件（多方：週RSI6>50）' : ver < 9 ? '｜⚠ 多方均線交叉為舊版視窗（舊資料）' : '') +
      (ver >= 4 && ver < 13 ? '｜⚠ 舊版多方週線條件' : '');
    fillIndustries(); refilter();
  } catch (e) { $('err').textContent = `無法載入 ${date} 的資料：${e.message}`; }
}
async function init() {
  try {
    boot = await SC.boot(DATA);
    if (!boot.latestDate) throw new Error('尚無資料');
    $('date').innerHTML = boot.dates.map(d => `<option value="${d.date}">${d.date}</option>`).join('');
    const p = new URLSearchParams(location.search);
    if (p.get('q')) { qText = p.get('q'); tab = 'q'; document.querySelectorAll('.tab').forEach(x => x.classList.toggle('on', x.dataset.tab === 'q')); }
    await show(boot.latestDate);
  } catch (e) {
    $('meta').textContent = '';
    $('err').textContent = '尚無掃描資料，請稍後再試。（' + e.message + '）';
  }
}
setSegTop();
init();
})();
