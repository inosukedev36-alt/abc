// plugins/anime-news.js — Auto Anime News Broadcaster
// (Forwarded-from-channel style post: Photo + Title + detailed AI summary + "View channel" button + No-duplicates + Anti-Ban)
/*
   group / private chat වලට යන post එක channel එකකින් forward කරපු message එකක් වගේ පේනවා:
        "Forwarded" → channel නම → photo → title + summary → "View channel" button (tap කළාම news channel එකට යනවා)
   channel එකටම යන post එක සාමාන්‍ය photo + caption post එකක් (channel එකටම forward-style post එකක් යවන්න WhatsApp එක දෙන්නේ නැහැ)
   (date / author / hashtags / full news මේකේ නැහැ — title + summary එක විතරයි)

   config.js එකේ ANIME_NEWS ඇතුළේ දාන්න පුළුවන් options (ENABLED / TARGET_JIDS / INTERVAL_MINUTES හැර ඔක්කොම optional):
     VIEW_CHANNEL_JID  : '120363XXXXXXXXXXXXXX@newsletter'   ← "View channel" button එක tap කළාම යන channel එකේ JID එක (දාලා නැත්නම් news වැටෙන channel එකටම යනවා)
     VIEW_CHANNEL_NAME : 'ᴍɪᴢᴛʏ ᴀɴɪᴍᴇ'                       ← post එකේ උඩින් පේන channel නම
     VIEW_CHANNEL_LINK : 'https://whatsapp.com/channel/XXXX'  ← JID එක නැත්නම් මේකෙන් හොයාගන්නවා
     QUOTE_NAME        : 'ᴵⁿᵒˢᵘᵏᵉ'                            ← reply card එකේ නම   (QUOTE_ENABLED: true = reply card එකත් දානවා | default: නැහැ)
     SUMMARY           : true | false                         ← AI summary (false = AI නැතුව article එකේ මුල් ඡේද වලින් summary එක හදනවා)   SUMMARY_LANG: 'English' | 'Sinhala' ...
     SHOW_TITLE / STATE_FILE / START_DELAY_SECONDS / AI_API_URL
   💬 .aninews command (ඕන වෙලාවක news ගන්න):   .aninews  |  .aninews 2  |  .aninews list
        COMMAND_ENABLED: false (අක්‍රිය කරන්න) | COMMAND: 'aninews' (command නම) | COMMAND_PREFIX: '.' (හෝ ['.', '!'])
*/
const fs = require('fs');
const path = require('path');
const Parser = require('rss-parser');
const axios = require('axios');
const cheerio = require('cheerio');
const config = require('../config');

const CFG = config.ANIME_NEWS || {};
// config.js එකේ ANIME_NEWS ඇතුළේ දැම්මොත් ඒක ගන්නවා, නැත්නම් මෙතන තියෙන default එක
const opt = (key, def) => (CFG[key] === undefined || CFG[key] === null || CFG[key] === '' ? def : CFG[key]);

/* ═══════════════ ⚙️ SETTINGS — මෙතනින් වෙනස් කරන්න පුළුවන් ═══════════════ */
const FEED_URL      = 'https://animecorner.me/feed/';
const MAX_PER_CHECK = 2;      // එක check එකකදී යවන උපරිම news ගණන
const MAX_AGE_HOURS = 36;     // මීට පරණ news යවන්නේ නැහැ
const POST_LATEST_ON_FIRST_RUN = false;   // true කළොත් state file එක නැති පළවෙනි run එකේදී අලුත්ම news යවනවා (test කරන්න විතරයි!
                                          // restart වෙද්දී file එක මැකෙන host එකක නම් true දාන්න එපා — එහෙම දැම්මොත් restart හැමවෙලේම ආයේ යනවා)
const START_DELAY_SEC = Number(opt('START_DELAY_SECONDS', 30));   // bot පටන් ගෙන තත්පර මෙච්චරකින් පස්සේ පළවෙනි check එක (connection එක ස්ථාවර වෙන්න)

// 📢 "View channel" button — config.js එකේ ANIME_NEWS ඇතුළේ දැම්මත් හරි, මෙතන quotes ඇතුළේ දැම්මත් හරි
//   VIEW_CHANNEL_JID  → "View channel" button එක tap කළාම යන channel එකේ JID එක: '120363XXXXXXXXXXXXXX@newsletter'
//                       • දාලා නැත්නම් news වැටෙන channel එකටම යනවා (TARGET_JIDS ඇතුළේ තියෙන @newsletter JID එක)
//   VIEW_CHANNEL_NAME → post එකේ උඩින් පේන channel නම (දාලා නැත්නම් channel එකේ ඇත්ත නම auto ගන්නවා)
//   VIEW_CHANNEL_LINK → (optional) https://whatsapp.com/channel/XXXX
//                       • JID එක දාලා නැත්නම් මේ link එකෙන් JID එක auto හොයාගන්නවා
const normChannelJid = (v) => { v = String(v || '').trim(); return /^\d{8,}$/.test(v) ? v + '@newsletter' : v; };
const VIEW_CHANNEL_JID  = normChannelJid(CFG.VIEW_CHANNEL_JID || '');
const VIEW_CHANNEL_NAME = CFG.VIEW_CHANNEL_NAME || 'ᴍɪᴢᴛʏ ᴀɴɪᴍᴇ';
const VIEW_CHANNEL_LINK = String(CFG.VIEW_CHANNEL_LINK || '').trim();
const NEWSLETTER_MSG_ID = 143;                       // "View channel" button එකට ඕන message id එක (වෙනස් කරන්න ඕන නැහැ)
const FORWARD_SCORE     = 1;                         // 1 = "Forwarded" (screenshot එකේ වගේ) | 5 ට වැඩි නම් "Forwarded many times" කියලා පේනවා

// 💬 "Reply" style — post එක, නමක් තියෙන contact card එකකට reply කළා වගේ පේනවා (WhatsApp respond එකක් වගේ)
const QUOTE_ENABLED = CFG.QUOTE_ENABLED === true;    // true කළොත් reply card එකත් දානවා (default: නැහැ — forwarded post එක screenshot එකේ වගේම පේන්න)
const QUOTE_NAME    = CFG.QUOTE_NAME || 'ᴵⁿᵒˢᵘᵏᵉ';   // reply card එකේ පේන නම (කලින් ADMIN_TEAM තිබුණු තැන)

// 🖼️ Post එක: article එකේ photo එක + caption (title + summary) — channel එකකින් forward කරපු message එකක් වගේ
const SHOW_TITLE  = CFG.SHOW_TITLE !== false;      // caption එකේ title එක පෙන්නනවා (false කළොත් title නැහැ)

// 🤖 AI summary (Gemini API) — post එකේ "In short" කොටස
const SUMMARY_ENABLED   = CFG.SUMMARY !== false;                                            // false කළොත් AI නැතුව article එකේ මුල් ඡේද වලින් summary එක හදනවා
const SUMMARY_LANG      = String(opt('SUMMARY_LANG', 'English'));                           // 'English' | 'Sinhala' | ...
const AI_API_URL        = String(opt('AI_API_URL', 'https://ai.dnuz.top/api/gemini?q='));  // අන්තිමට q= එක තියෙන්න ඕන
const SUMMARY_TARGET_CHARS = 620;  // AI එකෙන් ඉල්ලන summary එකේ දිග (අකුරු ගණන, ආසන්නව) — full news නැති නිසා විස්තර වැඩියෙන් දෙනවා
const SUMMARY_MAX_CHARS    = 720;  // summary එකේ උපරිම අකුරු ගණන (caption එකේ ඉඩට අනුව ඒකත් අඩු වෙන්න පුළුවන්)
const AI_INPUT_CHARS    = 3000;    // AI එකට යවන article කොටසේ උපරිම අකුරු ගණන (URL එක දිග වැඩි වෙන්නේ නැති වෙන්න)
const AI_MAX_URL_LEN    = 6000;    // මීට වඩා දිග URL එකක් යවන්නේ නැහැ
const AI_TIMEOUT_MS     = 25000;

const CAPTION_LIMIT     = 1000;    // photo caption එකට උපරිම අකුරු ගණන (WhatsApp limit එක 1024)
const MAX_ARTICLE_CHARS = 15000;   // මීට වඩා දිග article එකක් කපනවා (spam / ban වළක්වන්න)
const MAX_RETRIES       = 3;       // කිසිම තැනකට යන්න බැරි වුණ news එකක් ආයේ try කරන උපරිම වාර ගණන

const BANNER  = '📰 *ANIME NEWS* 📰';
const DIVIDER = '━━━━━━━━━━━━━━━━━━━━';
const BT      = String.fromCharCode(96);
const FOOTER  = BT + 'ᴍɪᴢᴛʏ ᴀɴɪᴍᴇ©↠ᴵⁿᵒˢᵘᵏᵉ' + BT;
const NO_COPY = "> *🚫 Don't Copy This Article/Post  🚫*";
const SUMMARY_LABEL = '💬 *In short*';
/* ═══════════════════════════════════════════════════════════════════════ */

