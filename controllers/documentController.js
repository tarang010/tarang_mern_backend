// Tarang 1.0.0.1 — controllers/documentController.js
// TWO-PHASE PIPELINE:
//   Phase 1 (/pipeline/audio)  — called on upload → shows player immediately
//   Phase 2 (/pipeline/mcq)    — called when user clicks Play → MCQs generated in background
//
// Fix for large file 502 timeout:
//   The bridge call now runs in the background via setImmediate.
//   Express responds with 202 Accepted immediately, frontend polls pipelineStatus.
//   pipelineStatus: "processing" → "audio_ready" → "ready"

const Document = require("../models/Document");
const Session  = require("../models/Session");
const { bridge }                          = require("../config/bridge");
const { uploadAudioBuffer, isConfigured } = require("../config/cloudinary");

// ── POST /api/documents/upload ────────────────────────────────────────────────
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

  const crypto   = require("crypto");
  const tempDocId = crypto
    .createHash("md5")
    .update(req.file.originalname + req.user._id + Date.now())
    .digest("hex")
    .slice(0, 12);

  // ── Save document immediately with status "processing" ────────────────────
  // Frontend redirects to /listen/:docId right away.
  // Audio player shows a loading state until status becomes "audio_ready".
  const doc = await Document.findOneAndUpdate(
    { docId: tempDocId, userId: req.user._id },
    {
      $set: {
        userId:           req.user._id,
        docId:            tempDocId,
        title:            documentTitle,
        originalFilename: req.file.originalname,
        format:           req.file.originalname.split(".").pop().toLowerCase(),
        cognitiveState,
        ttsEngine,
        pipelineStatus:   "processing",
        pipelineError:    null,
        sessionsGenerated: 0,
      }
    },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  );

  console.log(`→ Upload received | docId=${tempDocId} | file=${req.file.originalname} | size=${req.file.size} bytes`);

  // ── Respond immediately with 202 — pipeline runs in background ───────────
  res.status(202).json({
    status: "success",
    data: {
      document: doc,
      phase:    "processing",
      message:  "Upload received. Processing audio in background.",
    },
  });

  // ── Run Phase 1 pipeline in background ────────────────────────────────────
  const fileBuffer    = req.file.buffer;
  const fileOrigName  = req.file.originalname;
  const fileMimetype  = req.file.mimetype;
  const userId        = req.user._id;
  const userRole      = req.user.role;

  setImmediate(async () => {
    try {
      console.log(`→ Background Phase 1 START | docId=${tempDocId}`);

      const FormData = require("form-data");
      const form     = new FormData();
      form.append("file", fileBuffer, {
        filename:    fileOrigName,
        contentType: fileMimetype,
      });
      form.append("cognitive_state", cognitiveState);
      form.append("document_title",  documentTitle);
      form.append("tts_engine",      ttsEngine);
      form.append("role",            userRole);
      if (voiceId) form.append("voice_id", voiceId);

      console.log(`→ Calling bridge /pipeline/audio | docId=${tempDocId}`);
      const { data: bridgeRes } = await bridge.post("/pipeline/audio", form, {
        headers:          form.getHeaders(),
        maxContentLength: Infinity,
        maxBodyLength:    Infinity,
        timeout:          600000, // 10 min for very large files
      });

      const pd = bridgeRes.data;
      console.log(`✓ Bridge response received | docId=${tempDocId} | words=${pd.word_count} | duration=${pd.duration_sec}s`);

      // ── Upload audio to Cloudinary ────────────────────────────────────────
      let audioCloudUrl = null;
      let audioPublicId = null;

      if (isConfigured() && pd.mp3_b64) {
        try {
          console.log(`→ Uploading audio to Cloudinary | docId=${tempDocId} | b64_len=${pd.mp3_b64.length}`);
          const mp3Buffer = Buffer.from(pd.mp3_b64, "base64");
          const uploaded  = await uploadAudioBuffer(mp3Buffer, {
            folder:        `tarang/audio/${userId}`,
            publicId:      `${tempDocId}_modulated`,
            resource_type: "video",
          });
          audioCloudUrl = uploaded.url;
          audioPublicId = uploaded.publicId;
          console.log(`✓ Cloudinary upload OK | docId=${tempDocId} | url=${audioCloudUrl}`);
        } catch (e) {
          console.error(`✗ Cloudinary upload failed (non-fatal) | docId=${tempDocId} |`, e.message);
        }
      }

      // ── Update document with Phase 1 results ─────────────────────────────
      await Document.findOneAndUpdate(
        { docId: tempDocId, userId },
        {
          $set: {
            title:               pd.document_title || documentTitle,
            wordCount:           pd.word_count,
            durationSec:         pd.duration_sec,
            extractedText:       pd.extracted_text,
            beatFreqHz:          pd.beat_freq_hz,
            pipelineStatus:      "audio_ready",
            pipelineError:       null,
            audioCloudUrl,
            audioPublicId,
            captions:            pd.captions?.length ? pd.captions : null,
            captionsGeneratedAt: pd.captions?.length ? new Date() : null,
            extractedPath:       null,
            ttsWavPath:          null,
            modulatedWavPath:    null,
            visualizationPath:   null,
          }
        }
      );

      console.log(`✓ Phase 1 complete | docId=${tempDocId} | status=audio_ready`);

    } catch (err) {
      console.error(`✗ Phase 1 FAILED | docId=${tempDocId} |`, err.message);
      await Document.findOneAndUpdate(
        { docId: tempDocId, userId: req.user._id },
        {
          $set: {
            pipelineStatus: "error",
            pipelineError:  err.message || "Pipeline failed",
          }
        }
      );
    }
  });
};


