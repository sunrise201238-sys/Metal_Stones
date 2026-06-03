'use strict';

/* ============================================================
   地金価値 簡単確認 — main logic
   - prices.json を読み込み
   - 商品価格を「金属の価値」と「石の価値」に分割
   - データベース表示 / 編集 / GitHub保存
   ============================================================ */

const CFG = window.APP_CONFIG || {};
const $ = (id) => document.getElementById(id);

const PURITY = {
  Au: [
    { label: 'K24 (24金 / 純金)', value: 24 },
    { label: 'K22 (22金)', value: 22 },
    { label: 'K20 (20金)', value: 20 },
    { label: 'K18 (18金)', value: 18 },
    { label: 'K14 (14金)', value: 14 },
    { label: 'K10 (10金)', value: 10 },
    { label: 'K9 (9金)', value: 9 },
  ],
  Pt: [
    { label: 'Pt1000 (純プラチナ)', value: 1000 },
    { label: 'Pt950', value: 950 },
    { label: 'Pt900', value: 900 },
    { label: 'Pt850', value: 850 },
  ],
};
const DEFAULT_PURITY = { Au: 18, Pt: 900 };

// 1カラット = 0.2g（石の重量を全体重量から差し引く）
const GRAM_PER_CARAT = 0.2;

let DATA = { source: '', netJapan: { Au: 0, Pt: 0 }, prices: [] };
let editData = null; // 編集用の作業コピー
let priceOverride = null; // ユーザーが手入力した地金価格（null = データベースから自動）

/* ---------- 数値フォーマット ---------- */
const yen = (n) => '¥' + Math.round(n).toLocaleString('ja-JP');
const numFmt = (n, d = 3) =>
  Number(n.toFixed(d)).toLocaleString('ja-JP', { maximumFractionDigits: d });

/* ============================================================
   起動
   ============================================================ */
document.addEventListener('DOMContentLoaded', init);

async function init() {
  setupTabs();
  setupPurity();
  setupCalc();
  setupDbEdit();

  // 購入日の初期値 = 今日
  $('in-date').value = new Date().toISOString().slice(0, 10);

  try {
    const res = await fetch('prices.json?_=' + Date.now());
    if (!res.ok) throw new Error('HTTP ' + res.status);
    DATA = normalize(await res.json());
    renderDatabase();
    $('foot-status').textContent =
      `データ ${DATA.prices.length} 件（${DATA.prices[0].date} 〜 ${DATA.prices[DATA.prices.length - 1].date}）`;
  } catch (e) {
    $('foot-status').textContent = 'prices.json を読み込めませんでした: ' + e.message;
  }
}

function normalize(d) {
  const out = {
    source: d.source || '',
    netJapan: d.netJapan || { Au: 0, Pt: 0 },
    prices: (d.prices || []).map((p) => ({
      date: p.date,
      gold: Number(p.gold),
      platinum: Number(p.platinum),
    })),
  };
  out.prices.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  return out;
}

/* ============================================================
   タブ
   ============================================================ */
function setupTabs() {
  document.querySelectorAll('.tab-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.tab-btn').forEach((b) => b.classList.remove('active'));
      document.querySelectorAll('.tab-panel').forEach((p) => p.classList.remove('active'));
      btn.classList.add('active');
      $('tab-' + btn.dataset.tab).classList.add('active');
    });
  });
}

/* ============================================================
   純度プルダウン
   ============================================================ */
function setupPurity() {
  $('in-metal').addEventListener('change', () => {
    fillPurity($('in-metal').value);
    priceOverride = null; // 金属を変えたら自動価格に戻す
    calculate();
  });
  $('in-purity').addEventListener('change', () => {
    const custom = $('in-purity').value === 'custom';
    $('custom-purity-wrap').classList.toggle('hidden', !custom);
    calculate();
  });
  fillPurity('Au');
}

function fillPurity(metal) {
  const sel = $('in-purity');
  sel.innerHTML = '';
  PURITY[metal].forEach((o) => {
    const opt = document.createElement('option');
    opt.value = String(o.value);
    opt.textContent = o.label;
    if (o.value === DEFAULT_PURITY[metal]) opt.selected = true;
    sel.appendChild(opt);
  });
  const c = document.createElement('option');
  c.value = 'custom';
  c.textContent = 'カスタム（数値入力）';
  sel.appendChild(c);
  $('custom-purity-wrap').classList.add('hidden');
}

