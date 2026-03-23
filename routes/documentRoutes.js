// Tarang 1.0.0.1 — routes/documentRoutes.js

const express = require("express");
const multer  = require("multer");
const path    = require("path");
const router  = express.Router();
const { protect } = require("../middleware/auth");
const {
  uploadDocument, getDocuments, getDocument, deleteDocument, getCaptions,
} = require("../controllers/documentController");

// Multer — accept only supported formats, max 50MB
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    // Use /tmp on Render (ephemeral) — file sent to Python bridge immediately and then deleted
    const uploadDir = process.env.NODE_ENV === "production"
      ? require("os").tmpdir()
      : path.join(__dirname, "../../../storage/uploads");
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    const unique = `${Date.now()}_${Math.round(Math.random() * 1e9)}`;
    cb(null, `${unique}_${file.originalname}`);
  },
});

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

router.post(  "/upload",  protect, upload.single("file"), uploadDocument);
router.get(   "/",        protect, getDocuments);
router.get(   "/:id",     protect, getDocument);
router.delete("/:id",             protect, deleteDocument);
router.get(  "/:docId/captions",  protect, getCaptions);

module.exports = router;
