'use strict';
/** lib/gf/mongo.js — MongoDB adapter for GfStore (uses the mongoose connection pair.js already opens). */
module.exports = function mongoAdapter(mongoose, { ttlHours = 24 } = {}) {
    const User = mongoose.models.GfUser || mongoose.model('GfUser', new mongoose.Schema({
        phone: { type: String, unique: true, index: true },
        name: String, age: Number, ageAt: Number,
        bdayDay: Number, bdayMonth: Number, bdayYear: Number,
        step: String, askedStep: String, tries: Number, bdayWished: Number, gf: String, lang: String,
        createdAt: Number, lastSeen: Number,
    }, { minimize: false }));

    // `at` carries a TTL index → MongoDB itself deletes every message once it is older than ttlHours.
    const Msg = mongoose.models.GfMsg || mongoose.model('GfMsg', new mongoose.Schema({
        phone: { type: String, index: true },
        role: String, text: String, gf: String,
        at: { type: Date, default: Date.now, expires: Math.round(ttlHours * 3600) },
    }));

    // people her boyfriend introduced ("this is Nimal, my friend") — kept forever, found by ANY of their ids
    const Person = mongoose.models.GfPerson || mongoose.model('GfPerson', new mongoose.Schema({
        key: { type: String, unique: true, index: true },
        ids: { type: [String], index: true },
        name: String, relation: String, introducedBy: String, groupJid: String, groupName: String,
        createdAt: Number, updatedAt: Number,
    }, { minimize: false }));

    const clean = (d) => { const o = { ...d }; delete o._id; delete o.__v; return o; };
    return {
        models: { User, Msg, Person },
        async loadUsers() { return (await User.find({}).lean()).map(clean); },
        async loadMsgs(sinceMs) {
            const rows = await Msg.find({ at: { $gte: new Date(sinceMs) } }).sort({ at: 1 }).lean();
            return rows.map(r => ({ phone: r.phone, role: r.role, text: r.text, gf: r.gf, at: +new Date(r.at) }));
        },
        async saveUser(u) { await User.updateOne({ phone: u.phone }, { $set: clean(u) }, { upsert: true }); },
        async saveMsg(phone, m) { await Msg.create({ phone, role: m.role, text: m.text, gf: m.gf, at: new Date(m.at) }); },
        async loadPeople() { return (await Person.find({}).lean()).map(clean); },
        async savePerson(p) { await Person.updateOne({ key: p.key }, { $set: clean(p) }, { upsert: true }); },
        async deletePerson(key) { await Person.deleteOne({ key }); },
        async deleteUser(phone) { await Promise.all([User.deleteOne({ phone }), Msg.deleteMany({ phone })]); },
    };
};
