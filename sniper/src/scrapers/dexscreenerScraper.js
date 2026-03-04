/**
 * dexscreenerScraper.js
 *
 * Fetches DEX data using DexPaprika for OHLCV candles + Dexscreener for additional market data.
 *
 * DexPaprika API (free, no auth required, 10k requests/day):
 * - Get pools: /networks/{network}/tokens/{address}/pools
 * - Get OHLCV: /networks/{network}/pools/{pool_id}/ohlcv?start={ts}&interval={1h|24h}&limit={n}
 */

const axios = require('axios');

const TIMEOUT_MS  = parseInt(process.env.SCRAPER_TIMEOUT_MS || '10000');
const RETRY_COUNT = parseInt(process.env.SCRAPER_RETRY_COUNT || '2');

const DEXPAPRIKA_BASE = 'https://api.dexpaprika.com';
const DEXSCREENER_BASE = 'https://api.dexscreener.com';

// ------------------------------------------------------------
// FETCH WITH RETRY
// ------------------------------------------------------------

async function fetchWithRetry(url, retries = RETRY_COUNT) {
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const response = await axios.get(url, {
        timeout: TIMEOUT_MS,
        headers: {
          'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
          'Accept': 'application/json',
        },
      });
      return response.data;
    } catch (err) {
      if (attempt === retries) throw err;
      console.log(`[DEX] Retry ${attempt + 1}/${retries} for ${url}`);
      await new Promise(r => setTimeout(r, 1000 * (attempt + 1)));
    }
  }
}

// ------------------------------------------------------------
// DEXPAPRIKA: GET TOP POOL FOR TOKEN
// ------------------------------------------------------------

async function getPaprikaPool(contractAddress, chain) {
  const network = chain === 'solana' ? 'solana' : 'bsc';
  const url = `${DEXPAPRIKA_BASE}/networks/${network}/tokens/${contractAddress}/pools`;

  try {
    const data = await fetchWithRetry(url);
    const pools = data?.pools || [];

    if (pools.length === 0) {
      console.log(`[PAPRIKA] No pools found for ${contractAddress}`);
      return null;
    }

    // Pools are typically sorted by volume, but let's ensure we get the most liquid one
    // Sort by 24h volume descending
    pools.sort((a, b) => (b.volume_usd || 0) - (a.volume_usd || 0));

    const topPool = pools[0];
    console.log(`[PAPRIKA] Found top pool: ${topPool.id} on ${topPool.dex_name} with $${topPool.volume_usd?.toFixed(0)} 24h volume`);

    return {
      poolId: topPool.id,
      network,
      dexName: topPool.dex_name,
      priceUsd: topPool.price_usd,
      volumeUsd: topPool.volume_usd,
      createdAt: topPool.created_at,
      priceChange24h: topPool.last_price_change_usd_24h,
      priceChange6h: topPool.last_price_change_usd_6h,
      priceChange1h: topPool.last_price_change_usd_1h,
    };
  } catch (err) {
    console.log(`[PAPRIKA] Failed to get pools: ${err.message}`);
    return null;
  }
}

// ------------------------------------------------------------
// DEXPAPRIKA: GET TOKEN SUMMARY (excellent for quick stats)
// ------------------------------------------------------------

async function getPaprikaToken(contractAddress, chain) {
  const network = chain === 'solana' ? 'solana' : 'bsc';
  const url = `${DEXPAPRIKA_BASE}/networks/${network}/tokens/${contractAddress}`;

  try {
    const data = await fetchWithRetry(url);
    const summary = data?.summary;

    if (!summary) {
      console.log(`[PAPRIKA] No token summary for ${contractAddress}`);
      return null;
    }

    return {
      priceUsd: summary.price_usd,
      liquidityUsd: summary.liquidity_usd,
      fdv: summary.fdv,
      poolCount: summary.pools,
      volume24h: summary['24h']?.volume_usd || 0,
      volume6h: summary['6h']?.volume_usd || 0,
      volume1h: summary['1h']?.volume_usd || 0,
      txns24h: summary['24h']?.txns || 0,
      txns6h: summary['6h']?.txns || 0,
      buys24h: summary['24h']?.buys || 0,
      sells24h: summary['24h']?.sells || 0,
      priceChange24h: summary['24h']?.last_price_usd_change || 0,
      priceChange6h: summary['6h']?.last_price_usd_change || 0,
      priceChange1h: summary['1h']?.last_price_usd_change || 0,
    };
  } catch (err) {
    console.log(`[PAPRIKA] Failed to get token: ${err.message}`);
    return null;
  }
}

// ------------------------------------------------------------
// DEXPAPRIKA: GET OHLCV CANDLES
// ------------------------------------------------------------

