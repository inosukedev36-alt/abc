# Old girlfriend system (v1) — NOT loaded any more

These files were never connected to anything:

* `lib/gf-db.js` was an exact copy of `lib/gf-sleep.js` (even its header comment said "gf-sleep.js"),
  so `plugins/gf-chat.js` could never read or save a user (`gfDb.getUser is not a function`).
* nothing called `handleGirlfriendChat` from `gf-chat.js`.

The working system is `plugins/girlfriends.js` (chat engine) + `plugins/gf-brain.js` + `lib/gf/*`.
Kept here only for reference (e.g. the idea of "sleep hours" in `gf-sleep.js`).
