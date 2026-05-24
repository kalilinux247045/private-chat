(function () {
  const reactionEmojis = ["❤️", "😂", "😮", "😢", "😡", "👍", "🔥", "🥰"];
  const quickEmojis = ["❤️", "😂", "🥰", "🔥", "👍", "😭", "😮", "😡", "🎉", "🙏", "✨", "💬"];

  const els = {
    partnerAvatar: document.getElementById("partnerAvatar"),
    partnerName: document.getElementById("partnerName"),
    presenceText: document.getElementById("presenceText"),
    unreadBadge: document.getElementById("unreadBadge"),
    messages: document.getElementById("messages"),
    typingIndicator: document.getElementById("typingIndicator"),
    messageInput: document.getElementById("messageInput"),
    sendButton: document.getElementById("sendButton"),
    emojiButton: document.getElementById("emojiButton"),
    emojiPanel: document.getElementById("emojiPanel"),
    attachButton: document.getElementById("attachButton"),
    fileInput: document.getElementById("fileInput"),
    disappearButton: document.getElementById("disappearButton"),
    replyPreview: document.getElementById("replyPreview"),
    replyLabel: document.getElementById("replyLabel"),
    replyText: document.getElementById("replyText"),
    cancelReplyButton: document.getElementById("cancelReplyButton"),
    editPreview: document.getElementById("editPreview"),
    cancelEditButton: document.getElementById("cancelEditButton"),
    messageMenu: document.getElementById("messageMenu"),
    reactionRow: document.getElementById("reactionRow"),
    closeMenuButton: document.getElementById("closeMenuButton"),
    logoutButton: document.getElementById("logoutButton"),
    connectionToast: document.getElementById("connectionToast")
  };

  let socket = null;
  let selfUser = "";
  let partnerUser = "";
  let presence = [];
  let messages = [];
  let activeMenuMessageId = null;
  let replyToId = null;
  let editMessageId = null;
  let disappearing = false;
  let typing = false;
  let typingTimer = null;
  let partnerTypingTimer = null;
  let seenTimer = null;
  let toastTimer = null;
  let unreadCount = 0;
  let audioContext = null;

  function requestJson(url, options = {}) {
    const isForm = options.body instanceof FormData;
    return fetch(url, {
      credentials: "same-origin",
      headers: isForm ? {} : { "Content-Type": "application/json" },
      ...options
    }).then(async (response) => {
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(data.error || "Request failed");
      }
      return data;
    });
  }

  function messageById(id) {
    return messages.find((message) => message.id === Number(id));
  }

  function previewText(message) {
    if (!message) return "";
    if (message.deletedAt || message.type === "deleted") return "Message deleted";
    if (message.type === "image") return "Photo";
    if (message.type === "video") return "Video";
    return message.body || "";
  }

  function formatClock(iso) {
    if (!iso) return "";
    return new Intl.DateTimeFormat(undefined, {
      hour: "numeric",
      minute: "2-digit"
    }).format(new Date(iso));
  }

  function relativeTime(iso) {
    if (!iso) return "Offline";
    const time = new Date(iso).getTime();
    const diff = Math.max(0, Date.now() - time);
    const minute = 60 * 1000;
    const hour = 60 * minute;
    const day = 24 * hour;

    if (diff < minute) return "Last seen just now";
    if (diff < hour) return `Last seen ${Math.floor(diff / minute)}m ago`;
    if (diff < day) return `Last seen ${Math.floor(diff / hour)}h ago`;
    return `Last seen ${new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" }).format(new Date(iso))}`;
  }

  function showToast(message, duration = 1800) {
    window.clearTimeout(toastTimer);
    els.connectionToast.textContent = message;
    els.connectionToast.classList.remove("hidden");
    if (duration) {
      toastTimer = window.setTimeout(() => {
        els.connectionToast.classList.add("hidden");
      }, duration);
    }
  }

  function hideToast() {
    window.clearTimeout(toastTimer);
    els.connectionToast.classList.add("hidden");
  }

  function playIncomingSound() {
    try {
      audioContext = audioContext || new (window.AudioContext || window.webkitAudioContext)();
      const oscillator = audioContext.createOscillator();
      const gain = audioContext.createGain();
      oscillator.type = "sine";
      oscillator.frequency.value = 660;
      gain.gain.value = 0.0001;
      oscillator.connect(gain);
      gain.connect(audioContext.destination);
      oscillator.start();
      gain.gain.exponentialRampToValueAtTime(0.08, audioContext.currentTime + 0.015);
      gain.gain.exponentialRampToValueAtTime(0.0001, audioContext.currentTime + 0.18);
      oscillator.stop(audioContext.currentTime + 0.2);
    } catch {
      // Browsers can block sound until the first user gesture.
    }
  }

  function updateUnread(nextCount) {
    unreadCount = Math.max(0, nextCount);
    if (unreadCount === 0) {
      els.unreadBadge.classList.add("hidden");
      document.title = "PrivateChat";
      return;
    }

    els.unreadBadge.textContent = String(unreadCount);
    els.unreadBadge.classList.remove("hidden");
    document.title = `(${unreadCount}) PrivateChat`;
  }

  function renderPresence() {
    const partnerState = presence.find((item) => item.user === partnerUser);
    els.partnerAvatar.textContent = partnerUser ? partnerUser.charAt(0) : "?";
    els.partnerName.textContent = partnerUser || "PrivateChat";

    if (!partnerState) {
      els.presenceText.textContent = "Offline";
      return;
    }

    els.presenceText.textContent = partnerState.online
      ? "Active now"
      : relativeTime(partnerState.lastSeen);
  }

  function isNearBottom() {
    const gap = els.messages.scrollHeight - els.messages.scrollTop - els.messages.clientHeight;
    return gap < 120;
  }

  function scrollToBottom(smooth = true) {
    els.messages.scrollTo({
      top: els.messages.scrollHeight,
      behavior: smooth ? "smooth" : "auto"
    });
  }

  function statusSymbol(message) {
    if (message.seenAt) return { text: "✓✓", className: "seen", title: "Seen" };
    if (message.deliveredAt) return { text: "✓✓", className: "delivered", title: "Delivered" };
    return { text: "✓", className: "sent", title: "Sent" };
  }

  function createReplyChip(replyTo) {
    const chip = document.createElement("div");
    chip.className = "reply-chip";

    const name = document.createElement("strong");
    name.textContent = replyTo.sender || "Message";

    const text = document.createElement("p");
    text.textContent = replyTo.body || "Message";

    chip.append(name, text);
    return chip;
  }

  function createReactions(message) {
    const wrap = document.createElement("div");
    wrap.className = "reactions";

    const counts = new Map();
    for (const reaction of message.reactions || []) {
      counts.set(reaction.emoji, (counts.get(reaction.emoji) || 0) + 1);
    }

    for (const [emoji, count] of counts.entries()) {
      const pill = document.createElement("span");
      pill.className = "reaction-pill";
      pill.textContent = count > 1 ? `${emoji} ${count}` : emoji;
      wrap.appendChild(pill);
    }

    return wrap;
  }

  function createMessageNode(message) {
    const mine = message.sender === selfUser;
    const row = document.createElement("article");
    row.className = `message-row ${mine ? "mine" : "theirs"}`;
    row.dataset.messageId = message.id;

    const wrap = document.createElement("div");
    wrap.className = "bubble-wrap";

    const bubble = document.createElement("div");
    bubble.className = "bubble";
    bubble.tabIndex = 0;
    bubble.setAttribute("role", "button");
    bubble.setAttribute("aria-label", `${mine ? "Your" : message.sender + "'s"} message`);

    const cue = document.createElement("span");
    cue.className = "swipe-cue";
    cue.textContent = "↩";
    bubble.appendChild(cue);

    if ((message.savedBy || []).includes(selfUser)) {
      const pin = document.createElement("span");
      pin.className = "saved-pin";
      pin.textContent = "★";
      bubble.appendChild(pin);
    }

    if (message.replyTo) {
      bubble.appendChild(createReplyChip(message.replyTo));
    }

    if (message.deletedAt || message.type === "deleted") {
      const deleted = document.createElement("div");
      deleted.className = "deleted-bubble";
      deleted.textContent = "Message deleted";
      bubble.appendChild(deleted);
    } else if (message.type === "image") {
      const image = document.createElement("img");
      image.className = "media-preview";
      image.src = message.fileUrl;
      image.alt = message.fileName || "Shared image";
      image.loading = "lazy";
      image.addEventListener("load", () => {
        if (isNearBottom()) scrollToBottom(false);
      });
      bubble.appendChild(image);
    } else if (message.type === "video") {
      const video = document.createElement("video");
      video.className = "media-preview";
      video.src = message.fileUrl;
      video.controls = true;
      video.playsInline = true;
      video.preload = "metadata";
      bubble.appendChild(video);
    } else {
      const text = document.createElement("div");
      text.className = "message-text";
      text.textContent = message.body || "";
      bubble.appendChild(text);
    }

    if (message.body && (message.type === "image" || message.type === "video") && !message.deletedAt) {
      const caption = document.createElement("div");
      caption.className = "message-text";
      caption.textContent = message.body;
      bubble.appendChild(caption);
    }

    const meta = document.createElement("div");
    meta.className = "message-meta";

    const time = document.createElement("span");
    time.textContent = formatClock(message.createdAt);
    meta.appendChild(time);

    if (message.editedAt && !message.deletedAt) {
      const edited = document.createElement("span");
      edited.textContent = "edited";
      meta.appendChild(edited);
    }

    if (message.disappearing && !message.deletedAt) {
      const timer = document.createElement("span");
      timer.textContent = "24h";
      timer.title = "Disappearing message";
      meta.appendChild(timer);
    }

    if (mine && !message.deletedAt) {
      const status = statusSymbol(message);
      const statusEl = document.createElement("span");
      statusEl.className = `message-status ${status.className}`;
      statusEl.textContent = status.text;
      statusEl.title = status.title;
      meta.appendChild(statusEl);
    }

    bubble.appendChild(meta);

    if ((message.reactions || []).length) {
      bubble.appendChild(createReactions(message));
    }

    attachMessageInteractions(bubble, cue, message);
    wrap.appendChild(bubble);
    row.appendChild(wrap);
    return row;
  }

  function hydrateReplySummaries() {
    const byId = new Map(messages.map((message) => [message.id, message]));
    for (const message of messages) {
      if (message.replyToId && !message.replyTo && byId.has(message.replyToId)) {
        const replied = byId.get(message.replyToId);
        message.replyTo = {
          id: replied.id,
          sender: replied.sender,
          type: replied.type,
          body: previewText(replied)
        };
      }
    }
  }

  function renderMessages(forceBottom = false) {
    const keepBottom = forceBottom || isNearBottom();
    hydrateReplySummaries();
    els.messages.replaceChildren();

    if (!messages.length) {
      const empty = document.createElement("div");
      empty.className = "empty-state";
      empty.textContent = "No messages yet.";
      els.messages.appendChild(empty);
    } else {
      for (const message of messages) {
        els.messages.appendChild(createMessageNode(message));
      }
    }

    if (keepBottom) {
      window.requestAnimationFrame(() => scrollToBottom(!forceBottom));
    }
  }

  function upsertMessage(message) {
    const index = messages.findIndex((item) => item.id === message.id);
    if (index >= 0) {
      messages[index] = message;
    } else {
      messages.push(message);
    }
    messages.sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt) || a.id - b.id);
  }

  function applyStatuses(statuses) {
    if (!Array.isArray(statuses) || !statuses.length) return;

    const byId = new Map(statuses.map((status) => [Number(status.id), status]));
    for (const message of messages) {
      const status = byId.get(message.id);
      if (!status) continue;
      message.deliveredAt = status.deliveredAt || message.deliveredAt;
      message.seenAt = status.seenAt || message.seenAt;
    }
    renderMessages();
  }

  function unseenPartnerMessageIds() {
    return messages
      .filter((message) => message.sender === partnerUser && !message.seenAt && !message.deletedAt)
      .map((message) => message.id);
  }

  function markSeenSoon() {
    if (!socket || !socket.connected || document.hidden) return;
    window.clearTimeout(seenTimer);
    seenTimer = window.setTimeout(() => {
      const ids = unseenPartnerMessageIds();
      if (ids.length) {
        socket.emit("messages:seen", { ids });
      }
    }, 250);
  }

  function resetComposerHeight() {
    els.messageInput.style.height = "auto";
    els.messageInput.style.height = `${Math.min(132, els.messageInput.scrollHeight)}px`;
  }

  function setReply(message) {
    if (!message || message.deletedAt) return;
    cancelEdit();
    replyToId = message.id;
    els.replyLabel.textContent = message.sender === selfUser ? "Replying to yourself" : `Replying to ${message.sender}`;
    els.replyText.textContent = previewText(message);
    els.replyPreview.classList.remove("hidden");
    els.messageInput.focus();
  }

  function cancelReply() {
    replyToId = null;
    els.replyPreview.classList.add("hidden");
    els.replyText.textContent = "";
  }

  function beginEdit(message) {
    if (!message || message.sender !== selfUser || message.type !== "text" || message.deletedAt) return;
    cancelReply();
    editMessageId = message.id;
    els.messageInput.value = message.body || "";
    els.sendButton.textContent = "Save";
    els.editPreview.classList.remove("hidden");
    resetComposerHeight();
    els.messageInput.focus();
  }

  function cancelEdit() {
    if (!editMessageId) return;
    editMessageId = null;
    els.editPreview.classList.add("hidden");
    els.sendButton.textContent = "Send";
    els.messageInput.value = "";
    resetComposerHeight();
  }

  function closeMenu() {
    activeMenuMessageId = null;
    els.messageMenu.classList.add("hidden");
  }

  function openMessageMenu(messageId) {
    const message = messageById(messageId);
    if (!message) return;
    activeMenuMessageId = message.id;

    const saveButton = els.messageMenu.querySelector('[data-action="save"]');
    const editButton = els.messageMenu.querySelector('[data-action="edit"]');
    const deleteButton = els.messageMenu.querySelector('[data-action="delete"]');

    const saved = (message.savedBy || []).includes(selfUser);
    saveButton.textContent = saved ? "Unsave" : "Save";
    saveButton.disabled = Boolean(message.deletedAt);
    editButton.disabled = message.sender !== selfUser || message.type !== "text" || Boolean(message.deletedAt);
    deleteButton.disabled = message.sender !== selfUser || Boolean(message.deletedAt);

    els.messageMenu.classList.remove("hidden");
  }

  function shouldIgnoreGestureTarget(target) {
    return Boolean(target.closest("button, a, input, textarea, video"));
  }

  function attachMessageInteractions(bubble, cue, message) {
    let startX = 0;
    let startY = 0;
    let pointerId = null;
    let moved = false;
    let longPressed = false;
    let longPressTimer = null;

    function clearPressTimer() {
      if (longPressTimer) {
        window.clearTimeout(longPressTimer);
        longPressTimer = null;
      }
    }

    function resetSwipe() {
      bubble.style.transform = "";
      cue.style.opacity = "0";
    }

    bubble.addEventListener("pointerdown", (event) => {
      if (shouldIgnoreGestureTarget(event.target)) return;
      pointerId = event.pointerId;
      startX = event.clientX;
      startY = event.clientY;
      moved = false;
      longPressed = false;
      bubble.setPointerCapture(pointerId);

      longPressTimer = window.setTimeout(() => {
        longPressed = true;
        if (navigator.vibrate) navigator.vibrate(12);
        openMessageMenu(message.id);
      }, 520);
    });

    bubble.addEventListener("pointermove", (event) => {
      if (event.pointerId !== pointerId) return;
      const dx = event.clientX - startX;
      const dy = event.clientY - startY;

      if (Math.abs(dx) > 8 || Math.abs(dy) > 8) {
        moved = true;
        clearPressTimer();
      }

      if (dx > 0 && Math.abs(dy) < 42) {
        const offset = Math.min(dx, 88);
        bubble.style.transform = `translateX(${offset}px)`;
        cue.style.opacity = String(Math.min(1, offset / 54));
      }
    });

    bubble.addEventListener("pointerup", (event) => {
      if (event.pointerId !== pointerId) return;
      clearPressTimer();
      const dx = event.clientX - startX;
      const dy = event.clientY - startY;
      pointerId = null;
      window.setTimeout(resetSwipe, 40);

      if (longPressed) return;
      if (dx > 58 && Math.abs(dy) < 46) {
        setReply(message);
        return;
      }

      if (!moved || (Math.abs(dx) < 8 && Math.abs(dy) < 8)) {
        if (socket && socket.connected) {
          socket.emit("message:save", { messageId: message.id });
        }
      }
    });

    bubble.addEventListener("pointercancel", () => {
      clearPressTimer();
      pointerId = null;
      resetSwipe();
    });

    bubble.addEventListener("contextmenu", (event) => {
      event.preventDefault();
      openMessageMenu(message.id);
    });

    bubble.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        openMessageMenu(message.id);
      }
    });
  }

  function stopTyping() {
    if (!typing || !socket || !socket.connected) return;
    typing = false;
    socket.emit("typing:stop");
  }

  function handleTypingInput() {
    resetComposerHeight();
    if (!socket || !socket.connected) return;

    if (!typing) {
      typing = true;
      socket.emit("typing:start");
    }

    window.clearTimeout(typingTimer);
    typingTimer = window.setTimeout(stopTyping, 1100);
  }

  function sendTextOrEdit() {
    const body = els.messageInput.value.trim();
    if (!socket || !socket.connected) {
      showToast("Reconnecting...");
      return;
    }

    if (editMessageId) {
      if (!body) return;
      socket.emit("message:edit", { messageId: editMessageId, body });
      cancelEdit();
      stopTyping();
      return;
    }

    if (!body) return;

    socket.emit("message:send", {
      tempId: window.crypto && crypto.randomUUID ? crypto.randomUUID() : String(Date.now()),
      type: "text",
      body,
      replyToId,
      disappearing
    });

    els.messageInput.value = "";
    resetComposerHeight();
    cancelReply();
    stopTyping();
  }

  async function uploadAndSend(file) {
    if (!file) return;

    if (!file.type.startsWith("image/") && !file.type.startsWith("video/")) {
      showToast("Only images and videos are allowed");
      return;
    }

    if (file.size > 35 * 1024 * 1024) {
      showToast("File must be under 35 MB");
      return;
    }

    if (!socket || !socket.connected) {
      showToast("Reconnecting...");
      return;
    }

    const form = new FormData();
    form.append("media", file);

    els.attachButton.disabled = true;
    showToast("Uploading...", 0);

    try {
      const upload = await requestJson("/api/upload", {
        method: "POST",
        body: form
      });

      socket.emit("message:send", {
        tempId: window.crypto && crypto.randomUUID ? crypto.randomUUID() : String(Date.now()),
        type: upload.type,
        fileUrl: upload.fileUrl,
        fileName: upload.fileName,
        mimeType: upload.mimeType,
        replyToId,
        disappearing
      });
      cancelReply();
      hideToast();
    } catch (err) {
      showToast(err.message || "Upload failed");
    } finally {
      els.attachButton.disabled = false;
      els.fileInput.value = "";
    }
  }

  function buildEmojiControls() {
    els.emojiPanel.replaceChildren();
    for (const emoji of quickEmojis) {
      const button = document.createElement("button");
      button.type = "button";
      button.textContent = emoji;
      button.addEventListener("click", () => {
        els.messageInput.setRangeText(emoji, els.messageInput.selectionStart, els.messageInput.selectionEnd, "end");
        els.messageInput.focus();
        handleTypingInput();
      });
      els.emojiPanel.appendChild(button);
    }

    els.reactionRow.replaceChildren();
    for (const emoji of reactionEmojis) {
      const button = document.createElement("button");
      button.type = "button";
      button.textContent = emoji;
      button.addEventListener("click", () => {
        if (socket && socket.connected && activeMenuMessageId) {
          socket.emit("message:react", { messageId: activeMenuMessageId, emoji });
        }
        closeMenu();
      });
      els.reactionRow.appendChild(button);
    }
  }

  function bindEvents() {
    els.messageInput.addEventListener("input", handleTypingInput);
    els.messageInput.addEventListener("keydown", (event) => {
      if (event.key === "Enter" && !event.shiftKey) {
        event.preventDefault();
        sendTextOrEdit();
      }
    });

    els.sendButton.addEventListener("click", sendTextOrEdit);

    els.cancelReplyButton.addEventListener("click", cancelReply);
    els.cancelEditButton.addEventListener("click", cancelEdit);

    els.emojiButton.addEventListener("click", () => {
      els.emojiPanel.classList.toggle("hidden");
    });

    document.addEventListener("click", (event) => {
      if (!els.emojiPanel.contains(event.target) && event.target !== els.emojiButton) {
        els.emojiPanel.classList.add("hidden");
      }
    });

    els.attachButton.addEventListener("click", () => {
      els.fileInput.click();
    });

    els.fileInput.addEventListener("change", () => {
      uploadAndSend(els.fileInput.files && els.fileInput.files[0]);
    });

    els.disappearButton.addEventListener("click", () => {
      disappearing = !disappearing;
      els.disappearButton.classList.toggle("active", disappearing);
      els.disappearButton.setAttribute("aria-pressed", String(disappearing));
    });

    els.closeMenuButton.addEventListener("click", closeMenu);
    els.messageMenu.addEventListener("click", (event) => {
      if (event.target === els.messageMenu) closeMenu();
    });

    els.messageMenu.querySelector(".menu-actions").addEventListener("click", (event) => {
      const button = event.target.closest("button[data-action]");
      if (!button || button.disabled) return;

      const message = messageById(activeMenuMessageId);
      if (!message) return;

      if (button.dataset.action === "reply") {
        setReply(message);
      }

      if (button.dataset.action === "save" && socket && socket.connected) {
        socket.emit("message:save", { messageId: message.id });
      }

      if (button.dataset.action === "edit") {
        beginEdit(message);
      }

      if (button.dataset.action === "delete" && socket && socket.connected) {
        if (window.confirm("Delete this message for everyone?")) {
          socket.emit("message:delete", { messageId: message.id });
        }
      }

      closeMenu();
    });

    els.logoutButton.addEventListener("click", async () => {
      if (socket) socket.disconnect();
      await requestJson("/api/logout", { method: "POST", body: "{}" }).catch(() => {});
      window.location.href = "/";
    });

    document.addEventListener("visibilitychange", () => {
      if (!document.hidden) {
        updateUnread(0);
        markSeenSoon();
      }
    });

    window.addEventListener("focus", () => {
      updateUnread(0);
      markSeenSoon();
    });
  }

  function connectSocket() {
    socket = io({
      transports: ["websocket", "polling"]
    });

    socket.on("connect", () => {
      hideToast();
      markSeenSoon();
    });

    socket.on("connect_error", (err) => {
      showToast(err.message === "Unauthorized" ? "Login again" : "Connection failed", 0);
      if (err.message === "Unauthorized") {
        window.setTimeout(() => {
          window.location.href = "/";
        }, 800);
      }
    });

    socket.io.on("reconnect_attempt", () => {
      showToast("Reconnecting...", 0);
    });

    socket.io.on("reconnect", () => {
      showToast("Connected", 1000);
      markSeenSoon();
    });

    socket.on("disconnect", () => {
      showToast("Offline. Reconnecting...", 0);
    });

    socket.on("presence:update", (payload) => {
      presence = payload.presence || [];
      renderPresence();
    });

    socket.on("typing:update", (payload) => {
      if (payload.user !== partnerUser) return;
      window.clearTimeout(partnerTypingTimer);
      els.typingIndicator.classList.toggle("hidden", !payload.typing);
      if (payload.typing) {
        partnerTypingTimer = window.setTimeout(() => {
          els.typingIndicator.classList.add("hidden");
        }, 2400);
      }
    });

    socket.on("message:new", (payload) => {
      const message = payload.message;
      if (!message) return;

      const cameFromPartner = message.sender === partnerUser && !messageById(message.id);
      upsertMessage(message);
      renderMessages(true);

      if (cameFromPartner) {
        playIncomingSound();
        if (document.hidden) {
          updateUnread(unreadCount + 1);
        }
      }

      markSeenSoon();
    });

    socket.on("message:updated", (payload) => {
      if (!payload.message) return;
      upsertMessage(payload.message);
      renderMessages();
      markSeenSoon();
    });

    socket.on("messages:status", (payload) => {
      applyStatuses(payload.statuses);
    });

    socket.on("messages:expired", (payload) => {
      const expiredIds = new Set((payload.ids || []).map(Number));
      if (!expiredIds.size) return;
      messages = messages.filter((message) => !expiredIds.has(message.id));
      renderMessages();
    });

    socket.on("chat:error", (payload) => {
      showToast(payload.error || "Chat error");
    });
  }

  async function loadInitialState() {
    const me = await requestJson("/api/me", { method: "GET" });
    selfUser = me.user;
    partnerUser = me.partner;
    presence = me.presence || [];
    renderPresence();

    const result = await requestJson("/api/messages", { method: "GET" });
    messages = result.messages || [];
    presence = result.presence || presence;
    renderPresence();
    applyStatuses(result.statuses || []);
    renderMessages(true);
  }

  async function init() {
    buildEmojiControls();
    bindEvents();
    resetComposerHeight();

    try {
      await loadInitialState();
      connectSocket();
    } catch (err) {
      showToast(err.message || "Login again", 0);
      window.setTimeout(() => {
        window.location.href = "/";
      }, 900);
    }
  }

  init();
})();
