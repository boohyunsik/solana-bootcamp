-- TimescaleDB 확장 활성화
-- PostgreSQL을 시계열 데이터에 최적화된 DB로 변환해주는 확장 모듈
CREATE EXTENSION IF NOT EXISTS timescaledb;

-- =============================================================
-- 스왑 이벤트 테이블
-- Orca SOL-USDC 풀에서 발생한 개별 스왑 트랜잭션을 저장
-- =============================================================
CREATE TABLE IF NOT EXISTS orca_swaps (
    time            TIMESTAMPTZ      NOT NULL DEFAULT NOW(),   -- 스왑 발생 시각
    signature       TEXT             NOT NULL UNIQUE,          -- 솔라나 트랜잭션 서명 (중복 방지용 PK)
    wallet_address  TEXT             NOT NULL,                 -- 스왑을 실행한 지갑 주소
    sol_amount      DOUBLE PRECISION NOT NULL,                 -- SOL 이동량
    usdc_amount     DOUBLE PRECISION NOT NULL,                 -- USDC 이동량 (= 달러 가치)
    is_buy          BOOLEAN          NOT NULL                  -- true = SOL 매수(USDC→SOL), false = SOL 매도(SOL→USDC)
);

-- ★ 핵심: 하이퍼테이블 변환
-- 일반 테이블을 시간 기준으로 자동 파티셔닝되는 하이퍼테이블로 변환
-- → "최근 1시간" 같은 시간 범위 쿼리가 전체 테이블 스캔 없이 빠르게 수행됨
SELECT create_hypertable('orca_swaps', 'time', if_not_exists => TRUE);

-- 지갑 주소로 조회할 때를 위한 복합 인덱스
CREATE INDEX IF NOT EXISTS idx_orca_swaps_wallet ON orca_swaps (wallet_address, time DESC);

-- =============================================================
-- ★ Continuous Aggregate (연속 집계 뷰)
-- 5분 단위 거래량을 미리 계산해두는 물질화된 뷰
-- 매 쿼리마다 GROUP BY 집계를 하지 않고, 캐시된 결과를 즉시 반환
-- → 차트 데이터 API 응답을 밀리초 단위로 줄여줌
-- =============================================================
CREATE MATERIALIZED VIEW five_min_volume
WITH (timescaledb.continuous) AS
SELECT
    time_bucket('5 minutes', time) AS bucket,          -- 5분 단위 시간 버킷
    SUM(usdc_amount)               AS total_usdc_volume, -- 해당 버킷의 총 USDC 거래량
    COUNT(*)                       AS tx_count           -- 해당 버킷의 트랜잭션 수
FROM orca_swaps
GROUP BY bucket
WITH NO DATA;   -- 생성 시점에는 데이터를 채우지 않음 (정책에 의해 자동 갱신)

-- 자동 갱신 정책 등록
-- 5분마다 실행, 최근 1시간 범위의 데이터를 갱신
-- end_offset 5분: 아직 확정되지 않은 최근 5분은 제외 (데이터 정합성 보장)
SELECT add_continuous_aggregate_policy('five_min_volume',
    start_offset    => INTERVAL '1 hour',      -- 갱신 시작점: 1시간 전부터
    end_offset      => INTERVAL '5 minutes',   -- 갱신 종료점: 5분 전까지
    schedule_interval => INTERVAL '5 minutes', -- 갱신 주기: 5분마다
    if_not_exists => TRUE
);
