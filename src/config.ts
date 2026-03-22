import dotenv from "dotenv";
dotenv.config();

export const config = {
  // Yellowstone gRPC 접속 정보
  // Triton, Helius 등 RPC 제공자에서 발급받은 gRPC 엔드포인트와 토큰
  grpc: {
    url: process.env.GRPC_URL || "https://grpc.mainnet.solana.blockdaemon.tech",
    token: process.env.GRPC_TOKEN || "",
  },

  // PostgreSQL(TimescaleDB) 접속 정보
  db: {
    host: process.env.DB_HOST || "localhost",
    port: parseInt(process.env.DB_PORT || "5432", 10),
    user: process.env.DB_USER || "solana",
    password: process.env.DB_PASSWORD || "solana",
    database: process.env.DB_NAME || "solana_indexer",
  },

  // Express API 서버 포트
  api: {
    port: parseInt(process.env.API_PORT || "3000", 10),
  },

  // 필터 설정: 이 금액 미만의 스왑은 DB에 저장하지 않음
  filter: {
    minUsdcAmount: parseFloat(process.env.MIN_USDC_AMOUNT || "10"),
  },

  // 솔라나 온체인 주소
  solana: {
    // Orca Whirlpool 프로그램 ID (모든 Orca 풀이 사용하는 프로그램)
    whirlpoolProgramId: "whirLbMiicVdio4qvUfM5KAg6Ct8VwpYzGff3uctyCc",
    // SOL-USDC 풀 주소 (이 주소를 구독 필터로 사용)
    solUsdcPool: "7qbRF6YsyGuLUVs6Y1q64bdVrfe4ZcUUz1JRdoVNUJnm",
  },
} as const;
