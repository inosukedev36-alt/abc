'use strict'
/**
 * extras-core.js
 * ──────────────
 *  .bancheck <number>   WhatsApp number එක ban ද නැද්ද බලනවා (wptest.udmodz-2ab.workers.dev API එකෙන්)
 *  .sticker             image / video → sticker  (pack name + author එක්ක)
 *  .toimg               sticker → image
 *  .tagall [message]    group members ට ඔක්කොම tag කරනවා   (admins)
 *  .kick                member කෙනෙක්ව remove කරනවා         (admins)
 *
 * අවශ්‍යතා: Node 18+ (fetch). Sticker / toimg වලට server එකේ `ffmpeg` install කරලා තියෙන්න ඕන.
 * npm packages කිසිවක් ඕන නැහැ. require() කරද්දී side-effects නැහැ (plugins/ folder එකට දාන්න පුළුවන්).
 */

const fs = require('fs')
const os = require('os')
const path = require('path')
const crypto = require('crypto')
const { spawn } = require('child_process')

const BAN_API = 'https://wptest.udmodz-2ab.workers.dev/test'

/* ═════════════════ Bot messages (මෙතනින් වෙනස් කරගන්න පුළුවන්) ═════════════════ */
const T = {
  groupOnly: '⛔ මේ command එක group එකක් ඇතුලේ විතරයි පාවිච්චි කරන්න පුළුවන්.',
  adminOnly: '⛔ මේ command එක group admins ට (හෝ bot owner ට) විතරයි.',
  noMeta: '⚠️ Group info ගන්න බැරි වුණා. පොඩ්ඩකින් ආයෙත් try කරන්න.',
  botNotAdmin: '⚠️ Bot ට group admin නැහැ. Bot ව admin කරලා ආයෙත් try කරන්න.',
  cooldown: (s) => `⏳ තත්පර ${s}කින් ආයෙත් try කරන්න.`,

  banUsage: (p) =>
    `📵 *Ban check*\n\nභාවිතය:\n${p}bancheck 94771234567\n${p}bancheck 0771234567\n(නැත්නම් කෙනෙක්ගේ message එකකට reply කරලා ${p}bancheck)`,
  banBadNumber: (p) => `⚠️ Number එක වැරදියි. Country code එක්ක ගහන්න.\nඋදා: ${p}bancheck 94771234567`,
  banLid: '⚠️ මේ කෙනාගේ number එක ගන්න බැහැ (WhatsApp hidden ID). Number එක type කරලා ගහන්න.',
  banFail: (why) => `⚠️ Check කරන්න බැරි වුණා (${why}). පස්සේ ආයෙත් try කරන්න.`,

  stickerUsage: (p) =>
    `🎨 *Sticker maker*\n\nImage / video එකකට reply කරලා ${p}sticker කියලා ගහන්න.\n(නැත්නම් image / video එකේ caption එකේ ${p}sticker දාන්න)\n\n` +
    `${p}sticker crop → හතරැස් කරලා crop කරනවා\n${p}sticker MyPack|MyName → pack name / author දාන්න`,
  viewOnce: '⛔ View-once media වලින් sticker / image හදන්න බැහැ.',
  tooBig: (mb) => `⚠️ File එක ලොකු වැඩියි (උපරිම ${mb}MB).`,
  convertFail: (why) => `⚠️ Convert කරන්න බැරි වුණා: ${why}`,
  toimgUsage: (p) => `🖼️ Sticker එකකට reply කරලා ${p}toimg කියලා ගහන්න.`,
  animatedSticker: '⚠️ Animated sticker එකක් image කරන්න බැහැ (static sticker වලට විතරයි).',

  tagallEmpty: '⚠️ Tag කරන්න members කවුරුත් නැහැ.',
  kickUsage: (p) =>
    `🥾 *Kick*\n\nභාවිතය:\n${p}kick @mention\n${p}kick 94771234567\n(නැත්නම් kick කරන්න ඕන කෙනාගේ message එකකට reply කරලා ${p}kick)`,
  kickTooMany: (n) => `⚠️ එක පාර උපරිම ${n} දෙනෙක්ව විතරයි kick කරන්න පුළුවන්.`,
}

/* ═════════════════ JID / message helpers ═════════════════ */
function decodeJid(jid) {
  if (typeof jid !== 'string') return null
  const at = jid.indexOf('@')
  if (at < 1) return null
  const user = jid.slice(0, at).split(':')[0].split('_')[0]
  return user ? { user, server: jid.slice(at + 1) } : null
}
const userOf = (jid) => (decodeJid(jid) || {}).user || null

// LID / phone-number දෙකම එකම කෙනාට අයිති වෙන නිසා හැම alias එකක්ම collect කරනවා
const PARTICIPANT_FIELDS = ['id', 'jid', 'lid', 'phoneNumber', 'phone_number']
const KEY_FIELDS = ['participant', 'participantAlt', 'participantPn', 'participant_pn', 'participantLid']
function aliasesOf(obj, fields) {
  const out = new Set()
  if (obj) for (const f of fields) {
    const u = userOf(obj[f])
    if (u) out.add(u)
  }
  return [...out]
}

const toNum = (x) => (x && typeof x.toNumber === 'function' ? x.toNumber() : Number(x))

