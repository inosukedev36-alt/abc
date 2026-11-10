// plugins/gf-chat.js — GF Chat Handler
const http = require('https');
const { GIRLFRIENDS, GF_EXCUSES } = require('../lib/gf-constants');
const gfDb = require('../lib/gf-db');
const { isSleeping } = require('../lib/gf-sleep');

function sendAPI(message) {
    return new Promise((resolve, reject) => {
        const url = new URL('https://ai.dnuz.top/api/gemini');
        url.searchParams.set('q', message);

        const req = http.request({
            method: 'GET',
            hostname: url.hostname,
            path: url.pathname + url.search,
            headers: { 'Accept': 'application/json' },
            timeout: 45000,
        }, (res) => {
            let result = '';
            res.setEncoding('utf8');
            res.on('data', c => result += c);
            res.on('end', () => {
                if (res.statusCode >= 400) return reject(new Error(`HTTP ${res.statusCode}: ${result.slice(0, 50)}`));
                try {
                    const p = JSON.parse(result);
                    const text = p.result || p.response || p.message || p.text;
                    if (!text || !String(text).trim()) return reject(new Error('Empty response from API'));
                    resolve(String(text).trim());
                } catch (e) { reject(new Error('Invalid JSON from API')); }
            });
        });
        req.on('error', reject);
        req.on('timeout', () => req.destroy(new Error('Request Timeout (45s)')));
        req.end();
    });
}

async function handleGFChat(conn, mek, from, sender, text, reply) {
    try {
        const phone = sender.split('@')[0];
        const user = await gfDb.getUser(phone);
        
        if (!user || !user.currentGF) {
            await reply("ඔයා තාම onboard වෙලා නෑ. `.start` ගහන්න.");
            return true;
        }

        const gfKey = user.currentGF;
        const gf = GIRLFRIENDS[gfKey];

        // 💤 Sleep Check එක වෙනස් කළා (reply එකක් එවන්න)
        if (isSleeping(user.gfWakeTime, user.gfSleepTime)) {
            await reply(`💤 ${gf.name} නිදාගෙන ඉන්නවා... (Wake up: ${user.gfWakeTime})`);
            return true; 
        }

        let rel = await gfDb.getRelationship(phone, gfKey);
        if (!rel) rel = await gfDb.createRelationship(phone, gfKey);

        let prompt = gf.prompt + `\n\nContext: His name is ${user.name}. Mood: ${rel.mood}. Relationship: Level ${rel.level}.`;
        prompt += `\nUser: ${text}\nAI:`;

        try { await conn.sendPresenceUpdate('composing', from); } catch {}

        let answer = null;
        try {
            console.log(`⏳ API එකට request යවනවා (${gf.name} සඳහා)...`);
            answer = await sendAPI(prompt);
            console.log(`✅ API Response ආවා!`);
        } catch (e) {
            console.error('❌ GF API Error:', e.message); // Terminal එකේ error එක පේනවා
        }

        try { await conn.sendPresenceUpdate('paused', from); } catch {}

        if (answer) {
            const clean = answer.replace(/<think>[\s\S]*?<\/think>/gi, '').trim();
            await conn.sendMessage(from, { text: clean }, { quoted: mek });
            
            const history = [...(rel.chatHistory || [])];
            history.push({ from: 'user', content: text, ts: new Date().toISOString() });
            history.push({ from: 'bot', content: clean, ts: new Date().toISOString() });
            
            await gfDb.updateRelationship(phone, gfKey, { 
                xp: rel.xp + 1, 
                chatHistory: history.slice(-20),
                lastChatAt: new Date().toISOString()
            });
            await gfDb.updateUser(phone, { lastActive: new Date().toISOString() });
        } else {
            // API fail වුණොත් excuse එකක් දෙමු
            const excuses = GF_EXCUSES[gfKey] || ['මට දැන් කතා කරන්න බැරි වුණා...'];
            await reply(excuses[Math.floor(Math.random() * excuses.length)]);
        }

        return true;
    } catch (e) {
        console.error('GF Chat Error:', e);
        return false;
    }
}

module.exports = { handleGFChat };
