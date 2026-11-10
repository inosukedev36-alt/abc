// lib/group-greet.js
// Stores per-group welcome / goodbye texts and sends them when members join or leave.
// (The old /setwelcome and /setgoodbye only echoed the text back and never saved anything.)
const fs = require('fs');
const path = require('path');

const FILE = path.join(__dirname, '..', 'data', 'group-greet.json');
let cache = null;

function load() {
    if (cache) return cache;
    try {
        const j = JSON.parse(fs.readFileSync(FILE, 'utf8'));
        cache = (j && typeof j === 'object' && !Array.isArray(j)) ? j : {};
    } catch { cache = {}; }
    return cache;
}

function save() {
    try {
        fs.mkdirSync(path.dirname(FILE), { recursive: true });
        fs.writeFileSync(FILE, JSON.stringify(load(), null, 2));
    } catch (e) { console.error('[group-greet] save failed:', e.message); }
}

function set(groupJid, kind, text) {
    const db = load();
    db[groupJid] = db[groupJid] || {};
    db[groupJid][kind] = String(text).slice(0, 1000);
    save();
}

const get = (groupJid, kind) => (load()[groupJid] || {})[kind] || '';

const fill = (tpl, { user, group, count }) =>
    tpl.replace(/@user|\{user\}/gi, `@${user.split('@')[0]}`)
       .replace(/\{group\}/gi, group || '')
       .replace(/\{count\}/gi, String(count ?? ''));

// Baileys 'group-participants.update' → { id, participants:[jid|{id}], action: add|remove|... }
async function onParticipantsUpdate(sock, update) {
    try {
        const { id, action } = update || {};
        const kind = action === 'add' ? 'welcome' : action === 'remove' ? 'goodbye' : null;
        if (!kind) return;
        const tpl = get(id, kind);
        if (!tpl) return;
        let meta = {};
        try { meta = await sock.groupMetadata(id); } catch {}
        for (const p of update.participants || []) {
            const jid = typeof p === 'string' ? p : (p.phoneNumber || p.id || p.jid);
            if (!jid) continue;
            await sock.sendMessage(id, {
                text: fill(tpl, { user: jid, group: meta.subject, count: (meta.participants || []).length }),
                mentions: [jid],
            });
        }
    } catch (e) { console.error('[group-greet] error:', e.message); }
}

module.exports = { set, get, fill, onParticipantsUpdate, _reset: () => { cache = null; } };
