'use strict'
// Run:  node --test test/        (Node 18+)
// මේ file එක bot එකේ `plugins/` folder එකට දාන්න එපා. (වැරදිලා load වුණොත් tests run නොවෙන්න guard එකක් තියෙනවා)
if (!process.env.NODE_TEST_CONTEXT && require.main !== module) {
  module.exports = {}
  return
}

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('fs')
const os = require('os')
const path = require('path')
const crypto = require('crypto')
const { AntiGuard, detectDevice, parseMessage } = require('../plugins/antiguard-core')

/* ───────────────────────── helpers ───────────────────────── */
const GROUP = '120363111111111111@g.us'
const GROUP2 = '120363222222222222@g.us'
const BOT = '94700000000:7@s.whatsapp.net'
const BOT_PLAIN = '94700000000@s.whatsapp.net'
const ADMIN = '94770000001@s.whatsapp.net'
const OWNER = '94770000002@s.whatsapp.net'
const A = '94771111111@s.whatsapp.net'
const B = '94772222222@s.whatsapp.net'

const hex = (n) => crypto.randomBytes(n).toString('hex').toUpperCase().slice(0, n)
const ID = {
  web: () => '3EB0' + hex(18), // 22 chars
  ios: () => '3A' + hex(18), // 20 chars
  android: () => hex(32), // 32 chars
  desktop: () => hex(18), // 18 chars
}
const quiet = () => ({ info() {}, warn() {}, error() {} })
const capture = () => {
  const logs = { info: [], warn: [], error: [] }
  return { logs, info: (...a) => logs.info.push(a.join(' ')), warn: (...a) => logs.warn.push(a.join(' ')), error: (...a) => logs.error.push(a.join(' ')) }
}
const clock = (t = 1_700_000_000_000) => {
  const c = { t, now: () => c.t, advance(ms) { c.t += ms } }
  return c
}

function msg(sender, body, o = {}) {
  return {
    key: { remoteJid: o.group || GROUP, fromMe: !!o.fromMe, id: o.id || ID[o.device || 'android'](), participant: sender, ...(o.keyExtra || {}) },
    message: o.message || { conversation: body },
    pushName: 'tester',
  }
}

function makeConn(o = {}) {
  const calls = { sent: [], deleted: [], removed: [], meta: 0 }
  const participants = o.participants || [
    { id: BOT_PLAIN, admin: o.botAdmin === false ? null : 'admin' },
    { id: ADMIN, admin: 'admin' },
    { id: OWNER, admin: null },
    { id: A, admin: null },
    { id: B, admin: null },
  ]
  return {
    user: o.user || { id: BOT },
    calls,
    async groupMetadata(jid) {
      calls.meta++
      if (o.metaError) throw new Error('rate-overlimit')
      return { id: jid, subject: 'test group', participants }
    },
    async sendMessage(jid, content, opts) {
      if (o.sendError) throw new Error('send failed')
      if (content && content.delete) {
        if (o.deleteError) throw new Error('delete failed')
        calls.deleted.push({ jid, key: content.delete })
      } else calls.sent.push({ jid, content, opts })
      return {}
    },
    async groupParticipantsUpdate(jid, users, action) {
      if (o.removeError) throw new Error('forbidden')
      calls.removed.push({ jid, users, action })
      return users.map((u) => ({ status: o.removeStatus || '200', jid: u }))
    },
  }
}

const tmpDir = () => fs.mkdtempSync(path.join(os.tmpdir(), 'antiguard-'))
function makeGuard(on = [], opts = {}) {
  const g = new AntiGuard({ dbFile: path.join(tmpDir(), 'db.json'), log: quiet(), ownerNumbers: ['94770000002'], ...opts })
  for (const f of on) g.store.set(GROUP, f, true)
  return g
}
const feedSame = async (g, conn, sender, body, n, o) => {
  let last
  for (let i = 0; i < n; i++) last = await g.handleMessage(conn, msg(sender, body, o))
  return last
}
const sticker = (sender, bytes, o = {}) => msg(sender, null, { ...o, message: { stickerMessage: { fileSha256: Buffer.from(bytes), mimetype: 'image/webp' } } })
const cmdMsg = (sender, text, o = {}) => msg(sender, text, { group: o.group, fromMe: o.fromMe })

/* ═════════════════════════ device detection ═════════════════════════ */
test('detectDevice: message-ID formats', () => {
  for (let i = 0; i < 50; i++) {
    assert.equal(detectDevice(ID.web()), 'web')
    assert.equal(detectDevice(ID.ios()), 'ios')
    assert.equal(detectDevice(ID.android()), 'android')
    assert.equal(detectDevice(ID.desktop()), 'desktop')
  }
  assert.equal(detectDevice('BAE5' + hex(12)), 'unknown') // පරණ Baileys-style IDs
  assert.equal(detectDevice(''), 'unknown')
  assert.equal(detectDevice(undefined), 'unknown')
  assert.equal(detectDevice(12345), 'unknown')
})

