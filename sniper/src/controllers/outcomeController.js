/**
 * controllers/outcomeController.js
 *
 * Outcomes are manual-only and NEVER feed back into the evaluation engine.
 */

const {
  insertOutcome,
  updateOutcome: updateOutcomeQuery,
  getOutcome: getOutcomeQuery,
  getEvaluationById,
  getAllCallsWithOutcomes,
} = require('../db/queries/evaluationQueries');

// ------------------------------------------------------------
// POST /api/evaluations/:id/outcome — Log Outcome
// ------------------------------------------------------------

async function logOutcome(req, res) {
  try {
    const { id } = req.params;
    const { loggedBy, outcomeNotes, peakPriceAfter, result } = req.body;

    // Verify evaluation exists
    const evaluation = await getEvaluationById(id);
    if (!evaluation) {
      return res.status(404).json({ error: 'Evaluation not found' });
    }

    // Only complete evaluations can have outcomes logged
    if (evaluation.status !== 'complete') {
      return res.status(400).json({ error: 'Outcomes can only be logged for completed evaluations' });
    }

    if (!loggedBy) {
      return res.status(400).json({ error: 'loggedBy is required' });
    }

    // Validate result if provided
    const validResults = ['pending', 'win', 'loss'];
    if (result && !validResults.includes(result.toLowerCase())) {
      return res.status(400).json({ error: 'result must be one of: pending, win, loss' });
    }

    const outcome = await insertOutcome({
      evaluationId: id,
      loggedBy,
      outcomeNotes: outcomeNotes || null,
      peakPriceAfter: peakPriceAfter || null,
      result: result ? result.toLowerCase() : 'pending',
    });

    return res.status(201).json({ outcome });
  } catch (err) {
    // Handle duplicate outcome (unique constraint on evaluation_id)
    if (err.code === '23505') {
      return res.status(409).json({ error: 'Outcome already logged for this evaluation' });
    }
    console.error('[OUTCOME] Error:', err);
    return res.status(500).json({ error: err.message });
  }
}

// ------------------------------------------------------------
// PATCH /api/evaluations/:id/outcome — Update Outcome (WIN/LOSS)
// ------------------------------------------------------------

async function updateOutcome(req, res) {
  try {
    const { id } = req.params;
    const { result, outcomeNotes, peakPriceAfter } = req.body;

    // Check if outcome exists
    const existing = await getOutcomeQuery(id);
    if (!existing) {
      return res.status(404).json({ error: 'No outcome logged for this evaluation' });
    }

    // Validate result if provided
    const validResults = ['pending', 'win', 'loss'];
    if (result && !validResults.includes(result.toLowerCase())) {
      return res.status(400).json({ error: 'result must be one of: pending, win, loss' });
    }

    const outcome = await updateOutcomeQuery({
      evaluationId: id,
      result: result ? result.toLowerCase() : undefined,
      outcomeNotes,
      peakPriceAfter,
    });

    return res.status(200).json({ outcome });
  } catch (err) {
    console.error('[OUTCOME] Error:', err);
    return res.status(500).json({ error: err.message });
  }
}

// ------------------------------------------------------------
// GET /api/evaluations/:id/outcome — Get Outcome
// ------------------------------------------------------------

async function getOutcome(req, res) {
  try {
    const { id } = req.params;

    const outcome = await getOutcomeQuery(id);
    if (!outcome) {
      return res.status(404).json({ error: 'No outcome logged for this evaluation' });
    }

    return res.status(200).json({ outcome });
  } catch (err) {
    console.error('[OUTCOME] Error:', err);
    return res.status(500).json({ error: err.message });
  }
}

// ------------------------------------------------------------
// GET /api/calls — Get All Calls with Outcomes
// ------------------------------------------------------------

async function getAllCalls(req, res) {
  try {
    const limit = parseInt(req.query.limit) || 100;
    const offset = parseInt(req.query.offset) || 0;

    const calls = await getAllCallsWithOutcomes({ limit, offset });

    return res.status(200).json({ calls });
  } catch (err) {
    console.error('[CALLS] Error:', err);
    return res.status(500).json({ error: err.message });
  }
}

module.exports = { logOutcome, updateOutcome, getOutcome, getAllCalls };
