'use strict'
// Run:  node --test test/extras.test.js        (Node 18+)
// ffmpeg ඇත්තටම run කරන tests, machine එකේ ffmpeg නැත්නම් auto-skip වෙනවා.
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
const { spawnSync } = require('child_process')
const X = require('../plugins/extras-core')
const { Extras, normalizeNumber, classifyBan, checkBan, buildStickerExif, addStickerExif, makeSticker, webpToPng, runFfmpeg, findMedia } = X

/* ───────────────────────── fixtures (ffmpeg වලින් හදපු පොඩි WebP files) ───────────────────────── */
const FX = {
  lossy: Buffer.from('UklGRigBAABXRUJQVlA4IBwBAACQBQCdASoYAAoAPrVInkmnJCKhMAgA4BaJbACdMoGsV7oB1kv7AekZ7H1YAA7fCfag4rd1UAD+99tmZhcd39gMt73e6ph2mxCtaQOBGDwvzm0c87irnccUySVkdyu9bY100yOD/DugaxRIL7YKOi7ulRdgFoM1gioJ0kpv1//y1lFjf//gT5Eo9HqFmXlXpFnmG0Nl/5YnyLp0ogBUMJNfzAUDvxDOjwBT65RWH/527/3EIsaR/8TgoS97dReiyzuIHmJ961xDs7/NO7+3uvLHGLL8u3KJf/DLiGEafTN7vatjeF0n8oJ5in5C/dQ/4i/r/n/voJGmyniUvYsv7Df9AXVrwd91gOIDwxXHV77/Y5GWzH/YyQ+/uUAAAA==', 'base64'), // VP8                 (simple lossy)
  lossless: Buffer.from('UklGRnIAAABXRUJQVlA4TGYAAAAvE8ACAGAUSVKk8oIdvGAHL9jBR3HuvX+EbCRpcM7gxN7gxd7gkeqokSRHChDLzrPz7M7+sv8DQQgBQAhRlIgYA5al1GQdgjusE/AXEMlU/LxcNthmj/1LpQrFxIkXXtgxXnPpSgE=', 'base64'), // VP8L               (simple lossless)
  alpha: Buffer.from('UklGRmwAAABXRUJQVlA4WAoAAAAQAAAAEQAADQAAQUxQSAoAAAABB9C/iAhERP8DVlA4IDwAAADQAgCdASoSAA4APrVInkmnJCKhMAgA4BaJQBdgBbHAAP7svY/jf6tfJjIP/rgP/+cB//zgP5bDaFAAAAA=', 'base64'), // VP8X + ALPH + VP8
  anim: Buffer.from('UklGRqYDAABXRUJQVlA4WAoAAAASAAAAFQAADwAAQU5JTQYAAAD/////AABBTk1GJAEAAAAAAAAAABUAAA8AAGQAAABWUDggDAEAAHAGAJ0BKhYAEAA+tUieSackIqEwCADgFolsAJ0dgFak8AB+sHpM+w1+nv+w/xnssu9ACqCAGh7V23thAAD+98wFyZNg6jJWMdjpnT/xn1DQa3jdWGifk9NXIkCNyq8ho+TBKqV9Cnu5zJJuHduzXIYzckgrMzhB7f/d5l8Om3R/E6ax1HZa/PpRtdaSKci3kvQfrXxPZ6sStvx84sfQu3Pa7AHEBy/yQO0WDv/F6TxmsoitB9yP6ihcCO0//7srzLYftfQtN4aYZlop6/pH2p/+j5Zb8lWNzjcf02f/Vvih6i5S9Kz5ZiRMfxfy030J8V64du/5lw/9+KHHvhJvBSn/99P7D/JyZ6AAAABBTk1GIgEAAAAAAAAAABUAAA8AAGQAAABWUDggCgEAABAGAJ0BKhYAEAA+tUieSackIqEwCADgFolsAJ0PZJ4AD9YPSI/Wb4Ev1A/1X+Z9lwCcmpfSHmCgZAD+99tmZ4QWVvTszsdVAV/xn2SQjfFJVlWHvsfv/bQmSVTv3Ovv1BRpU5pq/fE0C92bnos+JvL8laxwktU+P/7eZfDpuJSXTZRECQP3agGiFt1B/x6SkyfrXyFqBdpxqYPnFaCWTvOnwDbjOmSg8Zl/4volaelyZVsZOf+KK6b89P/+7K8z3gHa+haW8prWvRaTvt/6MH+7ba+v6LDEDkb9MDf1b50eksdu7KXon677pb7zYZdcQcl9ss3/kntXGLw4nr5//Lv/P/5OTOgAAAAAQU5NRiQBAAAAAAAAAAAVAAAPAABkAAAAVlA4IAwBAABQBgCdASoWABAAPrVInkmnJCKhMAgA4BaJbACdD2VeAA/WD0eP2A+Bz9RP9v/mfZmuzwKOal9IeYKBkAD+99tmZYUug30IKVtmLX+M5+GZzwiMgOs/owYrqvoS9U79zru1oSwE8Ba3sLaxjGt2scSYWcTR+YUUn8//3eZfDpuJSXS4yWcof8GoSnqLGRSn3pKTX+tfTDWD7U+My9cVDC0RNHVnp/3POLc1Z/8YUzyXCEEhuUCX9RQuBHaf/4PW+dW72voWgcpPvLjH398S+sNP0Zt5+gvXYDu+m2aj/P8GAqeKI+QAG3Av/N/O2fSlFnrisNfsM0f8lHcSC7Ye8eao//fF/kf6nJnQAAAA', 'base64'), // VP8X + ANIM + ANMF x3
}
const FX_DIMS = { lossy: [24, 10], lossless: [20, 12], alpha: [18, 14], anim: [22, 16] } // width x height (හතරැස් නෙවෙයි, width/height මාරු වුණොත් අහුවෙන්න)
const HAS_FFMPEG = spawnSync('ffmpeg', ['-version']).status === 0
const needFfmpeg = { skip: HAS_FFMPEG ? false : 'ffmpeg installed නැහැ' }

/* ───────────────────────── helpers ───────────────────────── */
const GROUP = '120363111111111111@g.us'
const BOT = '94700000000:7@s.whatsapp.net'
const BOT_PLAIN = '94700000000@s.whatsapp.net'
const ADMIN = '94770000001@s.whatsapp.net'
const OWNER = '94770000002@s.whatsapp.net'
const ADMIN2 = '94770000003@s.whatsapp.net'
const A = '94771111111@s.whatsapp.net'
const B = '94772222222@s.whatsapp.net'
const C = '94773333333@s.whatsapp.net'

const hex = (n) => crypto.randomBytes(n).toString('hex').toUpperCase().slice(0, n)
const quiet = () => ({ info() {}, warn() {}, error() {} })
const capture = () => {
  const logs = { info: [], warn: [], error: [] }
  return { logs, info: (...a) => logs.info.push(a.join(' ')), warn: (...a) => logs.warn.push(a.join(' ')), error: (...a) => logs.error.push(a.join(' ')) }
}
const clock = (t = 1_700_000_000_000) => {
  const c = { t, now: () => c.t, advance(ms) { c.t += ms } }
  return c
}
const wsxDirs = () => fs.readdirSync(os.tmpdir()).filter((n) => n.startsWith('wsx-')).length
const tmpDir = () => fs.mkdtempSync(path.join(os.tmpdir(), 'extras-test-'))

function makeConn(o = {}) {
  const calls = { sent: [], removed: [], meta: 0 }
  const participants = o.participants || [
    { id: BOT_PLAIN, admin: o.botAdmin === false ? null : 'admin' },
    { id: ADMIN, admin: 'admin' },
    { id: ADMIN2, admin: 'superadmin' },
    { id: OWNER, admin: null },
    { id: A, admin: null },
    { id: B, admin: null },
    { id: C, admin: null },
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
      calls.sent.push({ jid, content, opts })
      return {}
    },
    async groupParticipantsUpdate(jid, users, action) {
      if (o.removeError) throw new Error('forbidden')
      calls.removed.push({ jid, users: [...users], action })
      return users.map((u) => ({ status: (o.statusFor && o.statusFor(u)) || '200', jid: u }))
    },
  }
}
const makeExtras = (o = {}) => new Extras({ log: quiet(), ownerNumbers: ['94770000002'], ...o })

const cmdMsg = (sender, text, o = {}) => ({
  key: { remoteJid: o.group || GROUP, fromMe: !!o.fromMe, id: o.id || hex(32), participant: sender },
  message: o.message || { conversation: text },
})
const replyMsg = (sender, text, quotedParticipant, quotedMessage = { conversation: 'hi' }) =>
  cmdMsg(sender, text, { message: { extendedTextMessage: { text, contextInfo: { stanzaId: 'Q1', participant: quotedParticipant, quotedMessage } } } })
