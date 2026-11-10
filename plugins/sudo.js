const { cmd } = require('../command');
global.sudoList = global.sudoList || [];
const mongoose = require('mongoose');

// 👇 MongoDB එකේ Sudo ලාව සේව් කරන්න Schema එකක් හදමු 👇
const SudoSchema = new mongoose.Schema({
    number: { type: String, required: true, unique: true }
});
const SudoModel = mongoose.models.Sudo || mongoose.model('Sudo', SudoSchema);
// 👆 -------------------------------------------------- 👆

// Sudo Add Command
cmd({
    pattern: "addsudo",
    desc: "Add a user to sudo list (Owner only).",
    category: "owner",
    react: "✅",
    filename: __filename
},
async (conn, mek, m, { reply, isOwner }) => {
    try {
        if (!isOwner) return reply('❌ Owner ට විතරයි මේක කරන්න පුළුවන්.');

        let targetJid = null;
        if (m.quoted) targetJid = m.quoted.sender;
        else if (m.mentionUser && m.mentionUser.length > 0) targetJid = m.mentionUser[0];
        
        if (!targetJid) return reply('❌ කරුණාකර කෙනෙක්ගේ මැසේජ් එකකට reply කරන්න හෝ tag කරන්න.');

        const cleanNumber = targetJid.split('@')[0];
        const formattedJid = `${cleanNumber}@s.whatsapp.net`;

        // MongoDB එකේ save කරනවා
        await SudoModel.findOneAndUpdate(
            { number: formattedJid }, 
            { number: formattedJid }, 
            { upsert: true }
        );

        if (!global.sudoList.includes(formattedJid)) {
            global.sudoList.push(formattedJid);
        }
        
        reply(`✅ @${cleanNumber} SUDO ADDED`);

    } catch (e) {
        console.log(e);
        reply(`❌ Error: ${e.message}`);
    }
});

// Sudo Delete Command
cmd({
    pattern: "delsudo",
    desc: "Remove a user from sudo list (Owner only).",
    category: "owner",
    react: "❌",
    filename: __filename
},
async (conn, mek, m, { reply, isOwner }) => {
    try {
        if (!isOwner) return reply('❌ Owner ට විතරයි මේක කරන්න පුළුවන්.');

        let targetJid = null;
        if (m.quoted) targetJid = m.quoted.sender;
        else if (m.mentionUser && m.mentionUser.length > 0) targetJid = m.mentionUser[0];
        
        if (!targetJid) return reply('❌ කරුණාකර කෙනෙක්ගේ මැසේජ් එකකට reply කරන්න හෝ tag කරන්න.');

        const cleanNumber = targetJid.split('@')[0];
        const formattedJid = `${cleanNumber}@s.whatsapp.net`;

        // MongoDB එකෙන් delete කරනවා
        await SudoModel.deleteOne({ number: formattedJid });
        
        global.sudoList = global.sudoList.filter(jid => jid.split('@')[0] !== cleanNumber);
        reply(`✅ @${cleanNumber} sudo ලැයිස්තුවෙන් ඉවත් කළා.`);

    } catch (e) {
        console.log(e);
        reply(`❌ Error: ${e.message}`);
    }
});