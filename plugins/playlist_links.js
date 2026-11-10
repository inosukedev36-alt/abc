/**
 * ───────────────────────────────────────────────────────────────
 *  YouTube Playlist Links — WhatsApp bot command  (no npm install needed)
 * ───────────────────────────────────────────────────────────────
 *  Command : .plinks <youtube playlist link>
 *  Aliases : .ytpl  .playlistlinks
 *  Needs   : nothing extra — only Node's built-in modules (https, zlib)
 *  Place   : your bot's plugins/ folder (next to your other commands)
 *  Output  : English
 * ───────────────────────────────────────────────────────────────
 */

const https = require('https');
const zlib = require('zlib');
const { cmd } = require('../command'); // ← change this path if your bot's command.js is somewhere else

// ─────────────── settings (edit freely) ───────────────
const PREFIX_HINT       = '.';   // only used for the example shown in the "usage" message
const MAX_VIDEOS        = 1000;  // never fetch more than this many videos from one playlist
const CHAT_LIST_LIMIT   = 100;   // up to this many videos are listed in chat; above it a .txt file is sent instead
const CHUNK_SIZE        = 3500;  // max characters per chat message
const TITLE_MAX         = 70;    // long video titles are shortened in the chat list
const DELAY_MS          = 800;   // short pause between messages (helps avoid WhatsApp spam limits)
const SHOW_ERROR_REASON = true;  // show the technical reason when a playlist can't be fetched (set false for a public bot)

// ─────────────── small helpers ───────────────
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// cut by characters (not UTF-16 units) so emojis are never split in half
const cut = (text, max) => Array.from(text).slice(0, max).join('');
const shorten = (text, max) => (Array.from(text).length > max ? `${cut(text, max - 1)}…` : text);

// collapse whitespace, fall back to a default when empty
const clean = (value, fallback = '') => String(value ?? '').replace(/\s+/g, ' ').trim() || fallback;