const mentionMsg = (sender, text, jids, quoted) =>
  cmdMsg(sender, text, { message: { extendedTextMessage: { text, contextInfo: { mentionedJid: jids, ...(quoted || {}) } } } })
const lastText = (conn) => conn.calls.sent[conn.calls.sent.length - 1].content.text

/* ── independent WebP/RIFF parser used by the assertions ── */
function riff(buf) {
  assert.equal(buf.toString('ascii', 0, 4), 'RIFF')
  assert.equal(buf.toString('ascii', 8, 12), 'WEBP')
  assert.equal(buf.readUInt32LE(4), buf.length - 8, 'RIFF size field == file size - 8')
  const chunks = []
  let off = 12
  while (off < buf.length) {
    assert.ok(off + 8 <= buf.length, 'chunk header fits')
    const id = buf.toString('ascii', off, off + 4)
    const size = buf.readUInt32LE(off + 4)
    assert.ok(off + 8 + size <= buf.length, 'chunk data fits')
    chunks.push({ id, size, data: buf.subarray(off + 8, off + 8 + size) })
    off += 8 + size + (size & 1)
    if (size & 1) assert.equal(buf[off - 1], 0, 'pad byte must be 0')
  }
  assert.equal(off, buf.length, 'chunks fill the file exactly')
  return chunks
}
const canvas = (chunks) => {
  assert.equal(chunks[0].id, 'VP8X', 'first chunk must be VP8X')
  const d = chunks[0].data
  return { flags: d[0], width: d.readUIntLE(4, 3) + 1, height: d.readUIntLE(7, 3) + 1 }
}
const exifJson = (chunk) => {
  const d = chunk.data
  assert.equal(d.toString('hex', 0, 4), '49492a00', 'TIFF header')
  assert.equal(d.length, 22 + d.readUInt32LE(14), 'EXIF length field')
  return JSON.parse(d.subarray(22).toString('utf8'))
}
function padWebp(base, minSize) {
  if (base.length >= minSize) return base
  const extra = minSize - base.length - 8
  const junk = Buffer.alloc(8)
  junk.write('JUNK', 0, 4, 'ascii')
  junk.writeUInt32LE(extra, 4)
  const body = Buffer.concat([base.subarray(8), junk, Buffer.alloc(extra), extra & 1 ? Buffer.alloc(1) : Buffer.alloc(0)])
  const head = Buffer.alloc(8)
  head.write('RIFF', 0, 4, 'ascii')
  head.writeUInt32LE(body.length, 4)
  return Buffer.concat([head, body])
}

/** ffmpeg වෙනුවට fake: output file එකට fixture webp එකක් ලියනවා (q අනුව size එක පාලනය කරන්න පුළුවන්) */
function fakeFfmpeg({ sizes = {}, fail, delay = 0 } = {}) {
  const calls = []
  let active = 0
  const state = { max: 0 }
  const run = async (args) => {
    calls.push(args)
    active++
    state.max = Math.max(state.max, active)
    try {
      if (delay) await new Promise((r) => setTimeout(r, delay))
      if (fail) throw Object.assign(new Error(fail.message || 'boom'), { code: fail.code || 'FFMPEG_FAILED' })
      const out = args[args.length - 1]
      if (out.endsWith('.png')) return fs.promises.writeFile(out, Buffer.from('89504e470d0a1a0a0000000d49484452', 'hex'))
      const base = args.includes('-loop') ? FX.anim : FX.lossy
      const q = Number(args[args.indexOf('-q:v') + 1])
      await fs.promises.writeFile(out, sizes[q] ? padWebp(base, sizes[q]) : base)
    } finally {
      active--
    }
  }
  run.calls = calls
  run.state = state
  return run
}
const stickerExtras = (o = {}) => {
  const downloads = []
  const run = o.run || fakeFfmpeg()
  const ex = makeExtras({
    ...o.opts,
    deps: { download: async (node, kind) => { downloads.push({ node, kind }); if (o.downloadError) throw new Error('download failed'); return Buffer.from('fake-media-bytes') }, runFfmpeg: run },
  })
  return { ex, run, downloads }
}
const imageMsg = (caption = '.sticker', node = {}) => cmdMsg(A, caption, { message: { imageMessage: { caption, mimetype: 'image/jpeg', fileLength: 5000, ...node } } })
const quotedVideoMsg = (text = '.sticker', node = {}) => replyMsg(A, text, B, { videoMessage: { mimetype: 'video/mp4', fileLength: 9000, seconds: 5, ...node } })

/* ═════════════════════════ 1. number normalisation + ban classification ═════════════════════════ */
test('normalizeNumber: accepted formats', () => {
  const ok = {
    '94771234567': '94771234567',
    '+94 77 123 4567': '94771234567',
    '0771234567': '94771234567',
    '0094771234567': '94771234567',
    '(94) 77-123-4567': '94771234567',
    '+1 (415) 555-2671': '14155552671',
  }
  for (const [input, want] of Object.entries(ok)) assert.equal(normalizeNumber(input), want, input)
  assert.equal(normalizeNumber('0711234567', '91'), '91711234567', 'custom default country code')
})

test('normalizeNumber: rejected input', () => {
  for (const bad of ['', '   ', 'abc', '12', '1234567', '1234567890123456', null, undefined]) assert.equal(normalizeNumber(bad), null, String(bad))
})

test('classifyBan: real ACTIVE response (captured from the live site) + other shapes', () => {
  const live = { creator: 'github.com/udmodz0', number: '94771234567', cc: '94', phone: '771234567', status: 'ACTIVE', details: 'Valid / Active Number (Not Banned)', accountType: 'Normal' }
  assert.equal(classifyBan(live).state, 'active')
  assert.equal(classifyBan(live).accountType, 'Normal')
  const table = [
    [{ status: 'BANNED', details: 'Number is Banned' }, 'banned'],
    [{ status: 'banned' }, 'banned'],
    [{ status: 'RESTRICTED' }, 'banned'],
    [{ status: 'UNKNOWNX', details: 'This number is banned from WhatsApp' }, 'banned'],
    [{ status: 'UNBANNED' }, 'active'],
    [{ status: 'NOT_BANNED' }, 'active'],
    [{ status: 'X', details: 'Number is not banned' }, 'active'],
    [{ status: 'VALID' }, 'active'],
    [{ status: 'NOT_REGISTERED' }, 'unregistered'],
    [{ status: 'INVALID', details: 'Invalid number' }, 'unregistered'],
    [{ status: 'X', details: 'Number is not on WhatsApp' }, 'unregistered'],
    [{ status: 'SOMETHING_NEW' }, 'unknown'],
    [{}, 'unknown'],
    [null, 'unknown'],
    ['str', 'unknown'],
  ]
  for (const [input, want] of table) assert.equal(classifyBan(input).state, want, JSON.stringify(input))
})

/* ═════════════════════════ 2. checkBan (HTTP client) ═════════════════════════ */
const jsonRes = (obj, status = 200) => ({ ok: status >= 200 && status < 300, status, text: async () => (typeof obj === 'string' ? obj : JSON.stringify(obj)) })
const LIVE = { creator: 'github.com/udmodz0', number: '94771234567', cc: '94', phone: '771234567', status: 'ACTIVE', details: 'Valid / Active Number (Not Banned)', accountType: 'Normal' }

test('checkBan: calls the right URL and returns the JSON', async () => {
  const seen = []
  const fetchImpl = async (url, init) => { seen.push({ url, init }); return jsonRes(LIVE) }
  const data = await checkBan('94771234567', { fetchImpl })
  assert.deepEqual(data, LIVE)
  assert.equal(seen[0].url, 'https://wptest.udmodz-2ab.workers.dev/test?number=94771234567')
  assert.equal(seen[0].init.headers.accept, 'application/json')
})

test('checkBan: errors are classified (HTTP / bad JSON / array JSON / network / timeout)', async () => {
  await assert.rejects(checkBan('1', { fetchImpl: async () => jsonRes({ error: 'x' }, 500) }), { code: 'HTTP', status: 500 })
  await assert.rejects(checkBan('1', { fetchImpl: async () => jsonRes('<html>nope</html>') }), { code: 'BAD_JSON' })
  await assert.rejects(checkBan('1', { fetchImpl: async () => jsonRes([1, 2]) }), { code: 'BAD_JSON' })
  await assert.rejects(checkBan('1', { fetchImpl: async () => { throw new Error('ECONNRESET') } }), /ECONNRESET/)
  const hang = (url, { signal }) => new Promise((_, rej) => signal.addEventListener('abort', () => rej(Object.assign(new Error('aborted'), { name: 'AbortError' }))))
  await assert.rejects(checkBan('1', { fetchImpl: hang, timeoutMs: 30 }), { code: 'TIMEOUT' })
})

