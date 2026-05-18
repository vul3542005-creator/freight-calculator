/**
 * FreightEngine — HCT 運費計算引擎 v3.0
 *
 * 計算公式：
 *   標準運費（每組） = ((才數 - 3) × 超材費 + 基本費) × 件數
 *   聯運費（每組）   = max(minimum, (才數 ÷ 10) × per_100kg) × 件數
 *   總運費           = Σ標準運費 + Σ聯運費 + 服務費
 *
 * 重量換算：公斤 = 才數 × 10（內部推算，不需使用者輸入）
 */

'use strict';

const FreightEngine = (() => {

  // ────────────────────────────────────────────────────────────────
  // 費率表（2026/3/1 生效）
  // ────────────────────────────────────────────────────────────────
  const RATES = {
    smbc_self:   { normal: 85, high: 90, extra: 20 },
    benlei_self: { normal: 88, high: 93, extra: 25 },
    proxy:       { normal: 93, high: 93, extra: 25 },  // 代客寄無視區域，固定取 normal
  };

  // 高費率區縣市（北北基 + 宜花東）
  const HIGH_RATE_CITIES = ['台北市', '新北市', '基隆市', '宜蘭縣', '花蓮縣', '台東縣'];

  // 私有資料
  let _sd   = null;   // special_delivery_v2.json
  let _mr   = null;   // manual_rules.json

  // ────────────────────────────────────────────────────────────────
  // 初始化
  // ────────────────────────────────────────────────────────────────
  function initData(sd, mr /*, td — taiwan_districts 暫不使用 */) {
    _sd = sd;
    _mr = mr;
  }

  // ────────────────────────────────────────────────────────────────
  // 才數計算（三種模式）
  // ────────────────────────────────────────────────────────────────
  function calculateCai(l, w, h) {
    const dims = [l, w, h].sort((a, b) => b - a);   // 由大到小
    const below30 = dims.filter(d => d < 30).length;
    let cai;

    if (below30 === 0) {
      // 三邊皆 ≥ 30：標準體積
      cai = Math.ceil((l * w * h) / 27000);
    } else if (below30 === 1) {
      // 僅一邊 < 30：取最長兩邊
      cai = Math.ceil((dims[0] * dims[1]) / 900);
    } else {
      // 兩邊 < 30（柱狀）：取最長邊
      cai = Math.ceil(dims[0] / 30);
    }

    return Math.max(3, cai);  // 最低 3 才
  }

  // ────────────────────────────────────────────────────────────────
  // 地址正規化
  // ────────────────────────────────────────────────────────────────
  function normalizeAddr(addr) {
    if (!addr) return '';
    return addr
      .replace(/臺/g, '台')
      .replace(/\s+/g, '')
      .toLowerCase();
  }

  // ────────────────────────────────────────────────────────────────
  // 高費率區判斷
  // ────────────────────────────────────────────────────────────────
  function isHighRateCity(addr) {
    const norm = normalizeAddr(addr);
    return HIGH_RATE_CITIES.some(c => norm.includes(normalizeAddr(c)));
  }

  // ────────────────────────────────────────────────────────────────
  // 查詢聯運規則（special_delivery_v2.json）
  // 策略：最長 pattern 優先；同長度時 sea 優先於 air；再取 minimum 最高（保守報價）
  // ────────────────────────────────────────────────────────────────
  function findSpecialRule(addr) {
    if (!_sd || !_sd.rules) return null;
    const norm = normalizeAddr(addr);
    let best     = null;
    let bestLen  = 0;

    for (const rule of _sd.rules) {
      if (!rule.destination_patterns) continue;
      for (const pat of rule.destination_patterns) {
        const normPat = normalizeAddr(pat);
        if (!normPat) continue;
        if (norm.includes(normPat)) {
          const isBetter =
            normPat.length > bestLen ||
            (normPat.length === bestLen && !best) ||
            (normPat.length === bestLen && best && (
              // sea 優先於 air（避免空運限才限重規則蓋掉較便宜的海運費率）
              (rule.routing_mode === 'sea' && best.routing_mode === 'air') ||
              // 同 routing_mode 才比 minimum（保守報價）
              (rule.routing_mode === best.routing_mode && rule.minimum > best.minimum)
            ));
          if (isBetter) {
            bestLen = normPat.length;
            best    = rule;
          }
        }
      }
    }

    return best;
  }

  // ────────────────────────────────────────────────────────────────
  // 查詢人工規則（manual_rules.json）
  // ────────────────────────────────────────────────────────────────
  function findManualRule(addr) {
    if (!_mr || !_mr.rules) return null;
    const norm = normalizeAddr(addr);

    for (const rule of _mr.rules) {
      if (!rule.enabled) continue;
      const keywords = rule.match_keywords || [];
      const matched  = rule.match_logic === 'any'
        ? keywords.some(kw => norm.includes(normalizeAddr(kw)))
        : keywords.every(kw => norm.includes(normalizeAddr(kw)));
      if (matched) return rule;
    }

    return null;
  }

  // ────────────────────────────────────────────────────────────────
  // 單組標準運費
  // ────────────────────────────────────────────────────────────────
  function calcGroupStandard(cai, count, method, isHighRate) {
    const rate    = RATES[method];
    // 代客寄固定取 normal（= 93），其餘依區域
    const baseFee = (method === 'proxy') ? rate.normal
                  : (isHighRate ? rate.high : rate.normal);
    const perUnit = (Math.max(0, cai - 3) * rate.extra) + baseFee;
    return perUnit * count;
  }

  // ────────────────────────────────────────────────────────────────
  // 單組聯運費
  // 才數 × 10 = 推算公斤，再換算 per_100kg
  // ────────────────────────────────────────────────────────────────
  function calcGroupUnion(cai, count, rule) {
    if (!rule) return 0;
    const estimatedKg  = cai * 10;
    const per100kgFee  = (estimatedKg / 100) * rule.per_100kg;
    const perUnitFee   = Math.max(rule.minimum, per100kgFee);
    return perUnitFee * count;
  }

  // ────────────────────────────────────────────────────────────────
  // 主計算函式
  // groups: [{ cai: number, count: number }, ...]
  // ────────────────────────────────────────────────────────────────
  function calculateFreight({
    shippingMethod,
    destinationAddress,
    groups,
    serviceFee,
    selectedAlternativeId,
  }) {
    if (!_sd || !_mr) {
      return { success: false, error: '引擎資料未就緒，請重新整理頁面。' };
    }
    if (!RATES[shippingMethod]) {
      return { success: false, error: `無效的出貨方案：${shippingMethod}` };
    }
    if (!groups || groups.length === 0) {
      return { success: false, error: '未提供貨物資訊。' };
    }

    // ── Step 1：檢查人工規則（離島轉運）──
    const manualRule = findManualRule(destinationAddress);

    if (manualRule && manualRule.type === 'force_reroute') {
      if (!selectedAlternativeId) {
        return {
          success: true,
          requiresUserSelection: {
            ruleName:       manualRule.name,
            warningMessage: manualRule.action.warning_message,
            alternatives:   manualRule.action.alternatives,
          },
        };
      }
      // 使用者已選擇船運公司
      const alt = (manualRule.action.alternatives || []).find(a => a.id === selectedAlternativeId);
      if (!alt) return { success: false, error: '無效的轉運選項。' };

      // 離島：標準運費用船運公司地址計算，聯運費用原始地址查詢
      return _buildResult({
        shippingMethod,
        originalAddress:  destinationAddress,
        actualAddress:    alt.address,
        rerouted:         true,
        rerouteTo:        alt.name,
        groups,
        serviceFee,
        manualWarning:    null,   // 轉運 warning 已在 modal 顯示，結果頁不重複
      });
    }

    // add_warning 類型：照常計算，但最後顯示警告
    const addWarning = (manualRule && manualRule.type === 'add_warning') ? manualRule : null;

    return _buildResult({
      shippingMethod,
      originalAddress:  destinationAddress,
      actualAddress:    destinationAddress,
      rerouted:         false,
      rerouteTo:        null,
      groups,
      serviceFee,
      manualWarning:    addWarning,
    });
  }

  // ────────────────────────────────────────────────────────────────
  // 內部：組裝計算結果
  // ────────────────────────────────────────────────────────────────
  function _buildResult({
    shippingMethod, originalAddress, actualAddress,
    rerouted, rerouteTo, groups, serviceFee, manualWarning,
  }) {
    const isHighRate    = (shippingMethod !== 'proxy') && isHighRateCity(actualAddress);
    const specialRule   = findSpecialRule(originalAddress);   // 聯運費用原始地址查

    let totalStandard = 0;
    let totalUnion    = 0;
    let totalCount    = 0;
    const groupBreakdowns = [];

    for (const g of groups) {
      const std   = calcGroupStandard(g.cai, g.count, shippingMethod, isHighRate);
      const union = calcGroupUnion(g.cai, g.count, specialRule);
      totalStandard += std;
      totalUnion    += union;
      totalCount    += g.count;
      groupBreakdowns.push({ cai: g.cai, count: g.count, standard: std, union });
    }

    const svcFee = (shippingMethod === 'proxy') ? (Number(serviceFee) || 150) : 0;
    const total  = totalStandard + totalUnion + svcFee;

    // 定價方式標籤
    let pricingMethod = '一般區';
    if (isHighRate)    pricingMethod = '高費率區';
    if (specialRule)   pricingMethod += (isHighRate ? ' + ' : '') + `聯運（${specialRule.category}）`;
    if (!isHighRate && !specialRule) pricingMethod = '一般區';

    return {
      success:             true,
      actualFreight:       total,
      breakdown: {
        standardFreight:   totalStandard,
        unionFee:          totalUnion,
        serviceFee:        svcFee,
        groups:            groupBreakdowns,
      },
      pricingMethod,
      matchedSpecial:      specialRule,
      manualRuleTriggered: manualWarning,
      inputSummary: {
        originalDestination: originalAddress,
        actualDestination:   actualAddress,
        rerouted,
        rerouteTo,
        totalCount,
        groups,
        isHighRate,
      },
    };
  }

  // ────────────────────────────────────────────────────────────────
  // Public API
  // ────────────────────────────────────────────────────────────────
  return {
    initData,
    calculateCai,
    calculateFreight,
    // 供 UI 使用的輔助查詢
    isHighRateCity,
  };

})();
