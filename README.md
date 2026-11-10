# Shiro-MD  ·  💕 AI-girlfriend edition

She is not a command bot any more. She is **one girl** (13 personalities to choose from) with **one boyfriend: the owner**.

| who talks to her | how she treats them |
|---|---|
| the owner (`isOwner`, plus any `config.GF.BOYFRIEND_NUMBERS`) | the full girlfriend: pet names, moods, jealousy, her chosen personality. (Under 18 / age unknown → she stays a friend.) |
| everybody else | a normal, polite acquaintance: no pet names, no flirting, no jealousy, no threats, one plain 🙂. If someone flirts she says she already has a boyfriend, and she never shares anything about him. If they sincerely ask "are you an AI?" she answers honestly (`STRANGERS_ADMIT_AI`). |

Both groups are asked their **name, age and birthday first**, she remembers every message for **24 hours**, and she does the
bot's jobs **when they simply ask her** — in Sinhala, Singlish or English.

> "මට මේ playlist එකේ links ටික අරන් දෙන්න `<url>`"  → she says "ටිකක් ඉන්න…", runs the real `ytpl` command,
> sends the links, and answers in her own voice (girlfriend voice for the owner, polite voice for everybody else).

## What stays a typed command
| command | who | what |
|---|---|---|
| `/gf` · `/gf list` · `/gf <name>` | **owner only** | choose who she is for the whole bot (taiga, kurumi, yukino, chika, yor, mitsuri, akeno, albedo, ougi, shinobu, jibril, frieren, emilia). Others get a polite "can't do that". |
| `/gf me` · `/gf forget` | everyone | what she remembers about *you* · delete it all |
| group commands (`/promote /demote /remove /add /tagall /hidetag /mute /unmute /setwelcome /setgoodbye /getpic /antispam /antibot …`) | group admins | still work typed — **and** she can do them too |
| everything else (`/ytpl`, `/ytaudl`, `/sticker`, `/ig`, `/posters`, `/ping` …) | owner / sudo | typed directly. Normal users who type them are served **by her** (`config.GF.ONLY_MODE`) |

Both `/` and `.` work as prefix (`config.EXTRA_PREFIXES`).

## Safety rules (so she can't be abused)
* She can never do more than the person could by typing the command: owner / sudo / group-admin status comes from
  WhatsApp itself, never from what is written in chat. `config.OWNER_ONLY_COMMANDS` still applies.
* kick / promote / demote / add / mute / sudo → she asks "sure?" first and waits for *yes* (60 s).
* `eval, ev, exec, restart, update, boom, hanimeimg` can never be started from conversation (`config.GF.NL_BLOCKED`).
* The AI itself may only trigger *safe* tools (links, stickers, posters, ping…), and only with a url/number that is really in the user's message.
* Romance exists only for her boyfriend; and only if he is 18+ (under 18 / age unknown → warm **friend**). Age is self-reported.
* Everybody else always gets the plain "normal person" prompt (`buildCasualPrompt` in `plugins/girlfriends.js`) — a much smaller prompt, so more room for memory.
* In groups she only answers when addressed (reply to her, @mention, or her name first) and never interviews people there.

## Adding a new command (nothing else to edit)
Write a normal plugin and give it a `use:` line — copy `templates/new-command.js` into `plugins/`:

```js
cmd({ pattern: 'weather', alias: ['wx', 'klimate'], desc: 'Weather forecast of a city',
      use: '.weather <city>', category: 'tools', filename: __filename },
async (conn, mek, m, { q, reply }) => { /* q = the argument */ });
```

After a restart she can do it — `lib/gf/registry.js` builds everything from that one declaration:

| from | she works out |
|---|---|
| `pattern` / `alias` | "weather colombo", "klimate kandy" (name or alias of 3+ letters as the first word); typed `/weather colombo` by normal users is done by her |
| `use: '.weather <city>'` | `<city>` = required text → if it is missing she asks and uses the next message. `<url>` link · `<number>` · `@user` tagged/replied person · `on/off` · `[optional]` · several parts → the whole rest as it is |
| `category` | `'group'` → group admins only, inside a group, she asks "sure?" · `'owner'` → the owner only, she asks "sure?" · otherwise everybody |
| `desc` | a short hint for her AI, so she can also start it from normal wording (harmless, read-only commands only; the list is capped by `GF.MARKER_MAX_CHARS`) |

Safety: a command is exposed only if it has a `use:` line (or a `gf:` block). Names that look dangerous (eval, broadcast, delete, ban, fake …)
need an explicit `gf: { … }`. `config.GF.NL_BLOCKED` and `OWNER_ONLY_COMMANDS` always apply. Typed *group* commands from non-admins go through her too,
so the rule above holds even if the plugin forgot its own admin check.

