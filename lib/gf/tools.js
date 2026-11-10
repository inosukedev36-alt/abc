'use strict';
/**
 * lib/gf/tools.js — everything she can DO, and how she understands a request for it.
 *
 *   TOOLS   one entry per bot command: what it needs, who may ask, whether she must confirm first
 *   route() local (no AI call) understanding of Sinhala / Singlish / English requests
 *   parseMarker() fallback: the AI may append "@@tool arg@@" for SAFE tools only
 *
 * The router never decides *permission*. exec.js does that, using the real rights of the sender.
 *
 * TOOLS is LIVE: lib/gf/registry.js adds an entry for every new plugin that has a `use:` line (or a `gf:` block) in its
 * cmd({...}), so a new command needs no edit in this file. Entries added that way carry `auto: true`.
 */
const { norm } = require('./profile');

// ───────────────────────────── tool table
//  arg:   none | url | text | number | target (mention / reply / number) | onoff
//  req:   the argument is required       quoted: needs a replied-to message
//  group: only inside a group            perm: any | group-admin | owner
//  confirm: she asks "are you sure?" first      marker: the AI fallback may trigger it
const T = (desc, o = {}) => ({ desc, arg: 'none', perm: 'any', ...o });
const TOOLS = {
    // — downloads & media
    plinks:     T('list every video link of a YouTube playlist (needs the playlist url)', { arg: 'url', req: 1, marker: 1 }),
    ytaudl:     T('download a YouTube video or playlist as audio (needs the url)', { arg: 'url', req: 1, marker: 1 }),
    ig:         T('download an Instagram reel/post (needs the url)', { arg: 'url', req: 1, marker: 1 }),
    sticker:    T('make a sticker from the image/video he replied to', { quoted: 1, marker: 1 }),
    toimg:      T('turn the sticker he replied to into a picture', { quoted: 1, marker: 1 }),
    vv:         T('open the view-once photo/video he replied to', { quoted: 1, marker: 1 }),
    posters:    T('movie or series posters (needs the title)', { arg: 'text', req: 1, marker: 1 }),
    todayanime: T("today's airing anime schedule", { marker: 1 }),
    bancheck:   T('check whether a WhatsApp number is banned (needs the number)', { arg: 'number', req: 1, marker: 1 }),
    chfd:       T('forward a channel post several times (url count seconds)', { arg: 'text', req: 1 }),
    // — info
    ping:       T('bot speed', { marker: 1 }),
    runtime:    T('how long the bot has been running', { marker: 1 }),
    owner:      T('owner contact', { marker: 1 }),
    menu2:      T('what she can do (she answers herself)', { special: 'help' }),
    // — group (she only does these inside a group, for people who really are admins)
    promote:    T('make a member admin', { group: 1, perm: 'group-admin', arg: 'target', req: 1, confirm: 1 }),
    demote:     T('remove admin rights from a member', { group: 1, perm: 'group-admin', arg: 'target', req: 1, confirm: 1 }),
    remove:     T('remove a member from the group', { group: 1, perm: 'group-admin', arg: 'target', req: 1, confirm: 1 }),
    add:        T('add a number to the group', { group: 1, perm: 'group-admin', arg: 'number', req: 1, confirm: 1 }),
    tagall:     T('mention every member', { group: 1, perm: 'group-admin', arg: 'text' }),
    hidetag:    T('mention everyone invisibly', { group: 1, perm: 'group-admin', arg: 'text' }),
    mute:       T('close the group so only admins can write', { group: 1, perm: 'group-admin', confirm: 1 }),
    unmute:     T('open the group for everyone', { group: 1, perm: 'group-admin' }),
    setwelcome: T('set the group welcome message', { group: 1, perm: 'group-admin', arg: 'text', req: 1 }),
    setgoodbye: T('set the group goodbye message', { group: 1, perm: 'group-admin', arg: 'text', req: 1 }),
    getpic:     T('send the group picture', { group: 1 }),
    antispam:   T('anti-spam on/off', { group: 1, perm: 'group-admin', arg: 'onoff', req: 1 }),
    antibot:    T('anti-bot on/off', { group: 1, perm: 'group-admin', arg: 'onoff', req: 1 }),
    devicecheck:T('which device sent the replied message', { group: 1, quoted: 1 }),
    // — owner only
    addsudo:    T('give someone sudo rights', { perm: 'owner', arg: 'target', req: 1, confirm: 1 }),
    delsudo:    T('take sudo rights away', { perm: 'owner', arg: 'target', req: 1, confirm: 1 }),
    hack:       T('prank "hacking" animation', { perm: 'owner' }),
    antidelete: T('anti-delete on/off', { perm: 'owner', arg: 'onoff', req: 1 }),
};

