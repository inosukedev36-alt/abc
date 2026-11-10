const axios = require('axios');
const AdmZip = require('adm-zip');
const { cmd } = require('../command');

cmd({
    pattern: "posters",
    alias: ["poster"],
    desc: "Download movie/TV show posters",
    category: "download",
    react: "🎬"
},
async (conn, mek, m, { from, reply, q }) => {
    const movieName = q;
    if (!movieName) return reply('කරුණාකර movie හෝ TV show එකේ නම ලියන්න. (උදා: .posters Interstellar)');

    const TMDB_API_KEY = '0e12f115cbb3449f4362df9b87f2348b'; // ඔයාගේ Key එක අනිවාර්යයෙන් මෙතන තියෙන්න ඕනේ
    await reply(`🔍 *${movieName}* සඳහා posters සොයමින් පවතී...`);
    
    try {
        // 🛑 වෙනස් වුණු තැන: 'search/movie' වෙනුවට 'search/multi' පාවිච්චි කළා (Movies + TV)
        const searchUrl = `https://api.themoviedb.org/3/search/multi?api_key=${TMDB_API_KEY}&query=${encodeURIComponent(movieName)}&include_adult=true`;
        const searchRes = await axios.get(searchUrl);

        if (!searchRes.data.results || searchRes.data.results.length === 0) {
            return reply('❌ ඒ නමින් කිසිම දෙයක් හම්බුනේ නෑ.');
        }

        // Movie එකක් හෝ TV show එකක් වෙන්න ඕනේ (Person ලව් අයින් කරන්න)
        const result = searchRes.data.results.find(r => r.media_type === 'movie' || r.media_type === 'tv');
        
        if (!result) {
            return reply('❌ Movie එකක් හෝ TV Show එකක් හම්බුනේ නෑ.');
        }

        const mediaId = result.id;
        const mediaType = result.media_type; // 'movie' හෝ 'tv'
        const mediaTitle = result.title || result.name; // TV show වලට 'name' කියලා එන්නේ

        await reply(`🎬 *${mediaTitle}* (${mediaType === 'movie' ? 'Movie' : 'TV Series'}) හම්බුනා. Posters ටික ගන්නවා...`);

        // 🛑 අලුත් තැන: media type එක අනුව අදාළ එකෙන් posters ගන්නවා
        const imagesUrl = `https://api.themoviedb.org/3/${mediaType}/${mediaId}/images?api_key=${TMDB_API_KEY}`;
        const imagesRes = await axios.get(imagesUrl);
        const posters = imagesRes.data.posters;

        if (!posters || posters.length === 0) {
            return reply('❌ මේකට posters හම්බුනේ නෑ.');
        }

        const imageBaseUrl = 'https://image.tmdb.org/t/p/original'; 
        const postersPerZip = 15; 
        let zip = new AdmZip();
        let zipCount = 1;
        let posterCount = 0;

        const flush = async () => {
            if (posterCount === 0) return;
            const zipBuffer = zip.toBuffer();
            const safeFileName = `${mediaTitle.replace(/[^a-zA-Z0-9]/g, '_')}_Part_${zipCount}.zip`;
            zip = new AdmZip();
            const count = posterCount;
            posterCount = 0;
            await conn.sendMessage(from, {
                document: zipBuffer,
                mimetype: 'application/zip',
                fileName: safeFileName,
                caption: `📦 *${mediaTitle}* - Part ${zipCount} (${count})`
            }, { quoted: mek });
            zipCount++;
            await new Promise(r => setTimeout(r, 3000));
        };

        for (let i = 0; i < posters.length; i++) {
            try {
                const imgUrl = imageBaseUrl + posters[i].file_path;
                const imgRes = await axios.get(imgUrl, { responseType: 'arraybuffer' });
                zip.addFile(`poster_${i + 1}.jpg`, Buffer.from(imgRes.data, 'binary'));
                posterCount++;

                if (i % 3 === 0) await new Promise(r => setTimeout(r, 1000));
                if (posterCount >= postersPerZip) await flush();
            } catch (err) {
                console.error('Poster download error:', err.message);
            }
        }
        // Old code only flushed inside the loop, so the last (partial) zip was lost
        // whenever the final image failed to download or a send had thrown earlier.
        try { await flush(); } catch (err) { console.error('Poster send error:', err.message); }
    } catch (error) {
        console.error('TMDB Error:', error);
        reply('❌ මොකක් හරි අවුලක් ගියා.');
    }
});