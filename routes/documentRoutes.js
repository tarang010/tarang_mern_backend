// Tarang 1.0.0.1 — routes/documentRoutes.js

const express = require("express");
const multer  = require("multer");
const path    = require("path");
const router  = express.Router();
const { protect } = require("../middleware/auth");
const {
  uploadDocument, triggerMCQ,
  getDocuments, getDocument, deleteDocument,
  getCaptions, getVisualization,
} = require("../controllers/documentController");

// ── Multer — memoryStorage (no disk writes, works on Render) ──────────────────
const storage = multer.memoryStorage();

const fileFilter = (req, file, cb) => {
  const allowed = [".pdf", ".docx", ".txt", ".md"];
  const ext     = path.extname(file.originalname).toLowerCase();
  if (allowed.includes(ext)) cb(null, true);
  else cb(new Error(`Unsupported file type: ${ext}. Allowed: ${allowed.join(", ")}`), false);
};

const upload = multer({
  storage,
  fileFilter,
  limits: { fileSize: (parseInt(process.env.MAX_FILE_SIZE_MB) || 50) * 1024 * 1024 },
});

// ── Routes ────────────────────────────────────────────────────────────────────
router.post(  "/upload",               protect, upload.single("file"), uploadDocument);
router.get(   "/",                     protect, getDocuments);
router.get(   "/:id",                  protect, getDocument);
router.delete("/:id",                  protect, deleteDocument);
router.post(  "/:docId/trigger-mcq",   protect, triggerMCQ);
router.get(   "/:docId/captions",      protect, getCaptions);
router.get(   "/:docId/visualization", protect, getVisualization);

module.exports = router;
