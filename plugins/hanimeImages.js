const axios = require('axios');
const cheerio = require('cheerio');
const AdmZip = require('adm-zip');
const { cmd } = require('../command');

const CHANNELS = {
    '1': 'media',
    '2': 'nsfw-general',
    '3': 'furry',
    '4': 'futa',
    '5': 'yaoi',
    '6': 'yuri',
    '7': 'traps',
    '8': 'irl-3d'
};

cmd({
    pattern: "hanimeimg",
    alias: ["himage"],
    desc: "Get images by channel number from hanime.tv",
    category: "download",
    react: "🖼️"
},
async (conn, mek, m, { from, reply, q }) => {
    const query = q ? q.trim().toLowerCase().replace(/\s+/g, '') : '';

    if (query === 'help') {
        let helpMsg = `📋 *Hanime Image Channels (1 - 8):*\n\n`;
        helpMsg += `1️⃣ media\n2️⃣ nsfw-general\n3️⃣ furry\n4️⃣ futa\n5️⃣ yaoi\n6️⃣ yuri\n7️⃣ traps\n8️⃣ irl-3d\n\n`;
        helpMsg += `*භාවිතය:* \n`;
        helpMsg += `• \`.hanimeimg 1\` (එකක් පමණක්)\n`;
        helpMsg += `• \`.hanimeimg 1,2,3\` (කිහිපයක්)\n`;
        helpMsg += `• \`.hanimeimg 1,2,3,4,5,6,7\` (channel 7ක් එකපාර)\n`;
        helpMsg += `• \`.hanimeimg\` (ඔක්කොම)`;
        return reply(helpMsg);
    }

    let channelParam = '';
    let loadingMsg = '🖼️ සියලුම channels වලින් අලුත්ම images ගන්නවා...';
    let selectedChannelNames = [];

    if (query.length > 0) {
        const parts = query.split(',');
        const mappedChannels = [];
        
        for (let part of parts) {
            part = part.trim();
            if (CHANNELS[part]) {
                mappedChannels.push(CHANNELS[part]);
            } else if (Object.values(CHANNELS).includes(part)) {
                mappedChannels.push(part);
            }
        }
        
        if (mappedChannels.length > 0) {
            channelParam = `channels=${encodeURIComponent(mappedChannels.join(','))}`;
            selectedChannelNames = mappedChannels;
            loadingMsg = `🔍 *${mappedChannels.join(', ')}* (channels ${mappedChannels.length}ක්) වලින් images 100ක් සොයමින් පවතී...`;
        } else {
            return reply('❌ ඔයා දීපු channel අංකය හරියටම හඳුනාගන්න බැරි වුණා. (.hanimeimg help ගහලා බලන්න)');
        }
    } else {
        loadingMsg = '🖼️ සියලුම channels වලින් අලුත්ම images 100ක් ගන්නවා...';
    }

    await reply(loadingMsg);

    const SCRAPER_API_KEY = 'f909b655aac3dce76db22bee716dbab8'; 
    const maxImages = 100; 
    let uniqueImages = [];
    let currentPage = 1;
    const maxPages = 6; // උපරිම පිටු 6ක් බලනවා

    try {
        while (uniqueImages.length < maxImages && currentPage <= maxPages) {
            let url = `https://hanime.tv/browse/images?page=${currentPage}`;
            if (channelParam) {
                url += `&${channelParam}`;
            }

            console.log(`Fetching Page ${currentPage}...`);
            
            // ✅ මෙතන තමයි වෙනස්කම: render=true දැම්මා
            const apiUrl = `http://api.scraperapi.com?api_key=${SCRAPER_API_KEY}&render=true&url=${encodeURIComponent(url)}`;
            
            const response = await axios.get(apiUrl, { timeout: 60000 }); // Render වෙන්න වෙලා යන නිසා timeout එක වැඩි කළා
            const html = response.data;

            if (html.includes('Just a moment...')) {
                return reply('❌ Cloudflare ආරක්ෂණය මගහරින්න බැරි වුණා. (ScraperAPI limit එක ඉවර වෙන්න ඇති)');
            }

            const $ = cheerio.load(html);
            let pageImages = [];
            
            $('img').each((i, el) => {
                let src = $(el).attr('data-src') || $(el).attr('data-original') || $(el).attr('src'); 
                
                if (src) {
                    if (src.startsWith('//')) src = 'https:' + src;
                    
                    if (src.startsWith('http')) {
                        const isImage = src.match(/\.(jpeg|jpg|gif|png|webp)/i);
                        const isNotUi = !src.includes('logo') && !src.includes('avatar') && !src.includes('icon') && !src.includes('placeholder');
                        
                        if (isImage && isNotUi && !src.startsWith('data:image')) {
                            let highResSrc = src.replace('_200.webp', '.webp');
                            pageImages.push(highResSrc);
                        }
                    }
                }
            });

            // අලුත් ෆොටෝ ටික පරණ ඒවා එක්ක එකතු කරනවා (ඩුප්ලිකේට් අයින් කරලා)
            pageImages.forEach(img => {
                if (!uniqueImages.includes(img)) {
                uniqueImages.push(img);
                }
            });

            console.log(`Page ${currentPage} එකෙන් හම්බුනේ: ${pageImages.length}. මේ වෙනකන් එකතුව: ${uniqueImages.length}`);

            currentPage++;
            
            // පිටු පිටු අතරේ විරාමයක්
            if (uniqueImages.length < maxImages && currentPage <= maxPages) {
                await new Promise(r => setTimeout(r, 2000));
            }
        }

        if (uniqueImages.length === 0) return reply('❌ කිසිම image එකක් හම්බුනේ නෑ.');

        const selectedImages = uniqueImages.slice(0, maxImages);
        await reply(`🖼️ Images ${selectedImages.length}ක් හම්බුනා. Zip කරමින් සහ ලින්ක්ස් හදමින්... (මේකට ටිකක් වෙලා යයි)`);

        const zip = new AdmZip();
        let downloadedUrls = []; 

        for (let i = 0; i < selectedImages.length; i++) {
            try {
                let finalUrl = selectedImages[i];
                let imgRes;
                
                try {
                    imgRes = await axios.get(finalUrl, { 
                        responseType: 'arraybuffer', 
                        headers: { 'User-Agent': 'Mozilla/5.0', 'Referer': 'https://hanime.tv/' } 
                    });
                } catch (err) {
                    if (err.response && err.response.status === 404) {
                        finalUrl = finalUrl.replace('.webp', '.jpg');
                        imgRes = await axios.get(finalUrl, { 
                            responseType: 'arraybuffer', 
                            headers: { 'User-Agent': 'Mozilla/5.0', 'Referer': 'https://hanime.tv/' } 
                        });
                    } else {
                        throw err;
                    }
                }
                
                let ext = finalUrl.includes('.webp') ? 'webp' : 'jpg';
                zip.addFile(`image_${i + 1}.${ext}`, Buffer.from(imgRes.data, 'binary'));
                
                downloadedUrls.push(`${i + 1}. ${finalUrl}`);
                
                if (i % 5 === 0) await new Promise(r => setTimeout(r, 1000));
            } catch (err) {
                console.error(`Image ${i+1} download error:`, err.message);
            }
        }

        let zipName = selectedChannelNames.length > 0 
            ? `Hanime_${selectedChannelNames.length}Channels_${downloadedUrls.length}img_${Date.now()}.zip` 
            : `Hanime_All_${downloadedUrls.length}img_${Date.now()}.zip`;

        await conn.sendMessage(from, {
            document: zip.toBuffer(),
            mimetype: 'application/zip',
            fileName: zipName,
            caption: `✅ Images ${downloadedUrls.length}ක් Zip කරලා මෙන්න!\n\n_(ලින්ක්ස් ටික ඊළඟ මැසේජ් එකෙන් එවන්නම්)_`
        }, { quoted: mek });

        if (downloadedUrls.length > 0) {
            let urlText = `🔗 *Downloaded Image Links (${downloadedUrls.length}):*\n\n`;
            urlText += downloadedUrls.join('\n\n');
            
            await conn.sendMessage(from, { text: urlText }, { quoted: mek });
        }

    } catch (error) {
        console.error('Hanime Error:', error.message || error);
        reply('❌ මොකක් හරි අවුලක් ගියා.');
    }
});