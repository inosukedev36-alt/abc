'use strict'
/**
 * antiguard-core.js
 * ─────────────────
 * ANTI-SPAM : එකම message එක `spamLimit` (default 10) වතාවක් දිගටම එව්වොත් ඒ member ව group එකෙන් remove කරනවා.
 * ANTI-BOT  : Message එක එවපු device එක "web" නම් (message ID format එකෙන් හඳුනාගන්නවා)
 *             message එක delete කරලා "ANTIBOT" notice එකක් දානවා.
 *
 * Baileys (@whiskeysockets/baileys / @adiwajshing/baileys) bots වලට. require() කරද්දී side-effects නැහැ,
 * ඒ නිසා `plugins/` folder එක ඇතුලට දාන්න පුළුවන්.
 */

const fs = require('fs')
const path = require('path')
const crypto = require('crypto')

/* ═════════════════ Bot messages (මෙතනින් වෙනස් කරගන්න පුළුවන්) ═════════════════ */
const TXT = {
  spamRemoved: (user, n) =>
    `🚫 *ANTISPAM*\n@${user} ව එකම message එක ${n} වතාවක් දිගටම එවූ නිසා group එකෙන් remove කළා.`,
  botDeleted: (user) =>
    `🤖 *ANTIBOT*\n@${user},  bot ලගෙන් මේ group එකට message යවන්න අවසර නැහැ. ඔයාගේ message එක delete කළා.`,
  groupOnly: '⛔ මේ command එක group එකක් ඇතුලේ විතරයි පාවිච්චි කරන්න පුළුවන්.',
  adminOnly: '⛔ මේ command එක group admins ට (හෝ bot owner ට) විතරයි.',
  noMeta: '⚠️ Group info ගන්න බැරි වුණා. පොඩ්ඩකින් ආයෙත් try කරන්න.',
  botNotAdmin: '⚠️ Bot ට admin නැති නිසා message delete කරන්න / member remove කරන්න බැහැ. Bot ව group admin කරන්න.',
  notSaved: '⚠️ Setting එක file එකට save කරන්න බැරි වුණා (bot restart වුණාම reset වෙයි).',
}
const FEATURE = { antispam: 'Anti-spam', antibot: 'Anti-bot' }
const ON_WORDS = new Set(['on', 'enable', 'enabled', 'true', '1', 'yes'])
const OFF_WORDS = new Set(['off', 'disable', 'disabled', 'false', '0', 'no'])

function onText(feature, o) {
  return feature === 'antispam'
    ? `✅ *Anti-spam ON*\nකෙනෙක් එකම message එක ${o.spamLimit} වතාවක් දිගටම එව්වොත් ඒ member ව group එකෙන් remove කරනවා.`
    : `✅ *Anti-bot ON*\nbot එකකින් එන message delete කරලා *ANTIBOT* notice එකක් දානවා. (Admins ට අදාළ නැහැ)`
}

/* ═════════════════ JID helpers ═════════════════ */
// "9477xxxxxxx:12@s.whatsapp.net" -> { user: "9477xxxxxxx", server: "s.whatsapp.net" }
function decodeJid(jid) {
  if (typeof jid !== 'string') return null
  const at = jid.indexOf('@')
  if (at < 1) return null
  const user = jid.slice(0, at).split(':')[0].split('_')[0]
  return user ? { user, server: jid.slice(at + 1) } : null
}
const userOf = (jid) => (decodeJid(jid) || {}).user || null
const normJid = (jid) => {
  const d = decodeJid(jid)
  return d ? `${d.user}@${d.server}` : jid
}

// LID / phone-number (PN) දෙකම එකම කෙනාට අයිති වෙන නිසා, හැම alias එකක්ම collect කරනවා
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

function toNumbers(v) {
  const list = Array.isArray(v) ? v : String(v == null ? '' : v).split(/[,\s]+/)
  return list.map((x) => String(x).replace(/\D/g, '')).filter(Boolean)
}

