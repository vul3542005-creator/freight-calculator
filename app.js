/**
 * HCT 運費試算 UI — app.js
 * 對應 freight_engine.js v3.0（Group 式多組輸入）
 */

'use strict';

// ────────────────────────────────────────────────────────────────
// 全域狀態
// ────────────────────────────────────────────────────────────────
const state = {
  engineReady: false,
  method:      null,   // 'smbc_self' | 'benlei_self' | 'proxy'
  cargoMode:   'cai',  // 'cai' | 'dims'
  caiGroupSeq:  0,
  dimsGroupSeq: 0,
};

// ────────────────────────────────────────────────────────────────
// DOM 工具
// ────────────────────────────────────────────────────────────────
const $  = id => document.getElementById(id);
const show   = el => el.classList.remove('hidden');
const hide   = el => el.classList.add('hidden');
const toggle = (el, v) => v ? show(el) : hide(el);

function scrollTo(el, offset = 0) {
  setTimeout(() => {
    const top = el.getBoundingClientRect().top + window.scrollY - offset;
    window.scrollTo({ top, behavior: 'smooth' });
  }, 80);
}

// ────────────────────────────────────────────────────────────────
// 常用 DOM 參照
// ────────────────────────────────────────────────────────────────
const DOM = {
  sectionMethod:    $('section-method'),
  sectionAddress:   $('section-address'),
  sectionCargo:     $('section-cargo'),
  calcBtn:          $('calc-btn'),
  sectionResult:    $('section-result'),
  addressInput:     $('address-input'),
  serviceFeeRow:    $('service-fee-row'),
  serviceFeeInput:  $('service-fee-input'),
  resultMethodTag:  $('result-method-tag'),
  resultAddress:    $('result-address'),
  resultBreakdown:  $('result-breakdown'),
  resultTotal:      $('result-total'),
  resultNotes:      $('result-notes'),
  modalOverlay:     $('modal-overlay'),
  modalTitle:       $('modal-title'),
  modalMessage:     $('modal-message'),
  modalOptions:     $('modal-options'),
  modalCancel:      $('modal-cancel'),
  loadingOverlay:   $('loading-overlay'),
  caiGroupsCont:    $('cai-groups'),
  dimsGroupsCont:   $('dims-groups'),
};

// ────────────────────────────────────────────────────────────────
// 資料載入 & 引擎初始化
// ────────────────────────────────────────────────────────────────
async function loadEngineData() {
  show(DOM.loadingOverlay);
  try {
    const [sdRes, mrRes] = await Promise.all([
      fetch('special_delivery_v3-6.json'),
      fetch('manual_rules.json'),
    ]);
    for (const [name, res] of [
      ['special_delivery_v2.json', sdRes],
      ['manual_rules.json',        mrRes],
    ]) {
      if (!res.ok) throw new Error(`${name} 載入失敗（HTTP ${res.status}）`);
    }
    const [sd, mr] = await Promise.all([sdRes.json(), mrRes.json()]);
    FreightEngine.initData(sd, mr);
    state.engineReady = true;
  } catch (err) {
    hide(DOM.loadingOverlay);
    alert('❌ 資料載入失敗\n\n' + err.message + '\n\n請確認 JSON 資料檔案與 index.html 在同一目錄。');
    return;
  }
  hide(DOM.loadingOverlay);
}

// ────────────────────────────────────────────────────────────────
// Step 1：方案選擇
// ────────────────────────────────────────────────────────────────
document.querySelectorAll('.method-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.method-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    state.method = btn.dataset.method;
    show(DOM.sectionAddress);
    show(DOM.sectionCargo);
    show(DOM.calcBtn);
    toggle(DOM.serviceFeeRow, state.method === 'proxy');
    scrollTo(DOM.sectionAddress, 58);
    setTimeout(() => DOM.addressInput.focus(), 300);
  });
});

// ────────────────────────────────────────────────────────────────
// Step 3：貨物模式切換
// ────────────────────────────────────────────────────────────────
$('mode-cai-btn').addEventListener('click',  () => setCargoMode('cai'));
$('mode-dims-btn').addEventListener('click', () => setCargoMode('dims'));

function setCargoMode(mode) {
  state.cargoMode = mode;
  $('mode-cai-btn').classList.toggle('active',  mode === 'cai');
  $('mode-dims-btn').classList.toggle('active', mode === 'dims');
  toggle($('mode-cai'),  mode === 'cai');
  toggle($('mode-dims'), mode === 'dims');
}

