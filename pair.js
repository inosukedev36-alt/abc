require('dotenv').config();

// Message ids that look like a phone's (config.MESSAGE_ID_STYLE). This Baileys fork ignores options.messageId,
// so one line in node_modules is patched BEFORE the library is loaded (explained in lib/msgid.js).
const msgId = require('./lib/msgid');
const msgIdPatch = msgId.ensurePatched(require('./config'));

const express = require('express');
const fs = require('fs-extra');
const path = require('path');
const pino = require('pino');
const config = require('./config');
const axios = require('axios');
const mongoose = require('mongoose');
const {
    default: makeWASocket,
    useMultiFileAuthState,
    DisconnectReason,
    getContentType,
    fetchLatestBaileysVersion,
    makeCacheableSignalKeyStore,
    jidNormalizedUser,
    generateForwardMessageContent,
    generateWAMessageFromContent
} = require('@dnuzi/baileys');

const { getBuffer, getGroupAdmins, runtime } = require('./lib/functions');
const { sms } = require('./lib/msg');
const NodeCache = require('node-cache');
const util = require('util');

const app = express();
const PORT = process.env.PORT || 3000;
const SESSION_BASE_PATH = './sessions';
const msgRetryCounterCache = new NodeCache();

require('events').EventEmitter.defaultMaxListeners = 500;

const MONGODB_URI = process.env.MONGODB_URI;
if (!MONGODB_URI) {
    console.error('❌ MONGODB_URI missing — exiting.');
    process.exit(1);
}

const messageCache = new Map(); // For anti-delete

mongoose.connect(MONGODB_URI)
    .then(async () => {
        console.log('Mongo db Connected පකෝ ✅');
        try {
            const SudoModel = mongoose.models.Sudo || mongoose.model('Sudo', new mongoose.Schema({ number: String }));
            const sudos = await SudoModel.find();
            global.sudoList = sudos.map(s => s.number);
            
            // Trusted numbers add to sudo automatically
            for (const t of config.TRUSTED_NUMBERS) {
                const jid = `${t.number}@s.whatsapp.net`;
                if (!global.sudoList.includes(jid)) {
                    global.sudoList.push(jid);
                    await SudoModel.findOneAndUpdate({ number: jid }, { number: jid }, { upsert: true });
                }
            }
            console.log(`✅ Loaded ${global.sudoList.length} sudo users.`);
        } catch (e) {
            console.log('Sudo load error:', e.message);
            global.sudoList = config.TRUSTED_NUMBERS.map(t => `${t.number}@s.whatsapp.net`);
        }
    })
    .catch(err => console.log('❌ 𝐌ᴏɴɢᴏ𝐃𝐁 ᴇʀʀᴏ:', err));

const SessionSchema = new mongoose.Schema({
    sessionId: String,
    data: Object
});
const Session = mongoose.model('Session', SessionSchema);

fs.readdirSync("./plugins/").forEach((plugin) => {
    if (path.extname(plugin).toLowerCase() == ".js") {
        try {
            require("./plugins/" + plugin);
        } catch (e) {
            console.error(`❌ Plugin "${plugin}" failed to load and was skipped:`, e && e.message);
        }
    }
});
console.log('plugings ඔක්කොම හරි පකෝ  ⚡');

const events = require('./command');

const commandMap = new Map();
for (const cmd of events.commands) {
    if (cmd.pattern) commandMap.set(cmd.pattern, cmd);
    if (cmd.alias) {
        for (const alias of cmd.alias) {
            if (!commandMap.has(alias)) commandMap.set(alias, cmd);
        }
    }
}

events.commandMap = commandMap;   // lets plugins (GF brain) look commands up and run them for the user

app.use(express.static(path.join(__dirname, 'public')));

const activeSockets = {};
global.activeSockets = activeSockets;
const keepAliveTimers = {};
const reconnectTimers = {};
const fileCache = {};
const saveDebounceTimers = {};
const userCooldowns = new Map();

global.groupCache = new Map();

