/**
 * controllers/scannerController.js
 */

const { startScanner, stopScanner, runScanCycle, getScannerStatus } = require('../services/scannerService');
const { testTelegram } = require('../services/notificationService');
const { startBot, stopBot, getBotStatus } = require('../services/telegramBotService');

let isRunning = false;

// ------------------------------------------------------------
// POST /api/scanner/start
// ------------------------------------------------------------

async function startScannerEndpoint(req, res) {
  try {
    if (isRunning) {
      return res.status(400).json({ error: 'Scanner is already running' });
    }

    startScanner();
    isRunning = true;

    return res.status(200).json({ message: 'Scanner started', status: 'running' });
  } catch (err) {
    console.error('[SCANNER] Error:', err);
    return res.status(500).json({ error: err.message });
  }
}

// ------------------------------------------------------------
// POST /api/scanner/stop
// ------------------------------------------------------------

async function stopScannerEndpoint(req, res) {
  try {
    if (!isRunning) {
      return res.status(400).json({ error: 'Scanner is not running' });
    }

    stopScanner();
    isRunning = false;

    return res.status(200).json({ message: 'Scanner stopped', status: 'stopped' });
  } catch (err) {
    console.error('[SCANNER] Error:', err);
    return res.status(500).json({ error: err.message });
  }
}

// ------------------------------------------------------------
// POST /api/scanner/scan — Manual trigger
// ------------------------------------------------------------

async function triggerScan(req, res) {
  try {
    // Run a single scan cycle immediately (doesn't start the interval)
    runScanCycle();

    return res.status(200).json({ message: 'Manual scan triggered' });
  } catch (err) {
    console.error('[SCANNER] Error:', err);
    return res.status(500).json({ error: err.message });
  }
}

// ------------------------------------------------------------
// GET /api/scanner/status
// ------------------------------------------------------------

async function getStatus(req, res) {
  try {
    const fullStatus = getScannerStatus();
    return res.status(200).json({
      ...fullStatus,
      status: isRunning ? 'running' : fullStatus.status,
    });
  } catch (err) {
    console.error('[SCANNER] Error:', err);
    return res.status(500).json({ error: err.message });
  }
}

// ------------------------------------------------------------
// POST /api/scanner/test-telegram
// ------------------------------------------------------------

async function testTelegramEndpoint(req, res) {
  try {
    const success = await testTelegram();

    if (success) {
      return res.status(200).json({ message: 'Telegram test sent successfully!' });
    } else {
      return res.status(400).json({ error: 'Telegram not configured or failed to send' });
    }
  } catch (err) {
    console.error('[SCANNER] Telegram test error:', err);
    return res.status(500).json({ error: err.message });
  }
}

// ------------------------------------------------------------
// POST /api/scanner/bot/start
// ------------------------------------------------------------

async function startBotEndpoint(req, res) {
  try {
    const result = startBot();
    return res.status(200).json({ message: 'Telegram bot started', ...result });
  } catch (err) {
    console.error('[BOT] Error:', err);
    return res.status(500).json({ error: err.message });
  }
}

// ------------------------------------------------------------
// POST /api/scanner/bot/stop
// ------------------------------------------------------------

async function stopBotEndpoint(req, res) {
  try {
    const result = stopBot();
    return res.status(200).json({ message: 'Telegram bot stopped', ...result });
  } catch (err) {
    console.error('[BOT] Error:', err);
    return res.status(500).json({ error: err.message });
  }
}

// ------------------------------------------------------------
// GET /api/scanner/bot/status
// ------------------------------------------------------------

async function getBotStatusEndpoint(req, res) {
  try {
    const result = getBotStatus();
    return res.status(200).json(result);
  } catch (err) {
    console.error('[BOT] Error:', err);
    return res.status(500).json({ error: err.message });
  }
}

module.exports = {
  startScanner: startScannerEndpoint,
  stopScanner: stopScannerEndpoint,
  triggerScan,
  getStatus,
  testTelegram: testTelegramEndpoint,
  startBot: startBotEndpoint,
  stopBot: stopBotEndpoint,
  getBotStatus: getBotStatusEndpoint,
};
