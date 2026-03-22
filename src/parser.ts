import { SwapRow } from "./db";

// =============================================================
// 솔라나 토큰 소수점 자릿수
// 온체인에서는 정수(lamports, 최소 단위)로 저장되므로 사람이 읽을 수 있는
// 단위로 변환하려면 10^decimals 로 나눠야 함
// 예: 1 SOL = 1,000,000,000 lamports (10^9)
//     1 USDC = 1,000,000 (10^6)
// =============================================================
const USDC_DECIMALS = 6;
const SOL_DECIMALS = 9;

// 솔라나 메인넷의 USDC 토큰 민트 주소
const USDC_MINT = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
// Wrapped SOL 민트 주소 (SPL Token으로 감싼 SOL)
const WSOL_MINT = "So11111111111111111111111111111111111111112";

/**
 * Orca Whirlpool 스왑 트랜잭션을 파싱하여 거래 정보를 추출
 *
 * ★ 솔라나 트랜잭션 구조 핵심:
 * 모든 트랜잭션에는 두 가지 유용한 데이터가 있음:
 *   1) logs: 프로그램이 실행 중 남긴 로그 메시지 배열
 *   2) preTokenBalances / postTokenBalances: 트랜잭션 전후 토큰 잔액
 *
 * 파싱 전략:
 *   1차) 로그에서 "Transfer <amount>" 패턴을 정규식으로 추출 (빠르고 간단)
 *   2차) 로그 파싱 실패 시, 전후 토큰 잔액 변화량으로 계산 (폴백)
 */
export function parseWhirlpoolSwap(
  signature: string,
  logs: string[],
  accountKeys: string[],
  preBalances: { mint: string; owner: string; amount: string }[],
  postBalances: { mint: string; owner: string; amount: string }[],
): Omit<SwapRow, "time"> | null {

  // ─── Step 1: 스왑 트랜잭션인지 확인 ───
  // Whirlpool 프로그램은 스왑 실행 시 "Instruction: Swap" 로그를 남김
  const hasSwapLog = logs.some(
    (log) =>
      log.includes("Instruction: Swap") ||
      log.includes("Instruction: TwoHopSwap"),  // 두 풀을 경유하는 스왑
  );
  if (!hasSwapLog) return null;

  // 트랜잭션의 첫 번째 계정 키 = 서명자(지갑 주소)
  const walletAddress = accountKeys[0] || "unknown";

  let solAmount = 0;
  let usdcAmount = 0;
  let isBuy = false; // true = SOL 매수(USDC를 주고 SOL을 받음)

  // ─── Step 2: 1차 파싱 - 로그에서 Transfer 금액 추출 ───
  // SPL Token 프로그램은 토큰 이동 시 "Transfer <amount>" 로그를 남김
  // 스왑에서는 보통 2번의 Transfer가 발생 (토큰 A 입금, 토큰 B 출금)
  const transferAmounts: number[] = [];
  for (const log of logs) {
    const transferMatch = log.match(/Transfer (\d+)/);
    if (transferMatch) {
      transferAmounts.push(parseInt(transferMatch[1], 10));
    }
  }

  if (transferAmounts.length >= 2) {
    const [amount1, amount2] = transferAmounts;

    // ★ SOL vs USDC 구분 휴리스틱:
    // SOL은 9자리 소수점(lamports), USDC는 6자리 소수점
    // → 같은 달러 가치라면 SOL 쪽 원시 숫자가 ~100배 이상 큼
    // 예: $100 어치면 SOL ≈ 714,285,714 lamports vs USDC = 100,000,000
    if (amount1 > amount2 * 100) {
      // amount1이 훨씬 큼 → amount1이 SOL(lamports)
      solAmount = amount1 / 10 ** SOL_DECIMALS;
      usdcAmount = amount2 / 10 ** USDC_DECIMALS;
      isBuy = false; // SOL이 나감 → SOL 매도
    } else if (amount2 > amount1 * 100) {
      // amount2가 훨씬 큼 → amount2가 SOL(lamports)
      solAmount = amount2 / 10 ** SOL_DECIMALS;
      usdcAmount = amount1 / 10 ** USDC_DECIMALS;
      isBuy = true; // USDC가 나감 → SOL 매수
    } else {
      // 크기가 비슷하면 기본적으로 첫 번째를 USDC로 간주
      usdcAmount = amount1 / 10 ** USDC_DECIMALS;
      solAmount = amount2 / 10 ** SOL_DECIMALS;
      isBuy = true;
    }
  }

  // ─── Step 3: 2차 파싱 (폴백) - 토큰 잔액 변화량으로 계산 ───
  // 로그에서 금액을 추출하지 못한 경우, 트랜잭션 전후 토큰 잔액 차이를 사용
  // preTokenBalances: 트랜잭션 실행 전 각 토큰 계정의 잔액
  // postTokenBalances: 트랜잭션 실행 후 각 토큰 계정의 잔액
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

      // 민트 주소로 어떤 토큰인지 식별
      if (pre.mint === USDC_MINT && diff > 0) {
        usdcAmount = diff / 10 ** USDC_DECIMALS;
        // 잔액이 줄었으면 USDC를 지불 → SOL 매수
        isBuy = parseInt(post.amount, 10) < parseInt(pre.amount, 10);
      }
      if (pre.mint === WSOL_MINT && diff > 0) {
        solAmount = diff / 10 ** SOL_DECIMALS;
      }
    }
  }

  // USDC 금액을 추출하지 못하면 유효하지 않은 트랜잭션으로 판단
  if (usdcAmount === 0) return null;

  return {
    signature,
    wallet_address: walletAddress,
    sol_amount: solAmount,
    usdc_amount: usdcAmount,
    is_buy: isBuy,
  };
}
