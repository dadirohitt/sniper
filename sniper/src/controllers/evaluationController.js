/**
 * controllers/evaluationController.js
 */

const { runEvaluation }      = require('../services/evaluationService');
const { getEvaluationById, getAllEvaluations, getCategoryScores, getHardFilterResults, getEvaluationTags, getEnrichmentSnapshots } = require('../db/queries/evaluationQueries');

// ------------------------------------------------------------
// POST /api/evaluations — Manual Evaluation
// ------------------------------------------------------------

async function createEvaluation(req, res) {
  try {
    const { ticker, contractAddress, chain, calledAt } = req.body;

    // Validate input
    if (!ticker || !contractAddress || !chain || !calledAt) {
      return res.status(400).json({
        error: 'Missing required fields: ticker, contractAddress, chain, calledAt',
      });
    }

    if (!['solana', 'bnb'].includes(chain)) {
      return res.status(400).json({
        error: 'chain must be "solana" or "bnb"',
      });
    }

    // Run the full evaluation pipeline
    const result = await runEvaluation({
      ticker,
      contractAddress,
      chain,
      triggeredBy: 'manual',
      calledAt,
    });

    // Fetch enrichment snapshots for the response
    const snapshots = await getEnrichmentSnapshots(result.evaluation.id);

    // Extract key market data from dex snapshot for display
    const dexSnapshot = snapshots.find(s => s.source === 'dexscreener');
    const dexData = dexSnapshot?.payload || {};

    const marketData = {
      dataSource: dexData.dataSource || 'unknown',
      currentPrice: dexData.currentPrice,
      mcap: dexData.mcap,
      ath: dexData.ath,
      priceFromATH: dexData.ath && dexData.currentPrice
        ? (((dexData.ath - dexData.currentPrice) / dexData.ath) * 100).toFixed(2)
        : null,
      liquidity: dexData.liquidity,
      volume24h: dexData.volume24h,
      volume6h: dexData.volume6h,
      txCount24h: dexData.txCount24h,
      priceChange24h: dexData.priceChange24h,
      priceChange6h: dexData.priceChange6h,
      pairAgeHours: dexData.pairAgeHours,
      hasCandles: dexData.hasCandles,
      candleCount: dexData.candleCount,
    };

    // Return the result
    return res.status(201).json({
      evaluationId: result.evaluation.id,
      status:       result.evaluation.status,
      verdict:      result.verdict,
      finalScore:   result.finalScore,
      blocked:      result.blocked,
      blockReason:  result.blockReason || null,
      hardFilters:  result.hardFilters,
      categories:   result.categories,
      tags:         result.tags,
      rejectionReason: result.rejectionReason || null,
      marketData,
    });
  } catch (err) {
    console.error('[EVAL] Error:', err);
    return res.status(500).json({ error: err.message });
  }
}

// ------------------------------------------------------------
// GET /api/evaluations/:id — Single Evaluation (full breakdown)
// ------------------------------------------------------------

async function getEvaluation(req, res) {
  try {
    const { id } = req.params;

    const evaluation      = await getEvaluationById(id);
    if (!evaluation) {
      return res.status(404).json({ error: 'Evaluation not found' });
    }

    const categories      = await getCategoryScores(id);
    const hardFilters     = await getHardFilterResults(id);
    const tags            = await getEvaluationTags(id);
    const snapshots       = await getEnrichmentSnapshots(id);

    return res.status(200).json({
      evaluation,
      categories,
      hardFilters,
      tags: tags.map(t => t.tag),
      enrichmentSnapshots: snapshots,
    });
  } catch (err) {
    console.error('[EVAL] Error:', err);
    return res.status(500).json({ error: err.message });
  }
}

// ------------------------------------------------------------
// GET /api/evaluations — List all evaluations
// ------------------------------------------------------------

async function listEvaluations(req, res) {
  try {
    const limit  = parseInt(req.query.limit) || 50;
    const offset = parseInt(req.query.offset) || 0;

    const evaluations = await getAllEvaluations({ limit, offset });

    return res.status(200).json({ evaluations, limit, offset });
  } catch (err) {
    console.error('[EVAL] Error:', err);
    return res.status(500).json({ error: err.message });
  }
}

module.exports = { createEvaluation, getEvaluation, listEvaluations };