/* ═════════════════════════ ANTI-SPAM ═════════════════════════ */
test('antispam: removes on exactly the 10th identical message — not before', async () => {
  const g = makeGuard(['antispam'])
  const conn = makeConn()
  await feedSame(g, conn, A, 'free followers http://x.y', 9)
  assert.equal(conn.calls.removed.length, 0, 'must NOT remove after 9')
  const r = await g.handleMessage(conn, msg(A, 'free followers http://x.y'))
  assert.equal(r.removed, true)
  assert.deepEqual(conn.calls.removed, [{ jid: GROUP, users: [A], action: 'remove' }])
  assert.equal(conn.calls.sent.length, 1)
  assert.match(conn.calls.sent[0].content.text, /ANTISPAM/)
  assert.deepEqual(conn.calls.sent[0].content.mentions, [A])
})

test('antispam: a different message from the same user resets the streak', async () => {
  const g = makeGuard(['antispam'])
  const conn = makeConn()
  await feedSame(g, conn, A, 'hello', 9)
  await g.handleMessage(conn, msg(A, 'something else'))
  await feedSame(g, conn, A, 'hello', 9)
  assert.equal(conn.calls.removed.length, 0, '9 + other + 9 must not remove')
  await g.handleMessage(conn, msg(A, 'hello')) // new streak now reaches 10
  assert.equal(conn.calls.removed.length, 1)
})

test("antispam: other members' chat in between does NOT break someone's streak", async () => {
  const g = makeGuard(['antispam'])
  const conn = makeConn()
  for (let i = 0; i < 10; i++) {
    await g.handleMessage(conn, msg(A, 'buy now'))
    await g.handleMessage(conn, msg(B, 'normal chat ' + i))
  }
  assert.deepEqual(conn.calls.removed.map((x) => x.users[0]), [A])
})

test('antispam: same text from different users is NOT combined', async () => {
  const g = makeGuard(['antispam'])
  const conn = makeConn()
  await feedSame(g, conn, A, 'hi', 5)
  await feedSame(g, conn, B, 'hi', 5)
  assert.equal(conn.calls.removed.length, 0)
  await feedSame(g, conn, A, 'hi', 5) // A reaches 10, B only 5
  assert.deepEqual(conn.calls.removed.map((x) => x.users[0]), [A])
})

test('antispam: gap longer than spamGapMs breaks "continuous"; shorter gaps keep it', async () => {
  const c = clock()
  const g = makeGuard(['antispam'], { now: c.now })
  const conn = makeConn()
  await feedSame(g, conn, A, 'x', 9)
  c.advance(61_000)
  await g.handleMessage(conn, msg(A, 'x')) // would have been #10 — but streak expired
  assert.equal(conn.calls.removed.length, 0)
  await feedSame(g, conn, A, 'x', 8) // streak is now 9
  assert.equal(conn.calls.removed.length, 0)
  await g.handleMessage(conn, msg(A, 'x')) // 10
  assert.equal(conn.calls.removed.length, 1)

  // slow spammer: 10 messages, 59s apart -> still "continuous"
  const c2 = clock()
  const g2 = makeGuard(['antispam'], { now: c2.now })
  const conn2 = makeConn()
  for (let i = 0; i < 10; i++) {
    await g2.handleMessage(conn2, msg(B, 'slow spam'))
    c2.advance(59_000)
  }
  assert.equal(conn2.calls.removed.length, 1)
})

test('antispam: burst of 40 identical messages (concurrent) -> exactly ONE removal + ONE notice', async () => {
  const g = makeGuard(['antispam'])
  const conn = makeConn()
  const results = await Promise.all(Array.from({ length: 40 }, () => g.handleMessage(conn, msg(A, 'spam'))))
  assert.equal(conn.calls.removed.length, 1)
  assert.equal(conn.calls.sent.length, 1)
  assert.equal(results.filter((r) => r && r.removed).length, 1)
})

test('antispam: after the cooldown a re-joined spammer is counted fresh', async () => {
  const c = clock()
  const g = makeGuard(['antispam'], { now: c.now })
  const conn = makeConn()
  await feedSame(g, conn, A, 'spam', 10)
  assert.equal(conn.calls.removed.length, 1)
  c.advance(61_000)
  await feedSame(g, conn, A, 'spam', 9)
  assert.equal(conn.calls.removed.length, 1)
  await feedSame(g, conn, A, 'spam', 1)
  assert.equal(conn.calls.removed.length, 2)
})

test('antispam: admins and owner are exempt (10x same message)', async () => {
  const g = makeGuard(['antispam'])
  const conn = makeConn()
  const r1 = await feedSame(g, conn, ADMIN, 'announcement', 10)
  const r2 = await feedSame(g, conn, OWNER, 'owner msg', 10)
  assert.deepEqual(r1, { skipped: 'exempt' })
  assert.deepEqual(r2, { skipped: 'exempt' })
  assert.equal(conn.calls.removed.length, 0)
})

