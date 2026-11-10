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
            displayName: '@𝓢𝓗𝓘𝓡𝓞_𝓜𝓓✨', 
            vcard: `BEGIN:VCARD\nVERSION:3.0\nN:Alip;;;;\nFN:Alip\nTEL;waid=13135550002:+1 313 555 0002\nEND:VCARD` 
        } 
    } 
};

cmd({
    pattern: "faketest",
    desc: "Test fake quote",
    category: "main",
    filename: __filename
},
async (conn, mek, m, { from }) => {
    await conn.sendMessage(from, { text: "මේක වැඩ කරනවද බලමු!" }, { quoted: adhimini });
});