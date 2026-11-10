/**
 * /chfd <channel post link> <count> <time>
 *
 * Forwards a WhatsApp Channel post to the chat where the command is used,
 * <count> times, waiting <time> seconds between each one.
 * It is sent with the channel's "Forwarded" label, the channel name and the
 * "View channel" button (same look as forwarding the post from the app).
 *
 * Example:  /chfd https://whatsapp.com/channel/0029VaXXXXXXXXXXXX/123 5 10
 */

const { cmd } = require('../command') // <- your bot's command helper
const {
  proto,
  generateWAMessageFromContent,
  getBinaryNodeChild,
  getAllBinaryNodeChildren,
} = require('@dnuzi/baileys') // <- the Baileys package your bot uses

// ---- limits (too many / too fast = WhatsApp may ban the number) ----
const MAX_COUNT = 20   // max forwards per command
const MIN_DELAY = 2    // seconds between forwards (min)
const MAX_DELAY = 600  // seconds between forwards (max)

const LINK_RE = /whatsapp\.com\/channel\/([\w-]+)\/(\d+)/i
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

// 1) read the post's content from the channel
async function fetchPost(conn, channelJid, serverId) {
  for (const take of [1, 10, 50]) {
    const res = await conn.query({
      tag: 'iq',
      attrs: {
        id: conn.generateMessageTag(),
        type: 'get',
        xmlns: 'newsletter',
        to: '@s.whatsapp.net',
      },
      content: [
        {
          tag: 'messages',
          attrs: {
            type: 'jid',
            jid: channelJid,
            count: String(take),
            after: String(serverId - 1),
          },
        },
      ],
    })

    const box = getBinaryNodeChild(res, 'messages')
    if (!box) continue

    for (const node of getAllBinaryNodeChildren(box)) {
      if (Number(node.attrs && node.attrs.server_id) !== serverId) continue
      const pt = getBinaryNodeChild(node, 'plaintext')
      if (!pt || !pt.content) continue
      const buf =
        typeof pt.content === 'string'
          ? Buffer.from(pt.content, 'binary')
          : Buffer.from(pt.content)
      return proto.Message.decode(buf)
    }
  }
  return null
}

// 2) turn it into a "forwarded from channel" message
function buildForward(msg, channelJid, channelName, serverId) {
  const contextInfo = {
    isForwarded: true,
    forwardingScore: 1,
    forwardedNewsletterMessageInfo: {
      newsletterJid: channelJid,
      newsletterName: channelName,
      serverMessageId: serverId,
      contentType: 1, // UPDATE
    },
  }

  const type = Object.keys(msg).find(
    (k) => k !== 'messageContextInfo' && k !== 'senderKeyDistributionMessage' && msg[k]
  )
  if (!type) return null

  // plain text
  if (type === 'conversation') {
    return { extendedTextMessage: { text: msg.conversation, contextInfo } }
  }

  // polls -> the "poll snapshot" bubble WhatsApp makes when you forward a channel poll
  if (type.startsWith('pollCreationMessage') && 'pollResultSnapshotMessage' in proto.Message.prototype) {
    const poll = msg[type]
    return {
      pollResultSnapshotMessage: {
        name: poll.name,
        // vote counts can't be read by the bot, so they show as 0
        pollVotes: (poll.options || []).map((o) => ({ optionName: o.optionName, optionVoteCount: 0 })),
        contextInfo,
      },
    }
  }

  // text / image / video / audio / document ... : copy as is + add the forward info
  return {
    [type]: {
      ...msg[type],
      contextInfo: { ...(msg[type].contextInfo || {}), ...contextInfo },
    },
  }
}

cmd(
  {
    pattern: 'chfd',
    desc: 'Forward a channel post. Usage: /chfd <post link> <count> <time in sec>',
    category: 'tools',
    filename: __filename,
  },
  async (conn, mek, m, { from, q, reply }) => {
    try {
      const [link, c, t] = (q || '').trim().split(/\s+/)
      const hit = link && link.match(LINK_RE)
      const count = parseInt(c, 10)
      const secs = parseFloat(t)

      if (!hit || !count || isNaN(secs)) {
        return reply(
          '❌ Usage:\n/chfd <channel post link> <count> <time in seconds>\n\n' +
            'Ex: /chfd https://whatsapp.com/channel/0029VaXXXXXXXX/123 5 10'
        )
      }
      if (count < 1 || count > MAX_COUNT) return reply(`❌ count must be 1 - ${MAX_COUNT}`)
      if (secs < MIN_DELAY || secs > MAX_DELAY) {
        return reply(`❌ time must be ${MIN_DELAY} - ${MAX_DELAY} seconds`)
      }

      const inviteCode = hit[1]
      const serverId = Number(hit[2])

      // channel info (jid + name)
      const meta = await conn.newsletterMetadata('invite', inviteCode)
      const channelJid = meta && meta.id
      if (!channelJid) return reply('❌ Channel not found. Check the link.')
      const channelName =
        meta.name || (meta.thread_metadata && meta.thread_metadata.name && meta.thread_metadata.name.text) || 'Channel'

      // the post itself
      const post = await fetchPost(conn, channelJid, serverId)
      if (!post) return reply('❌ Could not read that post (wrong post id, or it was deleted).')

      const content = buildForward(post, channelJid, channelName, serverId)
      if (!content) return reply('❌ This post type is not supported.')

      await reply(`⏳ Forwarding ${count} time(s), every ${secs}s ...`)

      for (let i = 1; i <= count; i++) {
        const out = generateWAMessageFromContent(from, content, { userJid: conn.user.id })
        await conn.relayMessage(from, out.message, { messageId: out.key.id })
        if (i < count) await sleep(secs * 1000)
      }

      await reply(`✅ Done. Forwarded ${count} time(s).`)
    } catch (e) {
      console.log('chfd error:', e)
      reply('❌ Error: ' + ((e && e.message) || e))
    }
  }
)
