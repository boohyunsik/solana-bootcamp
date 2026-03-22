import express from "express";
import { config } from "./config";
import { getRecentSwaps, getFiveMinVolume } from "./db";

const app = express();

/**
 * GET /api/swaps
 * Returns the 20 most recent swaps (>= $10 USDC) in descending time order.
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
 * Returns 5-minute USDC volume buckets for the last 1 hour.
 * Useful for rendering a bar/line chart.
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

/** Health check */
app.get("/health", (_req, res) => {
  res.json({ status: "ok" });
});

app.listen(config.api.port, () => {
  console.log(`🌐 API server running on http://localhost:${config.api.port}`);
  console.log(`   GET /api/swaps   - Recent swap transactions`);
  console.log(`   GET /api/volume  - 5-min volume buckets`);
  console.log(`   GET /health      - Health check`);
});
