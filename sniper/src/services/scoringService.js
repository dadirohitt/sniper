/**
 * scoringService.js
 * 
 * Deterministic scoring engine.
 * 
 * Rules:
 *   - 4 categories, each scored 0.00–5.00
 *   - Final score = arithmetic average of all 4
 *   - All scores truncated to 2 decimal places (NEVER rounded)
 *   - APPROVE if final >= 4.20, REJECT otherwise
 */

// ------------------------------------------------------------
// TRUNCATION HELPER
// ------------------------------------------------------------

/**
 * Truncates a number to exactly 2 decimal places.
 * Example: 4.209999 → 4.20, not 4.21
 */
function truncate2dp(num) {
  return Math.floor(num * 100) / 100;
}

// ------------------------------------------------------------
// CATEGORY SCORERS
// ------------------------------------------------------------

/**
 * 1. Chart Setup (0.00–5.00)
 * 
 * Scoring logic based on DEX chart data:
 *   - Clean breakout with volume confirmation:        +2.00
 *   - Support held after breakout:                    +1.50
 *   - No large red candles post-breakout:             +1.00
 *   - Healthy consolidation pattern before move:      +0.50
 *   
 * Penalties:
 *   - Failed breakout (price back below level):      -1.00
 *   - Choppy/no clear structure:                     -0.50
 */
function scoreChartSetup(enrichedData) {
  const { dex } = enrichedData;
  let score = 0;
  const reasons = [];

  if (!dex) {
    reasons.push('No DEX data available.');
    return { score: 0.00, reasoning: reasons.join(' ') };
  }

  if (dex.cleanBreakout && dex.volumeConfirmation) {
    score += 2.00;
    reasons.push('Clean breakout with volume confirmation (+2.00).');
  }

  if (dex.supportHeld) {
    score += 1.50;
    reasons.push('Support held post-breakout (+1.50).');
  }

  if (dex.largeRedCandlesPostBreakout === 0) {
    score += 1.00;
    reasons.push('No large red candles post-breakout (+1.00).');
  }

  if (dex.healthyConsolidation) {
    score += 0.50;
    reasons.push('Healthy consolidation before move (+0.50).');
  }

  // Penalties
  if (dex.failedBreakout) {
    score -= 1.00;
    reasons.push('Failed breakout — price back below level (-1.00).');
  }

  if (dex.choppyStructure) {
    score -= 0.50;
    reasons.push('Choppy chart with no clear structure (-0.50).');
  }

  score = Math.max(0, Math.min(5, score)); // clamp 0–5
  return { score: truncate2dp(score), reasoning: reasons.join(' ') };
}

/**
 * 2. Narrative Strength (0.00–5.00)
 * 
 * Based on social + DEX meme signal data:
 *   - Clear, identifiable meme theme:                +2.00
 *   - Narrative aligns with current market trend:    +1.50
 *   - Multiple independent sources confirm narrative:+1.00
 *   - Fresh narrative (not recycled from prior coin):+0.50
 *   
 * Penalties:
 *   - Vague or generic narrative:                    -1.00
 *   - Copied/derivative theme:                       -0.50
 */
function scoreNarrativeStrength(enrichedData) {
  const { social } = enrichedData;
  let score = 0;
  const reasons = [];

  if (!social) {
    reasons.push('No social data available.');
    return { score: 0.00, reasoning: reasons.join(' ') };
  }

  if (social.hasMemeNarrative && social.narrativeClarity === 'clear') {
    score += 2.00;
    reasons.push('Clear, identifiable meme narrative (+2.00).');
  }

  if (social.alignsWithMarketTrend) {
    score += 1.50;
    reasons.push('Narrative aligns with current market trend (+1.50).');
  }

  if (social.multiSourceConfirmed) {
    score += 1.00;
    reasons.push('Multiple independent sources confirm narrative (+1.00).');
  }

  if (social.isFreshNarrative) {
    score += 0.50;
    reasons.push('Fresh narrative — not recycled (+0.50).');
  }

  // Penalties
  if (social.narrativeClarity === 'vague') {
    score -= 1.00;
    reasons.push('Vague or generic narrative (-1.00).');
  }

  if (social.isDerivativeTheme) {
    score -= 0.50;
    reasons.push('Copied or derivative meme theme (-0.50).');
  }

  score = Math.max(0, Math.min(5, score));
  return { score: truncate2dp(score), reasoning: reasons.join(' ') };
}

/**
 * 3. Social Traction (0.00–5.00)
 * 
 * X (Twitter) is MANDATORY. Reddit + DEX are supplementary.
 *   - X mentions > threshold:                        +2.00
 *   - X engagement (likes/RT) above baseline:        +1.50
 *   - Reddit discussion present:                     +1.00
 *   - DEX social signals (whale activity, etc.):     +0.50
 *   
 * Penalties:
 *   - X mentions present but low engagement:         -0.50
 */
