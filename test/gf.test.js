'use strict';
// Run:  node --test test/gf.test.js
process.env.GF_FAST = '1';      // no human typing delays
process.env.GF_NO_DB = '1';     // keep the store in memory (no MongoDB in tests)

const test = require('node:test');
const assert = require('node:assert/strict');
const https = require('https');
const { EventEmitter } = require('events');

const config = require('../config');
const events = require('../command');
const { sms } = require('../lib/msg');

// ───────────── scripted AI endpoint (replaces https://ai.dnuz.top) ─────────────
const LINES = ['හරි බබෝ 💕 ඔයා කොහොමද අද', 'අනේ මම දැන් තමයි ඉන්නේ 😘', 'හ්ම්ම් ඉතින් මොකද කරන්නේ 💕', 'ඒකනේ මටත් එහෙමයි 🥰', 'ඔයාට මතකයි නේද මම කිව්ව දේ 💞', 'ආහ් ඇත්තටම? කියන්නකෝ 😍'];
let lineNo = 0;
const varied = () => LINES[lineNo++ % LINES.length];
const ai = { prompts: [], script: varied, fail: false };
https.request = (options, cb) => {
    const req = new EventEmitter();
    req.setTimeout = () => {}; req.destroy = (e) => req.emit('error', e);
    req.end = () => {
        const prompt = new URL('https://x' + options.path).searchParams.get('q');
        ai.prompts.push(prompt);
        if (ai.fail) return setImmediate(() => req.emit('error', new Error('network down')));
        const res = new EventEmitter(); res.setEncoding = () => {}; res.statusCode = 200;
        setImmediate(() => { cb(res); res.emit('data', JSON.stringify({ result: ai.script(prompt) })); res.emit('end'); });
    };
    return req;
};

// ───────────── stub tools (the real ones need the network) ─────────────
const calls = [];
const stub = (pattern, alias = [], extra = {}) => events.cmd({ pattern, alias, category: extra.category || 'download', desc: pattern, filename: 'test' },
    async (conn, mek, m, ctx) => { calls.push({ pattern, q: ctx.q, args: ctx.args, ctx, m }); await conn.sendMessage(ctx.from, { text: `OUT:${pattern}:${ctx.q}` }); });

const _log = console.log; console.log = () => {};
require('../plugins/gf-brain');               // registers /gf, the 13 shortcuts, the body listener
console.log = _log;
stub('plinks', ['ytpl', 'playlistlinks']); stub('ytaudl'); stub('ig'); stub('sticker', ['s']); stub('posters', ['poster']);
stub('ping', [], { category: 'main' }); stub('menu2', ['menu'], { category: 'menu' });
stub('remove', [], { category: 'group' }); stub('promote', [], { category: 'group' }); stub('tagall', [], { category: 'group' });
stub('mute', ['lock'], { category: 'group' }); stub('hanimeimg'); stub('eval', [], { category: 'owner' });

const commandMap = new Map();
for (const c of events.commands) { if (c.pattern) commandMap.set(c.pattern, c); for (const a of c.alias || []) if (!commandMap.has(a)) commandMap.set(a, c); }
events.commandMap = commandMap;
const brain = global.gfBrain;
const { _t } = require('../plugins/gf-brain');
const store = _t.store;

// ───────────── fake WhatsApp ─────────────
function makeSock() {
    const sock = {
        sent: [], groupOps: [],
        user: { id: '94700000000:12@s.whatsapp.net', lid: '999888777:1@lid' },
        async sendMessage(jid, content, opts) { sock.sent.push({ jid, content, opts }); return { key: { id: 'BOT' + sock.sent.length, remoteJid: jid, fromMe: true } }; },
        async readMessages() {}, async sendPresenceUpdate() {},
        async groupParticipantsUpdate(jid, users, action) { sock.groupOps.push({ jid, users, action }); },
    };
    return sock;
}
const texts = (sock) => sock.sent.map(s => s.content.text).filter(Boolean);
let idc = 0;

/** mirrors the relevant part of pair.js: prefix parsing → command / GF redirect → on:'body' listeners */
async function deliver(sock, text, who = {}, extra = {}) {
    const o = { number: '94771110001', isGroup: false, isOwner: false, isSudo: false, isAdmins: false, isBotAdmins: false, ...who };
    const from = o.isGroup ? (o.chat || '120363@g.us') : `${o.number}@s.whatsapp.net`;
    const ci = {};
    if (extra.mentions) ci.mentionedJid = extra.mentions;
    if (extra.quoted) Object.assign(ci, { stanzaId: extra.quoted.id || 'Q1', participant: extra.quoted.sender, quotedMessage: extra.quoted.message });
    const mek = {
        key: { remoteJid: from, fromMe: false, id: 'M' + (++idc), participant: o.isGroup ? `${o.number}@s.whatsapp.net` : undefined, ...(extra.key || {}) },
        pushName: o.pushname || 'Kasun', messageTimestamp: Math.floor(Date.now() / 1000),
        message: Object.keys(ci).length ? { extendedTextMessage: { text, contextInfo: ci } } : { conversation: text },
    };
    const m = sms(sock, mek);
    const body = text;
    const prefixList = [config.PREFIX, ...(config.EXTRA_PREFIXES || [])];
    const usedPrefix = prefixList.find(pf => body.startsWith(pf)) || '';
    const rawCommand = usedPrefix ? body.slice(usedPrefix.length).trim().split(/\s+/).shift().toLowerCase() : '';
    const isCmd = !!usedPrefix && commandMap.has(rawCommand);
    const command = isCmd ? rawCommand : '';
    const args = isCmd ? body.trim().slice(usedPrefix.length).trim().split(/\s+/).slice(1) : body.trim().split(/\s+/).slice(1);
    const sender = mek.key.participant || from;
    const ctx = {
        from, prefix: usedPrefix || config.PREFIX, quoted: [], body, isCmd, command, args, q: args.join(' '),
        isGroup: o.isGroup, sender, senderNumber: o.number, botNumber: '94700000000', botNumber2: '94700000000@s.whatsapp.net',
        pushname: mek.pushName, isMe: false, isOwner: o.isOwner, isSudo: o.isSudo, groupMetadata: {}, groupName: 'G', participants: [],
        groupAdmins: [], isBotAdmins: o.isBotAdmins, isAdmins: o.isAdmins,
        reply: async (t, op) => sock.sendMessage(from, { text: t, mentions: (op && op.mentions) || [sender] }),
    };
    if (isCmd) {
        if ((config.OWNER_ONLY_COMMANDS || []).includes(command) && !o.isOwner) return;
        const cmd = commandMap.get(command);
        if (cmd) {
            if (brain.shouldRedirect(cmd, command, { isOwner: o.isOwner, isSudo: o.isSudo, isAdmins: o.isAdmins })) await brain.viaGF(sock, mek, m, ctx, cmd, command);
            else await cmd.function(sock, mek, m, ctx);
        }
    }
    for (const c of events.commands) if (body && c.on === 'body' && c.filename && /gf-brain/.test(c.filename)) await c.function(sock, mek, m, ctx);
    // the listener is non-blocking (queued per user) → wait until her queue is idle
    await new Promise(r => setTimeout(r, 15));
    for (let i = 0; i < 400 && _t.queueBusy(o.number); i++) await new Promise(r => setTimeout(r, 5));
    return { mek, m, ctx };
}

