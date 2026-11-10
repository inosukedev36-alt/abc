'use strict'
/**
 * extras.js  —  plugin  (cmd({ pattern: ... }) style bots)
 *
 *   .bancheck 94771234567   WhatsApp number එක ban ද නැද්ද බලනවා   (alias: .checkban .wacheck .isban)
 *   .sticker                image / video → sticker              (alias: .s .stic)
 *   .toimg                  sticker → image                      (alias: .toimage)
 *   .tagall [message]       group members ට ඔක්කොම tag කරනවා       (admins)
 *   .kick                   member කෙනෙක්ව remove කරනවා            (admins)  (alias: .remove)
 *
 * Install: මේ file එකයි extras-core.js එකයි bot එකේ `plugins/` folder එකට දාන්න.
 * Requirements: Node 18+ ; .sticker / .toimg වලට server එකේ `ffmpeg` install කරලා තියෙන්න ඕන (Termux: pkg install ffmpeg).
 * (command.js path එක වෙනස් නම් පහළ පළමු line එක හදන්න. Bot එකේ දැනටමත් .sticker / .kick වගේ command තියෙනවා නම් conflict වෙනවා.)
 */
const { cmd } = require('../command')
const { Extras } = require('./extras-core')

const extras = new Extras({
  // packName: 'My Stickers',          // sticker pack name
  // authorName: 'My Bot',             // sticker author
  // defaultCountryCode: '94',         // 0771234567 වගේ local number එකක් ගැහුවොත් පාවිච්චි වෙන country code
  // ownerNumbers: ['94771234567'],    // owner ට admin නැතත් .tagall / .kick පාවිච්චි කරන්න පුළුවන් (නැත්නම් env OWNER_NUMBER)
  // prefix: '.',
})

const add = (pattern, alias, desc, category, method) =>
  cmd(
    { pattern, alias, desc, category, use: `.${pattern}`, filename: __filename },
    async (conn, mek, m, ctx = {}) => {
      await extras[method](conn, mek, ctx.q, { isOwner: ctx.isOwner })
    }
  )

add('bancheck', ['checkban', 'wacheck', 'isban'], 'WhatsApp number එක ban ද නැද්ද බලන්න', 'tools', 'bancheck')
add('sticker', ['s', 'stic'], 'Image / video එකක් sticker කරන්න (reply කරලා)', 'convert', 'sticker')
add('toimg', ['toimage'], 'Sticker එකක් image කරන්න (reply කරලා)', 'convert', 'toimg')
add('tagall', [], 'Group members ට ඔක්කොම tag කරන්න (admins)', 'group', 'tagall')
add('kick', ['remove'], 'Member කෙනෙක්ව group එකෙන් remove කරන්න (admins)', 'group', 'kick')
