// plugins/anime-calendar.js — Daily Anime Release Calendar (AnimeSchedule.net API, AniList fallback)
const axios = require('axios');
const cron = require('node-cron');
const config = require('../config');
const { cmd } = require('../command');

// ═══════════════ සැකසුම් ═══════════════
const CALENDAR_IMAGE_URL = 'https://files.catbox.moe/s39kdz.jpeg';
const AUTO_CRON = '0 0 * * *';      // Auto post යන වෙලාව (ලංකා වේලාවෙන් රෑ 12:00). උදේ 6 ට ඕනේ නම් '0 6 * * *'
const CAPTION_MAX_CHAT = 1000;      // Group / inbox වල image caption එකකට දාන උපරිම අකුරු. WhatsApp caption limit එක ≈ 1024. ඊට වැඩි නම් image නැතුව text එකක් විදිහට (තවමත් එකම message එකක්) යනවා
const CAPTION_MAX_CHANNEL = 1000;   // Channel එකේ image caption එක ~1024 ට වැඩි වුණොත් කැපෙනවා
const CACHE_TTL = 15 * 60 * 1000;   // දත්ත විනාඩි 15ක් cache කරනවා

// ── දත්ත මූලාශ්‍රය ──
// AnimeSchedule.net API (නිවැරදිම, animeschedule.net එකේ timetable එකමයි). ඒකට token එකක් ඕනේ:
//   https://animeschedule.net/users/<username>/settings/api → Application එකක් හදලා "App Token" එක ගන්න
//   ඒක config.ANIMESCHEDULE_TOKEN එකට (නැත්නම් ANIMESCHEDULE_TOKEN env variable එකට) දාන්න.
// Token එක නැත්නම් / AnimeSchedule වැඩ නැත්නම් AniList එකෙන් ගන්නවා (අඩු නිවැරදියි).
const AS_TZ = 'Asia/Colombo';
const INCLUDE_DONGHUA = true;       // චීන anime (donghua) ඇතුළත් කරනවා
const INCLUDE_DUB = false;          // English dub episodes ඇතුළත් කරනවා (default: නැහැ)

// Message එක channel එකකින් "Forwarded" කරපු වගේ පේන්න (View channel button එකත් එක්ක)
const FORWARD_LOOK = true;                          // ඕනේ නැත්නම් false කරන්න
const CHANNEL_INVITE = '0029VbE79hZBadmXSbahq33R';  // https://whatsapp.com/channel/0029VbE79hZBadmXSbahq33R
const CHANNEL_JID = '';                             // JID එක (120363xxxxxxxxxx@newsletter) දන්නවා නම් මෙතන දාන්න. හිස් නම් invite code එකෙන් auto හොයාගන්නවා
const CHANNEL_NAME = '';                            // හිස් නම් channel එකේ නම auto ගන්නවා

// ශ්‍රී ලංකා වේලාව = UTC+5:30 (DST නැහැ).
// Server එකේ timezone එක මොකක් වුණත් වැරදෙන්නේ නැති වෙන්න ගණනය කරන්නේ මෙතනින්ම.
const SL_OFFSET_MS = 5.5 * 60 * 60 * 1000;

const EN_DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const EN_MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

// දවස කොටස් වලට බෙදන හැටි (ලංකා වේලාවෙන්, පැය 0-24)
const SLOTS = [
    { icon: '🌌', name: 'Early Morning', from: 0, to: 6 },
    { icon: '🌅', name: 'Morning', from: 6, to: 12 },
    { icon: '☀️', name: 'Afternoon', from: 12, to: 17 },
    { icon: '🌆', name: 'Evening', from: 17, to: 21 },
    { icon: '🌃', name: 'Night', from: 21, to: 24 }
];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// "typing..." පෙන්නනවා / නවත්තනවා — message එකක් යවන්නේ නැහැ, error එකක් ආවොත් ignore කරනවා
const typing = (sock, jid, state) =>
    Promise.resolve().then(() => sock.sendPresenceUpdate(state, jid)).catch(() => {});

