import { SwapRow } from "./db";

/**
 * USDC has 6 decimals on Solana.
 * SOL has 9 decimals.
 */
const USDC_DECIMALS = 6;
const SOL_DECIMALS = 9;

// Known USDC mint on mainnet
const USDC_MINT = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
// Wrapped SOL mint
const WSOL_MINT = "So11111111111111111111111111111111111111112";

/**
 * Parse a Whirlpool swap transaction from its logs and account keys.
 *
 * Orca Whirlpool swap instruction emits a Program log like:
 *   "Program log: Instruction: Swap"
 * followed by SPL Token transfer logs showing the token movements.
 *
 * We look for inner SPL Token "Transfer" instructions to extract amounts.
 */
export function parseWhirlpoolSwap(
  signature: string,
  logs: string[],
  accountKeys: string[],
  preBalances: { mint: string; owner: string; amount: string }[],
  postBalances: { mint: string; owner: string; amount: string }[],
): Omit<SwapRow, "time"> | null {
  // Verify this is a swap instruction
  const hasSwapLog = logs.some(
    (log) =>
      log.includes("Instruction: Swap") ||
      log.includes("Instruction: TwoHopSwap"),
  );
  if (!hasSwapLog) return null;

  // The first account key is typically the signer/wallet
  const walletAddress = accountKeys[0] || "unknown";

  // Parse token transfer amounts from logs
  // SPL Token Program logs: "Program TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA invoke"
  // followed by "Transfer <amount>" logs
  let solAmount = 0;
  let usdcAmount = 0;
  let isBuy = false; // SOL buy = USDC in, SOL out

  // Strategy: look for "Transfer" logs with amounts
  // In a swap, there are typically two transfers - one token in, one token out
  const transferAmounts: number[] = [];
  for (const log of logs) {
    // Match "Program log: Transfer <amount>" pattern from SPL token
    const transferMatch = log.match(/Transfer (\d+)/);
    if (transferMatch) {
      transferAmounts.push(parseInt(transferMatch[1], 10));
    }
  }

  if (transferAmounts.length >= 2) {
    // Determine which is SOL and which is USDC based on magnitude
    // USDC amounts are in 6 decimals, SOL in 9 decimals
    // For a typical swap, one amount will be much larger (SOL in lamports)
    const [amount1, amount2] = transferAmounts;

    // Heuristic: if amount1 > amount2 * 100, amount1 is likely SOL (lamports)
    if (amount1 > amount2 * 100) {
      solAmount = amount1 / 10 ** SOL_DECIMALS;
      usdcAmount = amount2 / 10 ** USDC_DECIMALS;
      isBuy = false; // SOL going out → selling SOL
    } else if (amount2 > amount1 * 100) {
      solAmount = amount2 / 10 ** SOL_DECIMALS;
      usdcAmount = amount1 / 10 ** USDC_DECIMALS;
      isBuy = true; // USDC going out → buying SOL
    } else {
      // Fallback: treat first as USDC, second as SOL
      usdcAmount = amount1 / 10 ** USDC_DECIMALS;
      solAmount = amount2 / 10 ** SOL_DECIMALS;
      isBuy = true;
    }
  }

  // If we couldn't parse amounts, try pre/post token balance changes
  if (usdcAmount === 0 && preBalances.length > 0 && postBalances.length > 0) {
    for (let i = 0; i < preBalances.length; i++) {
      const pre = preBalances[i];
      const post = postBalances.find(
        (p) => p.mint === pre.mint && p.owner === pre.owner,
      );
      if (!post) continue;

      const diff = Math.abs(
        parseInt(post.amount, 10) - parseInt(pre.amount, 10),
      );
      if (pre.mint === USDC_MINT && diff > 0) {
        usdcAmount = diff / 10 ** USDC_DECIMALS;
        isBuy = parseInt(post.amount, 10) < parseInt(pre.amount, 10);
      }
      if (pre.mint === WSOL_MINT && diff > 0) {
        solAmount = diff / 10 ** SOL_DECIMALS;
      }
    }
  }

  if (usdcAmount === 0) return null;

  return {
    signature,
    wallet_address: walletAddress,
    sol_amount: solAmount,
    usdc_amount: usdcAmount,
    is_buy: isBuy,
  };
}