// ────────────────────────────────────────────────────────────────
// Group 管理：才數模式
// ────────────────────────────────────────────────────────────────
function makeCaiGroup() {
  const gid = ++state.caiGroupSeq;
  const div = document.createElement('div');
  div.className = 'cargo-group';
  div.dataset.gid = gid;

  div.innerHTML = `
    <div class="group-header">
      <span class="group-label">規格 ${gid}</span>
      <button class="remove-group-btn" type="button" title="移除此規格">✕</button>
    </div>
    <div class="cargo-row">
      <div class="input-group half">
        <label>才數（每件）</label>
        <input type="number" class="cai-val"
          min="3" value="3" inputmode="numeric" pattern="[0-9]*">
        <span class="field-note">最低 3 才</span>
      </div>
      <div class="input-group half">
        <label>件數</label>
        <input type="number" class="cai-count"
          min="1" value="1" inputmode="numeric" pattern="[0-9]*">
      </div>
    </div>`;

  div.querySelector('.remove-group-btn').addEventListener('click', () => {
    if (DOM.caiGroupsCont.querySelectorAll('.cargo-group').length <= 1) return; // 至少保留1組
    div.remove();
    reNumberGroups(DOM.caiGroupsCont);
  });

  return div;
}

// ────────────────────────────────────────────────────────────────
// Group 管理：尺寸模式
// ────────────────────────────────────────────────────────────────
function makeDimsGroup() {
  const gid = ++state.dimsGroupSeq;
  const div = document.createElement('div');
  div.className = 'cargo-group';
  div.dataset.gid = gid;

  div.innerHTML = `
    <div class="group-header">
      <span class="group-label">規格 ${gid}</span>
      <button class="remove-group-btn" type="button" title="移除此規格">✕</button>
    </div>
    <div class="dims-row">
      <div class="input-group third">
        <label>長</label>
        <input type="number" class="dim-l" min="1" placeholder="0" inputmode="decimal">
      </div>
      <div class="dims-sep">×</div>
      <div class="input-group third">
        <label>寬</label>
        <input type="number" class="dim-w" min="1" placeholder="0" inputmode="decimal">
      </div>
      <div class="dims-sep">×</div>
      <div class="input-group third">
        <label>高</label>
        <input type="number" class="dim-h" min="1" placeholder="0" inputmode="decimal">
      </div>
    </div>
    <div class="cai-preview hidden">
      ↳ 系統計算才數：<strong class="dims-preview-val">—</strong> 才
    </div>
    <div class="input-group" style="margin-top:12px">
      <label>件數</label>
      <input type="number" class="dims-count"
        min="1" value="1" inputmode="numeric" pattern="[0-9]*">
    </div>`;

  // 即時才數預覽
  ['dim-l', 'dim-w', 'dim-h'].forEach(cls => {
    div.querySelector('.' + cls).addEventListener('input', () => updateDimsPreview(div));
  });

  div.querySelector('.remove-group-btn').addEventListener('click', () => {
    if (DOM.dimsGroupsCont.querySelectorAll('.cargo-group').length <= 1) return;
    div.remove();
    reNumberGroups(DOM.dimsGroupsCont);
  });

  return div;
}

function updateDimsPreview(groupEl) {
  if (!state.engineReady) return;
  const l = parseFloat(groupEl.querySelector('.dim-l').value);
  const w = parseFloat(groupEl.querySelector('.dim-w').value);
  const h = parseFloat(groupEl.querySelector('.dim-h').value);
  const preview = groupEl.querySelector('.cai-preview');
  if (l > 0 && w > 0 && h > 0) {
    groupEl.querySelector('.dims-preview-val').textContent = FreightEngine.calculateCai(l, w, h);
    show(preview);
  } else {
    hide(preview);
  }
}

function reNumberGroups(container) {
  container.querySelectorAll('.cargo-group').forEach((g, i) => {
    g.querySelector('.group-label').textContent = `規格 ${i + 1}`;
  });
}

function initGroups() {
  DOM.caiGroupsCont.appendChild(makeCaiGroup());
  DOM.dimsGroupsCont.appendChild(makeDimsGroup());
}

$('add-cai-group').addEventListener('click', () => {
  DOM.caiGroupsCont.appendChild(makeCaiGroup());
});
$('add-dims-group').addEventListener('click', () => {
  DOM.dimsGroupsCont.appendChild(makeDimsGroup());
});

