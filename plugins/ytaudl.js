/**
 * ───────────────────────────────────────────────────────────────
 *  YouTube → Audio downloader — WhatsApp bot command
 * ───────────────────────────────────────────────────────────────
 *  Command : .ytaudl <youtube video link | youtube playlist link>
 *            .ytaudl stop      (cancels a running download in this chat)
 *  Needs   : nothing extra — only Node's built-in modules
 *  Place   : your bot's plugins/ folder (next to your other commands)
 *  Output  : English
 *
 *  How it works
 *   • video link    → asks the Supun API for the audio link → downloads it → sends it as audio
 *   • playlist link → reads every video of the playlist → does the same for each one, one by one
 *   • if the API fails for a video, the bot asks YouTube directly (backup route)
 * ───────────────────────────────────────────────────────────────
 */

const https = require('https');
const http = require('http');
const zlib = require('zlib');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { cmd } = require('../command'); // ← change this path if your bot's command.js is somewhere else

// ─────────────── settings (edit freely) ───────────────
const API_URL = 'https://supunofc.site/api/download/ytmp3-down';
// keep this key private — if you ever publish your bot's code, move it to an environment variable
const API_KEY = process.env.SUPUN_API_KEY || 'supun_10c84b27a30b6c1d4d18a7025fcba307';

const PREFIX_HINT       = '.';      // only used for the examples shown in the messages
const MAX_PLAYLIST_TRACKS = 100;    // a longer playlist is cut after this many videos
const MAX_FILE_MB       = 100;      // bigger audio files are skipped
const AUDIO_MAX_MB      = 15;       // up to this size → normal audio message, above it → sent as a file
const TRACK_DELAY_MS    = 2500;     // pause between two playlist tracks (helps avoid WhatsApp spam limits)
const MAX_FAILS_IN_A_ROW = 5;       // a playlist job stops when this many tracks fail one after another
const MAX_JOBS_AT_ONCE  = 3;        // how many chats may download at the same time
const CHUNK_BYTES       = 1000000;  // YouTube's media servers only allow small byte ranges, so files come piece by piece
const SHOW_ERROR_REASON = true;     // show the technical reason when something fails (set false for a public bot)

// ─────────────── small helpers ───────────────
const VIDEO_ID = /^[\w-]{11}$/;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// cut by characters (not UTF-16 units) so emojis are never split in half
const cut = (text, max) => Array.from(text).slice(0, max).join('');
const shorten = (text, max) => (Array.from(text).length > max ? `${cut(text, max - 1)}…` : text);

// collapse whitespace, fall back to a default when empty
const clean = (value, fallback = '') => String(value ?? '').replace(/\s+/g, ' ').trim() || fallback;