function toNumbers(v) {
  const list = Array.isArray(v) ? v : String(v == null ? '' : v).split(/[,\s]+/)
  return list.map((x) => String(x).replace(/\D/g, '')).filter(Boolean)
}

// view-once නොවන wrappers විතරයි unwrap කරන්නේ (view-once media කවදාවත් process කරන්නේ නෑ)
function unwrapPlain(message) {
  let m = message
  for (let i = 0; i < 4; i++) {
    const inner = m && ((m.ephemeralMessage && m.ephemeralMessage.message) || (m.documentWithCaptionMessage && m.documentWithCaptionMessage.message))
    if (!inner) break
    m = inner
  }
  return m || {}
}

function getText(msg) {
  const c = unwrapPlain(msg && msg.message)
  if (typeof c.conversation === 'string') return c.conversation
  for (const k of ['extendedTextMessage', 'imageMessage', 'videoMessage', 'documentMessage']) {
    if (c[k]) return c[k].text || c[k].caption || ''
  }
  return ''
}

function contextOf(msg) {
  const c = unwrapPlain(msg && msg.message)
  for (const k of Object.keys(c)) {
    const ci = c[k] && c[k].contextInfo
    if (ci) return ci
  }
  return null
}

const isViewOnceWrapper = (m) => !!m && !!(m.viewOnceMessage || m.viewOnceMessageV2 || m.viewOnceMessageV2Extension)
function mediaOf(c) {
  if (c.imageMessage) return { kind: 'image', node: c.imageMessage }
  if (c.videoMessage) return { kind: 'video', node: c.videoMessage }
  if (c.stickerMessage) return { kind: 'sticker', node: c.stickerMessage }
  return null
}

/** command message එකේම media තියෙනවද / reply කරපු message එකේ media තියෙනවද කියලා හොයනවා */
function findMedia(msg) {
  const c = unwrapPlain(msg && msg.message)
  const own = mediaOf(c)
  if (own) return own.node.viewOnce ? { blocked: 'viewonce' } : { ...own, source: 'self' }
  const ci = contextOf(msg)
  const qm = ci && ci.quotedMessage
  if (qm) {
    if (isViewOnceWrapper(qm)) return { blocked: 'viewonce' }
    const q = mediaOf(unwrapPlain(qm))
    if (q) return q.node.viewOnce ? { blocked: 'viewonce' } : { ...q, source: 'quoted' }
  }
  return null
}

/* ═════════════════ 1. BAN CHECK ═════════════════ */
/** "+94 77 123 4567" / "0771234567" / "0094771234567" -> "94771234567"  (වැරදි නම් null) */
function normalizeNumber(input, defaultCC = '94') {
  let d = String(input == null ? '' : input).replace(/\D/g, '')
  if (!d) return null
  if (d.startsWith('00')) d = d.slice(2)
  else if (d.startsWith('0') && defaultCC) d = String(defaultCC).replace(/\D/g, '') + d.slice(1)
  return d.length >= 8 && d.length <= 15 ? d : null
}

/**
 * API response: { number, cc, phone, status: "ACTIVE", details: "Valid / Active Number (Not Banned)", accountType: "Normal" }
 * "ACTIVE" response එක site එකෙන්ම බලලා තහවුරු කළා. අනිත් status values අනුමානයක්; හඳුනාගන්න බැරි ඒවා ඇත්තටම ආපු විදිහටම පෙන්නනවා.
 */
function classifyBan(data) {
  const d = data && typeof data === 'object' ? data : {}
  const status = String(d.status == null ? '' : d.status).trim()
  const details = String(d.details == null ? '' : d.details).trim()
  const S = status.toUpperCase()
  const D = details.toLowerCase()
  const negated = /^(NOT|UN)[\s_-]*BAN/.test(S) || /\b(not|un)[\s_-]*banned\b/.test(D)

  let state = 'unknown'
  if (/BAN|BLOCK|RESTRICT|SUSPEND/.test(S) && !negated) state = 'banned'
  else if (['ACTIVE', 'VALID', 'OK'].includes(S) || negated) state = 'active'
  else if (/UNREGISTER|NOT[\s_-]?REGISTER|NOT[\s_-]?FOUND|NOT[\s_-]?EXIST|INVALID|NO[\s_-]?ACCOUNT/.test(S) ||
    /not registered|not on whatsapp|invalid|doesn.?t exist|no account/.test(D)) state = 'unregistered'
  else if (/\bbanned\b|\brestricted\b|\bsuspended\b/.test(D)) state = 'banned'

  return { state, status, details, accountType: d.accountType == null ? '' : String(d.accountType).trim(), cc: d.cc == null ? '' : String(d.cc) }
}

function formatBan(number, data) {
  const r = classifyBan(data)
  const badge = {
    active: `✅ ${r.status || 'ACTIVE'} — Ban වෙලා නැහැ`,
    banned: `🚫 ${r.status || 'BANNED'} — Ban වෙලා`,
    unregistered: `⚠️ ${r.status || 'NOT REGISTERED'}`,
    unknown: `❔ ${r.status || 'UNKNOWN'}`,
  }[r.state]
  const lines = ['📵 *WhatsApp Number Check*', '', `📞 Number: +${number}`]
  if (r.cc) lines.push(`🌍 Country code: +${r.cc}`)
  lines.push(`📊 Status: ${badge}`)
  if (r.details) lines.push(`ℹ️ ${r.details}`)
  if (r.accountType) lines.push(`👤 Account type: ${r.accountType}`)
  return lines.join('\n')
}