// ── POST /api/documents/:docId/trigger-mcq ────────────────────────────────────
const triggerMCQ = async (req, res) => {
  const { docId } = req.params;

  const doc = await Document.findOne({ docId, userId: req.user._id });
  if (!doc) {
    return res.status(404).json({ status: "error", error: "Document not found." });
  }

  const existingSessions = await Session.countDocuments({ docId, userId: req.user._id });
  if (existingSessions >= 3) {
    return res.json({ status: "success", data: { message: "MCQ already generated." } });
  }

  if (!doc.extractedText || doc.extractedText.split(" ").length < 50) {
    return res.json({ status: "success", data: { message: "Document too short for MCQ." } });
  }

  res.json({
    status: "success",
    data: { message: "MCQ generation started in background." },
  });

  setImmediate(async () => {
    try {
      console.log(`→ Background MCQ START | docId=${docId}`);

      const { data: mcqRes } = await bridge.post("/pipeline/mcq", {
        extracted_text: doc.extractedText,
        document_title: doc.title,
        doc_id:         docId,
      });

      const md           = mcqRes.data;
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
              questions:     qData?.questions || [],
              answerKey:     aData            || null,
              sessionState:  md.session_state || null,
            }
          },
          { upsert: true, new: true, setDefaultsOnInsert: true }
        );
      }

      await Document.findOneAndUpdate(
        { docId },
        { $set: { sessionsGenerated: md.sessions_generated, pipelineStatus: "ready" } }
      );

      console.log(`✓ Background MCQ complete | docId=${docId} | sessions=3`);
    } catch (err) {
      console.error(`✗ Background MCQ FAILED | docId=${docId} |`, err.message);
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
      data: { captions: doc.captions, total: doc.captions.length, cached: true, generatedAt: doc.captionsGeneratedAt },
    });
  }
  if (!doc.extractedText || !doc.durationSec) {
    return res.status(404).json({ status: "error", error: "Captions not available." });
  }
  const { data } = await bridge.post("/captions", { text: doc.extractedText, duration_sec: doc.durationSec });
  const result   = data.data;
  await Document.findOneAndUpdate({ docId }, { captions: result.captions, captionsGeneratedAt: new Date() });
  res.json({ status: "success", data: { captions: result.captions, total: result.total_segments, cached: false } });
};

// ── GET /api/documents/:docId/visualization ───────────────────────────────────
const getVisualization = async (req, res) => {
  const { docId } = req.params;
  const doc = await Document.findOne({ docId, userId: req.user._id }).select("visualizationHtml visualizationType title");
  if (!doc) return res.status(404).json({ status: "error", error: "Document not found." });
  if (!doc.visualizationHtml) return res.status(404).json({ status: "error", error: "Visualization not available." });
  res.setHeader("Content-Type", "text/html");
  res.send(doc.visualizationHtml);
};

module.exports = {
  uploadDocument, triggerMCQ,
  getDocuments, getDocument, deleteDocument,
  getCaptions, getVisualization,
};

// NOTE: getDocumentByDocId is appended here — move it above module.exports in your file

// ── GET /api/documents/by-doc-id/:docId ──────────────────────────────────────
// Used by frontend polling to check pipelineStatus during background processing
const getDocumentByDocId = async (req, res) => {
  const { docId } = req.params;
  const doc = await Document.findOne({ docId, userId: req.user._id });
  if (!doc) {
    return res.status(404).json({ status: "error", error: "Document not found." });
  }
  res.json({ status: "success", data: { document: doc } });
};
