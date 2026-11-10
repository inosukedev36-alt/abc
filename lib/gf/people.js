'use strict';
/**
 * lib/gf/people.js — "people she knows": a small permanent memory per WhatsApp id, made when her boyfriend
 * introduces someone ("@Nimal this is Nimal, my friend" / reply to a message + "මෙයාගේ නම නිමල්").
 *
 * Only parsing lives here (no state). Storage = GfStore.people, use = plugins/gf-brain.js.
 */
const { norm, parseName } = require('./profile');

/** digits of any jid:  "94771234567:12@s.whatsapp.net" → "94771234567",  "1234@lid" → "1234" */
const digitsOf = (jid) => String(jid || '').split('@')[0].split(':')[0].replace(/\D/g, '');
/** every plausible id (digits) of a person, from any jid-ish values (a person can show up as a phone jid AND a @lid) */
const candidatesOf = (...jids) => [...new Set(jids.flat(Infinity).map(digitsOf).filter(d => d.length >= 6))];

// ───────────────────────── relations
const REL_MAP = {
    // english
    'best friend': 'friend', friend: 'friend', brother: 'brother', sister: 'sister', cousin: 'cousin', teacher: 'teacher', boss: 'boss',
    colleague: 'colleague', classmate: 'classmate', neighbour: 'neighbour', neighbor: 'neighbour', uncle: 'uncle', aunt: 'aunt',
    mom: 'mother', mother: 'mother', dad: 'father', father: 'father', bro: 'brother', sis: 'sister',
    // sinhala
    'යාළුවා': 'friend', 'යාළුවෙක්': 'friend', 'යාලුවා': 'friend', 'යාලුවෙක්': 'friend', 'යාළුවෝ': 'friend', 'යාලුවෝ': 'friend',
    'අයියා': 'older brother', 'අක්කා': 'older sister', 'මල්ලි': 'younger brother', 'නංගි': 'younger sister', 'නංගී': 'younger sister',
    'අම්මා': 'mother', 'තාත්තා': 'father', 'මාමා': 'uncle', 'නැන්දා': 'aunt', 'සහෝදරයා': 'brother', 'සහෝදරිය': 'sister',
    'ගුරුවරයා': 'teacher', 'ගුරුතුමා': 'teacher', 'ගුරුවරිය': 'teacher', 'බොස්': 'boss',
};
const REL_WORDS = Object.keys(REL_MAP).sort((a, b) => b.length - a.length).map(w => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|');
const REL = `(${REL_WORDS})`;
const relOf = (w) => REL_MAP[String(w || '').toLowerCase()] || '';

// ───────────────────────── names
const W = "[\\p{L}\\p{M}][\\p{L}\\p{M}'’-]*";
const NAME = `(${W}(?:\\s+${W}){0,2})`;
const CONNECTORS = new Set(('from in at who he she is was and for with the to my our of here there ok okay please pls thanks thank yeah yes also too ' +
    'ගේ එක්ක සමඟ ගැන හා සහ වගේ අපේ මගේ ඉන්නේ මෙහේ මෙතන ඉන්න කියලා කියල කියන්නේ කියන්නෙ කියනවා').split(' '));
const FIRST_STOP = /^(a|an|the|my|your|our|his|her|their|so|too|very|really|just|not|good|great|nice|bad|best|funny|cool|crazy|amazing|awesome|group|chat|man|guy|girl|boy|bro|sis|dude|real|true|it|that|this|what|who|why|how|me|you|him|them|us|also|still|always|never|here|there|now|then|only|new|old|ok|okay|yes|no)$/i;

function cleanName(raw) {
    const words = [];
    for (const w of norm(raw).split(' ')) { if (CONNECTORS.has(w.toLowerCase())) break; words.push(w); }
    if (!words.length || FIRST_STOP.test(words[0])) return '';
    return parseName(words.join(' ')) || '';
}

// ───────────────────────── patterns (checked in this order; mention tokens like @9477… are removed first)
const I = 'iu';
const PATTERNS = [
    // relation first: "this is my friend Nimal" · "Nimal is my cousin" · "මෙයා මගේ යාළුවා නිමල්" · "නිමල් මගේ යාළුවා"
    { re: new RegExp(`(?:this is|that is|that's|meet|introducing|say hi to)\\s+my\\s+${REL}\\s+${NAME}`, I), rel: 1, name: 2 },
    { re: new RegExp(`${NAME}\\s+is\\s+my\\s+${REL}(?![\\p{L}\\p{M}])`, I), rel: 2, name: 1 },
    { re: new RegExp(`(?:මෙයා|මේ කෙනා|මෙයාව|මේ කෙනාව)?\\s*මගේ\\s*${REL}\\s+${NAME}`, I), rel: 1, name: 2 },
    { re: new RegExp(`${NAME}\\s+මගේ\\s*${REL}(?![\\p{L}\\p{M}])`, I), rel: 2, name: 1 },
    // name only
    { re: new RegExp(`(?:this is|that is|that's|meet|introducing|say hi to|his name is|her name is|their name is|name is|call (?:him|her)|remember (?:him|her) as|save (?:him|her) as|known as)\\s+${NAME}`, I), name: 1 },
    { re: new RegExp(`(?:මෙයාගේ|මෙයාගෙ|මේ කෙනාගේ|මේ කෙනාගෙ|ඔහුගේ|ඇයගේ)\\s*නම\\s*(?:තමයි|තමා|:)?\\s*${NAME}`, I), name: 1 },
    { re: new RegExp(`(?:මෙයාව|මෙයා|මේ කෙනාව|මේ කෙනා)\\s+${NAME}\\s+(?:කියලා|කියල|කියන්නේ|කියන්නෙ|කියනවා)`, I), name: 1 },
    { re: new RegExp(`(?:meyage|eyage|ekage)\\s*nama\\s*(?:eka\\s*)?${NAME}`, I), name: 1 },
    { re: new RegExp(`meya\\s+${NAME}\\s+(?:kiyala|kiyanne|kiyanawa)`, I), name: 1 },
];

/** the person being talked about: first @mention that is not her / not the speaker, else the sender of the replied message */
function pickTarget(mentions = [], quotedSender = '', exclude = []) {
    const skip = new Set(candidatesOf(exclude));
    const ok = (j) => { const d = digitsOf(j); return d.length >= 6 && !skip.has(d); };
    return (mentions || []).find(ok) || (quotedSender && ok(quotedSender) ? quotedSender : '');
}

/**
 * "this is Nimal, my friend" + a @tag / a replied-to message  →  { jid, name, relation } | null
 *   exclude: ids that can never be the target (her own ids, the speaker's own ids)
 */
function parseIntroduction(text, { mentions = [], quotedSender = '', exclude = [] } = {}) {
    const jid = pickTarget(mentions, quotedSender, exclude);
    if (!jid) return null;
    const t = norm(String(text || '').replace(/@\d{5,}/g, ' '));
    if (!t || t.length > 200) return null;
    for (const p of PATTERNS) {
        const m = t.match(p.re);
        if (!m) continue;
        const name = cleanName(m[p.name]);
        if (name) return { jid, name, relation: p.rel ? relOf(m[p.rel]) : '' };
    }
    return null;
}

/** "who is this?" */
const WHO_RE = /(who(?:'s| is)\s+(?:this|that|he|she)\b|මෙයා කවුද|මේ කවුද|මේ කෙනා කවුද|කවුද මේ|කවුද මෙයා|meya kawuda|me kawuda|kawuda meya)/i;
const asksWho = (text) => WHO_RE.test(String(text || ''));

/** "@94771234567 hi" → "@Nimal hi" for every number that she knows; returns { text, known:[{name,relation}] } */
function nameMentions(text, lookup) {
    const known = [];
    const out = String(text || '').replace(/@(\d{6,})/g, (all, d) => {
        const who = lookup(d);
        if (!who || !who.name) return all;
        if (!known.some(k => k.name === who.name)) known.push({ name: who.name, relation: who.relation || '' });
        return '@' + who.name;
    });
    return { text: out, known };
}

module.exports = { digitsOf, candidatesOf, relOf, REL_MAP, pickTarget, parseIntroduction, asksWho, nameMentions, cleanName };
