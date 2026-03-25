// Tarang 1.0.0.2 — models/Session.js
// Improved schema with stricter typing & future-proof structure

const mongoose = require("mongoose");

const { Schema } = mongoose;

/**
 * Sub-schema: Question
 * Keeps structure consistent instead of using Mixed
 */
const questionSchema = new Schema(
  {
    question: { type: String, required: true },
    options:  [{ type: String, required: true }],
    correctAnswer: { type: Number, required: true }, // index of correct option
    explanation: { type: String, default: null },
  },
  { _id: false }
);

/**
 * Sub-schema: Session State (Bridge State)
 * You can expand this safely later
 */
const sessionStateSchema = new Schema(
  {
    currentStep: { type: String, default: null },
    progress:    { type: Number, default: 0 },
    weakTopics:  [{ type: String }],
    metadata:    { type: Schema.Types.Mixed, default: {} }, // controlled flexibility
  },
  { _id: false }
);

const sessionSchema = new Schema(
  {
    userId: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },

    documentId: {
      type: Schema.Types.ObjectId,
      ref: "Document",
      required: true,
      index: true,
    },

    docId: {
      type: String,
      required: true,
      index: true,
      trim: true,
    },

    sessionNumber: {
      type: Number,
      required: true,
      enum: [1, 2, 3],
    },

    difficulty: {
      type: String,
      enum: ["Easy", "Medium", "Hard"],
      default: "Medium",
    },

    // ── Status ─────────────────────────────────────────────
    status: {
      type: String,
      enum: ["pending", "locked", "available", "in_progress", "completed"],
      default: "locked",
      index: true,
    },

    startedAt: {
      type: Date,
      default: null,
    },

    submittedAt: {
      type: Date,
      default: null,
    },

    // ── Scoring ────────────────────────────────────────────
    scorePct: {
      type: Number,
      min: 0,
      max: 100,
      default: null,
    },

    correctCount: {
      type: Number,
      min: 0,
      default: 0,
    },

    totalQuestions: {
      type: Number,
      min: 1,
      default: 10,
    },

    // ── User Answers ───────────────────────────────────────
    userAnswers: {
      type: Map,
      of: Number, // questionIndex -> selectedOption
      default: {},
    },

    overrideUsed: {
      type: Boolean,
      default: false,
    },

    // ── MCQ Data ───────────────────────────────────────────
    questions: {
      type: [questionSchema],
      default: [],
    },

    answerKey: {
      type: [Number], // correct answers index array
      default: [],
    },

    // ── Session State (Bridge-safe) ────────────────────────
    sessionState: {
      type: sessionStateSchema,
      default: null,
    },
  },
  {
    timestamps: true,
  }
);

// ── Compound Index (critical for uniqueness) ───────────────
sessionSchema.index(
  { docId: 1, userId: 1, sessionNumber: 1 },
  { unique: true }
);

// ── Optional: Auto-calc score safeguard ────────────────────
sessionSchema.pre("save", function (next) {
  if (
    this.correctCount !== null &&
    this.totalQuestions > 0
  ) {
    this.scorePct = Math.round(
      (this.correctCount / this.totalQuestions) * 100
    );
  }
  next();
});

module.exports = mongoose.model("Session", sessionSchema);