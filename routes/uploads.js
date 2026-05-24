const express = require("express");
const path = require("path");
const { requireLogin } = require("./middleware");

module.exports = function createUploadsRouter({ uploadDir }) {
  const router = express.Router();

  router.get("/:filename", requireLogin, (req, res) => {
    const filename = String(req.params.filename || "");
    if (!/^[a-zA-Z0-9._-]+$/.test(filename)) {
      return res.status(404).end();
    }

    res.setHeader("Cache-Control", "private, max-age=604800");
    return res.sendFile(path.join(uploadDir, filename));
  });

  return router;
};