/* ═════════════════ Device detection ═════════════════ */
/**
 * Message ID එකේ format එකෙන් device එක අනුමාන කරනවා (bots වල පොදුවේ පාවිච්චි කරන getDevice logic එකමයි):
 *   ios     : "3A" + 18 chars   (20)
 *   web     : "3E.." + 20 chars (22)  <- WhatsApp Web/Desktop client (Baileys වගේ web-client bots ත් මේකට වැටෙනවා)
 *   android : 21 හෝ 32 chars
 *   desktop : 18 chars
 * WhatsApp ID format වෙනස් කළොත් මේක වෙනස් වෙන්න පුළුවන් (heuristic එකක්).
 */
function detectDevice(id) {
  if (typeof id !== 'string' || !id) return 'unknown'
  if (/^3A.{18}$/.test(id)) return 'ios'
  if (/^3E.{20}$/.test(id)) return 'web'
  if (/^(.{21}|.{32})$/.test(id)) return 'android'
  if (/^.{18}$/.test(id)) return 'desktop'
  return 'unknown'
}

/* ═════════════════ Message parsing ═════════════════ */
const WRAPPERS = [
  'ephemeralMessage', 'viewOnceMessage', 'viewOnceMessageV2', 'viewOnceMessageV2Extension',
  'documentWithCaptionMessage', 'editedMessage',
]
const SKIP_KEYS = new Set(['messageContextInfo', 'senderKeyDistributionMessage'])
// ඇත්තම "message" නෙවෙයි ඒවා (spam count / antibot වලට ගන්නේ නෑ)
const NON_CONTENT = new Set([
  'protocolMessage', 'reactionMessage', 'encReactionMessage', 'pollUpdateMessage', 'keepInChatMessage', 'pinInChatMessage',
])

function unwrap(message) {
  let m = message
  for (let i = 0; i < 6; i++) {
    let inner = null
    for (const w of WRAPPERS) {
      if (m && m[w] && m[w].message) { inner = m[w].message; break }
    }
    if (!inner) break
    m = inner
  }
  return m
}

const norm = (s) => String(s == null ? '' : s).replace(/\s+/g, ' ').trim()
const b64 = (x) => {
  if (!x) return ''
  if (typeof x === 'string') return x
  try { return Buffer.from(x).toString('base64') } catch (_) { return '' }
}

// "එකම message එක" කියන්නේ මොකක්ද කියලා තීරණය කරන signature එක
function signatureOf(content, type, fallbackId) {
  const m = content[type]
  if (type === 'conversation') return 't:' + norm(m)
  if (type === 'extendedTextMessage') return 't:' + norm(m && m.text)
  const sha = m && b64(m.fileSha256)
  if (sha) return `${type}:${sha}:${norm(m.caption)}` // image / video / sticker / audio / document
  if (type === 'contactMessage') return 'contact:' + norm(m && m.vcard)
  if (type === 'locationMessage') return `loc:${m && m.degreesLatitude},${m && m.degreesLongitude}`
  try {
    return type + ':' + crypto.createHash('sha1').update(JSON.stringify(m)).digest('base64')
  } catch (_) {
    return type + ':' + fallbackId // unique -> කවදාවත් "එකම" කියලා ගණන් ගන්නේ නෑ
  }
}

function getText(msg) {
  const c = unwrap((msg && msg.message) || {}) || {}
  if (typeof c.conversation === 'string') return c.conversation
  for (const k of ['extendedTextMessage', 'imageMessage', 'videoMessage', 'documentMessage']) {
    if (c[k]) return c[k].text || c[k].caption || ''
  }
  return ''
}

function quotedId(msg) {
  const c = unwrap((msg && msg.message) || {}) || {}
  for (const k of Object.keys(c)) {
    const ci = c[k] && c[k].contextInfo
    if (ci && ci.stanzaId) return ci.stanzaId
  }
  return null
}

