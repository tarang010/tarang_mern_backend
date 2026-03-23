// Tarang 1.0.0.1 — controllers/documentController.js
// TWO-PHASE PIPELINE:
//   Phase 1 (/pipeline/audio)  — called on upload → shows player immediately
//   Phase 2 (/pipeline/mcq)    — called when user clicks Play → MCQs generated in background

const Document = require("../models/Document");
const Session  = require("../models/Session");
const { bridge }                    = require("../config/bridge");
const { uploadAudioBuffer, isConfigured } = require("../config/cloudinary");

// ── POST /api/documents/upload ────────────────────────────────────────────────
// PHASE 1 only: Extract → TTS → Modulate → Captions → Cloudinary → MongoDB
// Returns to frontend as soon as audio is ready. MCQ not generated yet.
const uploadDocument = async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ status: "error", error: "No file uploaded." });
  }

  const {
    cognitiveState = "deep_focus",
    documentTitle  = req.file.originalname.replace(/\.[^.]+$/, ""),
    ttsEngine      = "edge",
    voiceId        = "",
  } = req.body;

  // ── Call Phase 1 bridge endpoint ─────────────────────────────────────────
  const FormData = require("form-data");
  const form     = new FormData();
  form.append("file",            req.file.buffer, {
    filename:    req.file.originalname,
    contentType: req.file.mimetype,
  });
  form.append("cognitive_state", cognitiveState);
  form.append("document_title",  documentTitle);
  form.append("tts_engine",      ttsEngine);
  form.append("role",            req.user.role);
  if (voiceId) form.append("voice_id", voiceId);

  const { data: bridgeRes } = await bridge.post("/pipeline/audio", form, {
    headers:          form.getHeaders(),
    maxContentLength: Infinity,
    maxBodyLength:    Infinity,
  });

  const pd = bridgeRes.data;

  // ── Upload MP3 to Cloudinary ──────────────────────────────────────────────
  let audioCloudUrl = null;
  let audioPublicId = null;

  if (isConfigured() && pd.mp3_b64) {
    try {
      const mp3Buffer = Buffer.from(pd.mp3_b64, "base64");

      // Generate a stable doc_id from content hash (used before MCQ assigns one)
      const crypto  = require("crypto");
      const stableId = crypto
        .createHash("md5")
        .update(pd.extracted_text.slice(0, 500) + Date.now())
        .digest("hex")
        .slice(0, 12);

      const uploaded = await uploadAudioBuffer(mp3Buffer, {
        folder:        `tarang/audio/${req.user._id}`,
        publicId:      `${stableId}_modulated`,
        resource_type: "video",
      });
      audioCloudUrl = uploaded.url;
      audioPublicId = uploaded.publicId;
      console.log(`✓ Audio uploaded to Cloudinary: ${audioCloudUrl}`);

      // Store stable doc_id on pd so we can use it below
      pd._stableId = stableId;
    } catch (e) {
      console.error("Cloudinary upload failed (non-fatal):", e.message);
    }
  }

  // ── Save Document to MongoDB (Phase 1 data only) ──────────────────────────
  // docId will be updated in Phase 2 when MCQ assigns the real doc_id.
  // We use a temp stable ID derived from content hash.
  const tempDocId = pd._stableId || require("crypto")
    .createHash("md5")
    .update((pd.extracted_text || "").slice(0, 500) + Date.now())
    .digest("hex")
    .slice(0, 12);

  const doc = await Document.findOneAndUpdate(
    { docId: tempDocId, userId: req.user._id },
    {
      $set: {
        userId:              req.user._id,
        docId:               tempDocId,
        title:               pd.document_title || documentTitle,
        originalFilename:    req.file.originalname,
        format:              req.file.originalname.split(".").pop().toLowerCase(),
        wordCount:           pd.word_count,
        durationSec:         pd.duration_sec,
        extractedText:       pd.extracted_text,
        cognitiveState,
        beatFreqHz:          pd.beat_freq_hz,
        ttsEngine,
        sessionsGenerated:   0,           // MCQ not done yet
        pipelineStatus:      "audio_ready", // custom status — MCQ pending
        pipelineError:       null,
        audioCloudUrl,
        audioPublicId,
        captions:            pd.captions?.length ? pd.captions : null,
        captionsGeneratedAt: pd.captions?.length ? new Date() : null,
        visualizationHtml:   null,
        visualizationType:   null,
        extractedPath:       null,
        ttsWavPath:          null,
        modulatedWavPath:    null,
        visualizationPath:   null,
      }
    },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  );

  console.log(`✓ Phase 1 complete | docId=${tempDocId} | MCQ pending (fires on Play)`);

  // Return immediately — frontend shows the player
  res.status(201).json({
    status: "success",
    data: {
      document: doc,
      phase:    "audio_ready",
      message:  "Audio ready. MCQ will be generated when user clicks Play.",
    },
  });
};


