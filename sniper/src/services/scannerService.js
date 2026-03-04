/**
 * scannerService.js
 *
 * Autonomous scanner that monitors DEX sources for new or trending coins.
 * When a candidate is detected, it triggers a full evaluation via evaluationService.
 *
 * Data Sources:
 *   1. Dexscreener Boosted Tokens (paid promotions - active marketing)
 *   2. Dexscreener Token Profiles (newly listed tokens)
 *   3. DexPaprika for validation (liquidity, volume checks)
 *
 * Flow:
 *   1. Fetch candidates from multiple sources
 *   2. Filter by chain, liquidity, volume
 *   3. Skip already-evaluated coins (24h window)
 *   4. Run SNIPER evaluation on each candidate
 *   5. Send Telegram notification for APPROVE verdicts
 */

const axios = require('axios');
const { runEvaluation } = require('./evaluationService');
const { getAllEvaluations } = require('../db/queries/evaluationQueries');
const { notify } = require('./notificationService');

// API endpoints
const DEXSCREENER_BOOSTS = 'https://api.dexscreener.com/token-boosts/latest/v1';
const DEXSCREENER_PROFILES = 'https://api.dexscreener.com/token-profiles/latest/v1';
const DEXPAPRIKA_BASE = 'https://api.dexpaprika.com';

// Scanner settings
const SCAN_INTERVAL_MS = parseInt(process.env.SCAN_INTERVAL_MS || '300000'); // 5 minutes
const SUPPORTED_CHAINS = ['solana']; // Focus on Solana for memecoins
const MIN_LIQUIDITY_USD = parseFloat(process.env.MIN_LIQUIDITY_USD || '10000');
const MIN_VOLUME_24H_USD = parseFloat(process.env.MIN_VOLUME_24H_USD || '50000');
const MAX_CANDIDATES_PER_CYCLE = parseInt(process.env.MAX_CANDIDATES_PER_CYCLE || '10');
const MAX_AGE_HOURS = parseFloat(process.env.MAX_AGE_HOURS || '8'); // Only fresh coins

// Recently evaluated cache (to avoid duplicate evaluations within a cycle)
const recentlyEvaluated = new Set();

// ------------------------------------------------------------
// FETCH FROM DEXSCREENER BOOSTED TOKENS
// ------------------------------------------------------------

async function fetchBoostedTokens() {
  try {
    const response = await axios.get(DEXSCREENER_BOOSTS, {
      timeout: 10000,
      headers: { 'User-Agent': 'Sniper/1.0' },
    });

    const tokens = response.data || [];

    // Filter to supported chains and map to candidate format
    const candidates = tokens
      .filter(t => SUPPORTED_CHAINS.includes(t.chainId))
      .map(t => ({
        ticker: t.tokenAddress?.slice(-6)?.toUpperCase() || 'UNKNOWN',
        contractAddress: t.tokenAddress,
        chain: t.chainId,
        source: 'dexscreener_boost',
        boostAmount: t.totalAmount || 0,
        description: t.description || '',
        hasTwitter: t.links?.some(l => l.type === 'twitter') || false,
        hasTelegram: t.links?.some(l => l.type === 'telegram') || false,
      }));

    console.log(`[SCANNER] Found ${candidates.length} boosted tokens on supported chains`);
    return candidates;
  } catch (err) {
    console.error('[SCANNER] Error fetching boosted tokens:', err.message);
    return [];
  }
}

// ------------------------------------------------------------
// FETCH FROM DEXSCREENER TOKEN PROFILES (New listings)
// ------------------------------------------------------------

async function fetchTokenProfiles() {
  try {
    const response = await axios.get(DEXSCREENER_PROFILES, {
      timeout: 10000,
      headers: { 'User-Agent': 'Sniper/1.0' },
    });

    const tokens = response.data || [];

    // Filter to supported chains
    const candidates = tokens
      .filter(t => SUPPORTED_CHAINS.includes(t.chainId))
      .map(t => ({
        ticker: t.tokenAddress?.slice(-6)?.toUpperCase() || 'UNKNOWN',
        contractAddress: t.tokenAddress,
        chain: t.chainId,
        source: 'dexscreener_profile',
        description: t.description || '',
        hasTwitter: t.links?.some(l => l.type === 'twitter') || false,
        hasTelegram: t.links?.some(l => l.type === 'telegram') || false,
      }));

    console.log(`[SCANNER] Found ${candidates.length} token profiles on supported chains`);
    return candidates;
  } catch (err) {
    console.error('[SCANNER] Error fetching token profiles:', err.message);
    return [];
  }
}

// ------------------------------------------------------------
// FETCH TOKEN DATA FROM DEXPAPRIKA (for validation)
// ------------------------------------------------------------

