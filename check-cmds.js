const fs = require('fs');
const path = require('path');
const { commands } = require('./command');

// Plugins load කරනවා commands register වෙන්න
fs.readdirSync(path.join(__dirname, 'plugins')).forEach((plugin) => {
    if (path.extname(plugin).toLowerCase() === '.js') {
        try {
            require(path.join(__dirname, 'plugins', plugin));
        } catch (e) {
            // Plugin error එකක් ආවොත් skip කරනවා
        }
    }
});

console.log('\n===================================');
console.log('📋 AVAILABLE COMMANDS');
console.log('===================================\n');

const categories = {};
commands.forEach(c => {
    if (!c.dontAddCommandList && c.pattern) {
        if (!categories[c.category]) categories[c.category] = [];
        if (!categories[c.category].includes(c.pattern)) {
            categories[c.category].push(c.pattern);
        }
    }
});

for (const cat in categories) {
    console.log(`[${cat.toUpperCase()}]`);
    categories[cat].forEach(cmdName => console.log(` - ${cmdName}`));
    console.log('');
}

console.log(`Total Unique Commands: ${new Set(commands.map(c => c.pattern)).size}`);
console.log('===================================\n');