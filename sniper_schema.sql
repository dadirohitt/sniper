-- ============================================================
-- SNIPER — Deterministic Meme Coin Evaluation Platform
-- Database Schema DDL
-- Ruleset: Sniper Spec v1.2
-- Target: PostgreSQL 15+
-- ============================================================

-- ------------------------------------------------------------
-- ENUMS
-- ------------------------------------------------------------

CREATE TYPE chain_type AS ENUM ('solana', 'bnb');

CREATE TYPE trigger_type AS ENUM ('manual', 'scanner');

CREATE TYPE evaluation_status AS ENUM ('pending', 'blocked', 'complete');

CREATE TYPE block_reason_type AS ENUM (
  'BLOCKED_MISSING_X',
  'BLOCKED_MISSING_REDDIT',
  'BLOCKED_MISSING_DEXSCREENER'
);

CREATE TYPE verdict_type AS ENUM ('APPROVE', 'REJECT');

CREATE TYPE category_type AS ENUM (
  'chart_setup',
  'narrative_strength',
  'social_traction',
  'timing_freshness'
);

CREATE TYPE hard_filter_type AS ENUM (
  'entry_near_ath_no_reclaim',
  'vertical_pump_failed_reclaim',
  'no_clear_meme_narrative',
  'no_traction_outside_telegram',
  'repost_delayed_no_fresh_volume',
  'mev_stealth_pump',
  'two_plus_large_red_candles_post_breakout',
  'sideways_no_volume_expansion'
);

CREATE TYPE tag_type AS ENUM (
  'early_breakout',
  'mid_pump_chase',
  'no_meme_trend',
  'delayed_ct_wave',
  'high_volume_launch',
  'CT_reactive',
  'unconfirmed_narrative',
  'stealth_v_no_meme'
);

CREATE TYPE enrichment_source_type AS ENUM (
  'x_twitter',
  'reddit',
  'dexscreener'
);

CREATE TYPE enrichment_status_type AS ENUM (
  'success',
  'failed',
  'unavailable'
);

CREATE TYPE ruleset_status_type AS ENUM ('active', 'deprecated');

-- ------------------------------------------------------------
-- TABLE: rulesets
-- Immutable versioned rulebook. Never mutated after insert.
-- ------------------------------------------------------------

CREATE TABLE rulesets (
  version           VARCHAR(16)        PRIMARY KEY,
  name              VARCHAR(64)        NOT NULL,
  status            ruleset_status_type NOT NULL DEFAULT 'active',
  hard_filters      JSONB              NOT NULL,   -- frozen filter definitions
  scoring_rules     JSONB              NOT NULL,   -- frozen scoring logic
  approve_threshold NUMERIC(3,2)       NOT NULL,   -- e.g. 4.20
  created_at        TIMESTAMPTZ        NOT NULL DEFAULT NOW()
);

-- Only one ruleset can be active at a time
CREATE UNIQUE INDEX idx_rulesets_single_active
  ON rulesets (status)
  WHERE status = 'active';

-- ------------------------------------------------------------
-- TABLE: assets
-- Master registry of meme coin assets.
-- ------------------------------------------------------------

