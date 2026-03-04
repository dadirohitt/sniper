/**
 * routes/evaluationRoutes.js
 * 
 * API routes for Sniper evaluations.
 */

const express = require('express');
const router  = express.Router();
const evaluationController = require('../controllers/evaluationController');
const outcomeController    = require('../controllers/outcomeController');

// --- Manual Evaluation ---
// POST /api/evaluations
// Body: { ticker, contractAddress, chain, calledAt }
router.post('/', evaluationController.createEvaluation);

// --- Get single evaluation with full breakdown ---
// GET /api/evaluations/:id
router.get('/:id', evaluationController.getEvaluation);

// --- Get all evaluations (history table) ---
// GET /api/evaluations?limit=50&offset=0
router.get('/', evaluationController.listEvaluations);

// --- Log outcome for an evaluation ---
// POST /api/evaluations/:id/outcome
// Body: { loggedBy, outcomeNotes, peakPriceAfter, result }
router.post('/:id/outcome', outcomeController.logOutcome);

// --- Update outcome (set WIN/LOSS) ---
// PATCH /api/evaluations/:id/outcome
// Body: { result, outcomeNotes, peakPriceAfter }
router.patch('/:id/outcome', outcomeController.updateOutcome);

// --- Get outcome for an evaluation ---
// GET /api/evaluations/:id/outcome
router.get('/:id/outcome', outcomeController.getOutcome);

module.exports = router;