const CHANNEL_OK = /@newsletter$/.test(VIEW_CHANNEL_JID);
const isNewsletter = (jid) => String(jid || '').endsWith('@newsletter');

const BROWSER_HEADERS = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    'Accept-Language': 'en-US,en;q=0.9'
};

const parser = new Parser({ timeout: 20000, headers: BROWSER_HEADERS });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const totalLen = (arr) => arr.reduce((n, s) => n + s.length, 0);

// අකුරු/ඉලක්කම් විතරක් — paragraph / title දෙකක් සසඳන්න
const norm = (s) => String(s || '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '');

/* ═══════════════ 🔁 Duplicate වළක්වන කොටස ═══════════════
   • යවපු news ලැයිස්තුව file එකක save වෙනවා (atomic write) → bot restart වුණත් ආයේ යන්නේ නැහැ
   • හැම check එකකටම කලින් සහ යවන්න කලින්ම file එක ආයේ කියවලා merge කරනවා → restart / deploy වෙද්දී
     process දෙකක් එකවර දුවනවා නම් දෙවැන්නා ඒක දැකලා skip කරනවා
   • guid, link, title තුනෙන්ම බලනවා → feed එකේ guid / link වෙනස් වුණත් එකම news එක ආයේ යන්නේ නැහැ
   • යවන්න කලින්ම "claim" කරනවා. කිසිම තැනකට යන්න බැරි වුණොත් (connection නැතිව) විතරක් ආයේ try කරනවා (උපරිම MAX_RETRIES)
   • "Timed out" වගේ ගියාද නැද්ද කියලා හරියටම කියන්න බැරි error එකක් ආවොත් වෙන format එකකින් ආයේ යවන්නේ නැහැ
   • state එක global එකේත් තියෙනවා → plugin එක reload / reconnect එකකදී දෙපාරක් load වුණත් timers දෙකක් හැදෙන්නේ නැහැ
   ⚠️ host එක restart වෙද්දී file system එක reset වෙනවා නම් (Heroku / Railway / Render...) persistent disk එකක් පාවිච්චි කරන්න
      හෝ config එකේ STATE_FILE එකට persistent folder එකක path එකක් දෙන්න. anime-news-sent.json GitHub එකට commit කරන්නත් එපා.   */
const STATE_FILE = CFG.STATE_FILE ? path.resolve(String(CFG.STATE_FILE)) : path.join(__dirname, '..', 'anime-news-sent.json');
const MAX_STATE  = 900;
const G = global.__animeNews || (global.__animeNews = {});

function readDisk() {
    try {
        const data = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
        if (data && Array.isArray(data.guids)) return new Set(data.guids.map(String));
    } catch (e) { /* file එක නැහැ / කියවන්න බැහැ */ }
    return null;
}

// වෙන process එකක් (හෝ කලින් run එකක්) ලියපු දේවල් ඇතුළු කරගන්නවා
function mergeDisk() {
    const disk = readDisk();
    if (disk && disk.size) {
        disk.forEach((k) => G.sent.add(k));
        G.fresh = false;
    }
}

function saveState(merge) {
    try {
        if (merge !== false) mergeDisk();
        const json = JSON.stringify({ guids: Array.from(G.sent).slice(-MAX_STATE), savedAt: new Date().toISOString() });
        const tmp = STATE_FILE + '.' + process.pid + '.' + Math.random().toString(36).slice(2, 8) + '.tmp';
        fs.writeFileSync(tmp, json);
        try {
            fs.renameSync(tmp, STATE_FILE);                  // අඩක් ලියවුණු file එකක් ඉතුරු වෙන්නේ නැහැ
        } catch (e) {                                        // සමහර disks / Windows වල rename කරන්න බැරි වුණොත් කෙළින්ම ලියනවා
            fs.writeFileSync(STATE_FILE, json);
            try { fs.unlinkSync(tmp); } catch (_) { /* ignore */ }
        }
        return true;
    } catch (e) {
        console.error('⚠️ Anime news: යවපු list එක save කරන්න බැරි වුණා:', e.message);
        return false;
    }
}

if (!G.sent) {
    const disk = readDisk();
    G.sent = disk || new Set();
    G.fresh = !disk || disk.size === 0;                      // file එක නැත්නම් / හිස් නම් = පළවෙනි run එක
}

// එකම news එකට keys කීපයක්: guid, link, title
const itemKeys = (item) => {
    const keys = [item.guid, item.link, item.title ? 't:' + norm(item.title) : '']
        .map((k) => String(k || '').trim())
        .filter((k) => k && k !== 't:');
    return Array.from(new Set(keys));
};
const isSeen   = (item) => itemKeys(item).some((k) => G.sent.has(k));
const markSeen = (item) => itemKeys(item).forEach((k) => G.sent.add(k));

// යවන්න කලින් "මේක මම ගත්තා" කියලා file එකේ ලියනවා. වෙන කෙනෙක් කලින් ගත්තා නම් false
function claim(item) {
    mergeDisk();
    if (isSeen(item)) return false;
    markSeen(item);
    saveState(false);
    return true;
}

// claim එක අයින් කරනවා — මේ news එකේ keys විතරයි; වෙන process එකක් ලියපු අනිත් ඒවා රැකගන්නවා
function release(item) {
    const mine = new Set(itemKeys(item));
    const disk = readDisk();
    if (disk) disk.forEach((k) => { if (!mine.has(k)) G.sent.add(k); });
    mine.forEach((k) => G.sent.delete(k));
    saveState(false);
}

// කිසිම තැනකට යන්න බැරි වුණ news එකක් ආයේ try කරන්න ඉඩ දෙනවා (උපරිම MAX_RETRIES වතාවක්)
function giveBack(item, reason) {
    G.fails = G.fails || {};
    const key = itemKeys(item)[0];
    G.fails[key] = (G.fails[key] || 0) + 1;
    if (G.fails[key] < MAX_RETRIES) {
        release(item);
        console.error(`↩️ Anime news: "${item.title}" යන්න බැරි වුණා (${reason}) — ඊළඟ check එකේදී ආයේ try කරනවා (${G.fails[key]}/${MAX_RETRIES})`);
    } else {
        console.error(`🛑 Anime news: "${item.title}" ${MAX_RETRIES} පාරක්ම අසාර්ථකයි (${reason}) — මේක skip කරනවා`);
    }
}

function isTooOld(item) {
    const t = Date.parse(item.isoDate || item.pubDate || '');
    return !!t && (Date.now() - t) > MAX_AGE_HOURS * 3600 * 1000;
}

/* ═══════════════ 🧹 HTML → WhatsApp text (ඡේද, bold, list රැකගන්නවා) ═══════════════ */

const BLOCK_SELECTOR = 'p, h2, h3, h4, h5, h6, li, blockquote';

// article body එකට අයිති නැති කොටස් (menu, ads, share, related, comments...)
const JUNK_SELECTOR = [
    'script', 'style', 'noscript', 'iframe', 'form', 'button', 'select', 'svg', 'video', 'audio',
    'figure', 'header', 'footer', 'nav', 'aside',
    '.twitter-tweet', '.instagram-media', '.wp-block-embed', '.sharedaddy', '.addtoany_share_save_container',
    '.jp-relatedposts', '.yarpp-related', '.adsbygoogle',
    '[class~="ad"]', '[class~="ads"]', '[class~="advert"]', '[class~="advertisement"]',
    '[class~="share"]', '[class~="sharing"]', '[class~="related"]', '[class~="comments"]', '#comments'
].join(', ');

// මේ heading එකක් (සම්පූර්ණ text එකම) ආවොත් article එක ඉවරයි — ඊට පස්සේ related / comments
const TERMINATOR = /^(related (posts?|articles?|stories|news)|join the discussion|trending( posts?| now)?|popular( posts?)?|recommended( for you| posts?)?|comments?|you may also like|more (news|stories)|read next|latest news|leave a (reply|comment))$/i;

const KNOWN_ROOTS = ['.entry-content', '.post-content', '.article-content', '.article-body', '.prose', '[itemprop="articleBody"]', 'article'];

const decodeText = (html) => {
    if (!html) return '';
    return cheerio.load('<div>' + html + '</div>')('div').text().replace(/\s+/g, ' ').trim();
};

const tidy = (s) => s
    .replace(/[\u200B\uFEFF]/g, '')
    .replace(/[ \t\r\f\v]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .trim();

// <strong>/<em> → WhatsApp *bold* / _italic_ (spaces marker එකෙන් එළියට)
function wrapMark(text, mark) {
    const m = text.match(/^(\s*)([\s\S]*?)(\s*)$/);
    if (!m || !m[2] || m[2].includes('\n')) return text;
    if (m[2][0] === mark && m[2][m[2].length - 1] === mark) return text;
    return m[1] + mark + m[2] + mark + m[3];
}

const NO_TAGS = new Set();
const LIST_TAGS = new Set(['ul', 'ol']);

function nodeToText(node, skipTags) {
    if (!node) return '';
    if (node.type === 'text') return (node.data || '').replace(/\s+/g, ' ');
    if (node.type !== 'tag') return '';                       // comment, script, style...
    const name = (node.name || '').toLowerCase();
    if (name === 'br') return '\n';
    if (skipTags.has(name)) return '';
    const inner = (node.children || []).map((n) => nodeToText(n, skipTags)).join('');
    if (name === 'strong' || name === 'b') return wrapMark(inner, '*');
    if (name === 'em' || name === 'i') return wrapMark(inner, '_');
    return inner;
}

function isSkippable(t) {
    if (/^(advertisement|sponsored|ad|share|share this|continue reading)$/i.test(t)) return true;
    if (/^the post .+ appeared first on /i.test(t)) return true;
    if (/^(read more|related( posts?| articles?)?|also read|see also|recommended)\s*[:–-]/i.test(t)) return true;
    if (/^written by\b/i.test(t) && t.length < 80) return true;
    if (/^https?:\/\/\S+$/i.test(t)) return true;             // URL එක විතරක් තියෙන line
    return false;
}

// link එකක් විතරම නම් (related post, "Previous post" වගේ) — ඒක news text එකක් නෙවෙයි
function isLinkOnly($el, plain) {
    const linkText = $el.find('a').text().replace(/\s+/g, ' ').trim();
    return plain.length < 160 && linkText.length / plain.length > 0.9;
}

// root එක ඇතුළේ තියෙන paragraphs, headings, lists, quotes → ලස්සන ඡේද array එකක්
function extractParagraphs($, $root, authorKey) {
    const $c = $root.clone();
    $c.find(JUNK_SELECTOR).remove();

    const out = [];
    let stop = false;
    let lastKind = '';                                          // '', 'p', 'item', 'other'

    const run = (selector) => {
        $c.find(selector).each((_, el) => {
            if (stop) return false;
            const $el = $(el);
            const tag = (el.name || '').toLowerCase();

            // nested block ඇත්නම් ඇතුළේ තියෙන එක විතරක් ගන්නවා
            const nested = tag === 'li' ? 'p, h2, h3, h4, h5, h6, blockquote' : selector;
            if ($el.find(nested).length) return;

            const plain = tidy($el.text().replace(/\s+/g, ' '));
            if (!plain) return;

            const isHeading = /^h[2-6]$/.test(tag);
            const li = tag === 'li' ? el : ($el.closest('li').get(0) || null);
            if (out.length) {
                // article එක ඉවරයි: related / comments heading, author box ("Written by" හෝ author නම heading එකක්)
                const authorBox = isHeading && authorKey && norm(plain) === authorKey;
                const writtenBy = /^written by\b/i.test(plain) && plain.length < 80;
                if ((isHeading && TERMINATOR.test(plain)) || authorBox || writtenBy) { stop = true; return false; }
            }
            // "Source: ..." line එක — ඒකයි ඊට පස්සේ තියෙන ඒවයි summary එකට ගන්නේ නැහැ (article එක ඉවරයි)
            const isSourceLine = !li && /^sources?\s*[:：]/i.test(plain);
            if (isSourceLine) { stop = true; return false; }
            if (isSkippable(plain) || (!li && isLinkOnly($el, plain))) return;

            if (isHeading) {
                out.push('🔸 *' + plain.replace(/\*/g, '') + '*');
                lastKind = 'other';
                return;
            }

            let raw = tidy((el.children || []).map((n) => nodeToText(n, tag === 'li' ? LIST_TAGS : NO_TAGS)).join(''));
            // <br> එකකින් පස්සේ "Source: ..." කියලා line එකක් තියෙනවා නම් ඒකත් අයින් කරනවා
            raw = raw.split('\n').filter((ln) => !/^\s*sources?\s*[:：]/i.test(ln)).join('\n').trim();
            if (!raw) return;

            const inQuote = tag === 'blockquote' || $el.closest('blockquote').length > 0;

            // <br><br> වලින් වෙන් වුණු කොටස් වෙනම ඡේද කරනවා
            raw.split(/\n{2,}/).forEach((part) => {
                part = part.trim();
                if (!part) return;
                if (li) {
                    const ordered = li.parent && li.parent.name === 'ol';
                    part = (ordered ? ($(li).prevAll('li').length + 1) + '. ' : '▪️ ') + part;
                    // list items (සහ ":" වලින් ඉවර වෙන lead-in ඡේදය) එකට ගොඩගහනවා — අතරමැද හිස් line නැතුව
                    const leadIn = lastKind === 'p' && /:$/.test(out[out.length - 1]);
                    if (lastKind === 'item' || leadIn) out[out.length - 1] += '\n' + part;
                    else out.push(part);
                    lastKind = 'item';
                    return;
                }
                lastKind = inQuote ? 'other' : 'p';
                out.push(inQuote ? '❝ ' + part + ' ❞' : part);
            });
        });
    };

    run(BLOCK_SELECTOR);
    // p / li / heading එකක්වත් නැති site වලට — leaf <div> වලින් try කරනවා
    if (!out.length && !$c.find(BLOCK_SELECTOR).length) run(BLOCK_SELECTOR + ', div');

    return out.filter((s, i) => s !== out[i - 1]);              // එක දිගට එකම ඡේදය දෙපාරක් නැහැ
}

const isInside = (node, ancestor) => {
    for (let n = node.parent; n; n = n.parent) if (n === ancestor) return true;
    return false;
};

// article body එක තියෙන තැන auto-detect කරනවා (class names මත යැපෙන්නේ නැහැ):
// paragraph text වැඩිපුරම තියෙන container එක, RSS excerpt එකෙන් පටන් ගන්න paragraph එක ඇතුළත්ව
function findArticleRoot($, hints) {
    const scores = new Map();
    let anchor = null;

    $('p').each((_, el) => {
        const $p = $(el);
        if ($p.closest('header, footer, nav, aside').length) return;
        const text = $p.text().replace(/\s+/g, ' ').trim();
        if (text.length < 40) return;
        if ($p.find('a').text().length / text.length > 0.5) return;   // menu / related links

        if (!anchor) {
            const key = norm(text);
            if (hints.some((h) => key.startsWith(h))) anchor = el;
        }
        const parent = el.parent;
        if (!parent) return;
        scores.set(parent, (scores.get(parent) || 0) + text.length);
        if (parent.parent) scores.set(parent.parent, (scores.get(parent.parent) || 0) + text.length / 2);
    });

    let best = null;
    let bestScore = 0;
    scores.forEach((score, node) => {
        if (anchor && !isInside(anchor, node)) return;
        if (score > bestScore) { best = node; bestScore = score; }
    });
    return best ? $(best) : null;
}

function absoluteUrl(src, base) {
    if (!src || /^data:/i.test(src)) return null;
    try { return new URL(src, base).href; } catch (e) { return null; }
}

// og:image එක MB ගණන් ලොකු original එක. Card එකට page එකේම තියෙන 1024px version එක (සැහැල්ලුයි) තෝරනවා
function pickCardImage($, ogImage, base) {
    if (!ogImage) return null;
    const stem = ogImage.replace(/\.[a-z0-9]+(\?.*)?$/i, '');
    let best = null;
    let bestW = 0;
    $('img').each((_, el) => {
        const $img = $(el);
        const cands = [$img.attr('src'), $img.attr('data-src')]
            .concat(($img.attr('srcset') || '').split(',').map((s) => s.trim().split(/\s+/)[0]));
        cands.forEach((c) => {
            const abs = absoluteUrl(c, base);
            const m = abs && abs.indexOf(stem + '-') === 0 && abs.match(/-(\d+)x(\d+)\.[a-z0-9]+$/i);
            if (m && +m[1] <= 1280 && +m[1] > bestW) { best = abs; bestW = +m[1]; }
        });
    });
    return best || ogImage;
}

/* ═══════════════ 🌐 Article scrape (summary එකට article text + ප්‍රධාන පින්තූරය) ═══════════════ */

async function getFullArticleData(url, excerpt, author) {
    const result = { paragraphs: [], image: null, cardImage: null };
    if (!url) return result;

    try {
        const { data } = await axios.get(url, { headers: BROWSER_HEADERS, timeout: 20000 });
        const $ = cheerio.load(data);

        // RSS excerpt / og:description එකෙන් article එක පටන් ගන්න තැන හොයාගන්නවා
        const hints = [excerpt, $('meta[property="og:description"]').attr('content')]
            .map((h) => norm(decodeText(h)).slice(0, 30))
            .filter((h) => h.length >= 15);

        const candidates = [];
        const auto = findArticleRoot($, hints);
        if (auto) candidates.push({ name: 'auto-detect', $el: auto });
        KNOWN_ROOTS.forEach((sel) => {
            const $el = $(sel).first();
            if ($el.length) candidates.push({ name: sel, $el });
        });

        for (const c of candidates) {
            const paras = extractParagraphs($, c.$el, norm(author));
            if (totalLen(paras) >= 40) {
                result.paragraphs = paras;
                console.log(`📄 Article body (${c.name}): ${paras.length} block(s), ${totalLen(paras)} chars`);
                break;
            }
        }
        if (!result.paragraphs.length) console.log('⚠️ Article body හොයාගන්න බැරි වුණා — RSS excerpt එක පාවිච්චි කරනවා');

        let image = $('meta[property="og:image"]').attr('content')
            || $('meta[name="twitter:image"]').attr('content');
        if (!image && candidates[0]) {
            const $img = candidates[0].$el.find('img').first();
            image = $img.attr('data-src') || $img.attr('data-lazy-src') || $img.attr('src');
        }
        result.image = absoluteUrl(image, url);
        result.cardImage = pickCardImage($, result.image, url);
    } catch (e) {
        console.error('Scrape error:', e.message);
    }
    return result;
}

async function downloadImage(url) {
    if (!url) return null;
    try {
        const res = await axios.get(url, {
            responseType: 'arraybuffer',
            timeout: 30000,
            maxContentLength: 15 * 1024 * 1024,
            headers: Object.assign({}, BROWSER_HEADERS, { Accept: 'image/jpeg,image/png,image/*;q=0.8,*/*;q=0.5' })
        });
        if (!String(res.headers['content-type'] || '').startsWith('image/')) return null;
        return Buffer.from(res.data);
    } catch (e) {
        console.error('Image download error:', e.message);
        return null;
    }
}

/* ═══════════════ 🤖 AI summary (මිනිහෙක් type කළා වගේ) ═══════════════ */

// API එකෙන් ආපු response එකේ (JSON / plain text) අදාළ text එක හොයාගන්නවා
const AI_TEXT_KEYS = ['result', 'response', 'answer', 'text', 'output', 'reply', 'content', 'message', 'data', 'candidates', 'parts', 'choices'];
const AI_SKIP_KEYS = /^(status|success|ok|code|error|errors|creator|author|model|usage|time|timestamp|id|type|role)$/i;

function pickAiText(data, depth) {
    depth = depth || 0;
    if (data === null || data === undefined || depth > 8) return '';
    if (typeof data === 'string') return data.trim().length >= 20 ? data : '';
    if (Array.isArray(data)) {
        for (const x of data) {
            const t = pickAiText(x, depth + 1);
            if (t) return t;
        }
        return '';
    }
    if (typeof data === 'object') {
        // error response එකක් නම් ඒකේ message එක summary එකක් විදිහට ගන්නේ නැහැ
        if (data.error || data.success === false || data.status === false) return '';
        if (typeof data.status === 'string' && /error|fail/i.test(data.status)) return '';
        if (typeof data.status === 'number' && data.status >= 400) return '';
        for (const k of AI_TEXT_KEYS) {
            if (k in data) {
                const t = pickAiText(data[k], depth + 1);
                if (t) return t;
            }
        }
        for (const k of Object.keys(data)) {
            if (AI_TEXT_KEYS.includes(k) || AI_SKIP_KEYS.test(k)) continue;
            const t = pickAiText(data[k], depth + 1);
            if (t) return t;
        }
    }
    return '';
}

// AI text එක → මිනිහෙක් type කළා වගේ සරල text එකක් (markdown, "Here is..." intro, em-dash, links අයින් කරනවා)
function cleanSummary(raw, maxChars) {
    let t = String(raw || '').replace(/\r/g, '');
    if (/<\/?(html|body|head|div|script|span|p)\b/i.test(t)) return '';          // error page (HTML) එකක්
    t = t
        .replace(/```[\s\S]*?```/g, ' ')
        .replace(/https?:\/\/\S+/gi, '')
        .replace(/^\s{0,3}#{1,6}\s+/gm, '')                                      // markdown headings
        .replace(/^\s*(?:[-*•▪]\uFE0F?|\d+[.)])\s+/gm, '')                       // bullets / numbering
        .replace(/[*_~`]+/g, '')                                                 // bold / italic / code markers
        .replace(/[“”„]/g, '"').replace(/[‘’]/g, "'")
        .replace(/\s*[—–]\s*/g, ' - ');                                          // AI වල දැනෙන em-dash එක අයින්
    // "Sure! Here's a quick summary:" වගේ intro line එක
    t = t.replace(/^\s*(?:sure|okay|ok|certainly|of course|here(?:'s| is| are)|summary|tl;?dr|in short|quick take)\b[^\n:]{0,60}:\s*/i, '');
    t = t.replace(/^\s*(?:[-*•▪]\uFE0F?|\d+[.)])\s+/gm, '');                    // intro අයින් කළාම මුලට එන bullet එකත්
    // ඡේද (හිස් line එකකින් වෙන් වුණු කොටස්) 3 ක් දක්වා රැකගන්නවා — ඒ ඒ ඡේදය ඇතුළේ line එකට ගලපනවා
    t = t.split(/\n[ \t]*\n/)
        .map((p) => p.split('\n').map((l) => l.trim()).filter(Boolean).join(' ').replace(/\s{2,}/g, ' ').trim())
        .filter(Boolean)
        .slice(0, 3)
        .join('\n\n');
    if (/^"[^"]*"$/.test(t)) t = t.slice(1, -1).trim();                          // මුළු text එකම quotes ඇතුළේ නම් විතරයි අයින් කරන්නේ

    // AI එක ප්‍රතික්ෂේප කළ / error text එකක් (මුලින්ම). "I can't wait" වගේ සාමාන්‍ය වාක්‍ය වලට අහුවෙන්නේ නැහැ
    if (/\b(as an ai|ai language model|large language model)\b/i.test(t)) return '';
    if (/^(?:i(?:'m| am) sorry|sorry[,.! ]|i apologi[sz]e|unfortunately,? i|i (?:can(?:'|no)t|cannot|am unable to|'m unable to) (?:access|browse|open|read|view|summari[sz]e|help|assist|provide|fulfil|complete))/i.test(t)) return '';
    if (t.length < 25) return '';

    return trimToSentence(t, maxChars);                                          // වාක්‍යයක් ඉවර වෙන තැනින් කපනවා
}

function buildSummaryPrompt(title, text, target, maxChars) {
    const lang = /sinhala|සිංහල/i.test(SUMMARY_LANG)
        ? 'Sinhala (use Sinhala script, the way a Sri Lankan anime fan would casually type it)'
        : SUMMARY_LANG;
    return [
        'You are an anime fan typing a WhatsApp channel post to your friends about a news article.',
        `Write a detailed summary of the news below in ${lang}. Your readers will NOT open the full article, so the summary has to tell them the whole story.`,
        'Rules:',
        `- Length: about ${target} characters in total (roughly 5 to 7 sentences). Never go over ${maxChars} characters.`,
        '- Write 2 short paragraphs separated by one blank line. Paragraph 1: what the news is (the main announcement or event). Paragraph 2: the important details.',
        '- Include the concrete facts from the article: names (anime, studios, staff, cast, characters), dates and seasons, episode counts, platforms or where to watch or read, and any other detail that matters. Do not leave out important facts.',
        '- Sound like a real person typing casually: simple natural words and a relaxed tone. Do NOT sound like an AI, a press release or a news anchor.',
        '- Plain text only: no markdown, no asterisks, no bullet points, no headings, no hashtags, no links.',
        '- At most one emoji, and only if it feels natural.',
        '- Use only facts from the article. Do not invent anything. Keep anime, studio and character names exactly as they are.',
        '- Do NOT start with "Here is", "Sure", "Summary" or "This article". Output only the summary text itself.',
        '',
        `Title: ${title}`,
        `Article: ${text}`
    ].join('\n');
}

const safeSlice = (s, n) => s.slice(0, n).replace(/[\uD800-\uDBFF]$/, '');          // surrogate pair එකක් මැදින් කැපෙන්නේ නැහැ
const wellFormed = (s) => s.replace(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g, '');   // අඩකට කැඩුණු emoji අයින් (encodeURIComponent error වළක්වන්න)
const aiShape = (d) => (d && typeof d === 'object')
    ? 'keys: ' + Object.keys(d).slice(0, 8).join(', ')
    : `${typeof d}: ${String(d).slice(0, 80)}`;

async function fetchSummary(title, paragraphs, room) {
    if (!SUMMARY_ENABLED || !AI_API_URL) return '';

    const text = wellFormed(paragraphs.join(' ')).replace(/[*_~❝❞🔸▪\uFE0F]/gu, '').replace(/\s+/g, ' ').trim();
    if (text.length < 80) return '';

    const maxChars = Math.min(SUMMARY_MAX_CHARS, room);                          // caption එකේ ඉඩට වැඩි වෙන්න බැහැ
    const target   = Math.max(200, Math.min(SUMMARY_TARGET_CHARS, maxChars - 80));

    let url;
    try {
        let take = AI_INPUT_CHARS;
        const build = () => AI_API_URL + encodeURIComponent(buildSummaryPrompt(title, safeSlice(text, take), target, maxChars));
        url = build();
        while (url.length > AI_MAX_URL_LEN && take > 300) { take = Math.floor(take * 0.8); url = build(); }
    } catch (e) {
        console.error('⚠️ AI summary: prompt එක හදන්න බැරි වුණා:', e.message);
        return '';
    }

    for (let attempt = 1; attempt <= 2; attempt++) {
        try {
            const res = await axios.get(url, {
                timeout: AI_TIMEOUT_MS,
                headers: Object.assign({}, BROWSER_HEADERS, { Accept: 'application/json, text/plain, */*' })
            });
            const summary = cleanSummary(pickAiText(res.data), maxChars);
            if (summary) {
                console.log(`🤖 AI summary ready (${summary.length} chars)`);
                return summary;
            }
            console.log(`⚠️ AI summary: response එකෙන් text එකක් ගන්න බැරි වුණා (${aiShape(res.data)})`);
        } catch (e) {
            console.error(`⚠️ AI summary (try ${attempt}) failed: ${e.message}`);
        }
        if (attempt < 2) await sleep(2500);
    }
    return '';
}

// text එක maxChars ට කපනවා — වාක්‍යයක් ඉවර වෙන තැනින් (නැත්නම් වචනයක් ඉවර වෙන තැනින්)
function trimToSentence(text, maxChars) {
    text = String(text || '').trim();
    if (text.length <= maxChars) return text;
    const re = /[.!?\u2026\u3002]["')\]]?(?=\s|$)/g;
    let at = -1;
    let m;
    while ((m = re.exec(text)) && m.index + m[0].length <= maxChars) at = m.index + m[0].length;
    if (at > maxChars * 0.5) return text.slice(0, at).trim();
    return safeSlice(text, maxChars).replace(/\s+\S*$/, '').trim() + '\u2026';
}

// AI summary එක ගන්න බැරි වුණොත් (හෝ SUMMARY: false නම්) — article එකේ මුල් ඡේද වලින් summary එකක් හදනවා
function fallbackSummary(paragraphs, maxChars) {
    const text = (paragraphs || [])
        .filter((p) => !/^(\u{1F538}|\u25AA|\d+\.\s)/u.test(p))                      // headings / lists අයින්
        .map((p) => p.split('\n')[0].replace(/[*_~\u275D\u275E]/g, '').replace(/\s+/g, ' ').trim())
        .filter((p) => p.length >= 40)                                               // හරිම කෙටි line (photo credit වගේ) අයින්
        .join('\n\n');
    return text ? trimToSentence(text, maxChars) : '';
}

/* ═══════════════ ✨ Post එක ලස්සනට හදන කොටස ═══════════════ */

function buildHeader(a) {
    const lines = [BANNER, DIVIDER];
    if (SHOW_TITLE) lines.push('', `✦ *${a.title}* ✦`);
    if (SHOW_TITLE) lines.push('', DIVIDER);
    return lines.join('\n');
}

const buildFooter = () => `${DIVIDER}\n${FOOTER}\n\n${NO_COPY}`;     // "Don't Copy" line එක හැමවිටම අන්තිමට

// post එකේ සම්පූර්ණ caption එක: banner + title → summary → footer
const buildCaption = (a, summary) => [buildHeader(a)]
    .concat(summary ? [`${SUMMARY_LABEL}\n${summary}`] : [], [buildFooter()])
    .join('\n\n');

// caption එකේ summary එකට ඉතිරි තැන (අකුරු ගණන) — title එක දිග නම් අඩු වෙනවා
const summaryRoom = (title) => CAPTION_LIMIT - buildCaption({ title }, 'x').length + 1;

// article → photo එකට යවන caption එක (CAPTION_LIMIT එකට ගැලපෙන්න ඕන නම් summary එක කපනවා)
function composePost(a) {
    let summary = a.summary || '';
    let text = buildCaption(a, summary);
    if (summary && text.length > CAPTION_LIMIT) {
        const room = summaryRoom(a.title);
        summary = room >= 120 ? trimToSentence(summary, room) : '';
        text = buildCaption(a, summary);
    }
    return text;
}

// RSS item එකකින් post එකට ඕන දේවල් හදනවා (title, summary, photo)
async function prepareArticle(item) {
    const link = item.link || '';
    const excerpt = decodeText(item.content || item.contentSnippet || '');

    console.log(`🔗 Scraping article: ${link}`);
    const scraped = await getFullArticleData(link, excerpt, item.creator);

    let paragraphs = scraped.paragraphs;
    if (!paragraphs.length && excerpt) paragraphs = [excerpt];

    // summary එකට ඕන article කොටස — ඉතා දිග article එකක් නම් කපනවා
    const limited = [];
    let total = 0;
    for (const p of paragraphs) {
        if (total + p.length > MAX_ARTICLE_CHARS) break;
        limited.push(p);
        total += p.length + 2;
    }

    const title = String(item.title || 'No title').replace(/\*/g, '').trim();
    const room = summaryRoom(title);                         // caption එකේ summary එකට ඉතිරි තැන
    let summary = '';
    if (room >= 150) {
        summary = await fetchSummary(title, limited, room);  // AI summary
        if (!summary) {                                      // AI එක වැඩ නැත්නම් article එකේ මුල් ඡේද වලින්
            summary = fallbackSummary(limited, Math.min(SUMMARY_MAX_CHARS, room));
            if (summary) console.log(`📝 Summary: article එකේ මුල් ඡේද පාවිච්චි කළා (${summary.length} chars)`);
        }
    }

    // photo එක: කලින් වගේම original එක. බාන්න බැරි වුණොත් විතරක් page එකේම තියෙන සැහැල්ලු (≤1280px) version එක
    const imageUrl = (item.enclosure && item.enclosure.url) || scraped.image;
    let buffer = await downloadImage(imageUrl);
    if (!buffer && scraped.cardImage && scraped.cardImage !== imageUrl) buffer = await downloadImage(scraped.cardImage);

    return {
        title,
        link,
        summary,
        image: buffer || (imageUrl ? { url: imageUrl } : null)
    };
}

/* ═══════════════ 📢 View channel ═══════════════ */

// VIEW_CHANNEL_JID එක (හෝ VIEW_CHANNEL_LINK එකෙන් හොයාගත්ත JID එක) → { jid, name } | null
async function resolveChannel(sock) {
    if (G.channel) return G.channel;
    let jid = VIEW_CHANNEL_JID;
    let name = VIEW_CHANNEL_NAME;

    if (jid && !CHANNEL_OK) return null;                     // JID එක වැරදි (@newsletter නැහැ) — load වෙද්දීම warn කළා

    if (!jid) {
        const m = VIEW_CHANNEL_LINK.match(/whatsapp\.com\/channel\/([\w-]+)/i);
        if (!m || typeof sock.newsletterMetadata !== 'function') return null;
        try {
            const meta = await sock.newsletterMetadata('invite', m[1]);
            const id = meta && (meta.id || meta.jid);
            if (id && isNewsletter(id)) {
                jid = id;
                if (!CFG.VIEW_CHANNEL_NAME) {
                    let n = meta.name || (meta.thread_metadata && meta.thread_metadata.name);
                    if (n && typeof n === 'object') n = n.text;
                    if (n) name = String(n);
                }
                console.log(`📢 Anime news: channel link එකෙන් JID එක හොයාගත්තා → ${jid}`);
            }
        } catch (e) {
            console.error('⚠️ Anime news: channel link එකෙන් JID එක ගන්න බැරි වුණා:', e.message);
        }
    }
    if (!jid) return null;
    G.channel = { jid, name };
    return G.channel;
}

// news වැටෙන channel (TARGET_JIDS ඇතුළේ තියෙන @newsletter JID)
const targetChannels = () => ((config.ANIME_NEWS && config.ANIME_NEWS.TARGET_JIDS) || [])
    .map((j) => String(j || '').trim())
    .filter(isNewsletter);

function withTimeout(promise, ms) {
    let timer;
    const timeout = new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('timeout')), ms); });
    return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

// channel එකක JID එකෙන් { jid, name } — නම config එකේ (VIEW_CHANNEL_NAME) නැත්නම් channel එකෙන්ම ගන්නවා
async function describeChannel(sock, jid) {
    G.channels = G.channels || {};
    if (G.channels[jid]) return G.channels[jid];

    let name = VIEW_CHANNEL_NAME;
    let known = !!CFG.VIEW_CHANNEL_NAME;                     // නම config එකේ දීලා නම් channel එකෙන් අහන්න ඕන නැහැ
    if (!known && typeof sock.newsletterMetadata === 'function') {
        try {
            const meta = await withTimeout(sock.newsletterMetadata('jid', jid), 10000);
            let n = meta && (meta.name || (meta.thread_metadata && meta.thread_metadata.name));
            if (n && typeof n === 'object') n = n.text;
            if (n) { name = String(n); known = true; }
        } catch (e) {
            console.error('⚠️ Anime news: channel එකේ නම ගන්න බැරි වුණා:', e.message);
        }
    }
    const channel = { jid, name };
    if (known) G.channels[jid] = channel;                    // නම හරියටම ගත්තා නම් විතරක් cache කරනවා
    return channel;
}

// group / chat වලට යන post වල "View channel" button එක යන්න ඕන channel එක:
//   1) config එකේ VIEW_CHANNEL_JID / VIEW_CHANNEL_LINK දීලා නම් ඒක
//   2) නැත්නම් news වැටෙන channel එකම (TARGET_JIDS ඇතුළේ තියෙන පළවෙනි @newsletter JID එක)
async function channelFor(sock) {
    if (VIEW_CHANNEL_JID || VIEW_CHANNEL_LINK) {
        const explicit = await resolveChannel(sock);
        if (explicit) return explicit;
    }
    const jid = targetChannels()[0];
    return jid ? describeChannel(sock, jid) : null;
}

/* ═══════════════ 📤 යවන කොටස (Reply style + View channel + Anti-Ban typing simulation) ═══════════════ */

// "Forwarded" + channel නම + "View channel" button එක හදන contextInfo (channel එකක් නැත්නම් null)
function buildContext(channel) {
    if (!channel) return null;
    return {
        forwardingScore: FORWARD_SCORE,
        isForwarded: true,
        forwardedNewsletterMessageInfo: {
            newsletterJid: channel.jid,
            newsletterName: channel.name,
            serverMessageId: NEWSLETTER_MSG_ID
        }
    };
}

// Reply style: නමක් (QUOTE_NAME) තියෙන contact card එකකට reply කළා වගේ පේන්න
function buildQuoted() {
    const vcard = [
        'BEGIN:VCARD',
        'VERSION:3.0',
        `N:;${QUOTE_NAME};;;`,
        `FN:${QUOTE_NAME}`,
        'item1.TEL;waid=0:0',
        'item1.X-ABLabel:Mobile',
        'END:VCARD'
    ].join('\n');
    return {
        key: {
            fromMe: false,
            participant: '0@s.whatsapp.net',
            remoteJid: 'status@broadcast',
            id: '3EB0' + Math.random().toString(16).slice(2, 18).toUpperCase()
        },
        message: { contactMessage: { displayName: QUOTE_NAME, vcard } }
    };
}

const withCtx = (content, ctx) => (ctx ? Object.assign({}, content, { contextInfo: ctx }) : content);

async function typing(sock, jid, text) {
    try {
        if (isNewsletter(jid)) { await sleep(1500); return; }
        await sock.sendPresenceUpdate('composing', jid);
        await sleep(Math.min(4000, text.length * 20 + 1000));
        await sock.sendPresenceUpdate('paused', jid);
        await sleep(500 + Math.random() * 1000);
    } catch (e) { /* presence error එකකින් post එක නවතින්න ඕන නැහැ */ }
}

// send error එකක් මොන වර්ගයද:
//   'unsure' → timeout වගේ (message එක ගිහින් තියෙන්නත් පුළුවන්) → ආයේ යවන්නේ නැහැ
//   'closed' → connection නැහැ (නොගියා ෂුවර්) → ඊළඟ check එකේදී ආයේ try
//   'build'  → message එක හදද්දී වුණු error එකක් → සරල format එකකින් ආයේ try කරනවා
function classifyError(e) {
    const msg = String((e && e.message) || e || '');
    const code = e && e.output && e.output.statusCode;
    if (code === 408 || /time(d)?[ -]?out|ETIMEDOUT|ECONNRESET|socket hang up|connection lost/i.test(msg)) return 'unsure';
    if (code === 428 || /connection closed|not connected|stream errored/i.test(msg)) return 'closed';
    return 'build';
}

const describeSend = (c, o) => [
    c.image ? 'image' : 'text',
    c.contextInfo && c.contextInfo.forwardedNewsletterMessageInfo ? 'View channel' : '',
    o.quoted ? 'reply' : ''
].filter(Boolean).join(' + ');

// post එක යවනවා: photo + caption, "Forwarded" + channel නම + "View channel" button එක සමඟ.
// අසාර්ථක වුණොත් සරල format වලින් ආයේ try කරනවා. return: 'sent' (ගියා) | 'unsure' (ගියාද කියලා දන්නේ නැහැ) | 'failed' (නොගියා)
async function sendPost(sock, jid, article, caption, channel, quick) {
    // ⚠️ channel (@newsletter) එකටම යවද්දී "Forwarded / View channel" info දැම්මොත් WhatsApp server එක ඒක නිහඬව reject කරනවා
    //    (bot එකට "sent" කියලා පෙනුනත් channel එකට වැටෙන්නේ නැහැ). ඒ නිසා channel එකට යන්නේ සාමාන්‍ය photo + caption post එක.
    //    "Forwarded + View channel" පේන්නේ group / private chat වලට යන post වලට.
    const isChannel = isNewsletter(jid);
    const ctx = isChannel ? null : buildContext(channel);
    const quoted = (isChannel || !QUOTE_ENABLED) ? null : buildQuoted();           // channel එකකට reply card යවන්නේ නැහැ

    const plain = article.image ? { image: article.image, caption } : { text: caption };
    const rich = withCtx(plain, ctx);

    const attempts = [];
    const add = (content, opts) => {
        const sig = [!!content.image, !!content.contextInfo, !!opts.quoted].join('|');
        if (!attempts.some((a) => a.sig === sig)) attempts.push({ sig, content, opts });
    };
    add(rich, quoted ? { quoted } : {});     // 1) photo + Forwarded + View channel (+ reply card)
    if (quoted) add(rich, {});               // 2) reply card නැතුව
    add(plain, {});                          // 3) forward info නැතුව (photo + caption)
    add({ text: caption }, {});              // 4) අන්තිම ආරක්ෂාව: සාමාන්‍ය text

    if (!quick) await typing(sock, jid, caption);            // .aninews වගේ ඉල්ලීමකට උත්තර දෙද්දී (quick) වෙලා ගත කරන්නේ නැහැ

    for (const at of attempts) {
        const label = describeSend(at.content, at.opts);
        try {
            await sock.sendMessage(jid, at.content, at.opts);
            console.log(`✅ Anime news sent → ${jid} (${label})`);
            return 'sent';
        } catch (e) {
            console.error(`⚠️ Send failed (${label}) → ${jid}: ${e.message}`);
            const type = classifyError(e);
            if (type === 'unsure') return 'unsure';
            if (type === 'closed') return 'failed';
        }
    }
    console.error(`❌ Failed to send anime news → ${jid}`);
    return 'failed';
}

/* ═══════════════ 🔍 Feed එක check කරන කොටස ═══════════════ */

function socketReady(sock) {
    try {
        if (!sock || typeof sock.sendMessage !== 'function') return false;
        const ws = sock.ws;
        if (ws) {
            if (typeof ws.isOpen === 'boolean') return ws.isOpen;
            if (typeof ws.readyState === 'number') return ws.readyState === 1;
            if (ws.socket && typeof ws.socket.readyState === 'number') return ws.socket.readyState === 1;
        }
        return true;
    } catch (e) { return true; }
}

const pickSocket = () => Object.values(global.activeSockets || {}).filter(Boolean).find(socketReady) || null;

async function runCheck() {
    if (!config.ANIME_NEWS || !config.ANIME_NEWS.ENABLED) return;
    const targets = (config.ANIME_NEWS.TARGET_JIDS || []).map((j) => String(j || '').trim()).filter(Boolean);
    if (targets.length === 0) return;

    const sock = pickSocket();
    if (!sock) return 'no-socket';                           // bot connect වෙලා නැහැ

    try {
        console.log('🔍 Anime news: checking Anime Corner feed...');
        const feed = await parser.parseURL(FEED_URL);
        const items = (feed.items || []).filter((i) => itemKeys(i).length);

        mergeDisk();                                         // වෙන process එකක් ලියපු දේවල් බලාගන්නවා

        // පළවෙනි run එක: feed එකේ දැනට තියෙන news "යවලා ඉවරයි" කියලා mark කරනවා.
        // (restart වුණාම පරණ news ආයේ යන්නේ නැති වෙන්න — මෙතැන් පටන් අලුත් news විතරක් යනවා)
        if (G.fresh) {
            G.fresh = false;
            const skip = POST_LATEST_ON_FIRST_RUN ? items.slice(MAX_PER_CHECK) : items;
            skip.forEach(markSeen);
            saveState();
            console.log(`📰 Anime news: පළවෙනි run එක — දැනට තියෙන news ${skip.length}ක් skip කළා. මෙතැන් පටන් අලුත් news විතරක් යවනවා.`);
        }

        const unseen = items.filter((i) => !isSeen(i));
        const stale = unseen.filter(isTooOld);
        if (stale.length) {
            stale.forEach(markSeen);
            saveState();
        }

        // පරණම එක මුලින් — chronological order එකෙන් යවන්න
        const pending = unseen.filter((i) => !isTooOld(i)).reverse();
        if (pending.length === 0) return;

        console.log(`📰 Anime news: ${pending.length} new article(s) found.`);

        let handled = 0;
        for (const item of pending) {
            if (handled >= MAX_PER_CHECK) break;
            // යවන්න කලින්ම file එකේ "claim" කරනවා — restart / crash වුණත්, වෙන process එකක් දුවනවා නම් ඒකටත් ආයේ යන්නේ නැහැ
            if (!claim(item)) continue;
            handled++;

            let article;
            try {
                article = await prepareArticle(item);
            } catch (e) {
                giveBack(item, 'article එක හදන්න බැරි වුණා: ' + e.message);
                continue;
            }

            const caption = composePost(article);
            const results = [];
            for (let i = 0; i < targets.length; i++) {
                const jid = targets[i];
                let channel = null;                          // "View channel" යන්න ඕන channel එක (group / chat වලට විතරයි)
                if (!isNewsletter(jid)) {
                    try { channel = await channelFor(sock); } catch (e) { console.error('⚠️ Anime news: channel එක හොයාගන්න බැරි වුණා:', e.message); }
                }
                results.push(await sendPost(sock, jid, article, caption, channel));
                if (i < targets.length - 1) await sleep(2000 + Math.random() * 3000);
            }

            // කිසිම JID එකකට යන්න බැරි වුණොත් (connection නැතිව) ඊළඟ check එකේදී ආයේ try කරන්න
            if (results.every((r) => r === 'failed')) giveBack(item, 'send failed');
        }
    } catch (e) {
        console.error('❌ Anime news check error:', e.message);
    }
}

// check එකක් ඉවර වෙන්න කලින් ඊළඟ එක පටන් ගන්නේ නැහැ
async function checkAnimeNews() {
    if (G.running) return;
    G.running = true;
    try {
        const r = await runCheck();
        if (r === 'no-socket') {
            // bot තාම connect වෙලා නැත්නම් විනාඩියකට පස්සේ ආයේ බලනවා (උපරිම 5 පාරක්)
            G.socketRetries = (G.socketRetries || 0) + 1;
            if (G.socketRetries <= 5) {
                clearTimeout(G.retryTimer);
                G.retryTimer = setTimeout(checkAnimeNews, 60 * 1000);
            } else {
                G.socketRetries = 0;
            }
        } else {
            G.socketRetries = 0;
        }
    } finally { G.running = false; }
}

/* ═══════════════ 💬 ".aninews" command — ඕන වෙලාවක news ගන්න ═══════════════
   .aninews        → අලුත්ම news එක (photo + title + summary — group / chat එකට "Forwarded + View channel" සමඟ)
   .aninews 2      → 2 වෙනි අලුත්ම news එක (1 – 8)
   .aninews list   → අලුත්ම news වල titles
   • bot එකේ command system එකට අත ගහන්නේ නැහැ — socket එකේ messages.upsert event එකට කෙළින්ම සවන් දෙනවා
     (reconnect වෙලා අලුත් socket එකක් හැදුණත් auto හඳුනාගන්නවා)
   • එකම chat එකක command දෙකක් අතර තත්පර 15ක ඉඩක් තියෙනවා; හදපු post එක විනාඩි 30ක් cache වෙනවා (spam / AI API එක බර නොවෙන්න)
   • config.js ANIME_NEWS ඇතුළේ: COMMAND_ENABLED: false | COMMAND: 'aninews' | COMMAND_PREFIX: '.' (හෝ ['.', '!'])   */
const COMMAND_ENABLED  = CFG.COMMAND_ENABLED !== false;
const COMMAND_NAME     = String(opt('COMMAND', 'aninews')).trim().toLowerCase().replace(/[^a-z0-9_]/g, '') || 'aninews';
const toList           = (v) => (Array.isArray(v) ? v : [v]).map((x) => String(x == null ? '' : x).trim()).filter(Boolean);
const COMMAND_PREFIXES = Array.from(new Set(['.'].concat(toList(CFG.COMMAND_PREFIX)))).filter((p) => p.length <= 2);

const CMD_MAX_ITEMS    = 8;                  // .aninews <number> / list වලට feed එකෙන් ගන්න උපරිම news ගණන
const CMD_COOLDOWN_MS  = 15 * 1000;          // එකම chat එකේ command දෙකක් අතර අවම ඉඩ
const CMD_MAX_AGE_SEC  = 90;                 // මීට පරණ command messages (reconnect වෙද්දී ආපු) ignore කරනවා
const CMD_MAX_PARALLEL = 3;                  // එකවර process කරන උපරිම commands ගණන
const FEED_CACHE_MS    = 5 * 60 * 1000;      // feed එක cache කරන කාලය
const POST_CACHE_MS    = 30 * 60 * 1000;     // හදපු post එක cache කරන කාලය (scrape / AI ආයේ ආයේ නොකරන්න)
const POST_CACHE_MAX   = 6;

const CMD_TXT = {
    busy:     '⏳ Still fetching the news, please wait a moment...',
    cooldown: (s) => `⏳ Please wait ${s}s before asking for news again.`,
    none:     '⚠️ Could not load the news right now. Please try again in a few minutes.',
    failed:   '⚠️ Could not send the news. Please try again in a moment.'
};

// ".aninews 2" වගේ text එකකින් { args: '2' } (command එකක් නෙවෙයි නම් null)
function parseCommand(text) {
    const line = String(text || '').trim().split('\n')[0].trim();
    for (const p of COMMAND_PREFIXES) {
        if (!line.startsWith(p)) continue;
        const m = line.slice(p.length).match(/^([a-z0-9_]+)(?:\s+(.*))?$/i);
        if (m && m[1].toLowerCase() === COMMAND_NAME) return { args: (m[2] || '').trim() };
    }
    return null;
}

// message එකේ text එක (ephemeral / view-once wrappers ඇතුළේ තිබුණත්)
function messageText(message) {
    let m = message || {};
    for (let i = 0; i < 4; i++) {
        const inner = m.ephemeralMessage || m.viewOnceMessage || m.viewOnceMessageV2 || m.documentWithCaptionMessage;
        if (!inner || !inner.message) break;
        m = inner.message;
    }
    return m.conversation
        || (m.extendedTextMessage && m.extendedTextMessage.text)
        || (m.imageMessage && m.imageMessage.caption)
        || (m.videoMessage && m.videoMessage.caption)
        || '';
}

const tsToNumber = (ts) => {
    if (ts == null) return 0;
    if (typeof ts === 'object') return typeof ts.toNumber === 'function' ? ts.toNumber() : (Number(ts.low) || 0);
    return Number(ts) || 0;
};

function ago(iso) {
    const t = Date.parse(iso || '');
    if (!t) return '';
    const mins = Math.max(0, Math.round((Date.now() - t) / 60000));
    if (mins < 60) return `${mins}m ago`;
    const hrs = Math.round(mins / 60);
    return hrs < 48 ? `${hrs}h ago` : `${Math.round(hrs / 24)}d ago`;
}

const cmdUsage = (max) => {
    const c = COMMAND_PREFIXES[0] + COMMAND_NAME;
    return [BANNER, DIVIDER, `*${c}* — latest news`, `*${c} 2* — 2nd latest news (1-${max})`, `*${c} list* — latest headlines`].join('\n');
};

const cmdList = (items) => {
    const c = COMMAND_PREFIXES[0] + COMMAND_NAME;
    const rows = items.map((it, i) => {
        const a = ago(it.isoDate || it.pubDate);
        return `*${i + 1}.* ${String(it.title || '').replace(/\*/g, '').trim()}${a ? ` _(${a})_` : ''}`;
    });
    return [BANNER, DIVIDER, rows.join('\n\n'), DIVIDER, `Send *${c} <number>* to read one — e.g. *${c} 2*`].join('\n');
};

// feed එකේ අලුත්ම news (විනාඩි 5ක් cache වෙනවා; අලුත් එක ගන්න බැරි වුණොත් කලින් එක)
async function getFeedItems() {
    const c = G.feedCache;
    if (c && Date.now() - c.at < FEED_CACHE_MS) return c.items;
    if (G.feedLoading) return G.feedLoading;                 // එකම වෙලාවේ කීදෙනෙක් ඉල්ලුවත් feed එක ගන්නේ එක පාරයි

    const job = (async () => {
        try {
            const feed = await parser.parseURL(FEED_URL);
            const items = (feed.items || []).filter((i) => i && i.title && i.link).slice(0, CMD_MAX_ITEMS);
            G.feedCache = { at: Date.now(), items };
            return items;
        } catch (e) {
            if (c) return c.items;
            throw e;
        }
    })();
    G.feedLoading = job;
    const done = () => { if (G.feedLoading === job) G.feedLoading = null; };
    job.then(done, done);
    return job;
}

// news එකක post එක (photo + summary) හදනවා — cache කරනවා, එකම වෙලාවේ දෙන්නෙක් ඉල්ලුවොත් එක පාරයි හදන්නේ
async function getPrepared(item) {
    G.prepared = G.prepared || new Map();
    G.preparing = G.preparing || new Map();
    const key = itemKeys(item)[0];

    const hit = G.prepared.get(key);
    if (hit && Date.now() - hit.at < POST_CACHE_MS) return hit;
    if (G.preparing.has(key)) return G.preparing.get(key);

    const job = (async () => {
        const article = await prepareArticle(item);
        const entry = { at: Date.now(), article, caption: composePost(article) };
        G.prepared.set(key, entry);
        while (G.prepared.size > POST_CACHE_MAX) G.prepared.delete(G.prepared.keys().next().value);
        return entry;
    })();
    G.preparing.set(key, job);
    try { return await job; } finally { G.preparing.delete(key); }
}

const replyText = (sock, msg, text) => sock.sendMessage(msg.key.remoteJid, { text }, { quoted: msg });

async function react(sock, msg, text) {
    try { await sock.sendMessage(msg.key.remoteJid, { react: { text, key: msg.key } }); } catch (e) { /* reaction එක නැතුවත් කමක් නැහැ */ }
}

async function handleCommand(sock, msg) {
    if (!msg || !msg.key || !msg.message) return;
    const chat = msg.key.remoteJid;
    if (!chat || /@(newsletter|broadcast)$/.test(chat)) return;          // channel / status වල commands නැහැ

    const cmd = parseCommand(messageText(msg.message));
    if (!cmd) return;

    const ts = tsToNumber(msg.messageTimestamp);
    if (ts && Math.abs(Date.now() / 1000 - ts) > CMD_MAX_AGE_SEC) return; // reconnect වෙද්දී ආපු පරණ command

    // එකම message එක socket කීපයකට ආවොත් (group එකක bot sessions කීපයක්) එක පාරයි handle කරන්නේ
    G.cmdSeen = G.cmdSeen || new Map();
    const dup = chat + '|' + msg.key.id;
    if (G.cmdSeen.has(dup)) return;
    G.cmdSeen.set(dup, Date.now());
    if (G.cmdSeen.size > 300) {
        const cutoff = Date.now() - 5 * 60 * 1000;
        G.cmdSeen.forEach((t, k) => { if (t < cutoff) G.cmdSeen.delete(k); });
    }

    G.cmdBusy = G.cmdBusy || new Set();
    G.cmdLast = G.cmdLast || new Map();
    G.cmdWarn = G.cmdWarn || new Map();
    const warn = async (text) => {                                       // එකම warning එක දිගටම යවන්නේ නැහැ
        if (Date.now() - (G.cmdWarn.get(chat) || 0) < 8000) return;
        G.cmdWarn.set(chat, Date.now());
        await replyText(sock, msg, text).catch(() => {});
    };

    if (G.cmdBusy.has(chat) || G.cmdBusy.size >= CMD_MAX_PARALLEL) return warn(CMD_TXT.busy);
    const wait = CMD_COOLDOWN_MS - (Date.now() - (G.cmdLast.get(chat) || 0));
    if (wait > 0) return warn(CMD_TXT.cooldown(Math.ceil(wait / 1000)));

    G.cmdBusy.add(chat);
    react(sock, msg, '⏳');
    try {
        let items = null;
        try { items = await getFeedItems(); } catch (e) { console.error('⚠️ Anime news command: feed එක ගන්න බැරි වුණා:', e.message); }
        if (!items || !items.length) { await replyText(sock, msg, CMD_TXT.none); return; }

        const args = cmd.args.toLowerCase();
        if (/^(list|ls|all)$/.test(args)) { await replyText(sock, msg, cmdList(items)); return; }

        const index = args === '' ? 1 : (/^\d{1,2}$/.test(args) ? parseInt(args, 10) : 0);
        if (index < 1 || index > items.length) { await replyText(sock, msg, cmdUsage(items.length)); return; }

        console.log(`💬 Anime news command → ${chat} (#${index})`);
        const { article, caption } = await getPrepared(items[index - 1]);

        let channel = null;                                              // "View channel" යන්න ඕන channel එක
        try { channel = await channelFor(sock); } catch (e) { console.error('⚠️ Anime news: channel එක හොයාගන්න බැරි වුණා:', e.message); }

        const r = await sendPost(sock, chat, article, caption, channel, true);
        if (r === 'failed') await replyText(sock, msg, CMD_TXT.failed);
    } catch (e) {
        console.error('⚠️ Anime news command error:', e.message);
        await replyText(sock, msg, CMD_TXT.failed).catch(() => {});
    } finally {
        G.cmdBusy.delete(chat);
        G.cmdLast.set(chat, Date.now());
        react(sock, msg, '');                                            // ⏳ reaction එක අයින් කරනවා
    }
}

function onUpsert(sock, upsert) {
    if (!COMMAND_ENABLED || !upsert || !Array.isArray(upsert.messages)) return;
    if (upsert.type !== 'notify' && upsert.type !== 'append') return;     // 'append' = ඔයා phone එකෙන්ම type කළ message
    upsert.messages.forEach((msg) => {
        handleCommand(sock, msg).catch((e) => console.error('⚠️ Anime news command error:', e.message));
    });
}

// active sockets වලට (reconnect වෙලා හැදෙන අලුත් ඒවටත්) එක පාරක් විතරක් සවන් දෙනවා
function attachCommandListeners() {
    G.attached = G.attached || new WeakSet();
    Object.values(global.activeSockets || {}).filter(Boolean).forEach((sock) => {
        try {
            if (!sock.ev || typeof sock.ev.on !== 'function' || G.attached.has(sock)) return;
            G.attached.add(sock);
            sock.ev.on('messages.upsert', (u) => { if (G.handleUpsert) G.handleUpsert(sock, u); });
        } catch (e) {
            console.error('⚠️ Anime news command: socket එකට සවන් දෙන්න බැරි වුණා:', e.message);
        }
    });
}

clearInterval(G.cmdAttachTimer);
if (COMMAND_ENABLED) {
    G.handleUpsert = onUpsert;                                           // plugin එක reload වුණාම දැනට සවන් දෙන sockets අලුත් code එකට මාරු වෙනවා
    G.cmdAttachTimer = setInterval(attachCommandListeners, 5000);
    if (G.cmdAttachTimer.unref) G.cmdAttachTimer.unref();
    attachCommandListeners();
    console.log(`💬 Anime news command ready: ${COMMAND_PREFIXES.map((p) => p + COMMAND_NAME).join(' | ')}  (list | <number>)`);
} else {
    G.handleUpsert = null;
}

if (config.ANIME_NEWS && config.ANIME_NEWS.ENABLED) {
    // plugin එක reload / reconnect වෙලා දෙපාරක් load වුණත් timer එකක් විතරක් දුවන්න
    clearTimeout(G.startTimer);
    clearTimeout(G.retryTimer);
    clearInterval(G.timer);

    const intervalMs = (config.ANIME_NEWS.INTERVAL_MINUTES || 30) * 60 * 1000;
    G.startTimer = setTimeout(() => {
        checkAnimeNews();
        G.timer = setInterval(checkAnimeNews, intervalMs);
    }, START_DELAY_SEC * 1000);

    console.log('📰 Anime News Auto-Poster loaded. Interval:', config.ANIME_NEWS.INTERVAL_MINUTES, 'min | post: forwarded photo + summary',
        '| reply:', QUOTE_ENABLED ? QUOTE_NAME : 'off', '| AI summary:', SUMMARY_ENABLED ? SUMMARY_LANG : 'off');
    if (VIEW_CHANNEL_JID && !CHANNEL_OK) console.log('⚠️ Anime news: VIEW_CHANNEL_JID එක "@newsletter" වලින් ඉවර වෙන්න ඕන — ඒක පාවිච්චි කරන්නේ නැහැ.');
    if (!(CHANNEL_OK || VIEW_CHANNEL_LINK || targetChannels().length)) {
        console.log('ℹ️ Anime news: "View channel" button එක වැටෙන්නේ නැහැ — TARGET_JIDS ඇතුළේ channel (@newsletter) එකක් හෝ VIEW_CHANNEL_JID / VIEW_CHANNEL_LINK දාන්න.');
    }
}
