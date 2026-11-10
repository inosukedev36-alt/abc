const { cmd, commands } = require('../command');

cmd({
    pattern: "hack",
    desc: "Displays a dynamic and playful 'Hacking' message for fun.",
    category: "fun",
    react: "👨‍💻",
    filename: __filename
},
async (conn, mek, m, { from, quoted, body, isCmd, command, args, q, isGroup, sender, senderNumber, botNumber2, botNumber, pushname, isMe, isOwner, groupMetadata, groupName, participants, groupAdmins, isBotAdmins, isAdmins, reply }) => {
    try {
        // ➡️ Vérifier si l'utilisateur est l'Owner
        if (!isOwner) return reply("*📛 ᴏɴʟʏ ᴛʜᴇ ᴏᴡɴᴇʀ ᴄᴀɴ ᴜsᴇ ᴛʜɪs ᴄᴏᴍᴍᴀɴᴅ.*");

        const steps = [
            '💻 * HACK STARTING...* 💻\n\n*Initializing hacking tools...* 🛠️',
            '💻 * HACK STARTING...* 💻\n\n*Connecting to remote servers...* 🌐\n\n```[██████████░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░] 10%``` ⏳',
            '💻 * HACK STARTING...* 💻\n\n*Connecting to remote servers...* 🌐\n\n```[████████████████████░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░] 20%``` ⏳',
            '💻 * HACK STARTING...* 💻\n\n```[██████████████████████████████░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░] 30%``` ⏳',
            '💻 * HACK STARTING...* 💻\n\n```[████████████████████████████████████████░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░] 40%``` ⏳',
            '💻 * HACK STARTING...* 💻\n\n```[██████████████████████████████████████████████████░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░] 50%``` ⏳',
            '💻 * HACK STARTING...* 💻\n\n```[████████████████████████████████████████████████████████████░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░] 60%``` ⏳',
            '💻 * HACK STARTING...* 💻\n\n```[██████████████████████████████████████████████████████████████████████░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░] 70%``` ⏳',
            '💻 * HACK STARTING...* 💻\n\n```[████████████████████████████████████████████████████████████████████████████████░░░░░░░░░░░░░░░░░░░░] 80%``` ⏳',
            '💻 * HACK STARTING...* 💻\n\n```[██████████████████████████████████████████████████████████████████████████████████████████░░░░░░░░░░] 90%``` ⏳',
            '💻 * HACK STARTING...* 💻\n\n```[████████████████████████████████████████████████████████████████████████████████████████████████████] 100%``` ✅\n\n🔒 *System Breach: Successful!* 🔓',
            '🔒 *System Breach: Successful!* 🔓\n🚀 *Command Execution: Complete!* 🎯\n\n*📡 Transmitting data...* 📤',
            '🔒 *System Breach: Successful!* 🔓\n🚀 *Command Execution: Complete!* 🎯\n\n*📡 Transmitting data...* 📤\n*🕵️‍♂️ Ensuring stealth...* 🤫',
            '🔒 *System Breach: Successful!* 🔓\n🚀 *Command Execution: Complete!* 🎯\n\n*📡 Transmitting data...* 📤\n*🕵️‍♂️ Ensuring stealth...* 🤫\n*🔧 Finalizing operations...* 🏁',
            '🚀 *Command Execution: Complete!* 🎯\n\n*📡 Transmitting data...* 📤\n*🕵️‍♂️ Ensuring stealth...* 🤫\n*🔧 Finalizing operations...* 🏁\n*🔧 ali Get Your All Data...* 🎁',
            '⚠️ *Note:* All actions are for demonstration purposes only.\n⚠️ *Reminder:* Ethical hacking is the only way to ensure security.\n⚠️ *Reminder:* Strong hacking is the only way to ensure security.\n\n*👨‍💻 YOUR DATA HACK SUCCESSFULLY 👩‍💻☣*'
        ];

        // 🚀 Send the first message
        const sent = await conn.sendMessage(from, { text: steps[0] }, { quoted: mek });

        // 🔁 Edit the same message for each remaining step
        for (let i = 1; i < steps.length; i++) {
            await new Promise(resolve => setTimeout(resolve, 1000)); // 1s delay
            try {
                await conn.sendMessage(from, {
                    text: steps[i],
                    edit: sent.key
                });
            } catch (err) {
                console.log(`Edit failed at step ${i}:`, err?.message || err);
            }
        }

    } catch (e) {
        console.log(e);
        reply(`❌ *Error!* ${e.message}`);
    }
});