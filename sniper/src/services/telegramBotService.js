/**
 * telegramBotService.js
 *
 * Interactive Telegram bot that accepts contract addresses
 * and returns SNIPER evaluation results.
 *
 * Commands:
 *   /start - Welcome message
 *   /help - Show commands
 *   <contract_address> - Run evaluation and return result
 */

const axios = require('axios');
const { runEvaluation } = require('./evaluationService');

const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || '';
const TELEGRAM_API = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}`;

let pollingInterval = null;
let lastUpdateId = 0;

// ------------------------------------------------------------
// SEND MESSAGE
// ------------------------------------------------------------

async function sendMessage(chatId, text, options = {}) {
  try {
    await axios.post(`${TELEGRAM_API}/sendMessage`, {
      chat_id: chatId,
      text,
      parse_mode: 'HTML',
      disable_web_page_preview: options.disablePreview || false,
    });
    return true;
  } catch (err) {
    console.error('[TG BOT] Failed to send message:', err.message);
    return false;
  }
}

// ------------------------------------------------------------
// HANDLE INCOMING MESSAGE
// ------------------------------------------------------------

async function handleMessage(message) {
  const chatId = message.chat.id;
  const text = (message.text || '').trim();

  if (!text) return;

  // /start command
  if (text === '/start') {
    await sendMessage(chatId, `
🎯 <b>SNIPER Bot</b>

Send me a Solana contract address and I'll evaluate it instantly.

<b>Commands:</b>
/start - This message
/help - Show help

<b>Examples:</b>
<code>EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v</code>

Or with ticker for better X search:
<code>BONK EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v</code>
    `.trim());
    return;
  }

  // /help command
  if (text === '/help') {
    await sendMessage(chatId, `
<b>How to use SNIPER Bot:</b>

1. Get a contract address from a call (Mark, etc.)
2. Paste it here
3. Get instant evaluation

<b>What you'll get:</b>
• Final Score (0-5)
• Verdict (APPROVE/REJECT)
• Category breakdowns
• Hard filter alerts
• Direct links to Dexscreener

<b>Scoring:</b>
✅ APPROVE = Score ≥ 4.20
❌ REJECT = Score < 4.20 or hard filter triggered
    `.trim());
    return;
  }

  // Check if it looks like a Solana address (32-44 chars, base58)
  const solanaAddressRegex = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

  // Format 1: Just contract address
  if (solanaAddressRegex.test(text)) {
    await evaluateAndRespond(chatId, text, 'UNKNOWN');
    return;
  }

  // Format 2: "TICKER CA" or "$TICKER CA" (ticker + contract address)
  const parts = text.split(/\s+/);
  if (parts.length === 2) {
    const ticker = parts[0].replace(/^\$/, '').toUpperCase();
    const ca = parts[1];
    if (solanaAddressRegex.test(ca) && ticker.length >= 2 && ticker.length <= 20) {
      await evaluateAndRespond(chatId, ca, ticker);
      return;
    }
  }

  // Unknown command
  await sendMessage(chatId, `
❓ I don't recognize that.

Send me a Solana contract address to evaluate, or type /help for instructions.
  `.trim());
}

// ------------------------------------------------------------
// EVALUATE AND RESPOND
// ------------------------------------------------------------

async function evaluateAndRespond(chatId, contractAddress, ticker = 'UNKNOWN') {
  // Send "processing" message
  const tickerDisplay = ticker !== 'UNKNOWN' ? `$${ticker}` : contractAddress.slice(0, 10) + '...';
  await sendMessage(chatId, `⏳ Evaluating <code>${tickerDisplay}</code>\n\nThis may take 10-30 seconds...`);

  try {
    const result = await runEvaluation({
      ticker,
      contractAddress,
      chain: 'solana',
      triggeredBy: 'manual',  // DB enum only allows 'manual' or 'scanner'
      calledAt: new Date().toISOString(),
    });

    // Format response based on result
    let response;

    if (result.blocked) {
      response = `
⚠️ <b>BLOCKED</b>

Contract: <code>${contractAddress}</code>
Reason: ${result.blockReason}

Could not complete evaluation. This usually means X/Twitter data was unavailable.
      `.trim();
    } else if (result.verdict === 'APPROVE') {
      response = formatApproveResponse(contractAddress, result);
    } else {
      response = formatRejectResponse(contractAddress, result);
    }

    await sendMessage(chatId, response);

  } catch (err) {
    console.error('[TG BOT] Evaluation error:', err.message);
    await sendMessage(chatId, `
❌ <b>Error</b>

Failed to evaluate: ${err.message}

