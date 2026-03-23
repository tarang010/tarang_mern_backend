// Tarang 1.0.0.1 — routes/documentRoutes.js
const express  = require("express");
const multer   = require("multer");
const { protect } = require("../middleware/authMiddleware");
const {
  uploadDocument,
  triggerMCQ,
  getDocuments,
  getDocument,
  deleteDocument,
  getCaptions,
  getVisualization,
  getDocumentByDocId,
} = require("../controllers/documentController");

const router  = express.Router();
const storage = multer.memoryStorage();
const upload  = multer({
  storage,
  limits: { fileSize: 50 * 1024 * 1024 }, // 50MB
  fileFilter: (req, file, cb) => {
    const allowed = ["application/pdf",
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      "text/plain", "text/markdown"];
    cb(null, allowed.includes(file.mimetype) || true); // allow all, validate in controller
  },
});

// ── Document CRUD ─────────────────────────────────────────────────────────────
router.get   ("/",                    protect, getDocuments);
router.post  ("/upload",              protect, upload.single("file"), uploadDocument);
router.get   ("/:id",                 protect, getDocument);
router.delete("/:id",                 protect, deleteDocument);

// ── Pipeline triggers ─────────────────────────────────────────────────────────
router.post  ("/:docId/trigger-mcq",  protect, triggerMCQ);

// ── Data endpoints ────────────────────────────────────────────────────────────
router.get   ("/:docId/captions",     protect, getCaptions);
router.get   ("/:docId/visualization",protect, getVisualization);

// ── Poll endpoint — used by frontend to check pipelineStatus ─────────────────
router.get   ("/by-doc-id/:docId",    protect, getDocumentByDocId);

module.exports = router;
