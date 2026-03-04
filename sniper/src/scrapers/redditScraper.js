/**
 * redditScraper.js
 *
 * Scrapes Reddit for social signals around a token.
 * SUPPLEMENTARY — failure does NOT block evaluation.
 *
 * Strategy:
 * 1. Search ticker + chain (e.g., "BONK solana") for relevance
 * 2. Filter to crypto-related subreddits
 * 3. Check for actual ticker mentions in title/body
 * 4. Detect meme narrative keywords
 */

const axios = require('axios');

const TIMEOUT_MS  = parseInt(process.env.SCRAPER_TIMEOUT_MS || '10000');
const RETRY_COUNT = parseInt(process.env.SCRAPER_RETRY_COUNT || '2');

const REDDIT_SEARCH_URL = 'https://www.reddit.com/search.json';

// Crypto-related subreddits (posts from these are more relevant)
const CRYPTO_SUBREDDITS = new Set([
  'cryptocurrency', 'cryptomoonshots', 'satoshistreetbets', 'altcoin',
  'solana', 'memecoin', 'memecoins', 'defi', 'cryptomarkets',
  'solanatrading', 'solanamemes', 'pumpfun', 'binance', 'coinbase',
  'crypto_currency_news', 'wallstreetbetscrypto', 'cryptomoon',
  'shibainucoin', 'dogecoin', 'shitcoinmoonshots',
]);

// Meme narrative keywords
const MEME_KEYWORDS = [
  'moon', 'mooning', 'ape', 'aped', 'whale', 'pump', 'pumping',
  'gem', 'hidden gem', 'meme', 'memecoin', 'viral', 'hype',
  'rocket', 'lambo', 'shill', 'hodl', 'degen', 'rug', 'rugpull',
  '100x', '1000x', 'to the moon', 'diamond hands', 'paper hands',
  'fomo', 'buy the dip', 'send it', 'lfg', 'wagmi', 'ngmi',
];

// ------------------------------------------------------------
// FETCH WITH RETRY
// ------------------------------------------------------------

async function fetchWithRetry(url, params, retries = RETRY_COUNT) {
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const response = await axios.get(url, {
        params,
        timeout: TIMEOUT_MS,
        headers: {
          'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
          'Accept': 'application/json',
        },
      });
      return response.data;
    } catch (err) {
      if (attempt === retries) throw err;
      console.log(`[Reddit] Retry ${attempt + 1}/${retries}: ${err.message}`);
      await new Promise(r => setTimeout(r, 1500 * (attempt + 1)));
    }
  }
}

// ------------------------------------------------------------
// SEARCH REDDIT
// ------------------------------------------------------------

async function searchReddit(query, timeFilter = 'week', limit = 50) {
  try {
    const data = await fetchWithRetry(REDDIT_SEARCH_URL, {
      q: query,
      sort: 'relevance',
      limit,
      t: timeFilter,
      type: 'link', // posts only, not comments
    });

    return data?.data?.children || [];
  } catch (err) {
    console.log(`[Reddit] Search failed for "${query}": ${err.message}`);
    return [];
  }
}

// ------------------------------------------------------------
// CHECK IF POST IS RELEVANT
// ------------------------------------------------------------

function isRelevantPost(post, ticker, contractAddress) {
  const title = (post.data?.title || '').toLowerCase();
  const selftext = (post.data?.selftext || '').toLowerCase();
  const subreddit = (post.data?.subreddit || '').toLowerCase();
  const combined = `${title} ${selftext}`;

  const tickerLower = ticker.toLowerCase();

  // Must mention the ticker
  const mentionsTicker = combined.includes(tickerLower);

  // Bonus: mentions contract address (very specific)
  const mentionsContract = contractAddress &&
    combined.includes(contractAddress.toLowerCase().slice(0, 10));

  // Is from a crypto subreddit?
  const isCryptoSubreddit = CRYPTO_SUBREDDITS.has(subreddit);

  // Relevance score
  let relevance = 0;
  if (mentionsTicker) relevance += 2;
  if (mentionsContract) relevance += 3;
  if (isCryptoSubreddit) relevance += 2;

  // Filter out generic posts that just happen to contain the ticker
  // (e.g., "BONK" could appear in unrelated contexts)
  const hasOtherCryptoContext =
    combined.includes('crypto') ||
    combined.includes('token') ||
    combined.includes('coin') ||
    combined.includes('solana') ||
    combined.includes('trading') ||
    combined.includes('buy') ||
    combined.includes('sell') ||
    combined.includes('price') ||
    combined.includes('chart') ||
    combined.includes('dex') ||
    isCryptoSubreddit;

  return {
    isRelevant: mentionsTicker && (isCryptoSubreddit || hasOtherCryptoContext || mentionsContract),
    relevance,
    mentionsTicker,
    mentionsContract,
    isCryptoSubreddit,
  };
}

// ------------------------------------------------------------
// DETECT MEME NARRATIVE
// ------------------------------------------------------------

function hasMemeKeywords(text) {
  const lower = text.toLowerCase();
  return MEME_KEYWORDS.filter(kw => lower.includes(kw));
}

// ------------------------------------------------------------
// MAIN FETCH
// ------------------------------------------------------------

