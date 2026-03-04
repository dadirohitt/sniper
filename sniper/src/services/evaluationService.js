/**
 * evaluationService.js
 * 
 * THE BRAIN OF SNIPER.
 * 
 * Orchestrates the full evaluation pipeline:
 *   1. Upsert asset
 *   2. Create evaluation record (pending)
 *   3. Fetch active ruleset
 *   4. Enrich data (X, Reddit, Dexscreener)
 *   5. If enrichment blocked → log & halt
 *   6. Run hard filters → if any triggered → REJECT
 *   7. Run scoring → calculate verdict
 *   8. Assign tags
 *   9. Persist everything
 *  10. Return full evaluation result
 * 
 * This service is STATELESS per evaluation.
 * Outcomes are never read or used here.
 */

const { upsertAsset }                = require('../db/queries/assetQueries');
const {
  createEvaluation,
  updateEvaluationBlocked,
  updateEvaluationComplete,
  insertCategoryScore,
  insertHardFilterResult,
  insertEvaluationTag,
  insertEnrichmentSnapshot,
  getActiveRuleset,
} = require('../db/queries/evaluationQueries');

const { enrichAsset }  = require('./enrichmentService');
const { runHardFilters } = require('./hardFilterService');
const { runScoring }     = require('./scoringService');
const { assignTags }     = require('./tagService');

// ------------------------------------------------------------
// MAIN EVALUATION PIPELINE
// ------------------------------------------------------------

/**
 * @param {object} input
 * @param {string} input.ticker
 * @param {string} input.contractAddress
 * @param {string} input.chain            - 'solana' | 'bnb'
 * @param {string} input.triggeredBy      - 'manual' | 'scanner'
 * @param {string} input.calledAt         - ISO timestamp of the call
 * 
 * @returns {object} Full evaluation result
 */
async function runEvaluation({ ticker, contractAddress, chain, triggeredBy, calledAt }) {
  // ----------------------------------------------------------
  // STEP 1: Upsert asset
  // ----------------------------------------------------------
  const asset = await upsertAsset({ ticker, contractAddress, chain });
  console.log(`[EVAL] Asset: ${asset.ticker} (${asset.chain}) | ID: ${asset.id}`);

  // ----------------------------------------------------------
  // STEP 2: Fetch active ruleset
  // ----------------------------------------------------------
  const ruleset = await getActiveRuleset();
  if (!ruleset) {
    throw new Error('[EVAL] No active ruleset found. Cannot proceed.');
  }
  console.log(`[EVAL] Ruleset: ${ruleset.version}`);

  // ----------------------------------------------------------
  // STEP 3: Create evaluation record (pending)
  // ----------------------------------------------------------
  const evaluation = await createEvaluation({
    assetId: asset.id,
    rulesetVersion: ruleset.version,
    triggeredBy,
    calledAt,
  });
  console.log(`[EVAL] Created evaluation: ${evaluation.id} | Status: pending`);

  // ----------------------------------------------------------
  // STEP 4: Enrich data
  // ----------------------------------------------------------
  const enrichment = await enrichAsset(asset);

  // Log all enrichment snapshots
  for (const snap of enrichment.snapshots) {
    await insertEnrichmentSnapshot({
      evaluationId: evaluation.id,
      source: snap.source,
      fetchedAt: snap.fetchedAt,
      payload: snap.payload,
      status: snap.status,
    });
  }

  // ----------------------------------------------------------
  // STEP 5: If enrichment blocked → HALT
  // ----------------------------------------------------------
  if (enrichment.status === 'blocked') {
    const updated = await updateEvaluationBlocked({
      evaluationId: evaluation.id,
      blockReason: enrichment.blockReason,
    });
    console.log(`[EVAL] BLOCKED — ${enrichment.blockReason}`);

    return {
      evaluation: updated,
      blocked: true,
      blockReason: enrichment.blockReason,
      hardFilters: [],
      categories: [],
      tags: [],
      finalScore: null,
      verdict: null,
    };
  }

  const { enrichedData } = enrichment;

  // ----------------------------------------------------------
  // STEP 6: Run hard filters
  // ----------------------------------------------------------
  const { anyTriggered, results: filterResults } = runHardFilters(enrichedData);

  // Persist all filter results
  for (const fr of filterResults) {
    await insertHardFilterResult({
      evaluationId: evaluation.id,
      filterName: fr.filterName,
      triggered: fr.triggered,
      evidence: fr.evidence,
    });
  }

  // If any hard filter triggered → immediate REJECT
  // But still run scoring for visibility (score != 0, just REJECT regardless)
  if (anyTriggered) {
    const triggeredFilters = filterResults.filter(f => f.triggered).map(f => f.filterName);
    console.log(`[EVAL] REJECT — Hard filter(s) triggered: ${triggeredFilters.join(', ')}`);

    // Still run scoring to show what the score would have been
    const { categories, finalScore } = runScoring(enrichedData);

    // Persist category scores even for hard-filter rejects
    for (const cat of categories) {
      await insertCategoryScore({
        evaluationId: evaluation.id,
        category: cat.category,
        score: cat.score,
        reasoning: cat.reasoning,
      });
    }

    const updated = await updateEvaluationComplete({
      evaluationId: evaluation.id,
      verdict: 'REJECT',
      finalScore, // Use actual score, not 0
    });

    // Still assign tags for rejected evals
    const tags = assignTags({ enrichedData, filterResults, verdict: 'REJECT' });
    for (const tag of tags) {
      await insertEvaluationTag({ evaluationId: evaluation.id, tag });
    }

    return {
      evaluation: updated,
      blocked: false,
      hardFilters: filterResults,
      categories, // Include actual scores
      tags,
      finalScore, // Use actual score
      verdict: 'REJECT',
      rejectionReason: `Hard filter(s) triggered: ${triggeredFilters.join(', ')}`,
    };
  }

  // ----------------------------------------------------------
  // STEP 7: Run scoring
  // ----------------------------------------------------------
  const { categories, finalScore, verdict } = runScoring(enrichedData);

  // Persist category scores
  for (const cat of categories) {
    await insertCategoryScore({
      evaluationId: evaluation.id,
      category: cat.category,
      score: cat.score,
      reasoning: cat.reasoning,
    });
  }

  // ----------------------------------------------------------
  // STEP 8: Assign tags
  // ----------------------------------------------------------
  const tags = assignTags({ enrichedData, filterResults, verdict });
  for (const tag of tags) {
    await insertEvaluationTag({ evaluationId: evaluation.id, tag });
  }

  // ----------------------------------------------------------
  // STEP 9: Finalize evaluation
  // ----------------------------------------------------------
  const updated = await updateEvaluationComplete({
    evaluationId: evaluation.id,
    verdict,
    finalScore,
  });

  console.log(`[EVAL] COMPLETE — Score: ${finalScore} | Verdict: ${verdict}`);

  // ----------------------------------------------------------
  // STEP 10: Return full result
  // ----------------------------------------------------------
  return {
    evaluation: updated,
    blocked: false,
    hardFilters: filterResults,
    categories,
    tags,
    finalScore,
    verdict,
  };
}

module.exports = { runEvaluation };
