-- Enable TimescaleDB extension
CREATE EXTENSION IF NOT EXISTS timescaledb;

-- Swap events table
CREATE TABLE IF NOT EXISTS orca_swaps (
    time            TIMESTAMPTZ      NOT NULL DEFAULT NOW(),
    signature       TEXT             NOT NULL UNIQUE,
    wallet_address  TEXT             NOT NULL,
    sol_amount      DOUBLE PRECISION NOT NULL,
    usdc_amount     DOUBLE PRECISION NOT NULL,
    is_buy          BOOLEAN          NOT NULL  -- true = SOL 매수(USDC→SOL), false = SOL 매도(SOL→USDC)
);

-- Convert to hypertable partitioned by time
SELECT create_hypertable('orca_swaps', 'time', if_not_exists => TRUE);

-- Index for wallet lookups
CREATE INDEX IF NOT EXISTS idx_orca_swaps_wallet ON orca_swaps (wallet_address, time DESC);

-- 5-minute continuous aggregate for volume charts
CREATE MATERIALIZED VIEW five_min_volume
WITH (timescaledb.continuous) AS
SELECT
    time_bucket('5 minutes', time) AS bucket,
    SUM(usdc_amount)               AS total_usdc_volume,
    COUNT(*)                       AS tx_count
FROM orca_swaps
GROUP BY bucket
WITH NO DATA;

-- Refresh policy: materialise every 5 min, covering the last 1 hour
SELECT add_continuous_aggregate_policy('five_min_volume',
    start_offset  => INTERVAL '1 hour',
    end_offset    => INTERVAL '5 minutes',
    schedule_interval => INTERVAL '5 minutes',
    if_not_exists => TRUE
);
