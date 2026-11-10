'use strict';
// Run:  node --test test/autotools.test.js
// A NEW plugin (only cmd({ pattern, use, desc, category })) must become something she can do — with no edit in lib/gf/*.
process.env.GF_FAST = '1';
process.env.GF_NO_DB = '1';

const test = require('node:test');
const assert = require('node:assert/strict');
const https = require('https');
const { EventEmitter } = require('events');

const config = require('../config');
const events = require('../command');
const { sms } = require('../lib/msg');

// ───────────── scripted AI
const ai = { prompts: [], n: 0 };
const LINES = ['හරි බබෝ 💕 ඔයා කොහොමද අද', 'අනේ මම දැන් තමයි ඉන්නේ 😘', 'හ්ම්ම් ඉතින් මොකද කරන්නේ 💕', 'ඒකනේ මටත් එහෙමයි 🥰', 'ආහ් ඇත්තටම? කියන්නකෝ 😍'];
https.request = (options, cb) => {
    const req = new EventEmitter(); req.setTimeout = () => {}; req.destroy = (e) => req.emit('error', e);
    req.end = () => {
        ai.prompts.push(new URL('https://x' + options.path).searchParams.get('q'));
        const res = new EventEmitter(); res.setEncoding = () => {}; res.statusCode = 200;
        setImmediate(() => { cb(res); res.emit('data', JSON.stringify({ result: LINES[ai.n++ % LINES.length] })); res.emit('end'); });
    };
    return req;
};

const _log = console.log; console.log = () => {};
require('../plugins/gf-brain');
console.log = _log;
const { _t } = require('../plugins/gf-brain');
const registry = require('../lib/gf/registry');
const tools = require('../lib/gf/tools');
const store = _t.store;

// ───────────── the NEW plugins: nothing but cmd({...}) — exactly what a user would write
const calls = [];
const plugin = (info, fn) => events.cmd({ filename: '/plugins/demo.js', category: 'misc', ...info },
    fn || (async (conn, mek, m, ctx) => { calls.push({ pattern: info.pattern, q: ctx.q, ctx, m }); await conn.sendMessage(ctx.from, { text: `OUT:${info.pattern}:${ctx.q}` }); }));

plugin({ pattern: 'weather', alias: ['wx', 'klimate'], desc: 'Weather forecast of a city', use: '.weather <city>', category: 'tools' });
plugin({ pattern: 'shorten', desc: 'Shorten a link', use: '.shorten <url>', category: 'tools' });
plugin({ pattern: 'joke', desc: 'Tell a joke', use: '.joke', category: 'fun', gf: { keywords: ['tell me a joke', 'joke ekak', 'විහිළුවක්'] } });
plugin({ pattern: 'ownerreport', desc: 'Private report', use: '.ownerreport', category: 'owner' });
plugin({ pattern: 'warnuser', desc: 'Warn a member', use: '.warnuser @user', category: 'group' });
plugin({ pattern: 'antiswear', desc: 'Delete swearing', use: '.antiswear on/off', category: 'group' });
plugin({ pattern: 'fwdpost', desc: 'Forward a channel post', use: '.fwdpost <post link> <count> <seconds>', category: 'tools' });
plugin({ pattern: 'lyrics', desc: 'Song lyrics', use: '.lyrics <song>', gf: { ask: { si: 'ගීතයේ නම මොකක්ද?', en: 'Which song?' }, hint: 'song lyrics' } });
plugin({ pattern: 'shout', desc: 'Shout a text', use: '.shout <text>', gf: { extract: (t) => t.toUpperCase().trim() } });
// …and the ones that must NOT be exposed by themselves
plugin({ pattern: 'broadcastmsg', desc: 'Send to everybody', use: '.broadcastmsg <text>' });             // dangerous name
plugin({ pattern: 'sendtoall', desc: 'Announce to every group', use: '.sendtoall <text>' });                // mass-messaging by another name
plugin({ pattern: 'oldcmd', desc: 'An old command without any usage line' });                              // nothing declared
plugin({ pattern: 'secretcmd', desc: 'Hidden', use: '.secretcmd', dontAddCommandList: true });
plugin({ pattern: 'optout', desc: 'Not for her', use: '.optout', gf: false });
plugin({ pattern: 'blockedx', desc: 'Blocked by config', use: '.blockedx' });
plugin({ pattern: 'faketest2', desc: 'Looks like impersonation', use: '.faketest2' });
// …and one dangerous name that its author exposes ON PURPOSE
plugin({ pattern: 'broadcastok', desc: 'Announcement to my own group', use: '.broadcastok <text>', gf: { perm: 'owner', confirm: true } });
config.GF.NL_BLOCKED.push('blockedx');