/** Group එකක තියෙන, අනිත් කෙනෙක් එවපු සැබෑ message එකක් නම් විතරක් parsed object එකක් දෙනවා, නැත්නම් null */
function parseMessage(msg) {
  const key = msg && msg.key
  if (!key || !key.id || typeof key.remoteJid !== 'string') return null
  if (key.fromMe) return null // bot ගේම messages (Baileys IDs "web" වගේ පේන නිසා අනිවාර්යයෙන් skip කරන්න ඕන)
  if (!key.remoteJid.endsWith('@g.us')) return null // groups විතරයි
  if (!msg.message || typeof msg.message !== 'object') return null
  const content = unwrap(msg.message)
  if (!content || typeof content !== 'object') return null
  const type = Object.keys(content).find((k) => !SKIP_KEYS.has(k) && content[k] != null)
  if (!type || NON_CONTENT.has(type)) return null
  const aliases = aliasesOf(key, KEY_FIELDS)
  if (!aliases.length) return null
  return {
    group: key.remoteJid,
    id: key.id,
    key,
    type,
    aliases,
    sender: aliases[0],
    senderJid: key.participant || key.participantAlt || null,
    sig: signatureOf(content, type, key.id),
  }
}

/* ═════════════════ Settings store (JSON file) ═════════════════ */
class Store {
  constructor(file, log) {
    this.file = file
    this.log = log
    this.data = Object.create(null)
    try {
      if (fs.existsSync(file)) {
        const parsed = JSON.parse(fs.readFileSync(file, 'utf8'))
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) Object.assign(this.data, parsed)
      }
    } catch (e) {
      log.warn('[antiguard] settings file unreadable, starting fresh:', e.message)
    }
  }
  get(group) {
    const g = this.data[group]
    return { antispam: !!(g && g.antispam), antibot: !!(g && g.antibot) }
  }
  set(group, feature, enabled) {
    const g = this.data[group] && typeof this.data[group] === 'object' ? this.data[group] : (this.data[group] = {})
    g[feature] = !!enabled
    return this.save()
  }
  save() {
    try {
      fs.mkdirSync(path.dirname(this.file), { recursive: true })
      const tmp = `${this.file}.tmp`
      fs.writeFileSync(tmp, JSON.stringify(this.data, null, 2))
      fs.renameSync(tmp, this.file)
      return true
    } catch (e) {
      this.log.error('[antiguard] settings save failed:', e.message)
      return false
    }
  }
}

const removeOk = (res) => (Array.isArray(res) ? res.length > 0 && res.every((r) => String(r && r.status) === '200') : true)

/* ═════════════════ Main class ═════════════════ */
class AntiGuard {
  /**
   * @param {object} [opts]
   *  dbFile           settings file (default ./antiguard-db.json)
   *  prefix           command prefix, usage text එකට විතරයි (default '.')
   *  spamLimit        එකම message කී වතාවක් දිගට එව්වොත් remove කරනවද (default 10)
   *  spamGapMs        message දෙකක් අතර මේ කාලයට වඩා ගියොත් "දිගට" කියන එක නැති වෙනවා (default 60000)
   *  noticeCooldownMs එක් කෙනෙකුට ANTIBOT notice එක දාන අවම පරතරය (default 30000)
   *  blockedDevices   antibot එකෙන් block කරන devices (default ['web'])
   *  exemptAdmins     admins ට අදාළ නොවෙන්න (default true)
   *  ownerNumbers     ['9477xxxxxxx'] — owner ට අදාළ නොවෙනවා + commands පාවිච්චි කරන්න පුළුවන්
   */
  constructor(opts = {}) {
    this.o = {
      dbFile: opts.dbFile || process.env.ANTIGUARD_DB || path.join(process.cwd(), 'antiguard-db.json'),
      prefix: opts.prefix || '.',
      spamLimit: Math.max(2, Number(opts.spamLimit) || 10),
      spamGapMs: Number(opts.spamGapMs) || 60000,
      spamCooldownMs: Number(opts.spamCooldownMs) || 60000,
      noticeCooldownMs: opts.noticeCooldownMs != null ? Number(opts.noticeCooldownMs) : 30000,
      metaTtlMs: opts.metaTtlMs != null ? Number(opts.metaTtlMs) : 30000,
      blockedDevices: (opts.blockedDevices || ['web']).map((d) => String(d).toLowerCase()),
      exemptAdmins: opts.exemptAdmins !== false,
      ownerNumbers: toNumbers(opts.ownerNumbers != null ? opts.ownerNumbers : process.env.OWNER_NUMBER),
      now: typeof opts.now === 'function' ? opts.now : Date.now,
      log: opts.log || console,
    }
    this.store = new Store(this.o.dbFile, this.o.log)
    this.streaks = new Map() // "group|sender" -> { sig, count, last, cooldownUntil }
    this.seen = new Set() // duplicate deliveries filter
    this.meta = new Map() // group -> { at, ttl, promise }
    this.noticeAt = new Map()
    this.warnedAt = new Map()
  }

