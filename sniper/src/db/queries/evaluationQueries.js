const pool = require('../pool');

// ------------------------------------------------------------
// EVALUATIONS
// ------------------------------------------------------------

async function createEvaluation({ assetId, rulesetVersion, triggeredBy, calledAt }) {
  const query = `
    INSERT INTO evaluations (asset_id, ruleset_version, triggered_by, status, called_at)
    VALUES ($1, $2, $3, 'pending', $4)
    RETURNING *;
  `;
  const { rows } = await pool.query(query, [assetId, rulesetVersion, triggeredBy, calledAt]);
  return rows[0];
}

async function updateEvaluationBlocked({ evaluationId, blockReason }) {
  const query = `
    UPDATE evaluations
    SET status = 'blocked', block_reason = $2
    WHERE id = $1
    RETURNING *;
  `;
  const { rows } = await pool.query(query, [evaluationId, blockReason]);
  return rows[0];
}

async function updateEvaluationComplete({ evaluationId, verdict, finalScore }) {
  const query = `
    UPDATE evaluations
    SET status = 'complete', verdict = $2, final_score = $3, evaluated_at = NOW()
    WHERE id = $1
    RETURNING *;
  `;
  const { rows } = await pool.query(query, [evaluationId, verdict, finalScore]);
  return rows[0];
}

async function getEvaluationById(evaluationId) {
  const query = `SELECT * FROM evaluations WHERE id = $1;`;
  const { rows } = await pool.query(query, [evaluationId]);
  return rows[0] || null;
}

async function getAllEvaluations({ limit = 50, offset = 0 }) {
  const query = `
    SELECT e.*, a.ticker, a.chain, a.contract_address
    FROM evaluations e
    JOIN assets a ON e.asset_id = a.id
    ORDER BY e.created_at DESC
    LIMIT $1 OFFSET $2;
  `;
  const { rows } = await pool.query(query, [limit, offset]);
  return rows;
}

// ------------------------------------------------------------
// CATEGORY SCORES
// ------------------------------------------------------------

async function insertCategoryScore({ evaluationId, category, score, reasoning }) {
  const query = `
    INSERT INTO category_scores (evaluation_id, category, score, reasoning)
    VALUES ($1, $2, $3, $4)
    RETURNING *;
  `;
  const { rows } = await pool.query(query, [evaluationId, category, score, reasoning]);
  return rows[0];
}

async function getCategoryScores(evaluationId) {
  const query = `SELECT * FROM category_scores WHERE evaluation_id = $1;`;
  const { rows } = await pool.query(query, [evaluationId]);
  return rows;
}

// ------------------------------------------------------------
// HARD FILTER RESULTS
// ------------------------------------------------------------

async function insertHardFilterResult({ evaluationId, filterName, triggered, evidence }) {
  const query = `
    INSERT INTO hard_filter_results (evaluation_id, filter_name, triggered, evidence)
    VALUES ($1, $2, $3, $4)
    RETURNING *;
  `;
  const { rows } = await pool.query(query, [evaluationId, filterName, triggered, evidence || null]);
  return rows[0];
}

async function getHardFilterResults(evaluationId) {
  const query = `SELECT * FROM hard_filter_results WHERE evaluation_id = $1;`;
  const { rows } = await pool.query(query, [evaluationId]);
  return rows;
}

// ------------------------------------------------------------
// EVALUATION TAGS
// ------------------------------------------------------------

async function insertEvaluationTag({ evaluationId, tag }) {
  const query = `
    INSERT INTO evaluation_tags (evaluation_id, tag)
    VALUES ($1, $2)
    ON CONFLICT (evaluation_id, tag) DO NOTHING
    RETURNING *;
  `;
  const { rows } = await pool.query(query, [evaluationId, tag]);
  return rows[0] || null;
}

async function getEvaluationTags(evaluationId) {
  const query = `SELECT * FROM evaluation_tags WHERE evaluation_id = $1;`;
  const { rows } = await pool.query(query, [evaluationId]);
  return rows;
}

// ------------------------------------------------------------
// OUTCOMES
// ------------------------------------------------------------