/* ═════════════════════════ 3. .bancheck command ═════════════════════════ */
test('.bancheck: ACTIVE number -> formatted reply, one API call', async () => {
  const urls = []
  const ex = makeExtras({ deps: { fetch: async (u) => { urls.push(u); return jsonRes(LIVE) } } })
  const conn = makeConn()
  const r = await ex.bancheck(conn, cmdMsg(A, '.bancheck 94771234567'), '94771234567')
  assert.deepEqual([r.ok, r.state], [true, 'active'])
  assert.equal(urls.length, 1)
  const t = lastText(conn)
  for (const s of ['+94771234567', 'ACTIVE', 'Ban වෙලා නැහැ', 'Valid / Active Number (Not Banned)', 'Normal', '+94']) assert.ok(t.includes(s), 'reply contains ' + s)
  assert.deepEqual(conn.calls.sent[0].opts.quoted.key.remoteJid, GROUP)
})

test('.bancheck: local format 0771234567 is converted; arg parsed from message text when not supplied', async () => {
  const urls = []
  const ex = makeExtras({ deps: { fetch: async (u) => { urls.push(u); return jsonRes(LIVE) } } })
  await ex.bancheck(makeConn(), cmdMsg(A, '.bancheck 0771234567'))
  assert.ok(urls[0].endsWith('number=94771234567'))
})

test('.bancheck: bad number / no number -> help text, API NOT called', async () => {
  let called = 0
  const ex = makeExtras({ deps: { fetch: async () => { called++; return jsonRes(LIVE) } } })
  const conn = makeConn()
  assert.equal((await ex.bancheck(conn, cmdMsg(A, '.bancheck abc'), 'abc')).reason, 'bad-number')
  assert.equal((await ex.bancheck(conn, cmdMsg(A, '.bancheck 12'), '12')).reason, 'bad-number')
  assert.equal((await ex.bancheck(conn, cmdMsg(A, '.bancheck'), '')).reason, 'usage')
  assert.match(conn.calls.sent[0].content.text, /Country code/)
  assert.match(conn.calls.sent[2].content.text, /භාවිතය/)
  assert.equal(called, 0)
})

test('.bancheck: reply to someone -> uses their number; hidden LID -> asks to type the number', async () => {
  const urls = []
  const ex = makeExtras({ deps: { fetch: async (u) => { urls.push(u); return jsonRes(LIVE) } } })
  const conn = makeConn()
  await ex.bancheck(conn, replyMsg(A, '.bancheck', B), '')
  assert.ok(urls[0].endsWith('number=94772222222'))
  const r = await ex.bancheck(conn, replyMsg(C, '.bancheck', '555222333:4@lid'), '')
  assert.equal(r.reason, 'lid')
  assert.equal(urls.length, 1)
})

test('.bancheck: banned / unknown responses are shown correctly (unknown is shown raw, never guessed)', async () => {
  const conn = makeConn()
  let reply = { status: 'BANNED', details: 'Number is Banned', cc: '94', accountType: 'Normal' }
  const ex = makeExtras({ banCooldownMs: 0, deps: { fetch: async () => jsonRes(reply) } })
  await ex.bancheck(conn, cmdMsg(A, ''), '94771234567')
  assert.match(lastText(conn), /🚫 BANNED/)
  reply = { status: 'WEIRD_NEW_STATUS', details: 'something new' }
  const r = await ex.bancheck(conn, cmdMsg(A, ''), '94771234567')
  assert.equal(r.state, 'unknown')
  assert.match(lastText(conn), /❔ WEIRD_NEW_STATUS/)
  assert.match(lastText(conn), /something new/)
})

test('.bancheck: site failures -> friendly message, no throw', async () => {
  const conn = makeConn()
  const cases = [
    [async () => jsonRes({ e: 1 }, 500), /HTTP 500/],
    [async () => jsonRes('not json'), /වැරදි response/],
    [async () => { throw new Error('ENOTFOUND') }, /network error/],
    [(u, { signal }) => new Promise((_, rej) => signal.addEventListener('abort', () => rej(Object.assign(new Error('x'), { name: 'AbortError' })))), /respond කළේ නැහැ/],
  ]
  for (const [fetchFn, re] of cases) {
    const ex = makeExtras({ banTimeoutMs: 30, banCooldownMs: 0, deps: { fetch: fetchFn } })
    const r = await ex.bancheck(conn, cmdMsg(A, ''), '94771234567')
    assert.equal(r.ok, false)
    assert.match(lastText(conn), re)
  }
})

test('.bancheck: cooldown per sender (10s)', async () => {
  const c = clock()
  let calls = 0
  const ex = makeExtras({ now: c.now, deps: { fetch: async () => { calls++; return jsonRes(LIVE) } } })
  const conn = makeConn()
  await ex.bancheck(conn, cmdMsg(A, ''), '94771234567')
  const r = await ex.bancheck(conn, cmdMsg(A, ''), '94771234567')
  assert.equal(r.reason, 'cooldown')
  assert.match(lastText(conn), /⏳/)
  assert.equal(calls, 1)
  await ex.bancheck(conn, cmdMsg(B, ''), '94771234567') // other sender is unaffected
  assert.equal(calls, 2)
  c.advance(10_001)
  await ex.bancheck(conn, cmdMsg(A, ''), '94771234567')
  assert.equal(calls, 3)
})

test('.bancheck: invalid input does not burn the cooldown', async () => {
  const ex = makeExtras({ deps: { fetch: async () => jsonRes(LIVE) } })
  const conn = makeConn()
  await ex.bancheck(conn, cmdMsg(A, ''), 'abc')
  const r = await ex.bancheck(conn, cmdMsg(A, ''), '94771234567')
  assert.equal(r.ok, true)
})

/* ═════════════════════════ 4. WebP EXIF writer ═════════════════════════ */
test('buildStickerExif: WhatsApp header + JSON (Sinhala + emoji safe)', () => {
  const e = buildStickerExif({ pack: 'මගේ Pack 😀', author: 'ඩිලාන්', id: 'abc' })
  assert.equal(e.subarray(0, 22).toString('hex'), '49492a0008000000010041570700' + e.subarray(14, 18).toString('hex') + '16000000')
  const j = JSON.parse(e.subarray(22).toString('utf8'))
  assert.deepEqual(j, { 'sticker-pack-id': 'abc', 'sticker-pack-name': 'මගේ Pack 😀', 'sticker-pack-publisher': 'ඩිලාන්', emojis: [] })
  assert.equal(e.readUInt32LE(14), e.length - 22)
  assert.match(JSON.parse(buildStickerExif({ pack: 'a', author: 'b' }).subarray(22).toString())['sticker-pack-id'], /^[0-9a-f]{32}$/)
})

test('addStickerExif: every WebP layout (VP8 / VP8L / VP8X+ALPH / animated) gets a valid EXIF chunk', () => {
  const exif = buildStickerExif({ pack: 'Pack', author: 'Me', id: 'x' })
  for (const [name, fx] of Object.entries(FX)) {
    const before = riff(fx)
    const out = addStickerExif(fx, exif)
    const after = riff(out)
    const cv = canvas(after)
    assert.ok(cv.flags & 0x08, name + ': EXIF flag set')
    assert.deepEqual([cv.width, cv.height], FX_DIMS[name], name + ': canvas size')
    assert.equal(after[after.length - 1].id, 'EXIF', name + ': EXIF is the last chunk')
    assert.equal(after.filter((c) => c.id === 'EXIF').length, 1)
    assert.deepEqual(exifJson(after[after.length - 1]).emojis, [])
    // image data chunks must be byte-identical and in the same order
    const keep = (cs) => cs.filter((c) => c.id !== 'VP8X' && c.id !== 'EXIF').map((c) => c.id + ':' + c.data.toString('hex'))
    assert.deepEqual(keep(after), keep(before), name + ': image chunks untouched')
    if (before[0].id === 'VP8X') assert.equal(cv.flags, before[0].data[0] | 0x08, name + ': other VP8X flags preserved')
  }
  assert.ok(canvas(riff(addStickerExif(FX.anim, exif))).flags & 0x02, 'animation flag kept')
  assert.equal(canvas(riff(addStickerExif(FX.lossy, exif))).flags, 0x08)
})

