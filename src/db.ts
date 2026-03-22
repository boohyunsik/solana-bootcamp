import { Pool } from "pg";
import { config } from "./config";

// pg 커넥션 풀: 매 쿼리마다 연결을 새로 맺지 않고 풀에서 재사용
export const pool = new Pool(config.db);

// 스왑 이벤트의 DB 레코드 타입 정의
export interface SwapRow {
  time: Date;
  signature: string;      // 솔라나 트랜잭션 고유 서명
  wallet_address: string; // 스왑 실행자 지갑
  sol_amount: number;
  usdc_amount: number;
  is_buy: boolean;        // true = SOL 매수, false = SOL 매도
}

/**
 * 스왑 이벤트를 DB에 삽입
 *
 * ★ 핵심: ON CONFLICT (signature) DO NOTHING
 * gRPC 스트림은 동일 트랜잭션을 중복 수신할 수 있음
 * signature에 UNIQUE 제약이 걸려 있어서, 같은 트랜잭션이 다시 오면
 * 에러 없이 무시됨 → 멱등성(idempotency) 보장
 */
export async function insertSwap(swap: Omit<SwapRow, "time">): Promise<void> {
  await pool.query(
    `INSERT INTO orca_swaps (signature, wallet_address, sol_amount, usdc_amount, is_buy)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (signature) DO NOTHING`,
    [
      swap.signature,
      swap.wallet_address,
      swap.sol_amount,
      swap.usdc_amount,
      swap.is_buy,
    ],
  );
}

/**
 * 최근 스왑 내역 조회 (시간 역순)
 * 하이퍼테이블 덕분에 ORDER BY time DESC + LIMIT 쿼리가
 * 최신 파티션만 스캔하여 빠르게 수행됨
 */
export async function getRecentSwaps(limit = 20): Promise<SwapRow[]> {
  const { rows } = await pool.query<SwapRow>(
    `SELECT time, signature, wallet_address, sol_amount, usdc_amount, is_buy
     FROM orca_swaps
     ORDER BY time DESC
     LIMIT $1`,
    [limit],
  );
  return rows;
}

/**
 * 5분 단위 거래량 조회 (최근 1시간)
 * five_min_volume Continuous Aggregate 뷰에서 읽음
 * → 원본 테이블을 집계하지 않고 미리 계산된 결과를 반환하므로 매우 빠름
 */
export async function getFiveMinVolume(): Promise<
  { bucket: Date; total_usdc_volume: number; tx_count: number }[]
> {
  const { rows } = await pool.query(
    `SELECT bucket, total_usdc_volume, tx_count
     FROM five_min_volume
     WHERE bucket >= NOW() - INTERVAL '1 hour'
     ORDER BY bucket ASC`,
  );
  return rows;
}