const safeFileName = (name) =>
    cut(String(name).replace(/[\\/:*?"<>|\x00-\x1f]+/g, '').replace(/\s+/g, ' ').trim(), 80) || 'audio';

const formatBytes = (n) =>
    n >= 1048576 ? `${(n / 1048576).toFixed(2)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`;

// never let the API key leak into a chat message or a log line
const redact = (text) => (API_KEY ? String(text).split(API_KEY).join('***') : String(text));

const httpError = (status) => Object.assign(new Error(`HTTP ${status}`), { status });

// retries network problems and server errors; 403/404/410 etc. will not change by trying again
async function withRetry(fn, attempts = 3) {
    let lastError;
    for (let i = 1; i <= attempts; i++) {
        try {
            return await fn();
        } catch (err) {
            lastError = err;
            const permanent = err.status && err.status < 500 && err.status !== 429;
            if (permanent || i === attempts) break;
            await sleep(800 * i);
        }
    }
    throw lastError;
}

// ─────────────── bot messages (all English) ───────────────
const MSG = {
    usage:
        '❌ *Please provide a YouTube video or playlist link.*\n\n' +
        '📌 *Examples:*\n' +
        `${PREFIX_HINT}ytaudl https://youtu.be/xxxxxxxxxxx\n` +
        `${PREFIX_HINT}ytaudl https://www.youtube.com/playlist?list=PLxxxxxxxxxxxxxxxx\n\n` +
        `🛑 Send *${PREFIX_HINT}ytaudl stop* to cancel a running download.`,
    invalid:
        '❌ *That does not look like a valid YouTube video or playlist link.*\n\n' +
        'Please check the link and try again.',
    busy:
        '⏳ A download is already running in this chat.\n\n' +
        `Please wait for it to finish, or send *${PREFIX_HINT}ytaudl stop* to cancel it.`,
    tooManyJobs: '⏳ The bot is busy with other downloads right now. Please try again in a few minutes.',
    nothingRunning: 'ℹ️ There is no running download in this chat.',
    stopping: '🛑 Stopping... the track that is being processed will finish first.',
    videoStart: '⏳ Downloading the audio, please wait...',
    playlistFetching: '⏳ Reading the playlist, please wait...',
    playlistEmpty: '⚠️ No available videos were found in this playlist.',
    error: '❌ Something went wrong while processing your request. Please try again later.',
    reason: (r) => (SHOW_ERROR_REASON && r ? `\n\n🔎 *Reason:* ${shorten(redact(r), 350)}` : ''),
    videoFailed: (r) => `❌ *Could not download this audio.*${MSG.reason(r)}`,
    playlistFailed: (r) =>
        `❌ *Could not read this playlist.*${MSG.reason(r)}\n\n` +
        'It may be private, deleted, or an auto-generated YouTube Mix.',
    trackFailed: (tag, title, r) =>
        `❌ ${tag} ${shorten(title, 60)}${SHOW_ERROR_REASON && r ? `\n🔎 ${shorten(redact(r), 200)}` : ''}`,
};

// ─────────────── link parsing ───────────────
function extractVideoId(input) {
    const text = String(input || '').trim().split(/\s+/)[0];
    if (!text) return null;

    try {
        const url = new URL(/^https?:\/\//i.test(text) ? text : `https://${text}`);
        const host = url.hostname.replace(/^(www|m|music)\./, '');
        let id = null;

        if (host === 'youtu.be') {
            id = url.pathname.split('/')[1];
        } else if (host === 'youtube.com' || host === 'youtube-nocookie.com') {
            if (url.pathname === '/watch') {
                id = url.searchParams.get('v');
            } else {
                const m = /^\/(?:shorts|live|embed|v)\/([\w-]{11})/.exec(url.pathname);
                id = m && m[1];
            }
        }
        return id && VIDEO_ID.test(id) ? id : null;
    } catch {
        return null;
    }
}

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

// ─────────────── tiny HTTP client (built-in https/http, no packages) ───────────────
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

// resolves with { status, url (final address), headers, body (Buffer), text }
function request(url, { method = 'GET', headers = {}, body = null, redirects = 5, timeout = 30000 } = {}) {
    return new Promise((resolve, reject) => {
        let target;
        try {
            target = new URL(url);
        } catch {
            return reject(new Error('invalid URL'));
        }
        const secure = target.protocol !== 'http:';

        const req = (secure ? https : http).request({
            hostname: target.hostname,
            port: target.port || (secure ? 443 : 80),
            path: target.pathname + target.search,
            method,
            timeout,
            headers: {
                'User-Agent': USER_AGENT,
                'Accept-Language': 'en-US,en;q=0.9',
                'Accept-Encoding': 'gzip',
                ...(/(^|\.)youtube\.com$/.test(target.hostname) ? { Cookie: COOKIES } : {}),
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
                    timeout,
                }));
            }

            const chunks = [];
            res.on('data', (chunk) => chunks.push(chunk));
            res.on('error', reject);
            res.on('close', () => {
                if (!res.complete) reject(new Error('the connection was closed early'));
            });
            res.on('end', () => {
                try {
                    const buffer = unzip(res.headers['content-encoding'], Buffer.concat(chunks));
                    resolve({
                        status,
                        url,
                        headers: res.headers,
                        body: buffer,
                        get text() { return buffer.toString('utf8'); },
                    });
                } catch (err) {
                    reject(err);
                }
            });
        });

        req.on('timeout', () => req.destroy(new Error('the request timed out')));
        req.on('error', reject);
        if (body) req.write(body);
        req.end();
    });
}

// ═══════════════ PART 1 — reading a YouTube playlist ═══════════════
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

// a YouTube page contains the API key / client version / visitor id that YouTube currently expects
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

    return { id, title, unavailable, entryId };
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

async function fetchPlaylist(listId, limit = MAX_PLAYLIST_TRACKS) {
    const { first, info, cfg } = await loadFirstPage(listId);

    if (!first.videos.length && info.alert) throw new Error(info.alert);

    const playlist = {
        title: info.title || 'Untitled playlist',
        videos: [],
        skipped: 0,
        truncated: false,
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
            else if (playlist.videos.length < limit) playlist.videos.push(video);
            else playlist.truncated = true;
        }
        return fresh;
    };

    add(first.videos);

    // YouTube sends ~100 videos per page, so keep following the "continuation" token until we have enough
    let token = first.token;
    const usedTokens = new Set();
    try {
        while (token && !usedTokens.has(token)) {
            if (playlist.videos.length >= limit) {
                playlist.truncated = true;
                break;
            }
            usedTokens.add(token);
            const page = scan(await browse(cfg, { continuation: token }));
            if (add(page.videos) === 0) break;
            token = page.token;
        }
    } catch (err) {
        console.error('[ytaudl] loading a later playlist page failed:', redact(err.message));
    }

    return playlist;
}

