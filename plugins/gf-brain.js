'use strict';
/**
 * plugins/gf-brain.js — the AI-girlfriend layer
 *
 *   • she has ONE boyfriend: the owner. He gets the full girlfriend. Everybody else is treated like a normal,
 *     polite acquaintance (no romance, no pet names, no jealousy) — see modeOf()
 *   • every normal message to her goes through here (DM: always · group: only when she is addressed)
 *   • first she gets to know him: name → age → birthday (kept forever, MongoDB)
 *   • her boyfriend can introduce people: tag someone (or reply to them) and say "this is Nimal, my friend" →
 *     a permanent little memory by WhatsApp id, used whenever that person talks to her (lib/gf/people.js)
 *   • everything he says is remembered for MEMORY_HOURS (24h) and the relevant lines are fed to the AI
 *   • "get me the links of this playlist <url>" → she runs the real /ytpl command and answers in her voice
 *   • group commands work the same way, but ONLY with the sender's real admin/owner rights (+ a "sure?" step)
 *   • one typed command remains for personality:  /gf list · /gf taiga · /gf me · /gf forget
 *
 * Chat engine / personas: plugins/girlfriends.js        Memory + parsing + tools: lib/gf/*
 */
const config = require('../config');
const events = require('../command');
const { cmd } = events;
const { GfStore } = require('../lib/gf/store');
const P = require('../lib/gf/profile');
const M = require('../lib/gf/memory');
const { TOOLS, canon, route, buildRoute, urlsOf, lastNumber, validateMarker, markerPrompt } = require('../lib/gf/tools');
const { line, helpText, relText } = require('../lib/gf/lines');
const People = require('../lib/gf/people');
const registry = require('../lib/gf/registry');
const { checkPerm, runTool } = require('../lib/gf/exec');
const { GIRLS, CFG, processChat, say, detectLang, gfMsgs, casualOf } = require('./girlfriends');

const gfc = () => config.GF || {};
/** new plugins with a `use:` line (or a gf: block) become things she can do — no edit in lib/gf/tools.js (see lib/gf/registry.js) */
function ensureTools() {
    if (gfc().AUTO_TOOLS === false) return;
    try { registry.ensure(events.commands, config); } catch (e) { console.error('[GF] tool sync failed:', e.message); }
}
const prefixOf = () => config.PREFIX || '/';

// ═══════════════════════════ storage ═══════════════════════════
const store = new GfStore({ ttlHours: gfc().MEMORY_HOURS || 24, defaultGf: gfc().DEFAULT_GF || 'chika' });

function attachPersistence() {
    try {
        const mongoose = require('mongoose');
        const attach = async () => {
            try {
                store.adapter = require('../lib/gf/mongo')(mongoose, { ttlHours: gfc().MEMORY_HOURS || 24 });
                await store.load();
                for (const phone of store.users.keys()) store._markDirty(phone);   // users created before the DB was ready
            } catch (e) { console.error('[GF] persistence failed, running in memory only:', e.message); store.adapter = null; }
        };
        if (mongoose.connection.readyState === 1) attach();
        else mongoose.connection.once('connected', attach);
    } catch (e) { console.error('[GF] persistence disabled:', e.message); }
}
if (!process.env.GF_NO_DB) attachPersistence();
setInterval(() => store.prune(), 30 * 60_000).unref();

// ═══════════════════════════ small state ═══════════════════════════
const pendingAsk = new Map();       // "chat|phone" → she asked for a missing url / title / number / target
const pendingConfirm = new Map();   // "chat|phone" → waiting for "yes" before kick / promote / …
const queues = new Map();           // phone → { chain, n }   (one message at a time per person)
const nudged = new Map();           // phone → last time she asked a group member to DM her
const seen = new Set();             // message ids already handled
const ASK_MS = 2 * 60_000;