/**
 * Scrapes Reddit for social discussion around a token.
 *
 * @param {object} asset - { ticker, contractAddress, chain }
 * @returns {object} Structured Reddit social data
 */
async function fetch(asset) {
  const { ticker, contractAddress, chain } = asset;

  console.log(`[Reddit] Searching for ${ticker} on ${chain}`);

  // Build search queries (more specific = better)
  const chainName = chain === 'solana' ? 'solana' : chain === 'bnb' ? 'BSC' : chain;

  // Try multiple search strategies
  const queries = [
    `${ticker} ${chainName}`,           // "BONK solana"
    `$${ticker} crypto`,                // "$BONK crypto"
    ticker,                              // Just the ticker
  ];

  let allPosts = [];

  // Search with primary query (ticker + chain)
  const primaryResults = await searchReddit(queries[0], 'week', 50);
  allPosts = allPosts.concat(primaryResults);

  // If few results, try secondary query
  if (allPosts.length < 5) {
    const secondaryResults = await searchReddit(queries[1], 'week', 30);
    allPosts = allPosts.concat(secondaryResults);
  }

  // Dedupe by post ID
  const seenIds = new Set();
  const uniquePosts = allPosts.filter(post => {
    const id = post.data?.id;
    if (seenIds.has(id)) return false;
    seenIds.add(id);
    return true;
  });

  console.log(`[Reddit] Found ${uniquePosts.length} unique posts`);

  // ------------------------------------------------------------
  // FILTER TO RELEVANT POSTS
  // ------------------------------------------------------------
  const relevantPosts = [];

  for (const post of uniquePosts) {
    const check = isRelevantPost(post, ticker, contractAddress);
    if (check.isRelevant) {
      relevantPosts.push({
        title: post.data?.title || '',
        selftext: post.data?.selftext || '',
        score: post.data?.score || 0,
        comments: post.data?.num_comments || 0,
        subreddit: post.data?.subreddit || '',
        created: post.data?.created_utc || 0,
        url: post.data?.url || '',
        relevance: check.relevance,
        isCryptoSubreddit: check.isCryptoSubreddit,
      });
    }
  }

  // Sort by relevance, then by engagement
  relevantPosts.sort((a, b) => {
    if (b.relevance !== a.relevance) return b.relevance - a.relevance;
    return (b.score + b.comments) - (a.score + a.comments);
  });

  console.log(`[Reddit] ${relevantPosts.length} relevant posts after filtering`);

  // ------------------------------------------------------------
  // DERIVE SOCIAL SIGNALS
  // ------------------------------------------------------------
  const postCount = relevantPosts.length;

  // Discussion present: at least 2 relevant posts
  const discussionPresent = postCount >= 2;

  // Has traction: posts with meaningful engagement
  const postsWithEngagement = relevantPosts.filter(p => p.comments >= 3 || p.score >= 10);
  const hasTraction = postsWithEngagement.length >= 1;

  // Meme narrative detection
  let memeKeywordsFound = [];
  for (const post of relevantPosts) {
    const keywords = hasMemeKeywords(`${post.title} ${post.selftext}`);
    memeKeywordsFound = memeKeywordsFound.concat(keywords);
  }
  const uniqueMemeKeywords = [...new Set(memeKeywordsFound)];
  const hasMemeNarrative = uniqueMemeKeywords.length >= 2;

  // Crypto subreddit presence
  const cryptoSubredditPosts = relevantPosts.filter(p => p.isCryptoSubreddit);
  const hasCryptoSubredditPresence = cryptoSubredditPosts.length >= 1;

  // Total engagement
  const totalScore = relevantPosts.reduce((sum, p) => sum + p.score, 0);
  const totalComments = relevantPosts.reduce((sum, p) => sum + p.comments, 0);

  // Recent activity (posts from last 24h)
  const oneDayAgo = Date.now() / 1000 - 86400;
  const recentPosts = relevantPosts.filter(p => p.created > oneDayAgo);
  const hasRecentActivity = recentPosts.length >= 1;

  // Build narrative summary
  let narrativeSummary = '';
  if (hasMemeNarrative) {
    narrativeSummary = `Meme keywords found: ${uniqueMemeKeywords.slice(0, 5).join(', ')}`;
  } else if (hasTraction) {
    narrativeSummary = `Discussion present but no strong meme narrative`;
  } else if (postCount > 0) {
    narrativeSummary = `Limited discussion (${postCount} posts)`;
  } else {
    narrativeSummary = `No Reddit discussion found`;
  }

  console.log(`[Reddit] Result: ${postCount} posts, traction=${hasTraction}, meme=${hasMemeNarrative}`);

  return {
    postCount,
    discussionPresent,
    hasTraction,
    hasMemeNarrative,
    hasCryptoSubredditPresence,
    hasRecentActivity,
    totalScore,
    totalComments,
    narrativeSummary,
    memeKeywordsFound: uniqueMemeKeywords,
    // Raw posts for audit (top 5)
    _rawPosts: relevantPosts.slice(0, 5).map(p => ({
      title: p.title.slice(0, 100),
      score: p.score,
      comments: p.comments,
      subreddit: p.subreddit,
    })),
  };
}

module.exports = { fetch };