test('antispam: bot not admin -> no removal attempt, no crash, warning logged once', async () => {
  const cap = capture()
  const g = makeGuard(['antispam'], { log: cap })
  const conn = makeConn({ botAdmin: false })
  const r = await feedSame(g, conn, A, 'spam', 10)
  await feedSame(g, conn, B, 'spam', 10)
  assert.deepEqual(r, { skipped: 'bot-not-admin' })
  assert.equal(conn.calls.removed.length, 0)
  assert.equal(cap.logs.warn.filter((w) => /NOT admin/.test(w)).length, 1)
})

test('antispam: feature OFF -> nothing happens even after 50 messages', async () => {
  const g = makeGuard([])
  const conn = makeConn()
  await feedSame(g, conn, A, 'spam', 50)
  assert.equal(conn.calls.removed.length, 0)
  assert.equal(conn.calls.meta, 0)
})

test('antispam: per-group isolation (settings and streaks)', async () => {
  const g = makeGuard(['antispam']) // only GROUP enabled
  const conn = makeConn()
  await feedSame(g, conn, A, 'spam', 30, { group: GROUP2 })
  assert.equal(conn.calls.removed.length, 0, 'GROUP2 is off')

  g.store.set(GROUP2, 'antispam', true)
  await feedSame(g, conn, B, 'same', 5, { group: GROUP })
  await feedSame(g, conn, B, 'same', 5, { group: GROUP2 })
  assert.equal(conn.calls.removed.length, 0, 'streak must not cross groups')
})

test('antispam: removal rejected (status 403) -> no success notice, no throw', async () => {
  const g = makeGuard(['antispam'])
  const conn = makeConn({ removeStatus: '403' })
  const r = await feedSame(g, conn, A, 'spam', 10)
  assert.equal(r.removed, false)
  assert.equal(conn.calls.sent.length, 0)
})

test('antispam: removal throws -> handled, error logged', async () => {
  const cap = capture()
  const g = makeGuard(['antispam'], { log: cap })
  const conn = makeConn({ removeError: true })
  const r = await feedSame(g, conn, A, 'spam', 10)
  assert.equal(r.removed, false)
  assert.ok(cap.logs.error.some((e) => /remove failed/.test(e)))
})

test('antispam: same sticker (same file hash) x10 -> removed; different stickers -> not', async () => {
  const g = makeGuard(['antispam'])
  const conn = makeConn()
  for (let i = 0; i < 10; i++) await g.handleMessage(conn, sticker(B, [1, 2, 3, i]))
  assert.equal(conn.calls.removed.length, 0, '10 DIFFERENT stickers are fine')
  for (let i = 0; i < 10; i++) await g.handleMessage(conn, sticker(A, [9, 9, 9]))
  assert.deepEqual(conn.calls.removed.map((x) => x.users[0]), [A])
})

test('antispam: same image + different caption is a different message', async () => {
  const g = makeGuard(['antispam'])
  const conn = makeConn()
  for (let i = 0; i < 10; i++) {
    await g.handleMessage(conn, msg(A, null, { message: { imageMessage: { fileSha256: Buffer.from([7, 7]), caption: 'c' + i } } }))
  }
  assert.equal(conn.calls.removed.length, 0)
})

test('antispam: whitespace differences count as the same text', async () => {
  const g = makeGuard(['antispam'])
  const conn = makeConn()
  const variants = ['hello', 'hello ', ' hello', 'hello\n', 'hello', ' hello ', 'hello', 'hello  ', '  hello', 'hello']
  for (const v of variants) await g.handleMessage(conn, msg(A, v))
  assert.equal(conn.calls.removed.length, 1)
})

test('antispam: conversation / extendedTextMessage / ephemeral wrapper are the same text', async () => {
  const g = makeGuard(['antispam'])
  const conn = makeConn()
  for (let i = 0; i < 4; i++) await g.handleMessage(conn, msg(A, 'yo'))
  for (let i = 0; i < 3; i++) await g.handleMessage(conn, msg(A, null, { message: { extendedTextMessage: { text: 'yo' } } }))
  for (let i = 0; i < 3; i++) await g.handleMessage(conn, msg(A, null, { message: { ephemeralMessage: { message: { conversation: 'yo' } } } }))
  assert.equal(conn.calls.removed.length, 1)
})