const PL = 'https://www.youtube.com/playlist?list=PLabc123XYZ';
const fresh = () => { store.users.clear(); store.msgs.clear(); store.people.clear(); store.peopleIndex.clear(); calls.length = 0; ai.prompts.length = 0; ai.script = varied; ai.fail = false; _t.pendingAsk.clear(); _t.pendingConfirm.clear(); store.now = Date.now; };
async function onboarded(sock, who = {}, { name = 'කසුන්', age = '22' } = {}) {
    await deliver(sock, 'hi', who);
    await deliver(sock, `මගේ නම ${name}`, who);
    await deliver(sock, age, who);
    await deliver(sock, 'මැයි 14', who);
}

// ═════════════════════════════ tests ═════════════════════════════
test('onboarding: she asks name → age → birthday first, and remembers them', async () => {
    fresh(); const sock = makeSock();
    await deliver(sock, 'hi');
    assert.equal(store.getUser('94771110001').step, 'name');
    assert.ok(texts(sock).length >= 1, 'asked for the name');
    await deliver(sock, 'මගේ නම කසුන්');
    assert.equal(store.getUser('94771110001').name, 'කසුන්');
    assert.equal(store.getUser('94771110001').step, 'age');
    await deliver(sock, 'මට අවුරුදු 22');
    assert.equal(store.getUser('94771110001').age, 22);
    await deliver(sock, 'මැයි 14');
    const u = store.getUser('94771110001');
    assert.deepEqual([u.step, u.bdayMonth, u.bdayDay], ['done', 5, 14]);
    assert.equal(ai.prompts.length, 0, 'no AI call is wasted during onboarding');
});

const BF = { isOwner: true };      // the owner is her boyfriend

test('onboarding: her boyfriend under 18 (or age unknown) gets friend mode, never romance', async () => {
    fresh(); const sock = makeSock();
    await onboarded(sock, BF, { name: 'Sam', age: '15' });
    assert.equal(store.getUser('94771110001').age, 15);
    await deliver(sock, 'hi baby, kohomada?', BF);
    const prompt = ai.prompts.at(-1);
    assert.match(prompt, /FRIEND MODE/);
    assert.match(prompt, /Friend: /, 'history labelled Friend, not Boyfriend');
    assert.ok(!/Boyfriend:/.test(prompt));

    fresh(); const sock2 = makeSock();                         // adult boyfriend → the full girlfriend
    await onboarded(sock2, BF, { name: 'Sam', age: '24' });
    await deliver(sock2, 'hi baby, kohomada?', BF);
    assert.ok(!/FRIEND MODE \(overrides/.test(ai.prompts.at(-1)));
    assert.ok(!/CASUAL|NOT your boyfriend/.test(ai.prompts.at(-1)));
    assert.match(ai.prompts.at(-1), /Boyfriend: /);
    assert.match(ai.prompts.at(-1), /MAXIMUM intensity/, 'the original girlfriend prompt');
});

test('onboarding: skipping the age leaves her boyfriend in friend mode', async () => {
    fresh(); const sock = makeSock();
    await deliver(sock, 'hi', BF); await deliver(sock, 'Nimal', BF); await deliver(sock, 'skip', BF); await deliver(sock, 'skip', BF);
    const u = store.getUser('94771110001');
    assert.equal(u.step, 'done'); assert.equal(u.age, null);
    await deliver(sock, 'kohomada', BF);
    assert.match(ai.prompts.at(-1), /FRIEND MODE/);
});

test('natural language → the real command runs and she answers in her voice', async () => {
    fresh(); const sock = makeSock(); await onboarded(sock); sock.sent.length = 0;
    await deliver(sock, `මට මේ playlist එකේ links ටික අරන් දෙන්න ${PL}`);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].pattern, 'plinks');
    assert.equal(calls[0].q, PL);
    const t = texts(sock);
    const out = t.findIndex(x => x.startsWith('OUT:plinks'));
    assert.ok(out > 0, 'she said something before the result');
    assert.ok(out < t.length - 1, 'and something after it');
    assert.equal(ai.prompts.length, 0, 'local router: no AI call needed');
});

