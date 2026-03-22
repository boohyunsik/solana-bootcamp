import express from "express";
import { config } from "./config";
import { getRecentSwaps, getFiveMinVolume } from "./db";

const app = express();

/**
 * GET /api/swaps
 * 최근 스왑 내역 20건을 시간 역순으로 반환
 * 하이퍼테이블의 시간 파티셔닝 덕분에 최신 데이터 조회가 빠름
 */
app.get("/api/swaps", async (_req, res) => {
  try {
    const swaps = await getRecentSwaps(20);
    res.json({
      success: true,
      data: swaps,
      count: swaps.length,
    });
  } catch (err) {
    console.error("Error fetching swaps:", err);
    res.status(500).json({ success: false, error: "Internal server error" });
  }
});

/**
 * GET /api/volume
 * 최근 1시간의 5분 단위 누적 거래량(USDC 기준)을 반환
 * Continuous Aggregate 뷰에서 읽으므로 원본 테이블을 집계하지 않음
 * → 데이터가 수백만 건이어도 응답 속도에 영향 없음
 */
app.get("/api/volume", async (_req, res) => {
  try {
    const volumes = await getFiveMinVolume();
    res.json({
      success: true,
      data: volumes.map((v) => ({
        bucket: v.bucket,
        total_usdc_volume: parseFloat(String(v.total_usdc_volume)),
        tx_count: parseInt(String(v.tx_count), 10),
      })),
      count: volumes.length,
    });
  } catch (err) {
    console.error("Error fetching volume:", err);
    res.status(500).json({ success: false, error: "Internal server error" });
  }
});

/** 헬스체크 엔드포인트 */
app.get("/health", (_req, res) => {
  res.json({ status: "ok" });
});

app.listen(config.api.port, () => {
  console.log(`API server running on http://localhost:${config.api.port}`);
  console.log(`   GET /api/swaps   - 최근 스왑 내역`);
  console.log(`   GET /api/volume  - 5분 단위 거래량`);
  console.log(`   GET /health      - 헬스체크`);
});
