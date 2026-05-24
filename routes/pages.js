const express = require("express");
const { requireLogin, requireSelectedUser } = require("./middleware");

module.exports = function createPagesRouter(paths) {
  const router = express.Router();

  router.get("/", (req, res) => {
    if (req.session && req.session.authenticated && req.session.selectedUser) {
      return res.redirect("/chat");
    }

    if (req.session && req.session.authenticated) {
      return res.redirect("/users");
    }

    return res.sendFile(paths.loginPage);
  });

  router.get("/users", requireLogin, (req, res) => {
    res.sendFile(paths.usersPage);
  });

  router.get("/chat", requireSelectedUser, (req, res) => {
    res.sendFile(paths.chatPage);
  });

  router.get("/health", (req, res) => {
    res.json({ ok: true, name: "PrivateChat" });
  });

  return router;
};
