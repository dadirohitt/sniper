/**
 * enrichmentService.js
 * 
 * Coordinates data fetching from all 3 sources:
 *   - Dexscreener (mandatory)
 *   - X / Twitter (mandatory — eval HALTS if unavailable)
 *   - Reddit (supplementary)
 * 
 * Returns structured enrichment payload used by filters + scoring.
 * Also returns raw snapshots for audit logging.
 */

const dexscreenerScraper = require('../scrapers/dexscreenerScraper');
const xTwitterScraper    = require('../scrapers/xTwitterScraper');
const redditScraper      = require('../scrapers/redditScraper');

// ------------------------------------------------------------
// MAIN ENRICHMENT FUNCTION
// ------------------------------------------------------------

/**
 * Fetches and structures all enrichment data for an asset.
 * 
 * @param {object} asset - { ticker, contractAddress, chain }
 * @returns {object} {
 *     status: 'success' | 'blocked',
 *     blockReason: string | null,
 *     snapshots: [{ source, fetchedAt, payload, status }],
 *     enrichedData: { dex, social, meta } | null
 *   }
 */
async function enrichAsset(asset) {
  const snapshots = [];
  let dexData = null;
  let xData = null;
  let redditData = null;

  // Normalize asset fields (DB uses snake_case, code uses camelCase)
  const normalizedAsset = {
    ticker: asset.ticker,
    contractAddress: asset.contractAddress || asset.contract_address,
    chain: asset.chain,
  };

  // ------------------------------------------------------------
  // 1. FETCH DEXSCREENER (mandatory)
  // ------------------------------------------------------------
  try {
    const result = await dexscreenerScraper.fetch(normalizedAsset);
    snapshots.push({
      source: 'dexscreener',
      fetchedAt: new Date().toISOString(),
      payload: result,
      status: 'success',
    });
    dexData = result;
  } catch (err) {
    snapshots.push({
      source: 'dexscreener',
      fetchedAt: new Date().toISOString(),
      payload: { error: err.message },
      status: 'failed',
    });
  }

  // ------------------------------------------------------------
  // 2. FETCH X / TWITTER (mandatory — HALT if unavailable)
  // ------------------------------------------------------------
  try {
    const result = await xTwitterScraper.fetch(normalizedAsset);
    snapshots.push({
      source: 'x_twitter',
      fetchedAt: new Date().toISOString(),
      payload: result,
      status: 'success',
    });
    xData = result;
  } catch (err) {
    snapshots.push({
      source: 'x_twitter',
      fetchedAt: new Date().toISOString(),
      payload: { error: err.message },
      status: 'unavailable',
    });

    // X is MANDATORY. If it fails → evaluation must HALT.
    return {
      status: 'blocked',
      blockReason: 'BLOCKED_MISSING_X',
      snapshots,
      enrichedData: null,
    };
  }

  // ------------------------------------------------------------
  // 3. FETCH REDDIT (supplementary — does NOT block)
  // ------------------------------------------------------------
  try {
    const result = await redditScraper.fetch(normalizedAsset);
    snapshots.push({
      source: 'reddit',
      fetchedAt: new Date().toISOString(),
      payload: result,
      status: 'success',
    });
    redditData = result;
  } catch (err) {
    snapshots.push({
      source: 'reddit',
      fetchedAt: new Date().toISOString(),
      payload: { error: err.message },
      status: 'failed',
    });
    // Reddit failure does NOT block evaluation
  }

  // ------------------------------------------------------------
  // 4. STRUCTURE ENRICHED DATA
  // ------------------------------------------------------------
  const enrichedData = structureEnrichmentData({ dexData, xData, redditData });

  return {
    status: 'success',
    blockReason: null,
    snapshots,
    enrichedData,
  };
}

// ------------------------------------------------------------
// DATA STRUCTURING
// ------------------------------------------------------------

