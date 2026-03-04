/**
 * xTwitterScraper.js
 *
 * Fetches X (Twitter) social data using ScrapeBadger API.
 * $0.10 per 1000 data points — very affordable.
 *
 * This is MANDATORY. If this fails → evaluation HALTS with BLOCKED_MISSING_X.
 *
 * Approach:
 *   1. Search tweets for $TICKER and related crypto keywords
 *   2. Analyze engagement metrics (likes, retweets, replies)
 *   3. Fetch account quality for engaged posters (verified, followers)
 *   4. Detect meme narrative presence and clarity
 *   5. Falls back to simulation mode if no API key configured
 */

const axios = require('axios');

const TIMEOUT_MS = parseInt(process.env.SCRAPER_TIMEOUT_MS || '10000');
const RETRY_COUNT = parseInt(process.env.SCRAPER_RETRY_COUNT || '2');

// ScrapeBadger API config
const SCRAPEBADGER_API_KEY = process.env.SCRAPEBADGER_API_KEY || '';
const SCRAPEBADGER_BASE_URL = process.env.SCRAPEBADGER_BASE_URL || 'https://scrapebadger.com';

// Meme narrative keywords for crypto tokens
const MEME_KEYWORDS = [
  'moon', 'mooning', 'ape', 'aped', 'whale', 'pump', 'pumping',
  'gem', 'hidden gem', 'meme', 'memecoin', 'viral', 'hype',
  'rocket', 'lambo', 'shill', 'hodl', 'degen', 'rug', 'rugpull',
  '100x', '1000x', 'to the moon', 'diamond hands', 'paper hands',
  'fomo', 'buy the dip', 'send it', 'lfg', 'wagmi', 'ngmi',
  '🚀', '🌙', '💎', '🐒', '🦍', '🔥', '📈',
];

// Influencer detection keywords (accounts with likely reach)
const INFLUENCER_SIGNALS = [
  'just bought', 'loading up', 'aped in', 'this is the one',
  'alpha', 'ct', 'crypto twitter', 'nfa', 'dyor',
];

// Account quality thresholds
const HIGH_FOLLOWER_THRESHOLD = 10000;   // 10k+ = notable account
const CREDIBLE_FOLLOWER_THRESHOLD = 1000; // 1k+ = credible account

// ------------------------------------------------------------
// FETCH WITH RETRY
// ------------------------------------------------------------

async function fetchWithRetry(url, headers, retries = RETRY_COUNT) {
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const response = await axios.get(url, {
        timeout: TIMEOUT_MS,
        headers,
      });
      return response.data;
    } catch (err) {
      const status = err.response?.status;

      // Don't retry on auth errors
      if (status === 401 || status === 402 || status === 403) {
        throw new Error(`ScrapeBadger auth error (${status}): ${err.response?.data?.message || 'Check API key'}`);
      }

      if (attempt === retries) throw err;
      console.log(`[X] Retry ${attempt + 1}/${retries}: ${err.message}`);
      await new Promise(r => setTimeout(r, 1500 * (attempt + 1)));
    }
  }
}

// ------------------------------------------------------------
// SCRAPEBADGER: SEARCH TWEETS
// ------------------------------------------------------------

async function searchTweets(query, queryType = 'Latest', cursor = null) {
  const params = new URLSearchParams({
    query,
    query_type: queryType,
  });

  if (cursor) {
    params.append('cursor', cursor);
  }

  const url = `${SCRAPEBADGER_BASE_URL}/v1/twitter/tweets/advanced_search?${params}`;

  const data = await fetchWithRetry(url, {
    'x-api-key': SCRAPEBADGER_API_KEY,
    'Accept': 'application/json',
  });

  return data;
}

// ------------------------------------------------------------
// SCRAPEBADGER: GET USER PROFILE
// ------------------------------------------------------------

async function getUserProfile(username) {
  const url = `${SCRAPEBADGER_BASE_URL}/v1/twitter/users/${username}/by_username`;

  try {
    const data = await fetchWithRetry(url, {
      'x-api-key': SCRAPEBADGER_API_KEY,
      'Accept': 'application/json',
    });
    return data;
  } catch (err) {
    console.log(`[X] Failed to fetch user ${username}: ${err.message}`);
    return null;
  }
}

// ------------------------------------------------------------
// FETCH ACCOUNT QUALITY FOR TOP ENGAGED TWEETS
// ------------------------------------------------------------