test('natural language in English, url in the replied-to message', async () => {
    fresh(); const sock = makeSock(); await onboarded(sock); sock.sent.length = 0;
    await deliver(sock, 'get me the links of that playlist', {}, { quoted: { sender: '94771110001@s.whatsapp.net', message: { conversation: 'look ' + PL } } });
    assert.equal(calls[0].pattern, 'plinks'); assert.equal(calls[0].q, PL);
});

test('she asks for a missing link, then uses the next message', async () => {
    fresh(); const sock = makeSock(); await onboarded(sock); sock.sent.length = 0;
    await deliver(sock, 'playlist links ඕනේ');
    assert.equal(calls.length, 0);
    assert.ok(_t.pendingAsk.size === 1);
    await deliver(sock, PL);
    assert.equal(calls[0].pattern, 'plinks'); assert.equal(calls[0].q, PL);
});

test('typed /ytpl and .ytpl by a normal user are done BY HER (GF-only mode)', async () => {
    fresh(); const sock = makeSock(); await onboarded(sock); sock.sent.length = 0;
    await deliver(sock, `/ytpl ${PL}`);
    assert.equal(calls.length, 1); assert.equal(calls[0].pattern, 'plinks');
    assert.ok(texts(sock).length >= 3, 'with her lines around it');
    await deliver(sock, `.ytpl ${PL}`);
    assert.equal(calls.length, 2, 'the "." prefix works too');
});

test('a command that silently does nothing (or throws) is reported as failed, never as "here you go"', async () => {
    fresh(); const sock = makeSock(); await onboarded(sock);
    const ping = commandMap.get('ping'); const orig = ping.function;
    try {
        ping.function = async () => {};                                          // sends nothing
        await deliver(sock, 'ping');
        assert.match(store.recent('94771110001').filter(e => e.role === 'gf').at(-2).text, /I ran ping .*but it failed/);
        ping.function = async () => { throw new Error('boom'); };                // crashes
        const _e = console.error; console.error = () => {};
        await deliver(sock, 'ping'); console.error = _e;
        assert.match(store.recent('94771110001').filter(e => e.role === 'gf').at(-2).text, /but it failed/);
        ping.function = async (conn, mek, m, ctx) => { await ctx.reply('❌ *Could not fetch this playlist.*'); };   // the plugin reported its own error
        await deliver(sock, 'ping');
        assert.match(store.recent('94771110001').filter(e => e.role === 'gf').at(-2).text, /but it failed/);
        ping.function = orig;
        await deliver(sock, 'ping');
        const last = store.recent('94771110001').filter(e => e.role === 'gf' && e.text.startsWith('[I ran ping')).at(-1).text;
        assert.ok(!/failed/.test(last), 'a working command is not reported as failed');
    } finally { ping.function = orig; }
});

test('owner typing a command directly is NOT redirected', async () => {
    fresh(); const sock = makeSock(); sock.sent.length = 0;
    await deliver(sock, '/ping', { isOwner: true });
    assert.equal(calls.length, 1); assert.deepEqual(texts(sock), ['OUT:ping:']);
});

test('not onboarded yet: a typed command makes her ask her question instead', async () => {
    fresh(); const sock = makeSock();
    await deliver(sock, `/ytpl ${PL}`);
    assert.equal(calls.length, 0);
    assert.equal(store.getUser('94771110001').askedStep, 'name');
});

test('typed command that is not a tool (hanimeimg) is refused for normal users, allowed for the owner', async () => {
    fresh(); const sock = makeSock(); await onboarded(sock); sock.sent.length = 0;
    await deliver(sock, '/hanimeimg 1');
    assert.equal(calls.length, 0);
    await deliver(sock, '/hanimeimg 1', { isOwner: true });
    assert.equal(calls.length, 1);
});

test('group: admin asks her to kick someone → she confirms first, then does it', async () => {
    fresh(); const sock = makeSock(); const admin = { isGroup: true, isAdmins: true, isBotAdmins: true, isOwner: true };
    await onboarded(sock, { number: '94771110001', isGroup: false });          // they got to know each other in DM
    sock.sent.length = 0;
    await deliver(sock, 'chika kick him', admin, { mentions: ['94778889999@s.whatsapp.net'] });
    assert.equal(calls.length, 0, 'nothing happens before the confirmation');
    assert.equal(_t.pendingConfirm.size, 1);
    await deliver(sock, 'ඔව්', admin);
    assert.equal(calls.length, 1); assert.equal(calls[0].pattern, 'remove');
    assert.deepEqual(calls[0].m.mentioned, ['94778889999@s.whatsapp.net']);
});

test('group: "no" cancels, anything else cancels silently', async () => {
    fresh(); const sock = makeSock(); const admin = { isGroup: true, isAdmins: true, isBotAdmins: true, isOwner: true };
    await onboarded(sock); sock.sent.length = 0;
    await deliver(sock, 'chika kick him', admin, { mentions: ['94778889999@s.whatsapp.net'] });
    await deliver(sock, 'නෑ', admin);
    assert.equal(calls.length, 0); assert.equal(_t.pendingConfirm.size, 0);
});

test('group: a normal member can NOT make her kick / promote anybody', async () => {
    fresh(); const sock = makeSock(); const member = { isGroup: true, isAdmins: false, isBotAdmins: true, isOwner: false };
    await onboarded(sock); sock.sent.length = 0;
    await deliver(sock, 'chika kick him', member, { mentions: ['94778889999@s.whatsapp.net'] });
    await deliver(sock, 'ඔව්', member);
    await deliver(sock, 'chika make him admin', member, { mentions: ['94778889999@s.whatsapp.net'] });
    assert.equal(calls.length, 0);
    assert.ok(texts(sock).length >= 2, 'she told him no');
});

