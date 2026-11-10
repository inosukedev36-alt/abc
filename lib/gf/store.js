'use strict';
/**
 * lib/gf/store.js — what the girlfriend remembers.
 *
 *  • PROFILE  (name, age, birthday, which GF …)  → kept forever
 *  • MESSAGE LOG (everything the user said, and what she answered) → kept for MEMORY_HOURS (24h)
 *  • PEOPLE   (someone her boyfriend introduced: "this is Nimal, my friend", remembered by WhatsApp id) → kept forever
 *
 * Everything lives in memory (fast, simple) and is written through to an optional adapter
 * (MongoDB in production, see lib/gf/mongo.js) so it survives restarts / redeploys.
 */
const HOUR = 3600 * 1000;

const newUser = (phone, defaults = {}) => ({
    phone,
    name: '', age: null, ageAt: null,
    bdayDay: null, bdayMonth: null, bdayYear: null,
    step: 'name',            // onboarding: name → age → bday → done
    askedStep: '',           // which question she has already asked
    tries: 0,                // failed attempts on the current onboarding step
    bdayWished: null,        // year she last wished him happy birthday
    gf: defaults.gf || 'chika',
    lang: 'si',
    createdAt: Date.now(), lastSeen: 0,
    ...defaults,
});

class GfStore {
    constructor({ adapter = null, ttlHours = 24, now = Date.now, maxPerUser = 3000, defaultGf = 'chika', log = console } = {}) {
        this.adapter = adapter;
        this.ttlMs = ttlHours * HOUR;
        this.now = now;
        this.maxPerUser = maxPerUser;
        this.defaultGf = defaultGf;
        this.log = log;
        this.users = new Map();
        this.msgs = new Map();      // phone → [{ role:'user'|'gf', text, at, gf }]
        this._dirty = new Set();
        this.people = new Map();        // primary key → { key, ids:[digits…], name, relation, introducedBy, groupJid, groupName, createdAt, updatedAt }
        this.peopleIndex = new Map();   // ANY known id (digits) → that person  (a person can be a phone jid and a @lid at once)
        this._dirtyPeople = new Set();
        this._timer = null;
    }

    /** load persisted data (call once when the DB is connected) */
    async load() {
        if (!this.adapter) return;
        try {
            for (const u of await this.adapter.loadUsers()) this.users.set(u.phone, { ...newUser(u.phone, { gf: this.defaultGf }), ...u });
            for (const m of await this.adapter.loadMsgs(this.now() - this.ttlMs)) {
                if (!this.msgs.has(m.phone)) this.msgs.set(m.phone, []);
                this.msgs.get(m.phone).push({ role: m.role, text: m.text, at: m.at, gf: m.gf });
            }
            for (const list of this.msgs.values()) list.sort((a, b) => a.at - b.at);
            if (this.adapter.loadPeople) for (const p of await this.adapter.loadPeople()) this._indexPerson(p);
            this.log.log(`💕 GF memory loaded: ${this.users.size} users, ${[...this.msgs.values()].reduce((n, l) => n + l.length, 0)} recent messages, ${this.people.size} people`);
        } catch (e) {
            this.log.error('[GF store] load failed (continuing in memory only):', e.message);
        }
    }

    getUser(phone, create = true) {
        let u = this.users.get(phone);
        if (!u && create) {
            u = newUser(phone, { gf: this.defaultGf, createdAt: this.now() });
            this.users.set(phone, u);
            this._markDirty(phone);
        }
        return u || null;
    }

    patchUser(phone, patch) {
        const u = this.getUser(phone);
        Object.assign(u, patch);
        this._markDirty(phone);
        return u;
    }

    /** append to the 24h log */
    addMsg(phone, role, text, gf) {
        text = String(text || '').trim().slice(0, 2000);
        if (!text) return null;
        const list = this.msgs.get(phone) || [];
        const m = { role, text, at: this.now(), gf: gf || undefined };
        list.push(m);
        if (list.length > this.maxPerUser) list.splice(0, list.length - this.maxPerUser);
        this.msgs.set(phone, list);
        if (this.adapter) Promise.resolve(this.adapter.saveMsg(phone, m)).catch(e => this.log.error('[GF store] saveMsg:', e.message));
        return m;
    }