test('antispam: DMs, own messages, protocol msgs and junk are ignored', async () => {
  const g = makeGuard(['antispam', 'antibot'])
  const DM = '94771111111@s.whatsapp.net'
  g.store.set(DM, 'antispam', true) // even if (wrongly) enabled for a DM, DMs must never be acted on
  g.store.set(DM, 'antibot', true)
  const conn = makeConn()
  for (let i = 0; i < 20; i++) {
    await g.handleMessage(conn, msg(A, 'spam', { group: DM, device: 'web' })) // DM
    await g.handleMessage(conn, msg(A, 'spam', { fromMe: true }))
    await g.handleMessage(conn, msg(A, null, { message: { protocolMessage: { type: 0 } } }))
    await g.handleMessage(conn, msg(A, null, { message: null }))
    await g.handleMessage(conn, { key: { remoteJid: GROUP, id: ID.android() }, message: { conversation: 'no participant' } })
    await g.handleMessage(conn, null)
    await g.handleMessage(conn, {})
  }
  assert.equal(conn.calls.removed.length, 0)
  assert.equal(conn.calls.deleted.length, 0)
  assert.equal(parseMessage(msg(A, 'x', { fromMe: true })), null)
})

test('antispam: reactions between spam messages do NOT reset the streak', async () => {
  const g = makeGuard(['antispam'])
  const conn = makeConn()
  await feedSame(g, conn, A, 'spam', 5)
  await g.handleMessage(conn, msg(A, null, { message: { reactionMessage: { text: '👍', key: {} } } }))
  await feedSame(g, conn, A, 'spam', 5)
  assert.equal(conn.calls.removed.length, 1)
})

test('antispam: duplicate delivery of the same message id counts only once', async () => {
  const g = makeGuard(['antispam'])
  const conn = makeConn()
  const msgs = Array.from({ length: 10 }, () => msg(A, 'spam'))
  for (let i = 0; i < 9; i++) await g.handleMessage(conn, msgs[i])
  for (let i = 0; i < 5; i++) await g.handleMessage(conn, msgs[8]) // Baileys re-delivery
  assert.equal(conn.calls.removed.length, 0)
  await g.handleMessage(conn, msgs[9])
  assert.equal(conn.calls.removed.length, 1)
})

test('antispam: custom spamLimit works', async () => {
  const g = makeGuard(['antispam'], { spamLimit: 3 })
  const conn = makeConn()
  await feedSame(g, conn, A, 'x', 2)
  assert.equal(conn.calls.removed.length, 0)
  await feedSame(g, conn, A, 'x', 1)
  assert.equal(conn.calls.removed.length, 1)
})

/* ───────── LID / multi-device JIDs ───────── */
const lidParticipants = [
  { id: '999111@lid', phoneNumber: BOT_PLAIN, admin: 'admin' },
  { id: '555222@lid', phoneNumber: ADMIN, admin: 'admin' },
  { id: '777333@lid', phoneNumber: A, admin: null },
]
const lidUser = { id: BOT, lid: '999111:7@lid' }

test('LID group: sender with device suffix + PN alt -> removed using the group member id', async () => {
  const g = makeGuard(['antispam'])
  const conn = makeConn({ participants: lidParticipants, user: lidUser })
  for (let i = 0; i < 10; i++) {
    await g.handleMessage(conn, msg('777333:3@lid', 'spam', { keyExtra: { participantAlt: '94771111111:3@s.whatsapp.net' } }))
  }
  assert.deepEqual(conn.calls.removed, [{ jid: GROUP, users: ['777333@lid'], action: 'remove' }])
  assert.deepEqual(conn.calls.sent[0].content.mentions, ['777333@lid'])
})

test('LID group: admin recognised through phone-number alias -> exempt', async () => {
  const g = makeGuard(['antispam', 'antibot'])
  const conn = makeConn({ participants: lidParticipants, user: lidUser })
  await feedSame(g, conn, ADMIN, 'x', 10, { device: 'web' }) // PN only, admin is listed by LID + phoneNumber
  assert.equal(conn.calls.removed.length, 0)
  assert.equal(conn.calls.deleted.length, 0)
})

test('LID group: bot admin status found via bot LID', async () => {
  const g = makeGuard(['antibot'])
  const conn = makeConn({ participants: lidParticipants, user: lidUser })
  await g.handleMessage(conn, msg('777333:3@lid', 'hi', { device: 'web' }))
  assert.equal(conn.calls.deleted.length, 1)
})

test('sender missing from metadata (just joined) -> falls back to normalised participant jid', async () => {
  const g = makeGuard(['antispam'])
  const conn = makeConn()
  await feedSame(g, conn, '94773333333:9@s.whatsapp.net', 'spam', 10)
  assert.deepEqual(conn.calls.removed[0].users, ['94773333333@s.whatsapp.net'])
})

/* ═════════════════════════ ANTI-BOT ═════════════════════════ */
test('antibot: web-device message from a normal member is deleted + ANTIBOT notice', async () => {
  const g = makeGuard(['antibot'])
  const conn = makeConn()
  const m = msg(A, 'hello from web', { device: 'web' })
  const r = await g.handleMessage(conn, m)
  assert.equal(r.deleted, true)
  assert.equal(conn.calls.deleted.length, 1)
  assert.deepEqual(conn.calls.deleted[0].key, m.key, 'must delete exactly that message (full key incl. participant)')
  assert.equal(conn.calls.deleted[0].jid, GROUP)
  assert.equal(conn.calls.sent.length, 1)
  assert.match(conn.calls.sent[0].content.text, /ANTIBOT/)
  assert.deepEqual(conn.calls.sent[0].content.mentions, [A])
})

