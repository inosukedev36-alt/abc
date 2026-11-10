const { cmd } = require('../command');
const fs = require('fs-extra');
const path = require('path');

const SHH_FILE = path.join(__dirname, '..', 'data', 'shh.json');

// Load SHH List on startup
if (fs.existsSync(SHH_FILE)) {
    try {
        const loaded = fs.readJsonSync(SHH_FILE);
        global.shhList = (loaded && typeof loaded === 'object' && !Array.isArray(loaded)) ? loaded : {};
    } catch (e) {
        global.shhList = {};
    }
} else {
    global.shhList = {};
    if (!fs.existsSync(path.dirname(SHH_FILE))) {
        fs.mkdirSync(path.dirname(SHH_FILE), { recursive: true });
    }
    fs.writeJsonSync(SHH_FILE, {});
}

// (tagall lives in extras.js: admin-only and chunked. The old copy here had no admin check.)

// ─── HIDE TAG ───
cmd({
    pattern: "hidetag",
    desc: "Tag all members without showing their names.",
    category: "group",
    react: "👻",
    filename: __filename
},
async (conn, mek, m, { from, isGroup, isAdmins, groupMetadata, reply, q }) => {
    try {
        if (!isGroup) return reply('❌වේසාවෝ මේක group command එකක් ');
        if (!isAdmins) return reply('❌ තෝ admin කෙනෙක් නෙවේ නේ. ඒ නිසා හැමිනියන්  ');

        const participants = groupMetadata.participants.map(p => p.id);
        const text = q ? q : 'හුත්තෝ අවදානේ ඕනේ මට!';

        await conn.sendMessage(from, { 
            text: text, 
            mentions: participants 
        }, { quoted: mek });

    } catch (e) {
        console.log(e);
        reply(`❌ Error: ${e.message}`);
    }
});

// ─── MUTE (Lock Group / Auto Delete User) ───
cmd({
    pattern: "mute",
    alias: ["lock", "groupclose"],
    desc: "Lock group (no tag) or auto delete messages from a user (tag/reply).",
    category: "group",
    react: "🔇",
    filename: __filename
},
async (conn, mek, m, { from, isGroup, isAdmins, isBotAdmins, reply, args }) => {
    try {
        if (!isGroup) return reply('❌ වේසාවෝ මේක group command එකක් ');
        if (!isAdmins) return reply('❌ තෝ admin කෙනෙක් නෙවේ නේ. ඒ නිසා හැමිනියන්  ');
        if (!isBotAdmins) return reply('❌ admin දියන් පකෝ');

        // 1. කෙනෙක්ව Tag කරලා හෝ Reply කරලා තියෙනවා නම් (User Auto-Delete)
        let targetJid = null;
        if (m.quoted) targetJid = m.quoted.sender;
        else if (m.mentionUser && m.mentionUser.length > 0) targetJid = m.mentionUser[0];
        else if (args[0] && !isNaN(args[0]) && args[0].replace(/[^0-9]/g, '').length >= 9) {
            targetJid = `${args[0].replace(/[^0-9]/g, '')}@s.whatsapp.net`;
        }

        if (targetJid) {
            let shhData = {};
            if (fs.existsSync(SHH_FILE)) shhData = await fs.readJson(SHH_FILE);
            if (!shhData[from]) shhData[from] = [];

            const numOnly = targetJid.split('@')[0];
            if (!shhData[from].includes(targetJid)) shhData[from].push(targetJid);
            if (!shhData[from].includes(`${numOnly}@s.whatsapp.net`)) shhData[from].push(`${numOnly}@s.whatsapp.net`);
            if (!shhData[from].includes(`${numOnly}@lid`)) shhData[from].push(`${numOnly}@lid`);

            await fs.writeJson(SHH_FILE, shhData, { spaces: 2 });
            global.shhList = shhData;
            
            return reply(`🔇 *කට වහපන් පකෝ* `);
        }

        // 2. කාවවත් tag කරලා නැත්නම් (Group Lock)
        await conn.groupSettingUpdate(from, 'announcement');
        reply("🔒 *Group Locked!*");

    } catch (e) {
        console.log(e);
        reply(`❌ Error: ${e.message}`);
    }
});

// ─── UNMUTE (Unlock Group / Stop Auto Delete User) ───
cmd({
    pattern: "unmute",
    alias: ["unlock", "groupopen"],
    desc: "Unlock group (no tag) or stop auto deleting messages from a user (tag/reply).",
    category: "group",
    react: "🔊",
    filename: __filename
},
async (conn, mek, m, { from, isGroup, isAdmins, isBotAdmins, reply, args }) => {
    try {
        if (!isGroup) return reply('❌ වේසාවෝ මේක group command එකක් ');
        if (!isAdmins) return reply('❌ තෝ admin කෙනෙක් නෙවේ නේ. ඒ නිසා හැමිනියන්  .');
        if (!isBotAdmins) return reply('❌ admin දියන් පකෝ ');

        // 1. කෙනෙක්ව Tag කරලා හෝ Reply කරලා තියෙනවා නම් (Stop User Auto-Delete)
        let targetJid = null;
        if (m.quoted) targetJid = m.quoted.sender;
        else if (m.mentionUser && m.mentionUser.length > 0) targetJid = m.mentionUser[0];
        else if (args[0] && !isNaN(args[0]) && args[0].replace(/[^0-9]/g, '').length >= 9) {
            targetJid = `${args[0].replace(/[^0-9]/g, '')}@s.whatsapp.net`;
        }

        if (targetJid) {
            let shhData = {};
            if (fs.existsSync(SHH_FILE)) shhData = await fs.readJson(SHH_FILE);
            if (!shhData[from]) shhData[from] = [];

            const numOnly = targetJid.split('@')[0];
            shhData[from] = shhData[from].filter(id => id !== targetJid && id.split('@')[0] !== numOnly);

            await fs.writeJson(SHH_FILE, shhData, { spaces: 2 });
            global.shhList = shhData;
            
            return reply(`🔊 *දැන් කතා කරපන් පකයා*`);
        }

        // 2. කාවවත් tag කරලා නැත්නම් (Group Unlock)
        await conn.groupSettingUpdate(from, 'not_announcement');
        reply("🔓 *Group Unlocked!*.");

    } catch (e) {
        console.log(e);
        reply(`❌ Error: ${e.message}`);
    }
});