// ═══════════════ PART 2 — getting the audio of one video ═══════════════

// video title (the API does not send one) — null when YouTube does not answer
async function fetchTitle(videoId) {
    try {
        const res = await request(
            `https://www.youtube.com/oembed?format=json&url=${encodeURIComponent(`https://youtu.be/${videoId}`)}`,
            { headers: { Accept: 'application/json' }, timeout: 10000 }
        );
        if (res.status !== 200) return null;
        return clean(JSON.parse(res.text).title) || null;
    } catch {
        return null;
    }
}

const urlParam = (url, name) => {
    try { return new URL(url).searchParams.get(name) || ''; } catch { return ''; }
};

// route 1: the Supun API → a list of direct audio links
async function fetchAudioLinks(videoId) {
    const apiUrl =
        `${API_URL}?url=${encodeURIComponent(`https://youtu.be/${videoId}`)}&apikey=${encodeURIComponent(API_KEY)}`;

    const res = await withRetry(async () => {
        const r = await request(apiUrl, { headers: { Accept: 'application/json' } });
        if (r.status >= 500 || r.status === 429) throw httpError(r.status);
        return r;
    }, 2);

    let data;
    try {
        data = JSON.parse(res.text);
    } catch {
        throw new Error(`the API did not return JSON (HTTP ${res.status})`);
    }

    if (res.status !== 200 || data.success === false || data.status === false) {
        throw new Error(clean(data.message || data.error || data.msg, `the API refused the request (HTTP ${res.status})`));
    }

    const rows = Array.isArray(data.result) ? data.result : (data.result ? [data.result] : []);
    const links = [];
    const seen = new Set();
    for (const row of rows) {
        const url = row && (row.downloadUrl || row.download_url || row.url || row.link);
        if (typeof url !== 'string' || !/^https?:\/\//i.test(url) || seen.has(url)) continue; // the API repeats the same link
        seen.add(url);
        if (/audio/i.test(String(row.type || '')) || /audio/i.test(urlParam(url, 'mime'))) links.push({ url });
    }

    if (!links.length) throw new Error('the API returned no audio link');
    return links;
}

// route 2 (backup): ask YouTube directly with the same "app" identity that yt-dlp uses
const VR = {
    version: '1.65.10',
    userAgent: 'com.google.android.apps.youtube.vr.oculus/1.65.10 (Linux; U; Android 12L; eureka-user Build/SQ3A.220605.009.A1) gzip',
};

async function youtubeAudio(videoId) {
    // YouTube refuses anonymous app-style requests that carry no "visitor id", so take one from the watch page
    let visitorData = '';
    try {
        const page = await request(`https://www.youtube.com/watch?v=${videoId}&hl=en`, { headers: { Accept: 'text/html' } });
        visitorData = readConfig(page.text).visitorData || '';
    } catch { /* carry on without it */ }

    const res = await request('https://www.youtube.com/youtubei/v1/player?prettyPrint=false', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'User-Agent': VR.userAgent,
            Origin: 'https://www.youtube.com',
            'X-YouTube-Client-Name': '28',
            'X-YouTube-Client-Version': VR.version,
            ...(visitorData ? { 'X-Goog-Visitor-Id': visitorData } : {}),
        },
        body: JSON.stringify({
            context: {
                client: {
                    clientName: 'ANDROID_VR',
                    clientVersion: VR.version,
                    deviceMake: 'Oculus',
                    deviceModel: 'Quest 3',
                    androidSdkVersion: 32,
                    osName: 'Android',
                    osVersion: '12L',
                    userAgent: VR.userAgent,
                    hl: 'en',
                    gl: 'US',
                    ...(visitorData ? { visitorData } : {}),
                },
            },
            videoId,
            contentCheckOk: true,
            racyCheckOk: true,
            playbackContext: { contentPlaybackContext: { html5Preference: 'HTML5_PREF_WANTS' } },
        }),
    });
    if (res.status !== 200) throw new Error(`YouTube player API returned HTTP ${res.status}`);

    let data;
    try {
        data = JSON.parse(res.text);
    } catch {
        throw new Error('YouTube player API returned invalid JSON');
    }

    const play = data.playabilityStatus || {};
    if (play.status && play.status !== 'OK') {
        throw new Error(`YouTube says: ${clean(play.reason, play.status)}`);
    }

    const formats = ((data.streamingData && data.streamingData.adaptiveFormats) || [])
        .filter((f) => f.url && /^audio\/mp4/i.test(f.mimeType || ''));
    if (!formats.length) throw new Error('YouTube returned no direct audio stream');
    formats.sort((a, b) => (b.itag === 140) - (a.itag === 140) || (b.bitrate || 0) - (a.bitrate || 0));

    return {
        url: formats[0].url,
        userAgent: VR.userAgent,
        title: clean(data.videoDetails && data.videoDetails.title) || null,
    };
}