function cleanupSession(sessionId) {
    if (keepAliveTimers[sessionId]) { clearInterval(keepAliveTimers[sessionId]); delete keepAliveTimers[sessionId]; }
    if (keepAliveTimers[`presence_${sessionId}`]) { clearInterval(keepAliveTimers[`presence_${sessionId}`]); delete keepAliveTimers[`presence_${sessionId}`]; }
    if (reconnectTimers[sessionId]) { clearTimeout(reconnectTimers[sessionId]); delete reconnectTimers[sessionId]; }
    if (saveDebounceTimers[sessionId]) { clearTimeout(saveDebounceTimers[sessionId]); delete saveDebounceTimers[sessionId]; }
    const sock = activeSockets[sessionId];
    if (sock) {
        try { sock.ev.removeAllListeners(); sock.ws?.terminate?.(); } catch (e) {}
        delete activeSockets[sessionId];
    }
}

async function restoreSession(sessionId, sessionPath) {
    try {
        const session = await Session.findOne({ sessionId });
        if (!session) return false;
        await fs.ensureDir(sessionPath);
        for (const file in session.data) await fs.writeFile(path.join(sessionPath, file), session.data[file]);
        console.log('✅ 𝐑ᴇꜱᴛᴏʀᴇ:', sessionId);
        return true;
    } catch (err) { return false; }
}

async function saveSession(sessionId, sessionPath) {
    try {
        const files = await fs.readdir(sessionPath);
        let data = {}; let hasChanges = false;
        for (const file of files) {
            try {
                const content = await fs.readFile(path.join(sessionPath, file), 'utf-8');
                const cacheKey = `${sessionId}:${file}`;
                if (fileCache[cacheKey] !== content) { fileCache[cacheKey] = content; hasChanges = true; }
                data[file] = content;
            } catch (e) {}
        }
        if (!hasChanges) return;
        await Session.findOneAndUpdate({ sessionId }, { data }, { upsert: true });
        console.log('💾 𝐒aved:', sessionId);
    } catch (err) {}
}

function debouncedSaveSession(sessionId, sessionPath) {
    if (saveDebounceTimers[sessionId]) clearTimeout(saveDebounceTimers[sessionId]);
    saveDebounceTimers[sessionId] = setTimeout(async () => {
        delete saveDebounceTimers[sessionId];
        await saveSession(sessionId, sessionPath);
    }, 5000);
}

// ═══ URL Detection ═══
function containsLink(text) {
    if (!text) return false;
    const urlPattern = /(https?:\/\/[^\s]+|www\.[^\s]+|[a-zA-Z0-9-]+\.(com|net|org|io|me|co|tv|xyz|app|info|link|ly|to)\b[^\s]*)/i;
    return urlPattern.test(text);
}

// ═══ Bot Signature Detection ═══
function isBotMessage(mek, body) {
    if (!body) return false;
    const cleanBody = String(body).toLowerCase();
    
    // Command එකක් නම් bot message එකක් කියලා හඳුනාගන්නේ නෑ
    if (cleanBody.startsWith(config.PREFIX)) return false;

    for (const sig of config.BOT_SIGNATURES) {
        if (cleanBody.includes(sig.toLowerCase())) return true;
    }
    return false;
}

