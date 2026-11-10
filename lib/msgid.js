'use strict';
/**
 * lib/msgid.js — message ids that look like they come from an iPhone or an Android phone.
 *
 * WhatsApp ids are chosen by the sending app, and other bots / "/devicecheck" guess the device from their shape
 * (see detectDevice below — the same rules as plugins/antiguard-core.js):
 *      iOS      "3A" + 18 chars      (20 chars)
 *      Android  32 chars  (or 21)
 *      Web      "3E…" + 20 chars     (22)  ← what Baileys sends: "3EB0" + 18 hex
 *
 * What this does NOT do: WhatsApp's servers still know this is a linked device. Only the label that other bots and
 * /devicecheck read is changed. It does not protect from bans.
 *
 * Why a patch? This Baileys fork builds   generateWAMessage(jid, content, { …, ...options, messageId: generateMessageIDV2() })
 * i.e. the generated id is written AFTER the caller's options, so { messageId } passed to sendMessage() is thrown away.
 * ensurePatched() swaps those two lines in node_modules (idempotent, keeps a ".orig" copy, runs before the library loads).
 */
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

// ───────────────────────────── the ids
const hex = (n) => crypto.randomBytes(Math.ceil(n / 2)).toString('hex').toUpperCase().slice(0, n);
// prefixes that other bots treat as "this is a bot" — never produce them by accident
const BOTLIKE = /^(3EB0|BAE5|B24E|NJX|QUEEN|SUKI|LYNX|TEDDY|MATHI|FELZ|RAVEN)/i;

const makers = {
    ios: () => '3A' + hex(18),                                      // 20 chars
    android: () => { let id; do { id = hex(32); } while (BOTLIKE.test(id)); return id; },   // 32 chars
};

/** same guess that plugins/antiguard-core.js (.devicecheck) and most bots make */
function detectDevice(id) {
    if (typeof id !== 'string' || !id) return 'unknown';
    if (/^3A.{18}$/.test(id)) return 'ios';
    if (/^3E.{20}$/.test(id)) return 'web';
    if (/^(.{21}|.{32})$/.test(id)) return 'android';
    if (/^.{18}$/.test(id)) return 'desktop';
    return 'unknown';
}

/** style: 'auto' (one fixed phone type per bot number) | 'ios' | 'android' | 'mixed' (random per message) | 'off' */
function styleFor(style, botNumber) {
    const s = String(style || 'off').toLowerCase();
    if (s !== 'auto') return s;
    return crypto.createHash('sha1').update(String(botNumber || '')).digest()[0] % 2 ? 'ios' : 'android';
}

/** → function that returns a fresh id, or null when spoofing is off */
function makeGenerator(style, botNumber) {
    const s = String(style || 'off').toLowerCase();
    if (s === 'off') return null;
    if (s === 'mixed') return () => (Math.random() < 0.5 ? makers.ios : makers.android)();
    return makers[styleFor(s, botNumber)] || null;
}

// ───────────────────────────── the patch
// Only the NORMAL send path is touched (the call that has `getCallLink: sock.createCallLink`). The album branch below it
// has the same two lines but there every album item needs its OWN id, so it must keep generating them.
const HEAD = 'getCallLink:\\s*sock\\.createCallLink,((?:(?!\\}\\);)[\\s\\S])*?)';
// wrong order (caller's id thrown away):  ...options,  messageId: generateMessageIDV2(userJid)  });
const WRONG = new RegExp(HEAD + '\\.\\.\\.options,(\\s*)messageId:\\s*generateMessageIDV2\\(userJid\\)(\\s*)\\}\\);');
// right order:                            messageId: generateMessageIDV2(userJid),  ...options  });
const RIGHT = new RegExp(HEAD + 'messageId:\\s*generateMessageIDV2\\(userJid\\),\\s*\\.\\.\\.options\\s*\\}\\);');

function libFile() {
    try { return path.join(path.dirname(require.resolve('@dnuzi/baileys')), 'socket', 'messages-send.js'); }
    catch { return null; }
}

/** 'needs-patch' | 'patched' | 'unknown' (a different library version: cannot tell) */
function inspect(src) {
    if (WRONG.test(src)) return 'needs-patch';
    return RIGHT.test(src) ? 'patched' : 'unknown';
}
const patchSource = (src) => src.replace(WRONG, (m, mid, a, b) => `getCallLink: sock.createCallLink,${mid}messageId: generateMessageIDV2(userJid),${a}...options${b}});`);

/**
 * Make sure the library honours options.messageId. Returns 'patched' | 'unknown' | 'missing' | 'failed'
 * (only the first one means that spoofed ids will really be used).
 */
function ensurePatched(config = {}, log = console, file = libFile()) {
    if (String(config.MESSAGE_ID_STYLE || 'off').toLowerCase() === 'off') return 'off';
    if (!file || !fs.existsSync(file)) return 'missing';
    try {
        const src = fs.readFileSync(file, 'utf8');
        const st = inspect(src);
        if (st === 'patched') return 'patched';
        if (st === 'unknown') { log.warn('[msgid] this Baileys version looks different; message-id style is NOT applied'); return 'unknown'; }
        if (!fs.existsSync(file + '.orig')) fs.writeFileSync(file + '.orig', src);
        fs.writeFileSync(file, patchSource(src));
        log.log('[msgid] patched Baileys so that custom message ids are honoured');
        return 'patched';
    } catch (e) {
        log.warn('[msgid] could not patch Baileys (' + e.message + '); message-id style is NOT applied');
        return 'failed';
    }
}

module.exports = { detectDevice, makers, styleFor, makeGenerator, ensurePatched, inspect, patchSource, libFile, WRONG, RIGHT };