const commandMap = new Map();
for (const c of events.commands) { if (c.pattern) commandMap.set(c.pattern, c); for (const a of c.alias || []) if (!commandMap.has(a)) commandMap.set(a, c); }
events.commandMap = commandMap;
const brain = global.gfBrain;

// ───────────── fake WhatsApp (same idea as test/gf.test.js)
function makeSock() {
    const sock = {
        sent: [], groupOps: [], user: { id: '94700000000:12@s.whatsapp.net', lid: '999888777:1@lid' },
        async sendMessage(jid, content, opts) { sock.sent.push({ jid, content, opts }); return { key: { id: 'BOT' + sock.sent.length } }; },
        async readMessages() {}, async sendPresenceUpdate() {}, async groupParticipantsUpdate(j, u, a) { sock.groupOps.push({ j, u, a }); },
    };
    return sock;
}
const texts = (sock) => sock.sent.map(s => s.content.text).filter(Boolean);
let idc = 0;
async function deliver(sock, text, who = {}, extra = {}) {
    const o = { number: '94771110001', isGroup: false, isOwner: false, isSudo: false, isAdmins: false, isBotAdmins: false, ...who };
    const from = o.isGroup ? '120363@g.us' : `${o.number}@s.whatsapp.net`;
    const ci = {}; if (extra.mentions) ci.mentionedJid = extra.mentions;
    const mek = { key: { remoteJid: from, fromMe: false, id: 'A' + (++idc), participant: o.isGroup ? `${o.number}@s.whatsapp.net` : undefined }, pushName: 'Kasun',
        messageTimestamp: Math.floor(Date.now() / 1000), message: Object.keys(ci).length ? { extendedTextMessage: { text, contextInfo: ci } } : { conversation: text } };
    const m = sms(sock, mek);
    const usedPrefix = [config.PREFIX, ...(config.EXTRA_PREFIXES || [])].find(pf => text.startsWith(pf)) || '';
    const raw = usedPrefix ? text.slice(usedPrefix.length).trim().split(/\s+/).shift().toLowerCase() : '';
    const isCmd = !!usedPrefix && commandMap.has(raw);
    const args = isCmd ? text.trim().slice(usedPrefix.length).trim().split(/\s+/).slice(1) : text.trim().split(/\s+/).slice(1);
    const sender = mek.key.participant || from;
    const ctx = { from, prefix: usedPrefix || config.PREFIX, quoted: [], body: text, isCmd, command: isCmd ? raw : '', args, q: args.join(' '), isGroup: o.isGroup, sender, senderNumber: o.number,
        botNumber: '94700000000', pushname: 'Kasun', isMe: false, isOwner: o.isOwner, isSudo: o.isSudo, groupMetadata: {}, groupName: 'G', participants: [], groupAdmins: [],
        isBotAdmins: o.isBotAdmins, isAdmins: o.isAdmins, reply: async (t, op) => sock.sendMessage(from, { text: t, mentions: (op && op.mentions) || [sender] }) };
    if (isCmd) {
        if ((config.OWNER_ONLY_COMMANDS || []).includes(ctx.command) && !o.isOwner) return;
        const cmd = commandMap.get(ctx.command);
        if (brain.shouldRedirect(cmd, ctx.command, { isOwner: o.isOwner, isSudo: o.isSudo, isAdmins: o.isAdmins })) await brain.viaGF(sock, mek, m, ctx, cmd, ctx.command);
        else await cmd.function(sock, mek, m, ctx);
    }
    for (const c of events.commands) if (text && c.on === 'body' && /gf-brain/.test(c.filename || '')) await c.function(sock, mek, m, ctx);
    await new Promise(r => setTimeout(r, 15));
    for (let i = 0; i < 400 && _t.queueBusy(o.number); i++) await new Promise(r => setTimeout(r, 5));
}
const fresh = () => { store.users.clear(); store.msgs.clear(); store.people.clear(); store.peopleIndex.clear(); calls.length = 0; ai.prompts.length = 0; _t.pendingAsk.clear(); _t.pendingConfirm.clear(); };
const OWN = { number: '94760036688', isOwner: true };
async function onboarded(sock, who = {}) { await deliver(sock, 'hi', who); await deliver(sock, 'මගේ නම කසුන්', who); await deliver(sock, '25', who); await deliver(sock, 'මැයි 14', who); }