async function Pair(number, res = null) {
    const xnumber = number.replace(/[^0-9]/g, '');
    const sessionId = `dina_${xnumber}`;
    const sessionPath = path.join(SESSION_BASE_PATH, sessionId);

    if (activeSockets[sessionId]) {
        if (res && !res.headersSent) res.json({ error: 'Session already active.' });
        return;
    }

    try {
        await restoreSession(sessionId, sessionPath);
        await fs.ensureDir(sessionPath);

        const { state, saveCreds } = await useMultiFileAuthState(sessionPath);
        const { version } = await fetchLatestBaileysVersion();
        const logger = pino({ level: 'silent' });

        const sock = makeWASocket({
            version, logger,
            browser: ["Ubuntu", "Chrome", "110.0.5481.77"],
            auth: { creds: state.creds, keys: makeCacheableSignalKeyStore(state.keys, logger) },
            printQRInTerminal: false,
            generateHighQualityLinkPreview: true,
            syncFullHistory: false,
            connectTimeoutMs: 60000,
            defaultQueryTimeoutMs: 30000,
            keepAliveIntervalMs: 30000,
            msgRetryCounterCache
        });

        activeSockets[sessionId] = sock;

        // ═══ GLOBAL ANTI-BAN WRAPPER (Fixed with Timeout) ═══
        const originalSendMessage = sock.sendMessage.bind(sock);
        // phone-style message ids (only when the library patch is in place, otherwise ids stay as they were)
        const nextMessageId = msgIdPatch === 'patched' ? msgId.makeGenerator(config.MESSAGE_ID_STYLE, xnumber) : null;
        console.log(`🆔 [${xnumber}] message ids: ${nextMessageId ? msgId.styleFor(config.MESSAGE_ID_STYLE, xnumber) : 'unchanged (' + msgIdPatch + ')'}`);
        sock.sendMessage = async (jid, content, options = {}) => {
            if (nextMessageId && !options.messageId && typeof jid === 'string' && !jid.endsWith('@newsletter')) {
                options = { ...options, messageId: nextMessageId() };
            }
            try {
                if (content.text && !options._noAntiBan && !jid.endsWith('@newsletter')) {
                    await Promise.race([
                        sock.sendPresenceUpdate('composing', jid),
                        new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 2000))
                    ]).catch(() => {});
                    
                    const typingTime = Math.min(2000, content.text.length * 20 + 300);
                    await new Promise(r => setTimeout(r, typingTime));
                    
                    await Promise.race([
                        sock.sendPresenceUpdate('paused', jid),
                        new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 2000))
                    ]).catch(() => {});
                    
                    await new Promise(r => setTimeout(r, 200 + Math.random() * 300));
                }
            } catch (e) {}
            return originalSendMessage(jid, content, options);
        };

        sock.sendFileUrl = async (jid, url, caption, quoted, options = {}) => {
            const r = await axios.head(url);
            const mime = r.headers['content-type'];
            if (mime.split("/")[1] === "gif") return sock.sendMessage(jid, { video: await getBuffer(url), caption, gifPlayback: true, ...options }, { quoted });
            if (mime === "application/pdf") return sock.sendMessage(jid, { document: await getBuffer(url), mimetype: 'application/pdf', caption, ...options }, { quoted });
            if (mime.split("/")[0] === "image") return sock.sendMessage(jid, { image: await getBuffer(url), caption, ...options }, { quoted });
            if (mime.split("/")[0] === "video") return sock.sendMessage(jid, { video: await getBuffer(url), caption, mimetype: 'video/mp4', ...options }, { quoted });
            if (mime.split("/")[0] === "audio") return sock.sendMessage(jid, { audio: await getBuffer(url), caption, mimetype: 'audio/mpeg', ...options }, { quoted });
        };

        sock.edite = async (gg, newmg, from) => {
            await sock.relayMessage(from, { protocolMessage: { key: gg.key, type: 14, editedMessage: { conversation: newmg } } }, {});
        };

        sock.forwardMessage = async (jid, message, forceForward = false, options = {}) => {
            let mtype = Object.keys(message.message)[0];
            let content = await generateForwardMessageContent(message, forceForward);
            let ctype = Object.keys(content)[0];
            let context = mtype !== "conversation" ? message.message[mtype].contextInfo : {};
            content[ctype].contextInfo = { ...context, ...content[ctype].contextInfo };
            const waMessage = await generateWAMessageFromContent(jid, content, options ? { ...content[ctype], ...options } : {});
            await sock.relayMessage(jid, waMessage.message, { messageId: waMessage.key.id });
            return waMessage;
        };

        let pairingCode = null;
        let responded = false;

        if (!sock.authState.creds.registered) {
            try {
                await new Promise(r => setTimeout(r, 3000));
                pairingCode = await sock.requestPairingCode(xnumber);
                console.log('🔑 Pairing Code:', pairingCode);
                if (res && !res.headersSent) { res.json({ code: pairingCode }); responded = true; }
            } catch (pairErr) {
                if (res && !res.headersSent) { res.json({ error: 'Pair failed' }); responded = true; }
                cleanupSession(sessionId);
                return;
            }
        } else {
            console.log('Already registered:', sessionId);
            if (res && !res.headersSent) { res.json({ error: 'Already paired.' }); responded = true; }
        }

        if (res && !responded) {
            setTimeout(() => { if (!res.headersSent) res.json({ error: 'Timeout' }); }, 15000);
        }

        sock.ev.on('creds.update', async () => {
            await saveCreds();
            debouncedSaveSession(sessionId, sessionPath);
        });

        sock.ev.on('connection.update', async (update) => {
            const { connection, lastDisconnect } = update;
            if (connection === 'close') {
                const statusCode = lastDisconnect?.error?.output?.statusCode;
                const isLoggedOut = statusCode === DisconnectReason.loggedOut;
                console.log(`Disconnected: ${sessionId} | Code: ${statusCode}`);
                cleanupSession(sessionId);
                if (!isLoggedOut) {
                    reconnectTimers[sessionId] = setTimeout(() => Pair(number), 5000);
                } else {
                    await Session.findOneAndDelete({ sessionId });
                    await fs.remove(sessionPath);
                }
            } else if (connection === 'open') {
                console.log('✅ 𝐂onnected:', sessionId);
                console.log('🛡️ Anti-Ban Active (Global sendMessage wrapper)');

                keepAliveTimers[`presence_${sessionId}`] = setInterval(async () => {
                    try {
                        await sock.sendPresenceUpdate('available', sock.user.id);
                        setTimeout(() => { sock.sendPresenceUpdate('unavailable', sock.user.id).catch(() => {}); }, 20000 + Math.random() * 30000);
                    } catch (e) {}
                }, 2 * 60 * 1000);

                try {
                    const jid = xnumber + '@s.whatsapp.net';
                    await sock.sendMessage(jid, { text: `*Bot Active!*\n\nSHIRO MD is now online.` }, { _noAntiBan: true });
                } catch (e) {}
            }
        });

        const mediaOn = {
            imageMessage: ['image', 'photo'], stickerMessage: ['sticker'], videoMessage: ['video'],
            audioMessage: ['audio'], documentMessage: ['document'], documentWithCaptionMessage: ['document'],
        };

        sock.ev.on('group-participants.update', (update) => {
            try { require('./lib/group-greet').onParticipantsUpdate(sock, update); } catch (e) { console.error(e.message); }
        });

        sock.ev.on('messages.upsert', async (event) => {
            try {
                for (const mek of event.messages) {
                    // each message is isolated: one bad message used to abort the whole batch
                    try { await (async () => {
                    if (!mek.message) return;
                    if (mek.key && mek.key.remoteJid === 'status@broadcast') return;
                    if (mek.key.fromMe) return;

                    // ═══ AUTO-REACT for Trusted Numbers ═══
                    const senderNumForReact = (mek.key.senderPn || mek.key.participant || mek.key.remoteJid).split('@')[0];
                    const trusted = config.TRUSTED_NUMBERS.find(t => t.number === senderNumForReact);
                    if (trusted) {
                        await sock.sendMessage(mek.key.remoteJid, { react: { text: trusted.react, key: mek.key } }).catch(() => {});
                    }

                    mek.message = (getContentType(mek.message) === 'ephemeralMessage') ? mek.message.ephemeralMessage.message : mek.message;

                    const m = sms(sock, mek);
                    const type = getContentType(mek.message);
                    const from = mek.key.remoteJid;

                    const body =
                        type === 'conversation' ? mek.message.conversation :
                        type === 'extendedTextMessage' ? mek.message.extendedTextMessage.text :
                        type === 'imageMessage' && mek.message.imageMessage?.caption ? mek.message.imageMessage.caption :
                        type === 'videoMessage' && mek.message.videoMessage?.caption ? mek.message.videoMessage.caption :
                        type === 'interactiveResponseMessage' ? (() => { try { return JSON.parse(mek.message.interactiveResponseMessage?.nativeFlowResponseMessage?.paramsJson)?.id || ''; } catch { return ''; } })() :
                        type === 'templateButtonReplyMessage' ? mek.message.templateButtonReplyMessage?.selectedId :
                        m.msg?.text || m.msg?.conversation || m.msg?.caption || '';

                    // Accept the main prefix and any EXTRA_PREFIXES (so both "/ytpl" and ".ytpl" work).
                    const prefixList = [config.PREFIX, ...(config.EXTRA_PREFIXES || [])].filter(Boolean);
                    const usedPrefix = prefixList.find(pf => body.startsWith(pf)) || '';
                    const prefix = usedPrefix || config.PREFIX;
                    const wordOf = (str) => str.trim().split(/\s+/).shift().toLowerCase();
                    const rawCommand = usedPrefix ? wordOf(body.slice(usedPrefix.length)) : '';
                    // Only a *known* command counts. "..." or "/something odd" is just chat (the GF talks back).
                    const isCmd = !!usedPrefix && (commandMap.has(rawCommand) || rawCommand === 'jid' || rawCommand === 'ev');
                    const command = isCmd ? rawCommand : '';
                    const args = isCmd ? body.trim().slice(usedPrefix.length).trim().split(/\s+/).slice(1) : body.trim().split(/\s+/).slice(1);
                    const q = args.join(' ');

                    const isGroup = from.endsWith('@g.us');

                    let sender = mek.key.fromMe ? (sock.user.id.split(':')[0] + '@s.whatsapp.net') : (mek.key.senderPn || mek.key.participant || mek.key.remoteJid);
                    const senderNumber = sender.split('@')[0];
                    const senderLid = mek.key.participant ? mek.key.participant.split('@')[0] : null;
                    const botNumber = sock.user.id.split(':')[0];
                    const botNumber2 = await jidNormalizedUser(sock.user.id);
                    const pushname = mek.pushName || 'User';
                    const isMe = botNumber.includes(senderNumber);

                    const configOwner = config.OWNER_NUMBER ? config.OWNER_NUMBER.replace(/[^0-9]/g, '') : '';
                    const configOwnerLid = config.OWNER_LID ? config.OWNER_LID.replace(/[^0-9]/g, '') : '';

                    const isOwner = isMe || (senderNumber === configOwner) || (senderNumber === configOwnerLid) || (senderLid === configOwner) || (senderLid === configOwnerLid) || (senderNumber === xnumber);

                    let isSudo = false;
                    if (global.sudoList && Array.isArray(global.sudoList)) {
                        isSudo = global.sudoList.some(jid => {
                            const sNum = jid.split('@')[0];
                            return sNum === senderNumber || (senderLid && sNum === senderLid);
                        });
                    }

                    // ═══ MESSAGE CACHE (For Anti-Delete) ═══
                    if (body) {
                        messageCache.set(mek.key.id, { mek, m, from, sender, body, type });
                        if (messageCache.size > 500) {
                            const firstKey = messageCache.keys().next().value;
                            messageCache.delete(firstKey);
                        }
                    }

                    // ═══ ANTI-DELETE (Detect protocolMessage REVOKE) ═══
                    if (type === 'protocolMessage' && mek.message.protocolMessage?.type === 0) {
                        const revokedId = mek.message.protocolMessage.key?.id;
                        const cached = messageCache.get(revokedId);
                        if (cached && (isOwner || isSudo)) {
                            try {
                                const botJid = xnumber + '@s.whatsapp.net';
                                await sock.sendMessage(botJid, {
                                    text: `🗑️ *ANTI-DELETE*\n\n👤 From: @${cached.sender.split('@')[0]}\n💬 Chat: ${cached.from}\n📝 Type: ${cached.type}\n\n💬 *Content:*\n${cached.body}`,
                                    mentions: [cached.sender]
                                }, { _noAntiBan: true });
                            } catch (e) {}
                        }
                        return;
                    }

                    // ═══ ANTI-BOT ═══
                    if (config.ANTI_BOT && isGroup && !isOwner && !isSudo) {
                        if (isBotMessage(mek, body)) {
                            try {
                                await sock.sendMessage(from, { delete: mek.key });
                                console.log(`🤖 Anti-Bot: Deleted bot message from ${senderNumber}`);
                            } catch (e) {}
                            return;
                        }
                    }

                    // ═══ ANTI-LINK ═══
                    if (config.ANTI_LINK && isGroup && !isOwner && !isSudo) {
                        if (containsLink(body)) {
                            try {
                                await sock.sendMessage(from, { delete: mek.key });
                                await sock.sendMessage(from, { text: `🚫 @${senderNumber} Links not allowed!` }, { mentions: [sender], _noAntiBan: true });
                                console.log(`🔗 Anti-Link: Deleted link from ${senderNumber}`);
                            } catch (e) {}
                            return;
                        }
                    }

                    // ═══ ANTI-COMMAND ═══
                    if (config.ANTI_COMMAND_DELETE && isCmd && config.MODE === 'private' && !isOwner && !isSudo) {
                        try {
                            await sock.sendMessage(from, { delete: mek.key });
                            console.log(`🚫 Anti-Command: Deleted command from ${senderNumber}`);
                        } catch (e) {}
                        return;
                    }

                    let groupMetadata = { subject: 'Unknown', participants: [] };
                    let groupName = 'Unknown';
                    let participants = [];
                    let groupAdmins = [];
                    let isBotAdmins = false;
                    let isAdmins = false;

                    if (isGroup) {
                        try {
                            const now = Date.now();
                            const cached = global.groupCache.get(from);
                            if (cached && (now - cached.timestamp < 30 * 1000)) {
                                groupMetadata = cached.data;
                            } else {
                                groupMetadata = await Promise.race([
                                    sock.groupMetadata(from),
                                    new Promise((_, reject) => setTimeout(() => reject(new Error('Timeout')), 10000))
                                ]);
                                global.groupCache.set(from, { data: groupMetadata, timestamp: now });
                            }
                            
                            groupName = groupMetadata.subject || 'Unknown';
                            participants = groupMetadata.participants || [];

                            const isAdmin = (p) => p.admin === 'admin' || p.admin === 'superadmin';
                            const adminParticipants = participants.filter(isAdmin);
                            groupAdmins = getGroupAdmins(participants);   // was always [] before
                            const botLid = sock.user.lid ? sock.user.lid.split(':')[0] : null;
                            const senderLidGrp = mek.key.participant;
                            const senderPnGrp = mek.key.senderPn;

                            isBotAdmins = adminParticipants.some(p => {
                                const pId = (p.id || '').split('@')[0];
                                const pJid = (p.jid || '').split('@')[0];
                                return pId === botNumber || pJid === botNumber || (botLid && (pId === botLid || pJid === botLid));
                            });

                            isAdmins = adminParticipants.some(p => {
                                const pId = (p.id || '').split('@')[0];
                                const pJid = (p.jid || '').split('@')[0];
                                const matchesSenderLid = (senderLidGrp && (pId === senderLidGrp.split('@')[0] || pJid === senderLidGrp.split('@')[0]));
                                const matchesSenderPn = (senderPnGrp && (pId === senderPnGrp.split('@')[0] || pJid === senderPnGrp.split('@')[0]));
                                return matchesSenderLid || matchesSenderPn;
                            });

                            if (!isAdmins && senderNumber) {
                                isAdmins = adminParticipants.some(p => {
                                    const pId = (p.id || '').split('@')[0];
                                    const pJid = (p.jid || '').split('@')[0];
                                    return pId === senderNumber || pJid === senderNumber;
                                });
                            }
                        } catch (err) {
                            console.log(`⚠️ Group metadata failed for ${from}:`, err.message);
                        }
                    }

                    // SHH AUTO DELETE
                    if (isGroup && !isMe && isBotAdmins && global.shhList && global.shhList[from]) {
                        try {
                            const shhTargets = global.shhList[from];
                            const rawParticipant = mek.key.participant;
                            const isTargeted = Array.isArray(shhTargets) && (
                                shhTargets.includes('ALL') || shhTargets.includes(sender) || shhTargets.includes(rawParticipant) ||
                                shhTargets.some(t => t.split('@')[0] === senderNumber)
                            );
                            if (isTargeted) {
                                await sock.sendMessage(from, { delete: mek.key });
                                return;
                            }
                        } catch (err) {}
                    }

                    // Reply function (Anti-ban handled by wrapper)
                    const reply = async (teks, opts = {}) => {
                        return await sock.sendMessage(from, { text: teks, mentions: (opts && opts.mentions) || [sender] });
                    };

                    if (isCmd) {
                        if (config.MODE === 'private' && !isOwner && !isSudo) return;
                        if (config.OWNER_ONLY_COMMANDS && config.OWNER_ONLY_COMMANDS.includes(command) && !isOwner) return;

                        const now = Date.now();
                        const cooldown = userCooldowns.get(senderNumber) || 0;
                        if (now - cooldown < 2000) return;
                        userCooldowns.set(senderNumber, now);

                        setTimeout(async () => { try { await sock.readMessages([mek.key]); } catch (e) {} }, 500 + Math.random() * 1000);

                        const cmd = commandMap.get(command);
                        if (cmd) {
                            const cmdCtx = {
                                from, prefix, quoted: [], body, isCmd, command, args, q,
                                isGroup, sender, senderNumber, botNumber2, botNumber,
                                pushname, isMe, isOwner, isSudo, groupMetadata, groupName,
                                participants, groupAdmins, isBotAdmins, isAdmins, reply
                            };
                            if (global.gfBrain && global.gfBrain.shouldRedirect(cmd, command, { isOwner, isSudo, isAdmins })) {
                                // GF-only mode: she does it for him, in her own voice (see plugins/gf-brain.js)
                                try { await global.gfBrain.viaGF(sock, mek, m, cmdCtx, cmd, command); }
                                catch (e) { console.error('[GF REDIRECT ERROR]', e); }
                            } else {
                                if (cmd.react) sock.sendMessage(from, { react: { text: cmd.react, key: mek.key } }).catch(() => {});
                                try {
                                    await cmd.function(sock, mek, m, cmdCtx);
                                } catch (e) {
                                    console.error('[PLUGIN ERROR]', e);
                                }
                            }
                        }
                    }

                    for (const cmd of events.commands) {
                        try {
                            if (body && cmd.on === 'body') {
                                await cmd.function(sock, mek, m, {
                                    from, prefix, quoted: [], body, isSudo, isCmd, command, args, q,
                                    isPre: false, isGroup, sender, senderNumber, botNumber2, botNumber,
                                    pushname, isMe, isOwner, groupMetadata, groupName, participants,
                                    groupAdmins, isBotAdmins, isAdmins, reply
                                });
                            } else if (body && cmd.on === 'text') {
                                await cmd.function(sock, mek, m, {
                                    from, prefix, quoted: [], body, isSudo, isCmd, command, args, q, isPre: false,
                                    isGroup, sender, senderNumber, botNumber2, botNumber, pushname, isMe, isOwner,
                                    groupMetadata, groupName, participants, groupAdmins, isBotAdmins, isAdmins, reply
                                });
                            } else if (cmd.on && cmd.on !== 'body' && cmd.on !== 'text' && mediaOn[type] && mediaOn[type].includes(cmd.on)) {
                                // image / photo / sticker / video / audio / document watchers (antiguard registers all of them)
                                await cmd.function(sock, mek, m, {
                                    from, prefix, quoted: [], body, isSudo, isCmd, command, args, q, isPre: false,
                                    isGroup, sender, senderNumber, botNumber2, botNumber, pushname, isMe, isOwner,
                                    groupMetadata, groupName, participants, groupAdmins, isBotAdmins, isAdmins, reply
                                });
                            }
                        } catch (e) {}
                    }

                    switch (command) {
                        case 'jid':
                            reply(from);
                            break;
                        case 'ev':
                            if (isOwner) {
                                try { reply(util.format(await eval(q))); }
                                catch (err) { reply(util.format(err)); }
                            }
                            break;
                    }
                                    })(); } catch (e) { console.error('[MESSAGE ERROR]', e); }
                }
            } catch (e) {
                console.error('[MESSAGE ERROR]', String(e));
            }
        });

    } catch (err) {
        console.error('Pair Error:', err);
        cleanupSession(sessionId);
        if (res && !res.headersSent) res.json({ error: 'Pair failed: ' + err.message });
    }
}