// ═══════════════ ලංකා වේලාව ═══════════════

// ලංකාවේ "අද" දවසේ පටන් ගන්නා (12:00 AM) සහ ඉවර වන වෙලාව — UNIX seconds
function getSLDay(baseMs = Date.now()) {
    const sl = new Date(baseMs + SL_OFFSET_MS);      // මෙතැන් සිට getUTC*() වලින් කියවන්නේ ලංකා වේලාවයි
    const y = sl.getUTCFullYear();
    const mo = sl.getUTCMonth();
    const d = sl.getUTCDate();
    const startTs = Math.floor((Date.UTC(y, mo, d) - SL_OFFSET_MS) / 1000);
    return { y, mo, d, weekday: sl.getUTCDay(), startTs, endTs: startTs + 86400 };
}

// UNIX seconds → ලංකා වේලාවෙන් "06:30 PM"
function slTime(ts) {
    const sl = new Date(ts * 1000 + SL_OFFSET_MS);
    const h24 = sl.getUTCHours();
    const h12 = String(h24 % 12 || 12).padStart(2, '0');
    const min = String(sl.getUTCMinutes()).padStart(2, '0');
    return { hour: h24, text: `${h12}:${min} ${h24 >= 12 ? 'PM' : 'AM'}` };
}

function cleanTitle(t) {
    const s = String(t).replace(/[*_~`]/g, '').trim();      // WhatsApp formatting අකුරු අයින් කරනවා
    return s.length > 60 ? s.slice(0, 57).trimEnd() + '...' : s;
}

// ═══════════════ AnimeSchedule.net (ප්‍රධාන මූලාශ්‍රය) ═══════════════

const AS_BASE = 'https://animeschedule.net/api/v3';

function getAsToken() {
    return String(config.ANIMESCHEDULE_TOKEN || process.env.ANIMESCHEDULE_TOKEN || 'mQjoTQMvtScTKmwRcB1LSrdyS').trim();
}

// Timetable එක ගන්නවා. fail වුණොත් (timeout / rate limit / server error) 3 පාරක් වෙනකම් ආයෙ try කරනවා
async function asRequest(path, params, tries = 3) {
    let lastErr;
    for (let i = 1; i <= tries; i++) {
        try {
            const res = await axios.get(`${AS_BASE}${path}`, {
                params,
                timeout: 20000,
                headers: {
                    'Authorization': `Bearer ${getAsToken()}`,
                    'Accept': 'application/json',
                    'User-Agent': 'AnimeCalendarBot/1.0'
                }
            });
            if (!Array.isArray(res.data)) throw new Error('AnimeSchedule: unexpected response');
            return res.data;
        } catch (e) {
            lastErr = e;
            const status = e.response?.status;
            console.error(`⚠️ AnimeSchedule request failed (${i}/${tries}):`, status ? `HTTP ${status}` : e.message);
            if (status === 401 || status === 403) {
                console.error('⚠️ AnimeSchedule token is invalid or has no permission — check ANIMESCHEDULE_TOKEN.');
                break;                                  // ආයෙ try කරලා වැඩක් නැහැ
            }
            if (status === 400) break;                  // params වැරදියි
            if (i < tries) {
                const reset = Number(e.response?.headers?.['x-ratelimit-reset']);               // rate limit reset වෙන UNIX time එක
                const wait = status === 429 && reset ? Math.min(Math.max(reset - Date.now() / 1000, 1), 30) * 1000 : i * 2000;
                await sleep(wait);
            }
        }
    }
    throw lastErr;
}

// ISO week number (AnimeSchedule එකේ week එක සඳුදාට පටන් ගන්නවා)
function isoWeekOf(ms) {
    const d = new Date(ms);
    const t = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
    t.setUTCDate(t.getUTCDate() + 4 - (t.getUTCDay() || 7));
    const yearStart = Date.UTC(t.getUTCFullYear(), 0, 1);
    return { year: t.getUTCFullYear(), week: Math.ceil(((t - yearStart) / 86400000 + 1) / 7) };
}

// අද දවසට අදාළ week එක(ක්). සාමාන්‍යයෙන් එකයි — සඳුදා දවසේ UTC අනුව week දෙකකට කැඩෙන නිසා දෙකම ගන්නවා
function candidateWeeks(day) {
    const found = new Map();
    for (const ms of [day.startTs * 1000, (day.endTs - 1) * 1000, day.startTs * 1000 + SL_OFFSET_MS]) {
        const w = isoWeekOf(ms);
        found.set(`${w.year}-${w.week}`, w);
    }
    return [...found.values()];
}

// API එකේ datetime (ISO 8601 / RFC 3339) → ms.  Offset එකක් නැත්නම් ලංකා වේලාව ලෙස සලකනවා (tz=Asia/Colombo ඉල්ලපු නිසා)
function parseApiDate(s) {
    if (typeof s !== 'string') return NaN;
    return Date.parse(/(?:Z|[+-]\d{2}:?\d{2})$/i.test(s) ? s : `${s}+05:30`);
}

function titleOf(e) {
    return cleanTitle(e.english || e.title || e.romaji || e.native || 'Unknown');
}

// "Ep 5" / "Ep 34-35" (episodes කීපයක් එකපාර) / "Final Ep 12"
function epLabel(e) {
    const n = Number(e.episodeNumber) || 0;
    if (!n) return '';
    const lo = Number(e.subtractedEpisodeNumber) || 0;
    const total = Number(e.episodes) || 0;
    if (lo && lo < n) return `Ep ${lo}-${n}`;
    return total && n === total ? `Final Ep ${n}` : `Ep ${n}`;
}

// API entries → අද (ලංකා වේලාවෙන්) දවසේ list එක.
// එක anime episode එකකට එක line එකක්: SUB වේලාව main, RAW (ජපන්/චීන් විකාශන) වේලාව විස්තරයට.
function normalizeAnimeSchedule(entries, day) {
    const seen = new Set();
    const groups = new Map();       // route|episode → { sub, raw, dub }
    const delayed = new Map();      // route|episode → { title, epText, types }

    for (const e of entries) {
        if (!e || !e.route) continue;
        const type = String(e.airType || '').toLowerCase();
        if (type !== 'raw' && type !== 'sub' && !(INCLUDE_DUB && type === 'dub')) continue;
        if (e.donghua && !INCLUDE_DONGHUA) continue;

        const ms = parseApiDate(e.episodeDate);
        if (!Number.isFinite(ms)) continue;
        const ts = Math.floor(ms / 1000);
        if (ts < day.startTs || ts >= day.endTs) continue;                  // අද (ලංකා වේලාවෙන්) නොවන ඒවා අයින්

        const dupKey = `${e.route}|${type}|${ts}|${e.episodeNumber}`;
        if (seen.has(dupKey)) continue;                                     // week දෙකකින් එකම entry එක ආවොත්
        seen.add(dupKey);

        const epKey = `${e.route}|${e.episodeNumber}|${e.subtractedEpisodeNumber || ''}`;

        if (String(e.airingStatus || '').toLowerCase() === 'delayed-air') {   // Delay වෙලා — අද එන්නේ නැහැ
            const d = delayed.get(epKey) || { title: titleOf(e), epText: epLabel(e), types: new Set() };
            d.types.add(type.toUpperCase());
            delayed.set(epKey, d);
            continue;
        }

        const key = type === 'dub' ? `${epKey}|dub` : epKey;
        const g = groups.get(key) || {};
        g[type] = { e, ts };
        groups.set(key, g);
    }

    const items = [];
    for (const g of groups.values()) {
        const main = g.sub || g.raw || g.dub;
        if (!main) continue;
        const t = slTime(main.ts);
        let note = '';
        if (main === g.sub) {
            if (g.raw && g.raw.ts !== g.sub.ts) note = `RAW ${slTime(g.raw.ts).text}`;
        } else {
            note = main === g.raw ? 'RAW' : 'DUB';
        }
        items.push({ ts: main.ts, hour: t.hour, time: t.text, epText: epLabel(main.e), title: titleOf(main.e), note });
    }
    items.sort((a, b) => a.ts - b.ts || a.title.localeCompare(b.title));

    const delayedList = [...delayed.values()]
        .map((d) => ({ title: d.title, epText: d.epText, note: [...d.types].join('/') }))
        .sort((a, b) => a.title.localeCompare(b.title));

    return { source: 'AnimeSchedule.net', items, delayed: delayedList };
}

async function fetchAnimeSchedule(day) {
    const entries = await asRequest('/timetables/all', { tz: AS_TZ });      // දැන් තියෙන week එක
    const weeks = candidateWeeks(day);
    if (weeks.length > 1) {                                                 // දවස week දෙකකට කැඩෙනවා නම් අනිත් week එකත් ගන්නවා
        const extra = await Promise.allSettled(
            weeks.map((w) => asRequest('/timetables/all', { tz: AS_TZ, year: w.year, week: w.week }))
        );
        extra.forEach((r) => {
            if (r.status === 'fulfilled') entries.push(...r.value);
            else console.warn('⚠️ AnimeSchedule extra week failed:', r.reason?.message);
        });
    }
    return normalizeAnimeSchedule(entries, day);
}

// ═══════════════ AniList (fallback) ═══════════════

const ANILIST_QUERY = `
query ($start: Int, $end: Int, $page: Int) {
  Page(page: $page, perPage: 50) {
    pageInfo { hasNextPage }
    airingSchedules(airingAt_greater: $start, airingAt_lesser: $end, sort: TIME) {
      airingAt
      episode
      media {
        title { romaji english }
      }
    }
  }
}`;

// එක page එකක් ගන්නවා. fail වුණොත් (timeout / rate limit) 3 පාරක් වෙනකම් ආයෙ try කරනවා
async function anilistRequest(variables, tries = 3) {
    let lastErr;
    for (let i = 1; i <= tries; i++) {
        try {
            const res = await axios.post('https://graphql.anilist.co', { query: ANILIST_QUERY, variables }, {
                timeout: 15000,
                headers: {
                    'Content-Type': 'application/json',
                    'Accept': 'application/json',
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)'
                }
            });
            if (res.data?.errors?.length) throw new Error(res.data.errors[0].message || 'AniList GraphQL error');
            if (!res.data?.data?.Page) throw new Error('AniList empty response');
            return res.data.data.Page;
        } catch (e) {
            lastErr = e;
            const status = e.response?.status;
            console.error(`⚠️ AniList request failed (${i}/${tries}):`, status ? `HTTP ${status}` : e.message);
            if (i < tries) {
                const retryAfter = Number(e.response?.headers?.['retry-after']);
                await sleep(status === 429 && retryAfter ? Math.min(retryAfter, 30) * 1000 : i * 2000);
            }
        }
    }
    throw lastErr;
}

// අද දවසේ (ලංකා වේලාවෙන්) ඔක්කොම episodes — page එකකට 50 බැගින්, ඔක්කොම pages ගන්නවා
async function fetchAniList(day) {
    const all = [];
    for (let page = 1; page <= 6; page++) {
        const data = await anilistRequest({ start: day.startTs - 1, end: day.endTs, page });
        all.push(...(data.airingSchedules || []));
        if (!data.pageInfo?.hasNextPage) break;
    }
    const items = all
        .filter((s) => s.media)
        .map((s) => {
            const t = slTime(s.airingAt);
            return {
                ts: s.airingAt,
                hour: t.hour,
                time: t.text,
                epText: s.episode ? `Ep ${s.episode}` : '',
                title: cleanTitle(s.media.title?.english || s.media.title?.romaji || 'Unknown'),
                note: ''
            };
        });
    return { source: 'AniList', items, delayed: [] };
}

// ═══════════════ දත්ත ගන්න හැටි (cache + fallback) ═══════════════

const caches = {};          // name → { key, at, data, retryAt }
let asDownUntil = 0;        // AnimeSchedule fail වුණාම විනාඩි 2ක් AniList කෙලින්ම පාවිච්චි කරනවා
let asWarned = false;

async function cached(name, day, loader) {
    const key = `${day.y}-${day.mo}-${day.d}`;
    const c = caches[name];
    const sameDay = c && c.key === key;
    if (sameDay && Date.now() - c.at < CACHE_TTL) return c.data;
    if (sameDay && Date.now() < (c.retryAt || 0)) return c.data;           // ළඟදි fail වුණා නම් ආයෙ ගහන්නේ නැහැ

    try {
        const data = await loader();
        caches[name] = { key, at: Date.now(), data };
        return data;
    } catch (e) {
        if (sameDay) {
            c.retryAt = Date.now() + 2 * 60 * 1000;
            console.warn(`⚠️ ${name} failed — using the cached list:`, e.message);
            return c.data;
        }
        throw e;
    }
}

async function getData(day) {
    if (getAsToken()) {
        if (Date.now() >= asDownUntil) {
            try {
                return await cached('animeschedule', day, () => fetchAnimeSchedule(day));
            } catch (e) {
                asDownUntil = Date.now() + 2 * 60 * 1000;
                console.error('⚠️ AnimeSchedule failed — falling back to AniList:', e.message);
            }
        }
    } else if (!asWarned) {
        asWarned = true;
        console.warn('⚠️ ANIMESCHEDULE_TOKEN is not set — using AniList (less accurate). See the settings at the top of anime-calendar.js.');
    }
    return cached('anilist', day, () => fetchAniList(day));
}

// ═══════════════ Message එක හදනවා ═══════════════

function buildHeader(day, total) {
    return [
        `╭━━━〔 📺 *ANIME CALENDAR* 〕━━━╮`,
        `┃ 📅 *${EN_DAYS[day.weekday]}, ${day.d} ${EN_MONTHS[day.mo]} ${day.y}*`,
        `┃ 🎬 Total Episodes : *${total}*`,
        `╰━━━━━━━━━━━━━━━━━━━━╯`
    ].join('\n');
}

function buildSections(items) {
    return SLOTS.map((slot) => {
        const list = items.filter((i) => i.hour >= slot.from && i.hour < slot.to);
        if (!list.length) return null;
        const lines = list.map((i) =>
            `│ 🕐 *${i.time}* ➤ ${i.title}${i.epText ? ` _(${i.epText})_` : ''}${i.note ? ` • ${i.note}` : ''}`);
        return `╭─〔 ${slot.icon} *${slot.name}* 〕\n${lines.join('\n')}\n╰───────────────`;
    }).filter(Boolean);
}

function buildDelayedSection(list) {
    if (!list.length) return null;
    const lines = list.map((d) => `│ ${d.title}${d.epText ? ` _(${d.epText})_` : ''}${d.note ? ` • ${d.note}` : ''}`);
    return `╭─〔 ⏸️ *Delayed* 〕\n${lines.join('\n')}\n╰───────────────`;
}

// AnimeSchedule.net API එකේ terms අනුව data source එකට credit දෙන්න ඕනේ
function buildFooter(source) {
    const note = source === 'AnimeSchedule.net'
        ? '> ⚠️ Times are SUB release times (RAW = original broadcast). They may vary slightly. ⚠️'
        : '> ⚠️ Times are original broadcast times. They may vary slightly. ⚠️';
    return `${note}\n> 📡 Source: ${source}\n> ⚡ᴾᵒʷᵉʳᵉᵈ ᵇʸ ᴷⁱⁿᵍᴾᵒᵈᵈᵃᴹᵒᵈᶻ 𝙓 ᴵⁿᵒˢᵘᵏᵉ`;
}

// → { text }  (header + list + footer — මුළු message එකම)
async function buildCalendar() {
    const day = getSLDay();
    const data = await getData(day);
    const header = buildHeader(day, data.items.length);
    const footer = buildFooter(data.source);

    if (!data.items.length && !data.delayed.length) {
        return { text: `${header}\n\n😴 No anime episodes are scheduled for today.\n\n${footer}` };
    }

    const sections = buildSections(data.items);
    const delayedSection = buildDelayedSection(data.delayed);
    if (delayedSection) sections.push(delayedSection);
    return { text: `${header}\n\n${sections.join('\n\n')}\n\n${footer}` };
}

// ═══════════════ Channel "Forwarded" look ═══════════════

let channelInfo = null;      // { jid, name } — එක පාරක් හොයාගත්තම cache වෙනවා
let channelRetryAt = 0;      // හොයාගන්න බැරි වුණොත් විනාඩි 10ක් යනකම් ආයෙ try කරන්නේ නැහැ
let channelWarned = false;

function withTimeout(promise, ms) {
    let t;
    return Promise.race([
        promise,
        new Promise((_, rej) => { t = setTimeout(() => rej(new Error('timeout')), ms); })
    ]).finally(() => clearTimeout(t));
}

// Channel එකේ JID එකයි නමයි හොයාගන්නවා (invite code එකෙන්)
async function getChannelInfo(sock) {
    if (!FORWARD_LOOK) return null;
    if (channelInfo) return channelInfo;
    if (Date.now() < channelRetryAt) return null;

    let jid = CHANNEL_JID;
    let name = CHANNEL_NAME;
    if (!jid && typeof sock.newsletterMetadata === 'function') {
        try {
            const meta = await withTimeout(sock.newsletterMetadata('invite', CHANNEL_INVITE), 10000);
            jid = meta?.id || '';
            name = name || meta?.name || meta?.thread_metadata?.name?.text || '';
        } catch (e) {
            console.error('⚠️ Could not fetch channel info:', e.message);
        }
    }

    if (!jid) {
        channelRetryAt = Date.now() + 10 * 60 * 1000;
        if (!channelWarned) {
            channelWarned = true;
            console.warn('⚠️ Could not resolve the channel JID — sending without the forwarded look. Set CHANNEL_JID manually.');
        }
        return null;
    }

    channelInfo = { jid, name: name || 'Testone' };
    console.log(`📢 Forward look → ${channelInfo.name} (${channelInfo.jid})`);
    return channelInfo;
}

// "Forwarded — <channel නම> — View channel" වගේ පේන්න contextInfo එක
function forwardContext(ch) {
    if (!ch) return null;
    return {
        isForwarded: true,
        forwardingScore: 1,
        forwardedNewsletterMessageInfo: {
            newsletterJid: ch.jid,
            newsletterName: ch.name,
            serverMessageId: 143
        }
    };
}

// ═══════════════ යවන කොටස ═══════════════

async function sendCalendar(sock, jid, cal, { quoted = null, humanize = false } = {}) {
    const ctx = forwardContext(await getChannelInfo(sock));
    const withCtx = (content) => (ctx ? { ...content, contextInfo: ctx } : content);
    const isChannel = jid.endsWith('@newsletter');

    // Anti-ban: typing පෙන්නනවා (auto post වලට විතරයි)
    if (humanize) {
        try {
            if (!isChannel) {
                await sock.sendPresenceUpdate('composing', jid);
                await sleep(Math.min(5000, cal.text.length * 20 + 1000));
                await sock.sendPresenceUpdate('paused', jid);
                await sleep(500 + Math.random() * 1000);
            } else {
                await sleep(1500);
            }
        } catch (_) { /* presence error එකක් නම් ignore */ }
    }

    const opts = quoted ? { quoted } : {};
    const limit = isChannel ? CAPTION_MAX_CHANNEL : CAPTION_MAX_CHAT;

    // හැම වෙලාවකම යන්නේ message එකක් විතරයි:
    //  • caption එකට ඇතුල් වෙනවා නම්  → image + caption
    //  • දිග වැඩි නම් (WhatsApp එක caption එක කපනවා) → image නැතුව සම්පූර්ණ list එකම text එකක් විදිහට
    if (cal.text.length <= limit) {
        try {
            await sock.sendMessage(jid, withCtx({ image: { url: CALENDAR_IMAGE_URL }, caption: cal.text }), opts);
        } catch (e) {
            // catbox එක down / image එක යවන්න බැරි වුණොත් text විතරක් යවනවා
            console.error(`⚠️ Image send failed (${jid}): ${e.message} → sending text only`);
            await sock.sendMessage(jid, withCtx({ text: cal.text }), opts);
        }
    } else {
        await sock.sendMessage(jid, withCtx({ text: cal.text }), opts);
    }
    console.log(`✅ Calendar sent → ${jid}`);
}

// ═══════════════ COMMAND ═══════════════
cmd({
    pattern: "todayanime",
    alias: ["animetoday", "calendar"],
    desc: "Get today's anime release schedule (Sri Lanka time).",
    category: "anime",
    react: "📺",
    filename: __filename
},
async (conn, mek, m, { from, reply }) => {
    try {
        // වෙනම "wait" message එකක් නැහැ (message එකක් විතරයි යන්නේ) — ඒ වෙනුවට "typing..." පෙන්නනවා
        typing(conn, from, 'composing');
        const cal = await buildCalendar();
        await sendCalendar(conn, from, cal, { quoted: mek });
    } catch (e) {
        console.error('❌ todayanime error:', e);
        reply("❌ Couldn't fetch the anime list right now. Please try again in a moment.");
    } finally {
        typing(conn, from, 'paused');
    }
});

// ═══════════════ AUTO (හැම දවසකම රෑ 12:00 ට — ලංකා වේලාවෙන්) ═══════════════
async function sendDailyAnimeCalendarAuto() {
    if (!config.ANIME_NEWS || !config.ANIME_NEWS.TARGET_JIDS || config.ANIME_NEWS.TARGET_JIDS.length === 0) return;

    const sockets = Object.values(global.activeSockets || {});
    if (sockets.length === 0) return;
    const sock = sockets[0];

    // දත්ත ගන්න බැරි වුණොත් විනාඩි 5කට පස්සේ ආයෙ try කරනවා (උපරිම 3 පාරක්)
    let cal = null;
    for (let attempt = 1; attempt <= 3 && !cal; attempt++) {
        try {
            console.log(`📅 Fetching auto anime releases for today... (${attempt}/3)`);
            cal = await buildCalendar();
        } catch (e) {
            console.error(`❌ Anime Calendar fetch failed (${attempt}/3):`, e.message);
            if (attempt < 3) await sleep(5 * 60 * 1000);
        }
    }
    if (!cal) return;

    for (const jid of config.ANIME_NEWS.TARGET_JIDS) {
        try {
            await sendCalendar(sock, jid, cal, { humanize: true });
        } catch (e) {
            console.error(`❌ Failed to send calendar to ${jid}:`, e.message);
        }
        await sleep(2000 + Math.random() * 3000);
    }
    console.log('✅ Auto Calendar sent successfully.');
}

cron.schedule(AUTO_CRON, () => {
    console.log('⏰ Running daily anime calendar task...');
    sendDailyAnimeCalendarAuto().catch((e) => console.error('❌ Anime Calendar Auto Error:', e.message));
}, {
    timezone: "Asia/Colombo"
});

console.log('📅 Anime Calendar Loaded (AnimeSchedule.net API + AniList fallback | Command: .todayanime | Auto: 00:00 AM | Sri Lanka Time).');
