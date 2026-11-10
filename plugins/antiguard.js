'use strict'
/**
 * antiguard.js  —  plugin  (cmd({ pattern: ... }) style bots)
 *
 * භාවිතය (group admin ට):
 *   .antispam on | off   → එකම message එක 10 වතාවක් දිගට එව්වොත් member ව remove කරනවා
 *   .antibot  on | off   → Web device එකකින් එන message delete කරලා "ANTIBOT" notice එකක් දානවා
 *   .devicecheck         → (message එකකට reply කරලා) ඒ message එකේ device එක මොකක්ද කියලා පෙන්නනවා
 *
 * Install: මේ file එකයි antiguard-core.js එකයි bot එකේ `plugins/` folder එකට දාන්න. (command.js path එක වෙනස් නම් පහළ පළමු line එක හදන්න)
 */
const { cmd } = require('../command')
const { shared } = require('./antiguard-core')

const guard = shared({
  // spamLimit: 10,               // එකම message එක කී වතාවක් දිගට එව්වොත් remove කරනවද
  // spamGapMs: 60000,            // message දෙකක් අතර මේ ms ගණනට වඩා ගියොත් "දිගට" කියන එක කැඩෙනවා
  // blockedDevices: ['web'],     // antibot block කරන devices: 'web' | 'desktop' | 'unknown' ...
  // ownerNumbers: ['94771234567'], // owner ට අදාළ නොවෙනවා (නැත්නම් env OWNER_NUMBER)
  // prefix: '.',
  // dbFile: './antiguard-db.json',
})

cmd(
  {
    pattern: 'antispam',
    desc: 'Anti-spam on/off — එකම message එක 10 වතාවක් දිගට එව්වොත් member ව remove කරනවා',
    category: 'group',
    use: '.antispam on/off',
    filename: __filename,
  },
  async (conn, mek, m, ctx = {}) => {
    await guard.handleCommand(conn, mek, 'antispam', ctx.q, { isOwner: ctx.isOwner })
  }
)

cmd(
  {
    pattern: 'antibot',
    desc: 'Anti-bot on/off — Web device එකකින් එන message delete කරනවා',
    category: 'group',
    use: '.antibot on/off',
    filename: __filename,
  },
  async (conn, mek, m, ctx = {}) => {
    await guard.handleCommand(conn, mek, 'antibot', ctx.q, { isOwner: ctx.isOwner })
  }
)

cmd(
  {
    pattern: 'devicecheck',
    desc: 'Message එකක device එක මොකක්ද කියලා බලන්න (reply කරලා)',
    category: 'group',
    use: '.devicecheck',
    filename: __filename,
  },
  async (conn, mek) => {
    await guard.handleDeviceCheck(conn, mek)
  }
)

// හැම message එකක්ම බලන watchers. (එකම message එකක් watcher කීපයකින් ආවත් guard එක duplicate ignore කරනවා)
const watcher = async (conn, mek) => {
  await guard.handleMessage(conn, mek)
}
for (const on of ['body', 'image', 'photo', 'sticker', 'video', 'audio', 'document']) {
  cmd({ on, dontAddCommandList: true, filename: __filename }, watcher)
}