async function checkBan(number, o = {}) {
  const f = o.fetchImpl || globalThis.fetch
  if (typeof f !== 'function') throw Object.assign(new Error('fetch නැහැ (Node 18+ ඕන)'), { code: 'NO_FETCH' })
  const url = `${o.baseUrl || BAN_API}?number=${encodeURIComponent(number)}`
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), o.timeoutMs || 15000)
  try {
    const res = await f(url, { signal: ctrl.signal, headers: { accept: 'application/json' } })
    const text = await res.text()
    let data = null
    try { data = JSON.parse(text) } catch (_) { /* below */ }
    if (!res.ok) throw Object.assign(new Error(`HTTP ${res.status}`), { code: 'HTTP', status: res.status })
    if (!data || typeof data !== 'object' || Array.isArray(data)) throw Object.assign(new Error('bad JSON'), { code: 'BAD_JSON' })
    return data
  } catch (e) {
    if (e && (e.name === 'AbortError' || ctrl.signal.aborted)) throw Object.assign(new Error('timeout'), { code: 'TIMEOUT' })
    throw e
  } finally {
    clearTimeout(timer)
  }
}

function whyBanFailed(e) {
  switch (e && e.code) {
    case 'TIMEOUT': return 'site එක respond කළේ නැහැ'
    case 'HTTP': return `site error — HTTP ${e.status}`
    case 'BAD_JSON': return 'site එකෙන් වැරදි response එකක් ආවා'
    case 'NO_FETCH': return 'Node 18+ ඕන'
    default: return 'network error'
  }
}

/** reply කරපු කෙනාගේ number එක (phone-number JID එකක් නම් විතරයි) */
function quotedNumber(msg) {
  const ci = contextOf(msg) || {}
  const p = ci.participant || (ci.mentionedJid && ci.mentionedJid[0])
  const d = decodeJid(p)
  if (!d) return {}
  if (d.server === 's.whatsapp.net') return { number: d.user }
  return { lid: true }
}

/* ═════════════════ 2. STICKER (ffmpeg + WebP EXIF) ═════════════════ */
const FIT = 'scale=512:512:force_original_aspect_ratio=decrease:flags=lanczos,format=rgba,pad=512:512:(ow-iw)/2:(oh-ih)/2:color=black@0'
const CROP = 'scale=512:512:force_original_aspect_ratio=increase:flags=lanczos,crop=512:512'
const STATIC_QUALITY = [80, 60, 40]
const ANIM_TRIES = [
  { fps: 15, q: 60, t: 8 },
  { fps: 12, q: 45, t: 8 },
  { fps: 10, q: 35, t: 6 },
  { fps: 8, q: 25, t: 5 },
]
const STATIC_TARGET = 100 * 1024
const ANIM_TARGET = 500 * 1024
const HARD_LIMIT = 1000 * 1000
const EXT = {
  'image/jpeg': '.jpg', 'image/jpg': '.jpg', 'image/png': '.png', 'image/webp': '.webp', 'image/gif': '.gif',
  'video/mp4': '.mp4', 'video/webm': '.webm', 'video/3gpp': '.3gp',
}

function resolveFfmpeg(custom) {
  if (custom) return custom
  if (process.env.FFMPEG_PATH) return process.env.FFMPEG_PATH
  try {
    const p = require('ffmpeg-static') // install කරලා තියෙනවා නම් ඒක පාවිච්චි කරනවා
    if (typeof p === 'string' && p) return p
  } catch (_) { /* ignore */ }
  return 'ffmpeg'
}

function runFfmpeg(args, o = {}) {
  return new Promise((resolve, reject) => {
    let child
    try {
      child = spawn(resolveFfmpeg(o.bin), ['-hide_banner', '-loglevel', 'error', '-nostdin', ...args], { stdio: ['ignore', 'ignore', 'pipe'] })
    } catch (e) {
      return reject(Object.assign(e, { code: e.code === 'ENOENT' ? 'NO_FFMPEG' : e.code }))
    }
    let err = ''
    child.stderr.on('data', (d) => { err = (err + d).slice(-2000) })
    const timer = setTimeout(() => {
      child.kill('SIGKILL')
      reject(Object.assign(new Error('ffmpeg timeout'), { code: 'TIMEOUT' }))
    }, o.timeoutMs || 60000)
    child.on('error', (e) => {
      clearTimeout(timer)
      reject(Object.assign(e, { code: e.code === 'ENOENT' ? 'NO_FFMPEG' : e.code }))
    })
    child.on('close', (code) => {
      clearTimeout(timer)
      if (code === 0) resolve()
      else reject(Object.assign(new Error(`ffmpeg exited ${code}: ${err.trim().split('\n').slice(-3).join(' | ')}`), { code: 'FFMPEG_FAILED' }))
    })
  })
}

