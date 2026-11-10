'use strict';
/**
 * lib/gf/registry.js — a new plugin needs NOTHING else to become something she can do.
 *
 *   cmd({ pattern: 'weather', alias: ['wx'], desc: 'Weather forecast of a city',
 *         use: '.weather <city>', category: 'tools', filename: __filename }, handler)
 *
 * From that one declaration she learns, by herself:
 *   • "weather colombo" / "wx colombo"   (its name or an alias of 3+ letters as the first word)
 *   • the typed form  /weather colombo   by normal users is done BY HER (GF-only mode)
 *   • <city> is a required text → she asks "which one?" when it is missing, and uses the next message
 *   • category 'group' → admins in a group only (+ she asks "sure?")      category 'owner' → the owner only
 *   • the AI is told that the tool exists (name + argument + short hint), so natural wording works too
 * Optional `gf: { … }` inside cmd({}) overrides any of it — see templates/new-command.js.
 *
 * Exposure is deliberate: a command is picked up only when it has a `use:` line or a `gf:` block. Old commands without one
 * (e.g. faketest) stay manual, and names that look dangerous (eval, broadcast, delete, fake …) need an explicit `gf:`.
 */
const T = require('./tools');
const { TOOLS, ALIAS } = T;

// substrings that make a command name suspicious → never exposed by itself, the author must opt in with gf: {…}
const DANGEROUS_PART = /(eval|exec|shell|restart|reboot|shutdown|update|upgrade|logout|spam|boom|bomb|flood|broadcast|sendall|sendtoall|toall|mass|bulk|blast|announce|allgroup|allchat|hack|nuke|wipe|purge|delete|format|promote|demote|forge|spoof|phish|scam|imperson|fake|sudo)/i;
const DANGEROUS_WORD = /^(kill|clear|reset|ban|unban|kick|remove|leave|del|bc)$/i;

const asciiRatio = (s) => (s.length ? s.replace(/[^\x20-\x7e]/g, '').length / s.length : 0);

// ───────────────────────── reading the `use:` line  (".weather <city>", ".antispam on/off", ".track <number> [note]")
function classifyWord(w) {
    if (/^on\s*[\/|]\s*off$|^toggle$/i.test(w)) return 'onoff';
    if (/\b(url|link)\b|ලින්ක්/i.test(w)) return 'url';
    if (/\b(number|phone|num)\b/i.test(w)) return 'number';
    if (/^@|\b(user|member|mention|tag|person|target)\b/i.test(w)) return 'target';
    return 'text';
}

/** → { arg, req, count } | null (no usable `use:`) */
function parseUsage(use, names) {
    let u = String(use || '').trim();
    if (!u) return null;
    u = u.replace(/^[^\p{L}\p{N}<\[@]+/u, '');                          // the prefix: "." or "/"
    const first = u.split(/\s+/)[0].toLowerCase();
    if (names.includes(first)) u = u.slice(first.length).trim();         // the command word itself
    if (!u) return { arg: 'none', req: false, count: 0 };
    if (/\bon\s*[\/|]\s*off\b/i.test(u)) return { arg: 'onoff', req: true, count: 1 };
    const found = [...u.matchAll(/<([^>]+)>|\[([^\]]+)\]|(@\S+)/g)].map(m => ({ word: m[1] || m[2] || m[3], required: !!m[1] || (!m[2] && !!m[3]) }));
    if (!found.length) return { arg: 'text', req: false, count: 1 };       // a few words but no placeholder: take the rest, ask for nothing
    // several parts (url + count + seconds, user + reason …) → hand the whole rest of the message to the plugin as it is
    const arg = found.length > 1 ? 'raw' : classifyWord(found[0].word);
    return { arg, req: found.some(f => f.required), count: found.length };
}

/** a weaker guess when there is no `use:` (only reached when the author wrote a gf: block) */
function inferFromDesc(desc) {
    const d = String(desc || '');
    if (/\bon\s*[\/|]\s*off\b/i.test(d)) return { arg: 'onoff', req: true, count: 1 };
    if (/\b(url|link)\b/i.test(d)) return { arg: 'url', req: true, count: 1 };
    if (/\b(number|phone)\b/i.test(d)) return { arg: 'number', req: true, count: 1 };
    return { arg: 'none', req: false, count: 0 };
}

const keywordRegex = (list) => {
    const parts = (Array.isArray(list) ? list : [list]).map(String).filter(Boolean).map(w => {
        const e = w.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        return /^[\x20-\x7e]+$/.test(w) ? `(?<![\\p{L}\\p{N}])${e}(?![\\p{L}\\p{N}])` : e;   // whole words for latin text, substring for Sinhala
    });
    return parts.length ? new RegExp(parts.join('|'), 'iu') : null;
};