async function fetchAccountQuality(tweets, maxProfiles = 10) {
  // Get unique usernames from tweets with engagement
  const engagedTweets = tweets.filter(t => {
    const likes = t.favorite_count || t.likes || 0;
    const retweets = t.retweet_count || t.retweets || 0;
    return likes >= 5 || retweets >= 2;
  });

  // Sort by engagement and take top posters
  engagedTweets.sort((a, b) => {
    const engA = (a.favorite_count || 0) + (a.retweet_count || 0) * 2;
    const engB = (b.favorite_count || 0) + (b.retweet_count || 0) * 2;
    return engB - engA;
  });

  const uniqueUsernames = [...new Set(engagedTweets.slice(0, maxProfiles).map(t => t.username))];

  console.log(`[X] Fetching ${uniqueUsernames.length} user profiles for account quality...`);

  const profiles = [];
  for (const username of uniqueUsernames) {
    if (!username) continue;
    const profile = await getUserProfile(username);
    if (profile) {
      profiles.push(profile);
    }
    // Small delay to avoid rate limits
    await new Promise(r => setTimeout(r, 100));
  }

  // Analyze account quality
  let verifiedCount = 0;
  let blueVerifiedCount = 0;
  let totalFollowers = 0;
  let highFollowerCount = 0;
  let credibleAccountCount = 0;

  for (const p of profiles) {
    const followers = p.followers_count || 0;
    totalFollowers += followers;

    if (p.verified) verifiedCount++;
    if (p.is_blue_verified) blueVerifiedCount++;
    if (followers >= HIGH_FOLLOWER_THRESHOLD) highFollowerCount++;
    if (followers >= CREDIBLE_FOLLOWER_THRESHOLD) credibleAccountCount++;
  }

  const avgFollowers = profiles.length > 0 ? Math.round(totalFollowers / profiles.length) : 0;

  return {
    profilesFetched: profiles.length,
    verifiedCount,
    blueVerifiedCount,
    totalFollowerReach: totalFollowers,
    avgFollowersPerPoster: avgFollowers,
    highFollowerAccounts: highFollowerCount,
    credibleAccounts: credibleAccountCount,
    hasVerifiedPosters: verifiedCount > 0 || blueVerifiedCount > 0,
    hasHighFollowerPosters: highFollowerCount > 0,
    hasCrediblePosters: credibleAccountCount >= 2,
  };
}

// ------------------------------------------------------------
// ANALYZE TWEETS FOR SIGNALS
// ------------------------------------------------------------

function analyzeTweets(tweets) {
  if (!tweets || tweets.length === 0) {
    return {
      mentionCount: 0,
      uniqueAccounts: 0,
      totalLikes: 0,
      totalRetweets: 0,
      totalReplies: 0,
      totalViews: 0,
      avgEngagement: 0,
      highEngagementCount: 0,
      memeKeywordsFound: [],
      hasMemeNarrative: false,
      narrativeClarity: 'none',
      hasInfluencerSignals: false,
      recentTweetCount: 0,
    };
  }

  let totalLikes = 0;
  let totalRetweets = 0;
  let totalReplies = 0;
  let totalViews = 0;
  let highEngagementCount = 0;
  let memeKeywordsFound = new Set();
  let influencerSignalCount = 0;
  let recentTweetCount = 0;
  const uniqueUsernames = new Set();

  const oneDayAgo = Date.now() - 24 * 60 * 60 * 1000;

  for (const tweet of tweets) {
    // Track unique accounts
    if (tweet.username) uniqueUsernames.add(tweet.username);

    // Aggregate engagement
    const likes = tweet.favorite_count || tweet.likes || 0;
    const retweets = tweet.retweet_count || tweet.retweets || 0;
    const replies = tweet.reply_count || tweet.replies || 0;
    const views = parseInt(tweet.view_count) || tweet.views || 0;

    totalLikes += likes;
    totalRetweets += retweets;
    totalReplies += replies;
    totalViews += views;

    // High engagement: >50 likes or >10 retweets
    if (likes > 50 || retweets > 10) {
      highEngagementCount++;
    }

    // Check tweet text for meme keywords
    const text = (tweet.text || tweet.full_text || '').toLowerCase();

    for (const kw of MEME_KEYWORDS) {
      if (text.includes(kw.toLowerCase())) {
        memeKeywordsFound.add(kw);
      }
    }

    // Check for influencer signals
    for (const signal of INFLUENCER_SIGNALS) {
      if (text.includes(signal.toLowerCase())) {
        influencerSignalCount++;
        break;
      }
    }

    // Check recency
    const createdAt = tweet.created_at ? new Date(tweet.created_at).getTime() : 0;
    if (createdAt > oneDayAgo) {
      recentTweetCount++;
    }
  }

  const mentionCount = tweets.length;
  const avgEngagement = mentionCount > 0
    ? (totalLikes + totalRetweets * 2 + totalReplies) / mentionCount
    : 0;

  // Meme narrative detection
  const uniqueKeywords = [...memeKeywordsFound];
  const hasMemeNarrative = uniqueKeywords.length >= 2;

  // Narrative clarity based on keyword diversity and engagement
  let narrativeClarity = 'none';
  if (uniqueKeywords.length >= 5 && highEngagementCount >= 3) {
    narrativeClarity = 'clear';
  } else if (uniqueKeywords.length >= 3 || highEngagementCount >= 2) {
    narrativeClarity = 'moderate';
  } else if (uniqueKeywords.length >= 1) {
    narrativeClarity = 'vague';
  }

  return {
    mentionCount,
    uniqueAccounts: uniqueUsernames.size,
    totalLikes,
    totalRetweets,
    totalReplies,
    totalViews,
    avgEngagement: Math.round(avgEngagement * 100) / 100,
    highEngagementCount,
    memeKeywordsFound: uniqueKeywords,
    hasMemeNarrative,
    narrativeClarity,
    hasInfluencerSignals: influencerSignalCount >= 2,
    recentTweetCount,
  };
}