/** WhatsApp sticker metadata (pack name / author) සඳහා EXIF payload */
function buildStickerExif({ pack, author, emojis = [], id }) {
  const json = {
    'sticker-pack-id': id || crypto.randomBytes(16).toString('hex'),
    'sticker-pack-name': pack,
    'sticker-pack-publisher': author,
    emojis,
  }
  const jsonBuf = Buffer.from(JSON.stringify(json), 'utf8')
  const head = Buffer.from([0x49, 0x49, 0x2a, 0x00, 0x08, 0x00, 0x00, 0x00, 0x01, 0x00, 0x41, 0x57, 0x07, 0x00, 0x00, 0x00, 0x00, 0x00, 0x16, 0x00, 0x00, 0x00])
  const exif = Buffer.concat([head, jsonBuf])
  exif.writeUInt32LE(jsonBuf.length, 14)
  return exif
}

function vp8Dims(chunk) {
  const d = chunk.data
  if (chunk.id === 'VP8L') {
    if (d.length < 5 || d[0] !== 0x2f) throw Object.assign(new Error('bad VP8L'), { code: 'BAD_WEBP' })
    const bits = d.readUInt32LE(1)
    return { width: (bits & 0x3fff) + 1, height: ((bits >>> 14) & 0x3fff) + 1, alpha: ((bits >>> 28) & 1) === 1 }
  }
  if (d.length < 10 || d[3] !== 0x9d || d[4] !== 0x01 || d[5] !== 0x2a) throw Object.assign(new Error('bad VP8'), { code: 'BAD_WEBP' })
  return { width: d.readUInt16LE(6) & 0x3fff, height: d.readUInt16LE(8) & 0x3fff, alpha: false }
}

/** WebP file එකකට EXIF chunk එකක් එකතු කරනවා (simple VP8/VP8L files extended (VP8X) format එකට හරවනවා). Input buffer එක වෙනස් වෙන්නේ නෑ. */
function addStickerExif(webp, exif) {
  if (!Buffer.isBuffer(webp) || webp.length < 20 || webp.toString('ascii', 0, 4) !== 'RIFF' || webp.toString('ascii', 8, 12) !== 'WEBP') {
    throw Object.assign(new Error('not a WebP file'), { code: 'BAD_WEBP' })
  }
  const end = 8 + webp.readUInt32LE(4)
  if (end > webp.length) throw Object.assign(new Error('truncated WebP'), { code: 'BAD_WEBP' })
  const chunks = []
  let off = 12
  while (off + 8 <= end) {
    const id = webp.toString('ascii', off, off + 4)
    const size = webp.readUInt32LE(off + 4)
    if (off + 8 + size > end) throw Object.assign(new Error('truncated WebP chunk'), { code: 'BAD_WEBP' })
    chunks.push({ id, data: webp.subarray(off + 8, off + 8 + size) })
    off += 8 + size + (size & 1)
  }
  const list = chunks.filter((c) => c.id !== 'EXIF')
  let vp8x = list.find((c) => c.id === 'VP8X')
  if (vp8x) {
    vp8x = { id: 'VP8X', data: Buffer.from(vp8x.data) }
    list[list.indexOf(list.find((c) => c.id === 'VP8X'))] = vp8x
  } else {
    const img = list.find((c) => c.id === 'VP8 ' || c.id === 'VP8L')
    if (!img) throw Object.assign(new Error('no image data in WebP'), { code: 'BAD_WEBP' })
    const { width, height, alpha } = vp8Dims(img)
    const data = Buffer.alloc(10)
    if (alpha) data[0] |= 0x10
    data.writeUIntLE(width - 1, 4, 3)
    data.writeUIntLE(height - 1, 7, 3)
    vp8x = { id: 'VP8X', data }
    list.unshift(vp8x)
  }
  vp8x.data[0] |= 0x08 // EXIF flag
  list.push({ id: 'EXIF', data: exif }) // spec: EXIF image data වලට පස්සේ

  const parts = []
  let total = 4
  for (const c of list) {
    const head = Buffer.alloc(8)
    head.write(c.id, 0, 4, 'ascii')
    head.writeUInt32LE(c.data.length, 4)
    parts.push(head, c.data)
    total += 8 + c.data.length
    if (c.data.length & 1) { parts.push(Buffer.alloc(1)); total += 1 }
  }
  const riff = Buffer.alloc(12)
  riff.write('RIFF', 0, 4, 'ascii')
  riff.writeUInt32LE(total, 4)
  riff.write('WEBP', 8, 4, 'ascii')
  return Buffer.concat([riff, ...parts])
}

const cleanText = (s, fallback) => {
  const t = String(s == null ? '' : s).replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, 60)
  return t || fallback
}