/**
 * Transforms raw scraper outputs into the standardized enrichment shape
 * expected by hardFilterService and scoringService.
 * 
 * Shape:
 *   {
 *     dex: { ...parsed dexscreener fields },
 *     social: { ...combined X + Reddit social signals },
 *     meta: { ...timing/freshness metadata }
 *   }
 */
function structureEnrichmentData({ dexData, xData, redditData }) {
  // --- DEX fields ---
  const dex = dexData ? {
    currentPrice:                  dexData.currentPrice,
    ath:                           dexData.ath,
    hasReclaimed:                  dexData.hasReclaimed || false,
    pumpPercent:                   dexData.pumpPercent || 0,
    reclaimedBreakout:             dexData.reclaimedBreakout || false,
    cleanBreakout:                 dexData.cleanBreakout || false,
    volumeConfirmation:            dexData.volumeConfirmation || false,
    supportHeld:                   dexData.supportHeld || false,
    largeRedCandlesPostBreakout:   dexData.largeRedCandlesPostBreakout || 0,
    healthyConsolidation:          dexData.healthyConsolidation || false,
    failedBreakout:                dexData.failedBreakout || false,
    choppyStructure:               dexData.choppyStructure || false,
    isSideways:                    dexData.isSideways || false,
    volumeExpanded:                dexData.volumeExpanded || false,
    suddenSpikeDetected:           dexData.suddenSpikeDetected || false,
    pairAgeHours:                  dexData.pairAgeHours || null,
    callWithinEarlyWindow:         dexData.callWithinEarlyWindow || false,
  } : null;

  // --- Social fields (X mandatory + Reddit supplementary) ---
  // X scraping often returns 0 results because X blocks client-side scraping.
  // When that happens, derive social proxy signals from DEX transaction data.
  const xBlocked = xData && xData.mentionCount === 0;
  const dexTxCount = dexData ? (dexData.txCount24h || 0) : 0;

  const effectiveMentions = xBlocked && dexTxCount > 0
    ? Math.min(dexTxCount, 500)
    : (xData ? xData.mentionCount || 0 : 0);

  const effectiveEngagement = xBlocked
    ? dexTxCount > 100
    : (xData ? xData.engagementAboveBaseline || false : false);

  // Narrative: fall back to Reddit when X can't detect it
  const effectiveNarrative   = (xData && xData.hasMemeNarrative) || (redditData && redditData.hasMemeNarrative) || false;
  const effectiveClarity     = (xData && xData.narrativeClarity !== 'vague') ? xData.narrativeClarity : (redditData && redditData.hasMemeNarrative ? 'moderate' : 'vague');
  const effectiveMarketTrend = effectiveEngagement && effectiveNarrative;

  const social = xData ? {
    hasMemeNarrative:      effectiveNarrative,
    narrativeClarity:      effectiveClarity,
    narrativeSummary:      xData.narrativeSummary || (redditData && redditData.hasMemeNarrative ? 'Narrative detected via Reddit.' : ''),
    alignsWithMarketTrend: effectiveMarketTrend,
    multiSourceConfirmed:  effectiveNarrative && redditData && redditData.hasMemeNarrative,
    isFreshNarrative:      xData.isFreshNarrative || false,
    isDerivativeTheme:     xData.isDerivativeTheme || false,
    hasXTraction:          xData.hasTraction || effectiveEngagement,
    hasRedditTraction:     redditData ? redditData.hasTraction || false : false,
    dexSocialSignals:      dex ? dex.suddenSpikeDetected : false,
    xData: {
      mentionCount:              effectiveMentions,
      engagementAboveBaseline:   effectiveEngagement,
    },
    redditData: redditData ? {
      discussionPresent: redditData.discussionPresent || false,
    } : null,
  } : null;

  // --- Meta fields ---
  const meta = {
    isRepost: dexData ? dexData.isRepost || false : false,
  };

  return { dex, social, meta };
}

module.exports = { enrichAsset };