async function insertOutcome({ evaluationId, loggedBy, outcomeNotes, peakPriceAfter, result = 'pending' }) {
  const query = `
    INSERT INTO outcomes (evaluation_id, logged_by, outcome_notes, peak_price_after, result)
    VALUES ($1, $2, $3, $4, $5)
    RETURNING *;
  `;
  const { rows } = await pool.query(query, [evaluationId, loggedBy, outcomeNotes || null, peakPriceAfter || null, result]);
  return rows[0];
}

async function updateOutcome({ evaluationId, result, outcomeNotes, peakPriceAfter }) {
  // Build dynamic update query based on provided fields
  const updates = [];
  const values = [];
  let paramIndex = 1;

  if (result !== undefined) {
    updates.push(`result = $${paramIndex++}`);
    values.push(result);
  }
  if (outcomeNotes !== undefined) {
    updates.push(`outcome_notes = $${paramIndex++}`);
    values.push(outcomeNotes);
  }
  if (peakPriceAfter !== undefined) {
    updates.push(`peak_price_after = $${paramIndex++}`);
    values.push(peakPriceAfter);
  }

  if (updates.length === 0) {
    return getOutcome(evaluationId);
  }

  values.push(evaluationId);
  const query = `
    UPDATE outcomes
    SET ${updates.join(', ')}
    WHERE evaluation_id = $${paramIndex}
    RETURNING *;
  `;
  const { rows } = await pool.query(query, values);
  return rows[0];
}

async function getOutcome(evaluationId) {
  const query = `SELECT * FROM outcomes WHERE evaluation_id = $1;`;
  const { rows } = await pool.query(query, [evaluationId]);
  return rows[0] || null;
}

async function getAllCallsWithOutcomes({ limit = 100, offset = 0 }) {
  const query = `
    SELECT
      e.id as evaluation_id,
      e.verdict,
      e.final_score,
      e.status,
      e.triggered_by,
      e.called_at,
      e.created_at,
      e.block_reason,
      a.ticker,
      a.chain,
      a.contract_address,
      o.result as outcome_result,
      o.outcome_notes,
      o.peak_price_after,
      o.logged_at as outcome_logged_at
    FROM evaluations e
    JOIN assets a ON e.asset_id = a.id
    LEFT JOIN outcomes o ON e.id = o.evaluation_id
    ORDER BY e.created_at DESC
    LIMIT $1 OFFSET $2;
  `;
  const { rows } = await pool.query(query, [limit, offset]);
  return rows;
}

// ------------------------------------------------------------
// ENRICHMENT SNAPSHOTS
// ------------------------------------------------------------

async function insertEnrichmentSnapshot({ evaluationId, source, fetchedAt, payload, status }) {
  const query = `
    INSERT INTO enrichment_snapshots (evaluation_id, source, fetched_at, payload, status)
    VALUES ($1, $2, $3, $4, $5)
    RETURNING *;
  `;
  const { rows } = await pool.query(query, [evaluationId, source, fetchedAt, JSON.stringify(payload), status]);
  return rows[0];
}

async function getEnrichmentSnapshots(evaluationId) {
  const query = `SELECT * FROM enrichment_snapshots WHERE evaluation_id = $1;`;
  const { rows } = await pool.query(query, [evaluationId]);
  return rows;
}

// ------------------------------------------------------------
// RULESETS
// ------------------------------------------------------------

async function getActiveRuleset() {
  const query = `SELECT * FROM rulesets WHERE status = 'active' LIMIT 1;`;
  const { rows } = await pool.query(query);
  return rows[0] || null;
}

module.exports = {
  // Evaluations
  createEvaluation,
  updateEvaluationBlocked,
  updateEvaluationComplete,
  getEvaluationById,
  getAllEvaluations,
  // Category Scores
  insertCategoryScore,
  getCategoryScores,
  // Hard Filters
  insertHardFilterResult,
  getHardFilterResults,
  // Tags
  insertEvaluationTag,
  getEvaluationTags,
  // Outcomes
  insertOutcome,
  updateOutcome,
  getOutcome,
  getAllCallsWithOutcomes,
  // Enrichment
  insertEnrichmentSnapshot,
  getEnrichmentSnapshots,
  // Rulesets
  getActiveRuleset,
};