function scoreSocialTraction(enrichedData) {
  const { social } = enrichedData;
  let score = 0;
  const reasons = [];

  if (!social || !social.xData) {
    reasons.push('X data missing — Social Traction cannot be scored.');
    return { score: 0.00, reasoning: reasons.join(' ') };
  }

  if (social.xData.mentionCount > 50) {
    score += 2.00;
    reasons.push(`X mentions above threshold (${social.xData.mentionCount}) (+2.00).`);
  }

  if (social.xData.engagementAboveBaseline) {
    score += 1.50;
    reasons.push('X engagement (likes/RT) above baseline (+1.50).');
  }

  if (social.redditData && social.redditData.discussionPresent) {
    score += 1.00;
    reasons.push('Reddit discussion confirmed (+1.00).');
  }

  if (social.dexSocialSignals) {
    score += 0.50;
    reasons.push('DEX social signals present (whale activity, etc.) (+0.50).');
  }

  // Penalties
  if (social.xData.mentionCount > 0 && !social.xData.engagementAboveBaseline) {
    score -= 0.50;
    reasons.push('X mentions present but low engagement (-0.50).');
  }

  score = Math.max(0, Math.min(5, score));
  return { score: truncate2dp(score), reasoning: reasons.join(' ') };
}

/**
 * 4. Timing / Freshness (0.00–5.00)
 * 
 * Based on pair age, call timing, and volume freshness:
 *   - Pair age < 24h (very new):                     +2.00
 *   - Call within first 6h of meaningful volume:     +1.50
 *   - Volume is expanding (not decaying):            +1.00
 *   - Not a repost or delayed signal:                +0.50
 *   
 * Penalties:
 *   - Pair age > 7 days:                             -1.00
 *   - Volume decaying:                               -0.50
 */
function scoreTimingFreshness(enrichedData) {
  const { dex, meta } = enrichedData;
  let score = 0;
  const reasons = [];

  if (!dex) {
    reasons.push('No DEX data available.');
    return { score: 0.00, reasoning: reasons.join(' ') };
  }

  const pairAgeHours = dex.pairAgeHours || Infinity;

  if (pairAgeHours < 24) {
    score += 2.00;
    reasons.push(`Pair age ${pairAgeHours.toFixed(1)}h — very new (+2.00).`);
  }

  if (dex.callWithinEarlyWindow) {
    score += 1.50;
    reasons.push('Call placed within first 6h of meaningful volume (+1.50).');
  }

  if (dex.volumeExpanded) {
    score += 1.00;
    reasons.push('Volume is expanding (+1.00).');
  }

  if (meta && !meta.isRepost) {
    score += 0.50;
    reasons.push('Fresh call — not a repost (+0.50).');
  }

  // Penalties
  if (pairAgeHours > 168) { // 7 days
    score -= 1.00;
    reasons.push(`Pair age ${pairAgeHours.toFixed(1)}h — over 7 days old (-1.00).`);
  }

  if (dex.volumeExpanded === false) {
    score -= 0.50;
    reasons.push('Volume is decaying (-0.50).');
  }

  score = Math.max(0, Math.min(5, score));
  return { score: truncate2dp(score), reasoning: reasons.join(' ') };
}

// ------------------------------------------------------------
// MAIN EXPORT
// ------------------------------------------------------------

/**
 * Runs all 4 category scorers and computes the final score.
 * 
 * @param {object} enrichedData - { dex, social, meta }
 * @returns {object} {
 *   categories: [{ category, score, reasoning }],
 *   finalScore: number (truncated to 2dp),
 *   verdict: 'APPROVE' | 'REJECT'
 * }
 */
function runScoring(enrichedData) {
  const categories = [
    { category: 'chart_setup',        fn: scoreChartSetup },
    { category: 'narrative_strength', fn: scoreNarrativeStrength },
    { category: 'social_traction',    fn: scoreSocialTraction },
    { category: 'timing_freshness',   fn: scoreTimingFreshness },
  ];

  const results = categories.map(({ category, fn }) => {
    const { score, reasoning } = fn(enrichedData);
    return { category, score, reasoning };
  });

  // Final score = arithmetic average, truncated to 2dp
  const avg = results.reduce((sum, r) => sum + r.score, 0) / results.length;
  const finalScore = truncate2dp(avg);

  // Verdict
  const verdict = finalScore >= 4.20 ? 'APPROVE' : 'REJECT';

  return { categories: results, finalScore, verdict };
}

module.exports = { runScoring };