// ───────────────────────── one command → one tool (or a reason why not)
function derive(cmd, config) {
    const gf = cmd.gf;
    if (gf === false) return { skip: 'opted out (gf: false)' };
    if (cmd.on) return { skip: 'watcher (on: …), not a command' };
    if (!cmd.pattern) return { skip: 'no pattern' };
    if (cmd.gfDirect) return { skip: 'one of her own commands' };
    const explicit = !!gf;                                                   // gf: true | gf: { … }
    const g = gf && typeof gf === 'object' ? gf : {};
    const use = String(cmd.use || cmd.usage || '').trim();
    if (!explicit && !use) return { skip: 'no `use:` line and no `gf:` block (add one to expose it)' };
    if (!explicit && cmd.dontAddCommandList) return { skip: 'hidden command (dontAddCommandList)' };

    const pattern = String(cmd.pattern).toLowerCase();
    const names = [pattern, ...(cmd.alias || []).map(a => String(a).toLowerCase())];
    const blocked = (config.GF && config.GF.NL_BLOCKED) || [];
    if (names.some(n => blocked.includes(n))) return { skip: 'listed in config.GF.NL_BLOCKED' };
    if (!explicit && names.some(n => DANGEROUS_PART.test(n) || DANGEROUS_WORD.test(n))) return { skip: 'the name looks dangerous: add gf: { … } to expose it on purpose' };
    if (TOOLS[pattern] && !TOOLS[pattern].auto) return { skip: 'a built-in tool already has this name' };

    const desc = String(cmd.desc || '');
    const cat = String(cmd.category || '').toLowerCase();
    const parsed = parseUsage(use, names) || inferFromDesc(desc);

    const arg = g.arg || parsed.arg;
    const req = g.req !== undefined ? !!g.req : (arg === 'none' ? false : parsed.req);
    const quoted = g.quoted !== undefined ? !!g.quoted : (arg === 'none' && /\b(reply|replying|replied)\b|reply කරලා/i.test(`${use} ${desc}`));
    let perm = g.perm;
    if (!perm) perm = cat === 'owner' || /\bowner only\b/i.test(desc) ? 'owner' : (cat === 'group' || /\badmins? only\b|\(admins?\)/i.test(desc) ? 'group-admin' : 'any');
    const group = g.group !== undefined ? !!g.group : (cat === 'group' || perm === 'group-admin');
    const confirm = g.confirm !== undefined ? !!g.confirm : perm !== 'any';
    const marker = g.marker !== undefined ? !!g.marker : (perm === 'any' && !group && !confirm && ['none', 'url', 'text', 'number'].includes(arg));
    const hint = g.hint ? String(g.hint).slice(0, 40) : (asciiRatio(desc) > 0.9 ? desc.replace(/\s+/g, ' ').slice(0, 32).trim() : '');

    return {
        tool: {
            desc: desc || pattern, arg, req, perm, group, confirm, quoted, marker, hint,
            ask: g.ask || null, extract: typeof g.extract === 'function' ? g.extract : null,
            keywords: g.keywords ? keywordRegex(g.keywords) : null,
            triggers: names.filter(n => n.length >= 3),
            auto: true, source: cmd.filename && cmd.filename !== 'Not Provided' ? String(cmd.filename).split(/[\\/]/).pop() : '',
        },
        names,
    };
}

// ───────────────────────── syncing
const state = { count: -1, added: [], skipped: [] };
const autoAliases = new Set();

function sync(commands, config = {}, log = console) {
    for (const k of Object.keys(TOOLS)) if (TOOLS[k].auto) delete TOOLS[k];                // start from the built-ins every time
    for (const k of autoAliases) delete ALIAS[k];
    autoAliases.clear();
    state.added = []; state.skipped = [];
    for (const cmd of commands || []) {
        if (!cmd || !cmd.pattern || cmd.on) continue;
        const pattern = String(cmd.pattern).toLowerCase();
        if (TOOLS[pattern] && !TOOLS[pattern].auto) continue;                              // built-in: hand-tuned, not our business
        const d = derive(cmd, config);
        if (d.skip) { state.skipped.push({ name: pattern, reason: d.skip }); continue; }
        if (TOOLS[pattern]) { state.skipped.push({ name: pattern, reason: 'another plugin registered this name first' }); continue; }
        TOOLS[pattern] = d.tool;
        for (const a of d.names.slice(1)) if (!TOOLS[a] && !ALIAS[a]) { ALIAS[a] = pattern; autoAliases.add(a); }
        state.added.push(pattern);
    }
    state.count = (commands || []).length;
    if (state.added.length) log.log(`🧩 she learned ${state.added.length} new command(s) by herself: ${state.added.join(', ')}`);
    return { added: [...state.added], skipped: [...state.skipped] };
}

/** cheap: re-reads the plugins only when their number changed */
function ensure(commands, config, log) {
    if (state.count !== (commands || []).length) sync(commands, config, log);
}

/** for "/gf tools": everything she can do, and why a plugin was left out */
function describe() {
    const all = Object.entries(TOOLS).map(([name, m]) => ({
        name, auto: !!m.auto, arg: m.arg + (m.req ? '*' : ''), perm: m.perm + (m.group ? ' · group' : '') + (m.confirm ? ' · asks "sure?"' : ''),
        ai: !!m.marker, source: m.source || (m.auto ? '' : 'built-in'),
    }));
    return { tools: all, skipped: [...state.skipped] };
}

module.exports = { sync, ensure, describe, derive, parseUsage, inferFromDesc, keywordRegex, state };