// ── POST /api/documents/:docId/trigger-mcq ────────────────────────────────────
// Called by Express when the frontend fires "user clicked Play".
// Runs MCQ generation in background — does NOT block the response.
// Frontend polls /api/sessions/:docId/status to know when MCQs are ready.
const triggerMCQ = async (req, res) => {
  const { docId } = req.params;

  const doc = await Document.findOne({ docId, userId: req.user._id });
  if (!doc) {
    return res.status(404).json({ status: "error", error: "Document not found." });
  }

  // Already has MCQ sessions — don't regenerate
  const existingSessions = await Session.countDocuments({ docId, userId: req.user._id });
  if (existingSessions >= 3) {
    return res.json({ status: "success", data: { message: "MCQ already generated." } });
  }

  // Not enough text to generate meaningful MCQs
  if (!doc.extractedText || doc.extractedText.split(" ").length < 50) {
    return res.json({ status: "success", data: { message: "Document too short for MCQ." } });
  }

  // Respond immediately — MCQ runs in background
  res.json({
    status: "success",
    data: { message: "MCQ generation started in background." },
  });

  // ── Fire MCQ generation asynchronously ───────────────────────────────────
  setImmediate(async () => {
    try {
      console.log(`→ Background MCQ generation started | docId=${docId}`);

      const { data: mcqRes } = await bridge.post("/pipeline/mcq", {
        extracted_text: doc.extractedText,
        document_title: doc.title,
        doc_id:         docId,
      });

      const md = mcqRes.data;
      const difficulties = { 1: "Easy", 2: "Medium", 3: "Hard" };

      for (const n of [1, 2, 3]) {
        const qData = md[`session_${n}_questions`];
        const aData = md[`session_${n}_answers`];

        await Session.findOneAndUpdate(
          { docId, userId: req.user._id, sessionNumber: n },
          {
            $set: {
              userId:        req.user._id,
              documentId:    doc._id,
              docId,
              sessionNumber: n,
              difficulty:    difficulties[n],
              status:        n === 1 ? "pending" : "locked",
              startedAt:     null,
              submittedAt:   null,
              scorePct:      null,
              correctCount:  0,
              userAnswers:   {},
              overrideUsed:  false,
              questions:     qData?.questions   || [],
              answerKey:     aData              || null,
              sessionState:  md.session_state   || null,
            }
          },
          { upsert: true, new: true, setDefaultsOnInsert: true }
        );
      }

      // Update document to reflect MCQ is ready
      await Document.findOneAndUpdate(
        { docId },
        {
          $set: {
            sessionsGenerated: md.sessions_generated,
            pipelineStatus:    "ready",
          }
        }
      );

      console.log(`✓ Background MCQ complete | docId=${docId} | 3 sessions stored`);
    } catch (err) {
      console.error(`✗ Background MCQ failed | docId=${docId} |`, err.message);
      await Document.findOneAndUpdate(
        { docId },
        { $set: { pipelineError: `MCQ generation failed: ${err.message}` } }
      );
    }
  });
};


// ── GET /api/documents ────────────────────────────────────────────────────────
const getDocuments = async (req, res) => {
  const docs = await Document.find({ userId: req.user._id })
    .sort({ createdAt: -1 })
    .select("-extractedText -visualizationHtml -captions");

  res.json({ status: "success", data: { documents: docs } });
};

// ── GET /api/documents/:id ────────────────────────────────────────────────────
const getDocument = async (req, res) => {
  const doc = await Document.findOne({ _id: req.params.id, userId: req.user._id });
  if (!doc) {
    return res.status(404).json({ status: "error", error: "Document not found." });
  }
  res.json({ status: "success", data: { document: doc } });
};

// ── DELETE /api/documents/:id ─────────────────────────────────────────────────
const deleteDocument = async (req, res) => {
  const doc = await Document.findOne({ _id: req.params.id, userId: req.user._id });
  if (!doc) {
    return res.status(404).json({ status: "error", error: "Document not found." });
  }

  if (doc.audioPublicId && isConfigured()) {
    try {
      const { deleteAudio } = require("../config/cloudinary");
      await deleteAudio(doc.audioPublicId);
    } catch (e) {
      console.error("Cloudinary delete failed (non-fatal):", e.message);
    }
  }

  await Session.deleteMany({ documentId: doc._id });
  await doc.deleteOne();

  res.json({ status: "success", data: { message: "Document deleted." } });
};

// ── GET /api/documents/:docId/captions ───────────────────────────────────────
const getCaptions = async (req, res) => {
  const { docId } = req.params;

  const doc = await Document.findOne({ docId, userId: req.user._id });
  if (!doc) {
    return res.status(404).json({ status: "error", error: "Document not found." });
  }

  if (doc.captions && doc.captions.length > 0) {
    return res.json({
      status: "success",
      data: {
        captions:    doc.captions,
        total:       doc.captions.length,
        cached:      true,
        generatedAt: doc.captionsGeneratedAt,
      },
    });
  }

  // Fallback on-demand for old docs
  if (!doc.extractedText || !doc.durationSec) {
    return res.status(404).json({ status: "error", error: "Captions not available." });
  }

  const { data } = await bridge.post("/captions", {
    text:         doc.extractedText,
    duration_sec: doc.durationSec,
  });
  const result = data.data;

  await Document.findOneAndUpdate(
    { docId },
    { captions: result.captions, captionsGeneratedAt: new Date() }
  );

  res.json({
    status: "success",
    data: { captions: result.captions, total: result.total_segments, cached: false },
  });
};

// ── GET /api/documents/:docId/visualization ───────────────────────────────────
const getVisualization = async (req, res) => {
  const { docId } = req.params;

  const doc = await Document.findOne({ docId, userId: req.user._id })
    .select("visualizationHtml visualizationType title");

  if (!doc) {
    return res.status(404).json({ status: "error", error: "Document not found." });
  }

  if (!doc.visualizationHtml) {
    return res.status(404).json({ status: "error", error: "Visualization not available." });
  }

  res.setHeader("Content-Type", "text/html");
  res.send(doc.visualizationHtml);
};

module.exports = {
  uploadDocument, triggerMCQ,
  getDocuments, getDocument, deleteDocument,
  getCaptions, getVisualization,
};