  /* ───────────── every incoming message ───────────── */
  async handleMessage(conn, msg) {
    try {
      const p = parseMessage(msg)
      if (!p) return null
      if (this._seen(p)) return null
      const st = this.store.get(p.group)
      if (!st.antispam && !st.antibot) return null

      // NOTE: count කිරීම synchronous — burst එකක් ආවත් order එක නොවෙනස්ව තියෙනවා
      const spam = st.antispam ? this._track(p) : false
      const web = st.antibot && this.o.blockedDevices.includes(detectDevice(p.id))
      if (!spam && !web) return null
      return await this._enforce(conn, p, { spam, web })
    } catch (e) {
      this.o.log.error('[antiguard] handleMessage error:', (e && e.stack) || e)
      return { error: String((e && e.message) || e) }
    }
  }

  /** `conn.ev.on('messages.upsert', u => guard.handleUpsert(conn, u))` සඳහා */
  async handleUpsert(conn, upsert) {
    if (!upsert || !Array.isArray(upsert.messages)) return []
    if (upsert.type && upsert.type !== 'notify') return []
    return Promise.all(upsert.messages.map((m) => this.handleMessage(conn, m)))
  }

  /* ───────────── commands: .antispam on/off , .antibot on/off ───────────── */
  async handleCommand(conn, msg, command, arg, opts = {}) {
    const feature = String(command).toLowerCase() === 'antibot' ? 'antibot' : 'antispam'
    const key = (msg && msg.key) || {}
    const jid = key.remoteJid
    const reply = (text) => this._send(conn, jid, { text }, { quoted: msg })
    try {
      if (typeof jid !== 'string' || !jid.endsWith('@g.us')) {
        await reply(TXT.groupOnly)
        return { ok: false, reason: 'not-group' }
      }
      const aliases = aliasesOf(key, KEY_FIELDS)
      const isOwner = !!opts.isOwner || !!key.fromMe || aliases.some((a) => this.o.ownerNumbers.includes(a))
      const ctx = await this._groupCtx(conn, jid, true)
      const isAdmin = !!ctx && aliases.some((a) => ctx.admins.has(a))
      if (!isOwner && !isAdmin) {
        await reply(ctx ? TXT.adminOnly : TXT.noMeta)
        return { ok: false, reason: ctx ? 'not-admin' : 'no-metadata' }
      }

      let a = arg
      if (a === undefined || a === null) a = getText(msg).trim().split(/\s+/).slice(1).join(' ')
      const word = String(a).trim().toLowerCase().split(/\s+/)[0]
      const label = FEATURE[feature]

      if (ON_WORDS.has(word) || OFF_WORDS.has(word)) {
        const enable = ON_WORDS.has(word)
        const saved = this.store.set(jid, feature, enable)
        let text = enable ? onText(feature, this.o) : `❌ *${label} OFF*`
        if (enable && ctx && !ctx.botIsAdmin) text += `\n\n${TXT.botNotAdmin}`
        if (!saved) text += `\n\n${TXT.notSaved}`
        await reply(text)
        return { ok: true, feature, enabled: enable }
      }
      const cur = this.store.get(jid)[feature]
      const pf = this.o.prefix
      await reply(`ℹ️ *${label}* දැන්: ${cur ? 'ON ✅' : 'OFF ❌'}\n\nභාවිතය:\n${pf}${feature} on\n${pf}${feature} off`)
      return { ok: true, feature, enabled: cur, usage: true }
    } catch (e) {
      this.o.log.error('[antiguard] handleCommand error:', (e && e.stack) || e)
      return { ok: false, reason: 'error' }
    }
  }

