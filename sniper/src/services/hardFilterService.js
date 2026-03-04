/**
 * hardFilterService.js
 * 
 * Runs all 8 hard filters against enriched data.
 * ANY filter triggered = immediate REJECT.
 * All filters are logged regardless of outcome.
 * 
 * Each filter receives the full enrichment payload and returns:
 *   { triggered: boolean, evidence: string | null }
 */

// ------------------------------------------------------------
// FILTER DEFINITIONS
// ------------------------------------------------------------

/**
 * 1. Entry at or near ATH with no reclaim
 * Triggered if: current price is within 5% of ATH and has not dipped + reclaimed.
 */
function filter_entry_near_ath_no_reclaim(data) {
  const { dex } = data;
  if (!dex || dex.ath == null || dex.currentPrice == null) {
    return { triggered: false, evidence: 'Insufficient ATH data — filter skipped.' };
  }

  const athProximity = ((dex.ath - dex.currentPrice) / dex.ath) * 100;
  const triggered = athProximity <= 5 && !dex.hasReclaimed;

  return {
    triggered,
    evidence: triggered
      ? `Price within ${athProximity.toFixed(2)}% of ATH (${dex.ath}). No confirmed reclaim.`
      : `Price is ${athProximity.toFixed(2)}% below ATH. Filter not triggered.`,
  };
}

/**
 * 2. Vertical pump + failed reclaim
 * Triggered if: price surged >100% in a short window and failed to hold above the breakout level.
 */
function filter_vertical_pump_failed_reclaim(data) {
  const { dex } = data;
  if (!dex || dex.pumpPercent == null || dex.reclaimedBreakout == null) {
    return { triggered: false, evidence: 'Insufficient pump/reclaim data — filter skipped.' };
  }

  const triggered = dex.pumpPercent > 100 && !dex.reclaimedBreakout;

  return {
    triggered,
    evidence: triggered
      ? `Vertical pump of ${dex.pumpPercent.toFixed(2)}% detected. Failed to reclaim breakout level.`
      : `Pump of ${dex.pumpPercent.toFixed(2)}%. Reclaimed: ${dex.reclaimedBreakout}.`,
  };
}

/**
 * 3. No clear meme narrative
 * Triggered if: no identifiable meme theme found across X + Reddit.
 */
function filter_no_clear_meme_narrative(data) {
  const { social } = data;
  if (!social) {
    return { triggered: true, evidence: 'No social data available — no narrative can be confirmed.' };
  }

  const triggered = !social.hasMemeNarrative;

  return {
    triggered,
    evidence: triggered
      ? 'No identifiable meme narrative found across X or Reddit.'
      : `Meme narrative detected: "${social.narrativeSummary}".`,
  };
}

/**
 * 4. No traction outside Telegram
 * Triggered if: social activity is limited to Telegram-only with no X or Reddit presence.
 */
function filter_no_traction_outside_telegram(data) {
  const { social } = data;
  if (!social) {
    return { triggered: true, evidence: 'No social data — cannot confirm traction outside Telegram.' };
  }

  const triggered = !social.hasXTraction && !social.hasRedditTraction;

  return {
    triggered,
    evidence: triggered
      ? 'No traction detected on X or Reddit. Likely Telegram-only.'
      : `Traction found — X: ${social.hasXTraction}, Reddit: ${social.hasRedditTraction}.`,
  };
}

/**
 * 5. Repost / delayed call with no fresh volume
 * Triggered if: the call is a repost of an older signal and volume has not expanded.
 */
function filter_repost_delayed_no_fresh_volume(data) {
  const { dex, meta } = data;
  if (!dex || !meta || dex.volumeExpanded == null || meta.isRepost == null) {
    return { triggered: false, evidence: 'Insufficient repost/volume data — filter skipped.' };
  }

  const triggered = meta.isRepost && !dex.volumeExpanded;

  return {
    triggered,
    evidence: triggered
      ? 'Detected as repost/delayed call. No fresh volume expansion.'
      : `Repost: ${meta.isRepost}, Volume expanded: ${dex.volumeExpanded}.`,
  };
}

