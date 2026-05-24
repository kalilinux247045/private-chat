const fs = require("fs");
const path = require("path");
const sqlite3 = require("sqlite3").verbose();
const { USERS, getPartner } = require("../config");

const databaseDir = __dirname;
fs.mkdirSync(databaseDir, { recursive: true });

const databasePath = path.join(databaseDir, "privatechat.sqlite");
const db = new sqlite3.Database(databasePath);
db.configure("busyTimeout", 5000);

function nowISO() {
  return new Date().toISOString();
}

function placeholders(values) {
  return values.map(() => "?").join(",");
}

function run(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function onRun(err) {
      if (err) {
        reject(err);
        return;
      }
      resolve({ id: this.lastID, changes: this.changes });
    });
  });
}

function get(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => {
      if (err) {
        reject(err);
        return;
      }
      resolve(row);
    });
  });
}

function all(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => {
      if (err) {
        reject(err);
        return;
      }
      resolve(rows);
    });
  });
}

async function initDatabase() {
  await run("PRAGMA foreign_keys = ON");

  await run(`
    CREATE TABLE IF NOT EXISTS messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      sender TEXT NOT NULL,
      receiver TEXT NOT NULL,
      type TEXT NOT NULL DEFAULT 'text',
      body TEXT NOT NULL DEFAULT '',
      file_url TEXT,
      file_name TEXT,
      mime_type TEXT,
      reply_to_id INTEGER,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      edited_at TEXT,
      deleted_at TEXT,
      delivered_at TEXT,
      seen_at TEXT,
      disappearing INTEGER NOT NULL DEFAULT 0,
      expires_at TEXT,
      saved_by TEXT NOT NULL DEFAULT '[]',
      FOREIGN KEY (reply_to_id) REFERENCES messages(id) ON DELETE SET NULL
    )
  `);

  await run(`
    CREATE TABLE IF NOT EXISTS reactions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      message_id INTEGER NOT NULL,
      user TEXT NOT NULL,
      emoji TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE(message_id, user),
      FOREIGN KEY (message_id) REFERENCES messages(id) ON DELETE CASCADE
    )
  `);

  await run(`
    CREATE TABLE IF NOT EXISTS user_state (
      user TEXT PRIMARY KEY,
      online INTEGER NOT NULL DEFAULT 0,
      last_seen TEXT,
      updated_at TEXT NOT NULL
    )
  `);

  await run("CREATE INDEX IF NOT EXISTS idx_messages_pair_time ON messages(sender, receiver, created_at)");
  await run("CREATE INDEX IF NOT EXISTS idx_messages_receiver_status ON messages(receiver, delivered_at, seen_at)");
  await run("CREATE INDEX IF NOT EXISTS idx_messages_expires_at ON messages(expires_at)");
  await run("CREATE INDEX IF NOT EXISTS idx_reactions_message_id ON reactions(message_id)");

  const timestamp = nowISO();
  for (const user of USERS) {
    await run(
      "INSERT OR IGNORE INTO user_state (user, online, last_seen, updated_at) VALUES (?, 0, NULL, ?)",
      [user, timestamp]
    );
  }

  await run("UPDATE user_state SET online = 0, updated_at = ?", [timestamp]);
}

function parseSavedBy(value) {
  try {
    const parsed = JSON.parse(value || "[]");
    return Array.isArray(parsed) ? parsed.filter((user) => USERS.includes(user)) : [];
  } catch {
    return [];
  }
}

function summarizeMessage(message) {
  if (!message) return null;
  if (message.deletedAt) {
    return {
      id: message.id,
      sender: message.sender,
      type: "deleted",
      body: "Message deleted"
    };
  }

  if (message.type === "image") {
    return {
      id: message.id,
      sender: message.sender,
      type: message.type,
      body: "Photo"
    };
  }

  if (message.type === "video") {
    return {
      id: message.id,
      sender: message.sender,
      type: message.type,
      body: "Video"
    };
  }

  return {
    id: message.id,
    sender: message.sender,
    type: message.type,
    body: (message.body || "").slice(0, 140)
  };
}

function formatMessage(row, reactions = []) {
  const deleted = Boolean(row.deleted_at);
  return {
    id: row.id,
    sender: row.sender,
    receiver: row.receiver,
    type: deleted ? "deleted" : row.type,
    body: deleted ? "" : row.body,
    fileUrl: deleted ? null : row.file_url,
    fileName: deleted ? null : row.file_name,
    mimeType: deleted ? null : row.mime_type,
    replyToId: row.reply_to_id,
    replyTo: null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    editedAt: row.edited_at,
    deletedAt: row.deleted_at,
    deliveredAt: row.delivered_at,
    seenAt: row.seen_at,
    disappearing: Boolean(row.disappearing),
    expiresAt: row.expires_at,
    savedBy: parseSavedBy(row.saved_by),
    reactions: reactions.map((reaction) => ({
      user: reaction.user,
      emoji: reaction.emoji,
      createdAt: reaction.created_at,
      updatedAt: reaction.updated_at
    }))
  };
}

