import dotenv from "dotenv";
dotenv.config();

export const config = {
  grpc: {
    url: process.env.GRPC_URL || "https://grpc.mainnet.solana.blockdaemon.tech",
    token: process.env.GRPC_TOKEN || "",
  },
  db: {
    host: process.env.DB_HOST || "localhost",
    port: parseInt(process.env.DB_PORT || "5432", 10),
    user: process.env.DB_USER || "solana",
    password: process.env.DB_PASSWORD || "solana",
    database: process.env.DB_NAME || "solana_indexer",
  },
  api: {
    port: parseInt(process.env.API_PORT || "3000", 10),
  },
  filter: {
    minUsdcAmount: parseFloat(process.env.MIN_USDC_AMOUNT || "10"),
  },
  // Orca Whirlpool Program & SOL-USDC Pool
  solana: {
    whirlpoolProgramId: "whirLbMiicVdio4qvUfM5KAg6Ct8VwpYzGff3uctyCc",
    solUsdcPool: "7qbRF6YsyGuLUVs6Y1q64bdVrfe4ZcUUz1JRdoVNUJnm",
  },
} as const;
