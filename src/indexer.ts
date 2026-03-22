import Client, {
  CommitmentLevel,
  SubscribeRequest,
} from "@triton-one/yellowstone-grpc";
import bs58 from "bs58";
import { config } from "./config";
import { insertSwap } from "./db";
import { parseWhirlpoolSwap } from "./parser";

async function main(): Promise<void> {
  console.log("🚀 Starting Solana Orca Swap Indexer...");
  console.log(
    `   Pool: ${config.solana.solUsdcPool} (SOL-USDC)`,
  );
  console.log(
    `   Min USDC: $${config.filter.minUsdcAmount}`,
  );

  // Connect to Yellowstone gRPC
  const client = new Client(config.grpc.url, config.grpc.token, {});

  const stream = await client.subscribe();

  // Handle stream events
  stream.on("data", async (data) => {
    if (!data.transaction) return;

    const txn = data.transaction.transaction;
    if (!txn || !txn.transaction) return;

    const meta = txn.meta;
    if (!meta) return;

    // Skip failed transactions
    if (meta.err) return;

    const message = txn.transaction.message;
    if (!message) return;

    // Decode account keys
    const accountKeys = message.accountKeys.map((key: Uint8Array) =>
      bs58.encode(key),
    );

    // Get log messages
    const logs: string[] = meta.logMessages || [];

    // Parse pre/post token balances
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

    // Decode signature
    const signature = bs58.encode(txn.signature);

    // Parse the swap
    const swap = parseWhirlpoolSwap(
      signature,
      logs,
      accountKeys,
      preBalances,
      postBalances,
    );

    if (!swap) return;

    // Filter: only store swaps >= minUsdcAmount
    if (swap.usdc_amount < config.filter.minUsdcAmount) {
      console.log(
        `   Skip: ${swap.usdc_amount.toFixed(2)} USDC < $${config.filter.minUsdcAmount} threshold`,
      );
      return;
    }

    // Insert into TimescaleDB
    try {
      await insertSwap(swap);
      const direction = swap.is_buy ? "BUY" : "SELL";
      console.log(
        `✅ [${direction}] ${swap.usdc_amount.toFixed(2)} USDC | ${swap.sol_amount.toFixed(4)} SOL | ${signature.slice(0, 16)}...`,
      );
    } catch (err) {
      console.error(`❌ DB insert failed for ${signature}:`, err);
    }
  });

  stream.on("error", (err) => {
    console.error("❌ gRPC stream error:", err);
    process.exit(1);
  });

  stream.on("end", () => {
    console.log("⚠️  gRPC stream ended, exiting...");
    process.exit(0);
  });

  // Build subscription request
  const request: SubscribeRequest = {
    accounts: {},
    slots: {},
    transactions: {
      orcaSwaps: {
        vote: false,
        failed: false,
        accountInclude: [config.solana.solUsdcPool],
        accountExclude: [],
        accountRequired: [],
      },
    },
    transactionsStatus: {},
    blocks: {},
    blocksMeta: {},
    entry: {},
    commitment: CommitmentLevel.CONFIRMED,
    accountsDataSlice: [],
    ping: undefined,
  };

  // Send subscription
  await new Promise<void>((resolve, reject) => {
    stream.write(request, (err: any) => {
      if (err) {
        reject(err);
      } else {
        console.log("📡 Subscribed to Yellowstone gRPC stream");
        resolve();
      }
    });
  });

  console.log("👂 Listening for Orca SOL-USDC swaps...\n");
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