/* ============================================================
   価格の検索（指定日に最も近い日付。前後どちらでも可）
   ※ 価格データは日付の昇順に並んでいる前提
   ============================================================ */
function lookupPrice(isoDate, metal) {
  if (!DATA.prices.length) return null;
  const target = Date.parse(isoDate);
  let chosen = null;
  let best = Infinity;
  for (const p of DATA.prices) {
    const diff = Math.abs(Date.parse(p.date) - target);
    if (diff < best) {
      best = diff;
      chosen = p;
    } else if (diff > best) {
      break; // 昇順なので最小を過ぎたら以降は遠ざかるだけ
    }
  }
  if (!chosen) return null;
  return {
    row: chosen,
    perGram: metal === 'Au' ? chosen.gold : chosen.platinum,
    exact: chosen.date === isoDate,
  };
}

function purityFactor(metal, purity) {
  return metal === 'Au' ? purity / 24 : purity / 1000;
}

/* ============================================================
   計算
   ============================================================ */
function setupCalc() {
  $('btn-calc').addEventListener('click', calculate);
  // 購入日を変えたら自動価格に戻す
  $('in-date').addEventListener('input', () => {
    priceOverride = null;
    calculate();
  });
  ['in-weight', 'in-carat', 'in-price', 'in-purity-custom'].forEach((id) =>
    $(id).addEventListener('input', calculate)
  );
  // 地金価格をユーザーが直接編集（カスタム）
  $('in-ppg').addEventListener('input', () => {
    const v = parseFloat($('in-ppg').value);
    priceOverride = isFinite(v) && v > 0 ? v : null;
    calculate();
  });
}

function calculate() {
  const note = $('r-note');
  const showNote = (msg, warn) => {
    note.textContent = msg;
    note.classList.toggle('warn', !!warn);
    note.hidden = false;
  };
  note.hidden = true;
  note.classList.remove('warn');

  const date = $('in-date').value;
  const metal = $('in-metal').value;
  const purity =
    $('in-purity').value === 'custom'
      ? parseFloat($('in-purity-custom').value)
      : parseFloat($('in-purity').value);
  const weight = parseFloat($('in-weight').value);
  const carat = parseFloat($('in-carat').value) || 0;
  const price = parseFloat($('in-price').value);

  if (!date || !(purity > 0) || !(weight > 0) || !(price > 0)) {
    $('result').hidden = true;
    return;
  }
  if (!DATA.prices.length) {
    $('result').hidden = false;
    showNote('地金価格データが読み込まれていません。', true);
    return;
  }

  const lk = lookupPrice(date, metal);
  const custom = priceOverride != null;

  // 適用する地金価格（¥/g）と、その横に出す日付ラベルを決める
  let perGram, dateLabel;
  if (custom) {
    perGram = priceOverride;
    dateLabel = 'XXXX/XX/XX';
  } else {
    if (!lk) {
      $('result').hidden = false;
      $('r-metal').textContent = '—';
      $('r-stone').textContent = '—';
      showNote('地金価格データがありません。データベースに価格を追加してください。', true);
      return;
    }
    perGram = lk.perGram;
    dateLabel = lk.row.date;
  }

  const netWeight = weight - carat * GRAM_PER_CARAT;
  const factor = purityFactor(metal, purity);
  const metalValue = perGram * factor * netWeight;
  const stoneValue = price - metalValue;
  const perCarat = carat > 0 ? stoneValue / carat : null;

  $('result').hidden = false;
  $('r-metal').textContent = yen(metalValue);
  $('r-stone').textContent = yen(stoneValue);
  $('r-percarat').textContent = perCarat == null ? '— (石なし)' : yen(perCarat) + ' /ct';
  $('r-netweight').textContent = numFmt(netWeight) + ' g';

  // 地金価格の入力欄：入力中（フォーカス中）は上書きしない
  const inPpg = $('in-ppg');
  if (!custom && document.activeElement !== inPpg) inPpg.value = perGram;
  $('r-ppg-date').textContent = '（' + dateLabel + '）';

  // 注意メッセージ
  const msgs = [];
  let warn = false;
  if (custom) {
    msgs.push('入力した地金価格で計算しています。購入日や金属を変えると自動価格に戻ります。');
  } else if (lk && !lk.exact) {
    msgs.push(`${date} の価格がないため、最も近い ${lk.row.date} の価格を使用しました。`);
  }
  if (netWeight < 0) { msgs.push('カラットが全体重量に対して大きすぎます（正味金属重量がマイナス）。'); warn = true; }
  if (stoneValue < 0) { msgs.push('石の価値がマイナスです。商品価格または地金価格をご確認ください。'); warn = true; }
  if (msgs.length) showNote(msgs.join(' '), warn);
}

