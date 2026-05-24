const fs = require("fs");
const path = require("path");
const { ROOM_NAME, USERS, getPartner, isAllowedUser } = require("../config");
const {
  createMessage,
  updateReaction,
  toggleSaved,
  editMessage,
  deleteMessageForEveryone,
  markDeliveredForUser,
  markSeenForUser,
  setUserOnline,
  getPresenceSummary
} = require("../database/db");

const onlineSockets = new Map();
const allowedReactions = new Set(["❤️", "😂", "😮", "😢", "😡", "👍", "🔥", "🥰"]);

function cleanText(value, maxLength = 4000) {
  return String(value || "").replace(/\r\n/g, "\n").trim().slice(0, maxLength);
}

function toPositiveInteger(value) {
  const number = Number(value);
  if (!Number.isInteger(number) || number <= 0) return null;
  return number;
}

function isOnline(user) {
  const sockets = onlineSockets.get(user);
  return Boolean(sockets && sockets.size);
}

function addOnlineSocket(user, socketId) {
  if (!onlineSockets.has(user)) {
    onlineSockets.set(user, new Set());
  }
  onlineSockets.get(user).add(socketId);
}

function removeOnlineSocket(user, socketId) {
  const sockets = onlineSockets.get(user);
  if (!sockets) return false;
  sockets.delete(socketId);
  if (sockets.size === 0) {
    onlineSockets.delete(user);
    return true;
  }
  return false;
}

function removeUploadedFile(uploadDir, fileUrl) {
  if (!fileUrl || !fileUrl.startsWith("/uploads/")) return;

  const filename = path.basename(fileUrl);
  const fullPath = path.join(uploadDir, filename);
  if (!fullPath.startsWith(uploadDir)) return;

  fs.unlink(fullPath, () => {});
}

function emitError(socket, message) {
  socket.emit("chat:error", { error: message });
}

module.exports = function registerChatSocket(io, { uploadDir }) {
  io.use((socket, next) => {
    const session = socket.request.session;
    if (!session || !session.authenticated || !isAllowedUser(session.selectedUser)) {
      return next(new Error("Unauthorized"));
    }
    return next();
  });

  io.on("connection", async (socket) => {
    const user = socket.request.session.selectedUser;

    socket.data.user = user;
    socket.join(ROOM_NAME);
    addOnlineSocket(user, socket.id);

    await setUserOnline(user, true);
    io.to(ROOM_NAME).emit("presence:update", { presence: await getPresenceSummary() });

    const deliveredStatuses = await markDeliveredForUser(user);
    if (deliveredStatuses.length) {
      io.to(ROOM_NAME).emit("messages:status", { statuses: deliveredStatuses });
    }

    socket.on("message:send", async (payload = {}) => {
      try {
        const type = ["text", "image", "video"].includes(payload.type) ? payload.type : "text";
        const body = cleanText(payload.body);
        const fileUrl = cleanText(payload.fileUrl, 600);
        const fileName = cleanText(payload.fileName, 240);
        const mimeType = cleanText(payload.mimeType, 160);
        const replyToId = toPositiveInteger(payload.replyToId);
        const disappearing = Boolean(payload.disappearing);

        if (type === "text" && !body) {
          emitError(socket, "Write a message first");
          return;
        }

        if ((type === "image" || type === "video") && !fileUrl.startsWith("/uploads/")) {
          emitError(socket, "Upload failed. Try again.");
          return;
        }

        const receiver = getPartner(user);
        const deliveredAt = isOnline(receiver) ? new Date().toISOString() : null;
        const message = await createMessage(
          user,
          {
            type,
            body,
            fileUrl: type === "text" ? null : fileUrl,
            fileName: type === "text" ? null : fileName,
            mimeType: type === "text" ? null : mimeType,
            replyToId,
            disappearing
          },
          deliveredAt
        );

        io.to(ROOM_NAME).emit("message:new", {
          message,
          tempId: payload.tempId || null
        });
      } catch (err) {
        emitError(socket, "Could not send message");
      }
    });

    socket.on("messages:seen", async (payload = {}) => {
      try {
        const ids = Array.isArray(payload.ids)
          ? payload.ids.map(toPositiveInteger).filter(Boolean)
          : [];
        const statuses = await markSeenForUser(user, ids);
        if (statuses.length) {
          io.to(ROOM_NAME).emit("messages:status", { statuses });
        }
      } catch {
        emitError(socket, "Could not update seen status");
      }
    });

    socket.on("typing:start", () => {
      socket.to(ROOM_NAME).emit("typing:update", { user, typing: true });
    });

    socket.on("typing:stop", () => {
      socket.to(ROOM_NAME).emit("typing:update", { user, typing: false });
    });

    socket.on("message:react", async (payload = {}) => {
      try {
        const messageId = toPositiveInteger(payload.messageId);
        const emoji = String(payload.emoji || "");
        if (!messageId || !allowedReactions.has(emoji)) {
          emitError(socket, "Reaction not allowed");
          return;
        }

        const message = await updateReaction(messageId, user, emoji);
        if (message) {
          io.to(ROOM_NAME).emit("message:updated", { message });
        }
      } catch {
        emitError(socket, "Could not react to message");
      }
    });

    socket.on("message:save", async (payload = {}) => {
      try {
        const messageId = toPositiveInteger(payload.messageId);
        if (!messageId) return;
        const message = await toggleSaved(messageId, user);
        if (message) {
          io.to(ROOM_NAME).emit("message:updated", { message });
        }
      } catch {
        emitError(socket, "Could not save message");
      }
    });

    socket.on("message:edit", async (payload = {}) => {
      try {
        const messageId = toPositiveInteger(payload.messageId);
        const body = cleanText(payload.body);
        if (!messageId || !body) {
          emitError(socket, "Edited message cannot be empty");
          return;
        }

        const message = await editMessage(messageId, user, body);
        if (!message) {
          emitError(socket, "You can only edit your own text messages");
          return;
        }

        io.to(ROOM_NAME).emit("message:updated", { message });
      } catch {
        emitError(socket, "Could not edit message");
      }
    });

    socket.on("message:delete", async (payload = {}) => {
      try {
        const messageId = toPositiveInteger(payload.messageId);
        if (!messageId) return;

        const result = await deleteMessageForEveryone(messageId, user);
        if (!result || !result.message) {
          emitError(socket, "You can only delete your own messages");
          return;
        }

        removeUploadedFile(uploadDir, result.removedFileUrl);
        io.to(ROOM_NAME).emit("message:updated", { message: result.message });
      } catch {
        emitError(socket, "Could not delete message");
      }
    });

    socket.on("disconnect", async () => {
      socket.to(ROOM_NAME).emit("typing:update", { user, typing: false });

      const userWentOffline = removeOnlineSocket(user, socket.id);
      if (userWentOffline) {
        await setUserOnline(user, false);
        io.to(ROOM_NAME).emit("presence:update", { presence: await getPresenceSummary() });
      }
    });
  });
};
