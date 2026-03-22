import { Pool } from "pg";
import { config } from "./config";

export const pool = new Pool(config.db);

export interface SwapRow {
  time: Date;
  signature: string;
  wallet_address: string;
  sol_amount: number;
  usdc_amount: number;
  is_buy: boolean;
}

/** Insert a swap event (ignore duplicates via ON CONFLICT) */
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

/** Recent swaps (descending) */
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

/** 5-min volume buckets for the last 1 hour */
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
