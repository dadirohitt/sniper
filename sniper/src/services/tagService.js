/**
 * tagService.js
 * 
 * Assigns tags from the FROZEN predefined list only.
 * No free-form tags. No guessing.
 * 
 * Tags are assigned based on concrete signals in the enriched data.
 */

// ------------------------------------------------------------
// TAG ASSIGNMENT RULES
// ------------------------------------------------------------

/**
 * Deterministic tag assignment.
 * Each rule checks a concrete condition → applies tag if true.
 * 
 * @param {object} params
 * @param {object} params.enrichedData   - { dex, social, meta }
 * @param {Array}  params.filterResults  - hard filter results
 * @param {string} params.verdict        - 'APPROVE' | 'REJECT'
 * @returns {string[]} - array of tag strings from frozen enum
 */
function assignTags({ enrichedData, filterResults, verdict }) {
  const tags = [];
  const { dex, social, meta } = enrichedData || {};

  // --- early_breakout ---
  // Pair is new (<24h) and broke out cleanly
  if (dex && dex.pairAgeHours < 24 && dex.cleanBreakout) {
    tags.push('early_breakout');
  }

  // --- mid_pump_chase ---
  // Pair is between 24h–72h and pump is already in progress
  if (dex && dex.pairAgeHours >= 24 && dex.pairAgeHours <= 72 && dex.pumpPercent > 50) {
    tags.push('mid_pump_chase');
  }

  // --- no_meme_trend ---
  // Hard filter for no narrative was triggered
  if (filterResults && filterResults.some(f => f.filterName === 'no_clear_meme_narrative' && f.triggered)) {
    tags.push('no_meme_trend');
  }

  // --- delayed_ct_wave ---
  // Repost/delayed signal detected
  if (meta && meta.isRepost) {
    tags.push('delayed_ct_wave');
  }

  // --- high_volume_launch ---
  // New pair (<24h) with volume expansion confirmed
  if (dex && dex.pairAgeHours < 24 && dex.volumeExpanded) {
    tags.push('high_volume_launch');
  }

  // --- CT_reactive ---
  // X traction is high but narrative only appeared after price move
  if (social && social.hasXTraction && dex && dex.suddenSpikeDetected) {
    tags.push('CT_reactive');
  }

  // --- unconfirmed_narrative ---
  // Narrative exists on X but Reddit doesn't confirm it
  if (social && social.hasXTraction && social.hasMemeNarrative && !social.multiSourceConfirmed) {
    tags.push('unconfirmed_narrative');
  }

  // --- stealth_v_no_meme ---
  // MEV stealth pump filter was triggered
  if (filterResults && filterResults.some(f => f.filterName === 'mev_stealth_pump' && f.triggered)) {
    tags.push('stealth_v_no_meme');
  }

  return tags;
}

module.exports = { assignTags };