test('addStickerExif: input not mutated; adding twice replaces (not duplicates) the EXIF', () => {
  const copy = Buffer.from(FX.lossy)
  const once = addStickerExif(FX.lossy, buildStickerExif({ pack: 'One', author: 'a' }))
  assert.deepEqual(FX.lossy, copy)
  const twice = addStickerExif(once, buildStickerExif({ pack: 'Two', author: 'b' }))
  const cs = riff(twice)
  assert.equal(cs.filter((c) => c.id === 'EXIF').length, 1)
  assert.equal(exifJson(cs[cs.length - 1])['sticker-pack-name'], 'Two')
})

test('addStickerExif: odd / even payload sizes keep the RIFF container valid (padding)', () => {
  const seen = new Set()
  for (let n = 1; n <= 8; n++) {
    const exif = buildStickerExif({ pack: 'p'.repeat(n), author: 'a' })
    seen.add(exif.length & 1)
    for (const fx of Object.values(FX)) riff(addStickerExif(fx, exif)) // riff() asserts sizes + zero padding
  }
  assert.equal(seen.size, 2, 'both odd and even payload lengths were exercised')
})

test('addStickerExif: rejects non-WebP / truncated / empty WebP', () => {
  const exif = buildStickerExif({ pack: 'a', author: 'b' })
  for (const bad of [Buffer.from('hello'), Buffer.alloc(100), FX.lossy.subarray(0, 40), 'nope', null]) {
    assert.throws(() => addStickerExif(bad, exif), { code: 'BAD_WEBP' })
  }
  const noImage = Buffer.concat([Buffer.from('RIFF'), Buffer.from([12, 0, 0, 0]), Buffer.from('WEBPJUNK'), Buffer.from([0, 0, 0, 0])])
  assert.throws(() => addStickerExif(noImage, exif), { code: 'BAD_WEBP' })
})

/* ═════════════════════════ 5. media finder ═════════════════════════ */
test('findMedia: own media, quoted media, view-once is blocked, unsupported types ignored', () => {
  assert.equal(findMedia(imageMsg()).source, 'self')
  assert.equal(findMedia(quotedVideoMsg()).kind, 'video')
  assert.equal(findMedia(quotedVideoMsg()).source, 'quoted')
  assert.equal(findMedia(replyMsg(A, '.s', B, { stickerMessage: { isAnimated: false } })).kind, 'sticker')
  assert.deepEqual(findMedia(imageMsg('.s', { viewOnce: true })), { blocked: 'viewonce' })
  assert.deepEqual(findMedia(replyMsg(A, '.s', B, { imageMessage: { viewOnce: true } })), { blocked: 'viewonce' })
  assert.deepEqual(findMedia(replyMsg(A, '.s', B, { viewOnceMessageV2: { message: { imageMessage: {} } } })), { blocked: 'viewonce' })
  assert.equal(findMedia(cmdMsg(A, '.s')), null)
  assert.equal(findMedia(replyMsg(A, '.s', B, { conversation: 'text only' })), null)
  assert.equal(findMedia(replyMsg(A, '.s', B, { audioMessage: {} })), null)
  assert.equal(findMedia(null), null)
  // ephemeral wrapper around the command message is handled
  const eph = cmdMsg(A, '', { message: { ephemeralMessage: { message: { imageMessage: { caption: '.s' } } } } })
  assert.equal(findMedia(eph).kind, 'image')
})

/* ═════════════════════════ 6. .sticker command (fake ffmpeg) ═════════════════════════ */
test('.sticker: image in the command message -> static sticker with default pack/author EXIF', async () => {
  const { ex, run, downloads } = stickerExtras()
  const conn = makeConn()
  const r = await ex.sticker(conn, imageMsg(), '')
  assert.deepEqual([r.ok, r.animated], [true, false])
  assert.equal(downloads.length, 1)
  assert.equal(downloads[0].kind, 'image')
  const sent = conn.calls.sent.find((s) => s.content.sticker)
  assert.ok(Buffer.isBuffer(sent.content.sticker))
  assert.ok(sent.opts.quoted, 'sticker is a reply to the command')
  const cs = riff(sent.content.sticker)
  assert.deepEqual(exifJson(cs[cs.length - 1]).emojis, [])
  assert.equal(exifJson(cs[cs.length - 1])['sticker-pack-name'], 'Sticker Pack')
  assert.equal(exifJson(cs[cs.length - 1])['sticker-pack-publisher'], 'WhatsApp Bot')
  const args = run.calls[0]
  assert.ok(!args.includes('-loop'))
  assert.ok(args.includes('libwebp'))
  assert.match(args[args.indexOf('-vf') + 1], /pad=512:512/)
  assert.ok(args[args.indexOf('-i') + 1].endsWith('.jpg'), 'extension chosen from mimetype')
})

test('.sticker: quoted video -> animated sticker (loop, fps, duration limit), animation flag kept', async () => {
  const { ex, run } = stickerExtras({ opts: { maxVideoSeconds: 6 } })
  const conn = makeConn()
  const r = await ex.sticker(conn, quotedVideoMsg(), '')
  assert.deepEqual([r.ok, r.animated], [true, true])
  const args = run.calls[0]
  assert.ok(args.includes('-loop'))
  assert.equal(args[args.indexOf('-t') + 1], '6')
  assert.match(args[args.indexOf('-vf') + 1], /^fps=15,/)
  assert.ok(args[args.indexOf('-i') + 1].endsWith('.mp4'))
  const cs = riff(conn.calls.sent[0].content.sticker)
  assert.ok(canvas(cs).flags & 0x02)
})

test('.sticker: arguments — crop mode and pack|author (Sinhala ok)', async () => {
  const { ex, run } = stickerExtras()
  const conn = makeConn()
  await ex.sticker(conn, imageMsg(), 'crop')
  assert.match(run.calls[0][run.calls[0].indexOf('-vf') + 1], /crop=512:512/)
  assert.doesNotMatch(run.calls[0][run.calls[0].indexOf('-vf') + 1], /pad=/)
  await ex.sticker(conn, imageMsg(), 'crop මගේ Pack|ඩිලාන්')
  let cs = riff(conn.calls.sent[1].content.sticker)
  assert.equal(exifJson(cs[cs.length - 1])['sticker-pack-name'], 'මගේ Pack')
  assert.equal(exifJson(cs[cs.length - 1])['sticker-pack-publisher'], 'ඩිලාන්')
  await ex.sticker(conn, imageMsg(), 'OnlyPack')
  cs = riff(conn.calls.sent[2].content.sticker)
  assert.equal(exifJson(cs[cs.length - 1])['sticker-pack-name'], 'OnlyPack')
  assert.equal(exifJson(cs[cs.length - 1])['sticker-pack-publisher'], 'WhatsApp Bot', 'author falls back to default')
  // control chars stripped, length capped
  await ex.sticker(conn, imageMsg(), 'a\u0000b\nc' + 'x'.repeat(200) + '|z')
  cs = riff(conn.calls.sent[3].content.sticker)
  const name = exifJson(cs[cs.length - 1])['sticker-pack-name']
  assert.ok(name.length <= 60 && !/[\u0000-\u001f]/.test(name))
  // arg parsed from the message text when not supplied
  await ex.sticker(conn, imageMsg('.sticker crop Cap|Tion'))
  cs = riff(conn.calls.sent[4].content.sticker)
  assert.equal(exifJson(cs[cs.length - 1])['sticker-pack-name'], 'Cap')
})

test('.sticker: configured defaults (packName / authorName) are used', async () => {
  const { ex } = stickerExtras({ opts: { packName: 'ඩිලාන්ගේ', authorName: 'MyBot' } })
  const conn = makeConn()
  await ex.sticker(conn, imageMsg(), '')
  const cs = riff(conn.calls.sent[0].content.sticker)
  assert.equal(exifJson(cs[cs.length - 1])['sticker-pack-name'], 'ඩිලාන්ගේ')
  assert.equal(exifJson(cs[cs.length - 1])['sticker-pack-publisher'], 'MyBot')
})