  /** .devicecheck — message එකකට reply කරලා ගැහුවොත් ඒ message එක එවපු device එක (bot හඳුනාගන්නා විදිහට) පෙන්නනවා */
  async handleDeviceCheck(conn, msg) {
    const key = (msg && msg.key) || {}
    const qid = quotedId(msg)
    const id = qid || key.id
    const device = detectDevice(id)
    const blocked = this.o.blockedDevices.includes(device)
    const text =
      `📱 *Device check*\n${qid ? 'Reply කරපු message එකේ' : 'ඔයාගේ message එකේ'} ID: ${id}\n` +
      `Detected device: *${device}*\n` +
      `Anti-bot block list: ${this.o.blockedDevices.join(', ')} → ${blocked ? 'BLOCK වෙනවා 🚫' : 'allow ✅'}`
    await this._send(conn, key.remoteJid, { text }, { quoted: msg })
    return { id, device, blocked }
  }

  /* ───────────── internals ───────────── */
  _seen(p) {
    const k = `${p.group}|${p.id}`
    if (this.seen.has(k)) return true
    this.seen.add(k)
    if (this.seen.size > 3000) this.seen.delete(this.seen.values().next().value)
    return false
  }

  // true ආවොත් = මේ message එකෙන් spam limit එක කැඩුණා
  _track(p) {
    const now = this.o.now()
    const k = `${p.group}|${p.sender}`
    let s = this.streaks.get(k)
    if (s && s.cooldownUntil > now) return false // දැනටමත් remove කරමින් ඉන්නේ — ඉතිරි burst එක ignore
    if (!s || s.sig !== p.sig || now - s.last > this.o.spamGapMs) {
      s = { sig: p.sig, count: 1, last: now, cooldownUntil: 0 }
      this.streaks.set(k, s)
    } else {
      s.count++
      s.last = now
    }
    if (this.streaks.size > 5000) this._prune(now)
    if (s.count >= this.o.spamLimit) {
      s.count = 0
      s.cooldownUntil = now + this.o.spamCooldownMs
      return true
    }
    return false
  }

  _prune(now) {
    for (const [k, s] of this.streaks) {
      if (now - s.last > this.o.spamGapMs && s.cooldownUntil < now) this.streaks.delete(k)
    }
  }

  _noticeAllowed(k) {
    const now = this.o.now()
    const last = this.noticeAt.get(k)
    if (last != null && now - last < this.o.noticeCooldownMs) return false
    this.noticeAt.set(k, now)
    if (this.noticeAt.size > 2000) this.noticeAt.delete(this.noticeAt.keys().next().value)
    return true
  }

  async _send(conn, jid, content, options) {
    try {
      await conn.sendMessage(jid, content, options)
      return true
    } catch (e) {
      this.o.log.error('[antiguard] sendMessage failed:', e && e.message)
      return false
    }
  }