// ────────────────────────────────────────────────────────────────
// 收集 groups 資料
// 回傳 [{cai, count}, ...] 或錯誤字串
// ────────────────────────────────────────────────────────────────
function buildGroups() {
  if (state.cargoMode === 'cai') {
    const rows = DOM.caiGroupsCont.querySelectorAll('.cargo-group');
    if (rows.length === 0) return 'empty';
    const groups = [];
    for (const row of rows) {
      const rawCai   = parseInt(row.querySelector('.cai-val').value, 10);
      const rawCount = parseInt(row.querySelector('.cai-count').value, 10);
      if (isNaN(rawCai) || rawCai <= 0) return 'invalid_cai';
      groups.push({
        cai:   Math.max(3, rawCai),
        count: Math.max(1, isNaN(rawCount) ? 1 : rawCount),
      });
    }
    return groups;
  }

  // 尺寸模式
  const rows = DOM.dimsGroupsCont.querySelectorAll('.cargo-group');
  if (rows.length === 0) return 'empty';
  const groups = [];
  for (const row of rows) {
    const l = parseFloat(row.querySelector('.dim-l').value);
    const w = parseFloat(row.querySelector('.dim-w').value);
    const h = parseFloat(row.querySelector('.dim-h').value);
    if (!l || !w || !h || l <= 0 || w <= 0 || h <= 0) return 'invalid_dims';
    const count = Math.max(1, parseInt(row.querySelector('.dims-count').value, 10) || 1);
    groups.push({ cai: FreightEngine.calculateCai(l, w, h), count });
  }
  return groups;
}

// ────────────────────────────────────────────────────────────────
// 計算按鈕
// ────────────────────────────────────────────────────────────────
DOM.calcBtn.addEventListener('click', () => doCalculate(null));

function doCalculate(selectedAlternativeId) {
  if (!state.engineReady) { alert('引擎尚未就緒，請稍候再試。'); return; }
  if (!state.method)      { alert('請先選擇出貨方案。'); scrollTo(DOM.sectionMethod, 58); return; }

  const address = DOM.addressInput.value.trim();
  if (!address) { alert('請輸入收件地址。'); DOM.addressInput.focus(); return; }

  const groups = buildGroups();
  if (groups === 'empty')        { alert('請至少輸入一組貨物資訊。'); return; }
  if (groups === 'invalid_cai')  { alert('才數必須為正整數（最低 3 才）。'); return; }
  if (groups === 'invalid_dims') { alert('請輸入完整的長、寬、高尺寸（公分）。'); return; }

  const rawFee     = parseInt(DOM.serviceFeeInput.value, 10);
  const serviceFee = isNaN(rawFee) || rawFee < 0 ? 150 : rawFee;

  const result = FreightEngine.calculateFreight({
    shippingMethod:       state.method,
    destinationAddress:   address,
    groups,
    serviceFee,
    selectedAlternativeId,
  });

  if (!result.success)              { alert('計算失敗：' + result.error); return; }
  if (result.requiresUserSelection) { showRerouteModal(result.requiresUserSelection); return; }

  renderResult(result);
}

// ────────────────────────────────────────────────────────────────
// 轉運 Modal
// ────────────────────────────────────────────────────────────────
function showRerouteModal(sel) {
  DOM.modalTitle.textContent   = sel.ruleName || '轉運提示';
  DOM.modalMessage.textContent = sel.warningMessage || '';
  DOM.modalOptions.innerHTML   = '';

  sel.alternatives.forEach(alt => {
    const btn = document.createElement('button');
    btn.className = 'modal-option-btn';
    btn.innerHTML =
      `<div class="opt-name">${escHtml(alt.name)}</div>` +
      `<div class="opt-addr">📍 ${escHtml(alt.address)}</div>` +
      `<div class="opt-phone">📞 ${escHtml(alt.phone)}</div>`;
    btn.addEventListener('click', () => { hideModal(); doCalculate(alt.id); });
    DOM.modalOptions.appendChild(btn);
  });

  show(DOM.modalOverlay);
}

function hideModal() { hide(DOM.modalOverlay); }
DOM.modalCancel.addEventListener('click', hideModal);
DOM.modalOverlay.addEventListener('click', e => { if (e.target === DOM.modalOverlay) hideModal(); });

// ────────────────────────────────────────────────────────────────
// 結果渲染
// ────────────────────────────────────────────────────────────────
const METHOD_LABEL = {
  smbc_self:   '聰明媽咪自寄',
  benlei_self: '奔雷自寄',
  proxy:       '代客寄',
};
const METHOD_TAG_CLASS = {
  smbc_self:   'tag-smbc',
  benlei_self: 'tag-benlei',
  proxy:       'tag-proxy',
};