test('antibot: android / ios / desktop / unknown-ID messages are untouched', async () => {
  const g = makeGuard(['antibot'])
  const conn = makeConn()
  for (const d of ['android', 'ios', 'desktop']) await g.handleMessage(conn, msg(A, 'hi', { device: d }))
  await g.handleMessage(conn, msg(A, 'hi', { id: 'BAE5' + hex(12) }))
  assert.equal(conn.calls.deleted.length, 0)
  assert.equal(conn.calls.sent.length, 0)
})

test('antibot: OFF -> web messages are untouched', async () => {
  const g = makeGuard([])
  const conn = makeConn()
  await g.handleMessage(conn, msg(A, 'hi', { device: 'web' }))
  assert.equal(conn.calls.deleted.length, 0)
})

test("antibot: admin / owner / the bot's own messages are never deleted (even with web-style IDs)", async () => {
  const g = makeGuard(['antibot'])
  const conn = makeConn()
  await g.handleMessage(conn, msg(ADMIN, 'hi', { device: 'web' }))
  await g.handleMessage(conn, msg(OWNER, 'hi', { device: 'web' }))
  await g.handleMessage(conn, msg(BOT, 'hi', { device: 'web', fromMe: true })) // Baileys bot replies look like "web"
  await g.handleMessage(conn, msg(BOT, 'hi', { device: 'web' })) // fromMe flag missing, still recognised as self
  assert.equal(conn.calls.deleted.length, 0)
})

test('antibot: bot not admin -> nothing deleted, no crash', async () => {
  const g = makeGuard(['antibot'])
  const conn = makeConn({ botAdmin: false })
  const r = await g.handleMessage(conn, msg(A, 'hi', { device: 'web' }))
  assert.deepEqual(r, { skipped: 'bot-not-admin' })
  assert.equal(conn.calls.deleted.length, 0)
})

test('antibot: burst of 25 web messages -> 25 deletions but only ONE notice (throttled); notice again after cooldown', async () => {
  const c = clock()
  const g = makeGuard(['antibot'], { now: c.now })
  const conn = makeConn()
  await Promise.all(Array.from({ length: 25 }, (_, i) => g.handleMessage(conn, msg(A, 'bot spam ' + i, { device: 'web' }))))
  assert.equal(conn.calls.deleted.length, 25)
  assert.equal(conn.calls.sent.length, 1)
  assert.equal(conn.calls.meta, 1, 'group metadata fetched once for the whole burst')
  c.advance(31_000)
  await g.handleMessage(conn, msg(A, 'again', { device: 'web' }))
  assert.equal(conn.calls.sent.length, 2)
})

test('antibot: works for every message type (image, sticker, video, audio, document, text)', async () => {
  const g = makeGuard(['antibot'])
  const conn = makeConn()
  const types = [
    { imageMessage: { caption: 'x' } }, { stickerMessage: {} }, { videoMessage: {} }, { audioMessage: {} },
    { documentMessage: {} }, { extendedTextMessage: { text: 'x' } }, { conversation: 'x' },
  ]
  for (const message of types) await g.handleMessage(conn, msg(A, null, { message, device: 'web' }))
  assert.equal(conn.calls.deleted.length, types.length)
})

test('antibot: reactions / protocol messages are ignored', async () => {
  const g = makeGuard(['antibot'])
  const conn = makeConn()
  await g.handleMessage(conn, msg(A, null, { message: { reactionMessage: { text: '👍' } }, device: 'web' }))
  await g.handleMessage(conn, msg(A, null, { message: { protocolMessage: { type: 0 } }, device: 'web' }))
  assert.equal(conn.calls.deleted.length, 0)
})

test('antibot: delete fails -> no notice, no throw', async () => {
  const g = makeGuard(['antibot'])
  const conn = makeConn({ deleteError: true })
  const r = await g.handleMessage(conn, msg(A, 'hi', { device: 'web' }))
  assert.equal(r.deleted, false)
  assert.equal(conn.calls.sent.length, 0)
})

test('antibot: metadata fetch fails -> fail-safe (nothing deleted), failure cached briefly', async () => {
  const g = makeGuard(['antibot'])
  const conn = makeConn({ metaError: true })
  const rs = await Promise.all(Array.from({ length: 30 }, () => g.handleMessage(conn, msg(A, 'hi', { device: 'web' }))))
  assert.ok(rs.every((r) => r.skipped === 'no-metadata'))
  assert.equal(conn.calls.deleted.length, 0)
  assert.equal(conn.calls.meta, 1)
})

test('antibot: blockedDevices option (web + desktop)', async () => {
  const g = makeGuard(['antibot'], { blockedDevices: ['web', 'desktop'] })
  const conn = makeConn()
  await g.handleMessage(conn, msg(A, 'x', { device: 'desktop' }))
  await g.handleMessage(conn, msg(A, 'x', { device: 'web' }))
  await g.handleMessage(conn, msg(A, 'x', { device: 'android' }))
  assert.equal(conn.calls.deleted.length, 2)
})

