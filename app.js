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
let secA = null; // 計算セクションA
let secB = null; // 計算セクションB（比較用・任意）
let ghToken = null; // ログイン成功時にメモリ内だけで保持する編集トークン

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
  setupCalc();
  setupDbEdit();

  try {
    const res = await fetch('prices.json?_=' + Date.now());
    if (!res.ok) throw new Error('HTTP ' + res.status);
    DATA = normalize(await res.json());
    renderDatabase();
    recalcAll();
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
   純度プルダウン（セクションごとの select / custom欄に対して適用）
   ============================================================ */
function fillPurityEl(metal, sel, customWrap) {
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
  if (customWrap) customWrap.classList.add('hidden');
}

/* ============================================================
   価格の検索（購入日「以前」で最も新しい＝直近の営業日）
   ※ 該当日が無ければ、その前で最も近い日付の価格を使う
   ※ 価格データは日付の昇順に並んでいる前提（ExcelのVLOOKUP方式）
   ============================================================ */
function lookupPrice(isoDate, metal) {
  let chosen = null;
  for (const p of DATA.prices) {
    if (p.date <= isoDate) chosen = p; // 以前の日付を上書きし続ける＝直近が残る
    else break; // 昇順なので購入日を超えたら終了
  }
  if (!chosen) return null; // 購入日より前のデータが1件も無い
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
   計算セクション（最大2つ：A と B）
   ============================================================ */
function todayISO() {
  return new Date().toISOString().slice(0, 10);
}

function setupCalc() {
  secA = buildSection('a');
  $('col-a').appendChild(secA.root);
  secA.setInputs({ date: todayISO() });
  secA.recalc();

  $('btn-add').addEventListener('click', showSectionB);
  $('btn-close-b').addEventListener('click', hideSectionB);
  $('btn-copy').addEventListener('click', () => {
    if (!secB) return;
    secB.setInputs(secA.getInputs()); // A の入力を B へコピー
    secB.recalc();
  });
}

/* セクションBを表示（初回は生成し、Aの入力をコピーしておく） */
function showSectionB() {
  if (!secB) {
    secB = buildSection('b');
    $('col-b').appendChild(secB.root);
    secB.setInputs(secA.getInputs());
  }
  $('col-b').classList.remove('hidden');
  $('compute-area').classList.add('dual');
  $('btn-add').classList.add('hidden');
  $('btn-copy').classList.remove('hidden');
  document.body.classList.add('dual-mode');
  secB.recalc();
}

/* セクションBを閉じる（入力は保持。再度開くと復元される） */
function hideSectionB() {
  $('col-b').classList.add('hidden');
  $('compute-area').classList.remove('dual');
  $('btn-add').classList.remove('hidden');
  $('btn-copy').classList.add('hidden');
  document.body.classList.remove('dual-mode');
  $('compare-panel').classList.add('hidden');
}

function recalcAll() {
  if (secA) secA.recalc();
  if (secB && !$('col-b').classList.contains('hidden')) secB.recalc();
}

/* ---------- 1セクション分のDOMを生成し、制御オブジェクトを返す ---------- */
function buildSection(key) {
  const root = document.createElement('div');
  root.className = 'section-inner';
  root.innerHTML = sectionHTML(key);

  // このセクション内の要素を id で取得（id はキーで一意化されている）
  const el = (name) => root.querySelector('#' + name + '-' + key);
  const state = { priceOverride: null, last: { ok: false } };

  fillPurityEl(el('in-metal').value, el('in-purity'), el('custom-purity-wrap'));

  el('in-metal').addEventListener('change', () => {
    fillPurityEl(el('in-metal').value, el('in-purity'), el('custom-purity-wrap'));
    state.priceOverride = null; // 金属を変えたら自動価格に戻す
    recalc();
  });
  el('in-purity').addEventListener('change', () => {
    el('custom-purity-wrap').classList.toggle('hidden', el('in-purity').value !== 'custom');
    recalc();
  });
  el('btn-calc').addEventListener('click', recalc);
  el('in-date').addEventListener('input', () => {
    state.priceOverride = null; // 購入日を変えたら自動価格に戻す
    recalc();
  });
  ['in-weight', 'in-price', 'in-purity-custom'].forEach((n) =>
    el(n).addEventListener('input', recalc)
  );
  ['in-carat-1', 'in-carat-2', 'in-carat-3'].forEach((n) =>
    el(n).addEventListener('input', () => {
      updateCaratTotal();
      recalc();
    })
  );
  el('in-ppg').addEventListener('input', () => {
    const v = parseFloat(el('in-ppg').value);
    state.priceOverride = isFinite(v) && v > 0 ? v : null;
    recalc();
  });
  // マスクされた購入日欄を押すと、自動（購入日ベース）価格に戻す
  el('date-masked').addEventListener('click', () => {
    state.priceOverride = null;
    recalc();
  });

  function totalCarat() {
    return ['in-carat-1', 'in-carat-2', 'in-carat-3'].reduce((sum, n) => {
      const v = parseFloat(el(n).value);
      return sum + (isFinite(v) && v > 0 ? v : 0);
    }, 0);
  }
  function updateCaratTotal() {
    el('carat-total').textContent = '合計 ' + numFmt(totalCarat(), 3) + ' ct';
  }
  // 地金価格がカスタムのとき購入日欄を XXXX/XX/XX 表示に切り替える
  function updateDateMask() {
    const custom = state.priceOverride != null;
    el('in-date').classList.toggle('hidden', custom);
    el('date-masked').classList.toggle('hidden', !custom);
  }
  function recalc() {
    updateDateMask();
    state.last = computeSection(el, state, totalCarat);
    updateCompare();
  }

  updateCaratTotal();

  return {
    key,
    root,
    state,
    recalc,
    getInputs: () => ({
      date: el('in-date').value,
      metal: el('in-metal').value,
      puritySel: el('in-purity').value,
      purityCustom: el('in-purity-custom').value,
      weight: el('in-weight').value,
      carat1: el('in-carat-1').value,
      carat2: el('in-carat-2').value,
      carat3: el('in-carat-3').value,
      price: el('in-price').value,
    }),
    setInputs: (d) => {
      if (d.date != null) el('in-date').value = d.date;
      if (d.metal != null) {
        el('in-metal').value = d.metal;
        fillPurityEl(d.metal, el('in-purity'), el('custom-purity-wrap'));
      }
      if (d.puritySel != null) {
        el('in-purity').value = d.puritySel;
        el('custom-purity-wrap').classList.toggle('hidden', d.puritySel !== 'custom');
      }
      if (d.purityCustom != null) el('in-purity-custom').value = d.purityCustom;
      if (d.weight != null) el('in-weight').value = d.weight;
      if (d.carat1 != null) el('in-carat-1').value = d.carat1;
      if (d.carat2 != null) el('in-carat-2').value = d.carat2;
      if (d.carat3 != null) el('in-carat-3').value = d.carat3;
      if (d.price != null) el('in-price').value = d.price;
      state.priceOverride = null; // コピー直後は自動価格に戻す
      updateCaratTotal();
    },
  };
}

/* ---------- 1セクション分の計算＋結果描画。結果オブジェクトを返す ---------- */
function computeSection(el, state, totalCarat) {
  const note = el('r-note');
  const showNote = (msg, warn) => {
    note.textContent = msg;
    note.classList.toggle('warn', !!warn);
    note.hidden = false;
  };
  note.hidden = true;
  note.classList.remove('warn');

  const date = el('in-date').value;
  const metal = el('in-metal').value;
  const purity =
    el('in-purity').value === 'custom'
      ? parseFloat(el('in-purity-custom').value)
      : parseFloat(el('in-purity').value);
  const weight = parseFloat(el('in-weight').value);
  const carat = totalCarat();
  const price = parseFloat(el('in-price').value);

  if (!date || !(purity > 0) || !(weight > 0) || !(price > 0)) {
    el('result').hidden = true;
    return { ok: false };
  }
  if (!DATA.prices.length) {
    el('result').hidden = false;
    showNote('地金価格データが読み込まれていません。', true);
    return { ok: false };
  }

  const lk = lookupPrice(date, metal);
  const custom = state.priceOverride != null;

  // 適用する地金価格（¥/g）と、その横に出す日付ラベルを決める
  let perGram, dateLabel;
  if (custom) {
    perGram = state.priceOverride;
    dateLabel = 'XXXX/XX/XX';
  } else {
    if (!lk) {
      el('result').hidden = false;
      el('r-metal').textContent = '—';
      el('r-stone').textContent = '—';
      el('r-percarat').textContent = '—';
      el('r-netweight').textContent = '—';
      el('r-ppg-date').textContent = '（—）';
      if (document.activeElement !== el('in-ppg')) el('in-ppg').value = '';
      showNote(`${date} 以前の地金価格データがありません。データベースに価格を追加してください。`, true);
      return { ok: false };
    }
    perGram = lk.perGram;
    dateLabel = lk.row.date;
  }

  const netWeight = weight - carat * GRAM_PER_CARAT;
  const factor = purityFactor(metal, purity);
  const metalValue = perGram * factor * netWeight;
  const stoneValue = price - metalValue;
  const perCarat = carat > 0 ? stoneValue / carat : null;

  el('result').hidden = false;
  el('r-metal').textContent = yen(metalValue);
  el('r-stone').textContent = yen(stoneValue);
  el('r-percarat').textContent = perCarat == null ? '— (石なし)' : yen(perCarat) + ' /ct';
  el('r-netweight').textContent = numFmt(netWeight) + ' g';

  // 地金価格の入力欄：入力中（フォーカス中）は上書きしない
  const inPpg = el('in-ppg');
  if (!custom && document.activeElement !== inPpg) inPpg.value = perGram;
  el('r-ppg-date').textContent = '（' + dateLabel + '）';

  // 注意メッセージ
  const msgs = [];
  let warn = false;
  if (custom) {
    msgs.push('入力した地金価格で計算しています。金属を変えるか「XXXX/XX/XX」欄を押すと自動価格（購入日ベース）に戻ります。');
  } else if (lk && !lk.exact) {
    msgs.push(`${date} の価格がないため、直近の ${lk.row.date} の価格を使用しました。`);
  }
  if (netWeight < 0) { msgs.push('カラットが全体重量に対して大きすぎます（正味金属重量がマイナス）。'); warn = true; }
  if (stoneValue < 0) { msgs.push('石の価値がマイナスです。商品価格または地金価格をご確認ください。'); warn = true; }
  if (msgs.length) showNote(msgs.join(' '), warn);

  return { ok: true, price, metalValue, stoneValue, perCarat, perGram };
}

/* ============================================================
   A と B の差を表示
   ============================================================ */
function updateCompare() {
  const panel = $('compare-panel');
  const bActive = secB && !$('col-b').classList.contains('hidden');
  if (!bActive) {
    panel.classList.add('hidden');
    return;
  }

  const body = $('compare-body');
  body.innerHTML = '';
  panel.classList.remove('hidden');

  const a = secA.state.last;
  const b = secB.state.last;
  if (!a.ok || !b.ok) {
    const tr = document.createElement('tr');
    const td = document.createElement('td');
    td.colSpan = 5;
    td.className = 'compare-empty';
    td.textContent = 'A と B の両方で計算結果が出ると、差が表示されます。';
    tr.appendChild(td);
    body.appendChild(tr);
    return;
  }

  const rows = [
    { label: '商品価格', a: a.price, b: b.price, perCt: false },
    { label: '金属価値', a: a.metalValue, b: b.metalValue, perCt: false },
    { label: '石の価値', a: a.stoneValue, b: b.stoneValue, perCt: false },
    { label: '石の単価', a: a.perCarat, b: b.perCarat, perCt: true },
  ];

  for (const r of rows) {
    const fmt = r.perCt ? (v) => yen(v) + ' /ct' : yen;
    const has = r.a != null && r.b != null && isFinite(r.a) && isFinite(r.b);
    const diff = has ? r.b - r.a : null;
    const cls = !has ? '' : diff > 0 ? 'diff-pos' : diff < 0 ? 'diff-neg' : '';

    const tr = document.createElement('tr');
    tr.innerHTML =
      `<td>${r.label}</td>` +
      `<td>${r.a == null ? '—' : fmt(r.a)}</td>` +
      `<td>${r.b == null ? '—' : fmt(r.b)}</td>` +
      `<td class="${cls}">${has ? signedVal(diff, fmt) : '—'}</td>` +
      `<td class="${cls}">${has && r.a !== 0 ? signedPct((diff / Math.abs(r.a)) * 100) : '—'}</td>`;
    body.appendChild(tr);
  }
}

function signedVal(v, fmt) {
  const sign = v > 0 ? '+' : v < 0 ? '−' : '±';
  return sign + fmt(Math.abs(v));
}
function signedPct(p) {
  const sign = p > 0 ? '+' : p < 0 ? '−' : '±';
  return sign + numFmt(Math.abs(p), 1) + '%';
}

/* ---------- セクションのHTML（key = 'a' | 'b'。id をキーで一意化） ---------- */
function sectionHTML(key) {
  return `
    <div class="card compute-card">
      <div class="form-grid">
        <label>購入日
          <input type="date" id="in-date-${key}">
          <button type="button" class="date-masked hidden" id="date-masked-${key}" title="クリックで購入日ベースの自動価格に戻す">XXXX/XX/XX</button>
        </label>
        <label>金属
          <select id="in-metal-${key}">
            <option value="Au">金 (Au)</option>
            <option value="Pt">プラチナ (Pt)</option>
          </select>
        </label>
        <label>純度
          <select id="in-purity-${key}"></select>
        </label>
        <label class="hidden" id="custom-purity-wrap-${key}">純度（数値で直接入力）
          <input type="number" id="in-purity-custom-${key}" step="any" min="0" placeholder="金=K数値 / Pt=1000分率">
        </label>
        <label>全体重量 (g)
          <input type="number" id="in-weight-${key}" step="any" min="0" placeholder="例: 6.7" inputmode="decimal">
        </label>
        <label class="stone-carats">石のカラット（最大3石・ct）
          <div class="carat-slots">
            <input type="number" id="in-carat-1-${key}" class="carat-slot" step="any" min="0" placeholder="石1" inputmode="decimal">
            <input type="number" id="in-carat-2-${key}" class="carat-slot" step="any" min="0" placeholder="石2" inputmode="decimal">
            <input type="number" id="in-carat-3-${key}" class="carat-slot" step="any" min="0" placeholder="石3" inputmode="decimal">
          </div>
          <span class="carat-total" id="carat-total-${key}">合計 0 ct</span>
        </label>
        <label>商品価格 (¥)
          <input type="number" id="in-price-${key}" step="any" min="0" placeholder="例: 118182" inputmode="numeric">
        </label>
      </div>
      <button id="btn-calc-${key}" class="primary">計算する</button>
    </div>

    <div class="card result-card" id="result-${key}" hidden>
      <div class="result-main">
        <div class="result-block metal">
          <span class="result-label">金属価値</span>
          <span class="result-value" id="r-metal-${key}">¥0</span>
        </div>
        <div class="result-divider">＋</div>
        <div class="result-block stone">
          <span class="result-label">石の価値</span>
          <span class="result-value" id="r-stone-${key}">¥0</span>
        </div>
      </div>
      <div class="result-sub">
        <div><span>石の単価</span><b id="r-percarat-${key}">—</b></div>
        <div><span>正味金属重量</span><b id="r-netweight-${key}">—</b></div>
        <div class="ppg-cell">
          <span>適用した地金価格</span>
          <span class="ppg-row">¥<input type="number" id="in-ppg-${key}" class="ppg-input" step="any" min="0" inputmode="decimal"> /g</span>
          <small class="ppg-date" id="r-ppg-date-${key}">—</small>
        </div>
      </div>
      <p class="note warn" id="r-note-${key}" hidden></p>
    </div>
  `;
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

/* ---------- トークンのスクランブル解除（パスワードで復号） ----------
   config.js の encToken は「salt(16) + iv(12) + 暗号文」を base64 にしたもの。
   encrypt-token.html と同じ方式（PBKDF2-SHA256 / AES-GCM）で復号します。
   ※ Web Crypto は https か localhost でのみ動作します（file:// は不可）。 */
function b64ToBytes(b64) {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

async function deriveKey(password, salt, usage) {
  const baseKey = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveKey']
  );
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt, iterations: 200000, hash: 'SHA-256' },
    baseKey,
    { name: 'AES-GCM', length: 256 },
    false,
    [usage]
  );
}

async function unscramble(blobB64, password) {
  const raw = b64ToBytes(blobB64);
  const salt = raw.slice(0, 16);
  const iv = raw.slice(16, 28);
  const data = raw.slice(28);
  const key = await deriveKey(password, salt, 'decrypt');
  const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, data);
  return new TextDecoder().decode(plain);
}

