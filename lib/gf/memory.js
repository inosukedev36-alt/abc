'use strict';
/**
 * lib/gf/memory.js — picking WHICH of the last-24h messages matter for the current one.
 *
 * Why not just paste the whole 24h log into the prompt? The AI endpoint is a plain GET url
 * (≈7.5 KB budget, and Sinhala costs 9 url-chars per letter), so only a few lines ever fit.
 * Everything is STORED (store.js); this module chooses the few most relevant lines to send.
 */
const STOP = new Set(('the a an and or but if so to of in on at for with is are was were be been am i you he she it we they my me your our ' +
    'this that these those do does did have has had will would can could should not no yes ok okay hi hey hello please pls plz just very really ' +
    'what when where why how who which then than too also about from into over like get got ' +
    'එක එකක් එකට එකේ මම මං ඔයා ඔයාට ඔයාගේ මගේ මට මාව ඒ මේ ඒක මේක නේ ද ද? හරි ඔව් නෑ නැහැ කියලා කියල කරලා කරල තමයි තමා වගේ ගැන සමග එක්ක ' +
    'ඉතින් දැන් අද ඊයේ හෙට ටිකක් ගොඩක් හොඳයි ඔන්න මොකද මොනවද කොහොමද කෝ ' +
    'mama oya eka ekak eke mage mata mawa nam da hari ow na kiyala karala thamai wage gana ekka inne dan ada heta').split(' '));

const tokens = (text) =>
    String(text || '').toLowerCase().replace(/[\u200b-\u200d]/g, '')
        .split(/[^\p{L}\p{M}\p{N}]+/u)
        .filter(t => t.length >= 2 && !STOP.has(t) && !/^\d+$/.test(t));

function similar(a, b) {
    if (a === b) return true;
    const n = Math.min(a.length, b.length);
    if (n < 4) return false;
    let p = 0; while (p < n && a[p] === b[p]) p++;
    return p >= Math.max(4, Math.floor(0.75 * n));
}

const weight = (t) => 1 + Math.min(t.length, 8) / 8;

/** the `k` earlier USER messages (not the last `skipLast` entries) that best match `query` */
function recall(entries, query, { k = 3, skipLast = 4, now = Date.now(), windowMs = 24 * 3600e3, minScore = 1.3 } = {}) {
    const q = [...new Set(tokens(query))];
    if (!q.length) return [];
    const pool = entries.slice(0, Math.max(0, entries.length - skipLast)).filter(e => e.role === 'user');
    const scored = [];
    for (const e of pool) {
        const et = tokens(e.text);
        if (!et.length) continue;
        let s = 0;
        for (const t of q) if (et.some(x => similar(x, t))) s += weight(t);
        if (s < minScore) continue;
        const age = Math.min(1, Math.max(0, (now - e.at) / windowMs));
        scored.push({ e, score: s * (1 - 0.3 * age) });
    }
    scored.sort((a, b) => b.score - a.score);
    return scored.slice(0, k).map(x => x.e).sort((a, b) => a.at - b.at);
}

function ago(ms) {
    const m = Math.round(ms / 60000);
    if (m < 2) return 'just now';
    if (m < 90) return `${m} min ago`;
    return `${Math.round(m / 60)}h ago`;
}

/** short English line: how much he has talked to her in the 24h window */
function timeline(entries, now = Date.now()) {
    const mine = entries.filter(e => e.role === 'user');
    if (!mine.length) return '';
    const first = mine[0].at, last = mine[mine.length - 1].at;
    return `He sent ${mine.length} msgs in the last 24h (first ${ago(now - first)}, last ${ago(now - last)}).`;
}

const clip = (t, n) => { t = String(t).replace(/\s+/g, ' ').trim(); return t.length > n ? t.slice(0, n - 1) + '…' : t; };

function formatRecall(snips, now = Date.now(), maxChars = 70) {
    return snips.map(s => `Earlier (${ago(now - s.at)}) he told you: "${clip(s.text, maxChars)}"`).join(' ');
}

const RECALL_RE = /(what did i (say|tell|ask)|do you remember|remember (when|what|that)|did i (tell|say|mention)|i told you|as i said|earlier i|මතකද|මතක ද|මතක තියෙනවද|මතක ඇත|කලින් (කිව්ව|කිව්වා|කිව්වේ)|කිව්වේ මොනවද|කිව්ව දේ|මම කිව්ව|මම කිව්වා|mathakada|mathaka|mama kiwwa|kalin kiwwa)/i;
const wantsRecall = (text) => RECALL_RE.test(String(text || ''));

module.exports = { tokens, similar, recall, timeline, formatRecall, wantsRecall, ago, clip };