test('group: bot must be admin; admin-but-not-owner follows config.OWNER_ONLY_COMMANDS', async () => {
    fresh(); const sock = makeSock(); await onboarded(sock); sock.sent.length = 0;
    await deliver(sock, 'chika kick him', { isGroup: true, isAdmins: true, isBotAdmins: false, isOwner: false }, { mentions: ['9477@s.whatsapp.net'] });
    assert.equal(_t.pendingConfirm.size, 0, 'bot is not admin → refused before asking');
    await deliver(sock, 'chika promote him', { isGroup: true, isAdmins: true, isBotAdmins: true, isOwner: false }, { mentions: ['9477@s.whatsapp.net'] });
    assert.equal(_t.pendingConfirm.size, 0, 'promote is owner-only in config.js → refused');
    assert.equal(calls.length, 0);
});

test('group: harmless admin tool (tagall) runs without a confirmation', async () => {
    fresh(); const sock = makeSock(); await onboarded(sock); sock.sent.length = 0;
    await deliver(sock, 'chika tag everyone: meeting at 5', { isGroup: true, isAdmins: true, isBotAdmins: true });
    assert.equal(calls[0].pattern, 'tagall'); assert.equal(calls[0].q, 'meeting at 5');
});

test('group: chatter that is not aimed at her is ignored and no profile is created', async () => {
    fresh(); const sock = makeSock();
    await deliver(sock, 'ado mokada wenne machan', { isGroup: true, number: '94775550000' });
    assert.equal(sock.sent.length, 0); assert.equal(store.users.size, 0);
});

test('group: not onboarded → she asks him to DM her (once)', async () => {
    fresh(); const sock = makeSock();
    await deliver(sock, 'chika hi', { isGroup: true });
    await deliver(sock, 'chika hello?', { isGroup: true });
    assert.equal(texts(sock).length, 1);
    assert.equal(store.getUser('94771110001').step, 'name');
});

test('dangerous commands can never be started from conversation', async () => {
    const { checkPerm } = require('../lib/gf/exec');
    const ownerCtx = { isOwner: true, isSudo: true, isGroup: true, isAdmins: true, isBotAdmins: true };
    for (const t of ['eval', 'ev', 'exec', 'restart', 'update', 'boom', 'hanimeimg', 'nope']) assert.equal(checkPerm(t, ownerCtx, config), 'blocked', t);
    const { validateMarker } = require('../lib/gf/tools');
    assert.equal(validateMarker({ name: 'eval', arg: '1+1' }, { text: 'x' }), null);
    assert.equal(validateMarker({ name: 'remove', arg: '9477' }, { text: 'x' }), null, 'the AI may only trigger safe tools');
});

test('AI fallback: the model asks for a tool the router missed, url taken from HIS message only', async () => {
    fresh(); const sock = makeSock(); await onboarded(sock); sock.sent.length = 0;
    const ig = 'https://www.instagram.com/stories/someone/123/';
    ai.script = () => `@@ig ${ig}@@ හරි බබෝ බලන්නම් 💕`;
    await deliver(sock, `මේක බලලා දෙනවද ${ig}`);
    assert.equal(calls.length, 1); assert.equal(calls[0].pattern, 'ig'); assert.equal(calls[0].q, ig);
    assert.ok(!texts(sock).some(t => t.includes('@@')), 'the marker never reaches the chat');

    fresh(); const sock2 = makeSock(); await onboarded(sock2); sock2.sent.length = 0;
    ai.script = () => '@@ig https://evil.example/x@@ හරි බබෝ 💕';             // url that he never sent
    await deliver(sock2, 'something odd https://www.instagram.com/stories/x/9/');
    assert.equal(calls.length, 0);
});

test('24h memory: everything is stored, relevant old lines reach the AI, nothing older than 24h survives', async () => {
    fresh(); const sock = makeSock(); await onboarded(sock);
    let clock = Date.now(); store.now = () => clock;
    await deliver(sock, 'ලබන සතියේ මට chemistry exam එකක් තියෙනවා');
    clock += 6 * 3600e3; await deliver(sock, 'අද pizza කෑවා');
    clock += 3 * 3600e3; await deliver(sock, 'hi');
    clock += 1 * 3600e3; await deliver(sock, 'hi');
    clock += 1 * 3600e3; await deliver(sock, 'oyata chemistry exam eka gana mathakada?');
    assert.match(ai.prompts.at(-1), /chemistry exam/, 'the exam line from 11h ago was fed back to the AI');
    const mine = store.recent('94771110001').filter(e => e.role === 'user');
    assert.ok(mine.length >= 5, 'all messages are kept');
    clock += 25 * 3600e3;
    assert.equal(store.recent('94771110001').length, 0, 'after 24h the log is empty');
    assert.equal(store.getUser('94771110001').name, 'කසුන්', 'but the profile is forever');
});

test('profile is used in the prompt and can be updated by just saying it', async () => {
    fresh(); const sock = makeSock(); await onboarded(sock);
    await deliver(sock, 'mage birthday eka July 3');
    const u = store.getUser('94771110001');
    assert.deepEqual([u.bdayMonth, u.bdayDay], [7, 3]);
    await deliver(sock, 'kohomada');
    assert.match(ai.prompts.at(-1), /His name is කසුන්/);
    assert.match(ai.prompts.at(-1), /Birthday: Jul 3/);
});

test('/gf: her boyfriend can list, switch, see and delete his data', async () => {
    fresh(); const sock = makeSock(); await onboarded(sock, BF); sock.sent.length = 0;
    await deliver(sock, '/gf list', BF);
    const list = texts(sock).join('\n');
    for (const k of ['taiga', 'kurumi', 'yukino', 'chika', 'yor', 'mitsuri', 'akeno', 'albedo', 'ougi', 'shinobu', 'jibril', 'frieren', 'emilia']) assert.ok(list.includes(k), k);
    await deliver(sock, '/gf kurumi', BF);
    assert.equal(store.getUser(_t.BOT_KEY).gf, 'kurumi', 'she is one girl for the whole bot');
    await deliver(sock, '.taiga', BF);
    assert.equal(store.getUser(_t.BOT_KEY).gf, 'taiga', 'the old per-girl commands still work as shortcuts');
    sock.sent.length = 0;
    await deliver(sock, '/gf me', BF);
    assert.match(texts(sock).join('\n'), /කසුන්/);
    await deliver(sock, '/gf forget', BF);
    assert.ok(store.getUser('94771110001', false), 'asks first');
    await deliver(sock, '/gf forget yes', BF);
    assert.equal(store.getUser('94771110001', false), null);
    assert.equal(store.recent('94771110001').length, 0);
});