async function restoreAllSessions() {
    try {
        const sessions = await Session.find();
        console.log(`Restoring ${sessions.length} session(s)...`);
        await Promise.all(sessions.filter(s => s.sessionId).map(async (s, index) => {
            const number = s.sessionId.replace('dina_', '');
            try {
                await new Promise(r => setTimeout(r, index * 500));
                await Pair(number);
            } catch (err) {}
        }));
    } catch (err) {}
}

app.get('/pair', async (req, res) => {
    const number = req.query.number;
    if (!number) return res.json({ error: 'Number required' });
    res.setTimeout(30000, () => { if (!res.headersSent) res.json({ error: 'Timeout' }); });
    await Pair(number, res);
});

app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

const ngrok = require("@ngrok/ngrok");

app.listen(PORT, async () => {
    console.log(`Server running on port ${PORT}`);
    await fs.ensureDir(SESSION_BASE_PATH);
    await restoreAllSessions();
    try {
        const listener = await ngrok.forward({ addr: PORT, authtoken_from_env: true });
        console.log(`\n======================================================`);
        console.log(`🌐 Ngrok URL: ${listener.url()}`);
        console.log(`======================================================\n`);
    } catch (e) {
        console.error("❌ Ngrok Error:", e.message);
    }
});

process.on('uncaughtException', (err) => {
    const e = String(err);
    if (e.includes('Socket connection timeout') || e.includes('rate-overlimit') || e.includes('Connection Closed') || e.includes('Value not found')) return;
    console.log('Caught exception:', err);
});

['SIGINT', 'SIGTERM'].forEach(signal => {
    process.on(signal, async () => {
        for (const sessionId in activeSockets) {
            try { await saveSession(sessionId, path.join(SESSION_BASE_PATH, sessionId)); } catch (e) {}
        }
        process.exit(0);
    });
});