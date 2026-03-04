const pool = require('../pool');

/**
 * Upsert an asset — inserts if new, returns existing if duplicate.
 * Handles both (ticker, chain) and (contract_address, chain) unique constraints.
 */
async function upsertAsset({ ticker, contractAddress, chain }) {
  console.log(`[ASSET] Upserting: ticker=${ticker}, ca=${contractAddress}, chain=${chain}`);

  // First, check if asset already exists by contract address
  const existing = await pool.query(
    `SELECT * FROM assets WHERE contract_address = $1 AND chain = $2`,
    [contractAddress, chain]
  );

  console.log(`[ASSET] Existing check returned ${existing.rows.length} rows`);

  if (existing.rows[0]) {
    // Asset exists - update ticker if we have a real one
    if (ticker && ticker !== 'UNKNOWN' && existing.rows[0].ticker === 'UNKNOWN') {
      const updated = await pool.query(
        `UPDATE assets SET ticker = $1 WHERE id = $2 RETURNING *`,
        [ticker, existing.rows[0].id]
      );
      return updated.rows[0];
    }
    return existing.rows[0];
  }

  // Asset doesn't exist - try to create new one
  // Use contract address prefix as ticker if ticker is UNKNOWN
  const safeTicker = (ticker === 'UNKNOWN' || !ticker)
    ? contractAddress.slice(0, 8).toUpperCase()
    : ticker;

  try {
    const { rows } = await pool.query(
      `INSERT INTO assets (ticker, contract_address, chain)
       VALUES ($1, $2, $3)
       RETURNING *`,
      [safeTicker, contractAddress, chain]
    );
    return rows[0];
  } catch (err) {
    // If insert fails due to duplicate, just fetch the existing one
    if (err.code === '23505') {
      const fallback = await pool.query(
        `SELECT * FROM assets WHERE contract_address = $1 AND chain = $2`,
        [contractAddress, chain]
      );
      if (fallback.rows[0]) return fallback.rows[0];
    }
    throw err;
  }
}

/**
 * Find an asset by ticker + chain.
 */
async function findAssetByTicker({ ticker, chain }) {
  const query = `SELECT * FROM assets WHERE ticker = $1 AND chain = $2;`;
  const { rows } = await pool.query(query, [ticker, chain]);
  return rows[0] || null;
}

module.exports = { upsertAsset, findAssetByTicker };