// ═════════════════════════════ her boyfriend vs everybody else ═════════════════════════════
test('everybody who is not her boyfriend gets a normal, polite person (casual prompt)', async () => {
    fresh(); const sock = makeSock(); await onboarded(sock);                       // adult, but NOT the owner
    await deliver(sock, 'hi baby, kohomada?');
    const prompt = ai.prompts.at(-1);
    assert.match(prompt, /NOT your boyfriend/);
    assert.match(prompt, /Person: /);
    assert.ok(!/Boyfriend: |Friend: /.test(prompt));
    assert.ok(!/MAXIMUM intensity|Play your archetype|TONE EXAMPLES|Pet names you may use|clingy/.test(prompt), 'no girlfriend instructions, moods or examples');
    assert.ok(!/Mood:/.test(prompt), 'no girlfriend mood tag');
    assert.match(prompt, /sincerely asks whether you are a real person or an AI/);
    assert.match(prompt, /His name is කසුන්/, 'she still remembers him');
    assert.ok(encodeURIComponent(prompt).length < 5000, 'much smaller than the girlfriend prompt → more room for memory');
});

test('her boyfriend: the owner. config.GF.BOYFRIEND_NUMBERS can add more', async () => {
    assert.equal(_t.isBoyfriend({ isOwner: true, senderNumber: '1' }), true);
    assert.equal(_t.isBoyfriend({ isOwner: false, isSudo: true, senderNumber: '1' }), false, 'sudo is not the boyfriend');
    config.GF.BOYFRIEND_NUMBERS = ['94775550000'];
    try { assert.equal(_t.isBoyfriend({ isOwner: false, senderNumber: '94775550000' }), true); }
    finally { config.GF.BOYFRIEND_NUMBERS = []; }
});

test('she is ONE girl: strangers meet the personality her boyfriend picked, and cannot change it', async () => {
    fresh(); const sock = makeSock(); const stranger = { number: '94772220002' };
    await onboarded(sock, BF);
    await deliver(sock, '/gf kurumi', BF);
    await onboarded(sock, stranger, { name: 'Nimal', age: '30' });
    await deliver(sock, 'kohomada', stranger);
    assert.match(ai.prompts.at(-1), /You are Kurumi/);
    sock.sent.length = 0;
    await deliver(sock, '/gf akeno', stranger);
    await deliver(sock, '.taiga', stranger);
    await deliver(sock, '/gf list', stranger);
    assert.equal(store.getUser(_t.BOT_KEY).gf, 'kurumi', 'unchanged');
    assert.ok(texts(sock).length >= 3, 'she politely refused');
    assert.ok(!texts(sock).join('\n').includes('Choose your girlfriend'));
    await deliver(sock, '/gf me', stranger);
    assert.match(texts(sock).join('\n'), /Nimal/, 'but /gf me works for everyone');
});

test('strangers hear plain polite lines (🙂), not girlfriend lines', async () => {
    fresh(); const sock = makeSock();
    await onboarded(sock, BF); await deliver(sock, '/gf kurumi', BF);        // the darkest persona
    sock.sent.length = 0;
    await deliver(sock, 'hi', { number: '94772220002' });
    const first = texts(sock).join(' ');
    assert.match(first, /🙂/);
    assert.ok(!/🔪|👁|💕|ufufu/.test(first), first);
    sock.sent.length = 0;
    await deliver(sock, 'Nimal', { number: '94772220002' }); await deliver(sock, '30', { number: '94772220002' }); await deliver(sock, 'මැයි 14', { number: '94772220002' });
    const rest = texts(sock).join(' ');
    assert.ok(!/\/gf list|ඔයා මගේ|my darling/.test(rest), 'no "switch my personality" hint, no romance');
    assert.equal(store.getUser('94772220002').step, 'done');
});

test('stranger + tool: she helps like a normal person', async () => {
    fresh(); const sock = makeSock(); const stranger = { number: '94772220002' };
    await onboarded(sock, stranger, { name: 'Nimal', age: '30' }); sock.sent.length = 0;
    await deliver(sock, `get me the links of this playlist ${PL}`, stranger);
    assert.equal(calls[0].pattern, 'plinks');
    const t = texts(sock);
    assert.ok(t.length >= 3); assert.ok(t.some(x => /🙂/.test(x)), 'her lines are in the casual voice');
});

test('a stranger who sincerely asks gets an honest answer about being an AI; her boyfriend keeps the story', async () => {
    fresh(); const sock = makeSock(); const stranger = { number: '94772220002' };
    await onboarded(sock, stranger, { name: 'Nimal', age: '30' });
    ai.script = () => 'Honestly, I am an AI, but I am happy to chat with you 🙂';
    sock.sent.length = 0;
    await deliver(sock, 'are you a real person or an AI?', stranger);
    assert.ok(texts(sock).join(' ').includes('I am an AI'), 'delivered, not replaced by an excuse');

    config.GF.STRANGERS_ADMIT_AI = false;                                   // owner can switch that off
    try {
        sock.sent.length = 0; ai.prompts.length = 0;
        await deliver(sock, 'are you a real person or an AI?', stranger);
        assert.match(ai.prompts.at(-1), /Never say or hint you are a bot/);
        assert.ok(!texts(sock).join(' ').includes('I am an AI'), 'the old never-admit rule is back');
    } finally { config.GF.STRANGERS_ADMIT_AI = true; }

    fresh(); const sock2 = makeSock();                                      // her boyfriend: unchanged original behaviour
    await onboarded(sock2, BF);
    ai.script = () => 'Honestly, I am an AI, but I am happy to chat with you 🙂';
    sock2.sent.length = 0;
    await deliver(sock2, 'are you a real person or an AI?', BF);
    assert.ok(!texts(sock2).join(' ').includes('I am an AI'), 'girlfriend persona never breaks character');
});