async function attachReactionsAndReplies(rows) {
  if (!rows.length) return [];

  const ids = rows.map((row) => row.id);
  const reactionRows = await all(
    `SELECT message_id, user, emoji, created_at, updated_at
     FROM reactions
     WHERE message_id IN (${placeholders(ids)})
     ORDER BY created_at ASC`,
    ids
  );

  const reactionsByMessage = new Map();
  for (const reaction of reactionRows) {
    if (!reactionsByMessage.has(reaction.message_id)) {
      reactionsByMessage.set(reaction.message_id, []);
    }
    reactionsByMessage.get(reaction.message_id).push(reaction);
  }

  const formatted = rows.map((row) => formatMessage(row, reactionsByMessage.get(row.id) || []));
  const byId = new Map(formatted.map((message) => [message.id, message]));

  for (const message of formatted) {
    if (message.replyToId && byId.has(message.replyToId)) {
      message.replyTo = summarizeMessage(byId.get(message.replyToId));
    }
  }

  return formatted;
}

async function cleanupExpiredMessages() {
  const timestamp = nowISO();
  const expired = await all(
    "SELECT id, file_url FROM messages WHERE expires_at IS NOT NULL AND expires_at <= ?",
    [timestamp]
  );

  if (!expired.length) return [];

  const ids = expired.map((message) => message.id);
  await run(`DELETE FROM reactions WHERE message_id IN (${placeholders(ids)})`, ids);
  await run(`DELETE FROM messages WHERE id IN (${placeholders(ids)})`, ids);
  return expired;
}

async function listMessagesForUser(user) {
  const partner = getPartner(user);
  const timestamp = nowISO();
  const rows = await all(
    `SELECT *
     FROM messages
     WHERE ((sender = ? AND receiver = ?) OR (sender = ? AND receiver = ?))
       AND (expires_at IS NULL OR expires_at > ?)
     ORDER BY created_at ASC, id ASC`,
    [user, partner, partner, user, timestamp]
  );

  return attachReactionsAndReplies(rows);
}

async function getMessageById(id) {
  const timestamp = nowISO();
  const row = await get(
    `SELECT *
     FROM messages
     WHERE id = ?
       AND (expires_at IS NULL OR expires_at > ?)`,
    [id, timestamp]
  );

  if (!row) return null;
  const [message] = await attachReactionsAndReplies([row]);

  if (message.replyToId) {
    const reply = await get(
      `SELECT *
       FROM messages
       WHERE id = ?
         AND (expires_at IS NULL OR expires_at > ?)`,
      [message.replyToId, timestamp]
    );
    if (reply) {
      const [replyMessage] = await attachReactionsAndReplies([reply]);
      message.replyTo = summarizeMessage(replyMessage);
    }
  }

  return message;
}

