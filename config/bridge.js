// Tarang 1.0.0.1 — config/bridge.js
// Axios instance pre-configured for the Python FastAPI bridge

const axios = require("axios");

const bridge = axios.create({
  baseURL: process.env.PYTHON_BRIDGE_URL || "http://localhost:5001",
  timeout: 600000, // 5 min — TTS + modulation can take time on long docs
  headers: { "Content-Type": "application/json" },
});

// Log all bridge requests in development
bridge.interceptors.request.use((config) => {
  if (process.env.NODE_ENV === "development") {
    console.log(`→ Bridge: ${config.method?.toUpperCase()} ${config.url}`);
  }
  return config;
});

// Normalize bridge errors into a consistent format
bridge.interceptors.response.use(
  (response) => response,
  (error) => {
    const msg =
      error.response?.data?.error ||
      error.message ||
      "Python bridge request failed";
    const err = new Error(msg);
    err.bridgeStatus = error.response?.status || 500;
    err.bridgeData   = error.response?.data || null;
    throw err;
  }
);

// ── Helper: ping bridge health ────────────────────────────────────────────────
const pingBridge = async () => {
  try {
    const { data } = await bridge.get("/health");
    return data.status === "ok";
  } catch {
    return false;
  }
};

module.exports = { bridge, pingBridge };