Optional `gf: { keywords, ask, hint, arg, req, perm, group, confirm, quoted, marker, extract }` overrides anything (see the template); `gf: false` keeps a command away from her.
`/gf tools` (owner) lists everything she can do and why a plugin was left out. `config.GF.AUTO_TOOLS = false` turns the whole thing off.

## People she knows (a small permanent memory)
Her boyfriend can introduce people. Tag someone (or reply to their message) and say who they are:

* `chika, this is my friend Nimal @tag` · `@tag මෙයාගේ නම නිමල්` · `@tag මෙයා මගේ යාළුවා නිමල්` · reply + `මෙයාගේ නම කසුන්`
* In a group he does not even have to say her name for the introduction itself.
* Remembered **by WhatsApp id** (phone id and `@lid` are linked automatically), kept forever in MongoDB (`GfPerson`).
* When that person writes to her: she already knows the name (no "what's your name?"), the AI is told "your boyfriend introduced him as his friend", and in a group he is no longer sent away with "DM me first".
* `@94771234567` in messages is turned into `@Nimal` for the AI; "who is this?" + tag/reply → she answers from memory.
* `/gf people` lists them, `/gf people forget @tag` removes one. A person who sends `/gf forget yes` also erases what was said about them.
* Only her boyfriend (the owner) can introduce people.

## Phone-style message ids (`config.MESSAGE_ID_STYLE`)
`'auto'` (default: one fixed phone type per bot number) · `'ios'` · `'android'` · `'mixed'` · `'off'`.
iOS ids look like `3A` + 18 chars, Android ids are 32 chars; Baileys' own ids (`3EB0…`, 22 chars) are read as **web** by `/devicecheck` and other bots.

* This Baileys fork ignores `options.messageId` (it generates the id *after* spreading the options), so `lib/msgid.js` swaps those two lines in
  `node_modules/@dnuzi/baileys/src/socket/messages-send.js` at start-up (idempotent, keeps `messages-send.js.orig`). Only the normal send path is changed — album items keep their own ids.
  If `node_modules` is read-only the bot prints a warning and the ids simply stay as they were.
* Only the *label* changes. WhatsApp itself still knows this is a linked device; it does not protect from bans.
* Check it: reply to one of her messages with `/devicecheck`.

## Memory
* profile (name, age, birthday, chosen girlfriend) → MongoDB, forever
* every message → MongoDB with a TTL index, auto-deleted after `config.GF.MEMORY_HOURS` (24)
* only messages sent **to her** are stored (not other group chatter)
* **limit:** the AI endpoint is a GET url (~7.5 KB, Sinhala letters cost 9 chars each). Everything is stored, but per reply
  she gets the profile + the last turns + the few most relevant earlier lines (`lib/gf/memory.js`).
  To give her the *whole* day, switch `sendHttpsRequest` in `plugins/girlfriends.js` to an API that accepts POST.

## Setup
`config.js → GF`: `BOYFRIEND_NUMBERS`, `ASK_STRANGERS`, `STRANGERS_ADMIT_AI`, `ONLY_MODE`, `MEMORY_HOURS`, `DEFAULT_GF` …

`.env`: `MONGODB_URI`, `PORT`, `NGROK_AUTHTOKEN` as before. Optional: `SUPUN_API_KEY` (needed for the Instagram downloader). See `.env.example`.
`npm install && npm start` · tests: `npm test`

## Layout
```
plugins/girlfriends.js   chat engine: 13 personas, prompt builder, AI call, human typing
plugins/gf-brain.js      the layer on top: listener, onboarding, /gf, tool running, GF-only redirect
lib/gf/store.js          profile + 24h log + people (memory first, MongoDB write-through)
lib/gf/people.js         "this is Nimal, my friend" → who, name, relation (Sinhala · Singlish · English)
lib/msgid.js             phone-style message ids + the one-line Baileys patch
lib/gf/profile.js        name / age / birthday parsing (Sinhala · Singlish · English) + onboarding
lib/gf/memory.js         picks the relevant earlier lines
lib/gf/tools.js          built-in tool table + Sinhala/Singlish/English intent router
lib/gf/registry.js       new plugins become tools by themselves (from use / desc / category / gf:)
templates/new-command.js copy into plugins/ to add a command
lib/gf/exec.js           permission check + running a command for the user
lib/gf/lines.js          her fixed lines (4 tones × si/en)
legacy/gf-v1/            old, never-working girlfriend system (kept for reference)
```