/** buffer (image | video) -> sticker webp (512x512, pack/author EXIF එක්ක) */
async function makeSticker(buffer, kind, o) {
  const run = o.run || runFfmpeg
  const dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'wsx-'))
  try {
    const ext = EXT[String(o.mimetype || '').toLowerCase()] || (kind === 'video' ? '.mp4' : '.jpg')
    const inFile = path.join(dir, 'in' + ext)
    await fs.promises.writeFile(inFile, buffer)
    const fit = o.mode === 'crop' ? CROP : FIT
    const animated = kind === 'video'
    const target = animated ? ANIM_TARGET : STATIC_TARGET
    const tries = animated ? ANIM_TRIES.map((t) => ({ ...t, t: Math.min(t.t, o.maxVideoSeconds || 8) })) : STATIC_QUALITY.map((q) => ({ q }))

    const now = o.now || Date.now
    const started = now()
    const budget = o.budgetMs || 90000 // හිමිං host එකක attempts 4ම ගිහින් විනාඩි ගණනක් යන්න නොදී
    let best = null
    for (let i = 0; i < tries.length; i++) {
      if (i > 0 && now() - started > budget) break
      const t = tries[i]
      const outFile = path.join(dir, `out-${i}.webp`)
      const args = animated
        ? ['-y', '-t', String(t.t), '-i', inFile, '-vf', `fps=${t.fps},${fit}`, '-c:v', 'libwebp', '-lossless', '0', '-q:v', String(t.q), '-compression_level', '4', '-loop', '0', '-an', '-sn', '-map_metadata', '-1', outFile]
        : ['-y', '-i', inFile, '-vf', fit, '-frames:v', '1', '-c:v', 'libwebp', '-lossless', '0', '-q:v', String(t.q), '-compression_level', '6', '-an', '-sn', '-map_metadata', '-1', outFile]
      await run(args)
      const buf = await fs.promises.readFile(outFile)
      if (!best || buf.length < best.length) best = buf
      if (buf.length <= target) break
    }
    if (best.length > HARD_LIMIT) throw Object.assign(new Error('sticker too large'), { code: 'TOO_BIG' })
    const exif = buildStickerExif({ pack: cleanText(o.pack, 'Sticker Pack'), author: cleanText(o.author, 'WhatsApp Bot') })
    return addStickerExif(best, exif)
  } finally {
    await fs.promises.rm(dir, { recursive: true, force: true })
  }
}

/** sticker (webp) -> png */
async function webpToPng(buffer, o = {}) {
  const run = o.run || runFfmpeg
  const dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'wsx-'))
  try {
    const inFile = path.join(dir, 'in.webp')
    const outFile = path.join(dir, 'out.png')
    await fs.promises.writeFile(inFile, buffer)
    await run(['-y', '-i', inFile, '-frames:v', '1', outFile])
    return await fs.promises.readFile(outFile)
  } finally {
    await fs.promises.rm(dir, { recursive: true, force: true })
  }
}

function whyConvertFailed(e) {
  switch (e && e.code) {
    case 'NO_FFMPEG': return 'Server එකේ *ffmpeg* install කරලා නැහැ.'
    case 'TIMEOUT': return 'ගොඩක් වෙලා ගියා (timeout). පොඩි file එකක් try කරන්න.'
    case 'TOO_BIG': return 'Sticker එක ලොකු වැඩියි. කෙටි / පොඩි video එකක් try කරන්න.'
    case 'NO_BAILEYS': return 'Bot එකේ Baileys library එක (downloadContentFromMessage) හොයාගන්න බැරි වුණා.'
    default: return 'File එක corrupt හෝ support නැති format එකක් වෙන්න පුළුවන්.'
  }
}

async function streamToBuffer(stream, maxBytes) {
  const chunks = []
  let total = 0
  for await (const c of stream) {
    total += c.length
    if (total > maxBytes) throw Object.assign(new Error('too big'), { code: 'TOO_BIG' })
    chunks.push(c)
  }
  return Buffer.concat(chunks)
}

let _baileys
async function loadBaileys() {
  if (_baileys !== undefined) return _baileys
  for (const name of ['@whiskeysockets/baileys', '@adiwajshing/baileys', 'baileys']) {
    try { _baileys = require(name); return _baileys } catch (_) { /* try next */ }
    try { _baileys = await import(name); return _baileys } catch (_) { /* try next */ }
  }
  _baileys = null
  return null
}

class Limiter {
  constructor(n) { this.n = n; this.active = 0; this.queue = [] }
  async run(fn) {
    if (this.active >= this.n) await new Promise((r) => this.queue.push(r))
    this.active++
    try { return await fn() } finally {
      this.active--
      const next = this.queue.shift()
      if (next) next()
    }
  }
}

/* ═════════════════ 5. KICK helpers ═════════════════ */
function kickTargets(msg, arg) {
  const ci = contextOf(msg) || {}
  let out = Array.isArray(ci.mentionedJid) ? ci.mentionedJid.filter(Boolean) : []
  if (!out.length && ci.participant) out = [ci.participant]
  if (!out.length) {
    for (const tok of String(arg || '').split(/[\s,]+/)) {
      const d = tok.replace(/\D/g, '')
      if (d.length >= 8 && d.length <= 15) out.push(`${d}@s.whatsapp.net`)
    }
  }
  return [...new Set(out)]
}