test('.sticker: no media / sticker / audio -> usage; view-once -> refused; nothing downloaded or converted', async () => {
  const { ex, run, downloads } = stickerExtras()
  const conn = makeConn()
  assert.equal((await ex.sticker(conn, cmdMsg(A, '.sticker'), '')).reason, 'usage')
  assert.equal((await ex.sticker(conn, replyMsg(A, '.sticker', B, { stickerMessage: {} }), '')).reason, 'usage')
  assert.equal((await ex.sticker(conn, replyMsg(A, '.sticker', B, { audioMessage: {} }), '')).reason, 'usage')
  assert.equal((await ex.sticker(conn, imageMsg('.s', { viewOnce: true }), '')).reason, 'viewonce')
  assert.equal((await ex.sticker(conn, replyMsg(A, '.s', B, { viewOnceMessage: { message: { videoMessage: {} } } }), '')).reason, 'viewonce')
  assert.match(conn.calls.sent[0].content.text, /Sticker maker/)
  assert.match(conn.calls.sent[3].content.text, /View-once/)
  assert.equal(downloads.length + run.calls.length, 0)
})

test('.sticker: file too large is refused BEFORE downloading (number and Long-like fileLength)', async () => {
  const { ex, downloads } = stickerExtras()
  const conn = makeConn()
  assert.equal((await ex.sticker(conn, imageMsg('.s', { fileLength: 16 * 1024 * 1024 }), '')).reason, 'too-big')
  assert.equal((await ex.sticker(conn, imageMsg('.s', { fileLength: { toNumber: () => 99_999_999 } }), '')).reason, 'too-big')
  assert.match(lastText(conn), /15MB/)
  assert.equal(downloads.length, 0)
})

test('.sticker: failures (no ffmpeg / ffmpeg error / download error / send error) -> friendly message, never throws', async () => {
  const conn = makeConn()
  let r = await stickerExtras({ run: fakeFfmpeg({ fail: { code: 'NO_FFMPEG' } }) }).ex.sticker(conn, imageMsg(), '')
  assert.deepEqual([r.ok, r.reason], [false, 'NO_FFMPEG'])
  assert.match(lastText(conn), /ffmpeg/)
  r = await stickerExtras({ run: fakeFfmpeg({ fail: { code: 'FFMPEG_FAILED' } }) }).ex.sticker(conn, imageMsg(), '')
  assert.equal(r.ok, false)
  assert.match(lastText(conn), /corrupt/)
  r = await stickerExtras({ run: fakeFfmpeg({ fail: { code: 'TIMEOUT' } }) }).ex.sticker(conn, imageMsg(), '')
  assert.match(lastText(conn), /timeout/)
  r = await stickerExtras({ downloadError: true }).ex.sticker(conn, imageMsg(), '')
  assert.equal(r.ok, false)
  const brokenConn = makeConn({ sendError: true })
  r = await stickerExtras().ex.sticker(brokenConn, imageMsg(), '')
  assert.equal(r.ok, false)
})

test('.sticker: temp folders are always cleaned up (success and failure)', async () => {
  const before = wsxDirs()
  const conn = makeConn()
  await stickerExtras().ex.sticker(conn, imageMsg(), '')
  await stickerExtras({ run: fakeFfmpeg({ fail: {} }) }).ex.sticker(conn, imageMsg(), '')
  await stickerExtras({ run: fakeFfmpeg({ sizes: { 80: 2_000_000, 60: 2_000_000, 40: 2_000_000 } }) }).ex.sticker(conn, imageMsg(), '')
  assert.equal(wsxDirs(), before)
})

test('.sticker: size attempts — static picks first result ≤100KB; animated first ≤500KB; else smallest ≤1MB; else refused', async () => {
  const conn = makeConn()
  // static: q80 -> 150KB (too big), q60 -> 90KB (ok)
  let f = fakeFfmpeg({ sizes: { 80: 150_000, 60: 90_000 } })
  let r = await stickerExtras({ run: f }).ex.sticker(conn, imageMsg(), '')
  assert.equal(f.calls.length, 2)
  assert.ok(r.bytes <= 100 * 1024 + 400)
  // animated: q60 -> 700KB, q45 -> 450KB
  f = fakeFfmpeg({ sizes: { 60: 700_000, 45: 450_000 } })
  r = await stickerExtras({ run: f }).ex.sticker(conn, quotedVideoMsg(), '')
  assert.equal(f.calls.length, 2)
  assert.ok(r.bytes <= 500 * 1024 + 400)
  // animated: every attempt too big for 500KB but ≤1MB -> all 4 tried, smallest sent
  f = fakeFfmpeg({ sizes: { 60: 900_000, 45: 850_000, 35: 800_000, 25: 820_000 } })
  r = await stickerExtras({ run: f }).ex.sticker(conn, quotedVideoMsg(), '')
  assert.equal(f.calls.length, 4)
  assert.ok(r.ok && r.bytes >= 800_000 && r.bytes < 801_000, 'smallest of the attempts (' + r.bytes + ')')
  // everything above 1MB -> refused, nothing sent
  const sentBefore = conn.calls.sent.length
  f = fakeFfmpeg({ sizes: { 60: 2_000_000, 45: 1_900_000, 35: 1_800_000, 25: 1_700_000 } })
  r = await stickerExtras({ run: f }).ex.sticker(conn, quotedVideoMsg(), '')
  assert.deepEqual([r.ok, r.reason], [false, 'TOO_BIG'])
  assert.equal(conn.calls.sent.length, sentBefore + 1, 'only the error text was sent')
  assert.ok(!conn.calls.sent[conn.calls.sent.length - 1].content.sticker)
})

test('.sticker: total time budget — once exceeded no further attempts are started; best result so far is used', async () => {
  const c = clock()
  const base = fakeFfmpeg({ sizes: { 60: 900_000, 45: 850_000, 35: 800_000, 25: 780_000 } })
  const slow = async (args) => { await base(args); c.advance(40_000) } // every attempt "takes" 40 s
  slow.calls = base.calls
  const { ex } = stickerExtras({ run: slow, opts: { now: c.now, stickerBudgetMs: 90_000 } })
  const conn = makeConn()
  const r = await ex.sticker(conn, quotedVideoMsg(), '')
  assert.equal(base.calls.length, 3, 'attempt 4 must not start after 120s > 90s budget')
  assert.ok(r.ok && r.bytes >= 800_000 && r.bytes < 801_000, 'smallest of the 3 attempts: ' + r.bytes)
  // budget exceeded and nothing small enough -> refused cleanly
  const base2 = fakeFfmpeg({ sizes: { 60: 2_000_000, 45: 2_000_000, 35: 2_000_000, 25: 2_000_000 } })
  const slow2 = async (args) => { await base2(args); c.advance(100_000) }
  const r2 = await stickerExtras({ run: slow2, opts: { now: c.now, stickerBudgetMs: 90_000 } }).ex.sticker(conn, quotedVideoMsg(), '')
  assert.equal(base2.calls.length, 1)
  assert.deepEqual([r2.ok, r2.reason], [false, 'TOO_BIG'])
})

test('.sticker: at most maxParallel (2) conversions run at the same time; all of them still succeed', async () => {
  const run = fakeFfmpeg({ delay: 25 })
  const { ex } = stickerExtras({ run })
  const conn = makeConn()
  const rs = await Promise.all(Array.from({ length: 7 }, () => ex.sticker(conn, imageMsg(), '')))
  assert.ok(rs.every((r) => r.ok))
  assert.equal(run.state.max, 2)
  assert.equal(conn.calls.sent.filter((s) => s.content.sticker).length, 7)
})

/* ── default media download path (real Baileys is replaced by a tiny fake module that has the same API) ── */
function withFakeBaileys(moduleSource) {
  const root = tmpDir()
  fs.mkdirSync(path.join(root, 'plugins'))
  fs.mkdirSync(path.join(root, 'node_modules', '@whiskeysockets', 'baileys'), { recursive: true })
  fs.writeFileSync(path.join(root, 'node_modules', '@whiskeysockets', 'baileys', 'index.js'), moduleSource)
  fs.copyFileSync(path.join(__dirname, '..', 'plugins', 'extras-core.js'), path.join(root, 'plugins', 'extras-core.js'))
  return require(path.join(root, 'plugins', 'extras-core.js')) // fresh module instance -> its own Baileys cache
}

test('default download path: Baileys downloadContentFromMessage stream -> Buffer -> converter', async () => {
  const mod = withFakeBaileys(`
    exports.downloadContentFromMessage = async (node, kind) => {
      exports.last = { node, kind }
      return (async function* () { yield Buffer.from('abc'); yield Buffer.from('def') })()
    }`)
  let seenInput = null
  const run = async (args) => {
    seenInput = fs.readFileSync(args[args.indexOf('-i') + 1])
    await fs.promises.writeFile(args[args.length - 1], FX.lossy)
  }
  const ex = new mod.Extras({ log: quiet(), deps: { runFfmpeg: run } }) // NO download dep -> uses the fake Baileys
  const conn = makeConn()
  const r = await ex.sticker(conn, imageMsg('.sticker', { mediaKey: 'k' }), '')
  assert.equal(r.ok, true)
  assert.equal(seenInput.toString(), 'abcdef', 'chunks joined in order')
  assert.ok(conn.calls.sent[0].content.sticker)
})

