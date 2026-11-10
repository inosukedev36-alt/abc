'use strict';
/**
 * lib/gf/profile.js — understanding "my name is…", "I'm 22", "my birthday is 14 May" in
 * Sinhala, Singlish and English, plus the onboarding state machine (name → age → birthday).
 */
const COLOMBO_OFFSET = 5.5 * 3600 * 1000;
const colomboDate = (now = Date.now()) => new Date(now + COLOMBO_OFFSET);   // read with getUTC*()
const yearNow = (now) => colomboDate(now).getUTCFullYear();

const norm = (t) => String(t || '').replace(/[\u200b-\u200d\ufeff]/g, '').replace(/\s+/g, ' ').trim();

// ───────────────────────── skip / no
const SKIP_RE = /^(skip|pass|no|nope|nah|later|idk|na|naa|epa|නෑ|නැහැ|නැ|එපා|පස්සේ|පස්සෙ)[.!\s]*$|(skip|don'?t want|dont want|kiyanne na|kiyanna ba|කියන්නේ නෑ|කියන්නෙ නෑ|කියන්න බෑ|කියන්න බැහැ|කියන්න මැ|කියන්න ඕනේ නෑ|එපා කියන්න)/i;
const isSkip = (t) => SKIP_RE.test(norm(t));

// ───────────────────────── name
const NAME_PREFIX = new RegExp(
    '^(?:my\\s+name\\s+is|my\\s+name\'?s|name\\s+is|i\\s*am|i\'?m|im|this\\s+is|call\\s+me|it\'?s|mage\\s+nama(?:\\s+eka)?|mage\\s+name|mage\\s+nam|mama|mage|මගේ\\s*නම(?:\\s*තමයි|\\s*තමා)?|මගෙ\\s*නම|නම\\s*(?:තමයි|තමා)?|මම|මං)\\s*[:\\-–,]?\\s*', 'i');
const NAME_SUFFIX = /\s+(?:kiyanawa|kiyala|kiyanne|kiyannne|thamai|thamayi|neda|කියනවා|කියලා|කියන්නේ|කියන්නෙ|තමයි|තමා|නේ|වෙනවා|ලු)\s*$/i;
const NAME_DENY = /^(?:no|nope|nah|why|what|who|hi|hii+|hello|hey|hmm+|ok|okay|yes|yeah|ඔව්|නෑ|හායි|හෙලෝ|මොකද|ඇයි|මොකටද|මොනවද|ඔයාගේ නම මොකද්ද|you|u)$/i;

function titleCase(w) { return /^[a-z]/.test(w) ? w[0].toUpperCase() + w.slice(1).toLowerCase() : w; }

function parseName(text) {
    let t = norm(text);
    if (!t || t.length > 60 || /https?:\/\/|www\.|@/.test(t) || /[?？]/.test(t)) return null;
    for (let i = 0; i < 3; i++) { const n = t.replace(NAME_PREFIX, ''); if (n === t) break; t = n; }
    t = t.replace(NAME_SUFFIX, '');
    if (/\d/.test(t)) return null;                                   // names have no digits ("user123")
    t = t.replace(/[^\p{L}\p{M}\s'’-]/gu, ' ').replace(/\s+/g, ' ').trim();
    if (!t || NAME_DENY.test(t)) return null;
    const words = t.split(' ');
    if (words.length > 3 || t.length > 28) return null;
    return words.map(titleCase).join(' ');
}

// ───────────────────────── months
const MONTHS = {
    1: ['january', 'jan', 'januari', 'ජනවාරි', 'ජනවාරී', 'janawari'],
    2: ['february', 'feb', 'februari', 'පෙබරවාරි', 'පෙබරවාරී', 'pebarawari', 'febrawari'],
    3: ['march', 'mar', 'මාර්තු', 'marthu', 'marchu'],
    4: ['april', 'apr', 'අප්රේල්', 'අප්‍රේල්', 'apral', 'aprel'],
    5: ['may', 'මැයි', 'mei', 'mey'],
    6: ['june', 'jun', 'juni', 'ජූනි', 'ජුනි'],
    7: ['july', 'jul', 'juli', 'ජූලි', 'ජුලි'],
    8: ['august', 'aug', 'අගෝස්තු', 'agosthu', 'agostu'],
    9: ['september', 'sept', 'sep', 'සැප්තැම්බර්', 'septhambar', 'september'],
    10: ['october', 'oct', 'ඔක්තෝබර්', 'okthobar', 'octobar'],
    11: ['november', 'nov', 'නොවැම්බර්', 'nowambar', 'novambar'],
    12: ['december', 'dec', 'දෙසැම්බර්', 'desambar', 'decambar'],
};
const stripJoiners = (s) => s.replace(/[\u200b-\u200d]/g, '').toLowerCase();
const MONTH_LOOKUP = [];
for (const [num, names] of Object.entries(MONTHS)) for (const n of names) MONTH_LOOKUP.push([stripJoiners(n), +num]);
MONTH_LOOKUP.sort((a, b) => b[0].length - a[0].length);   // longest first ("june" before "jun")
const MONTH_RE = new RegExp('(?<![\\p{L}\\p{M}])(' + MONTH_LOOKUP.map(([n]) => n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|') + ')(?![\\p{L}\\p{M}])', 'iu');
const monthOf = (word) => (MONTH_LOOKUP.find(([n]) => n === stripJoiners(word)) || [])[1];

const DIM = [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
const validDM = (d, m) => m >= 1 && m <= 12 && d >= 1 && d <= DIM[m - 1];

function parseBirthday(text, now = Date.now()) {
    const t = stripJoiners(norm(text));
    const Y = yearNow(now);
    const okYear = (y) => y >= 1920 && y <= Y - 3;
    let m;

    // 2001-05-14 / 2001/5/14
    if ((m = t.match(/(?<!\d)(\d{4})[\/\-.](\d{1,2})[\/\-.](\d{1,2})(?!\d)/))) {
        const [y, mo, d] = [+m[1], +m[2], +m[3]];
        if (okYear(y) && validDM(d, mo)) return { day: d, month: mo, year: y };
    }
    // 14/05/2001, 05/14/2001, 14-5-01
    if ((m = t.match(/(?<!\d)(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2,4})(?!\d)/))) {
        let [a, b, y] = [+m[1], +m[2], +m[3]];
        if (y < 100) y += (y <= (Y % 100) - 3 ? 2000 : 1900);
        let d = a, mo = b;                     // Sri Lanka: day first
        if (mo > 12 && d <= 12) [d, mo] = [mo, d];
        if (okYear(y) && validDM(d, mo)) return { day: d, month: mo, year: y };
    }
    // month names: "14 May 2001", "May 14", "මැයි 14", "5th of june"
    const mm = t.match(MONTH_RE);
    if (mm) {
        const month = monthOf(mm[1]);
        const rest = t.replace(MONTH_RE, ' ');
        const year = (rest.match(/(?<!\d)(19\d{2}|20\d{2})(?!\d)/) || [])[1];
        const dayM = rest.replace(/(?<!\d)(19\d{2}|20\d{2})(?!\d)/, ' ').match(/(?<!\d)(\d{1,2})(?!\d)/);
        if (dayM && validDM(+dayM[1], month)) {
            const y = year ? +year : null;
            return { day: +dayM[1], month, year: y && okYear(y) ? y : null };
        }
    }
    // 14/05 or 05-14 (no year)
    if ((m = t.match(/(?<!\d)(\d{1,2})[\/\-.](\d{1,2})(?![\d\/\-.])/))) {
        let [d, mo] = [+m[1], +m[2]];
        if (mo > 12 && d <= 12) [d, mo] = [mo, d];
        if (validDM(d, mo)) return { day: d, month: mo, year: null };
    }
    return null;
}

const looksLikeDate = (t) => !!parseBirthday(t);

function ageFromBirthday(b, now = Date.now()) {
    if (!b || !b.year) return null;
    const c = colomboDate(now);
    let age = c.getUTCFullYear() - b.year;
    if (c.getUTCMonth() + 1 < b.month || (c.getUTCMonth() + 1 === b.month && c.getUTCDate() < b.day)) age--;
    return age;
}

// ───────────────────────── age
function parseAge(text, now = Date.now()) {
    const t = norm(text);
    const m = t.match(/(?<!\d)(\d{1,4})(?!\d)/);
    if (!m) return null;
    const n = +m[1], Y = yearNow(now);
    if (n >= 1920 && n <= Y - 3) return { age: Y - n, year: n };      // they typed their birth year
    if (n >= 5 && n <= 100) return { age: n };
    return null;
}

/** age the girlfriend should believe *today* (age given once keeps growing with the calendar) */
function currentAge(u, now = Date.now()) {
    if (!u) return null;
    if (u.bdayYear && u.bdayMonth) { const a = ageFromBirthday({ year: u.bdayYear, month: u.bdayMonth, day: u.bdayDay }, now); if (a != null) return a; }
    if (u.age == null) return null;
    const yrs = u.ageAt ? Math.floor((now - u.ageAt) / (365.25 * 24 * 3600 * 1000)) : 0;
    return u.age + Math.max(0, yrs);
}

/** safety: under 18 or unknown age → she stays a warm FRIEND (no romance) */
const isAdultKnown = (u, now) => { const a = currentAge(u, now); return a != null && a >= 18; };
const friendOnly = (u, now) => !isAdultKnown(u, now);

function isBirthdayToday(u, now = Date.now()) {
    if (!u || !u.bdayMonth || !u.bdayDay) return false;
    const c = colomboDate(now);
    return c.getUTCMonth() + 1 === u.bdayMonth && c.getUTCDate() === u.bdayDay;
}

// ───────────────────────── statements made later in the chat
function extractProfileUpdates(text, now = Date.now()) {
    const t = norm(text);
    const patch = {};
    let m;
    if ((m = t.match(/(?:my name is|call me|mage nama|mage name|මගේ නම|මගෙ නම)\s*[:\-]?\s*(.{1,40})/i))) {
        const name = parseName(m[1]); if (name) patch.name = name;
    }
    if ((m = t.match(/(?:my birthday(?: is)?|my bday(?: is)?|birthday is|born on|mage upandina|mage birthday|මගේ උපන්\s?දින(?:ය|ේ)?(?: එක)?|මගේ birthday(?: එක)?|මගෙ birthday)\s*(?:is|:|-|තමයි|තමා)?\s*(.{3,40})/i))) {
        const b = parseBirthday(m[1], now);
        if (b) { patch.bdayDay = b.day; patch.bdayMonth = b.month; if (b.year) { patch.bdayYear = b.year; } }
    }
    if ((m = t.match(/(?:i am|i'm|im|age is|mage wayasa|mata awurudu|මගේ වයස|මගෙ වයස|මට අවුරුදු|මට වයස)\s*(\d{1,3})/i) || t.match(/(?<!\d)(\d{1,2})\s*(?:years? old|yrs? old|වැනි|ක් වයස|වයස|අවුරුදු)/i))) {
        const a = parseAge(m[1], now); if (a && !a.year) { patch.age = a.age; patch.ageAt = now; }
    }
    return Object.keys(patch).length ? patch : null;
}

// ───────────────────────── onboarding
const MAX_TRIES = 2;
/**
 * Feed the user's answer for the current step.
 * → { patch, asked, ok }  asked = which question she should ask NEXT ('name'|'age'|'bday'|'retry'|null when finished)
 */
function onboardingAnswer(user, text, { pushname = '', now = Date.now() } = {}) {
    const step = user.step;
    const skip = isSkip(text);
    const fallbackName = parseName(pushname) || '';

    const finishBday = (b) => {
        const p = { bdayDay: b.day, bdayMonth: b.month, bdayYear: b.year || null, step: 'done', tries: 0 };
        if (b.year) { p.age = ageFromBirthday(b, now); p.ageAt = now; }
        return { patch: p, asked: null, ok: true };
    };

    if (step === 'name') {
        const name = skip ? '' : parseName(text);
        if (name) return { patch: { name, step: 'age', tries: 0 }, asked: 'age', ok: true };
        if (skip || user.tries + 1 >= MAX_TRIES) return { patch: { name: fallbackName || '', step: 'age', tries: 0 }, asked: 'age', ok: false, fallback: true };
        return { patch: { tries: user.tries + 1 }, asked: 'retry', ok: false };
    }
    if (step === 'age') {
        if (!skip) {
            if (looksLikeDate(text) && parseBirthday(text, now).year) return finishBday(parseBirthday(text, now));   // gave a full birthday instead
            const a = parseAge(text, now);
            if (a) return { patch: { age: a.age, ageAt: now, ...(a.year ? { bdayYear: a.year } : {}), step: 'bday', tries: 0 }, asked: 'bday', ok: true };
        }
        if (skip || user.tries + 1 >= MAX_TRIES) return { patch: { step: 'bday', tries: 0 }, asked: 'bday', ok: false, fallback: true, ageUnknown: true };
        return { patch: { tries: user.tries + 1 }, asked: 'retry', ok: false };
    }
    if (step === 'bday') {
        if (!skip) { const b = parseBirthday(text, now); if (b) return finishBday(b); }
        if (skip || user.tries + 1 >= MAX_TRIES) return { patch: { step: 'done', tries: 0 }, asked: null, ok: false, fallback: true };
        return { patch: { tries: user.tries + 1 }, asked: 'retry', ok: false };
    }
    return { patch: {}, asked: null, ok: true };
}

module.exports = {
    norm, isSkip, parseName, parseAge, parseBirthday, looksLikeDate, ageFromBirthday, currentAge,
    isAdultKnown, friendOnly, isBirthdayToday, extractProfileUpdates, onboardingAnswer, colomboDate,
};
