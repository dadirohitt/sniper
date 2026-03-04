import { useState, useEffect } from 'react';
import axios from 'axios';

const API_BASE = import.meta.env.VITE_API_BASE || 'http://localhost:3000/api';

export default function App() {
  const [view, setView] = useState('submit'); // 'submit' | 'calls' | 'detail' | 'scanner'
  const [selectedEval, setSelectedEval] = useState(null);
  const [scannerStatus, setScannerStatus] = useState('stopped');
  const [lastResult, setLastResult] = useState(null);
  const [calls, setCalls] = useState([]);
  const [detailSource, setDetailSource] = useState('calls'); // track where detail was opened from

  // Form state
  const [formData, setFormData] = useState({
    ticker: '',
    contractAddress: '',
    chain: 'solana',
    calledAt: new Date().toISOString(),
  });

  // Loading + error
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  // ------------------------------------------------------------
  // FETCH CALLS (evaluations with outcomes)
  // ------------------------------------------------------------
  async function fetchCalls() {
    try {
      const res = await axios.get(`${API_BASE}/calls?limit=100`);
      setCalls(res.data.calls);
    } catch (err) {
      console.error('Failed to fetch calls:', err);
    }
  }

  // ------------------------------------------------------------
  // UPDATE CALL OUTCOME (did coin 2x or not?)
  // ------------------------------------------------------------
  async function updateCallOutcome(evaluationId, didDouble, e) {
    e.stopPropagation(); // Don't trigger row click

    // Determine WIN/LOSS based on verdict + outcome
    const call = calls.find(c => c.evaluation_id === evaluationId);
    if (!call) return;

    // WIN = filter was correct
    // REJECT + didn't 2x = WIN (correctly avoided)
    // APPROVE + did 2x = WIN (correctly picked)
    // REJECT + did 2x = LOSS (missed opportunity)
    // APPROVE + didn't 2x = LOSS (bad call)
    const verdict = call.verdict;
    let result;
    if (verdict === 'APPROVE') {
      result = didDouble ? 'win' : 'loss';
    } else {
      // REJECT or BLOCKED
      result = didDouble ? 'loss' : 'win';
    }

    try {
      try {
        await axios.get(`${API_BASE}/evaluations/${evaluationId}/outcome`);
        await axios.patch(`${API_BASE}/evaluations/${evaluationId}/outcome`, { result });
      } catch (err) {
        if (err.response?.status === 404) {
          await axios.post(`${API_BASE}/evaluations/${evaluationId}/outcome`, {
            loggedBy: 'dashboard',
            result,
          });
        } else {
          throw err;
        }
      }
      fetchCalls();
    } catch (err) {
      setError('Failed to update outcome');
      console.error('Failed to update outcome:', err);
    }
  }

  // Reset outcome to pending
  async function resetOutcome(evaluationId, e) {
    e.stopPropagation();
    try {
      await axios.patch(`${API_BASE}/evaluations/${evaluationId}/outcome`, { result: 'pending' });
      fetchCalls();
    } catch (err) {
      setError('Failed to reset outcome');
    }
  }

  // ------------------------------------------------------------
  // FETCH EVALUATION DETAIL
  // ------------------------------------------------------------
  async function fetchEvaluationDetail(id, source = 'calls') {
    try {
      setLoading(true);
      const res = await axios.get(`${API_BASE}/evaluations/${id}`);
      setSelectedEval(res.data);
      setDetailSource(source);
      setView('detail');
    } catch (err) {
      setError('Failed to load evaluation detail');
    } finally {
      setLoading(false);
    }
  }

  // ------------------------------------------------------------
  // SUBMIT EVALUATION
  // ------------------------------------------------------------
  async function handleSubmit(e) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    setLastResult(null);

    try {
      const res = await axios.post(`${API_BASE}/evaluations`, formData);
      setLastResult(res.data);
      fetchCalls();
      setFormData({
        ticker: '',
        contractAddress: '',
        chain: 'solana',
        calledAt: new Date().toISOString(),
      });
    } catch (err) {
      setError(err.response?.data?.error || 'Evaluation failed');
    } finally {
      setLoading(false);
    }
  }

  // ------------------------------------------------------------
  // SCANNER CONTROLS
  // ------------------------------------------------------------
  async function fetchScannerStatus() {
    try {
      const res = await axios.get(`${API_BASE}/scanner/status`);
      setScannerStatus(res.data.status);
    } catch (err) {
      console.error('Failed to fetch scanner status:', err);
    }
  }

  async function startScanner() {
    try {
      await axios.post(`${API_BASE}/scanner/start`);
      setScannerStatus('running');
    } catch (err) {
      setError('Failed to start scanner');
    }
  }

  async function stopScanner() {
    try {
      await axios.post(`${API_BASE}/scanner/stop`);
      setScannerStatus('stopped');
    } catch (err) {
      setError('Failed to stop scanner');
    }
  }

  async function triggerManualScan() {
    try {
      setLoading(true);
      await axios.post(`${API_BASE}/scanner/scan`);
      fetchCalls();
    } catch (err) {
      setError('Manual scan failed');
    } finally {
      setLoading(false);
    }
  }

  // ------------------------------------------------------------
  // LIFECYCLE
  // ------------------------------------------------------------
  useEffect(() => {
    fetchCalls();
    fetchScannerStatus();
  }, []);

  // ------------------------------------------------------------
  // STATS CALCULATION
  // ------------------------------------------------------------
  const stats = {
    total: calls.length,
    wins: calls.filter(c => c.outcome_result === 'win').length,
    losses: calls.filter(c => c.outcome_result === 'loss').length,
    pending: calls.filter(c => !c.outcome_result || c.outcome_result === 'pending').length,
    approves: calls.filter(c => c.verdict === 'APPROVE').length,
    rejects: calls.filter(c => c.verdict === 'REJECT' || !c.verdict).length,
  };
  const decided = stats.wins + stats.losses;
  stats.accuracy = decided > 0 ? ((stats.wins / decided) * 100).toFixed(1) : '—';

  // ------------------------------------------------------------
  // SHARED STYLES
  // ------------------------------------------------------------
  const styles = {
    card: {
      background: '#161b22',
      border: '1px solid #30363d',
      borderRadius: 12,
      padding: 32,
    },
    label: {
      display: 'block',
      marginBottom: 8,
      fontSize: 12,
      color: '#8b949e',
      textTransform: 'uppercase',
      letterSpacing: 1.5,
    },
    input: {
      width: '100%',
      background: '#0d1117',
      border: '1px solid #30363d',
      borderRadius: 6,
      padding: '12px 16px',
      fontSize: 14,
      color: '#c9d1d9',
      fontFamily: 'inherit',
      boxSizing: 'border-box',
    },
    sectionTitle: {
      margin: '0 0 16px 0',
      fontSize: 14,
      color: '#8b949e',
      textTransform: 'uppercase',
      letterSpacing: 1.5,
      fontWeight: 600,
    },
  };

  // ------------------------------------------------------------
  // REUSABLE: Score breakdown panel
  // ------------------------------------------------------------
  function ScoreBreakdown({ categories, hardFilters, verdict, finalScore, tags, rejectionReason, blocked, blockReason, marketData }) {
    const verdictColor = verdict === 'APPROVE' ? '#2ea043' : '#f85149';
    const formatUsd = (n) => n ? `$${n.toLocaleString(undefined, { maximumFractionDigits: 0 })}` : '—';
    const formatPct = (n) => n != null ? `${parseFloat(n).toFixed(2)}%` : '—';

    return (
      <div>
        {marketData && (
          <div style={{ marginBottom: 24 }}>
            <div style={styles.sectionTitle}>Market Data</div>
            <div style={{
              background: '#0d1117',
              border: '1px solid #30363d',
              borderRadius: 8,
              padding: 16,
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))',
              gap: 16,
            }}>
              <div>
                <div style={{ fontSize: 10, color: '#8b949e', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 4 }}>Market Cap</div>
                <div style={{ fontSize: 16, fontWeight: 600, color: '#fff' }}>{formatUsd(marketData.mcap)}</div>
              </div>
              <div>
                <div style={{ fontSize: 10, color: '#8b949e', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 4 }}>Liquidity</div>
                <div style={{ fontSize: 16, fontWeight: 600, color: '#fff' }}>{formatUsd(marketData.liquidity)}</div>
              </div>
              <div>
                <div style={{ fontSize: 10, color: '#8b949e', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 4 }}>Volume 24h</div>
                <div style={{ fontSize: 16, fontWeight: 600, color: '#fff' }}>{formatUsd(marketData.volume24h)}</div>
              </div>
              <div>
                <div style={{ fontSize: 10, color: '#8b949e', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 4 }}>24h Change</div>
                <div style={{ fontSize: 16, fontWeight: 600, color: marketData.priceChange24h >= 0 ? '#2ea043' : '#f85149' }}>
                  {formatPct(marketData.priceChange24h)}
                </div>
              </div>
              <div>
                <div style={{ fontSize: 10, color: '#8b949e', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 4 }}>Txns 24h</div>
                <div style={{ fontSize: 16, fontWeight: 600, color: '#fff' }}>{marketData.txCount24h?.toLocaleString() || '—'}</div>
              </div>
            </div>
          </div>
        )}

        <div style={{
          background: verdict === 'APPROVE' ? '#2ea04322' : '#f8514922',
          border: `1px solid ${verdictColor}`,
          borderRadius: 10,
          padding: '18px 24px',
          marginBottom: 24,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
        }}>
          <div>
            <div style={{ fontSize: 11, color: '#8b949e', textTransform: 'uppercase', letterSpacing: 1.5, marginBottom: 4 }}>Verdict</div>
            <div style={{ fontSize: 28, fontWeight: 800, color: verdictColor }}>
              {blocked ? 'BLOCKED' : (verdict || '—')}
            </div>
            {blocked && blockReason && <div style={{ fontSize: 12, color: '#f85149', marginTop: 4 }}>{blockReason}</div>}
            {rejectionReason && <div style={{ fontSize: 12, color: '#8b949e', marginTop: 4 }}>{rejectionReason}</div>}
          </div>
          <div style={{ textAlign: 'right' }}>
            <div style={{ fontSize: 11, color: '#8b949e', textTransform: 'uppercase', letterSpacing: 1.5, marginBottom: 4 }}>Final Score</div>
            <div style={{ fontSize: 36, fontWeight: 800, color: '#fff' }}>
              {finalScore != null ? parseFloat(finalScore).toFixed(2) : '—'}
            </div>
            <div style={{ fontSize: 11, color: '#8b949e' }}>/ 5.00</div>
          </div>
        </div>

        {finalScore != null && (
          <div style={{ marginBottom: 24 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: '#8b949e', marginBottom: 6 }}>
              <span>Score</span>
              <span>Threshold: 4.20</span>
            </div>
            <div style={{ background: '#0d1117', borderRadius: 6, height: 8, overflow: 'hidden', position: 'relative' }}>
              <div style={{
                width: `${(parseFloat(finalScore) / 5) * 100}%`,
                height: '100%',
                background: verdict === 'APPROVE' ? '#2ea043' : '#f85149',
                borderRadius: 6,
              }} />
              <div style={{ position: 'absolute', left: '84%', top: 0, bottom: 0, width: 2, background: '#58a6ff' }} />
            </div>
          </div>
        )}

        {categories && categories.length > 0 && (
          <div style={{ marginBottom: 24 }}>
            <div style={styles.sectionTitle}>Category Scores</div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 12 }}>
              {categories.map(c => {
                const score = parseFloat(c.score);
                const pct = (score / 5) * 100;
                const scoreColor = score >= 4.20 ? '#2ea043' : score >= 2.5 ? '#58a6ff' : '#f85149';
                return (
                  <div key={c.category} style={{
                    background: '#0d1117',
                    border: '1px solid #30363d',
                    borderRadius: 8,
                    padding: 16,
                  }}>
                    <div style={{ fontSize: 11, color: '#8b949e', textTransform: 'uppercase', letterSpacing: 1.5, marginBottom: 8 }}>
                      {c.category.replace(/_/g, ' ')}
                    </div>
                    <div style={{ display: 'flex', alignItems: 'baseline', gap: 4, marginBottom: 8 }}>
                      <div style={{ fontSize: 28, fontWeight: 700, color: scoreColor }}>{score.toFixed(2)}</div>
                      <div style={{ fontSize: 12, color: '#8b949e' }}>/5.00</div>
                    </div>
                    <div style={{ background: '#161b22', borderRadius: 4, height: 4, marginBottom: 8 }}>
                      <div style={{ width: `${pct}%`, height: '100%', background: scoreColor, borderRadius: 4 }} />
                    </div>
                    <div style={{ fontSize: 11, color: '#8b949e', lineHeight: 1.4 }}>{c.reasoning}</div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {hardFilters && hardFilters.length > 0 && (
          <div style={{ marginBottom: 24 }}>
            <div style={styles.sectionTitle}>Hard Filters</div>
            <div style={{ display: 'grid', gap: 6 }}>
              {hardFilters.map(f => (
                <div key={f.filter_name || f.filterName} style={{
                  background: f.triggered ? '#f8514918' : '#0d1117',
                  border: `1px solid ${f.triggered ? '#f85149' : '#30363d'}`,
                  borderRadius: 6,
                  padding: '10px 14px',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 10,
                  fontSize: 12,
                }}>
                  <span style={{
                    fontSize: 10,
                    fontWeight: 700,
                    padding: '2px 8px',
                    borderRadius: 4,
                    background: f.triggered ? '#f85149' : '#238636',
                    color: '#fff',
                    textTransform: 'uppercase',
                  }}>{f.triggered ? 'HIT' : 'PASS'}</span>
                  <span style={{ color: '#8b949e' }}>
                    <strong style={{ color: '#c9d1d9' }}>{(f.filter_name || f.filterName).replace(/_/g, ' ')}</strong>
                    {f.evidence ? ` — ${f.evidence}` : ''}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}

        {tags && tags.length > 0 && (
          <div>
            <div style={styles.sectionTitle}>Tags</div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
              {tags.map(t => (
                <span key={t} style={{
                  background: '#58a6ff18',
                  border: '1px solid #58a6ff44',
                  color: '#58a6ff',
                  padding: '4px 12px',
                  borderRadius: 20,
                  fontSize: 12,
                  fontWeight: 600,
                }}>{t.replace(/_/g, ' ')}</span>
              ))}
            </div>
          </div>
        )}
      </div>
    );
  }

  // ------------------------------------------------------------
  // RENDER
  // ------------------------------------------------------------
  return (
    <div style={{
      fontFamily: "'JetBrains Mono', monospace",
      background: 'linear-gradient(135deg, #0d1117 0%, #161b22 100%)',
      color: '#c9d1d9',
      minHeight: '100vh',
      padding: '32px 24px',
    }}>
      {/* HEADER */}
      <header style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        marginBottom: 32,
        paddingBottom: 24,
        borderBottom: '1px solid #30363d',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
          <div style={{
            width: 48,
            height: 48,
            background: 'linear-gradient(135deg, #f85149, #da3633)',
            borderRadius: 8,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: 24,
            fontWeight: 800,
            color: '#fff',
            fontFamily: "'Syne', sans-serif",
            boxShadow: '0 0 24px #f8514944',
          }}>S</div>
          <div>
            <h1 style={{
              margin: 0,
              fontSize: 28,
              fontWeight: 800,
              fontFamily: "'Syne', sans-serif",
              letterSpacing: '-1px',
              color: '#fff',
            }}>SNIPER</h1>
            <p style={{
              margin: 0,
              fontSize: 11,
              color: '#8b949e',
              textTransform: 'uppercase',
              letterSpacing: 3,
              fontWeight: 500,
            }}>Deterministic Evaluation Engine</p>
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          {['submit', 'calls', 'scanner'].map(tab => (
            <button
              key={tab}
              onClick={() => { setView(tab); if (tab !== 'submit') setLastResult(null); if (tab === 'calls') fetchCalls(); }}
              style={{
                background: view === tab ? '#30363d' : 'transparent',
                border: view === tab ? '1px solid #f85149' : '1px solid #30363d',
                color: view === tab ? '#f85149' : '#8b949e',
                padding: '10px 20px',
                borderRadius: 6,
                fontSize: 12,
                fontWeight: 600,
                textTransform: 'uppercase',
                letterSpacing: 1.5,
                cursor: 'pointer',
                fontFamily: 'inherit',
                transition: 'all .2s',
              }}
            >{tab}</button>
          ))}
        </div>
      </header>

      {/* ALERTS */}
      {error && (
        <div style={{
          background: '#f8514922',
          border: '1px solid #f85149',
          borderRadius: 8,
          padding: '12px 16px',
          marginBottom: 24,
          fontSize: 13,
          color: '#f85149',
          display: 'flex',
          alignItems: 'center',
          gap: 8,
        }}>
          <span>⚠</span>
          <span>{error}</span>
          <button onClick={() => setError(null)} style={{
            marginLeft: 'auto',
            background: 'none',
            border: 'none',
            color: '#f85149',
            cursor: 'pointer',
            fontSize: 16,
          }}>×</button>
        </div>
      )}

      {/* ====================================================== */}
      {/* SUBMIT VIEW                                             */}
      {/* ====================================================== */}
      {view === 'submit' && (
        <div style={{ maxWidth: 700 }}>
          {lastResult ? (
            <div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
                <h2 style={{ margin: 0, fontSize: 18, fontWeight: 700, color: '#fff', textTransform: 'uppercase', letterSpacing: 2 }}>
                  Evaluation Result
                </h2>
                <button
                  onClick={() => setLastResult(null)}
                  style={{
                    background: 'transparent',
                    border: '1px solid #30363d',
                    color: '#8b949e',
                    padding: '8px 16px',
                    borderRadius: 6,
                    fontSize: 12,
                    fontWeight: 600,
                    cursor: 'pointer',
                    fontFamily: 'inherit',
                  }}
                >← New Evaluation</button>
              </div>
              <div style={styles.card}>
                <ScoreBreakdown
                  categories={lastResult.categories}
                  hardFilters={lastResult.hardFilters}
                  verdict={lastResult.verdict}
                  finalScore={lastResult.finalScore}
                  tags={lastResult.tags}
                  rejectionReason={lastResult.rejectionReason}
                  blocked={lastResult.blocked}
                  blockReason={lastResult.blockReason}
                  marketData={lastResult.marketData}
                />
              </div>
            </div>
          ) : (
            <div style={styles.card}>
              <h2 style={{
                margin: '0 0 24px 0',
                fontSize: 18,
                fontWeight: 700,
                color: '#fff',
                textTransform: 'uppercase',
                letterSpacing: 2,
              }}>Manual Evaluation</h2>
              <form onSubmit={handleSubmit}>
                <div style={{ marginBottom: 20 }}>
                  <label style={styles.label}>Ticker</label>
                  <input
                    type="text"
                    value={formData.ticker}
                    onChange={e => setFormData({ ...formData, ticker: e.target.value })}
                    required
                    style={styles.input}
                    placeholder="e.g. PEPE"
                  />
                </div>
                <div style={{ marginBottom: 20 }}>
                  <label style={styles.label}>Contract Address</label>
                  <input
                    type="text"
                    value={formData.contractAddress}
                    onChange={e => setFormData({ ...formData, contractAddress: e.target.value })}
                    required
                    style={styles.input}
                    placeholder="Token contract address"
                  />
                </div>
                <div style={{ marginBottom: 20 }}>
                  <label style={styles.label}>Chain</label>
                  <select
                    value={formData.chain}
                    onChange={e => setFormData({ ...formData, chain: e.target.value })}
                    style={styles.input}
                  >
                    <option value="solana">Solana</option>
                    <option value="bnb">BNB</option>
                  </select>
                </div>
                <button
                  type="submit"
                  disabled={loading}
                  style={{
                    width: '100%',
                    background: loading ? '#30363d' : '#f85149',
                    border: 'none',
                    borderRadius: 6,
                    padding: '14px',
                    fontSize: 13,
                    fontWeight: 700,
                    color: '#fff',
                    textTransform: 'uppercase',
                    letterSpacing: 2,
                    cursor: loading ? 'not-allowed' : 'pointer',
                    fontFamily: 'inherit',
                  }}
                >
                  {loading ? 'EVALUATING...' : 'RUN EVALUATION'}
                </button>
              </form>
            </div>
          )}
        </div>
      )}

      {/* ====================================================== */}
      {/* CALLS VIEW (merged with history)                        */}
      {/* ====================================================== */}
      {view === 'calls' && (
        <div>
          {/* Stats Header */}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24, flexWrap: 'wrap', gap: 16 }}>
            <h2 style={{
              margin: 0,
              fontSize: 18,
              fontWeight: 700,
              color: '#fff',
              textTransform: 'uppercase',
              letterSpacing: 2,
            }}>Call Tracking</h2>
            <div style={{ display: 'flex', gap: 20, fontSize: 12, flexWrap: 'wrap' }}>
              <span style={{ color: '#8b949e' }}>
                Total: <strong style={{ color: '#fff' }}>{stats.total}</strong>
              </span>
              <span style={{ color: '#2ea043' }}>
                Correct: <strong>{stats.wins}</strong>
              </span>
              <span style={{ color: '#f85149' }}>
                Wrong: <strong>{stats.losses}</strong>
              </span>
              <span style={{ color: '#58a6ff' }}>
                Pending: <strong>{stats.pending}</strong>
              </span>
              <span style={{
                color: stats.accuracy !== '—' && parseFloat(stats.accuracy) >= 50 ? '#2ea043' : '#f85149',
                fontWeight: 700,
              }}>
                Accuracy: {stats.accuracy}{stats.accuracy !== '—' ? '%' : ''}
              </span>
            </div>
          </div>

          {/* Legend */}
          <div style={{
            background: '#0d1117',
            border: '1px solid #30363d',
            borderRadius: 8,
            padding: '12px 16px',
            marginBottom: 16,
            fontSize: 11,
            color: '#8b949e',
          }}>
            <strong style={{ color: '#fff' }}>How it works:</strong> Mark if the coin 2x'd from your entry.
            <span style={{ color: '#2ea043' }}> Correct</span> = APPROVE that 2x'd or REJECT that didn't.
            <span style={{ color: '#f85149' }}> Wrong</span> = APPROVE that failed or REJECT that 2x'd.
          </div>

          <div style={{
            background: '#161b22',
            border: '1px solid #30363d',
            borderRadius: 12,
            overflow: 'hidden',
          }}>
            {calls.length === 0 ? (
              <div style={{ padding: 32, textAlign: 'center', color: '#8b949e', fontSize: 14 }}>
                No calls yet. Evaluate coins via Submit tab or Telegram bot.
              </div>
            ) : (
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr style={{ background: '#0d1117', borderBottom: '1px solid #30363d' }}>
                    {['Ticker', 'Contract', 'Verdict', 'Score', 'Date', 'Did 2x?', 'Result'].map(h => (
                      <th key={h} style={{ padding: '12px 16px', textAlign: 'left', fontSize: 11, color: '#8b949e', textTransform: 'uppercase', letterSpacing: 1.5, fontWeight: 600 }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {calls.map(c => {
                    const outcomeResult = c.outcome_result || 'pending';
                    return (
                      <tr
                        key={c.evaluation_id}
                        onClick={() => fetchEvaluationDetail(c.evaluation_id, 'calls')}
                        style={{
                          borderBottom: '1px solid #30363d',
                          background: outcomeResult === 'win' ? '#2ea04308' : outcomeResult === 'loss' ? '#f8514908' : 'transparent',
                          cursor: 'pointer',
                          transition: 'background .15s',
                        }}
                        onMouseEnter={ev => { if (outcomeResult === 'pending') ev.currentTarget.style.background = '#21262d'; }}
                        onMouseLeave={ev => { ev.currentTarget.style.background = outcomeResult === 'win' ? '#2ea04308' : outcomeResult === 'loss' ? '#f8514908' : 'transparent'; }}
                      >
                        <td style={{ padding: '12px 16px', fontSize: 13, color: '#c9d1d9', fontWeight: 600 }}>
                          ${c.ticker}
                        </td>
                        <td style={{ padding: '12px 16px', fontSize: 11, color: '#8b949e', fontFamily: 'monospace' }}>
                          <a
                            href={`https://dexscreener.com/${c.chain}/${c.contract_address}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            style={{ color: '#58a6ff', textDecoration: 'none' }}
                            onClick={e => e.stopPropagation()}
                          >
                            {c.contract_address?.slice(0, 6)}...{c.contract_address?.slice(-4)}
                          </a>
                        </td>
                        <td style={{ padding: '12px 16px', fontSize: 13 }}>
                          <span style={{
                            color: c.verdict === 'APPROVE' ? '#2ea043' : c.verdict === 'REJECT' ? '#f85149' : '#8b949e',
                            fontWeight: 700,
                          }}>{c.verdict || 'BLOCKED'}</span>
                        </td>
                        <td style={{ padding: '12px 16px', fontSize: 13, color: '#c9d1d9' }}>
                          {c.final_score != null ? parseFloat(c.final_score).toFixed(2) : '—'}
                        </td>
                        <td style={{ padding: '12px 16px', fontSize: 11, color: '#8b949e' }}>
                          {new Date(c.created_at).toLocaleDateString()}<br />
                          <span style={{ fontSize: 10 }}>{new Date(c.created_at).toLocaleTimeString()}</span>
                        </td>
                        <td style={{ padding: '12px 16px' }}>
                          {outcomeResult === 'pending' ? (
                            <div style={{ display: 'flex', gap: 6 }}>
                              <button
                                onClick={(e) => updateCallOutcome(c.evaluation_id, true, e)}
                                style={{
                                  background: '#0d1117',
                                  border: '1px solid #2ea043',
                                  color: '#2ea043',
                                  padding: '5px 10px',
                                  borderRadius: 4,
                                  fontSize: 10,
                                  fontWeight: 600,
                                  cursor: 'pointer',
                                  fontFamily: 'inherit',
                                }}
                              >YES</button>
                              <button
                                onClick={(e) => updateCallOutcome(c.evaluation_id, false, e)}
                                style={{
                                  background: '#0d1117',
                                  border: '1px solid #f85149',
                                  color: '#f85149',
                                  padding: '5px 10px',
                                  borderRadius: 4,
                                  fontSize: 10,
                                  fontWeight: 600,
                                  cursor: 'pointer',
                                  fontFamily: 'inherit',
                                }}
                              >NO</button>
                            </div>
                          ) : (
                            <button
                              onClick={(e) => resetOutcome(c.evaluation_id, e)}
                              style={{
                                background: 'transparent',
                                border: '1px solid #30363d',
                                color: '#8b949e',
                                padding: '5px 10px',
                                borderRadius: 4,
                                fontSize: 10,
                                cursor: 'pointer',
                                fontFamily: 'inherit',
                              }}
                            >↺ Reset</button>
                          )}
                        </td>
                        <td style={{ padding: '12px 16px' }}>
                          {outcomeResult === 'pending' ? (
                            <span style={{ color: '#8b949e', fontSize: 11 }}>—</span>
                          ) : (
                            <span style={{
                              fontSize: 11,
                              fontWeight: 700,
                              padding: '4px 10px',
                              borderRadius: 4,
                              background: outcomeResult === 'win' ? '#2ea04322' : '#f8514922',
                              color: outcomeResult === 'win' ? '#2ea043' : '#f85149',
                              textTransform: 'uppercase',
                            }}>
                              {outcomeResult === 'win' ? 'CORRECT' : 'WRONG'}
                            </span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>
        </div>
      )}

      {/* ====================================================== */}
      {/* DETAIL VIEW                                             */}
      {/* ====================================================== */}
      {view === 'detail' && selectedEval && (
        <div style={{ maxWidth: 700 }}>
          <button
            onClick={() => setView(detailSource)}
            style={{
              background: 'transparent',
              border: '1px solid #30363d',
              color: '#8b949e',
              padding: '8px 16px',
              borderRadius: 6,
              fontSize: 12,
              fontWeight: 600,
              cursor: 'pointer',
              marginBottom: 24,
              fontFamily: 'inherit',
            }}
          >← Back</button>
          <div style={styles.card}>
            <ScoreBreakdown
              categories={selectedEval.categories}
              hardFilters={selectedEval.hardFilters}
              verdict={selectedEval.evaluation.verdict}
              finalScore={selectedEval.evaluation.final_score}
              tags={selectedEval.tags}
              blocked={selectedEval.evaluation.status === 'blocked'}
              blockReason={selectedEval.evaluation.block_reason}
            />
          </div>
        </div>
      )}

      {/* ====================================================== */}
      {/* SCANNER VIEW                                            */}
      {/* ====================================================== */}
      {view === 'scanner' && (
        <div style={{
          maxWidth: 600,
          background: '#161b22',
          border: '1px solid #30363d',
          borderRadius: 12,
          padding: 32,
        }}>
          <h2 style={{ margin: '0 0 24px 0', fontSize: 18, fontWeight: 700, color: '#fff', textTransform: 'uppercase', letterSpacing: 2 }}>
            Scanner Controls
          </h2>
          <div style={{ marginBottom: 24, padding: 16, background: '#0d1117', borderRadius: 8, border: '1px solid #30363d' }}>
            <div style={{ fontSize: 11, color: '#8b949e', textTransform: 'uppercase', letterSpacing: 1.5, marginBottom: 8 }}>Status</div>
            <div style={{ fontSize: 20, fontWeight: 700, color: scannerStatus === 'running' ? '#2ea043' : '#f85149' }}>
              {scannerStatus.toUpperCase()}
            </div>
          </div>
          <div style={{ display: 'flex', gap: 12 }}>
            <button
              onClick={startScanner}
              disabled={scannerStatus === 'running'}
              style={{
                flex: 1,
                background: scannerStatus === 'running' ? '#30363d' : '#2ea043',
                border: 'none',
                borderRadius: 6,
                padding: '14px',
                fontSize: 13,
                fontWeight: 700,
                color: '#fff',
                textTransform: 'uppercase',
                letterSpacing: 2,
                cursor: scannerStatus === 'running' ? 'not-allowed' : 'pointer',
                fontFamily: 'inherit',
              }}
            >Start</button>
            <button
              onClick={stopScanner}
              disabled={scannerStatus === 'stopped'}
              style={{
                flex: 1,
                background: scannerStatus === 'stopped' ? '#30363d' : '#f85149',
                border: 'none',
                borderRadius: 6,
                padding: '14px',
                fontSize: 13,
                fontWeight: 700,
                color: '#fff',
                textTransform: 'uppercase',
                letterSpacing: 2,
                cursor: scannerStatus === 'stopped' ? 'not-allowed' : 'pointer',
                fontFamily: 'inherit',
              }}
            >Stop</button>
          </div>
          <button
            onClick={triggerManualScan}
            disabled={loading}
            style={{
              width: '100%',
              background: loading ? '#30363d' : '#58a6ff',
              border: 'none',
              borderRadius: 6,
              padding: '14px',
              fontSize: 13,
              fontWeight: 700,
              color: '#fff',
              textTransform: 'uppercase',
              letterSpacing: 2,
              cursor: loading ? 'not-allowed' : 'pointer',
              fontFamily: 'inherit',
              marginTop: 12,
            }}
          >
            {loading ? 'SCANNING...' : 'Trigger Manual Scan'}
          </button>
        </div>
      )}
    </div>
  );
}