    /** messages from the last MEMORY_HOURS only (older ones are dropped here and by Mongo's TTL index) */
    recent(phone) {
        const list = this.msgs.get(phone);
        if (!list) return [];
        const cutoff = this.now() - this.ttlMs;
        let i = 0;
        while (i < list.length && list[i].at < cutoff) i++;
        if (i) list.splice(0, i);
        if (!list.length) this.msgs.delete(phone);
        return list;
    }

    /** privacy: wipe a person (profile + log) */
    async forget(phone) {
        this.users.delete(phone);
        this.msgs.delete(phone);
        this._dirty.delete(phone);
        if (this.adapter) { try { await this.adapter.deleteUser(phone); } catch (e) { this.log.error('[GF store] forget:', e.message); } }
    }

    prune() { for (const phone of [...this.msgs.keys()]) this.recent(phone); }

    // ── people she knows ──
    _indexPerson(p) {
        this.people.set(p.key, p);
        for (const id of p.ids || []) this.peopleIndex.set(id, p);
    }

    /** the person (introduced earlier) behind ANY of these ids, or null */
    findPerson(ids) {
        for (const id of ids || []) { const p = this.peopleIndex.get(id); if (p) return p; }
        return null;
    }

    /** remember / update someone. → { person, isNew, old:{name,relation} } */
    setPerson({ ids, name, relation = '', introducedBy = '', groupJid = '', groupName = '' }) {
        ids = [...new Set((ids || []).filter(Boolean))];
        if (!ids.length || !name) return null;
        let p = this.findPerson(ids);
        const isNew = !p;
        const old = p ? { name: p.name, relation: p.relation } : { name: '', relation: '' };
        if (!p) p = { key: ids[0], ids: [], name, relation: '', introducedBy, groupJid: '', groupName: '', createdAt: this.now(), updatedAt: this.now() };
        p.name = name;
        if (relation) p.relation = relation;
        if (groupJid) { p.groupJid = groupJid; p.groupName = groupName; }
        p.updatedAt = this.now();
        for (const id of ids) if (!p.ids.includes(id)) p.ids.push(id);
        this._indexPerson(p);
        this._markDirtyPerson(p.key);
        return { person: p, isNew, old };
    }

    /** the same person seen under another id (phone jid ↔ @lid): remember both */
    addAliases(p, ids) {
        let changed = false;
        for (const id of ids || []) if (id && !p.ids.includes(id)) { p.ids.push(id); this.peopleIndex.set(id, p); changed = true; }
        if (changed) this._markDirtyPerson(p.key);
    }

    removePerson(ids) {
        const p = this.findPerson(ids);
        if (!p) return null;
        this.people.delete(p.key);
        for (const id of p.ids) this.peopleIndex.delete(id);
        this._dirtyPeople.delete(p.key);
        if (this.adapter && this.adapter.deletePerson) Promise.resolve(this.adapter.deletePerson(p.key)).catch(e => this.log.error('[GF store] deletePerson:', e.message));
        return p;
    }

    listPeople() { return [...this.people.values()].sort((a, b) => a.name.localeCompare(b.name)); }

    // ── write-through (debounced) ──
    _arm() {
        if (this._timer) return;
        this._timer = setTimeout(() => this.flush(), 800);
        if (this._timer.unref) this._timer.unref();
    }
    _markDirty(phone) {
        if (!this.adapter) return;
        this._dirty.add(phone);
        this._arm();
    }
    _markDirtyPerson(key) {
        if (!this.adapter) return;
        this._dirtyPeople.add(key);
        this._arm();
    }

    async flush() {
        this._timer = null;
        const phones = [...this._dirty]; this._dirty.clear();
        for (const p of phones) {
            const u = this.users.get(p);
            if (!u || !this.adapter) continue;
            try { await this.adapter.saveUser(u); } catch (e) { this.log.error('[GF store] saveUser:', e.message); this._dirty.add(p); }
        }
        const keys = [...this._dirtyPeople]; this._dirtyPeople.clear();
        for (const k of keys) {
            const person = this.people.get(k);
            if (!person || !this.adapter || !this.adapter.savePerson) continue;
            try { await this.adapter.savePerson(person); } catch (e) { this.log.error('[GF store] savePerson:', e.message); this._dirtyPeople.add(k); }
        }
    }
}

module.exports = { GfStore, newUser, HOUR };