test('antispam + antibot are independent: only antibot ON -> no removals; only antispam ON -> web msgs kept', async () => {
  const g1 = makeGuard(['antibot'])
  const c1 = makeConn()
  await feedSame(g1, c1, A, 'same', 12, { device: 'web' })
  assert.equal(c1.calls.deleted.length, 12)
  assert.equal(c1.calls.removed.length, 0)

  const g2 = makeGuard(['antispam'])
  const c2 = makeConn()
  await feedSame(g2, c2, A, 'same', 12, { device: 'web' })
  assert.equal(c2.calls.deleted.length, 0)
  assert.equal(c2.calls.removed.length, 1)
})

test('both ON: web spam bot -> every message deleted, removed at #10, exactly 2 notices (ANTIBOT then ANTISPAM)', async () => {
  const g = makeGuard(['antispam', 'antibot'])
  const conn = makeConn()
  await Promise.all(Array.from({ length: 12 }, () => g.handleMessage(conn, msg(A, 'spam', { device: 'web' }))))
  assert.equal(conn.calls.deleted.length, 12)
  assert.equal(conn.calls.removed.length, 1)
  assert.deepEqual(conn.calls.sent.map((s) => /ANTIBOT|ANTISPAM/.exec(s.content.text)[0]), ['ANTIBOT', 'ANTISPAM'])
})

/* ═════════════════════════ commands ═════════════════════════ */
test('command: admin turns antispam ON -> enabled, replied, persisted to disk and reloaded', async () => {
  const dbFile = path.join(tmpDir(), 'db.json')
  const g = new AntiGuard({ dbFile, log: quiet() })
  const conn = makeConn()
  const r = await g.handleCommand(conn, cmdMsg(ADMIN, '.antispam on'), 'antispam', 'on')
  assert.deepEqual(r, { ok: true, feature: 'antispam', enabled: true })
  assert.equal(g.store.get(GROUP).antispam, true)
  assert.match(conn.calls.sent[0].content.text, /Anti-spam ON/)
  assert.equal(JSON.parse(fs.readFileSync(dbFile, 'utf8'))[GROUP].antispam, true)
  const g2 = new AntiGuard({ dbFile, log: quiet() }) // "bot restart"
  assert.equal(g2.store.get(GROUP).antispam, true)
  assert.equal(g2.store.get(GROUP).antibot, false)
})

test('command: antibot on/off, independent of antispam', async () => {
  const g = makeGuard()
  const conn = makeConn()
  await g.handleCommand(conn, cmdMsg(ADMIN, '.antibot on'), 'antibot', 'on')
  assert.deepEqual(g.store.get(GROUP), { antispam: false, antibot: true })
  assert.match(conn.calls.sent[0].content.text, /Anti-bot ON/)
  await g.handleCommand(conn, cmdMsg(ADMIN, '.antibot off'), 'antibot', 'off')
  assert.deepEqual(g.store.get(GROUP), { antispam: false, antibot: false })
  assert.match(conn.calls.sent[1].content.text, /Anti-bot OFF/)
})

test('command: non-admin is denied and nothing changes', async () => {
  const g = makeGuard()
  const conn = makeConn()
  const r = await g.handleCommand(conn, cmdMsg(A, '.antispam on'), 'antispam', 'on')
  assert.equal(r.ok, false)
  assert.equal(r.reason, 'not-admin')
  assert.equal(g.store.get(GROUP).antispam, false)
  assert.match(conn.calls.sent[0].content.text, /admins/)
})

test('command: owner (non-admin) and fromMe are allowed; template isOwner flag works', async () => {
  const g = makeGuard()
  const conn = makeConn()
  await g.handleCommand(conn, cmdMsg(OWNER, '.antispam on'), 'antispam', 'on')
  assert.equal(g.store.get(GROUP).antispam, true)
  await g.handleCommand(conn, cmdMsg(BOT, '.antibot on', { fromMe: true }), 'antibot', 'on')
  assert.equal(g.store.get(GROUP).antibot, true)
  await g.handleCommand(conn, cmdMsg(A, '.antispam off'), 'antispam', 'off', { isOwner: true })
  assert.equal(g.store.get(GROUP).antispam, false)
})

test('command: no arg / invalid arg -> status + usage, state unchanged; arg parsed from text when not supplied', async () => {
  const g = makeGuard(['antispam'])
  const conn = makeConn()
  await g.handleCommand(conn, cmdMsg(ADMIN, '.antispam'), 'antispam', '')
  await g.handleCommand(conn, cmdMsg(ADMIN, '.antispam maybe'), 'antispam', 'maybe')
  assert.equal(g.store.get(GROUP).antispam, true)
  assert.match(conn.calls.sent[0].content.text, /ON ✅/)
  assert.match(conn.calls.sent[1].content.text, /\.antispam on/)
  await g.handleCommand(conn, cmdMsg(ADMIN, '.antispam off'), 'antispam') // arg omitted -> parsed from message text
  assert.equal(g.store.get(GROUP).antispam, false)
})