const safeFileName = (name) =>
    cut(name.replace(/[\\/:*?"<>|\x00-\x1f]+/g, '').replace(/\s+/g, ' ').trim(), 50) || 'playlist';

// ─────────────── bot messages (all English) ───────────────
const MSG = {
    usage:
        '❌ *Please provide a YouTube playlist link.*\n\n' +
        '📌 *Example:*\n' +
        `${PREFIX_HINT}plinks https://www.youtube.com/playlist?list=PLxxxxxxxxxxxxxxxx`,
    invalid:
        '❌ *That does not look like a valid YouTube playlist link.*\n\n' +
        'Make sure the link contains "list=" and try again.',
    fetching: '⏳ Fetching the playlist, please wait...',
    failed: (reason) =>
        '❌ *Could not fetch this playlist.*\n\n' +
        (SHOW_ERROR_REASON && reason ? `🔎 *Reason:* ${shorten(String(reason), 300)}\n\n` : '') +
        'It may be private, deleted, or an auto-generated YouTube Mix. Please check the link and try again.',
    empty: '⚠️ No available videos were found in this playlist.',
    error: '❌ Something went wrong while processing your request. Please try again later.',
};

// ─────────────── link → playlist id ───────────────
function extractPlaylistId(input) {
    const text = String(input || '').trim().split(/\s+/)[0];
    if (!text) return null;

    // a bare playlist id (PL..., UU..., FL..., OLAK5uy_...)
    if (/^(PL|UU|FL|OLAK5uy_)[\w-]{10,}$/.test(text)) return text;

    try {
        const url = new URL(/^https?:\/\//i.test(text) ? text : `https://${text}`);
        const host = url.hostname.replace(/^(www|m|music)\./, '');
        if (!['youtube.com', 'youtu.be'].includes(host)) return null;

        const list = url.searchParams.get('list');
        return list && /^[\w-]{10,}$/.test(list) ? list : null;
    } catch {
        return null;
    }
}

// ─────────────── tiny HTTP client (built-in https, no packages) ───────────────
const USER_AGENT =
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36';

// these cookies stop YouTube from showing its "before you continue" consent page to servers located in the EU
const COOKIES = 'SOCS=CAI; CONSENT=YES+1';

function unzip(encoding, buffer) {
    switch (String(encoding || '').toLowerCase()) {
        case 'gzip':    return zlib.gunzipSync(buffer);
        case 'deflate': return zlib.inflateSync(buffer);
        case 'br':      return zlib.brotliDecompressSync(buffer);
        default:        return buffer;
    }
}

function request(url, { method = 'GET', headers = {}, body = null, redirects = 5 } = {}) {
    return new Promise((resolve, reject) => {
        const target = new URL(url);
        const req = https.request({
            hostname: target.hostname,
            port: target.port || 443,
            path: target.pathname + target.search,
            method,
            timeout: 20000,
            headers: {
                'User-Agent': USER_AGENT,
                'Accept-Language': 'en-US,en;q=0.9',
                'Accept-Encoding': 'gzip',
                Cookie: COOKIES,
                ...headers,
                ...(body ? { 'Content-Length': Buffer.byteLength(body) } : {}),
            },
        }, (res) => {
            const status = res.statusCode;

            if ([301, 302, 303, 307, 308].includes(status) && res.headers.location && redirects > 0) {
                res.resume();
                const keep = status === 307 || status === 308;
                return resolve(request(new URL(res.headers.location, url).toString(), {
                    method: keep ? method : 'GET',
                    headers,
                    body: keep ? body : null,
                    redirects: redirects - 1,
                }));
            }

            const chunks = [];
            res.on('data', (chunk) => chunks.push(chunk));
            res.on('error', reject);
            res.on('end', () => {
                try {
                    const text = unzip(res.headers['content-encoding'], Buffer.concat(chunks)).toString('utf8');
                    resolve({ status, url, text });
                } catch (err) {
                    reject(err);
                }
            });
        });

        req.on('timeout', () => req.destroy(new Error('the request to YouTube timed out')));
        req.on('error', reject);
        if (body) req.write(body);
        req.end();
    });
}

// ─────────────── talking to YouTube ───────────────
const DEFAULT_API_KEY = 'AIzaSyAO_FJ2SlqU8Q4STEHLGCilw_Y9_11qcW8'; // public key of YouTube's own web client

function defaultConfig() {
    const d = new Date(Date.now() - 10 * 86400000);
    const pad = (n) => String(n).padStart(2, '0');
    return {
        apiKey: DEFAULT_API_KEY,
        clientVersion: `2.${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}.00.00`,
        visitorData: '',
    };
}

// the playlist web page contains the API key / client version YouTube currently expects
function readConfig(html) {
    const pick = (re) => (re.exec(html) || [])[1];
    const found = {
        apiKey: pick(/"INNERTUBE_API_KEY":"([^"]+)"/),
        clientVersion:
            pick(/"INNERTUBE_CONTEXT_CLIENT_VERSION":"([^"]+)"/) ||
            pick(/"INNERTUBE_CLIENT_VERSION":"([^"]+)"/),
        visitorData: pick(/"VISITOR_DATA":"([^"]+)"/) || pick(/"visitorData":"([^"]+)"/),
    };
    return Object.fromEntries(Object.entries(found).filter(([, value]) => value));
}

// pulls the big `ytInitialData = {...}` JSON object out of the page
function extractInitialData(html) {
    const match = /ytInitialData"?\]?\s*=\s*\{/.exec(html);
    if (!match) return null;
    const start = match.index + match[0].length - 1;

    // walk to the matching closing brace (aware of "strings" and escapes)
    let depth = 0;
    let inString = false;
    let escaped = false;
    for (let i = start; i < html.length; i++) {
        const ch = html[i];
        if (inString) {
            if (escaped) escaped = false;
            else if (ch === '\\') escaped = true;
            else if (ch === '"') inString = false;
        } else if (ch === '"') {
            inString = true;
        } else if (ch === '{') {
            depth++;
        } else if (ch === '}' && --depth === 0) {
            return JSON.parse(html.slice(start, i + 1));
        }
    }
    return null;
}

// calls YouTube's own "browse" API (first page by id, or the next page by continuation token)
async function browse(cfg, payload) {
    const res = await request(
        `https://www.youtube.com/youtubei/v1/browse?key=${encodeURIComponent(cfg.apiKey)}&prettyPrint=false`,
        {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                Accept: '*/*',
                Origin: 'https://www.youtube.com',
                Referer: 'https://www.youtube.com/',
                'X-YouTube-Client-Name': '1',
                'X-YouTube-Client-Version': cfg.clientVersion,
            },
            body: JSON.stringify({
                context: {
                    client: {
                        clientName: 'WEB',
                        clientVersion: cfg.clientVersion,
                        hl: 'en',
                        gl: 'US',
                        ...(cfg.visitorData ? { visitorData: cfg.visitorData } : {}),
                    },
                },
                ...payload,
            }),
        }
    );
    if (res.status !== 200) throw new Error(`YouTube API returned HTTP ${res.status}`);
    return JSON.parse(res.text);
}

