const fs = require('fs');
const path = require('path');

const SETTINGS_FILE = path.join(__dirname, '..', 'data', 'antidel.json');

let settings = { antidelete_gc: false, antidelete_dm: false, anti_vv: false };

function initializeAntiDeleteSettings() {
    if (fs.existsSync(SETTINGS_FILE)) {
        try { settings = JSON.parse(fs.readFileSync(SETTINGS_FILE, 'utf8')); } catch (e) {}
    } else {
        // data ෆෝල්ඩර් එක නැත්නම් හදනවා
        const dataDir = path.dirname(SETTINGS_FILE);
        if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
        fs.writeFileSync(SETTINGS_FILE, JSON.stringify(settings, null, 2));
    }
}

function getAnti(type) {
    if (type === 'gc') return settings.antidelete_gc;
    if (type === 'dm') return settings.antidelete_dm;
    if (type === 'vv') return settings.anti_vv;
    return false;
}

function setAnti(type, value) {
    if (type === 'gc') settings.antidelete_gc = !!value;
    else if (type === 'dm') settings.antidelete_dm = !!value;
    else if (type === 'vv') settings.anti_vv = !!value;
    fs.writeFileSync(SETTINGS_FILE, JSON.stringify(settings, null, 2));
    return true;
}

module.exports = { getAnti, setAnti, initializeAntiDeleteSettings };