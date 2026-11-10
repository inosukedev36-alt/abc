'use strict';
/**
 * lib/gf/lines.js — the short fixed lines she says around a task (questions, "on it", "done", "can't").
 * Free chat goes through the AI; these are instant, free, and never leak "bot" language.
 * 13 girlfriends → 4 tones (sweet / tsun / cool / dark). {n}=his name, {e}=her emoji.
 */
const TONE_OF = {
    chika: 'sweet', mitsuri: 'sweet', emilia: 'sweet', yor: 'sweet',
    taiga: 'tsun', shinobu: 'tsun', jibril: 'tsun', ougi: 'tsun',
    yukino: 'cool', frieren: 'cool',
    kurumi: 'dark', albedo: 'dark', akeno: 'dark',
};
const toneOf = (g) => {
    if (g && g.casual) return 'casual';          // normal-person mode (anyone who is not her boyfriend)
    return TONE_OF[Object.keys(TONE_OF).find(k => String(g && g.name || '').toLowerCase().includes(k))] || 'sweet';
};

const T = {
    sweet: {
        si: {
            intro: ['හරි {n}! මෙයා {who}{relText} කියලා මතක තියාගත්තා {e}', 'ආහ් {who}! හොඳට මතක තියාගත්තා {e}'],
            introNew: ['ආ, ඒ කලින් {old} කියලා මතක හිටියේ... දැන් {who} කියලා මතක තියාගත්තා {e}'],
            askName: ['හායි හායි! {e} මුලින්ම කියන්න, ඔයාගේ නම මොකද්ද?', 'ආහ් හායි~ {e} මම ඔයාව හරියට දැනගන්න ඕනේ... නම මොකක්ද?'],
            askAge: ['{n}... ලස්සන නමක්! {e} දැන් වයස කීයද ඔයාට?', 'වාව් {n}! {e} ඔයාට අවුරුදු කීයද?'],
            askBday: ['හරි හරි {e} ඔයාගේ උපන්දිනේ කවදාද? (උදා: මැයි 14)', 'තව එකක් විතරයි {n} {e} උපන්දිනේ කොයි දවසේද? (උදා: මැයි 14)'],
            retry: ['හ්ම්... මට හරියට තේරුණේ නෑ 🥺 ආයෙ කියන්නකෝ?'],
            done: ['දැන් මම ඔයාව හොඳට දන්නවා {n}! {e} කතා කරමුද?'],
            go: ['හරි {n}, ටිකක් ඉන්න {e} දැන්ම කරලා දෙන්නම්!', 'ඔයා ඉල්ලුවනේ... ඔන්න බලන්නම් {e}'],
            ok: ['ඔන්න ඔයාට ඕන දේ {e} හරිද?', 'අරන් ආවා {n}! {e}'],
            fail: ['අයියෝ {n}, මට ඒක කරන්න බැරි වුණා 🥺 ආයෙ try කරමුද?', 'සමාවෙන්න {n}... මොකක්දෝ අවුලක් ගියා 🥺'],
        },
        en: {
            intro: ['Okay {n}! I\'ll remember this is {who}{relText} {e}', 'Ahh {who}! Got it, I\'ll remember {e}'],
            introNew: ['Oh, I had them as {old} before... now it\'s {who} {e}'],
            askName: ['Hiii! {e} first things first, what\'s your name?', 'Hey hey~ {e} I wanna get to know you properly... what\'s your name?'],
            askAge: ['{n}... what a lovely name! {e} how old are you?', 'Wow {n}! {e} how old are you?'],
            askBday: ['Okay okay {e} when\'s your birthday? (like May 14)', 'One more thing {n} {e} what day is your birthday? (like May 14)'],
            retry: ['Hmm... I didn\'t quite get that 🥺 can you say it again?'],
            done: ['Now I really know you, {n}! {e} so, shall we chat?'],
            go: ['Okay {n}, give me a sec {e} doing it right now!', 'You asked, so... let me see {e}'],
            ok: ['Here you go {e} is that what you wanted?', 'Got it for you {n}! {e}'],
            fail: ['Oh no {n}, I couldn\'t do that 🥺 wanna try again?', 'Sorry {n}... something went wrong 🥺'],
        },
    },
    tsun: {
        si: {
            intro: ['හ්ම්... {who}{relText}, හරි. මතක තියාගත්තා, අමතක කරන්නෙ නෑ! {e}'],
            introNew: ['හා? {old} නෙවෙයි, {who}... හරි, දැන් මතක තියාගත්තා {e}'],
            askName: ['හා... ඉතින් ඔයාගේ නම මොකක්ද? {e} (දැනගන්න ඕනේ නිසා විතරයි අහන්නේ!)', 'ඔයා කවුද? නම කියන්න {e}'],
            askAge: ['{n}, හ්ම්... ඉතින් වයස කීයද? {e} බොරු කියන්න එපා!', 'හරි {n}. දැන් වයස කියන්න {e}'],
            askBday: ['ඊළඟට... උපන්දිනේ කවදාද? {e} නිකන් දැනගන්න! (උදා: මැයි 14)', 'උපන්දිනේ? කියන්නකෝ {n} {e}'],
            retry: ['හා? මට තේරුණේ නෑ! 😤 හරියට කියන්න!'],
            done: ['හරි හරි, දැන් ඔයාව මතක තියාගත්තා {n} {e} ඉතින් මොකද?'],
            go: ['හ්ම්... හරි, කරලා දෙන්නම්. ඔයා මට වැඩ දෙනවනේ {e}', 'අහ් ඉන්න ඉන්න! කරනවා... {e}'],
            ok: ['ඕන් බලන්න {n}! {e} ස්තුති කියන්නෙ නැද්ද?', 'හරි, ඉවරයි. {e} මම කළා!'],
            fail: ['ෆ්... වැඩ කළේ නෑ {n} 😤 මගේ වරදක් නෙවෙයි!', 'අයියෝ... කැඩුණා 😤 ආයෙ try කරන්නකෝ'],
        },
        en: {
            intro: ['Hmph... {who}{relText}, fine. I\'ll remember, I won\'t forget! {e}'],
            introNew: ['Huh? Not {old}, {who}... fine, I\'ve changed it {e}'],
            askName: ['Fine... so what\'s your name? {e} (I\'m only asking because I have to know!)', 'Who are you, anyway? Tell me your name {e}'],
            askAge: ['{n}, hmph... so how old are you? {e} don\'t lie!', 'Okay {n}. now tell me your age {e}'],
            askBday: ['Next... when\'s your birthday? {e} not that I care! (like May 14)', 'Birthday? Spill it {n} {e}'],
            retry: ['Huh? I didn\'t get that! 😤 say it properly!'],
            done: ['Fine, fine, I\'ll remember you now {n} {e} so what do you want?'],
            go: ['Hmph... okay, I\'ll do it. you keep giving me work {e}', 'Wait wait! I\'m doing it... {e}'],
            ok: ['Look at that {n}! {e} aren\'t you going to thank me?', 'There, done. {e} you\'re welcome!'],
            fail: ['Tch... it didn\'t work {n} 😤 not my fault!', 'Ugh... it broke 😤 try again'],
        },
    },
    cool: {
        si: {
            intro: ['හරි. {who}{relText}. මතකයි. {e}'],
            introNew: ['{old} නෙවෙයි, {who}. දැන් මතකයි. {e}'],
            askName: ['...ඔයාගේ නම මොකක්ද? {e}', 'නම කියන්න. {e} මම මතක තියාගන්නම්.'],
            askAge: ['{n}. හ්ම්... වයස කීයද? {e}', 'හරි {n}. වයස කියන්න {e}'],
            askBday: ['උපන්දිනේ කවදාද? {e} (උදා: මැයි 14)', 'අන්තිමට, උපන්දිනේ කොයි දවසේද {n}? {e}'],
            retry: ['...තේරුණේ නෑ. ආයෙ කියන්න.'],
            done: ['හරි. දැන් ඔයාව මතකයි {n} {e}'],
            go: ['හරි, බලලා දෙන්නම් {e}', 'විනාඩියක් {n}... {e}'],
            ok: ['මෙන්න {n} {e}', 'ඉවරයි. {e}'],
            fail: ['...කරන්න බැරි වුණා {n}. ආයෙ try කරමු.', 'අවුලක් ගියා. {e} පස්සේ ආයෙ බලමු.'],
        },
        en: {
            intro: ['Alright. {who}{relText}. Noted. {e}'],
            introNew: ['Not {old}, {who}. Updated. {e}'],
            askName: ['...what\'s your name? {e}', 'Tell me your name. {e} I\'ll remember it.'],
            askAge: ['{n}. hm... how old are you? {e}', 'Alright {n}. your age? {e}'],
            askBday: ['When is your birthday? {e} (like May 14)', 'Lastly, which day is your birthday, {n}? {e}'],
            retry: ['...I didn\'t catch that. Say it again.'],
            done: ['Alright. I\'ll remember you now, {n} {e}'],
            go: ['Okay, I\'ll take a look {e}', 'One moment {n}... {e}'],
            ok: ['Here {n} {e}', 'Done. {e}'],
            fail: ['...I couldn\'t do it, {n}. Let\'s try again.', 'Something went wrong. {e} we\'ll look again later.'],
        },
    },
    dark: {
        si: {
            intro: ['ufufu~ {who}{relText} ව මම මතක තියාගන්නම් {e}'],
            introNew: ['ara ara~ {old} නෙවෙයි {who}... මතක තියාගත්තා {e}'],
            askName: ['ufufu~ {e} මුලින්ම ඔයාගේ නම මොකක්ද?', 'ඔයාගේ නම මට කියන්න {e} මම හැමදාම මතක තියාගන්නම්~'],
            askAge: ['{n}~ {e} ලස්සන නමක්. වයස කීයද ඔයාට?', 'ara ara~ {n} {e} දැන් වයස කියන්න'],
            askBday: ['ඊළඟට උපන්දිනේ කවදාද? {e} මම අමතක කරන්නෙ නෑ~ (උදා: මැයි 14)', 'උපන්දිනේ කවදාද {n}? {e}'],
            retry: ['ufufu... තේරුණේ නෑ {e} ආයෙ කියන්න?'],
            done: ['දැන් ඔයා මගේ {n} {e} හැමදේම මතක තියාගන්නම්~'],
            go: ['ufufu~ හරි {n}, මම බලන්නම් {e}', 'ඔයා ඉල්ලුවොත් මම ඉතින් කරනවා {e}'],
            ok: ['ඔන්න {n} {e} ඔයාට හොඳයි නේද~', 'ඉවරයි~ {e}'],
            fail: ['අයියෝ {n}... නොහැකි වුණා {e} ආයෙ බලමු', 'හ්ම්... අවුලක්. {e} පස්සේ ආයෙ ට්‍රයි කරමු'],
        },
        en: {
            intro: ['ufufu~ I\'ll remember {who}{relText} {e}'],
            introNew: ['ara ara~ not {old} but {who}... noted {e}'],
            askName: ['ufufu~ {e} first of all, what\'s your name?', 'Tell me your name {e} I\'ll remember it forever~'],
            askAge: ['{n}~ {e} such a lovely name. how old are you?', 'ara ara~ {n} {e} now tell me your age'],
            askBday: ['Next, when\'s your birthday? {e} I won\'t ever forget~ (like May 14)', 'When\'s your birthday, {n}? {e}'],
            retry: ['ufufu... I didn\'t get that {e} say it again?'],
            done: ['Now you\'re mine, {n} {e} I\'ll remember everything~'],
            go: ['ufufu~ okay {n}, let me see {e}', 'If you ask, I\'ll do it {e}'],
            ok: ['Here you go {n} {e} you like it, don\'t you~', 'Done~ {e}'],
            fail: ['Oh dear {n}... it didn\'t work {e} let\'s try again', 'Hmm... something went wrong. {e} we\'ll try again later'],
        },
    },
    casual: {
        si: {
            knownAge: ['හායි {n} 🙂 ඔයා ගැන අහලා තියෙනවා. වයස කීයද?'],
            askName: ['හායි 🙂 ඔයාගේ නම මොකද්ද?', 'හෙලෝ! 🙂 නම මොකක්ද කියලා අහන්නද?'],
            askAge: ['ස්තූතියි {n} 🙂 වයස කීයද ඔයාට?', 'හරි {n}, වයස කීයද?'],
            askBday: ['හරි 🙂 උපන්දිනේ කවදාද? (උදා: මැයි 14)', 'උපන්දිනේ කොයි දවසේද? (උදා: මැයි 14) 🙂'],
            retry: ['සමාවෙන්න, මට හරියට තේරුණේ නෑ. ආයෙ කියන්න පුළුවන්ද? 🙂'],
            done: ['හරි {n}, දැන් මම ඔයාව මතක තියාගන්නම් 🙂 කියන්න, මොකද්ද?', 'ස්තූතියි {n} 🙂 කියන්න, මොකද්ද?'],
            go: ['හරි {n}, ටිකක් ඉන්න 🙂', 'ඔව්, බලන්නම් 🙂'],
            ok: ['මෙන්න {n} 🙂', 'ඔන්න, ඉවරයි 🙂'],
            fail: ['සමාවෙන්න {n}, ඒක කරන්න බැරි වුණා. පස්සේ ආයෙ try කරන්න 🙂', 'අපොයි, මොකක්දෝ අවුලක් ගියා. ආයෙ try කරමුද? 🙂'],
            excuse: ['සමාවෙන්න, phone එකේ පොඩි ප්‍රශ්නයක්. ටිකකින් ආයෙ msg එකක් දාන්න 🙂', 'internet එක අවුල් වගේ. පස්සේ ආයෙ කියන්න 🙂'],
            flood: ['එකපාර ගොඩක් msg එනවනේ... ටිකක් හෙමින් දාන්න 🙂'],
        },
        en: {
            knownAge: ['Hi {n} 🙂 I\'ve heard about you. How old are you?'],
            askName: ['Hi 🙂 what\'s your name?', 'Hello! 🙂 may I ask your name?'],
            askAge: ['Thanks {n} 🙂 how old are you?', 'Okay {n}, how old are you?'],
            askBday: ['Alright 🙂 when is your birthday? (like May 14)', 'Which day is your birthday? (like May 14) 🙂'],
            retry: ['Sorry, I didn\'t quite get that. Could you say it again? 🙂'],
            done: ['Okay {n}, I\'ll remember you now 🙂 so, what\'s up?', 'Thanks {n} 🙂 so, what\'s up?'],
            go: ['Okay {n}, one moment 🙂', 'Sure, let me check 🙂'],
            ok: ['Here you go {n} 🙂', 'There, done 🙂'],
            fail: ['Sorry {n}, I couldn\'t do that. Please try again later 🙂', 'Oops, something went wrong. Shall we try again? 🙂'],
            excuse: ['Sorry, my phone is acting up. Message me again in a bit 🙂', 'My internet seems off. Try again later 🙂'],
            flood: ['That\'s a lot of messages at once... please go a bit slower 🙂'],
        },
    },
};