// ─────────────── reading YouTube's JSON ───────────────
const VIDEO_ID = /^[\w-]{11}$/;

// YouTube text is either { simpleText }, { runs: [{ text }] } or { content }
const runsText = (t) => {
    if (!t) return '';
    if (typeof t === 'string') return t;
    if (t.simpleText) return t.simpleText;
    if (Array.isArray(t.runs)) return t.runs.map((run) => run.text).join('');
    return t.content || '';
};

// first value stored under `key` anywhere inside `node`
function findFirst(node, key) {
    if (!node || typeof node !== 'object') return undefined;
    if (!Array.isArray(node) && key in node) return node[key];
    for (const k of Object.keys(node)) {
        const found = findFirst(node[k], key);
        if (found !== undefined) return found;
    }
    return undefined;
}

const isVideoNode = (n) =>
    !!(n && (
        n.playlistVideoRenderer ||
        n.reelItemRenderer ||
        (n.lockupViewModel && n.lockupViewModel.contentType === 'LOCKUP_CONTENT_TYPE_VIDEO')
    ));

function toVideo(node) {
    let id;
    let title = '';
    let unavailable = false;
    let entryId = null;

    if (node.playlistVideoRenderer) {
        const r = node.playlistVideoRenderer;
        id = r.videoId;
        title = runsText(r.title);
        unavailable = r.isPlayable === false;
        entryId = r.setVideoId || null;
    } else if (node.reelItemRenderer) {
        const r = node.reelItemRenderer;
        id = r.videoId;
        title = runsText(r.headline);
    } else {
        const l = node.lockupViewModel;
        id = l.contentId;
        title = runsText(l.metadata && l.metadata.lockupMetadataViewModel && l.metadata.lockupMetadataViewModel.title);
    }

    if (!VIDEO_ID.test(id || '')) return null;

    title = clean(title, 'Untitled video');
    if (/^\[(deleted|private|unavailable)[^\]]*\]$/i.test(title)) unavailable = true;

    return { id, title, url: `https://www.youtube.com/watch?v=${id}`, unavailable, entryId };
}

// collects every video on a page + the token for the next page
function scan(root) {
    const videos = [];
    let listToken = null; // continuation token that sits next to the videos (the one we want)
    let anyToken = null;  // fallback: any continuation token on the page

    const tokenOf = (n) => {
        const item = n && n.continuationItemRenderer;
        const command = item && findFirst(item, 'continuationCommand');
        return (command && command.token) || null;
    };

    const visit = (node) => {
        if (!node || typeof node !== 'object') return;

        if (Array.isArray(node)) {
            const holdsVideos = node.some(isVideoNode);
            for (const item of node) {
                if (holdsVideos) listToken = tokenOf(item) || listToken;
                visit(item);
            }
            return;
        }

        if (isVideoNode(node)) {
            const video = toVideo(node);
            if (video) videos.push(video);
            return;
        }

        anyToken = tokenOf(node) || anyToken;
        for (const key of Object.keys(node)) visit(node[key]);
    };

    visit(root);
    return { videos, token: listToken || anyToken };
}