async function createMessage(sender, payload, deliveredAt = null) {
  const receiver = getPartner(sender);
  const timestamp = nowISO();
  const expiresAt = payload.disappearing
    ? new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString()
    : null;

  const result = await run(
    `INSERT INTO messages (
       sender, receiver, type, body, file_url, file_name, mime_type, reply_to_id,
       created_at, updated_at, delivered_at, disappearing, expires_at
     )
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      sender,
      receiver,
      payload.type,
      payload.body || "",
      payload.fileUrl || null,
      payload.fileName || null,
      payload.mimeType || null,
      payload.replyToId || null,
      timestamp,
      timestamp,
      deliveredAt,
      payload.disappearing ? 1 : 0,
      expiresAt
    ]
  );

  return getMessageById(result.id);
}

async function updateReaction(messageId, user, emoji) {
  const message = await getMessageById(messageId);
  if (!message) return null;

  const timestamp = nowISO();
  const existing = await get(
    "SELECT emoji FROM reactions WHERE message_id = ? AND user = ?",
    [messageId, user]
  );

  if (existing && existing.emoji === emoji) {
    await run("DELETE FROM reactions WHERE message_id = ? AND user = ?", [messageId, user]);
  } else {
    await run(
      `INSERT INTO reactions (message_id, user, emoji, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(message_id, user)
       DO UPDATE SET emoji = excluded.emoji, updated_at = excluded.updated_at`,
      [messageId, user, emoji, timestamp, timestamp]
    );
  }

  return getMessageById(messageId);
}

async function toggleSaved(messageId, user) {
  const row = await get(
    `SELECT saved_by
     FROM messages
     WHERE id = ?
       AND deleted_at IS NULL
       AND (expires_at IS NULL OR expires_at > ?)`,
    [messageId, nowISO()]
  );

  if (!row) return null;

  const savedBy = new Set(parseSavedBy(row.saved_by));
  if (savedBy.has(user)) {
    savedBy.delete(user);
  } else {
    savedBy.add(user);
  }

  await run(
    "UPDATE messages SET saved_by = ?, updated_at = ? WHERE id = ?",
    [JSON.stringify([...savedBy]), nowISO(), messageId]
  );

  return getMessageById(messageId);
}

async function editMessage(messageId, user, body) {
  const row = await get(
    `SELECT id
     FROM messages
     WHERE id = ?
       AND sender = ?
       AND deleted_at IS NULL
       AND type = 'text'
       AND (expires_at IS NULL OR expires_at > ?)`,
    [messageId, user, nowISO()]
  );

  if (!row) return null;

  const timestamp = nowISO();
  await run(
    "UPDATE messages SET body = ?, edited_at = ?, updated_at = ? WHERE id = ?",
    [body, timestamp, timestamp, messageId]
  );

  return getMessageById(messageId);
}

async function deleteMessageForEveryone(messageId, user) {
  const row = await get(
    `SELECT id, file_url
     FROM messages
     WHERE id = ?
       AND sender = ?
       AND deleted_at IS NULL
       AND (expires_at IS NULL OR expires_at > ?)`,
    [messageId, user, nowISO()]
  );

  if (!row) return null;

  const timestamp = nowISO();
  await run("DELETE FROM reactions WHERE message_id = ?", [messageId]);
  await run(
    `UPDATE messages
     SET body = '', file_url = NULL, file_name = NULL, mime_type = NULL,
         deleted_at = ?, updated_at = ?, saved_by = '[]'
     WHERE id = ?`,
    [timestamp, timestamp, messageId]
  );

  const message = await getMessageById(messageId);
  return { message, removedFileUrl: row.file_url };
}

async function statusesForIds(ids) {
  if (!ids.length) return [];
  const rows = await all(
    `SELECT id, delivered_at, seen_at
     FROM messages
     WHERE id IN (${placeholders(ids)})`,
    ids
  );

  return rows.map((row) => ({
    id: row.id,
    deliveredAt: row.delivered_at,
    seenAt: row.seen_at
  }));
}

async function markDeliveredForUser(user) {
  const timestamp = nowISO();
  const rows = await all(
    `SELECT id
     FROM messages
     WHERE receiver = ?
       AND delivered_at IS NULL
       AND deleted_at IS NULL
       AND (expires_at IS NULL OR expires_at > ?)`,
    [user, timestamp]
  );

  if (!rows.length) return [];
  const ids = rows.map((row) => row.id);
  await run(
    `UPDATE messages
     SET delivered_at = ?, updated_at = ?
     WHERE id IN (${placeholders(ids)})`,
    [timestamp, timestamp, ...ids]
  );

  return statusesForIds(ids);
}

async function markSeenForUser(user, ids = []) {
  const timestamp = nowISO();
  const params = [user, timestamp];
  let idFilter = "";

  if (ids.length) {
    idFilter = `AND id IN (${placeholders(ids)})`;
    params.push(...ids);
  }

  const rows = await all(
    `SELECT id
     FROM messages
     WHERE receiver = ?
       AND deleted_at IS NULL
       AND seen_at IS NULL
       AND (expires_at IS NULL OR expires_at > ?)
       ${idFilter}`,
    params
  );

  if (!rows.length) return [];
  const seenIds = rows.map((row) => row.id);
  await run(
    `UPDATE messages
     SET delivered_at = COALESCE(delivered_at, ?),
         seen_at = ?,
         updated_at = ?
     WHERE id IN (${placeholders(seenIds)})`,
    [timestamp, timestamp, timestamp, ...seenIds]
  );

  return statusesForIds(seenIds);
}

async function setUserOnline(user, online) {
  const timestamp = nowISO();
  await run(
    `UPDATE user_state
     SET online = ?, last_seen = CASE WHEN ? = 1 THEN last_seen ELSE ? END, updated_at = ?
     WHERE user = ?`,
    [online ? 1 : 0, online ? 1 : 0, timestamp, timestamp, user]
  );
}

async function getPresenceSummary() {
  const rows = await all("SELECT user, online, last_seen, updated_at FROM user_state ORDER BY user ASC");
  return rows.map((row) => ({
    user: row.user,
    online: Boolean(row.online),
    lastSeen: row.last_seen,
    updatedAt: row.updated_at
  }));
}

async function getUserState(user) {
  const row = await get("SELECT user, online, last_seen, updated_at FROM user_state WHERE user = ?", [user]);
  if (!row) return null;
  return {
    user: row.user,
    online: Boolean(row.online),
    lastSeen: row.last_seen,
    updatedAt: row.updated_at
  };
}

module.exports = {
  databasePath,
  initDatabase,
  cleanupExpiredMessages,
  listMessagesForUser,
  getMessageById,
  createMessage,
  updateReaction,
  toggleSaved,
  editMessage,
  deleteMessageForEveryone,
  markDeliveredForUser,
  markSeenForUser,
  setUserOnline,
  getPresenceSummary,
  getUserState
};