/* ============================================================
   データベース表示
   ============================================================ */
function renderDatabase() {
  $('db-count').textContent = `全 ${DATA.prices.length} 件`;
  const src = $('db-source');
  if (DATA.source) { src.href = DATA.source; src.hidden = false; }
  else src.hidden = true;

  const body = $('db-body');
  body.innerHTML = '';
  // 新しい日付を上に表示
  for (let i = DATA.prices.length - 1; i >= 0; i--) {
    const p = DATA.prices[i];
    const tr = document.createElement('tr');
    tr.innerHTML =
      `<td>${p.date}</td>` +
      `<td>${p.gold.toLocaleString('ja-JP')}</td>` +
      `<td>${p.platinum.toLocaleString('ja-JP')}</td>`;
    body.appendChild(tr);
  }
}

/* ============================================================
   編集（ログイン → 編集 → GitHub保存）
   ============================================================ */
function setupDbEdit() {
  // ログイン
  $('btn-edit').addEventListener('click', () => {
    $('login-pass').value = '';
    $('login-error').hidden = true;
    $('login-modal').hidden = false;
    $('login-pass').focus();
  });
  $('login-cancel').addEventListener('click', () => ($('login-modal').hidden = true));
  $('login-ok').addEventListener('click', tryLogin);
  $('login-pass').addEventListener('keydown', (e) => { if (e.key === 'Enter') tryLogin(); });

  // 編集モーダル
  $('edit-close').addEventListener('click', () => ($('edit-modal').hidden = true));
  $('add-row').addEventListener('click', addRow);
  $('save-github').addEventListener('click', saveToGitHub);
}

function tryLogin() {
  const pass = $('login-pass').value;
  if (pass === (CFG.editPassword ?? '')) {
    $('login-modal').hidden = true;
    openEditor();
  } else {
    $('login-error').hidden = false;
  }
}

function openEditor() {
  editData = {
    source: DATA.source,
    netJapan: { ...DATA.netJapan },
    prices: DATA.prices.map((p) => ({ ...p })),
  };
  $('add-date').value = new Date().toISOString().slice(0, 10);
  $('add-gold').value = '';
  $('add-pt').value = '';
  $('save-status').hidden = true;

  // 保存済みトークンを復元
  const saved = localStorage.getItem('gh_token');
  $('gh-token').value = saved || '';
  $('gh-remember').checked = !!saved;

  renderEditor();
  $('edit-modal').hidden = false;
}

function renderEditor() {
  const body = $('edit-body');
  body.innerHTML = '';
  for (let i = editData.prices.length - 1; i >= 0; i--) {
    const p = editData.prices[i];
    const tr = document.createElement('tr');

    const tdDate = document.createElement('td');
    tdDate.textContent = p.date;

    const tdGold = document.createElement('td');
    tdGold.appendChild(makeNumInput(p.gold, (v) => (p.gold = v)));

    const tdPt = document.createElement('td');
    tdPt.appendChild(makeNumInput(p.platinum, (v) => (p.platinum = v)));

    const tdDel = document.createElement('td');
    const del = document.createElement('button');
    del.className = 'row-del';
    del.textContent = '×';
    del.title = 'この行を削除';
    del.addEventListener('click', () => {
      editData.prices = editData.prices.filter((x) => x !== p);
      renderEditor();
    });
    tdDel.appendChild(del);

    tr.append(tdDate, tdGold, tdPt, tdDel);
    body.appendChild(tr);
  }
}