function readInfo(data) {
    return {
        title: clean(
            (data.metadata && data.metadata.playlistMetadataRenderer && data.metadata.playlistMetadataRenderer.title) ||
            runsText(data.header && data.header.playlistHeaderRenderer && data.header.playlistHeaderRenderer.title) ||
            (data.microformat && data.microformat.microformatDataRenderer && data.microformat.microformatDataRenderer.title)
        ),
        author: clean(
            runsText(findFirst(data, 'ownerText')) ||
            runsText(findFirst(findFirst(data, 'videoOwnerRenderer'), 'title')) ||
            runsText(findFirst(findFirst(data, 'avatarStackViewModel'), 'text'))
        ),
        // e.g. "The playlist does not exist." / "This playlist is private."
        alert: clean(runsText(findFirst(data.alerts, 'text'))),
    };
}

// first page: try the normal web page, then fall back to calling the API directly
async function loadFirstPage(listId) {
    let cfg = defaultConfig();
    const errors = [];
    const candidates = [];

    const usable = (data) => {
        const candidate = { data, first: scan(data), info: readInfo(data) };
        candidates.push(candidate);
        const { first, info } = candidate;
        return first.videos.length || first.token || info.alert ? candidate : null;
    };

    // 1) the playlist web page
    try {
        const res = await request(
            `https://www.youtube.com/playlist?list=${encodeURIComponent(listId)}&hl=en&gl=US`,
            { headers: { Accept: 'text/html,application/xhtml+xml' } }
        );
        cfg = { ...cfg, ...readConfig(res.text) };

        if (/consent\.(youtube|google)\.com/.test(res.url)) {
            throw new Error('YouTube showed a cookie-consent page to this server');
        }
        if (res.status === 429 || /google\.com\/sorry/.test(res.url)) {
            throw new Error('YouTube is rate-limiting this server (HTTP 429)');
        }

        const data = extractInitialData(res.text);
        if (!data) throw new Error(`playlist data not found in the page (HTTP ${res.status})`);

        const hit = usable(data);
        if (hit) return { ...hit, cfg };
        errors.push('web page had no video list');
    } catch (err) {
        errors.push(`web page: ${err.message}`);
    }

    // 2) fallback: ask the YouTube API directly
    try {
        const hit = usable(await browse(cfg, { browseId: `VL${listId}` }));
        if (hit) return { ...hit, cfg };
        errors.push('API had no video list');
    } catch (err) {
        errors.push(`API: ${err.message}`);
    }

    // 3) a playlist that really is empty still has a title
    const titled = candidates.find((c) => c.info.title);
    if (titled) return { ...titled, cfg };

    throw new Error(errors.join(' | ') || 'YouTube returned no playlist data');
}

async function fetchPlaylist(listId) {
    const { first, info, cfg } = await loadFirstPage(listId);

    if (!first.videos.length && info.alert) throw new Error(info.alert);

    const playlist = {
        title: info.title || 'Untitled playlist',
        author: info.author,
        videos: [],
        skipped: 0,
        truncated: false,
        incomplete: false,
    };

    const seen = new Set();
    const add = (list) => {
        let fresh = 0;
        for (const video of list) {
            if (video.entryId) {
                if (seen.has(video.entryId)) continue;
                seen.add(video.entryId);
            }
            fresh++;
            if (video.unavailable) playlist.skipped++;
            else if (playlist.videos.length < MAX_VIDEOS) playlist.videos.push(video);
            else playlist.truncated = true;
        }
        return fresh;
    };

    add(first.videos);

    // YouTube sends ~100 videos per page, so keep following the "continuation" token until the end
    let token = first.token;
    const usedTokens = new Set();
    try {
        while (token && !usedTokens.has(token)) {
            if (playlist.videos.length >= MAX_VIDEOS) {
                playlist.truncated = true;
                break;
            }
            usedTokens.add(token);
            const page = scan(await browse(cfg, { continuation: token }));
            if (add(page.videos) === 0) {
                playlist.incomplete = true; // a token with nothing behind it is not normal
                break;
            }
            token = page.token;
        }
    } catch (err) {
        console.error('[plinks] loading a later page failed:', err);
        playlist.incomplete = true; // keep what we already have
    }

    return playlist;
}

