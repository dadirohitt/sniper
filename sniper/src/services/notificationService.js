/**
 * notificationService.js
 *
 * Handles notifications for SNIPER alerts.
 * Currently supports: Telegram
 * Extensible for: Discord, Email, Push notifications
 */

const axios = require('axios');

// Telegram config from env
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || '';
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID || '';

// ------------------------------------------------------------
// TELEGRAM NOTIFICATIONS
// ------------------------------------------------------------

/**
 * Send a message via Telegram Bot API
 * @param {string} message - The message to send (supports HTML formatting)
 * @param {object} options - Additional options
 */
async function sendTelegram(message, options = {}) {
  if (!TELEGRAM_BOT_TOKEN || !TELEGRAM_CHAT_ID) {
    console.log('[NOTIFY] Telegram not configured, skipping notification');
    return false;
  }

  const url = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`;

  try {
    const response = await axios.post(url, {
      chat_id: TELEGRAM_CHAT_ID,
      text: message,
      parse_mode: 'HTML',
      disable_web_page_preview: options.disablePreview || false,
    }, {
      timeout: 10000,
    });

    if (response.data?.ok) {
      console.log('[NOTIFY] Telegram message sent successfully');
      return true;
    } else {
      console.error('[NOTIFY] Telegram API error:', response.data);
      return false;
    }
  } catch (err) {
    console.error('[NOTIFY] Failed to send Telegram message:', err.message);
    return false;
  }
}

// ------------------------------------------------------------
// NOTIFICATION FORMATTERS
// ------------------------------------------------------------

/**
 * Format an APPROVE notification
 */
function formatApproveNotification(data) {
  const {
    ticker,
    chain,
    contractAddress,
    finalScore,
    liquidity,
    volume24h,
    price,
    priceChange24h,
    categories,
    evaluationId,
  } = data;

  const dexLink = chain === 'solana'
    ? `https://dexscreener.com/solana/${contractAddress}`
    : `https://dexscreener.com/bsc/${contractAddress}`;

  const gmgnLink = chain === 'solana'
    ? `https://gmgn.ai/sol/token/${contractAddress}`
    : null;

  let message = `🎯 <b>SNIPER APPROVE</b>\n\n`;
  message += `<b>$${ticker}</b> on ${chain.toUpperCase()}\n`;
  message += `Score: <b>${finalScore}/5.00</b> ✅\n\n`;

  if (price) {
    message += `💰 Price: $${formatPrice(price)}\n`;
  }
  if (priceChange24h) {
    const emoji = priceChange24h >= 0 ? '📈' : '📉';
    message += `${emoji} 24h: ${priceChange24h >= 0 ? '+' : ''}${priceChange24h.toFixed(2)}%\n`;
  }
  if (liquidity) {
    message += `💧 Liquidity: $${formatNumber(liquidity)}\n`;
  }
  if (volume24h) {
    message += `📊 Volume 24h: $${formatNumber(volume24h)}\n`;
  }

  message += `\n`;

  // Category scores
  if (categories && categories.length > 0) {
    message += `<b>Scores:</b>\n`;
    for (const cat of categories) {
      const emoji = cat.score >= 4.2 ? '✅' : cat.score >= 3 ? '🟡' : '🔴';
      message += `${emoji} ${formatCategory(cat.category)}: ${cat.score}/5\n`;
    }
    message += `\n`;
  }

  // Contract address (copyable)
  message += `<code>${contractAddress}</code>\n\n`;

  // Links
  message += `🔗 <a href="${dexLink}">Dexscreener</a>`;
  if (gmgnLink) {
    message += ` | <a href="${gmgnLink}">GMGN</a>`;
  }

  return message;
}

/**
 * Format a new token alert (before full evaluation)
 */