async function getPaprikaOHLCV(poolId, network, intervalHours = 1, limitCandles = 100) {
  // Calculate start time (go back enough to get the requested candles)
  const hoursBack = intervalHours * limitCandles;
  const startTs = Math.floor((Date.now() - hoursBack * 60 * 60 * 1000) / 1000);

  const interval = intervalHours === 24 ? '24h' : '1h';
  const url = `${DEXPAPRIKA_BASE}/networks/${network}/pools/${poolId}/ohlcv?start=${startTs}&interval=${interval}&limit=${limitCandles}`;

  try {
    const data = await fetchWithRetry(url);

    if (!Array.isArray(data) || data.length === 0) {
      console.log(`[PAPRIKA] No OHLCV data for pool ${poolId}`);
      return [];
    }

    // Convert to standardized format
    const candles = data.map(c => ({
      timestamp: new Date(c.time_open).getTime(),
      open: parseFloat(c.open),
      high: parseFloat(c.high),
      low: parseFloat(c.low),
      close: parseFloat(c.close),
      volume: parseFloat(c.volume),
    }));

    console.log(`[PAPRIKA] Got ${candles.length} candles (${interval}) for pool ${poolId}`);
    return candles;
  } catch (err) {
    console.log(`[PAPRIKA] Failed to get OHLCV: ${err.message}`);
    return [];
  }
}

// ------------------------------------------------------------
// DEXSCREENER: FALLBACK FOR ADDITIONAL DATA
// ------------------------------------------------------------

async function getDexscreenerData(contractAddress, ticker, chain) {
  let pairs = [];

  try {
    const url = `${DEXSCREENER_BASE}/latest/dex/tokens/${contractAddress}`;
    const data = await fetchWithRetry(url);
    pairs = data?.pairs || [];
  } catch (err) {
    console.log(`[DEXSCREENER] Tokens endpoint failed: ${err.message}`);
  }

  // Filter by chain and sort by liquidity
  pairs = pairs.filter(p => p.chainId === chain);
  pairs.sort((a, b) => parseFloat(b.liquidity?.usd || 0) - parseFloat(a.liquidity?.usd || 0));

  return pairs[0] || null;
}

// ------------------------------------------------------------
// ANALYZE CANDLES - DERIVE CHART SIGNALS
// ------------------------------------------------------------