// ═════════════════════════════ what she derives from the cmd({}) ═════════════════════════════
test('registry: every new plugin with a use: line (or gf: block) became a tool, nothing else', () => {
    const r = registry.sync(events.commands, config, { log() {} });
    for (const name of ['weather', 'shorten', 'joke', 'ownerreport', 'warnuser', 'antiswear', 'fwdpost', 'lyrics', 'shout', 'broadcastok']) assert.ok(r.added.includes(name), name + ' should be exposed');
    const why = Object.fromEntries(r.skipped.map(x => [x.name, x.reason]));
    assert.match(why.broadcastmsg, /dangerous/); assert.match(why.sendtoall, /dangerous/);
    assert.match(why.oldcmd, /no `use:` line/);
    assert.match(why.secretcmd, /hidden/);
    assert.match(why.optout, /opted out/);
    assert.match(why.blockedx, /NL_BLOCKED/);
    assert.match(why.faketest2, /dangerous/, '"fake…" names need an explicit gf:');
    for (const name of ['broadcastmsg', 'oldcmd', 'secretcmd', 'optout', 'blockedx', 'faketest2']) assert.equal(tools.TOOLS[name], undefined, name + ' must stay manual');
});

test('registry: the built-in tools are never replaced or changed', () => {
    for (const name of ['plinks', 'ytaudl', 'ig', 'remove', 'promote', 'ping']) assert.ok(tools.TOOLS[name] && !tools.TOOLS[name].auto, name);
    assert.equal(tools.TOOLS.plinks.arg, 'url');
});

test('registry: arguments, permissions and flags are worked out from use / desc / category', () => {
    const T = tools.TOOLS;
    assert.deepEqual([T.weather.arg, T.weather.req, T.weather.perm, T.weather.group, T.weather.confirm, T.weather.marker], ['text', true, 'any', false, false, true]);
    assert.deepEqual([T.shorten.arg, T.shorten.req], ['url', true]);
    assert.deepEqual([T.joke.arg, T.joke.req, T.joke.marker], ['none', false, true]);
    assert.deepEqual([T.ownerreport.perm, T.ownerreport.confirm, T.ownerreport.marker], ['owner', true, false], 'category owner → owner only, asks first, the AI may not start it');
    assert.deepEqual([T.warnuser.arg, T.warnuser.perm, T.warnuser.group, T.warnuser.confirm, T.warnuser.marker], ['target', 'group-admin', true, true, false]);
    assert.deepEqual([T.antiswear.arg, T.antiswear.req, T.antiswear.perm, T.antiswear.group], ['onoff', true, 'group-admin', true]);
    assert.equal(T.fwdpost.arg, 'raw', 'several parts → the whole rest of the message goes to the plugin');
    assert.deepEqual([T.broadcastok.perm, T.broadcastok.confirm], ['owner', true], 'explicit gf: wins');
    assert.equal(tools.canon('wx'), 'weather'); assert.equal(tools.canon('klimate'), 'weather');
    assert.deepEqual(T.weather.triggers.sort(), ['klimate', 'weather'], 'aliases shorter than 3 letters are not used as spoken triggers');
});

