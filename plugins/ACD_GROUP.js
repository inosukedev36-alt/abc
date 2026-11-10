const config = require('../config')
const { cmd, commands } = require('../command')

// ─── PROMOTE ───
cmd({
    pattern: "promote",
    desc: "Promote a member to admin.",
    category: "group",
    react: "🔼",
    filename: __filename
},
async (conn, mek, m, { from, isGroup, isBotAdmins, isAdmins, reply }) => {
    try {
        if (!isGroup) return reply('This command can only be used in a group.')
        if (!isBotAdmins) return reply('❌ Bot must be admin first.')
        if (!isAdmins) return reply('❌ You must be an admin to use this.')

        const user = (m.mentioned && m.mentioned[0]) || m.quoted?.sender
        if (!user) return reply('Please tag or reply to a user to promote.')

        await conn.groupParticipantsUpdate(from, [user], 'promote')
        await reply(`@${user.split('@')[0]} has been promoted to admin.`, { mentions: [user] })
    } catch (e) {
        console.log(e)
        reply(`❌ ${e.message || e}`)
    }
})

// ─── DEMOTE ───
cmd({
    pattern: "demote",
    desc: "Demote an admin to member.",
    category: "group",
    react: "🔽",
    filename: __filename
},
async (conn, mek, m, { from, isGroup, isBotAdmins, isAdmins, reply }) => {
    try {
        if (!isGroup) return reply('This command can only be used in a group.')
        if (!isBotAdmins) return reply('❌ Bot must be admin first.')
        if (!isAdmins) return reply('❌ You must be an admin to use this.')

        const user = (m.mentioned && m.mentioned[0]) || m.quoted?.sender
        if (!user) return reply('Please tag or reply to a user to demote.')

        await conn.groupParticipantsUpdate(from, [user], 'demote')
        await reply(`@${user.split('@')[0]} has been demoted to member.`, { mentions: [user] })
    } catch (e) {
        console.log(e)
        reply(`❌ ${e.message || e}`)
    }
})

// ─── REMOVE ───
cmd({
    pattern: "remove",
    desc: "Remove a member from the group.",
    category: "group",
    react: "🚫",
    filename: __filename
},
async (conn, mek, m, { from, isGroup, isBotAdmins, isAdmins, reply }) => {
    try {
        if (!isGroup) return reply('This command can only be used in a group.')
        if (!isBotAdmins) return reply('❌ Bot must be admin first.')
        if (!isAdmins) return reply('❌ You must be an admin to use this.')

        const user = (m.mentioned && m.mentioned[0]) || m.quoted?.sender
        if (!user) return reply('Please tag or reply to a user to remove.')

        await conn.groupParticipantsUpdate(from, [user], 'remove')
        await reply(`@${user.split('@')[0]} has been removed from the group.`, { mentions: [user] })
    } catch (e) {
        console.log(e)
        reply(`❌ ${e.message || e}`)
    }
})

// ─── ADD ───
cmd({
    pattern: "add",
    desc: "Add a member to the group.",
    category: "group",
    react: "➕",
    filename: __filename
},
async (conn, mek, m, { from, q, isGroup, isBotAdmins, isAdmins, reply }) => {
    try {
        if (!isGroup) return reply('This command can only be used in a group.')
        if (!isBotAdmins) return reply('❌ Bot must be admin first.')
        if (!isAdmins) return reply('❌ You must be an admin to use this.')

        let user = String(q || '').split(/\s+/)[0].replace(/[^0-9]/g, '')
        if (user.length === 10 && user.startsWith('0')) user = '94' + user.slice(1)   // 07xxxxxxxx → 947xxxxxxxx
        if (user.length < 8) return reply('Please provide a phone number to add (with country code).')

        await conn.groupParticipantsUpdate(from, [`${user}@s.whatsapp.net`], 'add')
        await reply(`@${user} has been added to the group.`, { mentions: [`${user}@s.whatsapp.net`] })
    } catch (e) {
        console.log(e)
        reply(`❌ ${e.message || e}`)
    }
})

// ─── SETGOODBYE ───
cmd({
    pattern: "setgoodbye",
    desc: "Set the goodbye message for the group.",
    category: "group",
    react: "👋",
    filename: __filename
},
async (conn, mek, m, { from, q, isGroup, isBotAdmins, isAdmins, reply }) => {
    try {
        if (!isGroup) return reply('This command can only be used in a group.')
        if (!isBotAdmins) return reply('Bot must be an admin to use this command.')
        if (!isAdmins) return reply('You must be an admin to use this command.')

        const goodbye = q
        if (!goodbye) return reply('Please provide a goodbye message.')

        require('../lib/group-greet').set(from, 'goodbye', goodbye)
        await reply('Goodbye message has been saved. (@user = the member, {group} = group name)')
    } catch (e) {
        console.log(e)
        reply(`❌ ${e.message || e}`)
    }
})

// ─── SETWELCOME ───
cmd({
    pattern: "setwelcome",
    desc: "Set the welcome message for the group.",
    category: "group",
    react: "👋",
    filename: __filename
},
async (conn, mek, m, { from, q, isGroup, isBotAdmins, isAdmins, reply }) => {
    try {
        if (!isGroup) return reply('This command can only be used in a group.')
        if (!isBotAdmins) return reply('Bot must be an admin to use this command.')
        if (!isAdmins) return reply('You must be an admin to use this command.')

        const welcome = q
        if (!welcome) return reply('Please provide a welcome message.')

        require('../lib/group-greet').set(from, 'welcome', welcome)
        await reply('Welcome message has been saved. (@user = the member, {group} = group name)')
    } catch (e) {
        console.log(e)
        reply(`❌ ${e.message || e}`)
    }
})

// ─── GETPIC ───
cmd({
    pattern: "getpic",
    desc: "Get the group profile picture.",
    category: "group",
    react: "🖼️",
    filename: __filename
},
async (conn, mek, m, { from, isGroup, reply }) => {
    try {
        if (!isGroup) return reply('This command can only be used in a group.')

        let groupPic = null
        try { groupPic = await conn.profilePictureUrl(from, 'image') } catch (_) {}
        if (!groupPic) return reply('This group has no profile picture.')
        await conn.sendMessage(from, { image: { url: groupPic }, caption: 'Group Profile Picture' })
    } catch (e) {
        console.log(e)
        reply(`❌ ${e.message || e}`)
    }
})