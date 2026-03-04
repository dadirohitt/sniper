/**
 * server.js — Sniper Backend Entry Point
 */

require('dotenv').config();

const express = require('express');
const cors    = require('cors');

const { requestLogger, errorHandler } = require('./middleware/errorHandler');
const evaluationRoutes                = require('./routes/evaluationRoutes');
const scannerRoutes                   = require('./routes/scannerRoutes');
const { startBot }                    = require('./services/telegramBotService');
const { getAllCalls }                 = require('./controllers/outcomeController');

const app = express();
const PORT = process.env.PORT || 3000;

// ------------------------------------------------------------
// MIDDLEWARE
// ------------------------------------------------------------

app.use(cors());                          // Allow frontend to call this API
app.use(express.json());                  // Parse JSON bodies
app.use(requestLogger);                   // Log all requests

// ------------------------------------------------------------
// ROUTES
// ------------------------------------------------------------

app.use('/api/evaluations', evaluationRoutes);
app.use('/api/scanner', scannerRoutes);

// Calls endpoint (all evaluations with outcomes for tracking)
app.get('/api/calls', getAllCalls);

// Health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// ------------------------------------------------------------
// ERROR HANDLING
// ------------------------------------------------------------

app.use(errorHandler);

// ------------------------------------------------------------
// START SERVER
// ------------------------------------------------------------

app.listen(PORT, () => {
  console.log(`[SNIPER] Backend running on http://localhost:${PORT}`);
  console.log(`[SNIPER] Health check: http://localhost:${PORT}/api/health`);

  // Auto-start Telegram bot for interactive queries
  if (process.env.TELEGRAM_BOT_TOKEN) {
    startBot();
    console.log(`[SNIPER] Telegram bot started - send contract addresses to get evaluations`);
  }
});

module.exports = app;