function makeNumInput(value, onChange) {
  const inp = document.createElement('input');
  inp.type = 'number';
  inp.step = 'any';
  inp.min = '0';
  inp.className = 'edit-body-input';
  inp.value = value;
  inp.addEventListener('input', () => {
    const v = parseFloat(inp.value);
    if (!isNaN(v)) onChange(v);
  });
  return inp;
}

function addRow() {
  const date = $('add-date').value;
  const gold = parseFloat($('add-gold').value);
  const pt = parseFloat($('add-pt').value);
  if (!date || (isNaN(gold) && isNaN(pt))) {
    setStatus('日付と、金またはプラチナの価格を入力してください。', 'err');
    return;
  }
  const existing = editData.prices.find((p) => p.date === date);
  if (existing) {
    if (!isNaN(gold)) existing.gold = gold;
    if (!isNaN(pt)) existing.platinum = pt;
  } else {
    editData.prices.push({ date, gold: isNaN(gold) ? 0 : gold, platinum: isNaN(pt) ? 0 : pt });
  }
  editData.prices.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  $('add-gold').value = '';
  $('add-pt').value = '';
  setStatus(`${date} を追加・更新しました（保存はまだです）。`, 'info');
  renderEditor();
}

function setStatus(msg, kind) {
  const el = $('save-status');
  el.textContent = msg;
  el.className = 'status ' + (kind || 'info');
  el.hidden = false;
}

/* ---------- prices.json の文字列を生成（生成スクリプトと同形式） ---------- */
function buildJson(d) {
  const lines = d.prices.map(
    (p) => `    { "date": "${p.date}", "gold": ${p.gold}, "platinum": ${p.platinum} }`
  );
  return (
    '{\n' +
    `  "source": ${JSON.stringify(d.source)},\n` +
    `  "netJapan": { "Au": ${d.netJapan.Au}, "Pt": ${d.netJapan.Pt} },\n` +
    '  "prices": [\n' +
    lines.join(',\n') +
    '\n  ]\n}\n'
  );
}

function b64utf8(str) {
  return btoa(unescape(encodeURIComponent(str)));
}

/* ---------- GitHub Contents API で保存 ---------- */
async function saveToGitHub() {
  const gh = CFG.github || {};
  const token = $('gh-token').value.trim();

  if (!gh.owner || !gh.repo || gh.owner.includes('YOUR_') || gh.repo.includes('YOUR_')) {
    setStatus('config.js の owner / repo を設定してください。', 'err');
    return;
  }
  if (!token) {
    setStatus('GitHub トークンを入力してください。', 'err');
    return;
  }

  // トークンの保存／削除
  if ($('gh-remember').checked) localStorage.setItem('gh_token', token);
  else localStorage.removeItem('gh_token');

  const branch = gh.branch || 'main';
  const path = gh.dataPath || 'prices.json';
  const apiBase = `https://api.github.com/repos/${gh.owner}/${gh.repo}/contents/${path}`;
  const headers = { Authorization: 'Bearer ' + token, Accept: 'application/vnd.github+json' };

  setStatus('保存中…', 'info');
  $('save-github').disabled = true;
  try {
    // 現在の sha を取得
    let sha;
    const getRes = await fetch(`${apiBase}?ref=${branch}&_=${Date.now()}`, { headers });
    if (getRes.ok) {
      sha = (await getRes.json()).sha;
    } else if (getRes.status === 404) {
      sha = undefined; // 新規作成
    } else if (getRes.status === 401) {
      throw new Error('認証エラー（401）: トークンを確認してください。');
    } else {
      throw new Error('取得失敗 HTTP ' + getRes.status);
    }

    const body = {
      message: `prices.json を更新 (${new Date().toISOString()})`,
      content: b64utf8(buildJson(editData)),
      branch,
    };
    if (sha) body.sha = sha;

    const putRes = await fetch(apiBase, {
      method: 'PUT',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!putRes.ok) {
      const err = await putRes.json().catch(() => ({}));
      throw new Error(`保存失敗 HTTP ${putRes.status} ${err.message || ''}`);
    }

    // 反映
    DATA = normalize(editData);
    renderDatabase();
    calculate();
    setStatus('保存しました。GitHub Pages への反映には最大1〜2分かかります。', 'ok');
  } catch (e) {
    setStatus(e.message, 'err');
  } finally {
    $('save-github').disabled = false;
  }
}