/* ═════════════════ Main class ═════════════════ */
class Extras {
  /**
   * @param {object} [opts]
   *  prefix              usage text වලට (default '.')
   *  ownerNumbers        ['94771234567']  — owner ට admin නැතත් .tagall / .kick පාවිච්චි කරන්න පුළුවන් (නැත්නම් env OWNER_NUMBER)
   *  defaultCountryCode  0771234567 වගේ local number එකක් type කළොත් පාවිච්චි වෙන country code (default '94')
   *  packName / authorName   sticker pack name / author (default)
   *  banCooldownMs       .bancheck එක එකම කෙනෙක්ට නැවත නැවත පාවිච්චි කරන්න බැරි කාලය (default 10000)
   *  tagallCooldownMs    group එකක .tagall නැවත පාවිච්චි කරන්න බැරි කාලය (default 30000)
   *  kickMax             එක පාර kick කරන්න පුළුවන් උපරිම ගණන (default 5)
   *  maxInputBytes       sticker / toimg වලට උපරිම file size (default 15MB)
   *  maxVideoSeconds     animated sticker එකේ උපරිම තත්පර (default 8)
   *  stickerBudgetMs     එක sticker එකකට මුළු convert කාලය (default 90000). ඉක්මවුණොත් ඊළඟ attempts නවත්වලා තියෙන හොඳම එක පාවිච්චි කරනවා
   *  ffmpegPath          (default: env FFMPEG_PATH → ffmpeg-static → "ffmpeg")
   */
  constructor(opts = {}) {
    this.o = {
      prefix: opts.prefix || '.',
      ownerNumbers: toNumbers(opts.ownerNumbers != null ? opts.ownerNumbers : process.env.OWNER_NUMBER),
      defaultCountryCode: opts.defaultCountryCode != null ? String(opts.defaultCountryCode) : '94',
      packName: opts.packName || 'Sticker Pack',
      authorName: opts.authorName || 'WhatsApp Bot',
      banApi: opts.banApi || BAN_API,
      banTimeoutMs: Number(opts.banTimeoutMs) || 15000,
      banCooldownMs: opts.banCooldownMs != null ? Number(opts.banCooldownMs) : 10000,
      tagallCooldownMs: opts.tagallCooldownMs != null ? Number(opts.tagallCooldownMs) : 30000,
      kickMax: Number(opts.kickMax) || 5,
      maxInputBytes: Number(opts.maxInputBytes) || 15 * 1024 * 1024,
      maxVideoSeconds: Number(opts.maxVideoSeconds) || 8,
      stickerBudgetMs: Number(opts.stickerBudgetMs) || 90000,
      ffmpegPath: opts.ffmpegPath || null,
      maxParallel: Number(opts.maxParallel) || 2,
      now: typeof opts.now === 'function' ? opts.now : Date.now,
      log: opts.log || console,
    }
    this.deps = opts.deps || {} // tests: { fetch, runFfmpeg, download }
    this.cool = new Map()
    this.limiter = new Limiter(this.o.maxParallel)
  }

  /* ───────────── .bancheck ───────────── */
  async bancheck(conn, msg, arg) {
    const p = this.o.prefix
    try {
      const a = this._argText(msg, arg)
      let number = null
      if (a) {
        number = normalizeNumber(a, this.o.defaultCountryCode)
        if (!number) { await this._reply(conn, msg, T.banBadNumber(p)); return { ok: false, reason: 'bad-number' } }
      } else {
        const q = quotedNumber(msg)
        if (q.lid) { await this._reply(conn, msg, T.banLid); return { ok: false, reason: 'lid' } }
        number = q.number || null
      }
      if (!number) { await this._reply(conn, msg, T.banUsage(p)); return { ok: false, reason: 'usage' } }

      const who = userOf(msg.key.participant || msg.key.remoteJid) || 'unknown'
      const wait = this._cooldown(`ban|${who}`, this.o.banCooldownMs)
      if (wait) { await this._reply(conn, msg, T.cooldown(wait)); return { ok: false, reason: 'cooldown' } }

      let data
      try {
        data = await checkBan(number, { fetchImpl: this.deps.fetch, timeoutMs: this.o.banTimeoutMs, baseUrl: this.o.banApi })
      } catch (e) {
        this.o.log.error('[extras] bancheck failed:', e && e.message)
        await this._reply(conn, msg, T.banFail(whyBanFailed(e)))
        return { ok: false, reason: (e && e.code) || 'error' }
      }
      await this._reply(conn, msg, formatBan(number, data))
      return { ok: true, number, state: classifyBan(data).state }
    } catch (e) {
      this.o.log.error('[extras] bancheck error:', (e && e.stack) || e)
      return { ok: false, reason: 'error' }
    }
  }

  /* ───────────── .sticker ───────────── */
  async sticker(conn, msg, arg) {
    const p = this.o.prefix
    const jid = msg && msg.key && msg.key.remoteJid
    try {
      const media = findMedia(msg)
      if (media && media.blocked) { await this._reply(conn, msg, T.viewOnce); return { ok: false, reason: 'viewonce' } }
      if (!media || (media.kind !== 'image' && media.kind !== 'video')) {
        await this._reply(conn, msg, T.stickerUsage(p))
        return { ok: false, reason: 'usage' }
      }
      const size = toNum(media.node.fileLength)
      if (size > this.o.maxInputBytes) { await this._reply(conn, msg, T.tooBig(Math.round(this.o.maxInputBytes / 1048576))); return { ok: false, reason: 'too-big' } }

      const { mode, pack, author } = this._stickerArgs(this._argText(msg, arg))
      let webp
      try {
        const buf = await this._download(media.node, media.kind)
        webp = await this.limiter.run(() =>
          makeSticker(buf, media.kind, { mode, pack, author, mimetype: media.node.mimetype, maxVideoSeconds: this.o.maxVideoSeconds, budgetMs: this.o.stickerBudgetMs, now: this.o.now, run: this._ffmpeg() })
        )
      } catch (e) {
        this.o.log.error('[extras] sticker failed:', e && e.message)
        await this._reply(conn, msg, T.convertFail(whyConvertFailed(e)))
        return { ok: false, reason: (e && e.code) || 'error' }
      }
      await conn.sendMessage(jid, { sticker: webp }, { quoted: msg })
      return { ok: true, animated: media.kind === 'video', bytes: webp.length }
    } catch (e) {
      this.o.log.error('[extras] sticker error:', (e && e.stack) || e)
      return { ok: false, reason: 'error' }
    }
  }