test('registry: parseUsage reads the usual usage lines', () => {
    const p = (u, n = ['x']) => JSON.stringify(registry.parseUsage(u, n));
    assert.equal(p('.x <city>'), '{"arg":"text","req":true,"count":1}');
    assert.equal(p('.x <url>'), '{"arg":"url","req":true,"count":1}');
    assert.equal(p('.x <number>'), '{"arg":"number","req":true,"count":1}');
    assert.equal(p('.x @user'), '{"arg":"target","req":true,"count":1}');
    assert.equal(p('.x on/off'), '{"arg":"onoff","req":true,"count":1}');
    assert.equal(p('.x [message]'), '{"arg":"text","req":false,"count":1}');
    assert.equal(p('.x'), '{"arg":"none","req":false,"count":0}');
    assert.equal(p('.x <a> <b>'), '{"arg":"raw","req":true,"count":2}');
    assert.equal(registry.parseUsage('', ['x']), null);
});

// ═════════════════════════════ the router ═════════════════════════════
test('router: the command name as the first word, with its argument', () => {
    const r = (text, extra = {}) => tools.route({ text, isGroup: false, ...extra });
    assert.deepEqual([r('weather colombo').tool, r('weather colombo').arg], ['weather', 'colombo']);
    assert.deepEqual([r('klimate kandy').tool, r('klimate kandy').arg], ['weather', 'kandy']);
    assert.equal(r('weather').missing, 'text', 'a required argument is missing → she asks');
    assert.equal(r('wx colombo'), null, 'a 2-letter alias is not a spoken trigger');
    const s = r('shorten https://example.com/some/long/url');
    assert.deepEqual([s.tool, s.arg, s.missing], ['shorten', 'https://example.com/some/long/url', null]);
    assert.equal(r('shorten please').missing, 'url');
    assert.equal(r('fwdpost https://whatsapp.com/channel/abc 5 10').arg, 'https://whatsapp.com/channel/abc 5 10');
    assert.equal(r('shout hello there').arg, 'HELLO THERE', 'gf.extract decides the argument');
    assert.equal(tools.route({ text: 'antiswear on', isGroup: true }).arg, 'on');
    assert.equal(tools.route({ text: 'antiswear on', isGroup: false }), null, 'group tools only inside groups');
});

test('router: keywords the author declared (gf.keywords) — Sinhala, Singlish, English; ordinary chat is left alone', () => {
    for (const t of ['tell me a joke please', 'joke ekak kiyanna', 'මට විහිළුවක් කියන්න']) assert.equal(tools.route({ text: t, isGroup: false }).tool, 'joke', t);
    for (const t of ['I made a joke yesterday about the weather and it was funny', 'hi baby kohomada', 'the weather is nice today']) assert.equal(tools.route({ text: t, isGroup: false }), null, t);
});

test('router: built-in rules keep priority over plugin keywords', () => {
    const hit = tools.route({ text: 'https://www.youtube.com/playlist?list=PLabc123 tell me a joke', isGroup: false });
    assert.equal(hit.tool, 'plinks');
});

// ═════════════════════════════ the AI fallback list ═════════════════════════════
test('AI list: safe new tools are described to the model, risky ones are not, and the size is capped', () => {
    const p = tools.markerPrompt();
    assert.match(p, /weather\(text: Weather forecast of a city\)/);
    assert.match(p, /shorten\(url: Shorten a link\)/);
    assert.match(p, /lyrics\(text: song lyrics\)/);
    for (const hidden of ['ownerreport', 'warnuser', 'antiswear', 'fwdpost', 'broadcastok']) assert.ok(!p.includes(hidden), hidden);
    assert.match(p, /plinks\(url\), ytaudl\(url\)/, 'built-ins unchanged');
    assert.ok(tools.markerPrompt(400).length <= 400, 'cap respected: ' + tools.markerPrompt(400).length);
    assert.match(tools.markerPrompt(400), /plinks\(url\)/, 'built-ins are always kept');
    const v = tools.validateMarker({ name: 'weather', arg: 'in colombo please' }, { text: 'weather in colombo please' });
    assert.equal(v.tool, 'weather');
    assert.equal(tools.validateMarker({ name: 'ownerreport', arg: '' }, { text: 'x' }), null);
    assert.equal(tools.validateMarker({ name: 'shorten', arg: 'https://evil.example/x' }, { text: 'shorten that' }), null, 'a url the AI invented');
});