test('default download path: stream bigger than maxInputBytes is aborted (even when fileLength lied)', async () => {
  const mod = withFakeBaileys(`
    exports.downloadContentFromMessage = async () => (async function* () { for (let i = 0; i < 5; i++) yield Buffer.alloc(6) })()`)
  const conn = makeConn()
  const ex = new mod.Extras({ log: quiet(), maxInputBytes: 10, deps: { runFfmpeg: fakeFfmpeg() } })
  const r = await ex.sticker(conn, imageMsg('.sticker', { fileLength: 5 }), '')
  assert.deepEqual([r.ok, r.reason], [false, 'TOO_BIG'])
  assert.ok(!conn.calls.sent.some((s) => s.content.sticker))
})

test('default download path: Baileys not installed -> clear message (not "file corrupt")', async () => {
  const conn = makeConn()
  const ex = makeExtras({ deps: { runFfmpeg: fakeFfmpeg() } }) // Baileys is not installed in this sandbox / test env
  const r = await ex.sticker(conn, imageMsg(), '')
  assert.deepEqual([r.ok, r.reason], [false, 'NO_BAILEYS'])
  assert.match(lastText(conn), /Baileys/)
})

/* ═════════════════════════ 7. .toimg command (fake ffmpeg) ═════════════════════════ */
test('.toimg: quoted static sticker -> image sent', async () => {
  const { ex, run, downloads } = stickerExtras()
  const conn = makeConn()
  const r = await ex.toimg(conn, replyMsg(A, '.toimg', B, { stickerMessage: { isAnimated: false, fileLength: 3000 } }))
  assert.equal(r.ok, true)
  assert.equal(downloads[0].kind, 'sticker')
  const sent = conn.calls.sent[0]
  assert.ok(Buffer.isBuffer(sent.content.image))
  assert.ok(sent.content.caption)
  assert.ok(run.calls[0][run.calls[0].length - 1].endsWith('.png'))
})

test('.toimg: animated sticker / image / nothing / view-once / too big -> refused with the right message', async () => {
  const { ex, run, downloads } = stickerExtras()
  const conn = makeConn()
  assert.equal((await ex.toimg(conn, replyMsg(A, '.toimg', B, { stickerMessage: { isAnimated: true } }))).reason, 'animated')
  assert.match(lastText(conn), /Animated/)
  assert.equal((await ex.toimg(conn, replyMsg(A, '.toimg', B, { imageMessage: {} }))).reason, 'usage')
  assert.equal((await ex.toimg(conn, cmdMsg(A, '.toimg'))).reason, 'usage')
  assert.equal((await ex.toimg(conn, replyMsg(A, '.toimg', B, { viewOnceMessage: { message: {} } }))).reason, 'viewonce')
  assert.equal((await ex.toimg(conn, replyMsg(A, '.toimg', B, { stickerMessage: { fileLength: 99_000_000 } }))).reason, 'too-big')
  assert.equal(downloads.length + run.calls.length, 0)
})

test('.toimg: conversion failure -> friendly message; temp folders cleaned', async () => {
  const before = wsxDirs()
  const conn = makeConn()
  const { ex } = stickerExtras({ run: fakeFfmpeg({ fail: { code: 'NO_FFMPEG' } }) })
  const r = await ex.toimg(conn, replyMsg(A, '.toimg', B, { stickerMessage: {} }))
  assert.equal(r.ok, false)
  assert.match(lastText(conn), /ffmpeg/)
  assert.equal(wsxDirs(), before)
})

/* ═════════════════════════ 8. REAL ffmpeg (auto-skipped when ffmpeg is missing) ═════════════════════════ */
function ff(args) {
  const r = spawnSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', ...args])
  assert.equal(r.status, 0, 'ffmpeg helper failed: ' + String(r.stderr))
}
const pngSize = (buf) => {
  assert.equal(buf.subarray(0, 8).toString('hex'), '89504e470d0a1a0a', 'PNG signature')
  return [buf.readUInt32BE(16), buf.readUInt32BE(20)]
}

test('REAL ffmpeg: transparent PNG 640x360 -> 512x512 static sticker (≤100KB) with EXIF; decodable', needFfmpeg, async () => {
  const dir = tmpDir()
  ff(['-f', 'lavfi', '-i', 'color=c=0x3355ff@0.6:s=640x360,format=rgba', '-frames:v', '1', path.join(dir, 'in.png')])
  const before = wsxDirs()
  const webp = await makeSticker(fs.readFileSync(path.join(dir, 'in.png')), 'image', { mimetype: 'image/png', pack: 'මගේ Pack', author: 'Bot' })
  assert.equal(wsxDirs(), before, 'temp folder removed')
  const cs = riff(webp)
  const cv = canvas(cs)
  assert.deepEqual([cv.width, cv.height], [512, 512])
  assert.ok(cv.flags & 0x08, 'EXIF flag')
  assert.ok(cv.flags & 0x10, 'alpha flag (letterbox is transparent)')
  assert.ok(!cs.some((c) => c.id === 'ANIM'))
  assert.equal(exifJson(cs[cs.length - 1])['sticker-pack-name'], 'මගේ Pack')
  assert.ok(webp.length <= 100 * 1024, 'size ' + webp.length)
  fs.writeFileSync(path.join(dir, 's.webp'), webp)
  ff(['-i', path.join(dir, 's.webp'), '-frames:v', '1', path.join(dir, 'back.png')]) // an independent decoder accepts our file
  assert.deepEqual(pngSize(fs.readFileSync(path.join(dir, 'back.png'))), [512, 512])
})

test('REAL ffmpeg: landscape / portrait / jpeg, "full" and "crop" modes all give 512x512', needFfmpeg, async () => {
  const dir = tmpDir()
  ff(['-f', 'lavfi', '-i', 'testsrc=s=800x300', '-frames:v', '1', path.join(dir, 'land.jpg')])
  ff(['-f', 'lavfi', '-i', 'testsrc=s=300x700', '-frames:v', '1', path.join(dir, 'port.jpg')])
  for (const f of ['land.jpg', 'port.jpg']) {
    for (const mode of ['full', 'crop']) {
      const webp = await makeSticker(fs.readFileSync(path.join(dir, f)), 'image', { mimetype: 'image/jpeg', mode })
      const cv = canvas(riff(webp))
      assert.deepEqual([cv.width, cv.height], [512, 512], f + ' ' + mode)
    }
  }
})

test('REAL ffmpeg: video -> animated sticker (ANIM + several frames, ≤8s, 512x512, ≤500KB) with EXIF', needFfmpeg, async () => {
  const dir = tmpDir()
  ff(['-f', 'lavfi', '-i', 'testsrc=d=12:s=320x240:r=25', '-pix_fmt', 'yuv420p', path.join(dir, 'in.mp4')]) // 12 s source
  const webp = await makeSticker(fs.readFileSync(path.join(dir, 'in.mp4')), 'video', { mimetype: 'video/mp4', pack: 'Anim', author: 'Me', maxVideoSeconds: 8 })
  const cs = riff(webp)
  const cv = canvas(cs)
  assert.deepEqual([cv.width, cv.height], [512, 512])
  assert.ok(cv.flags & 0x02, 'animation flag')
  assert.ok(cv.flags & 0x08, 'EXIF flag')
  assert.ok(cs.some((c) => c.id === 'ANIM'))
  const frames = cs.filter((c) => c.id === 'ANMF')
  assert.ok(frames.length >= 20, 'frames: ' + frames.length)
  const totalMs = frames.reduce((s, c) => s + c.data.readUIntLE(12, 3), 0)
  assert.ok(totalMs <= 8200 && totalMs >= 6000, 'duration ms: ' + totalMs)
  assert.equal(exifJson(cs[cs.length - 1])['sticker-pack-publisher'], 'Me')
  assert.ok(webp.length <= 500 * 1024, 'size ' + webp.length)
})

test('REAL ffmpeg: very noisy video never exceeds the 1MB hard limit (shrinks via attempts, or is refused cleanly)', needFfmpeg, async () => {
  const dir = tmpDir()
  ff(['-f', 'lavfi', '-i', 'nullsrc=s=320x320:r=25,geq=random(1)*255:128:128', '-t', '4', '-pix_fmt', 'yuv420p', path.join(dir, 'noise.mp4')])
  try {
    const webp = await makeSticker(fs.readFileSync(path.join(dir, 'noise.mp4')), 'video', { mimetype: 'video/mp4' })
    assert.ok(webp.length <= 1_000_000, 'size ' + webp.length)
    riff(webp)
  } catch (e) {
    assert.equal(e.code, 'TOO_BIG')
  }
})