  /* ───────────── .toimg ───────────── */
  async toimg(conn, msg) {
    const p = this.o.prefix
    const jid = msg && msg.key && msg.key.remoteJid
    try {
      const media = findMedia(msg)
      if (media && media.blocked) { await this._reply(conn, msg, T.viewOnce); return { ok: false, reason: 'viewonce' } }
      if (!media || media.kind !== 'sticker') { await this._reply(conn, msg, T.toimgUsage(p)); return { ok: false, reason: 'usage' } }
      if (media.node.isAnimated) { await this._reply(conn, msg, T.animatedSticker); return { ok: false, reason: 'animated' } }
      const size = toNum(media.node.fileLength)
      if (size > this.o.maxInputBytes) { await this._reply(conn, msg, T.tooBig(Math.round(this.o.maxInputBytes / 1048576))); return { ok: false, reason: 'too-big' } }
      let png
      try {
        const buf = await this._download(media.node, 'sticker')
        png = await this.limiter.run(() => webpToPng(buf, { run: this._ffmpeg() }))
      } catch (e) {
        this.o.log.error('[extras] toimg failed:', e && e.message)
        await this._reply(conn, msg, T.convertFail(whyConvertFailed(e)))
        return { ok: false, reason: (e && e.code) || 'error' }
      }
      await conn.sendMessage(jid, { image: png, caption: '🖼️ Sticker → Image' }, { quoted: msg })
      return { ok: true, bytes: png.length }
    } catch (e) {
      this.o.log.error('[extras] toimg error:', (e && e.stack) || e)
      return { ok: false, reason: 'error' }
    }
  }

  /* ───────────── .tagall ───────────── */
  async tagall(conn, msg, arg, opts = {}) {
    try {
      const gate = await this._gate(conn, msg, opts)
      if (!gate.ok) return gate
      const jid = msg.key.remoteJid
      const wait = this._cooldown(`tagall|${jid}`, this.o.tagallCooldownMs)
      if (wait) { await this._reply(conn, msg, T.cooldown(wait)); return { ok: false, reason: 'cooldown' } }

      const { grp } = gate
      const members = grp.participants.filter((m) => !m.aliases.some((a) => grp.botAliases.includes(a)))
      if (!members.length) { await this._reply(conn, msg, T.tagallEmpty); return { ok: false, reason: 'empty' } }
      const note = this._argText(msg, arg).slice(0, 500)
      const text = `📢 *TAG ALL*${note ? `\n\n💬 ${note}` : ''}\n\n${members.map((m) => `• @${userOf(m.id)}`).join('\n')}`
      await conn.sendMessage(jid, { text, mentions: members.map((m) => m.id) }, { quoted: msg })
      return { ok: true, count: members.length }
    } catch (e) {
      this.o.log.error('[extras] tagall error:', (e && e.stack) || e)
      return { ok: false, reason: 'error' }
    }
  }

  /* ───────────── .kick ───────────── */
  async kick(conn, msg, arg, opts = {}) {
    const p = this.o.prefix
    try {
      const gate = await this._gate(conn, msg, opts, { needBotAdmin: true })
      if (!gate.ok) return gate
      const { grp } = gate
      const jid = msg.key.remoteJid

      const raw = kickTargets(msg, this._argText(msg, arg))
      if (!raw.length) { await this._reply(conn, msg, T.kickUsage(p)); return { ok: false, reason: 'usage' } }
      if (raw.length > this.o.kickMax) { await this._reply(conn, msg, T.kickTooMany(this.o.kickMax)); return { ok: false, reason: 'too-many' } }

      const toRemove = []
      const skipped = []
      for (const t of raw) {
        const al = aliasesOf({ id: t }, ['id'])
        const id = al.map((a) => grp.index.get(a)).find(Boolean)
        const label = `@${userOf(id || t)}`
        if (!id) { skipped.push(`${label} (group එකේ නැහැ)`); continue }
        const member = grp.participants.find((m) => m.id === id) // index එක හැදුවේ participants වලින්, ඒ නිසා හැමවිටම හම්බෙනවා
        if (member.aliases.some((a) => grp.botAliases.includes(a))) { skipped.push(`${label} (bot ම)`); continue }
        if (member.admin) { skipped.push(`${label} (admin — මුලින් demote කරන්න)`); continue }
        if (member.aliases.some((a) => this.o.ownerNumbers.includes(a))) { skipped.push(`${label} (bot owner)`); continue }
        toRemove.push(id)
      }

      const removed = []
      const failed = []
      if (toRemove.length) {
        let res
        try {
          res = await conn.groupParticipantsUpdate(jid, toRemove, 'remove')
        } catch (e) {
          this.o.log.error('[extras] kick failed:', e && e.message)
          for (const id of toRemove) failed.push(`@${userOf(id)} (${(e && e.message) || 'error'})`)
          res = null
        }
        if (res) {
          for (const id of toRemove) {
            const r = Array.isArray(res) ? res.find((x) => userOf(x && x.jid) === userOf(id)) : null
            const ok = Array.isArray(res) ? !!r && String(r.status) === '200' : true
            if (ok) removed.push(id)
            else failed.push(`@${userOf(id)} (${r ? r.status : 'no response'})`)
          }
        }
      }

      const lines = []
      if (removed.length) lines.push(`✅ Remove කළා: ${removed.map((id) => `@${userOf(id)}`).join(', ')}`)
      if (skipped.length) lines.push(`⚠️ Skip කළා: ${skipped.join(', ')}`)
      if (failed.length) lines.push(`❌ බැරි වුණා: ${failed.join(', ')}`)
      const mentions = [...removed, ...toRemove.filter((id) => !removed.includes(id))]
      await this._reply(conn, msg, lines.join('\n'), { mentions })
      return { ok: removed.length > 0, removed, skipped, failed }
    } catch (e) {
      this.o.log.error('[extras] kick error:', (e && e.stack) || e)
      return { ok: false, reason: 'error' }
    }
  }