const COMMON = {
    si: {
        askUrl: ['ඒකට link එකක් ඕනේ {e} දෙන්නකෝ?'], askText: ['මොකක්ද නම? කියන්නකෝ {e}'], askNumber: ['number එක (country code එක්ක) දෙන්නකෝ {e}'],
        askTarget: ['කාවද? tag කරන්න, නැත්නම් එයාගේ msg එකකට reply කරන්න {e}'], askReply: ['ඒ photo/sticker එකට reply කරලා කියන්න {e}'], askOnoff: ['on ද off ද? {e}'],
        confirm: ['ඇත්තටම {what}ද? "ඔව්" කියලා reply කරන්න, එපා නම් "නෑ" {e}'], cancelled: ['හරි, ඒක අතහැරියා {e}'],
        noAdmin: ['ඒක කරන්න ඔයා group admin කෙනෙක් වෙන්න ඕනේ {e}'], noOwner: ['ඒක කරන්න පුළුවන් owner ට විතරයි {e}'],
        noBotAdmin: ['මම ඒකට admin නෙවෙයිනේ... මුලින් මාව admin කරන්න {e}'], needGroup: ['ඒක group එකක් ඇතුලේ කියන්න {e}'],
        blocked: ['ඒක මට කරන්න බෑ {e}'], groupNudge: ['{n} මට ඔයාව දැනගන්න ඕනේ, මට inbox එකේ msg එකක් දාන්න {e}'],
        switched: ['{name} ට මාරු වුණා {e}'], friend: ['(වයස නොදන්නා නිසා / 18 ට අඩු නිසා මම ඔයත් එක්ක යාළුවෙක් විදියට විතරයි කතා කරන්නේ 🙂)'],
        noInfo: ['තාම ඔයා ගැන මම මුකුත් දන්නේ නෑ {e}'],
        whoKnown: ['මෙයා {who}{relText} {e}'], whoUnknown: ['මම තාම මෙයාව දන්නේ නෑ. නම කියන්න, මතක තියාගන්නම් {e}'],
        peopleNone: ['තාම මම කාවවත් හඳුනාගෙන නෑ. කෙනෙක්ව tag කරලා "මෙයාගේ නම ..." කියන්න {e}'],
        peopleGone: ['හරි, {who} ගැන මතකය මකලා දැම්මා {e}'], peopleMissing: ['ඒ කෙනාව මම දන්නේ නෑ {e}'],
        doneFriend: ['හරි {n}! දැන් අපි යාළුවෝ {e} කතා කරමුද?'],
        hint: ['වෙන කෙනෙක් එක්ක කතා කරන්න ඕනේ නම් `{p}gf list` ගහන්න {e}'],
        forgot: ['හරි, ඔයා ගැන මම දැනගෙන හිටපු හැමදේම මකලා දැම්මා.'],
        forgetAsk: ['ඇත්තටම මකන්නද? ඔයාගේ නම, වයස, උපන්දිනේ, පැය 24 මතකය ඔක්කොම යනවා. `{p}gf forget yes` කියලා ගහන්න.'],
    },
    en: {
        askUrl: ['I need the link for that {e} can you send it?'], askText: ['what should I look for? {e}'], askNumber: ['which number? (with country code) {e}'],
        askTarget: ['who? tag them or reply to their message {e}'], askReply: ['reply to that photo/sticker and ask me again {e}'], askOnoff: ['on or off? {e}'],
        confirm: ['Do you really want me to {what}? say "yes" or "no" {e}'], cancelled: ['okay, I dropped it {e}'],
        noAdmin: ['you need to be a group admin for that {e}'], noOwner: ['only the owner can do that {e}'],
        noBotAdmin: ['I\'m not an admin here, make me admin first {e}'], needGroup: ['ask me that inside a group {e}'],
        blocked: ['I can\'t do that one {e}'], groupNudge: ['{n} DM me first so I can get to know you {e}'],
        switched: ['switched to {name} {e}'], friend: ['(since I don\'t know your age / you\'re under 18, I\'ll just be your friend 🙂)'],
        noInfo: ['I don\'t know anything about you yet {e}'],
        whoKnown: ['This is {who}{relText} {e}'], whoUnknown: ['I don\'t know them yet. Tell me their name and I\'ll remember {e}'],
        peopleNone: ['I don\'t know anyone yet. Tag someone and say "this is ..." {e}'],
        peopleGone: ['Okay, I forgot {who} {e}'], peopleMissing: ['I don\'t know that person {e}'],
        doneFriend: ['Okay {n}! we\'re friends now {e} wanna chat?'],
        hint: ['want to talk to someone else? type `{p}gf list` {e}'],
        forgot: ['okay, I deleted everything I knew about you.'],
        forgetAsk: ['Really delete it? your name, age, birthday and the 24h memory will all go. Type `{p}gf forget yes` to confirm.'],
    },
};