test('command: used in a DM -> "groups only"', async () => {
  const g = makeGuard()
  const conn = makeConn()
  const r = await g.handleCommand(conn, cmdMsg(A, '.antispam on', { group: A }), 'antispam', 'on')
  assert.equal(r.reason, 'not-group')
  assert.match(conn.calls.sent[0].content.text, /group එකක්/)
})

test('command: enabling while bot is not admin warns the admin (still enabled)', async () => {
  const g = makeGuard()
  const conn = makeConn({ botAdmin: false })
  await g.handleCommand(conn, cmdMsg(ADMIN, '.antibot on'), 'antibot', 'on')
  assert.equal(g.store.get(GROUP).antibot, true)
  assert.match(conn.calls.sent[0].content.text, /Bot ට admin නැති/)
})

test('command: metadata failure for a non-owner -> polite error, nothing enabled', async () => {
  const g = makeGuard()
  const conn = makeConn({ metaError: true })
  const r = await g.handleCommand(conn, cmdMsg(ADMIN, '.antispam on'), 'antispam', 'on')
  assert.equal(r.reason, 'no-metadata')
  assert.equal(g.store.get(GROUP).antispam, false)
})

test('settings: corrupt DB file does not crash; next save repairs it', async () => {
  const dbFile = path.join(tmpDir(), 'db.json')
  fs.writeFileSync(dbFile, 'not json {{{')
  const cap = capture()
  const g = new AntiGuard({ dbFile, log: cap })
  assert.equal(g.store.get(GROUP).antispam, false)
  assert.ok(cap.logs.warn.length >= 1)
  await g.handleCommand(makeConn(), cmdMsg(ADMIN, '.antispam on'), 'antispam', 'on')
  assert.equal(JSON.parse(fs.readFileSync(dbFile, 'utf8'))[GROUP].antispam, true)
})

test('settings: unwritable location -> still works in memory and tells the admin', async () => {
  const dir = tmpDir()
  const blocker = path.join(dir, 'afile')
  fs.writeFileSync(blocker, 'x')
  const g = new AntiGuard({ dbFile: path.join(blocker, 'db.json'), log: quiet() })
  const conn = makeConn()
  await g.handleCommand(conn, cmdMsg(ADMIN, '.antispam on'), 'antispam', 'on')
  assert.equal(g.store.get(GROUP).antispam, true)
  assert.match(conn.calls.sent[0].content.text, /save කරන්න බැරි/)
  await feedSame(g, conn, A, 'spam', 10) // and it really enforces
  assert.equal(conn.calls.removed.length, 1)
})

test('handleUpsert: only "notify" batches are processed', async () => {
  const g = makeGuard(['antibot'])
  const conn = makeConn()
  await g.handleUpsert(conn, { type: 'append', messages: [msg(A, 'old', { device: 'web' })] })
  assert.equal(conn.calls.deleted.length, 0)
  await g.handleUpsert(conn, { type: 'notify', messages: [msg(A, 'live', { device: 'web' })] })
  assert.equal(conn.calls.deleted.length, 1)
  assert.deepEqual(await g.handleUpsert(conn, null), [])
})

test('.devicecheck: reports the device of the replied-to message (and of the command itself)', async () => {
  const g = makeGuard()
  const conn = makeConn()
  const webId = ID.web()
  const m = msg(A, null, { message: { extendedTextMessage: { text: '.devicecheck', contextInfo: { stanzaId: webId, participant: B } } } })
  const r = await g.handleDeviceCheck(conn, m)
  assert.deepEqual([r.id, r.device, r.blocked], [webId, 'web', true])
  assert.match(conn.calls.sent[0].content.text, /web/)
  const r2 = await g.handleDeviceCheck(conn, msg(A, '.devicecheck', { device: 'android' }))
  assert.deepEqual([r2.device, r2.blocked], ['android', false])
})