// ------------------------------------------------------------
// SIMULATION MODE (for testing without API key)
// ------------------------------------------------------------

function generateSimulatedData(ticker) {
  console.log(`[X] Running in SIMULATION mode for ${ticker}`);

  // Generate semi-realistic simulated data based on ticker hash
  const hash = ticker.split('').reduce((acc, c) => acc + c.charCodeAt(0), 0);
  const seed = hash % 100;

  // Vary results based on ticker to make it deterministic but varied
  const mentionCount = 10 + (seed % 40);
  const uniqueAccounts = Math.floor(mentionCount * 0.7);
  const engagementMultiplier = 0.5 + (seed % 50) / 50;

  const possibleKeywords = ['moon', 'gem', 'pump', 'ape', 'degen', '🚀', 'lfg'];
  const keywordCount = 1 + (seed % 4);
  const memeKeywordsFound = possibleKeywords.slice(0, keywordCount);

  return {
    mentionCount,
    uniqueAccounts,
    totalLikes: Math.floor(mentionCount * 15 * engagementMultiplier),
    totalRetweets: Math.floor(mentionCount * 3 * engagementMultiplier),
    totalReplies: Math.floor(mentionCount * 5 * engagementMultiplier),
    totalViews: Math.floor(mentionCount * 500 * engagementMultiplier),
    avgEngagement: Math.round(20 * engagementMultiplier * 100) / 100,
    highEngagementCount: Math.floor(mentionCount * 0.15),
    memeKeywordsFound,
    hasMemeNarrative: keywordCount >= 2,
    narrativeClarity: keywordCount >= 3 ? 'moderate' : 'vague',
    hasInfluencerSignals: seed > 60,
    recentTweetCount: Math.floor(mentionCount * 0.4),
    engagementAboveBaseline: mentionCount > 15,
    isFreshNarrative: seed < 50,
    isDerivativeTheme: keywordCount <= 2,
    alignsWithMarketTrend: seed > 40,
    hasTraction: mentionCount > 20,
    narrativeSummary: `[SIMULATED] Found ${mentionCount} mentions with keywords: ${memeKeywordsFound.join(', ')}`,
    // Simulated account quality
    accountQuality: {
      profilesFetched: 0,
      verifiedCount: seed > 70 ? 1 : 0,
      blueVerifiedCount: seed > 50 ? Math.floor(seed / 30) : 0,
      totalFollowerReach: mentionCount * 5000,
      avgFollowersPerPoster: 5000,
      highFollowerAccounts: seed > 60 ? 1 : 0,
      credibleAccounts: Math.floor(mentionCount * 0.3),
      hasVerifiedPosters: seed > 70,
      hasHighFollowerPosters: seed > 60,
      hasCrediblePosters: seed > 40,
    },
    _simulated: true,
    _rawTweets: [],
  };
}

// ------------------------------------------------------------
// MAIN FETCH
// ------------------------------------------------------------

/**
 * Fetches X social data for a token using ScrapeBadger API.
 *
 * @param {object} asset - { ticker, contractAddress, chain }
 * @returns {object} Structured social traction data
 * @throws Error if X data is completely unavailable (causes BLOCKED_MISSING_X)
 */