test('when the AI is down a stranger gets a neutral excuse, not a girlfriend one', async () => {
    fresh(); const sock = makeSock(); await onboarded(sock, BF); await deliver(sock, '/gf kurumi', BF);
    await onboarded(sock, { number: '94772220002' }, { name: 'Nimal', age: '30' });
    ai.fail = true; sock.sent.length = 0;
    const _e = console.error; console.error = () => {};
    await deliver(sock, 'kohomada', { number: '94772220002' });
    console.error = _e; ai.fail = false;
    const said = texts(sock).join(' ');
    assert.match(said, /🙂/); assert.ok(!/🔪|ආදරෙයි|රත්තරං|💕/.test(said), said);
});

test('config.GF.ASK_STRANGERS = false → only her boyfriend is interviewed', async () => {
    fresh(); const sock = makeSock();
    config.GF.ASK_STRANGERS = false;
    try {
        await deliver(sock, 'hi', { number: '94772220002', pushname: 'Nimal' });
        assert.equal(store.getUser('94772220002').step, 'done');
        assert.ok(ai.prompts.length >= 1, 'went straight to chatting (no interview)');
        await deliver(sock, 'hi', BF);
        assert.equal(store.getUser('94771110001').step, 'name', 'her boyfriend is still asked');
    } finally { config.GF.ASK_STRANGERS = true; }
});

test('a stranger in a group is also a normal person (and gets no birthday wish)', async () => {
    fresh(); const sock = makeSock(); const stranger = { number: '94772220002' };
    await onboarded(sock, stranger, { name: 'Nimal', age: '30' });
    const today = new Date(Date.now() + 5.5 * 3600e3);
    store.patchUser('94772220002', { bdayMonth: today.getUTCMonth() + 1, bdayDay: today.getUTCDate() });
    await deliver(sock, 'chika hello', { ...stranger, isGroup: true });
    assert.match(ai.prompts.at(-1), /NOT your boyfriend/);
    assert.ok(!/BIRTHDAY/.test(ai.prompts.at(-1)));
    await onboarded(sock, BF);
    store.patchUser('94771110001', { bdayMonth: today.getUTCMonth() + 1, bdayDay: today.getUTCDate() });
    await deliver(sock, 'hello', BF);
    assert.match(ai.prompts.at(-1), /TODAY IS HIS BIRTHDAY/, 'her boyfriend does get the birthday wish');
});

test('a persona that is addressed by name in a group answers; the other 12 do not steal the message', async () => {
    fresh(); const sock = makeSock(); await onboarded(sock);
    store.patchUser('94771110001', { gf: 'kurumi' });
    assert.ok(_t.isAddressed({ user: sock.user }, {}, { isGroup: true, body: 'kurumi, hi' }, require('../plugins/girlfriends').GIRLS.kurumi));
    assert.ok(!_t.isAddressed({ user: sock.user }, {}, { isGroup: true, body: 'taiga, hi' }, require('../plugins/girlfriends').GIRLS.kurumi));
    assert.ok(_t.isAddressed({ user: sock.user }, { mentioned: ['999888777@lid'] }, { isGroup: true, body: 'hey' }, require('../plugins/girlfriends').GIRLS.kurumi), '@mention (lid)');
});

test('stale (offline-queue) messages are ignored', async () => {
    assert.equal(_t.fresh({ messageTimestamp: Math.floor(Date.now() / 1000) - 3600 }), false);
    assert.equal(_t.fresh({ messageTimestamp: Math.floor(Date.now() / 1000) }), true);
});

// ═════════════════════════════ fixes to the original bot ═════════════════════════════
test('FIX lib/msg.js: m.mentioned exists, mention list is not mutated, quoted without participant does not crash', () => {
    const sock = makeSock();
    const mek = { key: { remoteJid: 'g@g.us', id: 'A', participant: '1@s.whatsapp.net' }, message: { extendedTextMessage: { text: 'x', contextInfo: { mentionedJid: ['2@s.whatsapp.net'], participant: '3@s.whatsapp.net', stanzaId: 'S', quotedMessage: { conversation: 'old' } } } } };
    const m = sms(sock, mek);
    assert.deepEqual(m.mentioned, ['2@s.whatsapp.net']);
    assert.deepEqual(m.mentionUser, ['2@s.whatsapp.net', '3@s.whatsapp.net']);
    assert.deepEqual(mek.message.extendedTextMessage.contextInfo.mentionedJid, ['2@s.whatsapp.net'], 'original not mutated');
    const bad = { key: { remoteJid: 'a@s.whatsapp.net', id: 'B' }, message: { extendedTextMessage: { text: 'x', contextInfo: { stanzaId: 'S', quotedMessage: { conversation: 'old' } } } } };
    assert.doesNotThrow(() => sms(sock, bad));
});

test('FIX getGroupAdmins only returns real admins', () => {
    const { getGroupAdmins } = require('../lib/functions');
    const list = getGroupAdmins([{ id: 'a@s', admin: 'admin' }, { id: 'b@s' }, { id: 'c@s', admin: null }, { id: 'd@s', admin: 'superadmin', jid: 'dd@s' }]);
    assert.deepEqual(list, ['a@s', 'd@s', 'dd@s']);
});