// ─────────────── downloading a file piece by piece ───────────────
const EXTENSIONS = { 'audio/mp4': 'm4a', 'audio/mpeg': 'mp3', 'audio/webm': 'webm', 'audio/ogg': 'ogg', 'audio/aac': 'aac' };

function mimeOf(headers, url) {
    const header = String(headers['content-type'] || '').split(';')[0].trim().toLowerCase();
    if (/^(audio|video)\//.test(header)) return header.replace(/^video\//, 'audio/');
    return urlParam(url, 'mime').toLowerCase() || 'audio/mp4';
}

async function fetchPiece(url, start, headers) {
    return withRetry(async () => {
        const r = await request(url, { headers: { ...headers, Range: `bytes=${start}-${start + CHUNK_BYTES - 1}` } });
        if (r.status !== 200 && r.status !== 206) throw httpError(r.status);

        if (r.status === 206) {
            const m = /^bytes (\d+)-(\d+)\/(\d+|\*)$/.exec(String(r.headers['content-range'] || '').trim());
            if (!m || Number(m[1]) !== start || Number(m[2]) - Number(m[1]) + 1 !== r.body.length) {
                throw new Error('the server sent a damaged piece of the file');
            }
            r.total = m[3] === '*' ? null : Number(m[3]);
        } else {
            if (start !== 0) throw new Error('the server ignored the byte range');
            r.total = r.body.length; // the whole file came back in one go
        }
        return r;
    });
}

async function downloadToFile(url, dest, { userAgent = USER_AGENT } = {}) {
    const maxBytes = MAX_FILE_MB * 1048576;
    const headers = {
        'User-Agent': userAgent,
        Accept: '*/*',
        'Accept-Encoding': 'identity',
        Origin: 'https://www.youtube.com',
        Referer: 'https://www.youtube.com/',
    };

    await fs.promises.writeFile(dest, '');

    let current = url; // after the first answer this becomes the final (post-redirect) address
    let written = 0;
    let total = null;
    let mime = 'audio/mp4';

    while (total === null || written < total) {
        const piece = await fetchPiece(current, written, headers);
        current = piece.url;

        if (total === null) {
            const type = String(piece.headers['content-type'] || '').toLowerCase();
            const first = piece.body.slice(0, 1).toString();
            if (/^text\/|json/.test(type) || first === '<' || first === '{') {
                throw new Error('the server sent text instead of audio');
            }
            mime = mimeOf(piece.headers, url);
            total = piece.total || Number(urlParam(url, 'clen')) || null;
            if (!total) throw new Error('could not work out the file size');
            if (total > maxBytes) {
                throw Object.assign(new Error(`the file is too large (${formatBytes(total)})`), { tooLarge: true });
            }
        }

        if (!piece.body.length) throw new Error('received an empty piece of the file');
        await fs.promises.appendFile(dest, piece.body);
        written += piece.body.length;
    }

    if (written !== total) throw new Error('the download ended with the wrong size');
    return { path: dest, bytes: written, mime, ext: EXTENSIONS[mime] || 'm4a' };
}

// both routes, in order — resolves with { path, bytes, mime, ext, title? }
async function obtainAudio(videoId, dest) {
    const reasons = [];

    // route 1: the API
    try {
        const links = await fetchAudioLinks(videoId);
        for (const link of links) {
            try {
                return await downloadToFile(link.url, dest);
            } catch (err) {
                if (err.tooLarge) throw err;
                reasons.push(`API link: ${err.message}`);
            }
        }
    } catch (err) {
        if (err.tooLarge) throw err;
        if (!/^API link/.test(reasons[reasons.length - 1] || '')) reasons.push(`API: ${err.message}`);
    }

    // route 2: YouTube directly
    try {
        const direct = await youtubeAudio(videoId);
        const file = await downloadToFile(direct.url, dest, { userAgent: direct.userAgent });
        return { ...file, title: direct.title };
    } catch (err) {
        if (err.tooLarge) throw err;
        reasons.push(`YouTube: ${err.message}`);
    }

    console.error(`[ytaudl] ${videoId} failed:`, redact(reasons.join(' | ')));
    throw new Error(reasons.join(' | '));
}

// ─────────────── temp files ───────────────
let tempDirCache = null;

function tempDir() {
    if (tempDirCache) return tempDirCache;
    for (const base of [os.tmpdir(), process.cwd()]) {
        try {
            const dir = path.join(base, 'ytaudl_tmp');
            fs.mkdirSync(dir, { recursive: true });
            fs.accessSync(dir, fs.constants.W_OK);
            // clean up leftovers of any crashed earlier run
            for (const name of fs.readdirSync(dir)) {
                const file = path.join(dir, name);
                try {
                    if (Date.now() - fs.statSync(file).mtimeMs > 3600000) fs.unlinkSync(file);
                } catch { /* ignore */ }
            }
            tempDirCache = dir;
            return dir;
        } catch { /* try the next place */ }
    }
    throw new Error('no writable temp folder is available');
}

const tempPath = (videoId) =>
    path.join(tempDir(), `${videoId}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}.part`);

const removeFile = (file) => fs.promises.unlink(file).catch(() => {});

// ─────────────── sending to WhatsApp ───────────────
async function sendTrack(conn, from, quoted, file, title, prefix) {
    const options = quoted ? { quoted } : undefined;

    await conn.sendMessage(from, { text: `${prefix}${shorten(title, 100)} (${formatBytes(file.bytes)})` }, options);

    const asAudio = file.bytes <= AUDIO_MAX_MB * 1048576 && /^audio\/(mp4|mpeg|ogg|aac)$/.test(file.mime);
    await conn.sendMessage(
        from,
        asAudio
            ? { audio: { url: file.path }, mimetype: file.mime, ptt: false }
            : { document: { url: file.path }, mimetype: file.mime, fileName: `${safeFileName(title)}.${file.ext}` },
        options
    );
}

// ─────────────── the two jobs ───────────────
async function downloadOne(conn, from, mek, videoId, say) {
    await say(MSG.videoStart, true);

    const titleLookup = fetchTitle(videoId);
    const dest = tempPath(videoId);
    try {
        const file = await obtainAudio(videoId, dest);
        const title = (await titleLookup) || file.title || `YouTube audio ${videoId}`;
        await sendTrack(conn, from, mek, file, title, '🎵 ');
    } catch (err) {
        console.error('[ytaudl] video job failed:', redact(err.message));
        await say(MSG.videoFailed(err.message));
    } finally {
        await removeFile(dest);
    }
}

async function downloadPlaylist(conn, from, mek, listId, job, say) {
    await say(MSG.playlistFetching, true);

    let playlist;
    try {
        playlist = await fetchPlaylist(listId, MAX_PLAYLIST_TRACKS);
    } catch (err) {
        console.error('[ytaudl] playlist failed:', redact(err.message));
        return say(MSG.playlistFailed(err.message));
    }

    const tracks = playlist.videos;
    if (!tracks.length) return say(MSG.playlistEmpty);

    await say(
        `📋 *Playlist:* ${playlist.title}\n` +
        `🔢 *Videos:* ${tracks.length}\n` +
        (playlist.truncated ? `⚠️ Only the first ${MAX_PLAYLIST_TRACKS} videos will be downloaded.\n` : '') +
        '\n⏳ Downloading the audio of every video, one by one. This can take a while.\n' +
        `🛑 Send *${PREFIX_HINT}ytaudl stop* to cancel.`
    );

    let sent = 0;
    let streak = 0;
    let aborted = false;
    const failed = [];

    for (let i = 0; i < tracks.length; i++) {
        if (job.cancelled) break;

        const track = tracks[i];
        const tag = `[${i + 1}/${tracks.length}]`;
        const dest = tempPath(track.id);
        try {
            const file = await obtainAudio(track.id, dest);
            await sendTrack(conn, from, null, file, track.title, `🎵 ${tag} `);
            sent++;
            streak = 0;
        } catch (err) {
            failed.push(track.title);
            streak++;
            await say(MSG.trackFailed(tag, track.title, err.message)).catch(() => {});
            if (streak >= MAX_FAILS_IN_A_ROW) {
                aborted = true;
                break;
            }
        } finally {
            await removeFile(dest);
        }

        if (i < tracks.length - 1 && !job.cancelled) await sleep(TRACK_DELAY_MS);
    }

    const lines = [
        job.cancelled ? '🛑 *Download stopped.*'
            : aborted ? `⚠️ *Stopped early — ${MAX_FAILS_IN_A_ROW} downloads in a row failed.*`
            : '✅ *Playlist finished!*',
        '',
        `📥 *Sent:* ${sent} of ${tracks.length}`,
    ];
    if (failed.length) lines.push(`❌ *Failed:* ${failed.length}`);
    if (playlist.skipped) lines.push(`🚫 *Skipped (deleted/private):* ${playlist.skipped}`);
    if (failed.length) {
        lines.push('', '*Failed tracks:*', ...failed.slice(0, 10).map((t) => `• ${shorten(t, 60)}`));
        if (failed.length > 10) lines.push(`…and ${failed.length - 10} more`);
    }
    await say(lines.join('\n'));
}

// ─────────────── the command ───────────────
const jobs = new Map(); // chat id → { cancelled }

cmd({
    pattern: 'ytaudl',
    desc: 'Download a YouTube video or a whole playlist as audio',
    category: 'download',
    react: '🎧',
    filename: __filename,
},
async (conn, mek, m, { from, q }) => {
    const say = (text, quote = false) =>
        conn.sendMessage(from, { text }, quote ? { quoted: mek } : undefined);

    try {
        const arg = String(q || '').trim();
        if (!arg) return await say(MSG.usage, true);

        // .ytaudl stop
        if (/^stop$/i.test(arg)) {
            const running = jobs.get(from);
            if (!running) return await say(MSG.nothingRunning, true);
            running.cancelled = true;
            return await say(MSG.stopping, true);
        }

        const videoId = extractVideoId(arg);
        const listId = videoId ? null : extractPlaylistId(arg);
        if (!videoId && !listId) return await say(MSG.invalid, true);

        if (jobs.has(from)) return await say(MSG.busy, true);
        if (jobs.size >= MAX_JOBS_AT_ONCE) return await say(MSG.tooManyJobs, true);

        const job = { cancelled: false };
        jobs.set(from, job);
        try {
            if (videoId) await downloadOne(conn, from, mek, videoId, say);
            else await downloadPlaylist(conn, from, mek, listId, job, say);
        } finally {
            jobs.delete(from);
        }
    } catch (err) {
        console.error('[ytaudl] error:', redact(err && err.message));
        say(MSG.error).catch(() => {});
    }
});

// exported so the same logic can be reused/tested outside the command
module.exports = { extractVideoId, extractPlaylistId, fetchPlaylist, downloadToFile };
