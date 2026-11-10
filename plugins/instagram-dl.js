// Instagram downloader  —  /ig <instagram link>  (or reply to a message that contains a link)
//
// FIXED: the old file was written for a different bot framework (`export default handler`,
// handler.command = [...]). It was never registered with cmd(), so /ig never worked, and the
// ES-module syntax can make `require()` throw on older Node versions (which crashed startup).
//
// Needs an API key from supunofc.site in .env:   SUPUN_API_KEY=xxxxxxxx
const { cmd } = require('../command');

const API_URL = 'https://supunofc.site/api/download/instagram/dl';
const IG_REGEX = /https?:\/\/(?:www\.)?instagram\.com\/(?:reel|reels|p|tv)\/[^\s]+/i;

// Collect every http(s) link found anywhere inside the API result
function collectUrls(obj, out = new Set()) {
    if (!obj) return out;
    if (typeof obj === 'string') { if (/^https?:\/\//i.test(obj)) out.add(obj); return out; }
    if (Array.isArray(obj)) { obj.forEach((v) => collectUrls(v, out)); return out; }
    if (typeof obj === 'object') Object.values(obj).forEach((v) => collectUrls(v, out));
    return out;
}

cmd({
    pattern: 'ig',
    alias: ['instagram', 'igdl'],
    desc: 'Download an Instagram reel / post / video',
    category: 'download',
    react: '📥',
    filename: __filename,
},
async (conn, mek, m, { from, q, prefix }) => {
    const say = (text) => conn.sendMessage(from, { text }, { quoted: mek });
    try {
        const input = String(q || m.quoted?.text || m.quoted?.msg?.text || m.quoted?.msg?.conversation || '').trim();
        const match = input.match(IG_REGEX);
        if (!match) {
            return await say(`📥 *Instagram Downloader*\n\nUsage:\n${prefix || '/'}ig https://www.instagram.com/reel/xxxxxxxx/\n\nYou can also reply to a message that contains a link.`);
        }
        const apiKey = process.env.SUPUN_API_KEY;
        if (!apiKey) return await say('❌ Instagram downloader is not configured (SUPUN_API_KEY is missing in .env).');

        await say('⏳ Downloading, please wait...');
        const res = await fetch(`${API_URL}?url=${encodeURIComponent(match[0])}&apikey=${apiKey}`);
        if (!res.ok) throw new Error(`API responded with HTTP ${res.status}`);
        const data = await res.json();
        if (!data.result || data.result.status === false) {
            return await say('❌ Media not found. The account may be private or the link may be invalid.');
        }

        const urls = [...collectUrls(data.result)];
        const videos = urls.filter((u) => /\.mp4(\?|$)/i.test(u) || /video/i.test(u));
        const images = urls.filter((u) => /\.(jpe?g|png|webp)(\?|$)/i.test(u));

        if (videos.length) {
            await conn.sendMessage(from, { video: { url: videos[0] }, caption: '✅ Instagram video downloaded' }, { quoted: mek });
        } else if (images.length) {
            for (const img of images.slice(0, 10)) await conn.sendMessage(from, { image: { url: img } }, { quoted: mek });
        } else {
            await say('❌ Could not find a download link in the response.');
        }
    } catch (err) {
        console.error('[ig] error:', err.message);
        say(`❌ Error: ${err.message}`).catch(() => {});
    }
});