  // group admins list (cache + in-flight sharing, burst එකකදී metadata request එකක් විතරයි යන්නේ)
  _groupCtx(conn, group, force = false) {
    const now = this.o.now()
    const hit = this.meta.get(group)
    if (!force && hit && now - hit.at < hit.ttl) return hit.promise
    const entry = { at: now, ttl: this.o.metaTtlMs, promise: null }
    entry.promise = this._loadMeta(conn, group).then((ctx) => {
      entry.at = this.o.now()
      if (!ctx) entry.ttl = 5000 // fail වුණාම තත්පර 5ක් retry කරන්නේ නෑ (rate-limit වළක්වන්න)
      return ctx
    })
    this.meta.set(group, entry)
    return entry.promise
  }

  async _loadMeta(conn, group) {
    try {
      const md = await conn.groupMetadata(group)
      const admins = new Set()
      const index = new Map()
      for (const part of (md && md.participants) || []) {
        const al = aliasesOf(part, PARTICIPANT_FIELDS)
        for (const a of al) {
          index.set(a, part.id)
          if (part.admin) admins.add(a)
        }
      }
      const botAliases = aliasesOf(conn.user, PARTICIPANT_FIELDS)
      return { admins, index, botAliases, botIsAdmin: botAliases.some((a) => admins.has(a)) }
    } catch (e) {
      this.o.log.error('[antiguard] groupMetadata failed:', e && e.message)
      return null
    }
  }

  async _enforce(conn, p, hit) {
    const ctx = await this._groupCtx(conn, p.group)
    if (!ctx) return { skipped: 'no-metadata' }

    const isSelf = p.aliases.some((a) => ctx.botAliases.includes(a))
    const isOwner = p.aliases.some((a) => this.o.ownerNumbers.includes(a))
    const isAdmin = p.aliases.some((a) => ctx.admins.has(a))
    if (isSelf || isOwner || (this.o.exemptAdmins && isAdmin)) return { skipped: 'exempt' }

    if (!ctx.botIsAdmin) {
      this._warnNotAdmin(p.group)
      return { skipped: 'bot-not-admin' }
    }

    let target = null
    for (const a of p.aliases) {
      if (ctx.index.has(a)) { target = ctx.index.get(a); break }
    }
    if (!target) target = normJid(p.senderJid)
    const shown = userOf(target) || p.sender
    const out = { deleted: false, removed: false, notices: 0 }

    if (hit.web) {
      out.deleted = await this._send(conn, p.group, { delete: p.key })
      if (out.deleted) {
        this.o.log.info(`[antiguard] ANTIBOT deleted ${detectDevice(p.id)} message from ${shown} in ${p.group}`)
        if (this._noticeAllowed(`bot|${p.group}|${p.sender}`)) {
          const ok = await this._send(conn, p.group, { text: TXT.botDeleted(shown), mentions: [target] })
          if (ok) out.notices++
        }
      }
    }

    if (hit.spam) {
      try {
        out.removed = removeOk(await conn.groupParticipantsUpdate(p.group, [target], 'remove'))
      } catch (e) {
        this.o.log.error('[antiguard] remove failed:', e && e.message)
      }
      if (out.removed) {
        this.o.log.info(`[antiguard] ANTISPAM removed ${shown} from ${p.group}`)
        const ok = await this._send(conn, p.group, { text: TXT.spamRemoved(shown, this.o.spamLimit), mentions: [target] })
        if (ok) out.notices++
      } else {
        this.o.log.warn(`[antiguard] ANTISPAM could not remove ${shown} from ${p.group}`)
      }
    }
    return out
  }

  _warnNotAdmin(group) {
    const now = this.o.now()
    const last = this.warnedAt.get(group)
    if (last != null && now - last < 600000) return
    this.warnedAt.set(group, now)
    this.o.log.warn(`[antiguard] bot is NOT admin in ${group} -> cannot delete messages / remove members`)
  }
}

let _shared = null
/** plugin + manual hook දෙකටම එකම instance එක */
function shared(opts) {
  if (!_shared) _shared = new AntiGuard(opts)
  return _shared
}

module.exports = { AntiGuard, shared, detectDevice, parseMessage, decodeJid, TXT }