async function fetchTokenData(contractAddress, chain) {
  const network = chain === 'solana' ? 'solana' : 'bsc';
  const url = `${DEXPAPRIKA_BASE}/networks/${network}/tokens/${contractAddress}`;

  try {
    const response = await axios.get(url, {
      timeout: 10000,
      headers: { 'User-Agent': 'Sniper/1.0' },
    });

    const data = response.data;
    const summary = data?.summary;

    // Calculate pair age from creation time
    let pairAgeHours = null;
    if (data?.createdAt || data?.created_at) {
      const createdAt = new Date(data.createdAt || data.created_at);
      pairAgeHours = (Date.now() - createdAt.getTime()) / (1000 * 60 * 60);
    }

    return {
      symbol: data?.symbol || null,
      name: data?.name || null,
      priceUsd: summary?.price_usd || 0,
      liquidity: summary?.liquidity_usd || 0,
      volume24h: summary?.['24h']?.volume_usd || 0,
      txns24h: summary?.['24h']?.txns || 0,
      priceChange24h: summary?.['24h']?.last_price_usd_change || 0,
      pairAgeHours,
    };
  } catch (err) {
    // Token might not be indexed yet
    return null;
  }
}

// Fetch pair age from Dexscreener as backup
async function fetchPairAge(contractAddress, chain) {
  try {
    const url = `https://api.dexscreener.com/latest/dex/tokens/${contractAddress}`;
    const response = await axios.get(url, { timeout: 10000 });
    const pair = response.data?.pairs?.[0];
    if (pair?.pairCreatedAt) {
      return (Date.now() - pair.pairCreatedAt) / (1000 * 60 * 60);
    }
    return null;
  } catch {
    return null;
  }
}

// ------------------------------------------------------------
// CHECK IF ALREADY EVALUATED RECENTLY
// ------------------------------------------------------------

async function alreadyEvaluated(contractAddress, chain) {
  // Check in-memory cache first
  const cacheKey = `${chain}:${contractAddress.toLowerCase()}`;
  if (recentlyEvaluated.has(cacheKey)) {
    return true;
  }

  // Check database for recent evaluations
  try {
    const recentEvals = await getAllEvaluations({ limit: 200, offset: 0 });
    const recentEval = recentEvals.find(e =>
      e.contract_address?.toLowerCase() === contractAddress.toLowerCase() &&
      e.chain === chain &&
      new Date(e.created_at) > new Date(Date.now() - 24 * 60 * 60 * 1000)
    );

    if (recentEval) {
      recentlyEvaluated.add(cacheKey);
      return true;
    }
  } catch (err) {
    console.error('[SCANNER] Error checking recent evaluations:', err.message);
  }

  return false;
}

// ------------------------------------------------------------
// VALIDATE CANDIDATE (meets minimum requirements)
// ------------------------------------------------------------

async function validateCandidate(candidate) {
  // Fetch real market data
  const tokenData = await fetchTokenData(candidate.contractAddress, candidate.chain);

  if (!tokenData) {
    console.log(`[SCANNER] ${candidate.contractAddress.slice(0, 10)}... — No market data available`);
    return null;
  }

  const symbol = tokenData.symbol || candidate.contractAddress.slice(0, 10);

  // Check pair age - skip coins older than MAX_AGE_HOURS
  let pairAgeHours = tokenData.pairAgeHours;
  if (pairAgeHours === null) {
    // Fallback to Dexscreener for age
    pairAgeHours = await fetchPairAge(candidate.contractAddress, candidate.chain);
  }

  if (pairAgeHours !== null && pairAgeHours > MAX_AGE_HOURS) {
    console.log(`[SCANNER] ${symbol} — Too old (${pairAgeHours.toFixed(1)}h > ${MAX_AGE_HOURS}h max)`);
    return null;
  }

  // Check minimum requirements
  if (tokenData.liquidity < MIN_LIQUIDITY_USD) {
    console.log(`[SCANNER] ${symbol} — Liquidity too low ($${tokenData.liquidity.toFixed(0)})`);
    return null;
  }

  if (tokenData.volume24h < MIN_VOLUME_24H_USD) {
    console.log(`[SCANNER] ${symbol} — Volume too low ($${tokenData.volume24h.toFixed(0)})`);
    return null;
  }

  return {
    ...candidate,
    ticker: tokenData.symbol || candidate.ticker,
    pairAgeHours,
    ...tokenData,
  };
}

// ------------------------------------------------------------
// SCAN CYCLE
// ------------------------------------------------------------