// ═════════════════════════════ end to end ═════════════════════════════
test('flow: anyone just says it, or types it (GF-only mode) — the plugin runs with the right arguments', async () => {
    fresh(); const sock = makeSock(); await onboarded(sock); sock.sent.length = 0;
    await deliver(sock, 'weather colombo');
    assert.deepEqual([calls[0].pattern, calls[0].q], ['weather', 'colombo']);
    assert.ok(texts(sock).some(t => t.startsWith('OUT:weather:colombo')));
    assert.ok(texts(sock).length >= 3, 'with her lines around it');
    assert.equal(ai.prompts.length, 0, 'no AI call needed');
    await deliver(sock, '/weather kandy');
    assert.equal(calls[1].q, 'kandy', 'typed by a normal user → done by her');
    await deliver(sock, '.shorten https://example.com/abc');
    assert.equal(calls[2].q, 'https://example.com/abc');
    await deliver(sock, 'tell me a joke please');
    assert.equal(calls[3].pattern, 'joke');
});

test('flow: a missing argument → she asks (with the author\'s own question) and uses the next message', async () => {
    fresh(); const sock = makeSock(); await onboarded(sock); sock.sent.length = 0;
    await deliver(sock, 'lyrics');
    assert.equal(calls.length, 0);
    assert.ok(texts(sock).some(t => t === 'Which song?' || t === 'ගීතයේ නම මොකක්ද?'), 'the author\'s own question (in the language she has been using): ' + texts(sock).join(' | '));
    await deliver(sock, 'Imagine');
    assert.deepEqual([calls[0].pattern, calls[0].q], ['lyrics', 'Imagine']);
    sock.sent.length = 0;
    await deliver(sock, 'weather');
    assert.equal(calls.length, 1); assert.ok(texts(sock).length >= 1, 'the generic question');
    await deliver(sock, 'galle');
    assert.equal(calls[1].q, 'galle');
});

test('flow: category owner → only the owner, and she asks "sure?" first', async () => {
    fresh(); const sock = makeSock(); await onboarded(sock); await onboarded(sock, OWN);
    await deliver(sock, 'ownerreport');
    assert.equal(calls.length, 0, 'a stranger is refused');
    sock.sent.length = 0;
    await deliver(sock, '/ownerreport', OWN);                          // the owner typing it: runs directly, as always
    assert.equal(calls.length, 1);
    await deliver(sock, 'ownerreport', OWN);                           // …but if the owner ASKS HER, she confirms first
    assert.equal(calls.length, 1); assert.equal(_t.pendingConfirm.size, 1);
    await deliver(sock, 'ඔව්', OWN);
    assert.equal(calls.length, 2);
});

test('flow: category group → real admins only, inside a group, with a confirmation', async () => {
    fresh(); const sock = makeSock(); await onboarded(sock);
    const NIMAL = '94771234567@s.whatsapp.net';
    const member = { isGroup: true, isAdmins: false, isBotAdmins: true }, admin = { isGroup: true, isAdmins: true, isBotAdmins: true };
    await deliver(sock, 'chika warnuser', member, { mentions: [NIMAL] });
    assert.equal(calls.length, 0); assert.equal(_t.pendingConfirm.size, 0, 'a member is refused before any question');
    await deliver(sock, 'chika warnuser', admin, { mentions: [NIMAL] });
    assert.equal(_t.pendingConfirm.size, 1);
    await deliver(sock, 'yes', admin);
    assert.equal(calls[0].pattern, 'warnuser'); assert.deepEqual(calls[0].m.mentioned, [NIMAL], 'the tag reaches the plugin');
    await deliver(sock, 'chika antiswear on', admin);                  // confirm: true for group tools
    await deliver(sock, 'yes', admin);
    assert.deepEqual([calls[1].pattern, calls[1].q], ['antiswear', 'on']);
});

