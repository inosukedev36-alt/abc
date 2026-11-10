'use strict';
// Run:  node --test test/people.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const P = require('../lib/gf/people');
const { GfStore } = require('../lib/gf/store');

const BOT = '94700000000@s.whatsapp.net', ME = '94760036688@s.whatsapp.net', NIMAL = '94771234567@s.whatsapp.net';
const parse = (text, opts = {}) => {
    const r = P.parseIntroduction(text, { mentions: [NIMAL], exclude: [BOT, ME], ...opts });
    return r ? `${r.name}${r.relation ? ' | ' + r.relation : ''} | ${P.digitsOf(r.jid)}` : null;
};

test('introductions with a @tag — Sinhala, Singlish, English', () => {
    const cases = [
        ['@94771234567 this is Nimal', 'Nimal | 94771234567'],
        ['this is my friend Nimal @94771234567', 'Nimal | friend | 94771234567'],
        ['@94771234567 Nimal is my cousin', 'Nimal | cousin | 94771234567'],
        ['meet Nimal Perera @94771234567', 'Nimal Perera | 94771234567'],
        ['his name is kasun from school @94771234567', 'Kasun | 94771234567'],
        ['@94771234567 මෙයාගේ නම නිමල්', 'නිමල් | 94771234567'],
        ['මෙයාගේ නම නිමල් තමයි @94771234567', 'නිමල් | 94771234567'],
        ['@94771234567 මෙයා මගේ යාළුවා නිමල්', 'නිමල් | friend | 94771234567'],
        ['@94771234567 නිමල් මගේ යාළුවා', 'නිමල් | friend | 94771234567'],
        ['@94771234567 මෙයා නිමල් කියලා මතක තියාගන්න', 'නිමල් | 94771234567'],
        ['@94771234567 මෙයා මගේ අක්කා සමන්ති', 'සමන්ති | older sister | 94771234567'],
        ['@94771234567 meyage nama nimal', 'Nimal | 94771234567'],
        ['meya nimal kiyala @94771234567', 'Nimal | 94771234567'],
    ];
    for (const [text, want] of cases) assert.equal(parse(text), want, text);
});

test('introductions by replying to the person (no @tag)', () => {
    assert.equal(parse('this is Kasun', { mentions: [], quotedSender: NIMAL }), 'Kasun | 94771234567');
    assert.equal(parse('මෙයාගේ නම කසුන්', { mentions: [], quotedSender: NIMAL }), 'කසුන් | 94771234567');
    assert.equal(parse('@94700000000 meet @94771234567 Nimal', { mentions: [BOT, NIMAL] }), 'Nimal | 94771234567', 'her own @mention is skipped');
});

test('what must NOT be taken as an introduction', () => {
    assert.equal(parse('this is Nimal', { mentions: [], quotedSender: '' }), null, 'nobody is tagged');
    assert.equal(parse('this is Nimal', { mentions: [], quotedSender: ME }), null, 'replying to himself');
    assert.equal(parse('this is Nimal', { mentions: [], quotedSender: BOT }), null, 'replying to her');
    for (const t of ['this is a great group @94771234567', 'this is so funny @94771234567', 'hello @94771234567 how are you', 'he is very good @94771234567', 'this is Nimal ' + 'x'.repeat(250)]) assert.equal(parse(t), null, t);
});

test('helpers: who-is, mention names, id candidates', () => {
    for (const s of ['who is this?', 'මෙයා කවුද?', 'meya kawuda']) assert.ok(P.asksWho(s), s);
    assert.ok(!P.asksWho('hello there'));
    const r = P.nameMentions('hi @94771234567 and @94779999999', (d) => (d === '94771234567' ? { name: 'Nimal', relation: 'friend' } : null));
    assert.equal(r.text, 'hi @Nimal and @94779999999'); assert.equal(r.known.length, 1);
    assert.deepEqual(P.candidatesOf('94771234567:12@s.whatsapp.net', '987654321@lid', ['94771234567@s.whatsapp.net', undefined, '12']), ['94771234567', '987654321']);
});

test('store: people are found by any of their ids, updated, merged and forgotten', async () => {
    const calls = [];
    const adapter = { saveUser() {}, saveMsg() {}, deleteUser() {}, loadUsers: async () => [], loadMsgs: async () => [],
        loadPeople: async () => [{ key: '94779999999', ids: ['94779999999', '5551234'], name: 'Old', relation: 'friend' }],
        savePerson: async (p) => calls.push(['save', p.key, p.name, p.ids.join('/')]), deletePerson: async (k) => calls.push(['del', k]) };
    const s = new GfStore({ adapter, log: { log() {}, error() {} } });
    await s.load();
    assert.equal(s.findPerson(['0', '5551234']).name, 'Old', 'loaded, found through the @lid alias');
    const a = s.setPerson({ ids: ['94771234567'], name: 'Nimal', relation: 'friend', groupJid: 'g@g.us', groupName: 'Family' });
    assert.ok(a.isNew);
    const b = s.setPerson({ ids: ['94771234567'], name: 'Nimali' });
    assert.ok(!b.isNew); assert.equal(b.old.name, 'Nimal'); assert.equal(b.person.relation, 'friend', 'relation kept when not repeated');
    s.addAliases(a.person, ['888777']);
    assert.equal(s.findPerson(['888777']).name, 'Nimali');
    await s.flush();
    assert.deepEqual(calls, [['save', '94771234567', 'Nimali', '94771234567/888777']], 'one write with the final data');
    assert.deepEqual(s.listPeople().map(p => p.name), ['Nimali', 'Old']);
    s.removePerson(['888777']); await new Promise(r => setImmediate(r));
    assert.equal(s.findPerson(['94771234567']), null); assert.deepEqual(calls.at(-1), ['del', '94771234567']);
});
