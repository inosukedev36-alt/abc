const config = require('../config');
const { cmd } = require('../command');

const adhimini = { 
    key: { 
        remoteJid: "status@broadcast", 
        fromMe: false, 
        id: 'FAKE_META_ID_001', 
        participant: '13135550002@s.whatsapp.net' 
    }, 
    message: { 
        contactMessage: { 
            displayName: '𝓢𝓗𝓘𝓡𝓞_𝓜𝓓', 
            vcard: `BEGIN:VCARD\nVERSION:3.0\nN:Alip;;;;\nFN:Alip\nTEL;waid=13135550002:+1 313 555 0002\nEND:VCARD` 
        } 
    } 
};

cmd({
    pattern: "owner",
    alias: ["creator", "admin"],
    desc: "Show owner contact card and website",
    category: "main",
    react: "👑",
    filename: __filename
},
async (conn, mek, m, { from, reply }) => {
    try {
        const vcard = 'BEGIN:VCARD\n' +
                      'VERSION:3.0\n' +
                      `FN:${config.OWNER_NAME}\n` +
                      'ORG:Bot Creator;\n' +
                      `TEL;type=CELL;type=VOICE;waid=${config.OWNER_NUMBER}:+${config.OWNER_NUMBER}\n` +
                      'END:VCARD';

        await conn.sendMessage(from, {
            contacts: {
                displayName: config.OWNER_NAME,
                contacts: [{ vcard }]
            }
        }, { quoted: adhimini });

        await conn.sendMessage(from, {
            text: `👑 *Bot Owner Details*\n\n👤 *Name:* ${config.OWNER_NAME}\n🌐 *Website:* ${config.OWNER_WEBSITE}\n\n> Powered by ${config.BOT_NAME}`
        }, { quoted: adhimini });

    } catch (e) {
        console.log(e);
        reply(`❌ Error: ${e.message}`);
    }
});