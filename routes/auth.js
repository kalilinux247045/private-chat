const express = require("express");
const { LOGIN, USERS, isAllowedUser, getPartner } = require("../config");
const { requireLogin, requireSelectedUser, asyncRoute } = require("./middleware");
const { getPresenceSummary, getUserState } = require("../database/db");

const router = express.Router();

router.post("/login", (req, res) => {
  const username = String(req.body.username || "").trim();
  const password = String(req.body.password || "");

  if (username !== LOGIN.username || password !== LOGIN.password) {
    return res.status(401).json({ error: "Wrong username or password" });
  }

  req.session.regenerate((regenerateError) => {
    if (regenerateError) {
      return res.status(500).json({ error: "Could not create session" });
    }

    req.session.authenticated = true;
    req.session.loginAt = new Date().toISOString();
    req.session.selectedUser = null;

    req.session.save((saveError) => {
      if (saveError) {
        return res.status(500).json({ error: "Could not save session" });
      }
      return res.json({ ok: true, next: "/users" });
    });
  });
});

router.post("/logout", requireLogin, (req, res) => {
  req.session.destroy((err) => {
    if (err) {
      return res.status(500).json({ error: "Could not log out" });
    }
    res.clearCookie("privatechat.sid");
    return res.json({ ok: true, next: "/" });
  });
});

router.get("/session", asyncRoute(async (req, res) => {
  res.json({
    authenticated: Boolean(req.session && req.session.authenticated),
    selectedUser: req.session && isAllowedUser(req.session.selectedUser) ? req.session.selectedUser : null,
    users: req.session && req.session.authenticated ? USERS : []
  });
}));

router.post("/select-user", requireLogin, (req, res) => {
  const selectedUser = String(req.body.user || "").trim();
  if (!isAllowedUser(selectedUser)) {
    return res.status(400).json({ error: "Only Pratham and Sakshi are allowed" });
  }

  req.session.selectedUser = selectedUser;
  req.session.save((err) => {
    if (err) {
      return res.status(500).json({ error: "Could not select user" });
    }
    return res.json({ ok: true, user: selectedUser, next: "/chat" });
  });
});

router.get("/me", requireSelectedUser, asyncRoute(async (req, res) => {
  const user = req.session.selectedUser;
  const partner = getPartner(user);

  res.json({
    user,
    partner,
    users: USERS,
    selfState: await getUserState(user),
    partnerState: await getUserState(partner),
    presence: await getPresenceSummary()
  });
}));

module.exports = router;