/* ═════════════════════════ plugin wrapper (cmd() style) ═════════════════════════ */
test('plugin: registers commands + watchers and works end-to-end through the template-style dispatcher', async () => {
  const root = tmpDir()
  fs.mkdirSync(path.join(root, 'plugins'))
  fs.writeFileSync(
    path.join(root, 'command.js'),
    'const commands=[];function cmd(i,f){i.function=f;commands.push(i);return i}module.exports={cmd,commands}'
  )
  for (const f of ['antiguard.js', 'antiguard-core.js']) fs.copyFileSync(path.join(__dirname, '..', 'plugins', f), path.join(root, 'plugins', f))
  const saved = { db: process.env.ANTIGUARD_DB, owner: process.env.OWNER_NUMBER }
  process.env.ANTIGUARD_DB = path.join(root, 'db.json')
  process.env.OWNER_NUMBER = '94770000002'
  try {
    require(path.join(root, 'plugins', 'antiguard.js'))
  } finally {
    saved.db === undefined ? delete process.env.ANTIGUARD_DB : (process.env.ANTIGUARD_DB = saved.db)
    saved.owner === undefined ? delete process.env.OWNER_NUMBER : (process.env.OWNER_NUMBER = saved.owner)
  }
  const { commands } = require(path.join(root, 'command.js'))
  const patterns = commands.filter((c) => c.pattern).map((c) => c.pattern).sort()
  assert.deepEqual(patterns, ['antibot', 'antispam', 'devicecheck'])
  const watchers = commands.filter((c) => c.on)
  for (const on of ['body', 'image', 'sticker']) assert.ok(watchers.some((w) => w.on === on), 'watcher for ' + on)
  assert.ok(watchers.every((w) => w.dontAddCommandList))

  const conn = makeConn()
  const run = (c, m, ctx) => commands.find((x) => x.pattern === c).function(conn, m, {}, ctx)
  // template passes q = text after the command
  await run('antispam', cmdMsg(ADMIN, '.antispam on'), { q: 'on', isOwner: false })
  await run('antibot', cmdMsg(ADMIN, '.antibot on'), { q: 'on', isOwner: false })
  assert.equal(conn.calls.sent.length, 2)

  // template fires ALL matching watchers for one message (body + image) -> must count once
  const fire = async (m) => { for (const w of watchers) await w.function(conn, m, {}, {}) }
  const spams = Array.from({ length: 10 }, () => msg(A, 'spam'))
  for (let i = 0; i < 9; i++) await fire(spams[i])
  assert.equal(conn.calls.removed.length, 0, 'double-firing watchers must not double count')
  await fire(spams[9])
  assert.equal(conn.calls.removed.length, 1)

  await fire(msg(B, 'from web', { device: 'web' }))
  assert.equal(conn.calls.deleted.length, 1)
})

/* ═════════════════════════ differential fuzz test ═════════════════════════ */
// Random chat (spammers + normal people + web/android/ios/desktop devices) run through the guard,
// and compared against a tiny, independent "naive" reference implementation.
function prng(seed) {
  let s = seed >>> 0
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0
    return s / 2 ** 32
  }
}

test('fuzz: guard == naive reference implementation (5 seeds x 4000 random messages, both features ON)', async () => {
  let totalRemovals = 0
  let totalDeletes = 0
  for (const seed of [1, 2, 3, 4, 5]) {
    const rnd = prng(seed)
    const c = clock()
    const g = makeGuard(['antispam', 'antibot'], { now: c.now, spamCooldownMs: 1, spamGapMs: 1e12, noticeCooldownMs: 0 })
    const users = Array.from({ length: 40 }, (_, i) => `9477${1000000 + i}@s.whatsapp.net`)
    const isAdmin = (i) => i < 2
    const conn = makeConn({
      participants: [{ id: BOT_PLAIN, admin: 'admin' }, ...users.map((u, i) => ({ id: u, admin: isAdmin(i) ? 'admin' : null }))],
    })
    const lastText = new Map()
    const run = new Map()
    const expectedRemovals = []
    const expectedDeletes = []

    for (let n = 0; n < 4000; n++) {
      c.advance(1000)
      const ui = Math.floor(rnd() * users.length)
      const u = users[ui]
      const spammer = ui % 5 === 0
      const prev = lastText.get(u)
      const text = prev && rnd() < (spammer ? 0.93 : 0.3) ? prev : 'w' + Math.floor(rnd() * 4)
      const device = ['web', 'android', 'ios', 'desktop'][Math.floor(rnd() * 4)]
      const m = msg(u, text, { device })

      // ── reference model ──
      run.set(u, prev === text ? (run.get(u) || 0) + 1 : 1)
      lastText.set(u, text)
      if (run.get(u) >= 10) {
        run.set(u, 0)
        if (!isAdmin(ui)) expectedRemovals.push(u)
      }
      if (device === 'web' && !isAdmin(ui)) expectedDeletes.push(m.key.id)

      await g.handleMessage(conn, m)
    }
    assert.deepEqual(conn.calls.removed.map((r) => r.users[0]), expectedRemovals, `removals differ (seed ${seed})`)
    assert.deepEqual(conn.calls.deleted.map((d) => d.key.id), expectedDeletes, `deletions differ (seed ${seed})`)
    totalRemovals += expectedRemovals.length
    totalDeletes += expectedDeletes.length
  }
  assert.ok(totalRemovals > 20, 'fuzz must actually exercise removals (got ' + totalRemovals + ')')
  assert.ok(totalDeletes > 1000, 'fuzz must actually exercise deletions (got ' + totalDeletes + ')')
  console.log(`# fuzz exercised ${totalRemovals} removals and ${totalDeletes} deletions, all matched the reference model`)
})
