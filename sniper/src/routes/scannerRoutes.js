/**
 * routes/scannerRoutes.js
 * 
 * API routes for controlling the scanner.
 */

const express = require('express');
const router  = express.Router();
const scannerController = require('../controllers/scannerController');

// --- Start scanner ---
// POST /api/scanner/start
router.post('/start', scannerController.startScanner);

// --- Stop scanner ---
// POST /api/scanner/stop
router.post('/stop', scannerController.stopScanner);

// --- Trigger manual scan cycle ---
// POST /api/scanner/scan
router.post('/scan', scannerController.triggerScan);

// --- Get scanner status ---
// GET /api/scanner/status
router.get('/status', scannerController.getStatus);

// --- Test Telegram notification ---
// POST /api/scanner/test-telegram
router.post('/test-telegram', scannerController.testTelegram);

// --- Telegram Bot Controls ---
// POST /api/scanner/bot/start
router.post('/bot/start', scannerController.startBot);

// POST /api/scanner/bot/stop
router.post('/bot/stop', scannerController.stopBot);

// GET /api/scanner/bot/status
router.get('/bot/status', scannerController.getBotStatus);

module.exports = router;