const YES = /^\s*(yes|y|yeah|yep|yup|ok|okay|sure|do it|confirm|ow|ඔව්|ඔව|හරි|කරන්න|කරපන්)[\s.!]*$/i;
const NO = /^\s*(no|n|nope|nah|cancel|stop|don'?t|epa|na|naa|නෑ|එපා|නැහැ|නැ)[\s.!]*$/i;
const escapeRe = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// ONE girlfriend for the whole bot: the personality her boyfriend (the owner) picked with /gf.
const BOT_KEY = '__bot__';
function gfOf() {
    const b = store.getUser(BOT_KEY, false);
    return GIRLS[(b && b.gf) || gfc().DEFAULT_GF] || Object.values(GIRLS)[0];
}
/** her boyfriend = the owner (+ any numbers listed in config.GF.BOYFRIEND_NUMBERS) */
const isBoyfriend = (ctx) => !!ctx.isOwner || (gfc().BOYFRIEND_NUMBERS || []).map(String).includes(String(ctx.senderNumber));
/** bf = her boyfriend · friend = her boyfriend but under 18 / age unknown · casual = everybody else */
const modeOf = (user, ctx) => (!isBoyfriend(ctx) ? 'casual' : (P.friendOnly(user) ? 'friend' : 'bf'));
const personaFor = (g, mode) => (mode === 'casual' ? casualOf(g) : g);

function enqueue(phone, fn, onFlood) {
    const q = queues.get(phone) || { chain: Promise.resolve(), n: 0 };
    if (q.n >= (CFG.MAX_PENDING || 3) + 2) { if (onFlood) onFlood(); return Promise.resolve(); }
    q.n++;
    q.chain = q.chain.then(fn).catch(e => console.error('[GF] handler error:', e)).finally(() => { q.n--; if (q.n <= 0) queues.delete(phone); });
    queues.set(phone, q);
    return q.chain;
}

function quotedInfo(m) {
    const q = m && m.quoted;
    if (!q) return { hasQuoted: false, quotedText: '', quotedType: '' };
    const msg = q.msg;
    const text = typeof msg === 'string' ? msg : (msg && (msg.text || msg.conversation || msg.caption)) || '';
    return { hasQuoted: true, quotedText: text, quotedType: q.type === 'viewOnceMessage' ? (msg && msg.type) || q.type : q.type };
}

// ═══════════════════════════ people she knows ═══════════════════════════
const botIdsOf = (conn) => People.candidatesOf(conn.user && conn.user.id, conn.user && conn.user.lid);
/** every id the sender can appear under: phone jid, @lid and the "alt" ids WhatsApp adds to the key */
function speakerIds(ctx, mek) {
    const k = (mek && mek.key) || {};
    return People.candidatesOf(ctx.sender, ctx.senderNumber, k.participant, k.senderPn, k.participantPn, k.participantAlt, k.senderLid,
        String(k.remoteJid || '').endsWith('@g.us') ? '' : k.remoteJid, k.remoteJidAlt);
}
/** name (+ relation) she knows for a number: introduced by her boyfriend first, else what that person told her himself */
function lookupName(digits) {
    const p = store.findPerson([digits]);
    if (p) return { name: p.name, relation: p.relation };
    const u = store.getUser(digits, false);
    return u && u.name ? { name: u.name } : null;
}

// ═══════════════════════════ is she being spoken to? ═══════════════════════════
function nameCallRe(g) {
    const names = [...new Set([g.key, String(g.name).split(/\s+/)[0], 'gf'].filter(Boolean).map(n => escapeRe(n.toLowerCase())))];
    return new RegExp('^\\s*(?:hey+|hi+|hello|oi|ඔයි|හේයි)?[\\s,]*(?:' + names.join('|') + ')(?:[\\s,:!~.?-]+|$)', 'i');
}

function isAddressed(conn, m, ctx, g) {
    if (!ctx.isGroup) return true;
    const q = m && m.quoted;
    if (q && (q.fromMe || (q.id && gfMsgs.has(q.id)))) return true;                       // he replied to something she said
    const num = (j) => String(j || '').split('@')[0].split(':')[0];
    const bot = [num(conn.user && conn.user.id), num(conn.user && conn.user.lid)].filter(Boolean);
    if ((m && m.mentioned || []).some(j => bot.includes(num(j)))) return true;           // @her
    return nameCallRe(g).test(ctx.body || '');                                            // "Taiga, …"
}

// ═══════════════════════════ context lines for the AI ═══════════════════════════
const MONTH_EN = ['', 'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function buildCtx(user, entries, text, { mode = 'bf', person = null, known = [], now = Date.now() }) {
    const bits = [];
    if (user.name) bits.push(`His name is ${user.name}.`);
    const age = P.currentAge(user, now);
    if (age != null) bits.push(`He is ${age} years old.`);
    if (user.bdayMonth) bits.push(`Birthday: ${MONTH_EN[user.bdayMonth]} ${user.bdayDay}.`);
    let birthdayNow = false;
    if (mode === 'bf' && P.isBirthdayToday(user, now) && user.bdayWished !== P.colomboDate(now).getUTCFullYear()) {
        birthdayNow = true;
        bits.push('TODAY IS HIS BIRTHDAY: wish him warmly in your own style in this reply.');
    }
    if (person) bits.push(`Your boyfriend introduced him to you${person.relation ? ' as his ' + person.relation : ''}${mode === 'casual' ? ', so be a little warmer than usual' : ''}.`);
    if (known.length) bits.push(`People he mentioned: ${known.map(k => `@${k.name}${k.relation ? ' (your boyfriend\'s ' + k.relation + ')' : ''}`).join(', ')}.`);
    const profile = bits.join(' ');
    const hint = markerPrompt(gfc().MARKER_MAX_CHARS || 600);

    const recent = entries.filter(e => e.role === 'user').length;
    const snips = M.recall(entries, text, { k: M.wantsRecall(text) ? 5 : 3, skipLast: 3, now })
        .map(e => ({ ...e, text: People.nameMentions(e.text, lookupName).text }));      // older lines too: @947… → @Nimal
    const memory = [M.timeline(entries, now), M.formatRecall(snips, now)].filter(Boolean).join(' ');
    return {
        birthdayNow,
        ctx: {
            full: [profile, memory, hint].filter(Boolean).join(' '),
            min: [profile, hint].filter(Boolean).join(' '),
            none: '',
        },
        recent,
    };
}

// ═══════════════════════════ talking ═══════════════════════════
function makeVoice(conn, mek, ctx, user, g, lang) {
    const phone = ctx.senderNumber;
    const mode = modeOf(store.getUser(phone), ctx);
    const gv = personaFor(g, mode);                  // strangers hear a plain, polite voice (lib/gf/lines.js "casual")
    const L = (key, extra) => line(key, gv, store.getUser(phone), lang, { p: prefixOf(), ...extra });
    const speak = async (text) => {
        if (!text) return;
        store.addMsg(phone, 'gf', text, g.key);
        await say(conn, ctx.from, mek, text, gv, ctx.sender);
    };
    return { L, speak, mode, tell: (key, extra) => speak(L(key, extra)) };
}

async function chat(conn, mek, m, ctx, user, g, lang, text, who = {}) {
    const phone = ctx.senderNumber;
    const mode = modeOf(user, ctx);
    const entries = store.recent(phone);
    const { ctx: ctxLines, birthdayNow } = buildCtx(user, entries, text, { mode, person: who.person, known: who.known || [] });
    const { quotedText } = quotedInfo(m);
    await processChat(conn, mek, ctx.from, ctx.reply, ctx.sender, text, personaFor(g, mode), {
        mode,
        admitAi: gfc().STRANGERS_ADMIT_AI !== false,     // only used in casual mode: honest if sincerely asked "are you an AI?"
        ctx: ctxLines,
        allowMarker: true,
        onReply: (t) => {
            store.addMsg(phone, 'gf', t, g.key);
            if (birthdayNow) store.patchUser(phone, { bdayWished: P.colomboDate().getUTCFullYear() });
        },
        // the AI decided "he asked me to DO something" → only safe tools, and the url/number must really be in HIS message
        onMarker: async (marker) => {
            const v = validateMarker(marker, { text, quotedText });
            if (!v) return;
            const r = buildRoute(v.tool, v.arg, 'marker', { mentions: m.mentioned || [], hasQuoted: !!m.quoted });
            if (r.missing) return;
            await execRoute(conn, mek, m, ctx, user, g, lang, r, { quiet: true });
        },
    });
}

// ═══════════════════════════ running a tool ═══════════════════════════
const PERM_LINE = { blocked: 'blocked', needGroup: 'needGroup', noOwner: 'noOwner', noAdmin: 'noAdmin', noBotAdmin: 'noBotAdmin' };
const ASK_LINE = { url: 'askUrl', text: 'askText', number: 'askNumber', target: 'askTarget', reply: 'askReply', onoff: 'askOnoff' };

async function runAndTell(conn, mek, m, ctx, user, g, lang, tool, arg, { quiet = false } = {}) {
    const v = makeVoice(conn, mek, ctx, user, g, lang);
    if (!quiet) await v.tell('go');
    const res = await runTool({ sock: conn, mek, m, ctx, tool, arg, commandMap: events.commandMap });
    // a command that threw, or that never said or did anything, did not work → she says so instead of "here you go"
    // (this bot's plugins start their error messages with ❌ / ⚠️ / 🚫, e.g. "❌ Could not fetch this playlist.")
    const failed = !res.ok || res.sent === 0 || /^\s*(❌|⚠️|🚫)/.test(res.lastText || '');
    store.addMsg(ctx.senderNumber, 'gf', `[I ran ${tool}${arg ? ' ' + String(arg).slice(0, 80) : ''} for him${failed ? ' but it failed' : ''}]`, g.key);
    await v.tell(failed ? 'fail' : 'ok');
    return res;
}

/** permission → missing argument → confirmation → run */
async function execRoute(conn, mek, m, ctx, user, g, lang, r, { quiet = false } = {}) {
    const v = makeVoice(conn, mek, ctx, user, g, lang);
    const key = `${ctx.from}|${ctx.senderNumber}`;

    if (TOOLS[r.tool] && TOOLS[r.tool].special === 'help') {
        const extras = Object.entries(TOOLS).filter(([, m]) => m.auto && m.perm === 'any' && !m.group).slice(0, 6).map(([name, m]) => ({ name, desc: m.desc }));
        return v.speak(helpText(personaFor(g, v.mode), user, lang, prefixOf(), extras));      // strangers get the plain voice (and no "switch my personality")
    }
    const denied = checkPerm(r.tool, ctx, config);
    if (denied) return v.tell(PERM_LINE[denied] || 'blocked');

    if (r.missing) {
        if (r.missing !== 'reply') pendingAsk.set(key, { tool: r.tool, expect: r.missing, expires: Date.now() + ASK_MS });
        const custom = TOOLS[r.tool].ask;                                     // gf: { ask: { si: '…', en: '…' } } in the plugin
        const q = custom && (typeof custom === 'string' ? custom : (lang === 'en' ? custom.en || custom.si : custom.si || custom.en));
        if (q) return v.speak(q);
        return v.tell(ASK_LINE[r.missing] || 'askText');
    }
    if (TOOLS[r.tool].confirm) {
        pendingConfirm.set(key, { tool: r.tool, arg: r.arg, mek, m, ctx, expires: Date.now() + (gfc().CONFIRM_SECONDS || 60) * 1000 });
        return v.tell('confirm', { tool: r.tool });
    }
    return runAndTell(conn, mek, m, ctx, user, g, lang, r.tool, r.arg, { quiet });
}

// ═══════════════════════════ getting to know him ═══════════════════════════
const QUESTION = { name: 'askName', age: 'askAge', bday: 'askBday' };

async function onboard(conn, mek, m, ctx, user, g, lang, text) {
    const phone = ctx.senderNumber;
    const v = makeVoice(conn, mek, ctx, user, g, lang);

    // first contact, or the question for this step has not been asked yet → ask it
    if (user.askedStep !== user.step) {
        if (user.step === 'name') {            // "hi, my name is Kasun" already answers it
            const upd = P.extractProfileUpdates(text);
            if (upd && upd.name) {
                store.patchUser(phone, { name: upd.name, step: 'age', askedStep: 'age', tries: 0 });
                return v.tell('askAge');
            }
        }
        store.patchUser(phone, { askedStep: user.step });
        return v.tell(QUESTION[user.step]);
    }

    const res = P.onboardingAnswer(user, text, { pushname: ctx.pushname });
    const after = store.patchUser(phone, { ...res.patch, ...(res.asked && res.asked !== 'retry' ? { askedStep: res.asked } : {}) });

    if (res.asked === 'retry') return v.tell('retry');
    if (res.asked) return v.tell(QUESTION[res.asked]);

    // finished
    store.patchUser(phone, { askedStep: 'done' });
    if (v.mode === 'casual') return v.tell('done');                       // a normal "nice to meet you" — nothing else
    if (P.friendOnly(after)) { await v.tell('doneFriend'); await v.tell('friend'); }
    else await v.tell('done');
    return v.tell('hint');
}

// ═══════════════════════════ one incoming message ═══════════════════════════
async function handle(conn, mek, m, ctx, rawText) {
    ensureTools();
    const phone = ctx.senderNumber;
    const user0 = store.getUser(phone);
    const g = gfOf();
    const text = rawText.replace(nameCallRe(g), '').trim() || rawText.trim();
    const lang = detectLang(text, user0.lang);
    if (lang !== user0.lang) store.patchUser(phone, { lang });
    store.patchUser(phone, { lastSeen: Date.now() });
    const user = store.getUser(phone);
    const key = `${ctx.from}|${phone}`;
    // somebody her boyfriend introduced earlier ("this is Nimal, my friend")? Then she already knows his name.
    const ids = speakerIds(ctx, mek);
    const person = store.findPerson(ids);
    if (person) { store.addAliases(person, ids); if (!user.name) store.patchUser(phone, { name: person.name }); }
    // config.GF.ASK_STRANGERS = false → only her boyfriend is interviewed; everybody else just chats
    if (user.step !== 'done' && !isBoyfriend(ctx) && gfc().ASK_STRANGERS === false) {
        store.patchUser(phone, { step: 'done', askedStep: 'done', name: user.name || P.parseName(ctx.pushname) || '' });
    }
    const v = makeVoice(conn, mek, ctx, user, g, lang);

    // groups are no place for a get-to-know-you interview (unless she already knows his name: then she just chats)
    if (ctx.isGroup && user.step !== 'done' && !user.name) {
        if (Date.now() - (nudged.get(phone) || 0) > 3600_000) { nudged.set(phone, Date.now()); await v.tell('groupNudge'); }
        return;
    }

    // "@94771234567 hi" → "@Nimal hi" for people she knows (the router keeps the raw text; the AI and the 24h log get names)
    const named = People.nameMentions(text, lookupName);
    store.addMsg(phone, 'user', named.text);                 // everything he says is remembered for 24h

    // 1) "are you sure?" answers
    const conf = pendingConfirm.get(key);
    if (conf) {
        pendingConfirm.delete(key);
        if (conf.expires > Date.now()) {
            if (YES.test(text)) return runAndTell(conn, conf.mek, conf.m, conf.ctx, user, g, lang, conf.tool, conf.arg, { quiet: true });
            if (NO.test(text)) return v.tell('cancelled');
        }
    }

    // 2) getting to know him (in a DM)
    if (user.step !== 'done' && !ctx.isGroup) {
        if (person && user.step === 'name' && !user.askedStep) {          // introduced by her boyfriend: the name question is already answered
            store.patchUser(phone, { name: person.name, step: 'age', askedStep: 'age', tries: 0 });
            return v.tell('knownAge', { relText: relText(person.relation, lang) });
        }
        return onboard(conn, mek, m, ctx, user, g, lang, text);
    }

    // 3) "my birthday is …", "I'm 24" said later in the chat
    const upd = P.extractProfileUpdates(text);
    if (upd) store.patchUser(phone, upd);

    const { hasQuoted, quotedText, quotedType } = quotedInfo(m);
    const input = { text, quotedText, quotedType, hasQuoted, mentions: m.mentioned || [], isGroup: ctx.isGroup };

    // 3b) her boyfriend introduces someone, or asks who somebody is
    if (isBoyfriend(ctx)) {
        const exclude = [...botIdsOf(conn), ...ids];
        const quotedSender = m.quoted && m.quoted.sender;
        const intro = People.parseIntroduction(text, { mentions: input.mentions, quotedSender, exclude });
        if (intro) return introduce(conn, mek, ctx, user, g, lang, intro);
        if (People.asksWho(text)) {
            const target = People.pickTarget(input.mentions, quotedSender, exclude);
            if (target) return tellWho(conn, mek, ctx, user, g, lang, target);
        }
    }

    // 4) she asked for a missing link / title / number — this message is the answer
    const pa = pendingAsk.get(key);
    if (pa) {
        pendingAsk.delete(key);
        if (pa.expires > Date.now()) {
            const other = route(input);
            if (!other || other.tool === pa.tool) {
                const arg = pa.expect === 'url' ? (urlsOf(text + ' ' + quotedText)[0] || '')
                    : pa.expect === 'number' ? lastNumber(text)
                    : pa.expect === 'onoff' ? (/\b(off|disable)\b|ඕෆ්|අක්‍රීය/i.test(text) ? 'off' : /\b(on|enable)\b|ඔන්|සක්‍රීය/i.test(text) ? 'on' : '')
                    : pa.expect === 'target' ? lastNumber(text)
                    : text.slice(0, 80);
                if (arg || pa.expect === 'target') {
                    const r = buildRoute(pa.tool, arg, 'answer', { mentions: input.mentions, hasQuoted });
                    return execRoute(conn, mek, m, ctx, user, g, lang, r);
                }
            }
        }
    }

    // 5) does he want her to DO something?
    const r = route(input);
    if (r) return execRoute(conn, mek, m, ctx, user, g, lang, r);

    // 6) otherwise: just talk (AI + memory)
    return chat(conn, mek, m, ctx, store.getUser(phone), g, lang, named.text, { person, known: named.known });
}

async function introduce(conn, mek, ctx, user, g, lang, intro) {
    const v = makeVoice(conn, mek, ctx, user, g, lang);
    const ids = People.candidatesOf(intro.jid);
    const res = store.setPerson({
        ids, name: intro.name, relation: intro.relation, introducedBy: ctx.senderNumber,
        groupJid: ctx.isGroup ? ctx.from : '', groupName: ctx.isGroup ? (ctx.groupName || '') : '',
    });
    if (!res) return;
    for (const id of ids) { const u = store.getUser(id, false); if (u && !u.name) store.patchUser(id, { name: intro.name }); }   // he already talked to her: teach that profile too
    store.addMsg(ctx.senderNumber, 'gf', `[I will remember ${intro.name}${intro.relation ? ' (his ' + intro.relation + ')' : ''} for good]`, g.key);
    const renamed = !res.isNew && res.old.name && res.old.name !== intro.name;
    return v.tell(renamed ? 'introNew' : 'intro', { who: intro.name, old: res.old.name, relText: relText(res.person.relation, lang) });
}

async function tellWho(conn, mek, ctx, user, g, lang, target) {
    const v = makeVoice(conn, mek, ctx, user, g, lang);
    const d = People.candidatesOf(target)[0];
    const hit = d && lookupName(d);
    if (!hit) return v.tell('whoUnknown');
    return v.tell('whoKnown', { who: hit.name, relText: relText(hit.relation, lang) });
}

// ═══════════════════════════ the body listener ═══════════════════════════
function fresh(mek) {
    let t = mek.messageTimestamp;
    if (t && typeof t === 'object') t = typeof t.toNumber === 'function' ? t.toNumber() : (t.low ?? Number(t));
    t = Number(t);
    if (!t) return true;
    return Date.now() - t * 1000 < 3 * 60_000;                // never answer messages that sat in the offline queue
}

async function onBody(conn, mek, m, ctx) {
    try {
        if (!gfc().ENABLED) return;
        const text = String(ctx.body || '').trim();
        if (!text || ctx.isCmd || mek.key.fromMe) return;
        if (config.MODE === 'private' && !ctx.isOwner && !ctx.isSudo) return;
        const phone = ctx.senderNumber;
        if (!phone || !fresh(mek)) return;
        const id = mek.key.id;
        if (id) { if (seen.has(id)) return; seen.add(id); if (seen.size > 2000) seen.delete(seen.values().next().value); }

        const g = gfOf();                                        // (no profile is created for people who are not talking to her)
        // in a group the "yes" / the link she asked for does not repeat her name — an open question counts as addressing her
        const key = `${ctx.from}|${phone}`;
        const waiting = ((pendingConfirm.get(key) || {}).expires > Date.now()) || ((pendingAsk.get(key) || {}).expires > Date.now());
        let addressed = waiting || isAddressed(conn, m, ctx, g);
        if (!addressed && ctx.isGroup && isBoyfriend(ctx)) {          // her boyfriend introducing someone does not have to say her name first
            addressed = !!People.parseIntroduction(text, { mentions: m.mentioned || [], quotedSender: m.quoted && m.quoted.sender, exclude: [...botIdsOf(conn), ...speakerIds(ctx, mek)] });
        }
        if (!addressed) return;

        enqueue(phone, () => handle(conn, mek, m, ctx, text),
            () => { try { conn.sendMessage(ctx.from, { text: g.flood }, { quoted: mek }); } catch {} });
    } catch (e) { console.error('[GF] listener error:', e); }
}
cmd({ on: 'body', dontAddCommandList: true, filename: __filename }, onBody);

// ═══════════════════════════ typed commands ═══════════════════════════
const LOOKUP = new Map();
for (const g of Object.values(GIRLS)) {
    for (const n of [g.key, String(g.name).split(/\s+/)[0], ...(g.alias || [])]) LOOKUP.set(String(n).toLowerCase(), g);
}

async function switchTo(conn, mek, m, ctx, g, text = '') {
    const phone = ctx.senderNumber;
    store.patchUser(BOT_KEY, { gf: g.key });         // she is one girl for everybody; her boyfriend chooses who she is
    store.patchUser(phone, { gf: g.key });
    const user = store.getUser(phone);
    const lang = detectLang(text, user.lang);
    const v = makeVoice(conn, mek, ctx, user, g, lang);
    await v.tell('switched', { name: g.name });
    if (text) return enqueue(phone, () => handle(conn, mek, m, { ...ctx, body: text }, text));
    if (user.step !== 'done') return enqueue(phone, () => onboard(conn, mek, m, ctx, user, g, lang, ''));
    return enqueue(phone, () => chat(conn, mek, m, ctx, user, g, lang, ''));      // empty = she greets him
}

cmd({
    pattern: 'gf', alias: ['girlfriend', 'gfmode'], desc: 'Choose / manage your girlfriend  (/gf list · /gf <name> · /gf me · /gf forget)',
    category: 'ai', react: '💕', gfDirect: true, filename: __filename,
},
async (conn, mek, m, ctx) => {
    const { reply, senderNumber: phone } = ctx;
    const p = prefixOf();
    const user = store.getUser(phone);
    const g = gfOf();
    const boy = isBoyfriend(ctx);
    const arg = String(ctx.q || '').trim().toLowerCase();
    const sub = arg.split(/\s+/)[0];

    if (!arg || sub === 'help') {
        if (!boy) return reply(`💬 ${p}gf me — what I remember about you\n${p}gf forget — delete all of it`);
        return reply(`💕 *${g.name}* ${g.react}  ← your girlfriend now\n\n` +
            `${p}gf list — see all 13\n${p}gf <name> — switch (e.g. ${p}gf ${Object.keys(GIRLS)[0]})\n` +
            `${p}gf me — what she remembers about you\n${p}gf forget — delete what she remembers\n` +
            `${p}gf people — the people you introduced to her\n${p}gf tools — everything she can do\n\n` +
            `…or just talk to her. Ask her for things (playlist links, stickers, group stuff) in your own words 💬`);
    }
    if (sub === 'me') {
        const age = P.currentAge(user);
        const n = store.recent(phone).filter(e => e.role === 'user').length;
        return reply(`💬 *${g.name}* remembers:\n\n👤 Name: ${user.name || '—'}\n🔢 Age: ${age ?? '—'}\n🎂 Birthday: ${user.bdayMonth ? MONTH_EN[user.bdayMonth] + ' ' + user.bdayDay : '—'}\n` +
            `🧠 Your messages in the last ${gfc().MEMORY_HOURS || 24}h: ${n}\n\nTell her in chat to update anything ("my birthday is 14 May").`);
    }
    if (sub === 'forget') {
        if (/\byes\b|ඔව්/.test(arg)) { await store.forget(phone); store.removePerson(speakerIds(ctx, mek)); return reply(line('forgot', casualOf(g), user, 'en')); }
        return reply(line('forgetAsk', casualOf(g), user, 'en', { p }));
    }
    if (sub === 'reset') { store.patchUser(phone, { step: 'name', askedStep: '', tries: 0 }); return reply('Okay, she will ask you again 🙂 say hi!'); }
    // everything below changes WHO she is → only her boyfriend
    if (!boy) return reply(line('blocked', casualOf(g), user, 'en'));
    if (sub === 'list') {
        return reply('💕 *Choose your girlfriend*\n\n' +
            Object.values(GIRLS).map(x => `${x.react} *${x.key}* — ${x.desc || x.name}${x.key === g.key ? '  ✅' : ''}`).join('\n') +
            `\n\nExample: ${p}gf ${Object.keys(GIRLS)[1]}`);
    }
    if (sub === 'tools') {                                // everything she can do + why a plugin was left out (owner only)
        ensureTools();
        const d = registry.describe();
        const built = d.tools.filter(x => !x.auto).map(x => x.name).join(', ');
        const mine = d.tools.filter(x => x.auto);
        const left = d.skipped.filter(x => !/own commands|hidden|built-in tool already|watcher|opted out|another plugin/.test(x.reason));
        return reply(`🧩 *Things she can do*  (${d.tools.length})\n\n*built in:* ${built}\n\n` +
            (mine.length ? `*from your plugins:*\n${mine.map(x => `• ${x.name} — ${x.arg} — ${x.perm}${x.ai ? ' — the AI knows it' : ''}${x.source ? ' — ' + x.source : ''}`).join('\n')}\n\n` : `*from your plugins:* none yet (give a command a \`use:\` line)\n\n`) +
            (left.length ? `*left out:*\n${left.map(x => `• ${x.name} — ${x.reason}`).join('\n')}` : ''));
    }
    if (sub === 'people') {                               // the little memory of people you introduced (owner only)
        const rest = arg.split(/\s+/).slice(1);
        if (rest[0] === 'forget') {
            const t = People.pickTarget(m.mentioned || [], m.quoted && m.quoted.sender, botIdsOf(conn)) || rest[1] || '';
            const gone = t ? store.removePerson(People.candidatesOf(t)) : null;
            return reply(gone ? line('peopleGone', g, user, 'en', { who: gone.name }) : line('peopleMissing', g, user, 'en'));
        }
        const list = store.listPeople();
        if (!list.length) return reply(line('peopleNone', g, user, 'en'));
        return reply('👥 *People she knows*\n\n' + list.map(x => `• ${x.name}${x.relation ? ' — ' + x.relation : ''}${x.groupName ? ' (' + x.groupName + ')' : ''}  [${x.key}]`).join('\n') +
            `\n\n${p}gf people forget @tag   (or reply to them)`);
    }

    const target = LOOKUP.get(sub);
    if (!target) return reply(`I don't know "${sub}" 🥺  ${p}gf list`);
    return switchTo(conn, mek, m, ctx, target, arg.split(/\s+/).slice(1).join(' '));
});

// the 13 old commands still work as shortcuts (hidden from the menu): /taiga, /kurumi hi …
for (const g of Object.values(GIRLS)) {
    cmd({ pattern: g.key, alias: g.alias, desc: g.desc, category: 'ai', react: g.react, dontAddCommandList: true, gfDirect: true, filename: __filename },
        async (conn, mek, m, ctx) => (isBoyfriend(ctx)
            ? switchTo(conn, mek, m, ctx, g, String(ctx.q || '').trim())
            : ctx.reply(line('blocked', casualOf(gfOf()), store.getUser(ctx.senderNumber), 'en'))));
}

// ═══════════════════════════ hooks used by pair.js ═══════════════════════════
const brain = {
    /** GF-only mode: typed commands (other than group commands + /gf) are done BY HER for normal users */
    shouldRedirect(command, typed, { isOwner, isSudo, isAdmins }) {
        const c = gfc();
        if (!c.ENABLED || !c.ONLY_MODE || isOwner || isSudo) return false;
        if (command.gfDirect) return false;
        if (command.category === 'group') {
            // built-in group commands check admin rights themselves. A NEW plugin may have forgotten to: for those, somebody who is
            // not an admin is sent through her, where the rule derived from category "group" is applied (admins still run it directly)
            ensureTools();
            const meta = TOOLS[canon(command.pattern)];
            return !!(meta && meta.auto && meta.perm !== 'any' && !isAdmins);
        }
        const direct = c.DIRECT_COMMANDS || [];
        return !(direct.includes(command.pattern) || direct.includes(typed));
    },
    async viaGF(conn, mek, m, ctx, command, typed) {
        ensureTools();
        const phone = ctx.senderNumber;
        const tool = canon(command.pattern) || canon(typed);
        return enqueue(phone, async () => {
            const user = store.getUser(phone);
            const g = gfOf();
            const lang = detectLang(ctx.q || '', user.lang);
            const v = makeVoice(conn, mek, ctx, user, g, lang);
            if (user.step !== 'done') return onboard(conn, mek, m, ctx, user, g, lang, '');   // she must know him first
            if (!tool) return v.tell('blocked');
            const q = String(ctx.q || '');
            const meta = TOOLS[tool];
            const arg = meta.arg === 'url' ? (urlsOf(q + ' ' + quotedInfo(m).quotedText)[0] || '') : meta.arg === 'number' ? lastNumber(q) : q.trim();
            const { hasQuoted } = quotedInfo(m);
            return execRoute(conn, mek, m, ctx, user, g, lang, buildRoute(tool, arg, 'typed', { mentions: m.mentioned || [], hasQuoted }));
        });
    },
};
global.gfBrain = brain;

module.exports = { brain, _t: { queueBusy: (phone) => queues.has(phone), isBoyfriend, modeOf, BOT_KEY, speakerIds, botIdsOf, store, handle, onBody, onboard, buildCtx, isAddressed, enqueue, pendingAsk, pendingConfirm, gfOf, nameCallRe, fresh } };