function renderResult(result) {
  const { breakdown, actualFreight, pricingMethod,
          inputSummary, matchedSpecial, manualRuleTriggered } = result;

  // 方案標籤
  DOM.resultMethodTag.textContent = METHOD_LABEL[state.method] + '｜' + pricingMethod;
  DOM.resultMethodTag.className   = 'result-method-tag ' + (METHOD_TAG_CLASS[state.method] || '');

  // 地址
  if (inputSummary.rerouted) {
    DOM.resultAddress.innerHTML =
      `<div class="addr-original">${escHtml(inputSummary.originalDestination)}</div>` +
      `<div class="addr-rerouted">🚢 轉運至 ${escHtml(inputSummary.rerouteTo)}（${escHtml(inputSummary.actualDestination)}）</div>`;
  } else {
    DOM.resultAddress.innerHTML =
      `<div class="addr-main">${escHtml(inputSummary.originalDestination)}</div>`;
  }

  // 費用明細
  const rows = [];
  const groups = breakdown.groups || [];

  if (groups.length === 1) {
    const g = groups[0];
    rows.push({ label: `標準運費（${g.count} 件 × ${g.cai} 才）`, value: breakdown.standardFreight });
  } else {
    groups.forEach((g, i) => {
      rows.push({ label: `第 ${i + 1} 組標準運費（${g.count} 件 × ${g.cai} 才）`, value: g.standard, sub: true });
    });
    rows.push({ label: '標準運費小計', value: breakdown.standardFreight, subtotal: true });
  }

  if (breakdown.unionFee > 0) {
    const area = matchedSpecial ? matchedSpecial.category : '聯運地區';
    if (groups.length > 1) {
      groups.forEach((g, i) => {
        rows.push({ label: `第 ${i + 1} 組聯運費（${g.count} 件 × ${g.cai} 才）`, value: g.union, sub: true });
      });
      rows.push({ label: `聯運費小計（${area}）`, value: breakdown.unionFee, subtotal: true });
    } else {
      rows.push({ label: `聯運費（${area}）`, value: breakdown.unionFee });
    }
  }

  if (breakdown.serviceFee > 0) {
    rows.push({ label: '代客寄服務費', value: breakdown.serviceFee });
  }

  DOM.resultBreakdown.innerHTML = rows.map(r => {
    const cls = r.subtotal ? 'breakdown-row subtotal-row'
              : r.sub      ? 'breakdown-row sub-row'
              : 'breakdown-row';
    return `<div class="${cls}">
      <span class="br-label">${escHtml(r.label)}</span>
      <span class="br-value">NT$ ${r.value.toLocaleString('zh-TW')}</span>
    </div>`;
  }).join('');

  // 總計
  DOM.resultTotal.innerHTML =
    `<span class="total-label">總運費</span>` +
    `<span class="total-value">NT$&nbsp;${actualFreight.toLocaleString('zh-TW')}</span>`;

  // 備注
  const notes = [];
  if (manualRuleTriggered) notes.push(manualRuleTriggered.action?.warning_message || '');
  if (notes.length > 0) {
    DOM.resultNotes.textContent = notes.join('\n\n');
    show(DOM.resultNotes);
  } else {
    hide(DOM.resultNotes);
  }

  show(DOM.sectionResult);
  scrollTo(DOM.sectionResult, 58);
}

// ────────────────────────────────────────────────────────────────
// 重設
// ────────────────────────────────────────────────────────────────
$('reset-btn').addEventListener('click', resetAll);

function resetAll() {
  hide(DOM.sectionResult);
  hide(DOM.resultNotes);
  DOM.addressInput.value    = '';
  DOM.serviceFeeInput.value = '150';
  DOM.caiGroupsCont.innerHTML  = '';
  DOM.dimsGroupsCont.innerHTML = '';
  state.caiGroupSeq  = 0;
  state.dimsGroupSeq = 0;
  initGroups();
  document.querySelectorAll('.method-btn').forEach(b => b.classList.remove('active'));
  state.method = null;
  setCargoMode('cai');
  hide(DOM.sectionAddress);
  hide(DOM.sectionCargo);
  hide(DOM.calcBtn);
  toggle(DOM.serviceFeeRow, false);
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

// ────────────────────────────────────────────────────────────────
// 工具：防 XSS
// ────────────────────────────────────────────────────────────────
function escHtml(str) {
  if (typeof str !== 'string') return '';
  return str
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#039;');
}

// ────────────────────────────────────────────────────────────────
// 初始化
// ────────────────────────────────────────────────────────────────
initGroups();
loadEngineData();