/**
 * 6. MEV-like stealth pump
 * Triggered if: sudden price spike with no corresponding social or narrative activity.
 */
function filter_mev_stealth_pump(data) {
  const { dex, social } = data;
  if (!dex || !social || dex.suddenSpikeDetected == null) {
    return { triggered: false, evidence: 'Insufficient data for stealth pump detection — filter skipped.' };
  }

  const triggered = dex.suddenSpikeDetected && !social.hasMemeNarrative && !social.hasXTraction;

  return {
    triggered,
    evidence: triggered
      ? 'Sudden price spike with zero social/narrative activity. Likely MEV or stealth pump.'
      : 'Spike or social activity present — not a stealth pump.',
  };
}

/**
 * 7. ≥2 large red candles post-breakout
 * Triggered if: two or more large bearish candles appeared after a breakout.
 */
function filter_two_plus_large_red_candles_post_breakout(data) {
  const { dex } = data;
  if (!dex || dex.largeRedCandlesPostBreakout == null) {
    return { triggered: false, evidence: 'Insufficient candle data — filter skipped.' };
  }

  const triggered = dex.largeRedCandlesPostBreakout >= 2;

  return {
    triggered,
    evidence: triggered
      ? `${dex.largeRedCandlesPostBreakout} large red candles detected post-breakout.`
      : `Only ${dex.largeRedCandlesPostBreakout} large red candle(s) post-breakout.`,
  };
}

/**
 * 8. Sideways chart with no volume expansion
 * Triggered if: price is range-bound and volume has not increased.
 */
function filter_sideways_no_volume_expansion(data) {
  const { dex } = data;
  if (!dex || dex.isSideways == null || dex.volumeExpanded == null) {
    return { triggered: false, evidence: 'Insufficient sideways/volume data — filter skipped.' };
  }

  const triggered = dex.isSideways && !dex.volumeExpanded;

  return {
    triggered,
    evidence: triggered
      ? 'Chart is sideways with no volume expansion. No momentum.'
      : `Sideways: ${dex.isSideways}, Volume expanded: ${dex.volumeExpanded}.`,
  };
}

// ------------------------------------------------------------
// FILTER REGISTRY — maps enum names to functions
// ------------------------------------------------------------

const FILTERS = {
  entry_near_ath_no_reclaim:                    filter_entry_near_ath_no_reclaim,
  vertical_pump_failed_reclaim:                 filter_vertical_pump_failed_reclaim,
  no_clear_meme_narrative:                      filter_no_clear_meme_narrative,
  no_traction_outside_telegram:                 filter_no_traction_outside_telegram,
  repost_delayed_no_fresh_volume:               filter_repost_delayed_no_fresh_volume,
  mev_stealth_pump:                             filter_mev_stealth_pump,
  two_plus_large_red_candles_post_breakout:     filter_two_plus_large_red_candles_post_breakout,
  sideways_no_volume_expansion:                 filter_sideways_no_volume_expansion,
};

// ------------------------------------------------------------
// MAIN EXPORT — runs all filters, returns results
// ------------------------------------------------------------

/**
 * Runs all 8 hard filters against enriched data.
 * 
 * @param {object} enrichedData - { dex, social, meta }
 * @returns {object} { anyTriggered: boolean, results: Array<{ filterName, triggered, evidence }> }
 */
function runHardFilters(enrichedData) {
  const results = [];

  for (const [filterName, filterFn] of Object.entries(FILTERS)) {
    const result = filterFn(enrichedData);
    results.push({
      filterName,
      triggered: result.triggered,
      evidence: result.evidence,
    });
  }

  const anyTriggered = results.some(r => r.triggered);

  return { anyTriggered, results };
}

module.exports = { runHardFilters };
