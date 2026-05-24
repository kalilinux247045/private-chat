const fs = require("fs");
const http = require("http");
const path = require("path");
const express = require("express");
const session = require("express-session");
const SQLiteStoreFactory = require("connect-sqlite3");
const { Server } = require("socket.io");
const createPagesRouter = require("./routes/pages");
const authRouter = require("./routes/auth");
const createMessagesRouter = require("./routes/messages");
const createUploadsRouter = require("./routes/uploads");
const registerChatSocket = require("./sockets/chatSocket");
const { ROOM_NAME } = require("./config");
const {
  initDatabase,
  cleanupExpiredMessages
} = require("./database/db");

const SQLiteStore = SQLiteStoreFactory(session);
const app = express();
const server = http.createServer(app);

const rootDir = __dirname;
const publicDir = path.join(rootDir, "public");
const stylesDir = path.join(rootDir, "styles");
const scriptsDir = path.join(rootDir, "scripts");
const uploadDir = path.join(rootDir, "uploads");
const databaseDir = path.join(rootDir, "database");

for (const dir of [publicDir, stylesDir, scriptsDir, uploadDir, databaseDir]) {
  fs.mkdirSync(dir, { recursive: true });
}

const sessionMiddleware = session({
  name: "privatechat.sid",
  secret: process.env.SESSION_SECRET || "PrivateChat-local-session-secret-2026-05-24",
  store: new SQLiteStore({
    db: "sessions.sqlite",
    dir: databaseDir
  }),
  resave: false,
  saveUninitialized: false,
  rolling: true,
  cookie: {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.COOKIE_SECURE === "true",
    maxAge: 7 * 24 * 60 * 60 * 1000
  }
});

const io = new Server(server, {
  maxHttpBufferSize: 2e6
});

app.disable("x-powered-by");
app.use((req, res, next) => {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Referrer-Policy", "same-origin");
  res.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
  next();
});
app.use(express.json({ limit: "1mb" }));
app.use(express.urlencoded({ extended: false }));
app.use(sessionMiddleware);

io.engine.use(sessionMiddleware);

app.use("/styles", express.static(stylesDir, { maxAge: "1h" }));
app.get("/scripts/login.js", (req, res) => {
  res.sendFile(path.join(scriptsDir, "login.js"));
});

app.use("/", createPagesRouter({
  loginPage: path.join(publicDir, "index.html"),
  usersPage: path.join(publicDir, "users.html"),
  chatPage: path.join(publicDir, "chat.html")
}));

app.use("/api", authRouter);
app.use("/api", createMessagesRouter({ uploadDir }));
app.use("/uploads", createUploadsRouter({ uploadDir }));
app.use("/scripts", (req, res, next) => {
  if (!req.session || !req.session.authenticated) {
    return res.status(401).end();
  }
  return next();
}, express.static(scriptsDir, { maxAge: "1h" }));

app.use((req, res) => {
  res.status(404).json({ error: "Not found" });
});

app.use((err, req, res, next) => {
  console.error(err);
  if (res.headersSent) return next(err);
  res.status(500).json({ error: "Server error" });
});

function removeExpiredUploadFiles(expiredMessages) {
  for (const message of expiredMessages) {
    if (!message.file_url || !message.file_url.startsWith("/uploads/")) continue;
    const filename = path.basename(message.file_url);
    const fullPath = path.join(uploadDir, filename);
    if (!fullPath.startsWith(uploadDir)) continue;
    fs.unlink(fullPath, () => {});
  }
}

function emitExpiredMessages(expiredMessages) {
  if (!expiredMessages.length) return;
  io.to(ROOM_NAME).emit("messages:expired", {
    ids: expiredMessages.map((message) => message.id)
  });
}

async function start() {
  await initDatabase();
  registerChatSocket(io, { uploadDir });

  const startupExpired = await cleanupExpiredMessages();
  removeExpiredUploadFiles(startupExpired);
  setInterval(async () => {
    try {
      const expired = await cleanupExpiredMessages();
      removeExpiredUploadFiles(expired);
      emitExpiredMessages(expired);
    } catch (err) {
      console.error("Expired message cleanup failed:", err.message);
    }
  }, 60 * 1000);

  const port = Number(process.env.PORT || 3000);
  server.listen(port, () => {
    console.log(`PrivateChat running at http://localhost:${port}`);
  });
}

start().catch((err) => {
  console.error("PrivateChat failed to start:", err);
  process.exit(1);
});
