const { cmd } = require('../command');
const { getAnti, setAnti, initializeAntiDeleteSettings } = require('../lib/antidel');
const { downloadContentFromMessage } = require('@dnuzi/baileys');

initializeAntiDeleteSettings();

// ═══ Antidelete Toggle Command ═══
cmd({
    pattern: "antidelete", alias: ['antidel', 'ad'],
    desc: "Toggle Antidelete", category: "misc", filename: __filename
},
async (conn, mek, m, { reply, q, isOwner }) => {
    if (!isOwner) return reply('❌ Only bot owner');
    const cmdStr = (q || '').toLowerCase().trim();
    switch (cmdStr) {
        case 'on': setAnti('gc', true); setAnti('dm', true); return reply('✅ AntiDelete ON (GC + DM)');
        case 'off': setAnti('gc', false); setAnti('dm', false); return reply('❌ AntiDelete OFF');
        case 'on gc': setAnti('gc', true); return reply('✅ GC ON');
        case 'off gc': setAnti('gc', false); return reply('❌ GC OFF');
        case 'on dm': setAnti('dm', true); return reply('✅ DM ON');
        case 'off dm': setAnti('dm', false); return reply('❌ DM OFF');
        case 'status': return reply(`DM: ${getAnti('dm') ? 'ON ✅' : 'OFF ❌'}\nGC: ${getAnti('gc') ? 'ON ✅' : 'OFF ❌'}`);
        default: return reply('Usage: .antidelete on/off/on gc/off gc/on dm/off dm/status');
    }
});

// ═══ VV Retrieve Function ═══
async function retrieveViewOnce(conn, mek, m, from) {
    try {
        const contextInfo = mek.message?.extendedTextMessage?.contextInfo
            || mek.message?.imageMessage?.contextInfo
            || mek.message?.videoMessage?.contextInfo;
        const quotedRaw = contextInfo?.quotedMessage;
        if (!quotedRaw) return false;

        let viewOnceContent = quotedRaw.viewOnceMessageV2?.message 
            || quotedRaw.viewOnceMessageV2Extension?.message 
            || quotedRaw.viewOnceMessage?.message 
            || quotedRaw;

        const mediaKeys = ['imageMessage', 'videoMessage', 'audioMessage'];
        const msgType = mediaKeys.find(k => viewOnceContent[k]);
        if (!msgType) return false;

        const mediaMsg = viewOnceContent[msgType];
        const type = msgType.replace('Message', '');
        const stream = await downloadContentFromMessage(mediaMsg, type);

        let buffer = Buffer.from([]);
        for await (const chunk of stream) buffer = Buffer.concat([buffer, chunk]);
        if (!buffer.length) return false;

        const caption = mediaMsg?.caption || '';
        const botJid = conn.user.id.split(':')[0] + '@s.whatsapp.net';

        if (msgType === 'imageMessage') {
            await conn.sendMessage(botJid, { image: buffer, caption }, { quoted: mek });
        } else if (msgType === 'videoMessage') {
            await conn.sendMessage(botJid, { video: buffer, caption }, { quoted: mek });
        } else if (msgType === 'audioMessage') {
            await conn.sendMessage(botJid, { audio: buffer, mimetype: 'audio/mp4', ptt: mediaMsg?.ptt || false }, { quoted: mek });
        }
        return true;
    } catch (e) {
        console.error('VV error:', e.message);
        return false;
    }
}

// ═══ VV Command ═══
cmd({
    pattern: "vv", alias: ['retrive', 'retrieve', '🔥', '❤️', '💖'],
    desc: "Retrieve ViewOnce messages", category: "misc", filename: __filename
},
async (conn, mek, m, { reply }) => {
    if (!m.quoted) return reply("⚠️ Reply to a *ViewOnce* message.");
    const ok = await retrieveViewOnce(conn, mek, m);
    if (!ok) reply("❌ Failed to retrieve. Check console.");
});

// ═══ AntiViewOnce (auto-forward to bot) ═══
cmd({ on: "body" },
async (conn, mek, m, { from, body }) => {
    try {
        if (!getAnti('vv')) return;
        if (mek.key.fromMe) return;

        const msg = mek.message;
        let viewOnceContent = msg.viewOnceMessageV2?.message 
            || msg.viewOnceMessageV2Extension?.message 
            || msg.viewOnceMessage?.message;
        if (!viewOnceContent) return;

        const mediaKeys = ['imageMessage', 'videoMessage', 'audioMessage'];
        const msgType = mediaKeys.find(k => viewOnceContent[k]);
        if (!msgType) return;

        const mediaMsg = viewOnceContent[msgType];
        const type = msgType.replace('Message', '');
        const stream = await downloadContentFromMessage(mediaMsg, type);

        let buffer = Buffer.from([]);
        for await (const chunk of stream) buffer = Buffer.concat([buffer, chunk]);
        if (!buffer.length) return;

        const botJid = conn.user.id.split(':')[0] + '@s.whatsapp.net';
        const opts = { 
            caption: `👁️ *Anti-VV* from ${mek.key.participant || mek.key.remoteJid}`,
            contextInfo: { forwardingScore: 999, isForwarded: true }
        };

        if (msgType === 'imageMessage') await conn.sendMessage(botJid, { image: buffer, ...opts });
        else if (msgType === 'videoMessage') await conn.sendMessage(botJid, { video: buffer, ...opts });
        else if (msgType === 'audioMessage') await conn.sendMessage(botJid, { audio: buffer, mimetype: 'audio/mp4', ...opts });
    } catch (e) {
        console.error('AntiVV error:', e.message);
    }
});