test('FIX ACD_GROUP promote/remove/getpic work (they crashed on m.mentioned / getProfilePicture)', async () => {
    const _l = console.log; console.log = () => {};
    require('../plugins/ACD_GROUP'); console.log = _l;
    const find = (p) => events.commands.filter(c => c.pattern === p).pop();
    const sock = makeSock(); const replies = [];
    sock.profilePictureUrl = async () => 'https://pic.example/g.jpg';
    const ctx = { from: 'g@g.us', isGroup: true, isBotAdmins: true, isAdmins: true, q: '', reply: async (t) => replies.push(t) };
    const target = '94778889999@s.whatsapp.net';
    await find('promote').function(sock, {}, { mentioned: [target] }, ctx);
    await find('remove').function(sock, {}, { mentioned: [], quoted: { sender: target } }, ctx);
    await find('demote').function(sock, {}, { mentioned: [target] }, ctx);
    assert.deepEqual(sock.groupOps.map(o => o.action), ['promote', 'remove', 'demote']);
    await find('add').function(sock, {}, {}, { ...ctx, q: '0771234567' });
    assert.equal(sock.groupOps.at(-1).users[0], '94771234567@s.whatsapp.net');
    await find('getpic').function(sock, {}, {}, ctx);
    assert.equal(sock.sent.at(-1).content.image.url, 'https://pic.example/g.jpg');
    assert.ok(!replies.some(r => /Cannot read properties/.test(r)));
});

test('FIX welcome / goodbye messages are really stored and sent', async () => {
    const gg = require('../lib/group-greet'); gg._reset();
    const fs = require('fs'), path = require('path');
    const file = path.join(__dirname, '..', 'data', 'group-greet.json'); const had = fs.existsSync(file) && fs.readFileSync(file);
    try {
        gg.set('g1@g.us', 'welcome', 'Welcome @user to {group}!');
        const sock = makeSock(); sock.groupMetadata = async () => ({ subject: 'Cool Group', participants: [1, 2] });
        await gg.onParticipantsUpdate(sock, { id: 'g1@g.us', action: 'add', participants: ['94771112222@s.whatsapp.net'] });
        assert.equal(sock.sent[0].content.text, 'Welcome @94771112222 to Cool Group!');
        await gg.onParticipantsUpdate(sock, { id: 'g1@g.us', action: 'remove', participants: ['94771112222@s.whatsapp.net'] });
        assert.equal(sock.sent.length, 1, 'no goodbye text was set');
    } finally { if (had) fs.writeFileSync(file, had); else if (fs.existsSync(file)) fs.unlinkSync(file); gg._reset(); }
});

// ═════════════════════════════ people she knows ═════════════════════════════
const OWNER_NO = '94760036688', NIMAL_NO = '94771234567', NIMAL_JID = `${NIMAL_NO}@s.whatsapp.net`;
const OWN = { number: OWNER_NO, isOwner: true };
const OWN_GROUP = { ...OWN, isGroup: true, isAdmins: true, isBotAdmins: true };

test('people: her boyfriend tags someone in a group → a permanent memory by their id', async () => {
    fresh(); const sock = makeSock(); await onboarded(sock, OWN); sock.sent.length = 0;
    await deliver(sock, `chika this is my friend Nimal @${NIMAL_NO}`, OWN_GROUP, { mentions: [NIMAL_JID] });
    const p = store.findPerson([NIMAL_NO]);
    assert.ok(p, 'remembered'); assert.deepEqual([p.name, p.relation, p.introducedBy, p.groupJid], ['Nimal', 'friend', OWNER_NO, '120363@g.us']);
    assert.ok(texts(sock).join(' ').includes('Nimal'), 'she says she will remember');
    assert.equal(ai.prompts.length, 0, 'no AI call needed');
});

test('people: he does not have to say her name in a group (only the introduction itself is picked up)', async () => {
    fresh(); const sock = makeSock(); await onboarded(sock, OWN); sock.sent.length = 0;
    await deliver(sock, `@${NIMAL_NO} මෙයාගේ නම නිමල්`, OWN_GROUP, { mentions: [NIMAL_JID] });
    assert.equal(store.findPerson([NIMAL_NO]).name, 'නිමල්');
    const before = sock.sent.length;
    await deliver(sock, 'ado mokada wenne machan', OWN_GROUP);                 // ordinary chatter from him is still ignored
    assert.equal(sock.sent.length, before);
});

test('people: by replying to the person\'s own message', async () => {
    fresh(); const sock = makeSock(); await onboarded(sock, OWN); sock.sent.length = 0;
    await deliver(sock, 'chika මෙයාගේ නම කසුන්', OWN_GROUP, { quoted: { sender: NIMAL_JID, message: { conversation: 'hello all' } } });
    assert.equal(store.findPerson([NIMAL_NO]).name, 'කසුන්');
});

test('people: when that person later writes to her, she already knows his name (and does not ask it again)', async () => {
    fresh(); const sock = makeSock(); await onboarded(sock, OWN);
    await deliver(sock, `chika this is my friend Nimal @${NIMAL_NO}`, OWN_GROUP, { mentions: [NIMAL_JID] });
    sock.sent.length = 0; ai.prompts.length = 0;
    await deliver(sock, 'hi', { number: NIMAL_NO });
    const u = store.getUser(NIMAL_NO);
    assert.deepEqual([u.name, u.step, u.askedStep], ['Nimal', 'age', 'age'], 'name step skipped, straight to the age');
    const said = texts(sock).join(' ');
    assert.ok(said.includes('Nimal') && /🙂/.test(said), said);
    assert.equal(ai.prompts.length, 0);
    await deliver(sock, '30', { number: NIMAL_NO }); await deliver(sock, 'මැයි 14', { number: NIMAL_NO });
    assert.equal(store.getUser(NIMAL_NO).step, 'done');
});