// ─────────────── building the messages ───────────────
function buildHeader(p) {
    const lines = [
        '📋 *YouTube Playlist Links*',
        '',
        `🎞️ *Playlist:* ${p.title}`,
    ];
    if (p.author) lines.push(`👤 *Channel:* ${p.author}`);
    lines.push(`🔢 *Videos found:* ${p.videos.length}`);
    if (p.skipped) lines.push(`🚫 *Skipped (deleted/private):* ${p.skipped}`);
    if (p.truncated) lines.push(`⚠️ *Only the first ${MAX_VIDEOS} videos were fetched.*`);
    if (p.incomplete) lines.push('⚠️ *YouTube stopped responding part-way, so this list may be incomplete.*');
    return lines.join('\n');
}

function buildChunks(videos) {
    const chunks = [];
    let current = '';

    videos.forEach((video, i) => {
        const block = `${i + 1}. ${shorten(video.title, TITLE_MAX)}\n${video.url}\n\n`;
        if (current && current.length + block.length > CHUNK_SIZE) {
            chunks.push(current.trimEnd());
            current = '';
        }
        current += block;
    });

    if (current) chunks.push(current.trimEnd());
    return chunks;
}

function buildMessages(p) {
    const chunks = buildChunks(p.videos);

    return chunks.map((body, i) => {
        let text = '';
        if (i === 0) text += `${buildHeader(p)}\n\n`;
        if (chunks.length > 1) text += `📄 *Part ${i + 1} of ${chunks.length}*\n\n`;
        text += body;
        if (i === chunks.length - 1) text += `\n\n✅ *Done!* ${p.videos.length} video links sent.`;
        return text;
    });
}

// plain list, one link per line — handy for download managers / yt-dlp -a links.txt
const buildTxt = (p) => `${p.videos.map((v) => v.url).join('\n')}\n`;

// ─────────────── the command ───────────────
cmd({
    pattern: 'plinks',
    alias: ['ytpl', 'playlistlinks'],
    desc: 'Get the links of every video in a YouTube playlist',
    category: 'download',
    react: '📋',
    filename: __filename,
},
async (conn, mek, m, { from, q }) => {
    const send = (text, quote = false) =>
        conn.sendMessage(from, { text }, quote ? { quoted: mek } : undefined);

    try {
        if (!q) return await send(MSG.usage, true);

        const listId = extractPlaylistId(q);
        if (!listId) return await send(MSG.invalid, true);

        await send(MSG.fetching, true);

        let playlist;
        try {
            playlist = await fetchPlaylist(listId);
        } catch (err) {
            console.error('[plinks] fetch failed:', err);
            return await send(MSG.failed(err && err.message));
        }

        if (!playlist.videos.length) return await send(MSG.empty);

        // big playlist → one .txt file that holds every link
        if (playlist.videos.length > CHAT_LIST_LIMIT) {
            await send(
                `${buildHeader(playlist)}\n\n` +
                '📎 This playlist is large, so all the links are attached as a text file below.'
            );
            await sleep(DELAY_MS);
            return await conn.sendMessage(from, {
                document: Buffer.from(buildTxt(playlist), 'utf-8'),
                mimetype: 'text/plain',
                fileName: `${safeFileName(playlist.title)}_links.txt`,
                caption: `✅ ${playlist.videos.length} video links`,
            }, { quoted: mek });
        }

        // small playlist → numbered list right in the chat
        const messages = buildMessages(playlist);
        for (let i = 0; i < messages.length; i++) {
            if (i > 0) await sleep(DELAY_MS);
            await send(messages[i]);
        }
    } catch (err) {
        console.error('[plinks] error:', err);
        send(MSG.error).catch(() => {});
    }
});

// exported so the same logic can be reused/tested outside the command
module.exports = { extractPlaylistId, fetchPlaylist };