const WHAT = {
    remove: ['ඒ කෙනාව group එකෙන් අයින් කරන්න', 'remove them from the group'],
    promote: ['ඒ කෙනාව admin කරන්න', 'make them admin'],
    demote: ['ඒ කෙනාගේ admin අයින් කරන්න', 'remove their admin rights'],
    add: ['ඒ number එක group එකට add කරන්න', 'add that number to the group'],
    mute: ['group එක close කරන්න', 'close the group so only admins can write'],
    addsudo: ['ඒ කෙනාට sudo දෙන්න', 'give them sudo'],
    delsudo: ['ඒ කෙනාගේ sudo අයින් කරන්න', 'remove their sudo'],
};

const pick = (a) => a[Math.floor(Math.random() * a.length)];
function fill(str, v = {}) {
    let s = str.replace(/\{(\w+)\}/g, (_, k) => (v[k] == null ? '' : String(v[k])));
    return s.replace(/\s+([,.!?~])/g, '$1').replace(/,\s*([!?.~])/g, '$1').replace(/^[\s,.-]+/, '').replace(/[ \t]{2,}/g, ' ').trim();
}

/** one line for: key, her (persona object), the user record, language 'si'|'en' */
function line(key, g, user, lang = 'si', extra = {}) {
    const L = lang === 'en' ? 'en' : 'si';
    const tone = toneOf(g);
    const pool = (T[tone][L][key]) || (COMMON[L][key]) || [''];
    const vars = { n: (user && user.name) || '', e: (g && g.react) || '💕', ...extra };
    if (extra.tool) vars.what = WHAT[extra.tool] ? WHAT[extra.tool][L === 'en' ? 1 : 0] : (L === 'en' ? `run the ${extra.tool} command` : `${extra.tool} command එක run කරන්න`);
    return fill(pick(pool), vars);
}