function analyzeCandles(candles) {
  if (!candles || candles.length < 2) {
    return {
      hasCandles: false,
      ath: 0,
      atl: 0,
      currentPrice: 0,
      priceFromATH: 0,
      largeRedCandlesPostBreakout: 0,
      cleanBreakout: false,
      volumeExpanded: false,
      isSideways: false,
      hasReclaimed: false,
      suddenSpikeDetected: false,
      supportHeld: true,
      failedBreakout: false,
      choppyStructure: false,
      healthyConsolidation: false,
      pumpPercent: 0,
      reclaimedBreakout: false,
      priceChange24h: 0,
      priceChange6h: 0,
    };
  }

  // Sort by timestamp ascending (oldest first)
  const sorted = [...candles].sort((a, b) => a.timestamp - b.timestamp);

  // Basic price stats
  const currentPrice = sorted[sorted.length - 1].close;
  const ath = Math.max(...sorted.map(c => c.high));
  const atl = Math.min(...sorted.map(c => c.low));
  const priceFromATH = ath > 0 ? ((ath - currentPrice) / ath) * 100 : 0;

  // Recent candles (last 24 candles for hourly = last 24 hours)
  const recent = sorted.slice(-24);
  const recent6 = sorted.slice(-6);

  // Volume analysis
  const avgVolume = sorted.reduce((sum, c) => sum + c.volume, 0) / sorted.length;
  const recentAvgVolume = recent.reduce((sum, c) => sum + c.volume, 0) / recent.length;
  const volumeExpanded = recentAvgVolume > avgVolume * 1.2;

  // Recent volume (last 6 candles) vs older volume
  const recent6Volume = recent6.reduce((sum, c) => sum + c.volume, 0) / recent6.length;
  const volumeExpanding = recent6Volume > recentAvgVolume;

  // Price change calculations
  const price24hAgo = recent[0]?.close || currentPrice;
  const price6hAgo = recent6[0]?.close || currentPrice;
  const priceChange24h = price24hAgo > 0 ? ((currentPrice - price24hAgo) / price24hAgo) * 100 : 0;
  const priceChange6h = price6hAgo > 0 ? ((currentPrice - price6hAgo) / price6hAgo) * 100 : 0;

  // Count large red candles (>5% drop) in recent period
  const largeRedCandles = recent.filter(c => {
    const change = c.open > 0 ? ((c.close - c.open) / c.open) * 100 : 0;
    return change < -5;
  }).length;

  // Detect if there was a breakout followed by red candles
  const maxRecent = Math.max(...recent.map(c => c.high));
  const hadBreakout = maxRecent > price24hAgo * 1.15; // 15% breakout
  const largeRedCandlesPostBreakout = hadBreakout ? Math.min(largeRedCandles, 3) : 0;

  // Clean breakout: positive movement with volume confirmation
  const cleanBreakout = priceChange6h > 15 && volumeExpanding;

  // Sideways: less than 5% range in recent period
  const recentHigh = Math.max(...recent.map(c => c.high));
  const recentLow = Math.min(...recent.map(c => c.low));
  const recentRange = recentLow > 0 ? ((recentHigh - recentLow) / recentLow) * 100 : 0;
  const isSideways = recentRange < 5;

  // Reclaimed: was down but recovered
  const earlyCandles = recent.slice(0, 12);
  const minEarlyClose = earlyCandles.length > 0 ? Math.min(...earlyCandles.map(c => c.close)) : currentPrice;
  const wasDown = minEarlyClose < price24hAgo * 0.9;
  const hasReclaimed = wasDown && currentPrice > price24hAgo * 0.95;

  // Sudden spike detection (>30% wick in recent candles)
  const suddenSpikeDetected = recent.some(c => {
    const change = c.open > 0 ? ((c.high - c.open) / c.open) * 100 : 0;
    return change > 30;
  });

  // Support level detection
  const supportCandles = recent.slice(-12);
  const supportLevel = supportCandles.length > 0 ? Math.min(...supportCandles.map(c => c.low)) : currentPrice;
  const supportHeld = currentPrice > supportLevel * 0.95;

  // Failed breakout: was up significantly but now retraced
  const failedBreakout = hadBreakout && priceChange6h < -10;

  // Choppy structure: multiple direction changes
  let directionChanges = 0;
  for (let i = 1; i < recent.length; i++) {
    const prevDir = recent[i - 1].close > recent[i - 1].open;
    const currDir = recent[i].close > recent[i].open;
    if (prevDir !== currDir) directionChanges++;
  }
  const choppyStructure = directionChanges > recent.length * 0.6;

  // Healthy consolidation before breakout
  const priorCandles = sorted.slice(-48, -24);
  let priorRange = 0;
  if (priorCandles.length > 0) {
    const priorHigh = Math.max(...priorCandles.map(c => c.high));
    const priorLow = Math.min(...priorCandles.map(c => c.low));
    priorRange = priorLow > 0 ? ((priorHigh - priorLow) / priorLow) * 100 : 0;
  }
  const healthyConsolidation = priorRange < 10 && cleanBreakout;

  return {
    hasCandles: true,
    ath,
    atl,
    currentPrice,
    priceFromATH,
    priceChange24h,
    priceChange6h,
    largeRedCandlesPostBreakout,
    cleanBreakout,
    volumeExpanded,
    volumeExpanding,
    isSideways,
    hasReclaimed,
    suddenSpikeDetected,
    supportHeld,
    failedBreakout,
    choppyStructure,
    healthyConsolidation,
    pumpPercent: Math.max(priceChange24h, 0),
    reclaimedBreakout: hasReclaimed && cleanBreakout,
  };
}

// ------------------------------------------------------------
// MAIN FETCH
// ------------------------------------------------------------

/**
 * Fetches and parses DEX data for an asset.
 * Uses DexPaprika for OHLCV candles + token stats.
 * Falls back to Dexscreener for additional data if needed.
 *
 * @param {object} asset - { ticker, contractAddress, chain }
 * @returns {object} Structured DEX data with candle analysis
 */
