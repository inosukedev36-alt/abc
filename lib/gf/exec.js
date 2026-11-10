'use strict';
/**
 * lib/gf/exec.js — runs a bot command ON BEHALF of the person who asked her.
 *
 * Golden rule: she can never do more than the human could do by typing the command themselves.
 *   • owner / sudo / group-admin status comes from pair.js (real WhatsApp data), never from chat text
 *   • config.OWNER_ONLY_COMMANDS and the per-tool rules in tools.js are enforced here too
 *   • eval / exec / restart / update / boom … (config.GF.NL_BLOCKED) can never be triggered from conversation
 */
const { TOOLS, canon } = require('./tools');

/** why the sender is NOT allowed, or null if fine. reasons: blocked | needGroup | noOwner | noAdmin | noBotAdmin */
function checkPerm(tool, ctx, config) {
    const name = canon(tool);
    const meta = name && TOOLS[name];
    if (!meta) return 'blocked';
    const blocked = (config.GF && config.GF.NL_BLOCKED) || [];
    if (blocked.includes(name) || blocked.includes(tool)) return 'blocked';
    if (meta.group && !ctx.isGroup) return 'needGroup';
    const ownerOnly = new Set(config.OWNER_ONLY_COMMANDS || []);
    if ((ownerOnly.has(name) || meta.perm === 'owner') && !ctx.isOwner) return 'noOwner';
    if (meta.perm === 'group-admin') {
        if (!ctx.isOwner && !ctx.isSudo && !ctx.isAdmins) return 'noAdmin';
        if (!ctx.isBotAdmins) return 'noBotAdmin';
    }
    return null;
}

const jidOfNumber = (n) => `${n}@s.whatsapp.net`;

/**
 * Run `tool` with `arg`. Returns { ok, sent, error }.
 * `commandMap` is events.commandMap from pair.js (pattern + alias → command object).
 */
async function runTool({ sock, mek, m, ctx, tool, arg = '', commandMap }) {
    const name = canon(tool);
    const cmd = commandMap && name && commandMap.get(name);
    if (!cmd) return { ok: false, sent: 0, error: new Error(`command "${tool}" is not registered`) };

    const stats = { sent: 0 };
    // anything that visibly DOES something counts, so "I did nothing" can be told apart from "done"
    // (sendFileUrl & co. call sock.sendMessage internally, bypassing this proxy, hence they are listed too)
    const ACTIVE = new Set(['sendMessage', 'sendFileUrl', 'relayMessage', 'forwardMessage', 'edite', 'groupParticipantsUpdate', 'groupSettingUpdate']);
    const proxy = new Proxy(sock, {
        get(target, prop) {
            const v = target[prop];
            if (typeof v !== 'function') return v;
            if (prop === 'sendMessage') return (...a) => { stats.sent++; stats.lastText = (a[1] && typeof a[1].text === 'string') ? a[1].text : ''; return v.apply(target, a); };
            if (ACTIVE.has(prop)) return (...a) => { stats.sent++; stats.lastText = ''; return v.apply(target, a); };
            return v.bind(target);
        },
    });
    const reply = (text, opts = {}) => { stats.sent++; stats.lastText = String(text || ''); return sock.sendMessage(ctx.from, { text, mentions: (opts && opts.mentions) || [ctx.sender] }); };

    // "kick 94771234567" with no tag/reply → hand the command a proper mention
    let mm = m;
    const digits = String(arg).replace(/[^0-9]/g, '');
    if (TOOLS[name].arg === 'target' && digits.length >= 9 && !(m.mentioned && m.mentioned.length) && !(m.quoted && m.quoted.sender)) {
        const jid = jidOfNumber(digits);
        mm = Object.assign(Object.create(m), { mentioned: [jid], mentionUser: [jid] });
    }
    const prefix = ctx.prefix || '/';
    const argText = String(arg || '').trim();
    const runCtx = {
        ...ctx, reply, command: name, isCmd: true, prefix,
        args: argText ? argText.split(/\s+/) : [], q: argText, body: `${prefix}${name}${argText ? ' ' + argText : ''}`,
    };
    try {
        await cmd.function(proxy, mek, mm, runCtx);
        return { ok: true, sent: stats.sent, lastText: stats.lastText || '' };
    } catch (error) {
        console.error(`[GF] tool "${name}" failed:`, error && error.message);
        return { ok: false, sent: stats.sent, lastText: stats.lastText || '', error };
    }
}

module.exports = { checkPerm, runTool };