  /* ───────────── internals ───────────── */
  _argText(msg, arg) {
    if (arg !== undefined && arg !== null) return String(arg).trim()
    return getText(msg).trim().split(/\s+/).slice(1).join(' ')
  }

  _stickerArgs(a) {
    let rest = String(a || '').trim()
    let mode = 'full'
    const m = rest.match(/^(crop|full)\b\s*/i)
    if (m) { mode = m[1].toLowerCase(); rest = rest.slice(m[0].length) }
    const [pk, au] = rest.split('|')
    return { mode, pack: cleanText(pk, this.o.packName), author: cleanText(au, this.o.authorName) }
  }

  _ffmpeg() {
    if (this.deps.runFfmpeg) return this.deps.runFfmpeg
    return (args) => runFfmpeg(args, { bin: this.o.ffmpegPath })
  }

  async _download(node, kind) {
    if (this.deps.download) return this.deps.download(node, kind)
    const b = await loadBaileys()
    const fn = b && (b.downloadContentFromMessage || (b.default && b.default.downloadContentFromMessage))
    if (!fn) throw Object.assign(new Error('Baileys downloadContentFromMessage හොයාගන්න බැරි වුණා'), { code: 'NO_BAILEYS' })
    return streamToBuffer(await fn(node, kind), this.o.maxInputBytes)
  }

  // 0 = allowed (and starts the cooldown), >0 = තත්පර කීයකින් ආයෙත් try කරන්න පුළුවන්ද
  _cooldown(key, ms) {
    if (!ms) return 0
    const now = this.o.now()
    const last = this.cool.get(key)
    if (last != null && now - last < ms) return Math.ceil((ms - (now - last)) / 1000)
    this.cool.set(key, now)
    if (this.cool.size > 2000) this.cool.delete(this.cool.keys().next().value)
    return 0
  }

  async _reply(conn, msg, text, extra = {}) {
    try {
      await conn.sendMessage(msg.key.remoteJid, { text, ...extra }, { quoted: msg })
      return true
    } catch (e) {
      this.o.log.error('[extras] sendMessage failed:', e && e.message)
      return false
    }
  }

  async _loadGroup(conn, jid) {
    try {
      const md = await conn.groupMetadata(jid)
      const participants = []
      const admins = new Set()
      const index = new Map()
      for (const part of (md && md.participants) || []) {
        const aliases = aliasesOf(part, PARTICIPANT_FIELDS)
        participants.push({ id: part.id, admin: !!part.admin, aliases })
        for (const a of aliases) {
          index.set(a, part.id)
          if (part.admin) admins.add(a)
        }
      }
      const botAliases = aliasesOf(conn.user, PARTICIPANT_FIELDS)
      return { participants, admins, index, botAliases, botIsAdmin: botAliases.some((a) => admins.has(a)) }
    } catch (e) {
      this.o.log.error('[extras] groupMetadata failed:', e && e.message)
      return null
    }
  }

  // group එකක්ද? caller admin/owner ද? (kick වලට bot admin ද?)
  async _gate(conn, msg, opts = {}, { needBotAdmin = false } = {}) {
    const jid = msg && msg.key && msg.key.remoteJid
    if (typeof jid !== 'string' || !jid.endsWith('@g.us')) {
      await this._reply(conn, msg, T.groupOnly)
      return { ok: false, reason: 'not-group' }
    }
    const grp = await this._loadGroup(conn, jid)
    if (!grp) { await this._reply(conn, msg, T.noMeta); return { ok: false, reason: 'no-metadata' } }
    const aliases = aliasesOf(msg.key, KEY_FIELDS)
    const isOwner = !!opts.isOwner || !!msg.key.fromMe || aliases.some((a) => this.o.ownerNumbers.includes(a))
    const isAdmin = aliases.some((a) => grp.admins.has(a))
    if (!isOwner && !isAdmin) { await this._reply(conn, msg, T.adminOnly); return { ok: false, reason: 'not-admin' } }
    if (needBotAdmin && !grp.botIsAdmin) { await this._reply(conn, msg, T.botNotAdmin); return { ok: false, reason: 'bot-not-admin' } }
    return { ok: true, grp, isOwner, isAdmin }
  }
}

module.exports = {
  Extras, T, BAN_API,
  normalizeNumber, classifyBan, formatBan, checkBan,
  buildStickerExif, addStickerExif, makeSticker, webpToPng, runFfmpeg, resolveFfmpeg,
  findMedia, kickTargets, quotedNumber, decodeJid,
}