async function fetch(asset) {
  const { ticker, contractAddress, chain } = asset;

  console.log(`[DEX] Fetching data for ${ticker} (${contractAddress}) on ${chain}`);

  // 1. Get token summary from DexPaprika (fast, gives us most data we need)
  const tokenData = await getPaprikaToken(contractAddress, chain);

  // 2. Get top pool and OHLCV candles from DexPaprika
  let candles = [];
  let candleAnalysis = analyzeCandles([]);
  let poolData = null;

  poolData = await getPaprikaPool(contractAddress, chain);
  if (poolData) {
    // Get hourly candles (100 candles = ~4 days of data)
    const hourlyCandles = await getPaprikaOHLCV(poolData.poolId, poolData.network, 1, 100);

    if (hourlyCandles.length > 0) {
      candles = hourlyCandles;
      candleAnalysis = analyzeCandles(hourlyCandles);
      console.log(`[PAPRIKA] Candle analysis: ATH=$${candleAnalysis.ath.toFixed(8)}, Current=$${candleAnalysis.currentPrice.toFixed(8)}, ${candleAnalysis.priceFromATH.toFixed(1)}% from ATH`);
    }
  }

  // 3. Fallback to Dexscreener if DexPaprika failed
  let dexPair = null;
  if (!tokenData && !candleAnalysis.hasCandles) {
    console.log(`[DEX] DexPaprika failed, trying Dexscreener fallback`);
    dexPair = await getDexscreenerData(contractAddress, ticker, chain);
  }

  // 4. Determine data source and merge results
  const hasTokenData = !!tokenData;
  const hasCandles = candleAnalysis.hasCandles;
  const hasDexscreener = !!dexPair;

  if (!hasTokenData && !hasCandles && !hasDexscreener) {
    throw new Error(`No data found for ${ticker} on ${chain}`);
  }

  // Prioritize data sources: candles > token summary > dexscreener
  const currentPrice = hasCandles
    ? candleAnalysis.currentPrice
    : tokenData?.priceUsd || parseFloat(dexPair?.priceUsd) || 0;

  const ath = hasCandles
    ? candleAnalysis.ath
    : currentPrice; // Conservative: if no candles, assume current = ATH

  const liquidity = tokenData?.liquidityUsd || parseFloat(dexPair?.liquidity?.usd) || 0;
  const volume24h = tokenData?.volume24h || parseFloat(dexPair?.volume?.h24) || 0;
  const volume6h = tokenData?.volume6h || parseFloat(dexPair?.volume?.h6) || 0;
  const txCount24h = tokenData?.txns24h || (dexPair ? (dexPair.txns?.h24?.buys || 0) + (dexPair.txns?.h24?.sells || 0) : 0);
  const mcap = tokenData?.fdv || parseFloat(dexPair?.fdv) || 0;

  // Price changes - prefer candle analysis, then token data, then dexscreener
  const priceChange24h = hasCandles
    ? candleAnalysis.priceChange24h
    : tokenData?.priceChange24h || parseFloat(dexPair?.priceChange?.h24) || 0;

  const priceChange6h = hasCandles
    ? candleAnalysis.priceChange6h
    : tokenData?.priceChange6h || parseFloat(dexPair?.priceChange?.h6) || 0;

  // Pair age calculation
  const pairCreatedAt = poolData?.createdAt ? new Date(poolData.createdAt).getTime() : dexPair?.pairCreatedAt;
  const pairAgeMs = pairCreatedAt ? Date.now() - pairCreatedAt : null;
  const pairAgeHours = pairAgeMs ? pairAgeMs / (1000 * 60 * 60) : null;

  // Volume analysis
  const volume6hPace = volume6h / 6;
  const volume24hPace = volume24h / 24;
  const volumeExpanded = hasCandles
    ? candleAnalysis.volumeExpanded
    : volume6hPace > volume24hPace;

  // Determine data source string
  let dataSource = 'unknown';
  if (hasCandles && hasTokenData) dataSource = 'dexpaprika';
  else if (hasCandles) dataSource = 'dexpaprika-candles';
  else if (hasTokenData) dataSource = 'dexpaprika-token';
  else if (hasDexscreener) dataSource = 'dexscreener';

  return {
    // Data source info
    dataSource,
    hasCandles,
    candleCount: candles.length,

    // Raw market data
    currentPrice,
    ath,
    mcap,
    pairAgeHours,
    volume24h,
    volume6h,
    liquidity,
    txCount24h,
    priceChange24h,
    priceChange6h,

    // Derived signals from candle analysis
    volumeExpanded,
    volumeConfirmation: volumeExpanded,
    suddenSpikeDetected: candleAnalysis.suddenSpikeDetected,
    cleanBreakout: candleAnalysis.cleanBreakout,
    supportHeld: candleAnalysis.supportHeld,
    failedBreakout: candleAnalysis.failedBreakout,
    isSideways: candleAnalysis.isSideways,
    choppyStructure: candleAnalysis.choppyStructure,
    healthyConsolidation: candleAnalysis.healthyConsolidation,
    pumpPercent: candleAnalysis.pumpPercent,
    hasReclaimed: candleAnalysis.hasReclaimed,
    reclaimedBreakout: candleAnalysis.reclaimedBreakout,
    largeRedCandlesPostBreakout: candleAnalysis.largeRedCandlesPostBreakout,

    // Timing
    callWithinEarlyWindow: pairAgeHours != null && pairAgeHours < 6,
    isRepost: false, // determined by meta layer
  };
}

module.exports = { fetch };
