const { isAllowedUser } = require("../config");

function wantsHtml(req) {
  const accepted = req.accepts(["html", "json"]);
  return accepted === "html";
}

function requireLogin(req, res, next) {
  if (req.session && req.session.authenticated) {
    return next();
  }

  if (wantsHtml(req)) {
    return res.redirect("/");
  }

  return res.status(401).json({ error: "Login required" });
}

function requireSelectedUser(req, res, next) {
  if (!req.session || !req.session.authenticated) {
    if (wantsHtml(req)) return res.redirect("/");
    return res.status(401).json({ error: "Login required" });
  }

  if (!isAllowedUser(req.session.selectedUser)) {
    if (wantsHtml(req)) return res.redirect("/users");
    return res.status(403).json({ error: "Choose Pratham or Sakshi first" });
  }

  return next();
}

function asyncRoute(handler) {
  return (req, res, next) => {
    Promise.resolve(handler(req, res, next)).catch(next);
  };
}

module.exports = {
  requireLogin,
  requireSelectedUser,
  asyncRoute
};