test('REAL ffmpeg: corrupt input -> FFMPEG_FAILED and temp folder cleaned', needFfmpeg, async () => {
  const before = wsxDirs()
  await assert.rejects(makeSticker(crypto.randomBytes(2000), 'image', { mimetype: 'image/jpeg' }), { code: 'FFMPEG_FAILED' })
  await assert.rejects(webpToPng(Buffer.from('not a webp')), { code: 'FFMPEG_FAILED' })
  assert.equal(wsxDirs(), before)
})

test('REAL ffmpeg: sticker -> toimg round trip through the command handlers', needFfmpeg, async () => {
  const dir = tmpDir()
  ff(['-f', 'lavfi', '-i', 'testsrc=s=400x300', '-frames:v', '1', path.join(dir, 'in.jpg')])
  const img = fs.readFileSync(path.join(dir, 'in.jpg'))
  let produced = null
  const ex = makeExtras({ deps: { download: async (node, kind) => (kind === 'sticker' ? produced : img) } })
  const conn = makeConn()
  assert.equal((await ex.sticker(conn, imageMsg('.sticker', { mimetype: 'image/jpeg' }), '')).ok, true)
  produced = conn.calls.sent[0].content.sticker
  riff(produced)
  const r = await ex.toimg(conn, replyMsg(A, '.toimg', B, { stickerMessage: { isAnimated: false } }))
  assert.equal(r.ok, true)
  assert.deepEqual(pngSize(conn.calls.sent[1].content.image), [512, 512])
})

test('runFfmpeg: missing binary -> NO_FFMPEG; slow job -> TIMEOUT (process killed)', async () => {
  await assert.rejects(runFfmpeg(['-version'], { bin: '/definitely/not/ffmpeg' }), { code: 'NO_FFMPEG' })
  if (HAS_FFMPEG) {
    const t0 = Date.now()
    await assert.rejects(runFfmpeg(['-re', '-f', 'lavfi', '-i', 'testsrc=d=30:s=64x64:r=10', '-f', 'null', '-'], { timeoutMs: 150 }), { code: 'TIMEOUT' })
    assert.ok(Date.now() - t0 < 3000, 'did not wait for the whole job')
  }
})

/* ═════════════════════════ 9. .tagall ═════════════════════════ */
test('.tagall: admin -> one message that mentions every member except the bot', async () => {
  const ex = makeExtras()
  const conn = makeConn()
  const r = await ex.tagall(conn, cmdMsg(ADMIN, '.tagall meeting at 8pm'), 'meeting at 8pm')
  assert.deepEqual([r.ok, r.count], [true, 6])
  assert.equal(conn.calls.sent.length, 1)
  const { text, mentions } = conn.calls.sent[0].content
  assert.deepEqual(mentions, [ADMIN, ADMIN2, OWNER, A, B, C])
  assert.ok(!mentions.includes(BOT_PLAIN))
  assert.match(text, /meeting at 8pm/)
  for (const j of mentions) assert.ok(text.includes('@' + j.split('@')[0]), 'text lists ' + j)
  assert.ok(conn.calls.sent[0].opts.quoted)
})

test('.tagall: permissions — non-admin denied, owner / fromMe / isOwner flag allowed, DM refused', async () => {
  const ex = makeExtras({ tagallCooldownMs: 0 })
  const conn = makeConn()
  assert.equal((await ex.tagall(conn, cmdMsg(A, '.tagall'), '')).reason, 'not-admin')
  assert.match(lastText(conn), /admins/)
  assert.equal((await ex.tagall(conn, cmdMsg(OWNER, '.tagall'), '')).ok, true)
  assert.equal((await ex.tagall(conn, cmdMsg(BOT, '.tagall', { fromMe: true }), '')).ok, true)
  assert.equal((await ex.tagall(conn, cmdMsg(A, '.tagall'), '', { isOwner: true })).ok, true)
  assert.equal((await ex.tagall(conn, cmdMsg(ADMIN, '.tagall', { group: ADMIN }), '')).reason, 'not-group')
  assert.equal((await ex.tagall(makeConn({ metaError: true }), cmdMsg(ADMIN, '.tagall'), '')).reason, 'no-metadata')
})

test('.tagall: 30s cooldown per group (denied callers do not start it)', async () => {
  const c = clock()
  const ex = makeExtras({ now: c.now })
  const conn = makeConn()
  await ex.tagall(conn, cmdMsg(A, '.tagall'), '') // denied (not admin) -> must not start cooldown
  assert.equal((await ex.tagall(conn, cmdMsg(ADMIN, '.tagall'), '')).ok, true)
  const r = await ex.tagall(conn, cmdMsg(ADMIN, '.tagall'), '')
  assert.equal(r.reason, 'cooldown')
  assert.match(lastText(conn), /⏳/)
  const other = await ex.tagall(conn, cmdMsg(ADMIN, '.tagall', { group: '120363999999999999@g.us' }), '')
  assert.equal(other.ok, true, 'other group unaffected')
  c.advance(30_001)
  assert.equal((await ex.tagall(conn, cmdMsg(ADMIN, '.tagall'), '')).ok, true)
})

test('.tagall: LID group mentions the LID ids; only-bot group -> friendly message; long note is capped', async () => {
  const ex = makeExtras({ tagallCooldownMs: 0 })
  const lid = makeConn({
    user: { id: BOT, lid: '999111:7@lid' },
    participants: [
      { id: '999111@lid', phoneNumber: BOT_PLAIN, admin: 'admin' },
      { id: '555222@lid', phoneNumber: ADMIN, admin: 'admin' },
      { id: '777333@lid', phoneNumber: A, admin: null },
    ],
  })
  const r = await ex.tagall(lid, cmdMsg(ADMIN, '.tagall'), '')
  assert.deepEqual(lid.calls.sent[0].content.mentions, ['555222@lid', '777333@lid'])
  assert.equal(r.count, 2)

  const lonely = makeConn({ participants: [{ id: BOT_PLAIN, admin: 'admin' }] })
  assert.equal((await ex.tagall(lonely, cmdMsg(OWNER, '.tagall'), '')).reason, 'empty')

  const conn = makeConn()
  await ex.tagall(conn, cmdMsg(ADMIN, '.tagall'), 'x'.repeat(900))
  assert.ok(conn.calls.sent[0].content.text.split('\n')[2].length <= 505)
})

/* ═════════════════════════ 10. .kick ═════════════════════════ */
test('.kick: admin replies to a member -> that member is removed (and nobody else)', async () => {
  const ex = makeExtras()
  const conn = makeConn()
  const r = await ex.kick(conn, replyMsg(ADMIN, '.kick', A), '')
  assert.deepEqual(r.removed, [A])
  assert.deepEqual(conn.calls.removed, [{ jid: GROUP, users: [A], action: 'remove' }])
  assert.match(lastText(conn), /Remove කළා/)
  assert.deepEqual(conn.calls.sent[0].content.mentions, [A])
})

test('.kick: @mentions (several, one API call, order kept), number argument, duplicates collapsed', async () => {
  const ex = makeExtras()
  const conn = makeConn()
  await ex.kick(conn, mentionMsg(ADMIN, '.kick @a @b', [B, A]), '')
  assert.deepEqual(conn.calls.removed[0].users, [B, A])
  await ex.kick(conn, cmdMsg(ADMIN, '.kick 94773333333'), '94773333333')
  assert.deepEqual(conn.calls.removed[1].users, [C])
  await ex.kick(conn, cmdMsg(ADMIN, '.kick'), '0773333333, 94773333333') // 0-prefixed is NOT converted for kick: only full numbers accepted
  assert.deepEqual(conn.calls.removed[2].users, [C])
  await ex.kick(conn, mentionMsg(ADMIN, '.kick', [A, A]), '')
  assert.deepEqual(conn.calls.removed[3].users, [A])
})

test('.kick: mention beats reply target; reply is used when there is no mention', async () => {
  const ex = makeExtras()
  const conn = makeConn()
  const m = mentionMsg(ADMIN, '.kick @b', [B], { participant: A, quotedMessage: { conversation: 'x' }, stanzaId: 'Q' })
  await ex.kick(conn, m, '')
  assert.deepEqual(conn.calls.removed[0].users, [B])
})