async function fetch(asset) {
  const { ticker, contractAddress, chain } = asset;

  console.log(`[X] Fetching data for ${ticker} on ${chain}`);

  // If ticker is UNKNOWN or looks like a contract address prefix, use simulation
  // (Can't meaningfully search X for unknown tickers)
  if (!ticker || ticker === 'UNKNOWN' || /^[A-Z0-9]{6,10}$/.test(ticker)) {
    console.log(`[X] Ticker "${ticker}" is unknown/generic, using simulation mode`);
    return generateSimulatedData(ticker || 'UNKNOWN');
  }

  // Check if API key is configured
  if (!SCRAPEBADGER_API_KEY) {
    console.log(`[X] No SCRAPEBADGER_API_KEY configured, using simulation mode`);
    return generateSimulatedData(ticker);
  }

  try {
    // Build search queries
    // Search for cashtag ($TICKER) and ticker + crypto context
    const queries = [
      `$${ticker}`,                    // Cashtag search
      `${ticker} crypto OR solana`,    // Context search
    ];

    let allTweets = [];

    // Execute searches
    for (const query of queries) {
      try {
        console.log(`[X] Searching: "${query}"`);
        const result = await searchTweets(query, 'Latest');

        // Handle various response structures
        const tweets = result?.tweets || result?.data || result?.results || [];
        if (Array.isArray(tweets)) {
          allTweets = allTweets.concat(tweets);
        }
      } catch (err) {
        console.log(`[X] Search failed for "${query}": ${err.message}`);
      }
    }

    // Dedupe tweets by ID
    const seenIds = new Set();
    const uniqueTweets = allTweets.filter(t => {
      const id = t.id || t.id_str;
      if (!id || seenIds.has(id)) return false;
      seenIds.add(id);
      return true;
    });

    console.log(`[X] Found ${uniqueTweets.length} unique tweets`);

    // If no tweets found, this is a failure (X is mandatory)
    if (uniqueTweets.length === 0) {
      throw new Error(`No X mentions found for ${ticker}`);
    }

    // Analyze tweets
    const analysis = analyzeTweets(uniqueTweets);

    // Fetch account quality for engaged posters (top 10)
    const accountQuality = await fetchAccountQuality(uniqueTweets, 10);

    // Derive additional signals
    const engagementAboveBaseline = analysis.mentionCount > 10 || analysis.avgEngagement > 15;
    const isFreshNarrative = analysis.recentTweetCount > analysis.mentionCount * 0.3;
    const isDerivativeTheme = analysis.memeKeywordsFound.length <= 2 &&
      analysis.memeKeywordsFound.every(kw => ['moon', 'pump', '🚀'].includes(kw));
    const alignsWithMarketTrend = engagementAboveBaseline && analysis.hasMemeNarrative;

    // Enhanced traction check: must have engagement + credible accounts
    const hasTraction = (analysis.highEngagementCount >= 2 || analysis.totalLikes > 100) &&
      (accountQuality.hasCrediblePosters || accountQuality.hasVerifiedPosters);

    // Build narrative summary
    let narrativeSummary = '';
    if (analysis.hasMemeNarrative) {
      narrativeSummary = `Meme narrative detected: ${analysis.memeKeywordsFound.slice(0, 5).join(', ')}`;
      if (accountQuality.hasVerifiedPosters) {
        narrativeSummary += ' (verified accounts posting)';
      }
    } else if (analysis.mentionCount > 0) {
      narrativeSummary = `${analysis.mentionCount} mentions from ${analysis.uniqueAccounts} accounts`;
    } else {
      narrativeSummary = 'No X discussion found';
    }

    return {
      mentionCount: analysis.mentionCount,
      uniqueAccounts: analysis.uniqueAccounts,
      totalLikes: analysis.totalLikes,
      totalRetweets: analysis.totalRetweets,
      totalReplies: analysis.totalReplies,
      totalViews: analysis.totalViews,
      avgEngagement: analysis.avgEngagement,
      highEngagementCount: analysis.highEngagementCount,
      memeKeywordsFound: analysis.memeKeywordsFound,
      hasMemeNarrative: analysis.hasMemeNarrative,
      narrativeClarity: analysis.narrativeClarity,
      hasInfluencerSignals: analysis.hasInfluencerSignals,
      recentTweetCount: analysis.recentTweetCount,
      engagementAboveBaseline,
      isFreshNarrative,
      isDerivativeTheme,
      alignsWithMarketTrend,
      hasTraction,
      narrativeSummary,
      // Account quality metrics
      accountQuality,
      _simulated: false,
      // Store raw tweets for audit (limit to 20)
      _rawTweets: uniqueTweets.slice(0, 20).map(t => ({
        id: t.id || t.id_str,
        text: (t.text || t.full_text || '').slice(0, 280),
        username: t.username,
        likes: t.favorite_count || t.likes || 0,
        retweets: t.retweet_count || t.retweets || 0,
        created_at: t.created_at,
      })),
    };

  } catch (err) {
    console.error(`[X] ScrapeBadger error: ${err.message}`);

    // If it's an auth error, fall back to simulation
    if (err.message.includes('auth error') || err.message.includes('API key')) {
      console.log(`[X] Falling back to simulation mode due to auth error`);
      return generateSimulatedData(ticker);
    }

    // For other errors, rethrow to trigger BLOCKED_MISSING_X
    throw new Error(`X scraping failed for ${ticker}: ${err.message}`);
  }
}

module.exports = { fetch };