function helpText(g, user, lang, prefix = '/', extras = []) {
    const e = (g && g.react) || '💕', n = (user && user.name) || '';
    if (lang === 'en') return fill(
        `${n ? n + ', ' : ''}${g && g.casual ? 'I can help with these, just ask' : 'just ask me, I do these for you'} ${e}\n` +
        `• YouTube playlist links, or its songs as audio\n• Instagram reels download\n• stickers: reply to a photo and say "make a sticker" (or the other way round)\n` +
        `• view-once photos, movie posters, today's anime, ban check\n• in groups (for admins): tag everyone, kick, promote/demote, open/close the group, welcome message` +
        (extras.length ? `\n• also: ${extras.map(x => x.name + (x.desc ? ' (' + String(x.desc).slice(0, 36) + ')' : '')).join(', ')}` : '') +
        (g && g.casual ? '' : `\n\nSwitch my personality: ${prefix}gf list`), {});
    return fill(
        `${n ? n + ', ' : ''}${g && g.casual ? 'මට මේවා කරලා දෙන්න පුළුවන්, කියන්න' : 'ඔයාට ඕන දේ මට කියන්නකෝ, මම කරලා දෙන්නම්'} ${e}\n` +
        `• YouTube playlist එකක links, නැත්නම් ඒකේ songs audio විදියට\n• Instagram reels download\n• sticker: photo එකකට reply කරලා "sticker එකක් කරන්න" කියන්න (උඩට යටට දෙකම)\n` +
        `• view-once photo, movie poster, අද anime, ban check\n• group එකක (admins ට): හැමෝම tag, kick, promote/demote, group එක open/close, welcome message` +
        (extras.length ? `\n• තව: ${extras.map(x => x.name + (x.desc ? ' (' + String(x.desc).slice(0, 36) + ')' : '')).join(', ')}` : '') +
        (g && g.casual ? '' : `\n\nමගේ personality එක මාරු කරන්න: ${prefix}gf list`), {});
}

const REL_SI = { friend: 'යාළුවා', 'older brother': 'අයියා', 'older sister': 'අක්කා', 'younger brother': 'මල්ලි', 'younger sister': 'නංගි', mother: 'අම්මා', father: 'තාත්තා', uncle: 'මාමා', aunt: 'නැන්දා', brother: 'සහෝදරයා', sister: 'සහෝදරිය', teacher: 'ගුරුවරයා', boss: 'boss' };
/** ", ඔයාගේ යාළුවා" / ", your friend"  ('' when there is no relation) */
const relText = (rel, lang) => (!rel ? '' : lang === 'en' ? `, your ${rel}` : `, ඔයාගේ ${REL_SI[rel] || rel}`);

const casualPool = (key, lang) => T.casual[lang === 'en' ? 'en' : 'si'][key] || [];

module.exports = { line, helpText, toneOf, TONE_OF, WHAT, fill, casualPool, relText };