async function tryLogin() {
  const pass = $('login-pass').value;
  const enc = (CFG.github && CFG.github.encToken) || '';
  const errEl = $('login-error');

  if (!enc) {
    errEl.textContent = '編集トークンが未設定です。encrypt-token.html で作成し config.js に貼り付けてください。';
    errEl.hidden = false;
    return;
  }
  if (!pass) {
    errEl.textContent = 'パスワードを入力してください。';
    errEl.hidden = false;
    return;
  }
  if (!window.crypto || !crypto.subtle) {
    errEl.textContent = 'この環境では復号できません（https か localhost で開いてください）。';
    errEl.hidden = false;
    return;
  }

  $('login-ok').disabled = true;
  try {
    const token = await unscramble(enc, pass);
    // 復号できても中身がトークン形式でなければ、誤ったパスワードとみなす
    if (!/^(github_pat_|ghp_|gho_|ghs_)/.test(token)) throw new Error('format');
    ghToken = token;
    $('login-modal').hidden = true;
    openEditor();
  } catch (e) {
    errEl.textContent = 'パスワードが違います';
    errEl.hidden = false;
  } finally {
    $('login-ok').disabled = false;
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
  const token = ghToken;

  if (!gh.owner || !gh.repo || gh.owner.includes('YOUR_') || gh.repo.includes('YOUR_')) {
    setStatus('config.js の owner / repo を設定してください。', 'err');
    return;
  }
  if (!token) {
    setStatus('トークンが見つかりません。いったん閉じてログインし直してください。', 'err');
    return;
  }

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
    recalcAll();
    setStatus('保存しました。GitHub Pages への反映には最大1〜2分かかります。', 'ok');
  } catch (e) {
    setStatus(e.message, 'err');
  } finally {
    $('save-github').disabled = false;
  }
}
