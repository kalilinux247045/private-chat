# PrivateChat

A private real-time chat website for two fixed users: Pratham and Sakshi.

## Features

- Session-based password login
- No signup, email, phone, OTP, or public accounts
- Fixed user chooser for Pratham and Sakshi only
- Real-time messages with Socket.IO
- SQLite message storage
- Online, offline, active now, and last seen
- Delivered and seen ticks
- Typing indicator
- Reply and mobile swipe-to-reply
- Long-press message menu on mobile
- Emoji reactions
- Tap message to save or unsave
- Edit your sent text messages
- Delete your sent messages for everyone
- Image and video uploads with in-chat previews
- Optional 24-hour disappearing messages
- Notification sound, unread badge, auto-scroll, and reconnect handling

## Login

Username:

```text
private
```

Password:

```text
kalilinux
```

## Install

```bash
npm install
```

## Run locally

```bash
node server.js
```

Then open:

```text
http://localhost:3000
```

## Project structure

```text
PrivateChat/
  server.js
  package.json
  config.js
  README.md
  public/
    index.html
    users.html
    chat.html
  styles/
    main.css
  scripts/
    login.js
    users.js
    chat.js
  routes/
    auth.js
    messages.js
    middleware.js
    pages.js
    uploads.js
  sockets/
    chatSocket.js
  database/
    db.js
    privatechat.sqlite
    sessions.sqlite
  uploads/
    uploaded media files
```

The SQLite files are created automatically on first run.

## Hosting notes

Set a stronger session secret before hosting:

```bash
SESSION_SECRET="change-this-to-a-long-random-secret" node server.js
```

If hosting behind HTTPS and a reverse proxy, set:

```bash
COOKIE_SECURE=true
```