/** aliases people use → the real pattern name */
const ALIAS = {
    ytpl: 'plinks', playlistlinks: 'plinks', igdl: 'ig', instagram: 'ig', s: 'sticker', stic: 'sticker', toimage: 'toimg',
    poster: 'posters', animetoday: 'todayanime', calendar: 'todayanime', checkban: 'bancheck', wacheck: 'bancheck', isban: 'bancheck',
    uptime: 'runtime', creator: 'owner', admin: 'owner', menu: 'menu2', allmenu: 'menu2', fullmenu: 'menu2', kick: 'remove',
    lock: 'mute', groupclose: 'mute', unlock: 'unmute', groupopen: 'unmute', antidel: 'antidelete', ad: 'antidelete',
    retrive: 'vv', retrieve: 'vv',
};
const canon = (name) => { name = String(name || '').toLowerCase(); return TOOLS[name] ? name : (ALIAS[name] && TOOLS[ALIAS[name]] ? ALIAS[name] : null); };

// ───────────────────────────── text helpers
const URL_RE = /(?:https?:\/\/|www\.)[^\s<>"')\]]+|(?:youtu\.be|youtube\.com|instagram\.com)\/[^\s<>"')\]]+/gi;
const urlsOf = (s) => (String(s || '').match(URL_RE) || []).map(u => (/^https?:\/\//i.test(u) ? u : 'https://' + u).replace(/[.,!?]+$/, ''));
const isYtPlaylist = (u) => /[?&]list=[\w-]+/i.test(u) || /youtube\.com\/playlist/i.test(u);
const isYtVideo = (u) => /(youtu\.be\/|youtube\.com\/(watch|shorts|live)|music\.youtube\.com)/i.test(u);
const isIg = (u) => /instagram\.com\/(reel|reels|p|tv)\//i.test(u);
const isWaChannel = (u) => /whatsapp\.com\/channel\//i.test(u);

const AUDIO_RE = /\b(audio|mp3|m4a|song|songs|music|sound)\b|ගීත|සින්දු|සිංදු|ඕඩියෝ|ඔඩියෝ|ඕඩියො|sindu|sinduwa/i;
const DL_RE = /\b(download|dl|save|convert)\b|ඩවුන්ලෝඩ්|ඩවුන්ලෝඩ|බාගත|downlod|dawunlod/i;
const REQUEST_RE = /\b(please|pls|plz|can you|could you|will you|would you|help|want|need|show|give|send|get|find|make|convert|download|kick|remove|ban|add|tag|mute|unmute|open|close|check|set|turn|put)\b|ඕනේ|ඕන\b|එවන්න|දෙන්න|දීපන්|දෙනවද|බලන්න|බලපන්|හදන්න|හදපන්|කරන්න|කරපන්|කරලා|ගන්න|අරන්|දාන්න|දාපන්|අයින්|පෙන්නන්න|එකතු|හොයන්න|හොයලා|ඇරෙන්න|වහන්න|\b(denna|dennako|ewanna|ewapan|balanna|hadanna|karanna|karapan|ganna|danna|oni|ona|one|pls)\b/i;

const lastNumber = (s) => { const m = String(s).replace(/[\s\-()]/g, '').match(/\+?\d{9,15}/g); if (!m) return ''; let n = m[m.length - 1].replace('+', ''); if (n.length === 10 && n[0] === '0') n = '94' + n.slice(1); return n; };

const FILLER = /(?:^|\s)(?:please|pls|plz|can|could|you|me|my|for|of|the|a|an|to|get|give|send|find|show|download|search|want|need|i|movie|film|series|tv|show|serieses|poster|posters|එකේ|ගේ|එක|ඕනේ|ඕන|දෙන්න|දීපන්|එවන්න|හොයන්න|ගන්න|අරන්|බලන්න|ටික|කියලා|වගේ|එකක්|පෝස්ටර්|පෝස්ටර්ස්|පෝස්ටරය|පෝස්ටරයක්|පෝස්ටර|denna|ewanna|oni|one)(?=\s|$|[.,!?])/gi;
const cleanText = (s) => norm(String(s).replace(URL_RE, ' ').replace(FILLER, ' ').replace(FILLER, ' ').replace(/[^\p{L}\p{M}\p{N}\s:'’&.-]/gu, ' ')).replace(/^[\s:.-]+|[\s:.-]+$/g, '');
const afterColon = (raw) => { const i = raw.indexOf(':'); return i >= 0 ? norm(raw.slice(i + 1)) : ''; };
const onoffOf = (t) => /\b(off|disable|deactivate|stop)\b|අක්‍රීය|අක්රීය|ඕෆ්|නවත්වන්න|වසන්න/i.test(t) ? 'off' : (/\b(on|enable|activate|start)\b|සක්‍රීය|සක්රීය|ඔන්|ඇරෙන්න|දාන්න/i.test(t) ? 'on' : '');

// ───────────────────────────── plugins that registered themselves (see registry.js)
const autoTools = () => Object.entries(TOOLS).filter(([, m]) => m.auto);

/** the argument for a self-registered tool, from the part of the message that is left after its trigger */
function autoArg(meta, text, quotedText, via) {
    if (typeof meta.extract === 'function') {                      // gf: { extract(text, { urls, quotedText }) } wins
        try { const r = meta.extract(text, { urls: urlsOf(text + ' ' + quotedText), quotedText }); if (typeof r === 'string') return r; } catch (_) { /* fall back to the default */ }
    }
    switch (meta.arg) {
        case 'url': return urlsOf(text + ' ' + quotedText)[0] || '';
        case 'number': case 'target': return lastNumber(text);
        case 'onoff': return onoffOf(text);
        case 'text': return via === 'name' ? norm(text) : cleanText(text);
        case 'raw': return norm(text);
        default: return '';
    }
}

/** "weather colombo" — the command's own name (or an alias of 3+ letters) as the first word */
function routeAutoName({ raw, words, quotedText, isGroup, out }) {
    const first = words[0].replace(/[^\p{L}\p{N}]/gu, '');
    for (const [name, meta] of autoTools()) {
        if ((meta.group && !isGroup) || !(meta.triggers || []).includes(first)) continue;
        if (meta.arg === 'none' && words.length > 3) continue;       // a sentence that merely starts with "joke" is not a command
        const rest = norm(raw.slice(raw.toLowerCase().indexOf(words[0]) + words[0].length));
        return out(name, autoArg(meta, rest, quotedText, 'name'), 'auto-name');
    }
    return null;
}

/** words the plugin author listed in gf: { keywords: [...] } (lowest priority: built-in rules win) */
function routeAutoKeywords({ raw, t, quotedText, isGroup, request, out }) {
    if (!request) return null;
    for (const [name, meta] of autoTools()) {
        if (!meta.keywords || (meta.group && !isGroup) || !meta.keywords.test(t)) continue;
        return out(name, autoArg(meta, raw.replace(new RegExp(meta.keywords.source, 'giu'), ' '), quotedText, 'keyword'), 'auto-keyword');
    }
    return null;
}

// ───────────────────────────── the router
/** shape a route and work out what (if anything) she still has to ask for */
function buildRoute(tool, arg = '', via = 'keyword', { mentions = [], hasQuoted = false } = {}) {
    const meta = TOOLS[tool];
    let missing = null;
    if (meta.req) {
        if (meta.arg === 'url' && !/https?:\/\//i.test(arg)) missing = 'url';
        else if ((meta.arg === 'text' || meta.arg === 'raw') && !arg) missing = 'text';
        else if (meta.arg === 'number' && !/\d{8,}/.test(arg)) missing = 'number';
        else if (meta.arg === 'onoff' && !/^(on|off)/.test(arg)) missing = 'onoff';
        else if (meta.arg === 'target' && !mentions.length && !hasQuoted && !/\d{8,}/.test(arg)) missing = 'target';
    }
    if (!missing && meta.quoted && !hasQuoted) missing = 'reply';
    return { tool, arg, missing, via };
}

/**
 * @returns null | { tool, arg, missing, via }
 *   missing: 'url' | 'text' | 'number' | 'target' | 'reply' | 'onoff' — what she must still ask for
 */
function route(input) {
    const { text, quotedText = '', quotedType = '', hasQuoted = false, mentions = [], isGroup = false } = input;
    const raw = norm(text);
    if (!raw) return null;
    const t = raw.toLowerCase();
    const urls = urlsOf(raw);
    const qurls = urlsOf(quotedText);
    const allUrls = [...urls, ...qurls];
    const words = t.split(/\s+/).filter(Boolean);
    const request = REQUEST_RE.test(t) || words.length <= 5 || urls.length > 0;
    const out = (tool, arg = '', via = 'keyword') => buildRoute(tool, arg, via, { mentions, hasQuoted });

    // 0) a plugin that registered itself: its own name as the first word  ("weather colombo")
    const byName = routeAutoName({ raw, words, quotedText, isGroup, out });
    if (byName) return byName;

    // 1) she was addressed with a command word but no prefix:  "ytpl https://…"
    const first = words[0].replace(/[^\p{L}\p{N}]/gu, '');
    const SAFE_WORD = ['ytpl', 'plinks', 'playlistlinks', 'ytaudl', 'sticker', 'toimg', 'poster', 'posters', 'todayanime', 'bancheck', 'ig', 'igdl', 'vv', 'tagall', 'hidetag', 'ping', 'runtime', 'uptime'];
    if (SAFE_WORD.includes(first) && (words.length > 1 || ['ping', 'runtime', 'uptime', 'sticker', 'toimg', 'vv', 'todayanime', 'tagall', 'hidetag'].includes(first))) {
        const tool = canon(first);
        if (tool && !(TOOLS[tool].group && !isGroup)) {
            const rest = norm(raw.slice(raw.toLowerCase().indexOf(words[0]) + words[0].length));
            const arg = TOOLS[tool].arg === 'url' ? (urlsOf(rest + ' ' + quotedText)[0] || '')
                : TOOLS[tool].arg === 'number' ? lastNumber(rest)
                : tool === 'posters' ? cleanText(rest)          // "poster එකක් ඕනේ" → no title yet, she will ask
                : rest;
            return out(tool, arg, 'word');
        }
    }

    // 2) links
    if (allUrls.length) {
        const u = allUrls[0];
        if (isYtPlaylist(u)) {
            if (AUDIO_RE.test(t) || (DL_RE.test(t) && /audio|mp3|ගීත|සින්දු|සිංදු/i.test(t))) return out('ytaudl', u, 'url');
            return out('plinks', u, 'url');                                   // "playlist url" → the links (her main job)
        }
        if (isYtVideo(u) && (AUDIO_RE.test(t) || DL_RE.test(t))) return out('ytaudl', u, 'url');
        if (isIg(u)) return out('ig', u, 'url');
        if (isWaChannel(u) && /forward|chfd|ෆෝවර්ඩ්|forward කරන්න/i.test(t)) {
            const nums = raw.replace(URL_RE, ' ').match(/\d+/g) || [];
            return out('chfd', `${u} ${nums[0] || 1} ${nums[1] || 5}`, 'url');
        }
    }

    // 3) a keyword but no link yet
    const noun = {
        playlist: /playlist|play list|ytpl|ප්ලේ\s?ලිස්ට්|ප්ලේලිස්ට්|පේලිස්ට්|ප්ලේ ලිස්ට්/i.test(t),
        ytAudio: DL_RE.test(t) && AUDIO_RE.test(t) && /youtube|yt\b|යූටියුබ්|යූ ටියුබ්/i.test(t),
        igAsk: /instagram|insta\b|reel|ඉන්ස්ටා|රීල්/i.test(t) && DL_RE.test(t),
    };
    if (request && noun.playlist) return out('plinks', '', 'keyword');
    if (request && noun.ytAudio) return out('ytaudl', '', 'keyword');
    if (request && noun.igAsk) return out('ig', '', 'keyword');

    // 4) media conversions need a replied-to message
    const sticker = /sticker|ස්ටිකර්|ස්ටිකර|stikar|stiker/i.test(t);
    const toImage = /to ?img|to ?image|\b(photo|image|pic|picture)\b|ෆොටෝ|පින්තූර|ඡායාරූප|photo එක|image එක/i.test(t);
    if (request && sticker && (hasQuoted || /make|හදන්න|කරන්න|කරපන්|හදපන්|convert/i.test(t))) {
        return out(quotedType === 'stickerMessage' && toImage ? 'toimg' : quotedType === 'stickerMessage' ? 'toimg' : 'sticker', '', 'keyword');
    }
    if (request && toImage && quotedType === 'stickerMessage') return out('toimg', '', 'keyword');
    if (request && /view ?once|\bvv\b|එක් වරක්|එක පාරක්|reveal|unlock (it|this)|බලන්න (දෙන්න|ඕනේ)/i.test(t) && (hasQuoted || /view ?once|\bvv\b/i.test(t))) return out('vv', '', 'keyword');

    // 5) info & fun
    if (request && /poster|පෝස්ටර්|පෝස්ටර|posters/i.test(t)) return out('posters', cleanText(raw), 'keyword');
    if (request && /anime|ඇනිමේ|ඇනිමෙ|ඇනිමෙ/i.test(t) && /today|අද|calendar|schedule|airing|episode|new|එපිසෝඩ්|එපිසෝඩ|විකාශ/i.test(t)) return out('todayanime', '', 'keyword');
    if (request && /ban\s?check|banned|ban (වෙලාද|ද\b|වෙලා)|is .*banned|ban වෙලාද/i.test(t) && lastNumber(raw)) return out('bancheck', lastNumber(raw), 'keyword');
    if (/(^|\s)ping(\s|$|\?|!)|ping එක|වේගය|speed test/i.test(t) && words.length <= 6) return out('ping', '', 'keyword');
    if (/\b(uptime|runtime)\b|how long (have you|are you)[^.?]*(on|online|running|awake)|කොච්චර (වෙලා|කාලයක්)[^.?]*(online|ඔන්ලයින්|ඉන්නේ)/i.test(t)) return out('runtime', '', 'keyword');
    if (request && /\b(owner|creator|developer)\b|හිමිකරු|හැදුවේ කවුද|හදපු කෙනා|owner (කවුද|ගේ|ගෙ|ව)/i.test(t)) return out('owner', '', 'keyword');
    if (/\b(menu|commands?|help)\b|ඔයාට මොනවද කරන්න|මොනවද කරන්න පුළුවන්|මොනවා කරන්න පුළුවන්|what can you do|what do you do for me|mona wada karanna/i.test(t) && words.length <= 9) return out('menu2', '', 'keyword');

    // 6) group management — only inside groups, always needs a clear verb
    if (isGroup) {
        const num = lastNumber(raw);
        const target = mentions.length || hasQuoted || num ? 'x' : '';
        const withTarget = (tool) => out(tool, num, 'keyword');
        if (/\bdemote\b|remove (his|her|their|the)? ?admin|admin (අයින්|ඉවත්)|ඇඩ්මින් (අයින්|ඉවත්)|admin eka ayin/i.test(t)) return withTarget('demote');
        if (/\bpromote\b|make [^.]{0,30}\badmin\b|admin (කරන්න|කරපන්|දෙන්න|දීපන්)|ඇඩ්මින් (කරන්න|දෙන්න)|admin hadanna/i.test(t)) return withTarget('promote');
        if (/\b(kick|remove|ban|throw out|kick out)\b|අයින් කරන්න|අයින් කරපන්|ඉවත් කරන්න|එලවන්න|එළවන්න|පන්නන්න|ayin karanna|elawanna/i.test(t) && target) return withTarget('remove');
        if (/\badd\b|එකතු කරන්න|group එකට (දාන්න|ගන්න)|ගෲප් එකට (දාන්න|ගන්න)|ekathu karanna/i.test(t) && num) return withTarget('add');
        if (/hide\s?tag|hidden tag|secretly tag|silent tag|නොපෙනෙන|සැඟවුණු/i.test(t)) return out('hidetag', afterColon(raw), 'keyword');
        if (/tag\s?all|tag everyone|mention (everyone|all)|හැමෝම|හැමෝවම|හැමෝටම|හැමොම|ඔක්කොමල|සියල්ලෝම/i.test(t) && /tag|mention|කියන්න|කතා|call|ඇහෙන්න|ටැග්/i.test(t)) return out('tagall', afterColon(raw), 'keyword');
        if (/\b(unmute|unlock|open)\b[^.?]*\b(group|chat)\b|(group|ගෲප්|ග්‍රෲප්|ග්‍රූප්|ගෘප්) (එක )?(open|අරින්න|ඇරපන්|unmute|unlock|ඇරෙන්න)/i.test(t)) return out('unmute', '', 'keyword');
        if (/\b(mute|silence|lock|close)\b[^.?]*\b(group|chat)\b|(group|ගෲප්|ග්‍රෲප්|ග්‍රූප්|ගෘප්) (එක )?(close|වහන්න|වහපන්|mute|lock)/i.test(t)) return out('mute', '', 'keyword');
        if (/welcome\s?(msg|message)|සාදරයෙන් පිළිගන්න/i.test(t)) return out('setwelcome', afterColon(raw), 'keyword');
        if (/good ?bye\s?(msg|message)/i.test(t)) return out('setgoodbye', afterColon(raw), 'keyword');
        if (/(group|ගෲප්|ග්‍රෲප්|ග්‍රූප්|ගෘප්)[^.?]{0,20}(pic|photo|dp|image|picture|පින්තූරය|ෆොටෝ)|group (pic|dp)/i.test(t)) return out('getpic', '', 'keyword');
        if (/anti\s?spam/i.test(t)) return out('antispam', onoffOf(t), 'keyword');
        if (/anti\s?bot/i.test(t)) return out('antibot', onoffOf(t), 'keyword');
        if (/device\s?check|which device|මොන device/i.test(t)) return out('devicecheck', '', 'keyword');
    }

    // 7) owner tools (only the owner can actually use them — exec.js enforces it)
    if (/sudo/i.test(t) && request) {
        if (/\b(remove|del|delete|take|revoke)\b|අයින්|ඉවත්/i.test(t)) return out('delsudo', lastNumber(raw), 'keyword');
        if (/\b(add|give|make|grant)\b|දාන්න|දෙන්න|එකතු/i.test(t)) return out('addsudo', lastNumber(raw), 'keyword');
    }
    if (/\bhack\b/i.test(t) && request && words.length <= 6) return out('hack', '', 'keyword');
    if (/anti\s?delete/i.test(t) && request) return out('antidelete', onoffOf(t) || (/status/i.test(t) ? 'status' : ''), 'keyword');

    // 8) keywords that the author of a new plugin declared
    return routeAutoKeywords({ raw, t, quotedText, isGroup, request, out });
}

// ───────────────────────────── AI fallback marker  "@@plinks https://…@@"
const MARKER_RE = /@@\s*([a-z0-9]+)\s*([^@]*?)\s*@@/gi;
function parseMarker(reply) {
    let cmd = null;
    const clean = String(reply || '').replace(MARKER_RE, (_, name, arg) => { if (!cmd) cmd = { name: name.toLowerCase(), arg: norm(arg) }; return ' '; }).replace(/\s+/g, ' ').trim();
    return { clean, cmd };
}
/** only SAFE, read-only tools may be triggered by the AI's own guess; the url must really be in HIS message */
function validateMarker(cmd, { text = '', quotedText = '' } = {}) {
    if (!cmd) return null;
    const tool = canon(cmd.name);
    const meta = tool && TOOLS[tool];
    if (!meta || !meta.marker) return null;
    let arg = cmd.arg || '';
    if (meta.arg === 'url') { const u = urlsOf(arg)[0]; if (!u || !urlsOf(text + ' ' + quotedText).includes(u)) return null; arg = u; }
    else if (meta.arg === 'number') { arg = lastNumber(arg); }
    else if (meta.arg === 'text') { arg = cleanText(arg).slice(0, 80); }
    else arg = '';
    return { tool, arg };
}
/**
 * one compact English line for the prompt (the AI endpoint is a GET url, so every character counts).
 * Built-in tools are always listed (names only); tools added by plugins come with their short hint and are cut when the line
 * would grow beyond maxChars.
 */
function markerPrompt(maxChars = 600) {
    const head = 'If he clearly asks you to DO one of these: ';
    const tail = ', begin your reply with @@tool arg@@ (arg = the url/title/number from his message), then answer in character as usual.';
    const items = []; let used = head.length + tail.length;
    for (const [k, m] of Object.entries(TOOLS)) {
        if (!m.marker) continue;
        const inner = (m.arg !== 'none' ? m.arg : '') + (m.hint ? (m.arg !== 'none' ? ': ' : '') + m.hint : '');
        const item = inner ? `${k}(${inner})` : k;
        if (m.auto && used + item.length + 2 > maxChars) continue;
        items.push(item); used += item.length + 2;
    }
    return head + items.join(', ') + tail;
}

module.exports = { TOOLS, ALIAS, canon, route, buildRoute, cleanText, onoffOf, autoTools, urlsOf, lastNumber, parseMarker, validateMarker, markerPrompt, isYtPlaylist, isYtVideo, isIg, REQUEST_RE };
