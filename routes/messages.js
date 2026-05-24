const crypto = require("crypto");
const express = require("express");
const multer = require("multer");
const path = require("path");
const { requireSelectedUser, asyncRoute } = require("./middleware");
const {
  listMessagesForUser,
  getPresenceSummary
} = require("../database/db");

const ALLOWED_MIME_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/gif",
  "image/webp",
  "video/mp4",
  "video/webm",
  "video/quicktime"
]);

function safeUploadName(originalName) {
  const extension = path.extname(originalName || "").toLowerCase().replace(/[^a-z0-9.]/g, "");
  return `${Date.now()}-${crypto.randomBytes(12).toString("hex")}${extension}`;
}

module.exports = function createMessagesRouter({ uploadDir }) {
  const router = express.Router();

  const storage = multer.diskStorage({
    destination: uploadDir,
    filename(req, file, callback) {
      callback(null, safeUploadName(file.originalname));
    }
  });

  const upload = multer({
    storage,
    limits: {
      fileSize: 35 * 1024 * 1024,
      files: 1
    },
    fileFilter(req, file, callback) {
      if (!ALLOWED_MIME_TYPES.has(file.mimetype)) {
        callback(new Error("Only images and videos are allowed"));
        return;
      }
      callback(null, true);
    }
  });

  router.get("/messages", requireSelectedUser, asyncRoute(async (req, res) => {
    const messages = await listMessagesForUser(req.session.selectedUser);
    res.json({
      messages,
      statuses: [],
      presence: await getPresenceSummary()
    });
  }));

  router.post("/upload", requireSelectedUser, (req, res) => {
    upload.single("media")(req, res, (err) => {
      if (err) {
        return res.status(400).json({ error: err.message || "Upload failed" });
      }

      if (!req.file) {
        return res.status(400).json({ error: "Choose an image or video first" });
      }

      const type = req.file.mimetype.startsWith("video/") ? "video" : "image";
      return res.json({
        ok: true,
        type,
        fileUrl: `/uploads/${req.file.filename}`,
        fileName: req.file.originalname,
        mimeType: req.file.mimetype
      });
    });
  });

  return router;
};
