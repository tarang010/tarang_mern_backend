// Tarang 1.0.0.1 — models/Analytics.js
// STATELESS: HTML report stored as string in MongoDB.
// No local htmlPath/jsonPath needed.

const mongoose = require("mongoose");

const analyticsSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User", required: true, index: true,
    },
    documentId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Document", required: true,
    },
    docId: { type: String, required: true, index: true },

    // ── Summary metrics ───────────────────────────────────────────────────
    averageScorePct:     { type: Number },
    averageScoreDisplay: { type: String },
    averageScoreLabel:   { type: String },
    learningCurve:       { type: String },
    learningCurveDesc:   { type: String },
    improvementS1toS3:   { type: String },
    totalTimeSpentMin:   { type: Number },
    bestSession:         { type: Number },
    worstSession:        { type: Number },

    // ── Detailed data ─────────────────────────────────────────────────────
    scoreProgression: { type: mongoose.Schema.Types.Mixed, default: [] },
    weakTopics:       { type: [String], default: [] },
    suggestions:      { type: [String], default: [] },

    // ── Flags ─────────────────────────────────────────────────────────────
    relisteningRecommended: { type: Boolean, default: false },
    poorScoreWarning:       { type: Boolean, default: false },

    // ── Full analytics JSON (for cache hit) ───────────────────────────────
    fullAnalytics: { type: mongoose.Schema.Types.Mixed, default: null },

    // ── HTML report stored in MongoDB (no local file) ─────────────────────
    analyticsHtml: { type: String, default: null },

    // ── DEPRECATED — kept for migration compatibility ─────────────────────
    // Safe to remove after old analytics records are cleared.
    jsonPath: { type: String, default: null },
    htmlPath: { type: String, default: null },
  },
  { timestamps: true }
);

analyticsSchema.index({ docId: 1, userId: 1 }, { unique: true });

module.exports = mongoose.model("Analytics", analyticsSchema);