CREATE TABLE assets (
  id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  ticker           VARCHAR(32) NOT NULL,
  contract_address VARCHAR(128) NOT NULL,
  chain            chain_type  NOT NULL,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Same ticker+chain combo can't exist twice
CREATE UNIQUE INDEX idx_assets_ticker_chain
  ON assets (ticker, chain);

-- Same contract on same chain can't exist twice
CREATE UNIQUE INDEX idx_assets_contract_chain
  ON assets (contract_address, chain);

-- ------------------------------------------------------------
-- TABLE: evaluations
-- Core evaluation record. One row per evaluation run.
-- ------------------------------------------------------------

CREATE TABLE evaluations (
  id               UUID                 PRIMARY KEY DEFAULT gen_random_uuid(),
  asset_id         UUID                 NOT NULL REFERENCES assets(id),
  ruleset_version  VARCHAR(16)          NOT NULL REFERENCES rulesets(version),
  triggered_by     trigger_type         NOT NULL,
  status           evaluation_status    NOT NULL DEFAULT 'pending',
  block_reason     block_reason_type    NULL,
  verdict          verdict_type         NULL,
  final_score      NUMERIC(3,2)         NULL,  -- truncated, never rounded
  called_at        TIMESTAMPTZ          NOT NULL,
  evaluated_at     TIMESTAMPTZ          NULL,
  created_at       TIMESTAMPTZ          NOT NULL DEFAULT NOW(),

  -- Verdict and score only set when status = 'complete'
  CONSTRAINT chk_verdict_requires_complete
    CHECK (verdict IS NULL OR status = 'complete'),

  -- Block reason only set when status = 'blocked'
  CONSTRAINT chk_block_reason_requires_blocked
    CHECK (block_reason IS NULL OR status = 'blocked'),

  -- Score must be in valid range if present
  CONSTRAINT chk_final_score_range
    CHECK (final_score IS NULL OR (final_score >= 0.00 AND final_score <= 5.00))
);

CREATE INDEX idx_evaluations_asset_id ON evaluations(asset_id);
CREATE INDEX idx_evaluations_status   ON evaluations(status);
CREATE INDEX idx_evaluations_verdict  ON evaluations(verdict);
CREATE INDEX idx_evaluations_created  ON evaluations(created_at DESC);

-- ------------------------------------------------------------
-- TABLE: category_scores
-- Per-category score breakdown for each evaluation.
-- ------------------------------------------------------------

CREATE TABLE category_scores (
  id            UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  evaluation_id UUID          NOT NULL REFERENCES evaluations(id),
  category      category_type NOT NULL,
  score         NUMERIC(3,2)  NOT NULL,
  reasoning     TEXT          NOT NULL,  -- rule-based factual justification

  CONSTRAINT chk_category_score_range
    CHECK (score >= 0.00 AND score <= 5.00)
);

-- Each category scored exactly once per evaluation
CREATE UNIQUE INDEX idx_category_scores_eval_category
  ON category_scores (evaluation_id, category);

-- ------------------------------------------------------------
-- TABLE: hard_filter_results
-- Binary hard-filter checks. Any trigger = instant REJECT.
-- ------------------------------------------------------------

CREATE TABLE hard_filter_results (
  id            UUID               PRIMARY KEY DEFAULT gen_random_uuid(),
  evaluation_id UUID               NOT NULL REFERENCES evaluations(id),
  filter_name   hard_filter_type   NOT NULL,
  triggered     BOOLEAN            NOT NULL,
  evidence      TEXT               NULL  -- factual data supporting the check

);

-- Each filter checked exactly once per evaluation
CREATE UNIQUE INDEX idx_hard_filter_eval_filter
  ON hard_filter_results (evaluation_id, filter_name);

-- ------------------------------------------------------------
-- TABLE: evaluation_tags
-- Predefined tags only. No free-form allowed.
-- ------------------------------------------------------------

CREATE TABLE evaluation_tags (
  id            UUID      PRIMARY KEY DEFAULT gen_random_uuid(),
  evaluation_id UUID      NOT NULL REFERENCES evaluations(id),
  tag           tag_type  NOT NULL
);

-- Same tag can't be applied twice to the same evaluation
CREATE UNIQUE INDEX idx_eval_tags_eval_tag
  ON evaluation_tags (evaluation_id, tag);

-- ------------------------------------------------------------
-- TABLE: outcomes
-- Post-evaluation real-world outcome.
-- Manual input ONLY. Never affects future evaluations.
-- ------------------------------------------------------------

CREATE TABLE outcomes (
  id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  evaluation_id    UUID        NOT NULL UNIQUE REFERENCES evaluations(id),  -- 1:1
  logged_by        VARCHAR(64) NOT NULL,
  outcome_notes    TEXT        NULL,
  peak_price_after NUMERIC(30,12) NULL,  -- actual peak price after the call
  logged_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ------------------------------------------------------------
-- TABLE: enrichment_snapshots
-- Raw data fetched from external sources at eval time.
-- Full audit trail — never modified after insert.
-- ------------------------------------------------------------

CREATE TABLE enrichment_snapshots (
  id            UUID                      PRIMARY KEY DEFAULT gen_random_uuid(),
  evaluation_id UUID                      NOT NULL REFERENCES evaluations(id),
  source        enrichment_source_type    NOT NULL,
  fetched_at    TIMESTAMPTZ               NOT NULL,
  payload       JSONB                     NOT NULL,  -- raw response snapshot
  status        enrichment_status_type    NOT NULL
);

-- Each source fetched exactly once per evaluation
CREATE UNIQUE INDEX idx_enrichment_eval_source
  ON enrichment_snapshots (evaluation_id, source);

-- ------------------------------------------------------------
-- SEED: Initial ruleset (Sniper Spec v1.2)
-- ------------------------------------------------------------

INSERT INTO rulesets (version, name, status, hard_filters, scoring_rules, approve_threshold)
VALUES (
  'v1.2',
  'Sniper Spec v1.2',
  'active',
  '{
    "filters": [
      "entry_near_ath_no_reclaim",
      "vertical_pump_failed_reclaim",
      "no_clear_meme_narrative",
      "no_traction_outside_telegram",
      "repost_delayed_no_fresh_volume",
      "mev_stealth_pump",
      "two_plus_large_red_candles_post_breakout",
      "sideways_no_volume_expansion"
    ],
    "logic": "ANY trigger = immediate REJECT"
  }',
  '{
    "categories": [
      { "name": "chart_setup", "weight": 0.25, "range": [0.00, 5.00] },
      { "name": "narrative_strength", "weight": 0.25, "range": [0.00, 5.00] },
      { "name": "social_traction", "weight": 0.25, "range": [0.00, 5.00] },
      { "name": "timing_freshness", "weight": 0.25, "range": [0.00, 5.00] }
    ],
    "final_score": "arithmetic_average",
    "rounding": "truncate_to_2dp"
  }',
  4.20
);