Make sure the contract address is valid.
    `.trim());
  }
}

// ------------------------------------------------------------
// RESPONSE FORMATTERS
// ------------------------------------------------------------

function formatApproveResponse(contractAddress, result) {
  const { finalScore, categories, tags } = result;
  const ticker = result.evaluation?.ticker || 'TOKEN';

  let msg = `✅ <b>APPROVE</b>\n\n`;
  msg += `<b>$${ticker}</b>\n`;
  msg += `Score: <b>${finalScore}/5.00</b>\n\n`;

  // Category scores
  if (categories && categories.length > 0) {
    msg += `<b>Breakdown:</b>\n`;
    for (const cat of categories) {
      const emoji = cat.score >= 4.2 ? '✅' : cat.score >= 3 ? '🟡' : '🔴';
      msg += `${emoji} ${formatCategory(cat.category)}: ${cat.score}/5\n`;
    }
    msg += `\n`;
  }

  // Tags
  if (tags && tags.length > 0) {
    msg += `<b>Tags:</b> ${tags.join(', ')}\n\n`;
  }

  msg += `<code>${contractAddress}</code>\n\n`;
  msg += `🔗 <a href="https://dexscreener.com/solana/${contractAddress}">Dexscreener</a>`;
  msg += ` | <a href="https://gmgn.ai/sol/token/${contractAddress}">GMGN</a>`;

  return msg;
}

function formatRejectResponse(contractAddress, result) {
  const { finalScore, categories, hardFilters, rejectionReason } = result;
  const ticker = result.evaluation?.ticker || 'TOKEN';

  let msg = `❌ <b>REJECT</b>\n\n`;
  msg += `<b>$${ticker}</b>\n`;
  msg += `Score: <b>${finalScore}/5.00</b>\n\n`;

  // Hard filters triggered
  const triggered = hardFilters?.filter(f => f.triggered) || [];
  if (triggered.length > 0) {
    msg += `<b>⚠️ Hard Filters Triggered:</b>\n`;
    for (const f of triggered) {
      msg += `• ${formatFilter(f.filterName)}\n`;
    }
    msg += `\n`;
  } else if (rejectionReason) {
    msg += `<b>Reason:</b> ${rejectionReason}\n\n`;
  }

  // Category scores
  if (categories && categories.length > 0) {
    msg += `<b>Breakdown:</b>\n`;
    for (const cat of categories) {
      const emoji = cat.score >= 4.2 ? '✅' : cat.score >= 3 ? '🟡' : '🔴';
      msg += `${emoji} ${formatCategory(cat.category)}: ${cat.score}/5\n`;
    }
    msg += `\n`;
  }

  msg += `<code>${contractAddress}</code>\n\n`;
  msg += `🔗 <a href="https://dexscreener.com/solana/${contractAddress}">Dexscreener</a>`;

  return msg;
}

function formatCategory(cat) {
  return cat.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}

function formatFilter(filter) {
  return filter.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}

// ------------------------------------------------------------
// POLLING FOR UPDATES
// ------------------------------------------------------------

async function pollUpdates() {
  try {
    const response = await axios.get(`${TELEGRAM_API}/getUpdates`, {
      params: {
        offset: lastUpdateId + 1,
        timeout: 30,
        allowed_updates: ['message'],
      },
      timeout: 35000,
    });

    const updates = response.data?.result || [];

    for (const update of updates) {
      lastUpdateId = update.update_id;

      if (update.message) {
        await handleMessage(update.message);
      }
    }
  } catch (err) {
    if (err.code !== 'ECONNABORTED') {
      console.error('[TG BOT] Polling error:', err.message);
    }
  }
}

// ------------------------------------------------------------
// START / STOP BOT
// ------------------------------------------------------------

function startBot() {
  if (!TELEGRAM_BOT_TOKEN) {
    console.log('[TG BOT] No token configured, bot disabled');
    return { status: 'disabled' };
  }

  if (pollingInterval) {
    console.log('[TG BOT] Already running');
    return { status: 'already_running' };
  }

  console.log('[TG BOT] Starting interactive bot...');

  // Start polling loop
  const poll = async () => {
    while (pollingInterval) {
      await pollUpdates();
    }
  };

  pollingInterval = true;
  poll();

  return { status: 'started' };
}

function stopBot() {
  if (pollingInterval) {
    pollingInterval = null;
    console.log('[TG BOT] Stopped');
    return { status: 'stopped' };
  }
  return { status: 'not_running' };
}

function getBotStatus() {
  return {
    status: pollingInterval ? 'running' : 'stopped',
    configured: !!TELEGRAM_BOT_TOKEN,
  };
}

module.exports = {
  startBot,
  stopBot,
  getBotStatus,
  sendMessage,
};