test('.kick: safety — never removes admins, the bot, the owner or non-members; if nothing is left no API call is made', async () => {
  const ex = makeExtras()
  const conn = makeConn()
  const r = await ex.kick(conn, mentionMsg(ADMIN, '.kick', [ADMIN2, BOT_PLAIN, OWNER, '94779999999@s.whatsapp.net']), '')
  assert.equal(conn.calls.removed.length, 0)
  assert.equal(r.ok, false)
  const t = lastText(conn)
  assert.match(t, /admin — මුලින් demote/)
  assert.match(t, /bot ම/)
  assert.match(t, /bot owner/)
  assert.match(t, /group එකේ නැහැ/)
  // admin that is also targeted through "superadmin"
  assert.deepEqual(r.skipped.length, 4)
})

test('.kick: mixed targets -> only the removable ones are sent to WhatsApp', async () => {
  const ex = makeExtras()
  const conn = makeConn()
  const r = await ex.kick(conn, mentionMsg(ADMIN, '.kick', [A, ADMIN2, C]), '')
  assert.deepEqual(conn.calls.removed[0].users, [A, C])
  assert.deepEqual(r.removed, [A, C])
  assert.equal(r.skipped.length, 1)
})

test('.kick: limits — more than 5 targets refused, exactly 5 allowed', async () => {
  const many = Array.from({ length: 8 }, (_, i) => ({ id: `9477555000${i}@s.whatsapp.net`, admin: null }))
  const participants = [{ id: BOT_PLAIN, admin: 'admin' }, { id: ADMIN, admin: 'admin' }, ...many]
  const conn = makeConn({ participants })
  const ex = makeExtras()
  const r6 = await ex.kick(conn, mentionMsg(ADMIN, '.kick', many.slice(0, 6).map((m) => m.id)), '')
  assert.equal(r6.reason, 'too-many')
  assert.equal(conn.calls.removed.length, 0)
  const r5 = await ex.kick(conn, mentionMsg(ADMIN, '.kick', many.slice(0, 5).map((m) => m.id)), '')
  assert.equal(r5.removed.length, 5)
})

test('.kick: permissions — non-admin denied, owner / fromMe / isOwner allowed, bot not admin warned, DM refused', async () => {
  const ex = makeExtras()
  const conn = makeConn()
  assert.equal((await ex.kick(conn, replyMsg(A, '.kick', B), '')).reason, 'not-admin')
  assert.equal(conn.calls.removed.length, 0)
  assert.equal((await ex.kick(conn, replyMsg(OWNER, '.kick', B), '')).ok, true)
  assert.equal((await ex.kick(conn, cmdMsg(BOT, '.kick', { fromMe: true, message: { extendedTextMessage: { text: '.kick', contextInfo: { participant: C, quotedMessage: {} } } } }), '')).ok, true)
  assert.equal((await ex.kick(conn, replyMsg(A, '.kick', A), '', { isOwner: true })).ok, true)
  const noAdmin = makeConn({ botAdmin: false })
  assert.equal((await ex.kick(noAdmin, replyMsg(ADMIN, '.kick', A), '')).reason, 'bot-not-admin')
  assert.match(lastText(noAdmin), /Bot ට group admin නැහැ/)
  assert.equal(noAdmin.calls.removed.length, 0)
  assert.equal((await ex.kick(conn, cmdMsg(ADMIN, '.kick', { group: ADMIN }), '')).reason, 'not-group')
  assert.equal((await ex.kick(makeConn({ metaError: true }), replyMsg(ADMIN, '.kick', A), '')).reason, 'no-metadata')
})

test('.kick: no target -> usage; WhatsApp rejects one of two (403) -> reported, the other is removed', async () => {
  const ex = makeExtras()
  const conn = makeConn()
  assert.equal((await ex.kick(conn, cmdMsg(ADMIN, '.kick'), '')).reason, 'usage')
  assert.match(lastText(conn), /@mention/)
  const c2 = makeConn({ statusFor: (u) => (u === B ? '403' : '200') })
  const r = await ex.kick(c2, mentionMsg(ADMIN, '.kick', [A, B]), '')
  assert.deepEqual(r.removed, [A])
  assert.equal(r.failed.length, 1)
  assert.match(lastText(c2), /Remove කළා/)
  assert.match(lastText(c2), /403/)
})

test('.kick: WhatsApp API throws -> friendly report, no exception', async () => {
  const ex = makeExtras()
  const conn = makeConn({ removeError: true })
  const r = await ex.kick(conn, replyMsg(ADMIN, '.kick', A), '')
  assert.equal(r.ok, false)
  assert.equal(r.failed.length, 1)
  assert.match(lastText(conn), /❌/)
})

test('.kick: LID group — a phone-number mention resolves to the group member id (LID)', async () => {
  const ex = makeExtras()
  const conn = makeConn({
    user: { id: BOT, lid: '999111:7@lid' },
    participants: [
      { id: '999111@lid', phoneNumber: BOT_PLAIN, admin: 'admin' },
      { id: '555222@lid', phoneNumber: ADMIN, admin: 'admin' },
      { id: '777333@lid', phoneNumber: A, admin: null },
      { id: '888444@lid', phoneNumber: B, admin: null },
    ],
  })
  // caller identified by LID + device suffix, target given by phone number, other target by LID
  const m = cmdMsg('555222:9@lid', '.kick', { message: { extendedTextMessage: { text: '.kick', contextInfo: { mentionedJid: [A, '888444@lid'] } } } })
  const r = await ex.kick(conn, m, '')
  assert.deepEqual(conn.calls.removed[0].users, ['777333@lid', '888444@lid'])
  assert.equal(r.removed.length, 2)
})

/* ═════════════════════════ 11. plugin wrapper (cmd() style) ═════════════════════════ */
test('plugin: registers the 5 commands with aliases and works through the template-style dispatcher', async () => {
  const root = tmpDir()
  fs.mkdirSync(path.join(root, 'plugins'))
  fs.writeFileSync(path.join(root, 'command.js'), 'const commands=[];function cmd(i,f){i.function=f;commands.push(i);return i}module.exports={cmd,commands}')
  for (const f of ['extras.js', 'extras-core.js']) fs.copyFileSync(path.join(__dirname, '..', 'plugins', f), path.join(root, 'plugins', f))
  const savedOwner = process.env.OWNER_NUMBER
  process.env.OWNER_NUMBER = '94770000002'
  try {
    require(path.join(root, 'plugins', 'extras.js'))
  } finally {
    savedOwner === undefined ? delete process.env.OWNER_NUMBER : (process.env.OWNER_NUMBER = savedOwner)
  }
  const { commands } = require(path.join(root, 'command.js'))
  const by = Object.fromEntries(commands.map((c) => [c.pattern, c]))
  assert.deepEqual(Object.keys(by).sort(), ['bancheck', 'kick', 'sticker', 'tagall', 'toimg'])
  assert.deepEqual(by.bancheck.alias, ['checkban', 'wacheck', 'isban'])
  assert.deepEqual(by.sticker.alias, ['s', 'stic'])
  assert.deepEqual(by.toimg.alias, ['toimage'])
  assert.deepEqual(by.kick.alias, ['remove'])
  assert.ok(commands.every((c) => typeof c.function === 'function' && c.desc && c.category))

  const conn = makeConn()
  const realFetch = globalThis.fetch
  globalThis.fetch = async () => jsonRes(LIVE)
  try {
    // template passes: (conn, mek, m, { q, isOwner, ... })
    await by.bancheck.function(conn, cmdMsg(A, '.bancheck 0771234567'), {}, { q: '0771234567', isOwner: false })
    assert.match(lastText(conn), /ACTIVE/)
  } finally {
    globalThis.fetch = realFetch
  }
  await by.tagall.function(conn, cmdMsg(ADMIN, '.tagall hi'), {}, { q: 'hi' })
  assert.equal(conn.calls.sent[1].content.mentions.length, 6)
  await by.kick.function(conn, replyMsg(A, '.kick', B), {}, { q: '', isOwner: false })
  assert.match(lastText(conn), /admins/) // A is not an admin
  await by.kick.function(conn, replyMsg(A, '.kick', B), {}, { q: '', isOwner: true })
  assert.deepEqual(conn.calls.removed[0].users, [B])
  await by.sticker.function(conn, cmdMsg(A, '.sticker'), {}, { q: '' })
  assert.match(lastText(conn), /Sticker maker/)
  await by.toimg.function(conn, cmdMsg(A, '.toimg'), {}, { q: '' })
  assert.match(lastText(conn), /toimg/)
  await by.bancheck.function(conn, cmdMsg(A, '.bancheck'), {}, undefined) // ctx missing entirely must not crash
})