test('flow: a NEW group command typed by a non-admin is sent through her (the plugin may have forgotten its own admin check)', async () => {
    fresh(); const sock = makeSock(); await onboarded(sock);
    const NIMAL = '94771234567@s.whatsapp.net';
    const member = { isGroup: true, isAdmins: false, isBotAdmins: true }, admin = { isGroup: true, isAdmins: true, isBotAdmins: true };
    await deliver(sock, '/warnuser @94771234567', member, { mentions: [NIMAL] });
    assert.equal(calls.length, 0, 'the plugin never ran');
    assert.ok(texts(sock).length >= 1, 'she told the member why');
    await deliver(sock, '/warnuser @94771234567', admin, { mentions: [NIMAL] });
    assert.equal(calls.length, 1, 'an admin typing it runs it directly, like every built-in group command');
    assert.equal(_t.pendingConfirm.size, 0);
});

test('flow: dangerous names stay manual (owner can still type them), an explicit gf: opens them on purpose', async () => {
    fresh(); const sock = makeSock(); await onboarded(sock); await onboarded(sock, OWN);
    await deliver(sock, '/broadcastmsg hello all');                    // a normal user
    await deliver(sock, 'broadcastmsg hello all');
    await deliver(sock, '/oldcmd'); await deliver(sock, '/blockedx'); await deliver(sock, '/faketest2');
    assert.equal(calls.length, 0, 'none of them runs for a normal user');
    await deliver(sock, '/broadcastmsg hello all', OWN);
    assert.equal(calls.at(-1).pattern, 'broadcastmsg', 'the owner types it directly');
    await deliver(sock, 'broadcastok hello my group', OWN);
    assert.equal(_t.pendingConfirm.size, 1, 'gf: { perm:"owner", confirm:true }');
    await deliver(sock, 'yes', OWN);
    assert.deepEqual([calls.at(-1).pattern, calls.at(-1).q], ['broadcastok', 'hello my group']);
});

test('flow: /gf tools shows the owner what she learned and why something was left out; help mentions the new commands', async () => {
    fresh(); const sock = makeSock(); await onboarded(sock); await onboarded(sock, OWN); sock.sent.length = 0;
    await deliver(sock, '/gf tools', OWN);
    const out = texts(sock).join('\n');
    assert.match(out, /weather — text\* — any/); assert.match(out, /the AI knows it/);
    assert.match(out, /broadcastmsg — the name looks dangerous/); assert.match(out, /oldcmd — no `use:` line/);
    assert.ok(!/secretcmd|optout/.test(out), 'hidden / opted-out commands are not nagged about');
    sock.sent.length = 0;
    await deliver(sock, '/gf tools');                                  // a stranger
    assert.ok(!texts(sock).join('\n').includes('Things she can do'));
    sock.sent.length = 0;
    await deliver(sock, 'what can you do?');
    const help = texts(sock).join('\n');
    assert.match(help, /also: .*weather/);
    assert.ok(!/Switch my personality|\/gf list/.test(help), 'a stranger is not offered "switch my personality"');
    assert.ok(/🙂/.test(help) && !/✨/.test(help), 'plain voice, not the girlfriend one');
    sock.sent.length = 0;
    await deliver(sock, 'what can you do?', OWN);
    assert.match(texts(sock).join('\n'), /Switch my personality/, 'her boyfriend still gets the personality hint');
});

test('flow: plugins that load after gf-brain (it loads early, alphabetically) are still picked up; AUTO_TOOLS=false switches it all off', async () => {
    fresh(); const sock = makeSock(); await onboarded(sock);
    plugin({ pattern: 'latecmd', desc: 'Registered late', use: '.latecmd <thing>' });
    commandMap.set('latecmd', events.commands.at(-1));              // (pair.js builds its command map after ALL plugins are loaded)
    await deliver(sock, 'latecmd abc');
    assert.deepEqual([calls.at(-1).pattern, calls.at(-1).q], ['latecmd', 'abc']);
    config.GF.AUTO_TOOLS = false;
    try {
        plugin({ pattern: 'latecmd2', desc: 'Registered later', use: '.latecmd2 <thing>' });
        const n = calls.length; ai.prompts.length = 0;
        await deliver(sock, 'latecmd2 abc');
        assert.equal(calls.length, n, 'not learned while AUTO_TOOLS is false');
        assert.ok(ai.prompts.length >= 1, 'it was just a chat message');
    } finally { config.GF.AUTO_TOOLS = true; }
});