function formatNewTokenAlert(data) {
  const {
    ticker,
    chain,
    contractAddress,
    liquidity,
    volume24h,
    ageMinutes,
    source,
  } = data;

  const dexLink = chain === 'solana'
    ? `https://dexscreener.com/solana/${contractAddress}`
    : `https://dexscreener.com/bsc/${contractAddress}`;

  let message = `👀 <b>NEW TOKEN DETECTED</b>\n\n`;
  message += `<b>$${ticker}</b> on ${chain.toUpperCase()}\n`;
  message += `Source: ${source || 'Scanner'}\n`;

  if (ageMinutes !== undefined) {
    message += `⏱ Age: ${ageMinutes} minutes\n`;
  }
  if (liquidity) {
    message += `💧 Liquidity: $${formatNumber(liquidity)}\n`;
  }
  if (volume24h) {
    message += `📊 Volume: $${formatNumber(volume24h)}\n`;
  }

  message += `\n<code>${contractAddress}</code>\n`;
  message += `\n🔗 <a href="${dexLink}">View on Dexscreener</a>`;
  message += `\n\n⏳ Running evaluation...`;

  return message;
}

/**
 * Format a REJECT notification (optional - for tracking)
 */
function formatRejectNotification(data) {
  const {
    ticker,
    chain,
    finalScore,
    rejectionReason,
    triggeredFilters,
  } = data;

  let message = `❌ <b>REJECT</b> - $${ticker} (${chain})\n`;
  message += `Score: ${finalScore}/5.00\n`;

  if (triggeredFilters && triggeredFilters.length > 0) {
    message += `\n⚠️ Hard filters:\n`;
    for (const filter of triggeredFilters) {
      message += `• ${formatFilter(filter)}\n`;
    }
  } else if (rejectionReason) {
    message += `\nReason: ${rejectionReason}\n`;
  }

  return message;
}

// ------------------------------------------------------------
// HELPER FORMATTERS
// ------------------------------------------------------------

function formatPrice(price) {
  if (price < 0.0001) return price.toExponential(4);
  if (price < 1) return price.toFixed(6);
  return price.toFixed(2);
}

function formatNumber(num) {
  if (num >= 1000000) return (num / 1000000).toFixed(2) + 'M';
  if (num >= 1000) return (num / 1000).toFixed(1) + 'K';
  return num.toFixed(0);
}

function formatCategory(cat) {
  return cat.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}

function formatFilter(filter) {
  return filter.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}

// ------------------------------------------------------------
// MAIN NOTIFY FUNCTION
// ------------------------------------------------------------

/**
 * Send a notification through all configured channels
 * @param {string} type - 'approve' | 'reject' | 'new_token' | 'custom'
 * @param {object} data - Notification data
 */
async function notify(type, data) {
  let message;

  switch (type) {
    case 'approve':
      message = formatApproveNotification(data);
      break;
    case 'reject':
      message = formatRejectNotification(data);
      break;
    case 'new_token':
      message = formatNewTokenAlert(data);
      break;
    case 'custom':
      message = data.message || 'No message provided';
      break;
    default:
      message = `[${type.toUpperCase()}] ${JSON.stringify(data)}`;
  }

  // Send to all configured channels
  const results = {
    telegram: false,
  };

  // Telegram
  if (TELEGRAM_BOT_TOKEN && TELEGRAM_CHAT_ID) {
    results.telegram = await sendTelegram(message);
  }

  return results;
}

// ------------------------------------------------------------
// TEST FUNCTION
// ------------------------------------------------------------

async function testTelegram() {
  if (!TELEGRAM_BOT_TOKEN || !TELEGRAM_CHAT_ID) {
    console.log('[NOTIFY] Telegram not configured. Set TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID in .env');
    return false;
  }

  const testMessage = `🧪 <b>SNIPER Test Notification</b>\n\nIf you see this, Telegram notifications are working! ✅`;
  return await sendTelegram(testMessage);
}

module.exports = {
  notify,
  sendTelegram,
  testTelegram,
  formatApproveNotification,
  formatRejectNotification,
  formatNewTokenAlert,
};
