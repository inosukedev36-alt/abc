'use strict';
// Run:  node --test test/msgid.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs'), os = require('os'), path = require('path');
const M = require('../lib/msgid');

// a trimmed copy of the two call sites of the Baileys fork (normal send path + album branch)
const SAMPLE = (eol = '\n') => [
    '        sendMessage: async (jid, content, options = {}) => {',
    '                const fullMsg = await generateWAMessage(jid, content, {',
    '                    getProfilePicUrl: sock.profilePictureUrl,',
    '                    getCallLink: sock.createCallLink,',
    '                    upload: waUploadToServer,',
    '                    mediaCache: config.mediaCache,',
    '                    options: config.options,',
    '                    ...options,',
    '                    messageId: generateMessageIDV2(userJid)',
    '                });',
    "                if ('album' in content) {",
    '                        const albumMsg = await generateWAMessage(jid, albumMedia, {',
    '                            upload: waUploadToServer,',
    '                            ...options,',
    '                            messageId: generateMessageIDV2(userJid)',
    '                        });',
    '                }',
].join(eol);

test('ids: iOS and Android shapes are what other bots and /devicecheck expect', () => {
    for (const [style, want, len] of [['ios', 'ios', 20], ['android', 'android', 32]]) {
        const gen = M.makeGenerator(style);
        const ids = Array.from({ length: 3000 }, gen);
        assert.equal(new Set(ids).size, ids.length, 'unique');
        for (const id of ids) {
            assert.equal(id.length, len); assert.match(id, /^[0-9A-F]+$/);
            assert.equal(M.detectDevice(id), want);
            assert.ok(!/^(3EB0|BAE5|B24E)/.test(id), 'never looks like a known bot prefix: ' + id);
        }
    }
    assert.equal(M.detectDevice('3EB0' + 'A'.repeat(18)), 'web', 'what Baileys sends by default');
});

test('ids: the rules equal the ones in plugins/antiguard-core.js (.devicecheck)', () => {
    const core = require('../plugins/antiguard-core');
    const detect = core.detectDevice || (core.core && core.core.detectDevice);
    if (!detect) return;                                   // not exported: nothing to compare with
    for (const id of ['3A' + 'F'.repeat(18), 'F'.repeat(32), '3EB0' + 'A'.repeat(18), 'x'.repeat(21), 'x'.repeat(18), 'abc']) assert.equal(M.detectDevice(id), detect(id), id);
});

test('styles: auto = one fixed phone per number, mixed = both, off = nothing', () => {
    assert.equal(M.styleFor('auto', '94760036688'), M.styleFor('auto', '94760036688'));
    const kinds = new Set(['94710000001', '94710000002', '94710000003', '94710000004', '94710000005', '94710000006'].map(n => M.styleFor('auto', n)));
    assert.deepEqual([...kinds].sort(), ['android', 'ios'], 'across numbers both types occur');
    const mixed = M.makeGenerator('mixed'); const seen = new Set(Array.from({ length: 200 }, () => M.detectDevice(mixed())));
    assert.deepEqual([...seen].sort(), ['android', 'ios']);
    assert.equal(M.makeGenerator('off'), null); assert.equal(M.makeGenerator(undefined), null);
    const one = M.makeGenerator('auto', '94742327099'); assert.equal(new Set(Array.from({ length: 50 }, () => M.detectDevice(one()))).size, 1, 'a real phone does not change type per message');
});

test('patch: only the normal send path is changed (LF and CRLF files), idempotent', () => {
    for (const eol of ['\n', '\r\n']) {
        const src = SAMPLE(eol);
        assert.equal(M.inspect(src), 'needs-patch');
        const out = M.patchSource(src);
        assert.equal(M.inspect(out), 'patched');
        assert.equal(M.patchSource(out), out, 'idempotent');
        assert.equal(out.length, src.length, 'same size: two lines swapped');
        const lines = out.split(eol);
        assert.match(lines[7], /messageId: generateMessageIDV2\(userJid\),/);            // normal path: generated id FIRST …
        assert.match(lines[8], /\.\.\.options$/);                                         // … caller's options last (they win)
        assert.match(lines[13], /\.\.\.options,/);                                        // album branch untouched:
        assert.match(lines[14], /messageId: generateMessageIDV2\(userJid\)$/);           // every album item keeps its own fresh id
    }
    assert.equal(M.inspect('nothing to see here'), 'unknown');
});

test('patch: works on the real installed library file (if present) — on a copy', () => {
    const real = M.libFile();
    if (!real || !fs.existsSync(real)) return;
    const src = fs.readFileSync(real, 'utf8');
    assert.ok(['needs-patch', 'patched'].includes(M.inspect(src)), 'the installed Baileys fork is recognised');
    const out = M.patchSource(src);
    assert.equal(M.inspect(out), 'patched');
    assert.equal(M.patchSource(out), out);
    assert.equal(out.split('\n').length, src.split('\n').length);
});

test('ensurePatched: patches a file once, keeps a .orig, respects "off", survives garbage', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'msgid-')); const file = path.join(dir, 'messages-send.js');
    const quiet = { log() {}, warn() {} };
    try {
        fs.writeFileSync(file, SAMPLE());
        assert.equal(M.ensurePatched({ MESSAGE_ID_STYLE: 'off' }, quiet, file), 'off');
        assert.equal(M.inspect(fs.readFileSync(file, 'utf8')), 'needs-patch', 'off → untouched');
        assert.equal(M.ensurePatched({ MESSAGE_ID_STYLE: 'auto' }, quiet, file), 'patched');
        assert.equal(M.inspect(fs.readFileSync(file, 'utf8')), 'patched');
        assert.equal(fs.readFileSync(file + '.orig', 'utf8'), SAMPLE(), 'backup of the original');
        assert.equal(M.ensurePatched({ MESSAGE_ID_STYLE: 'ios' }, quiet, file), 'patched', 'second run is a no-op');
        fs.writeFileSync(file, 'export const x = 1;');
        assert.equal(M.ensurePatched({ MESSAGE_ID_STYLE: 'auto' }, quiet, file), 'unknown');
        assert.equal(M.ensurePatched({ MESSAGE_ID_STYLE: 'auto' }, quiet, path.join(dir, 'nope.js')), 'missing');
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
