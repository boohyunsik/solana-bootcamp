import Client, {
  CommitmentLevel,
  SubscribeRequest,
} from "@triton-one/yellowstone-grpc";
import bs58 from "bs58";
import { config } from "./config";
import { insertSwap } from "./db";
import { parseWhirlpoolSwap } from "./parser";

async function main(): Promise<void> {
  console.log("Starting Solana Orca Swap Indexer...");
  console.log(`   Pool: ${config.solana.solUsdcPool} (SOL-USDC)`);
  console.log(`   Min USDC: $${config.filter.minUsdcAmount}`);

  // ─── gRPC 클라이언트 생성 및 스트림 구독 ───
  // Yellowstone gRPC는 밸리데이터 노드에서 트랜잭션을 실시간 push 해줌
  // 일반 RPC 폴링(getTransaction 반복 호출)과 달리 지연이 거의 없음
  const client = new Client(config.grpc.url, config.grpc.token, {});
  const stream = await client.subscribe();

  // ─── 스트림 데이터 수신 핸들러 ───
  // gRPC 스트림에서 트랜잭션이 도착할 때마다 호출됨
  stream.on("data", async (data) => {
    // 트랜잭션 데이터가 없으면 무시 (슬롯 알림 등 다른 이벤트일 수 있음)
    if (!data.transaction) return;

    const txn = data.transaction.transaction;
    if (!txn || !txn.transaction) return;

    const meta = txn.meta;
    if (!meta) return;

    // 실패한 트랜잭션은 건너뜀 (온체인에 기록은 되지만 상태 변경은 없음)
    if (meta.err) return;

    const message = txn.transaction.message;
    if (!message) return;

    // ★ 계정 키 디코딩: 솔라나는 바이너리(Uint8Array)로 전달하므로
    // 사람이 읽을 수 있는 Base58 문자열로 변환
    const accountKeys = message.accountKeys.map((key: Uint8Array) =>
      bs58.encode(key),
    );

    // 트랜잭션 실행 로그 (프로그램이 남긴 메시지들)
    const logs: string[] = meta.logMessages || [];

    // 트랜잭션 전후 토큰 잔액 정보 (파서의 폴백 전략에서 사용)
    const preBalances = (meta.preTokenBalances || []).map((b: any) => ({
      mint: b.mint || "",
      owner: b.owner || "",
      amount: b.uiTokenAmount?.amount || "0",
    }));

    const postBalances = (meta.postTokenBalances || []).map((b: any) => ({
      mint: b.mint || "",
      owner: b.owner || "",
      amount: b.uiTokenAmount?.amount || "0",
    }));

    // 트랜잭션 서명 디코딩 (트랜잭션의 고유 식별자)
    const signature = bs58.encode(txn.signature);

    // 파서로 스왑 정보 추출
    const swap = parseWhirlpoolSwap(
      signature,
      logs,
      accountKeys,
      preBalances,
      postBalances,
    );

    // 스왑이 아닌 트랜잭션이면 무시 (유동성 추가/제거 등)
    if (!swap) return;

    // ★ 금액 필터: 설정된 최소 금액 미만의 소규모 스왑은 저장하지 않음
    // 봇 트랜잭션이나 먼지(dust) 거래를 걸러내는 역할
    if (swap.usdc_amount < config.filter.minUsdcAmount) {
      console.log(
        `   Skip: ${swap.usdc_amount.toFixed(2)} USDC < $${config.filter.minUsdcAmount} threshold`,
      );
      return;
    }

    // TimescaleDB에 삽입 (중복 signature는 자동으로 무시됨)
    try {
      await insertSwap(swap);
      const direction = swap.is_buy ? "BUY" : "SELL";
      console.log(
        `[${direction}] ${swap.usdc_amount.toFixed(2)} USDC | ${swap.sol_amount.toFixed(4)} SOL | ${signature.slice(0, 16)}...`,
      );
    } catch (err) {
      console.error(`DB insert failed for ${signature}:`, err);
    }
  });

  // 에러 및 스트림 종료 처리
  stream.on("error", (err) => {
    console.error("gRPC stream error:", err);
    process.exit(1);
  });

  stream.on("end", () => {
    console.log("gRPC stream ended, exiting...");
    process.exit(0);
  });

  // ─── 구독 요청 생성 ───
  // ★ 핵심 필터: accountInclude에 SOL-USDC 풀 주소를 지정
  // 이 풀 주소가 관련된 트랜잭션만 gRPC 서버가 보내줌
  // → 초당 수천 건의 솔라나 트랜잭션 중 이 풀과 관련된 것만 수신
  const request: SubscribeRequest = {
    accounts: {},       // 계정 변경 구독 (사용 안 함)
    slots: {},          // 슬롯 구독 (사용 안 함)
    transactions: {
      orcaSwaps: {
        vote: false,    // 밸리데이터 투표 트랜잭션 제외
        failed: false,  // 실패한 트랜잭션 제외
        accountInclude: [config.solana.solUsdcPool],  // ★ 이 풀 관련 트랜잭션만
        accountExclude: [],
        accountRequired: [],
      },
    },
    transactionsStatus: {},
    blocks: {},
    blocksMeta: {},
    entry: {},
    // CONFIRMED: 슈퍼 과반수(2/3) 밸리데이터가 승인한 트랜잭션만 수신
    // FINALIZED보다 빠르지만 극히 드물게 롤백 가능성 있음
    commitment: CommitmentLevel.CONFIRMED,
    accountsDataSlice: [],
    ping: undefined,
  };

  // gRPC 서버에 구독 요청 전송
  await new Promise<void>((resolve, reject) => {
    stream.write(request, (err: any) => {
      if (err) {
        reject(err);
      } else {
        console.log("Subscribed to Yellowstone gRPC stream");
        resolve();
      }
    });
  });

  console.log("Listening for Orca SOL-USDC swaps...\n");
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
