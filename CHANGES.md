# What was fixed (errors found in the original archive)

| # | where | problem | fix |
|---|---|---|---|
| 1 | `lib/msg.js` + `plugins/ACD_GROUP.js` | `promote`, `demote`, `remove` read `m.mentioned[0]`, which `sms()` never set → they always crashed ("Cannot read properties of undefined") | `sms()` now provides `m.mentioned`; plugin made null-safe |
| 2 | `lib/msg.js` | `mention.push(quotedMention)` modified the real `contextInfo.mentionedJid` of the message; `m.quoted.sender.split` / `m.quoted.msg.contextInfo` crashed when a quoted message had no participant / body | array copied; null-safe |
| 3 | `plugins/ACD_GROUP.js` | `getpic` called `conn.getProfilePicture` (does not exist in Baileys) | uses `profilePictureUrl` |
| 4 | `plugins/ACD_GROUP.js` | `setwelcome` / `setgoodbye` saved nothing and nothing ever sent them | stored in `data/group-greet.json` (`lib/group-greet.js`) and sent from a `group-participants.update` listener in `pair.js` |
| 5 | `plugins/ACD_GROUP.js` | `add` used the raw argument (`+94 77…`, `077…`) | digits only, `07xxxxxxxx → 947xxxxxxxx` |
| 6 | `lib/gf-db.js` | exact copy of `gf-sleep.js` (the DB module was missing) so `gf-chat.js` could not work; and nothing used it | old system moved to `legacy/gf-v1/` |
| 7 | `pair.js` | one `try` around the whole `for (mek of event.messages)` → one bad message aborted the rest of the batch | each message has its own `try/catch` |
| 8 | `pair.js` | one plugin that throws on `require()` killed the whole bot at start-up | skipped with a log line |
| 9 | `pair.js` | `groupAdmins` was always `[]` | filled via `getGroupAdmins` |
| 10 | `lib/functions.js` | `getGroupAdmins` used `admin !== null`, so every normal member counted as admin (and ids were pushed twice) | only `admin` / `superadmin` |
| 11 | `pair.js` | `on:'text' / 'image' / 'sticker'` watchers used `mek.q` / `mek.type` (never existed) and `video / audio / document` were never fired → **anti-spam never saw media-only floods** | uses the real message type for image, photo, sticker, video, audio, document |
| 12 | `pair.js` | `reply(text, {mentions})` ignored the 2nd argument, so `@user` never became a mention | honoured |
| 13 | `pair.js` | command / args split on a single space (`/ytpl⏎url` failed); any `/xyz` counted as a command | split on any whitespace; only *known* commands count (the rest is chat) |
| 14 | `plugins/tags.js` + `data/shh.json` | `shh.json` shipped as `[]`; `JSON.stringify` drops non-index keys of an array, so **mutes were never saved** | normalised to `{}` |
| 15 | `plugins/tags.js` vs `extras.js` | duplicate `tagall` (the shadowing one had **no admin check**) and duplicate `remove` | one admin-only `tagall` (extras). (`kick`'s alias `remove` is shadowed by the real `remove` command; harmless, and `test/extras.test.js` pins it, so it stays) |
| 16 | `plugins/instagram-dl.js` | written for another framework (`export default handler`, placeholder key): never registered, ES-module syntax can break `require` on older Node | proper `cmd()` plugin (`/ig`), key from `SUPUN_API_KEY` |
| 17 | `plugins/posters.js` | last (partial) zip was lost when the final image failed; `=== postersPerZip` could never fire again after a failed send | flush after the loop, `>=` |
| 18 | `plugins/sudo.js` | `global.sudoList` could be undefined before the DB answered | defaults to `[]` |
| 19 | junk | `data/inbox.jsonmkdir`, `public/Hb`, `test/I`, two `plugins/archive-*.tar.gz` | removed |

## Not changed, but you should know
* **Secrets are inside the archive you uploaded**: `.env`, `sessions/*/creds.json` (WhatsApp login!), a TMDB key in `posters.js`,
  a ScraperAPI key in `hanimeImages.js`. Treat them as leaked: re-link the WhatsApp session, rotate the keys, never share the folder again.
* `sessions/dina_94765947564` is already 7.3 MB and grows; it is saved as ONE MongoDB document (16 MB hard limit). When it fails, saving stops silently.
* `config.OWNER_ONLY_COMMANDS` makes `kick, add, promote, demote, mute, unmute` owner-only even for group admins. The girlfriend follows the same rule. Remove names from that list to open them to admins.

## Boyfriend vs everybody else
* She has ONE boyfriend, the owner. Everybody else is answered like a normal, polite person (no romance).
* She is a single girl for the whole bot: the owner's `/gf <name>` decides who she is; others cannot change it.
* Settings: `config.GF.BOYFRIEND_NUMBERS`, `ASK_STRANGERS`, `STRANGERS_ADMIT_AI`.

## People she knows + phone-style message ids
* Her boyfriend can introduce people (tag / reply + "this is Nimal, my friend"): a permanent per-id memory (`lib/gf/people.js`, `GfPerson` in MongoDB), used when that person writes to her. `/gf people`, `/gf people forget`.
* Every message the bot sends now carries an iOS- or Android-looking id (`config.MESSAGE_ID_STYLE`, default `auto`). This Baileys fork threw a caller-supplied `messageId` away, so `lib/msgid.js` patches that one line (normal send path only) when the bot starts.

## New commands need no other edit
* `lib/gf/registry.js` turns every plugin that has a `use:` line (or a `gf:` block) into something she can do: spoken by name, typed by normal users (done by her), asked-for when an argument is missing, permissions from `category`, described to her AI. `/gf tools` shows the result. Template: `templates/new-command.js`.
* A new `category: 'group'` plugin typed by a non-admin is routed through her, so the derived admin rule holds even if the plugin forgot its own check.