async function runScanCycle() {
  console.log('[SCANNER] 🔍 Starting scan cycle...');

  // Collect candidates from all sources
  const [boosted, profiles] = await Promise.all([
    fetchBoostedTokens(),
    fetchTokenProfiles(),
  ]);

  // Combine and dedupe by contract address
  const seenAddresses = new Set();
  const allCandidates = [...boosted, ...profiles].filter(c => {
    const key = `${c.chain}:${c.contractAddress.toLowerCase()}`;
    if (seenAddresses.has(key)) return false;
    seenAddresses.add(key);
    return true;
  });

  console.log(`[SCANNER] Total unique candidates: ${allCandidates.length}`);

  let evaluated = 0;
  let approved = 0;
  let rejected = 0;

  for (const candidate of allCandidates) {
    if (evaluated >= MAX_CANDIDATES_PER_CYCLE) {
      console.log(`[SCANNER] Reached max candidates per cycle (${MAX_CANDIDATES_PER_CYCLE})`);
      break;
    }

    try {
      // Skip if already evaluated recently
      const isEvaluated = await alreadyEvaluated(candidate.contractAddress, candidate.chain);
      if (isEvaluated) {
        continue;
      }

      // Validate candidate meets minimum requirements
      const validatedCandidate = await validateCandidate(candidate);
      if (!validatedCandidate) {
        continue;
      }

      console.log(`[SCANNER] 🎯 Evaluating: ${validatedCandidate.ticker} (${validatedCandidate.source})`);
      console.log(`[SCANNER]    Liquidity: $${validatedCandidate.liquidity.toLocaleString()} | Volume: $${validatedCandidate.volume24h.toLocaleString()}`);

      // Mark as evaluated in cache
      recentlyEvaluated.add(`${candidate.chain}:${candidate.contractAddress.toLowerCase()}`);
      evaluated++;

      // Run full evaluation
      const result = await runEvaluation({
        ticker: validatedCandidate.ticker,
        contractAddress: validatedCandidate.contractAddress,
        chain: validatedCandidate.chain,
        triggeredBy: 'scanner',
        calledAt: new Date().toISOString(),
      });

      // --- APPROVE → Send Telegram notification ---
      if (result.verdict === 'APPROVE') {
        approved++;
        console.log(`[SCANNER] ✅ APPROVE — ${validatedCandidate.ticker} | Score: ${result.finalScore}`);

        await notify('approve', {
          ticker: validatedCandidate.ticker,
          chain: validatedCandidate.chain,
          contractAddress: validatedCandidate.contractAddress,
          finalScore: result.finalScore,
          liquidity: validatedCandidate.liquidity,
          volume24h: validatedCandidate.volume24h,
          price: validatedCandidate.priceUsd,
          priceChange24h: validatedCandidate.priceChange24h,
          categories: result.categories,
          evaluationId: result.evaluation?.id,
        });
      }

      // --- BLOCKED → Log ---
      else if (result.blocked) {
        console.log(`[SCANNER] ⚠️ BLOCKED — ${validatedCandidate.ticker} — ${result.blockReason}`);
      }

      // --- REJECT → Log silently ---
      else if (result.verdict === 'REJECT') {
        rejected++;
        console.log(`[SCANNER] ❌ REJECT — ${validatedCandidate.ticker} | Score: ${result.finalScore}`);
      }

      // Small delay between evaluations to avoid rate limits
      await new Promise(r => setTimeout(r, 2000));

    } catch (err) {
      console.error(`[SCANNER] Error evaluating ${candidate.contractAddress}:`, err.message);
    }
  }

  console.log(`[SCANNER] ✅ Scan cycle complete. Evaluated: ${evaluated} | Approved: ${approved} | Rejected: ${rejected}`);
}

// ------------------------------------------------------------
// START / STOP SCANNER
// ------------------------------------------------------------

let scanInterval = null;

function startScanner() {
  if (scanInterval) {
    console.log('[SCANNER] Already running');
    return { status: 'already_running' };
  }

  console.log(`[SCANNER] Starting autonomous scanner (interval: ${SCAN_INTERVAL_MS / 1000}s)`);

  // Run immediately on start
  runScanCycle().catch(err => console.error('[SCANNER] Cycle error:', err.message));

  // Then repeat on interval
  scanInterval = setInterval(() => {
    runScanCycle().catch(err => console.error('[SCANNER] Cycle error:', err.message));
  }, SCAN_INTERVAL_MS);

  return { status: 'started' };
}

function stopScanner() {
  if (scanInterval) {
    clearInterval(scanInterval);
    scanInterval = null;
    console.log('[SCANNER] Stopped');
    return { status: 'stopped' };
  }
  return { status: 'not_running' };
}

function getScannerStatus() {
  return {
    status: scanInterval ? 'running' : 'stopped',
    interval: SCAN_INTERVAL_MS,
    minLiquidity: MIN_LIQUIDITY_USD,
    minVolume: MIN_VOLUME_24H_USD,
    maxAgeHours: MAX_AGE_HOURS,
    maxCandidates: MAX_CANDIDATES_PER_CYCLE,
    supportedChains: SUPPORTED_CHAINS,
  };
}

module.exports = {
  startScanner,
  stopScanner,
  runScanCycle,
  getScannerStatus,
};