test('people: in a group he can chat at once (no "DM me first"), and the AI is told who introduced him', async () => {
    fresh(); const sock = makeSock(); await onboarded(sock, OWN);
    await deliver(sock, `chika this is my cousin Nimal @${NIMAL_NO}`, OWN_GROUP, { mentions: [NIMAL_JID] });
    ai.prompts.length = 0; sock.sent.length = 0;
    await deliver(sock, 'chika hello', { number: NIMAL_NO, isGroup: true });
    assert.equal(store.getUser(NIMAL_NO).step, 'name', 'the interview itself waits for a DM');
    assert.equal(ai.prompts.length >= 1, true, 'she answered instead of sending him away');
    const prompt = ai.prompts.at(-1);
    assert.match(prompt, /His name is Nimal/); assert.match(prompt, /introduced him to you as his cousin/);
    assert.match(prompt, /NOT your boyfriend/, 'still a normal acquaintance, just a warmer one');
});

test('people: @numbers she knows become names for the AI', async () => {
    fresh(); const sock = makeSock(); await onboarded(sock, OWN);
    await deliver(sock, `chika this is my friend Nimal @${NIMAL_NO}`, OWN_GROUP, { mentions: [NIMAL_JID] });
    ai.prompts.length = 0;
    await deliver(sock, `chika say hi to @${NIMAL_NO} from me`, OWN_GROUP, { mentions: [NIMAL_JID] });
    const prompt = ai.prompts.at(-1);
    assert.match(prompt, /@Nimal/); assert.ok(!prompt.includes(`@${NIMAL_NO}`), 'raw number replaced');
    assert.match(prompt, /People he mentioned: @Nimal \(your boyfriend's friend\)/);
});

test('people: only her boyfriend can introduce people', async () => {
    fresh(); const sock = makeSock(); const stranger = { number: '94772220002' };
    await onboarded(sock, stranger, { name: 'Sam', age: '30' });
    await deliver(sock, `chika this is my friend Nimal @${NIMAL_NO}`, { ...stranger, isGroup: true }, { mentions: [NIMAL_JID] });
    assert.equal(store.people.size, 0);
    await deliver(sock, `@${NIMAL_NO} මෙයාගේ නම නිමල්`, { ...stranger, isGroup: true }, { mentions: [NIMAL_JID] });   // not even addressed
    assert.equal(store.people.size, 0);
});

test('people: he can ask who somebody is; rename; /gf people list + forget', async () => {
    fresh(); const sock = makeSock(); await onboarded(sock, OWN);
    sock.sent.length = 0;
    await deliver(sock, 'chika who is this?', OWN_GROUP, { mentions: [NIMAL_JID] });
    assert.ok(texts(sock).length >= 1, 'she says she does not know yet'); assert.equal(store.people.size, 0);
    await deliver(sock, `chika this is my friend Nimal @${NIMAL_NO}`, OWN_GROUP, { mentions: [NIMAL_JID] });
    sock.sent.length = 0;
    await deliver(sock, 'chika who is this?', OWN_GROUP, { mentions: [NIMAL_JID] });
    assert.ok(texts(sock).join(' ').includes('Nimal'), texts(sock).join(' '));
    sock.sent.length = 0;
    await deliver(sock, `chika actually his name is Nimali @${NIMAL_NO}`, OWN_GROUP, { mentions: [NIMAL_JID] });
    assert.equal(store.findPerson([NIMAL_NO]).name, 'Nimali'); assert.equal(store.findPerson([NIMAL_NO]).relation, 'friend');
    sock.sent.length = 0;
    await deliver(sock, '/gf people', OWN);
    assert.match(texts(sock).join('\n'), /Nimali — friend/);
    await deliver(sock, '/gf people', { number: '94772220002' });
    assert.ok(!texts(sock).join('\n').includes('People she knows') || texts(sock).filter(t => t.includes('People she knows')).length === 1, 'a stranger does not get the list');
    await deliver(sock, `/gf people forget ${NIMAL_NO}`, OWN);
    assert.equal(store.people.size, 0);
});

test('people: the same person under a phone id and a @lid id is one person', async () => {
    fresh(); const sock = makeSock(); await onboarded(sock, OWN);
    await deliver(sock, `chika this is Nimal @${NIMAL_NO}`, OWN_GROUP, { mentions: [NIMAL_JID] });
    await deliver(sock, 'hi', { number: '5551234' }, { key: { senderPn: NIMAL_JID } });             // he shows up as a @lid but WhatsApp tells us his number
    assert.equal(store.getUser('5551234').name, 'Nimal');
    assert.ok(store.findPerson(['5551234']), 'the lid is remembered as another id of the same person');
    assert.equal(store.people.size, 1);
    store.users.delete('5551234');
    await deliver(sock, 'hi again', { number: '5551234' });                                          // later without any hint: found through the alias
    assert.equal(store.getUser('5551234').name, 'Nimal');
});

test('people: /gf forget yes by that person also deletes what her boyfriend told her about him', async () => {
    fresh(); const sock = makeSock(); await onboarded(sock, OWN);
    await deliver(sock, `chika this is Nimal @${NIMAL_NO}`, OWN_GROUP, { mentions: [NIMAL_JID] });
    await deliver(sock, 'hi', { number: NIMAL_NO });
    await deliver(sock, '/gf forget yes', { number: NIMAL_NO });
    assert.equal(store.findPerson([NIMAL_NO]), null); assert.equal(store.getUser(NIMAL_NO, false), null);
});

test('people: saved through the database adapter', async () => {
    fresh(); const sock = makeSock(); await onboarded(sock, OWN);
    const saved = []; store.adapter = { saveUser() {}, saveMsg() {}, deleteUser() {}, savePerson: async (p) => saved.push(p.name), deletePerson: async () => {} };
    try {
        await deliver(sock, `chika this is Nimal @${NIMAL_NO}`, OWN_GROUP, { mentions: [NIMAL_JID] });
        await store.flush();
        assert.deepEqual(saved, ['Nimal']);
    } finally { store.adapter = null; }
});
