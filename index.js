const {
    default: makeWASocket,
    useMultiFileAuthState,
    DisconnectReason,
    fetchLatestBaileysVersion,
    jidNormalizedUser
} = require('@whiskeysockets/baileys');
const TelegramBot = require('node-telegram-bot-api');
const pino        = require('pino');
const fs          = require('fs');
const path        = require('path');
const axios       = require('axios');
require('dotenv').config();

// ── Config ──────────────────────────────────────────
const TG_TOKEN  = process.env.TELEGRAM_BOT_TOKEN;
const BOT_NAME  = 'GENIUS MD BOT';
const DEVELOPER = 'ADITYA';
const YT_LINK   = 'https://www.youtube.com/@geniushacker29';
const BOT_IMG   = 'https://i.ibb.co/rKbKJ3kx/129600.png';

if (!TG_TOKEN) { console.log('❌ .env mein TELEGRAM_BOT_TOKEN daalo!'); process.exit(1); }

// Sessions dir
const SESSIONS_DIR = process.env.SESSIONS_DIR || path.join(__dirname, 'sessions');
fs.mkdirSync(SESSIONS_DIR, { recursive: true });
['tmp','temp'].forEach(d => fs.mkdirSync(path.join(__dirname, d), { recursive: true }));

const tgBot   = new TelegramBot(TG_TOKEN, { polling: true });
const sessions = {};
const warns    = {};

// ── yt-search optional ───────────────────────────────
let yts = null;
try { yts = require('yt-search'); } catch(e) { console.log('yt-search nahi mila'); }

// ── Gali list ────────────────────────────────────────
const GALI = [
    'madarchod','maderchod','bhenchod','bsdk','chutiya','chutiye',
    'randi','harami','kamina','gandu','gaandu','bhosdike','bhosdi',
    'lauda','lund','fuck','fucker','fucking','bitch','bastard',
    'asshole','motherfucker','bc','mc','lode','maa ki','baap ki',
    'sala','saala','haramzada','kutte','kamine','ullu','gadha'
];
function hasGali(t) {
    if (!t) return false;
    const l = t.toLowerCase().replace(/[^a-zऀ-ॿ ]/g, ' ');
    return GALI.some(w => l.includes(w));
}
function isEmojiOnly(t) {
    if (!t?.trim()) return false;
    const clean = t.replace(/[\u{1F000}-\u{1FFFF}]|[\u{2600}-\u{27BF}]|[\u{1F300}-\u{1F9FF}]|[©®™ℹ‼⁉⃣↔-↙↩↪⌚⌛⏩-⏳Ⓜ▪▫▶◀◻-◾☀-☄☎☑☔☕☸-☺♈-♓♿✂✅✈-✍✒✔✖✨✳✴❄❇❌❎❓-❗❣❤➕-➗➡➰➿⤴⤵⬅-⬇⬛⬜⭐⭕〰〽㊗㊙]/gu,'').replace(/\s/g,'').trim();
    return clean.length === 0;
}

// ── Axios helper ─────────────────────────────────────
const AX = {
    timeout: 60000,
    headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36', 'Accept': '*/*' }
};

// ── Converter ────────────────────────────────────────
const { toAudio } = require('./lib/converter');

function detectAudioFormat(buf) {
    if (!buf || buf.length < 12) return 'mp3';
    const hex  = buf.slice(0, 4).toString('hex');
    const ftyp = buf.slice(4, 8).toString('ascii');
    if (ftyp === 'ftyp') return 'm4a';
    if (buf.slice(0, 4).toString('ascii') === 'OggS') return 'ogg';
    if (buf.slice(0, 4).toString('ascii') === 'RIFF') return 'wav';
    if (hex === '1a45dfa3') return 'webm';
    return 'mp3';
}

// ── Song Download ─────────────────────────────────────
async function songDownload(sock, from, msg, query) {
    if (!query) {
        await sock.sendMessage(from, { text: '❌ Song naam daalo!\n*Example:* .song Tum Hi Ho' }, { quoted: msg });
        return;
    }
    for (const e of ['📥','⏳','🎵']) {
        try { await sock.sendMessage(from, { react: { text: e, key: msg.key } }); } catch {}
    }
    let ytUrl = query, title = query, thumb = BOT_IMG, duration = '';
    if (!query.includes('youtube.com') && !query.includes('youtu.be')) {
        if (!yts) { await sock.sendMessage(from, { text: '❌ npm install karo pehle!' }, { quoted: msg }); return; }
        const res = await yts(query);
        if (!res?.videos?.length) { await sock.sendMessage(from, { text: '❌ Song nahi mila!' }, { quoted: msg }); return; }
        const v = res.videos[0];
        ytUrl = v.url; title = v.title; thumb = v.thumbnail; duration = v.timestamp || '';
    }
    await sock.sendMessage(from, {
        image: { url: thumb || BOT_IMG },
        caption: `🎵 *Downloading:* ${title}\n⏱ ${duration}\n⏳ Wait karo...\n\n⚡ ${BOT_NAME}`
    }, { quoted: msg });

    const songApis = [
        { url: `https://eliteprotech-apis.zone.id/ytdown?url=${encodeURIComponent(ytUrl)}&format=mp3`,
          parse: d => ({ dl: d?.downloadURL, title: d?.title }) },
        { url: `https://api.vreden.my.id/api/ytmp3?url=${encodeURIComponent(ytUrl)}`,
          parse: d => ({ dl: d?.result?.download?.url, title: d?.result?.metadata?.title }) },
        { url: `https://api.yupra.my.id/api/downloader/ytmp3?url=${encodeURIComponent(ytUrl)}`,
          parse: d => ({ dl: d?.data?.download_url, title: d?.data?.title }) },
        { url: `https://okatsu-rolezapiiz.vercel.app/downloader/ytmp3?url=${encodeURIComponent(ytUrl)}`,
          parse: d => ({ dl: d?.dl, title: d?.title }) },
        { url: `https://api.alyachan.pro/api/ytmp3?url=${encodeURIComponent(ytUrl)}&apikey=G7I6X7`,
          parse: d => ({ dl: d?.data?.url, title: d?.data?.title }) },
    ];
    let dlUrl = null, finalTitle = title;
    for (const api of songApis) {
        try {
            const r = await axios.get(api.url, { ...AX, timeout: 30000 });
            const parsed = api.parse(r.data);
            if (parsed?.dl) { dlUrl = parsed.dl; finalTitle = parsed.title || title; break; }
        } catch(e) {}
    }
    if (!dlUrl) { await sock.sendMessage(from, { text: '❌ Song nahi mila!\nDoosra naam try karo.' }, { quoted: msg }); return; }

    const audioRes = await axios.get(dlUrl, { ...AX, responseType: 'arraybuffer', timeout: 120000 });
    let audioBuf = Buffer.from(audioRes.data);
    const ext = detectAudioFormat(audioBuf);
    if (ext !== 'mp3') {
        try { audioBuf = await toAudio(audioBuf, ext); } catch(e) { console.log('Convert error:', e.message); }
    }
    const safeName = finalTitle.replace(/[^\w\s-]/g, '').trim() || 'song';
    await sock.sendMessage(from, {
        audio: audioBuf, mimetype: 'audio/mpeg',
        fileName: `${safeName}.mp3`, ptt: false
    }, { quoted: msg });
    await sock.sendMessage(from, { text: `✅ *${finalTitle}*\n\n👑 ${DEVELOPER}\n⚡ ${BOT_NAME}` });
}

// ── YT Video Download ─────────────────────────────────
async function ytVideoDownload(sock, from, msg, query) {
    if (!query) { await sock.sendMessage(from, { text: '❌ naam ya link daalo!\n*Example:* .ytv Alan Walker Faded' }, { quoted: msg }); return; }
    for (const e of ['📥','⏳','🎬']) {
        try { await sock.sendMessage(from, { react: { text: e, key: msg.key } }); } catch {}
    }
    let ytUrl = query, title = query, thumb = BOT_IMG;
    if (!query.includes('youtube.com') && !query.includes('youtu.be')) {
        if (!yts) { await sock.sendMessage(from, { text: '❌ yt-search install karo' }, { quoted: msg }); return; }
        const res = await yts(query);
        if (!res?.videos?.length) { await sock.sendMessage(from, { text: '❌ Video nahi mila!' }, { quoted: msg }); return; }
        const v = res.videos[0];
        ytUrl = v.url; title = v.title; thumb = v.thumbnail;
    }
    await sock.sendMessage(from, { image: { url: thumb }, caption: `🎬 *Downloading:* ${title}\n⏳ Wait karo...` }, { quoted: msg });

    const videoApis = [
        `https://eliteprotech-apis.zone.id/ytdown?url=${encodeURIComponent(ytUrl)}&format=mp4`,
        `https://api.vreden.my.id/api/ytmp4?url=${encodeURIComponent(ytUrl)}`,
        `https://okatsu-rolezapiiz.vercel.app/downloader/ytmp4?url=${encodeURIComponent(ytUrl)}`
    ];
    let dlUrl = null, finalTitle = title;
    for (const apiUrl of videoApis) {
        try {
            const r = await axios.get(apiUrl, { ...AX, timeout: 30000 });
            const d = r.data;
            const url = d?.downloadURL || d?.result?.download?.url || d?.dl;
            if (url) { dlUrl = url; finalTitle = d?.title || d?.result?.metadata?.title || title; break; }
        } catch(e) {}
    }
    if (!dlUrl) { await sock.sendMessage(from, { text: '❌ Video nahi mila!\nYouTube link directly try karo.' }, { quoted: msg }); return; }
    await sock.sendMessage(from, {
        video: { url: dlUrl },
        caption: `✅ *${finalTitle}*\n\n👑 ${DEVELOPER}\n⚡ ${BOT_NAME}`,
        mimetype: 'video/mp4'
    }, { quoted: msg });
}

// ── Instagram Download ────────────────────────────────
async function instaDownload(sock, from, msg, url) {
    if (!url || !url.includes('instagram.com')) {
        await sock.sendMessage(from, { text: '❌ Instagram link daalo!\n*Example:* .insta https://instagram.com/reel/xxx' }, { quoted: msg }); return;
    }
    for (const e of ['📥','⏳','📸']) {
        try { await sock.sendMessage(from, { react: { text: e, key: msg.key } }); } catch {}
    }
    await sock.sendMessage(from, { text: '📥 Instagram se download ho raha hai...' }, { quoted: msg });
    const instaApis = [
        async () => { const r = await axios.get(`https://api.vreden.my.id/api/igdownload?url=${encodeURIComponent(url)}`, AX); if (r?.data?.status && r?.data?.result?.length) return r.data.result; throw new Error('fail'); },
        async () => { const r = await axios.get(`https://okatsu-rolezapiiz.vercel.app/downloader/instagram?url=${encodeURIComponent(url)}`, AX); if (r?.data?.result?.length) return r.data.result; throw new Error('fail'); },
        async () => { const r = await axios.get(`https://api.yupra.my.id/api/downloader/ig?url=${encodeURIComponent(url)}`, AX); if (r?.data?.data?.length) return r.data.data; throw new Error('fail'); }
    ];
    let mediaList = null;
    for (const api of instaApis) {
        try { mediaList = await api(); if (mediaList?.length) break; } catch {}
    }
    if (!mediaList?.length) { await sock.sendMessage(from, { text: '❌ Download fail!\nPublic post ka link daalo.' }, { quoted: msg }); return; }
    for (const item of mediaList.slice(0, 5)) {
        const mUrl = item.url || item.download_url || item.src;
        const isVid = item.type === 'video' || /\.(mp4|mov)/i.test(mUrl);
        try {
            await sock.sendMessage(from, isVid
                ? { video: { url: mUrl }, caption: `✅ Instagram Video\n\n👑 ${DEVELOPER}\n⚡ ${BOT_NAME}` }
                : { image: { url: mUrl }, caption: `✅ Instagram Image\n\n👑 ${DEVELOPER}\n⚡ ${BOT_NAME}` }
            , { quoted: msg });
        } catch {}
    }
}

// ── Bot Text Messages ─────────────────────────────────
function welcomeMsg(name, group) {
    return `╔══════════════════════════════╗
║      ⚡ GENIUS MD BOT ⚡      ║
║    👑  Developer: ADITYA      ║
╚══════════════════════════════╝

🎉 *Welcome to ${group}!*
👋 Aayo *${name}* bhai!

📌 *Rules:*
✅ Sabka izzat karo
🚫 Gali = Instant KICK
🚫 Sirf Emoji = Instant KICK
🚫 Spam/Link = Delete + Warning

📋 Commands: *.menu*

👑 *${DEVELOPER}*
🔗 ${YT_LINK}
⚡ *${BOT_NAME}*`;
}

const RULES_MSG = `╔══════════════════════════════╗
║      ⚡ GENIUS MD BOT ⚡      ║
║        📋  GROUP RULES        ║
╚══════════════════════════════╝

1️⃣ Sabka izzat karo
2️⃣ Gali = KICK
3️⃣ Sirf Emoji = KICK
4️⃣ Spam/Link = Warning
5️⃣ Kisi ko bully mat karo
6️⃣ Fake news mat failao
7️⃣ Topic pe raho

⚠️ *3 Warnings = Auto KICK!*

👑 *${DEVELOPER}*
⚡ *${BOT_NAME}*`;

const MENU_MSG = `╔══════════════════════════════╗
║      ⚡ GENIUS MD BOT ⚡      ║
║    👑  Developer: ADITYA      ║
╚══════════════════════════════╝

📋 *COMMANDS:*

🎵 *Music & Video (Private + Group):*
➤ \`.song <naam>\` — Song download
➤ \`.ytv <naam/link>\` — YouTube video
➤ \`.insta <link>\` — Instagram download

🤖 *Fun (Private + Group):*
➤ \`.joke\` — Random joke
➤ \`.quote\` — Motivational quote
➤ \`.time\` — India ka time
➤ \`.ping\` — Bot check
➤ \`.info\` — Bot info
➤ \`.menu\` — Ye menu

👥 *Group Only (Admin):*
➤ \`.tagall\` — Sabko tag karo
➤ \`.kick @user\` — Kick karo
➤ \`.warn @user\` — Warning do
➤ \`.rules\` — Group rules
➤ \`.ginfo\` — Group info

🛡️ *Auto Protection (Groups):*
✅ Anti-Gali → KICK
✅ Anti-Emoji only → KICK
✅ Anti-Link → Delete + Warn
✅ Auto Welcome

👑 ${DEVELOPER}
🔗 ${YT_LINK}
⚡ ${BOT_NAME}`;

const JOKES = [
    "Teacher: Future use karo sentence mein!\nStudent: Main future mein school nahi aaunga! 😂",
    "Doctor: Kya problem hai?\nAadmi: Main invisible hun!\nDoctor: Next patient! 😂",
    "Wife: Prove karo pyaar karte ho!\nHusband: Maine remote uthaya! 😂",
    "Beta: Papa first aaya main!\nPapa: Class mein?\nBeta: Ghar mein! 😂",
    "Exam mein question dekha: Explain in detail\nMain: Bhai detail toh question mein hi nahi hai! 😂"
];
const QUOTES = [
    "⚡ *Sapne wo nahi jo sote waqt aate hain, sapne wo hain jo sone nahi dete!*\n— A.P.J Abdul Kalam",
    "⚡ *Haar tabhi hoti hai jab tum khud haar maan lo!*",
    "⚡ *Jo girne ke baad uthna jaanta hai wahi aage jaata hai!*",
    "⚡ *Mushkilein manzil tak pahuncha deti hain!*",
    "⚡ *Mehnat karo, results aenge!*\n— ADITYA"
];

// ══════════════════════════════════════════════════════
//  Session Class
// ══════════════════════════════════════════════════════
class Session {
    constructor(chatId) {
        this.chatId   = chatId;
        this.authPath = path.join(SESSIONS_DIR, chatId);
        this.sock     = null;
        fs.mkdirSync(this.authPath, { recursive: true });
    }

    async start(phone) {
        const { state, saveCreds } = await useMultiFileAuthState(this.authPath);
        const { version } = await fetchLatestBaileysVersion();

        this.sock = makeWASocket({
            version, auth: state,
            printQRInTerminal: false,
            logger: pino({ level: 'silent' }),
            browser: [BOT_NAME, 'Chrome', '3.0'],
            markOnlineOnConnect: false,
        });

        this.sock.ev.on('creds.update', saveCreds);

        // ── Connection update ────────────────────────
        this.sock.ev.on('connection.update', async ({ connection, lastDisconnect }) => {
            if (connection === 'open') {
                const num = this.sock.user?.id?.split(':')[0] || phone;
                console.log(`[WA] ${num} connected`);
                await tgBot.sendMessage(this.chatId,
`✅ *${BOT_NAME} CONNECTED!*

📱 Number: ${num}
👑 Developer: ${DEVELOPER}
⚡ Bot ready!

Ab WhatsApp pe *.menu* bhejo!`,
                    { parse_mode: 'Markdown' });
            }
            if (connection === 'close') {
                const code   = lastDisconnect?.error?.output?.statusCode;
                const logout = code === DisconnectReason.loggedOut;
                if (!logout) {
                    console.log(`[WA] Reconnecting... (code: ${code})`);
                    setTimeout(() => this.start(null), 5000);
                } else {
                    await tgBot.sendMessage(this.chatId,
                        `❌ Logout ho gaya!\nDobara number bhejo: /pair <number>`);
                    fs.rmSync(this.authPath, { recursive: true, force: true });
                    delete sessions[this.chatId];
                }
            }
        });

        // ── Pairing code ─────────────────────────────
        if (phone && !this.sock.authState.creds.registered) {
            await new Promise(r => setTimeout(r, 3000));
            try {
                const code = await this.sock.requestPairingCode(phone);
                const fmt  = code?.match(/.{1,4}/g)?.join('-') || code;
                await tgBot.sendMessage(this.chatId,
`🔑 *PAIRING CODE:*

\`${fmt}\`

*WhatsApp mein steps:*
1️⃣ WhatsApp kholo
2️⃣ 3 dots (⋮) ya Settings
3️⃣ *Linked Devices*
4️⃣ *Link a Device*
5️⃣ *Link with phone number*
6️⃣ Upar wala code daalo ✅`,
                    { parse_mode: 'Markdown' });
            } catch(e) {
                await tgBot.sendMessage(this.chatId, `❌ Pairing error: ${e.message}\nDobara try karo.`);
            }
        }

        // ── Messages ──────────────────────────────────
        this.sock.ev.on('messages.upsert', async ({ messages, type }) => {
            if (type !== 'notify') return;

            for (const msg of messages) {
                try {
                    if (!msg.message) continue;

                    const from    = msg.key.remoteJid;
                    if (!from || from === 'status@broadcast') continue;

                    const isGroup  = from.endsWith('@g.us');
                    const isFromMe = msg.key.fromMe;
                    const sender   = msg.key.participant || from;
                    const senderN  = sender.split('@')[0];

                    const text = msg.message?.conversation
                        || msg.message?.extendedTextMessage?.text
                        || msg.message?.imageMessage?.caption
                        || msg.message?.videoMessage?.caption
                        || '';

                    const S    = this.sock;
                    const cmd  = text.trim();
                    const cmdL = cmd.toLowerCase();

                    if (!cmdL.startsWith('.')) continue;

                    const reply = (t) => S.sendMessage(from, { text: t }, { quoted: msg });

                    // ── Group info (for admin checks) ──
                    let meta = null, admins = [], botAdmin = false, isAdmin = false, allJids = [];
                    if (isGroup) {
                        try {
                            meta     = await S.groupMetadata(from);
                            admins   = meta.participants.filter(p => p.admin);
                            const bj = jidNormalizedUser(S.user.id);
                            botAdmin = admins.some(a => jidNormalizedUser(a.id) === bj);
                            isAdmin  = isFromMe || admins.some(a => jidNormalizedUser(a.id) === jidNormalizedUser(sender));
                            allJids  = meta.participants.map(p => p.id);
                        } catch {}
                    }

                    // ════════════════════════════════════
                    // COMMANDS (Private + Group dono mein)
                    // ════════════════════════════════════

                    if (cmdL === '.menu' || cmdL === '.help') {
                        await S.sendMessage(from, { image: { url: BOT_IMG }, caption: MENU_MSG });
                        continue;
                    }

                    if (cmdL === '.ping') {
                        const t = Date.now();
                        await reply(`🏓 Pong!\n⚡ Speed: ${Date.now()-t}ms\n\n👑 ${DEVELOPER}\n⚡ ${BOT_NAME}`);
                        continue;
                    }

                    if (cmdL === '.info' || cmdL === '.about') {
                        await S.sendMessage(from, {
                            image: { url: BOT_IMG },
                            caption: `╔══════════════════════════════╗\n║      ⚡ GENIUS MD BOT ⚡      ║\n╚══════════════════════════════╝\n\n👑 *Developer:* ${DEVELOPER}\n🔗 ${YT_LINK}\n\n✅ Private + Group Support\n🎵 Song Download\n🎬 YouTube Video\n📸 Instagram Download\n🛡️ Auto Protection\n\n⚡ ${BOT_NAME}`
                        }, { quoted: msg });
                        continue;
                    }

                    if (cmdL === '.joke') {
                        await reply(`😂 *JOKE!*\n\n${JOKES[Math.floor(Math.random()*JOKES.length)]}\n\n⚡ ${BOT_NAME}`);
                        continue;
                    }

                    if (cmdL === '.quote') {
                        await reply(`💡 *QUOTE*\n\n${QUOTES[Math.floor(Math.random()*QUOTES.length)]}\n\n⚡ ${BOT_NAME}`);
                        continue;
                    }

                    if (cmdL === '.time') {
                        await reply(`🕐 *TIME (IST)*\n📅 ${new Date().toLocaleString('en-IN',{timeZone:'Asia/Kolkata'})}\n\n⚡ ${BOT_NAME}`);
                        continue;
                    }

                    // Song download
                    if (cmdL.startsWith('.song')) {
                        const q = cmd.slice(5).trim();
                        try { await songDownload(S, from, msg, q); }
                        catch(e) { await reply(`❌ Song Error: ${e.message}`); }
                        continue;
                    }

                    // YT video
                    if (cmdL.startsWith('.ytv')) {
                        const q = cmd.slice(4).trim();
                        try { await ytVideoDownload(S, from, msg, q); }
                        catch(e) { await reply(`❌ YT Error: ${e.message}`); }
                        continue;
                    }

                    // Instagram
                    if (cmdL.startsWith('.insta') || cmdL.startsWith('.ig ')) {
                        const q = cmd.replace(/^\.(insta|ig)\s*/i,'').trim();
                        try { await instaDownload(S, from, msg, q); }
                        catch(e) { await reply(`❌ Insta Error: ${e.message}`); }
                        continue;
                    }

                    // ════════════════════════════════════
                    // GROUP ONLY COMMANDS
                    // ════════════════════════════════════
                    if (!isGroup) {
                        if (['.rules','.ginfo','.tagall','.kick','.warn'].some(c => cmdL.startsWith(c))) {
                            await reply(`❌ Ye command sirf groups mein kaam karta hai!`);
                        }
                        continue;
                    }

                    if (cmdL === '.rules') {
                        await S.sendMessage(from, { text: RULES_MSG }); continue;
                    }

                    if (cmdL === '.ginfo') {
                        if (meta) {
                            await reply(`╔══════════════════╗\n║  📊 GROUP INFO   ║\n╚══════════════════╝\n\n📌 *Naam:* ${meta.subject}\n👥 *Members:* ${meta.participants.length}\n👑 *Admins:* ${admins.length}\n📝 *Desc:* ${meta.desc||'N/A'}\n\n⚡ ${BOT_NAME}`);
                        }
                        continue;
                    }

                    // Admin-only group commands
                    if (cmdL === '.tagall' && isAdmin) {
                        let t = `📢 *ATTENTION!*\n\n`;
                        allJids.forEach(j => { t += `@${j.split('@')[0]} `; });
                        await S.sendMessage(from, { text: t + `\n\n⚡ ${BOT_NAME}`, mentions: allJids });
                        continue;
                    }

                    if (cmdL.startsWith('.kick') && isAdmin) {
                        const target = msg.message?.extendedTextMessage?.contextInfo?.mentionedJid?.[0];
                        if (target) {
                            await S.sendMessage(from, { text: `🚫 @${target.split('@')[0]} KICK!\n⚡ ${BOT_NAME}`, mentions: [target] });
                            await S.groupParticipantsUpdate(from, [target], 'remove');
                        } else { await reply('❌ .kick @user likhna hai'); }
                        continue;
                    }

                    if (cmdL.startsWith('.warn') && isAdmin) {
                        const target = msg.message?.extendedTextMessage?.contextInfo?.mentionedJid?.[0];
                        if (target) {
                            const key = `${target}:${from}`;
                            warns[key] = (warns[key] || 0) + 1;
                            if (warns[key] >= 3) {
                                await S.sendMessage(from, { text: `⚠️ @${target.split('@')[0]} 3 warnings → KICK!\n⚡ ${BOT_NAME}`, mentions: [target] });
                                await S.groupParticipantsUpdate(from, [target], 'remove');
                                delete warns[key];
                            } else {
                                await S.sendMessage(from, { text: `⚠️ @${target.split('@')[0]} Warning ${warns[key]}/3\n⚡ ${BOT_NAME}`, mentions: [target] });
                            }
                        } else { await reply('❌ .warn @user likhna hai'); }
                        continue;
                    }

                    // ── Auto Safety (Groups only) ──────
                    if (!isGroup || !botAdmin || isAdmin || isFromMe) continue;

                    if (hasGali(text)) {
                        await S.sendMessage(from, { text: `🚫 @${senderN} *GALI MANA HAI!* → KICK!\n👑 ${DEVELOPER}\n⚡ ${BOT_NAME}`, mentions: [sender] });
                        await new Promise(r => setTimeout(r, 1000));
                        await S.groupParticipantsUpdate(from, [sender], 'remove');
                        continue;
                    }
                    if (isEmojiOnly(text)) {
                        await S.sendMessage(from, { text: `🚫 @${senderN} *Sirf emoji MANA!* → KICK!\n👑 ${DEVELOPER}\n⚡ ${BOT_NAME}`, mentions: [sender] });
                        await new Promise(r => setTimeout(r, 1000));
                        await S.groupParticipantsUpdate(from, [sender], 'remove');
                        continue;
                    }
                    if (/(https?:\/\/|www\.|t\.me\/|chat\.whatsapp\.com\/)/i.test(text)) {
                        await S.sendMessage(from, { text: `🚫 @${senderN} *Link MANA!* → Warning!\n👑 ${DEVELOPER}\n⚡ ${BOT_NAME}`, mentions: [sender] });
                        try { await S.sendMessage(from, { delete: msg.key }); } catch {}
                        const wKey = `${sender}:${from}:link`;
                        warns[wKey] = (warns[wKey] || 0) + 1;
                        if (warns[wKey] >= 3) {
                            await S.sendMessage(from, { text: `❌ @${senderN} 3 link warnings → KICK!`, mentions: [sender] });
                            await S.groupParticipantsUpdate(from, [sender], 'remove');
                            delete warns[wKey];
                        }
                        continue;
                    }

                } catch(e) { console.log('[MSG ERR]', e.message); }
            }
        });

        // ── Welcome on join ────────────────────────
        this.sock.ev.on('group-participants.update', async (update) => {
            try {
                if (update.action !== 'add') return;
                const meta = await this.sock.groupMetadata(update.id);
                for (const p of update.participants) {
                    let name = p.split('@')[0];
                    try { const c = await this.sock.getContact(p); name = c?.notify || c?.name || name; } catch {}
                    await this.sock.sendMessage(update.id, {
                        image: { url: BOT_IMG },
                        caption: welcomeMsg(name, meta.subject)
                    });
                }
            } catch {}
        });
    }
}

// ── Restore sessions on startup ──────────────────────
async function loadSessions() {
    if (!fs.existsSync(SESSIONS_DIR)) return;
    const dirs = fs.readdirSync(SESSIONS_DIR);
    for (const uid of dirs) {
        const credsFile = path.join(SESSIONS_DIR, uid, 'creds.json');
        if (!fs.existsSync(credsFile)) continue;
        try {
            console.log(`[RESTORE] Session ${uid} restore ho raha hai...`);
            sessions[uid] = new Session(uid);
            await sessions[uid].start(null);
        } catch(e) { console.error(`[RESTORE ERR] ${uid}:`, e.message); }
    }
}

// ── Telegram Bot Commands ────────────────────────────
tgBot.onText(/\/start/, async (msg) => {
    await tgBot.sendMessage(msg.chat.id,
`╔══════════════════════════════╗
║      ⚡ GENIUS MD BOT ⚡      ║
║    👑  Developer: ADITYA      ║
╚══════════════════════════════╝

🔗 ${YT_LINK}

*WhatsApp connect karne ke liye:*
➤ /pair 917086852797

*Commands:*
/pair <number> — WhatsApp pair karo
/unpair — Disconnect karo
/status — Connection check
/help — Help

*Features:*
🎉 Auto Welcome + Image
🚫 Anti-Gali/Emoji/Link
🎵 Song Download (.song)
🎬 YouTube Video (.ytv)
📸 Instagram (.insta)
⚠️ Warning System
✅ Private + Group Support

⚡ *${BOT_NAME}*`,
        { parse_mode: 'Markdown' });
});

tgBot.onText(/\/help/, async (msg) => {
    await tgBot.sendMessage(msg.chat.id,
`🆘 *${BOT_NAME} - Help*

*Pairing Steps:*
1. /pair 917086852797 bhejo
2. Pairing code aayega
3. WhatsApp > Linked Devices
4. Link a Device
5. Link with phone number
6. Code enter karo ✅

*/pair* <number> — Pair karo
*/unpair* — Disconnect
*/status* — Status check

WhatsApp pe *.menu* bhejo!`,
        { parse_mode: 'Markdown' });
});

tgBot.onText(/\/status/, async (msg) => {
    const id = msg.chat.id.toString();
    if (sessions[id]?.sock?.user) {
        const num = sessions[id].sock.user.id?.split(':')[0] || 'Unknown';
        await tgBot.sendMessage(msg.chat.id, `✅ Connected!\n📱 Number: ${num}\n⚡ ${BOT_NAME}`);
    } else {
        await tgBot.sendMessage(msg.chat.id, `❌ Connected nahi hai\n/pair <number> se connect karo`);
    }
});

tgBot.onText(/\/unpair/, async (msg) => {
    const id = msg.chat.id.toString();
    if (sessions[id]) {
        try { await sessions[id].sock?.logout(); } catch {}
        delete sessions[id];
        const dir = path.join(SESSIONS_DIR, id);
        if (fs.existsSync(dir)) fs.rmSync(dir, { recursive: true });
        await tgBot.sendMessage(msg.chat.id, `✅ WhatsApp disconnect ho gaya!\n/pair se dobara connect karo`);
    } else {
        await tgBot.sendMessage(msg.chat.id, `❌ Koi session nahi hai`);
    }
});

tgBot.onText(/\/pair (.+)/, async (msg, match) => {
    const id    = msg.chat.id.toString();
    const phone = match[1].trim().replace(/[^0-9]/g, '');
    if (phone.length < 10) {
        await tgBot.sendMessage(msg.chat.id, '❌ Number galat hai!\nExample: /pair 917086852797');
        return;
    }
    if (sessions[id]) {
        await tgBot.sendMessage(msg.chat.id, '⚠️ Pehle /unpair karo, phir /pair karo!');
        return;
    }
    await tgBot.sendMessage(msg.chat.id, `⏳ *Connecting...*\nNumber: +${phone}\n\nCode 5 sec mein aayega...`, { parse_mode: 'Markdown' });
    sessions[id] = new Session(id);
    await sessions[id].start(phone);
});

// Legacy: number directly bhejna
tgBot.on('message', async (msg) => {
    const id   = msg.chat.id.toString();
    const text = msg.text?.trim() || '';
    if (text.startsWith('/')) return;
    const phone = text.replace(/[^0-9]/g, '');
    if (phone.length < 10 || phone.length > 15) return;
    if (sessions[id]) return;
    await tgBot.sendMessage(id, `⏳ *Connecting...*\nNumber: +${phone}\n\nCode 5 sec mein aayega...`, { parse_mode: 'Markdown' });
    sessions[id] = new Session(id);
    await sessions[id].start(phone);
});

// ── Start ────────────────────────────────────────────
console.log(`
╔══════════════════════════════╗
║      ⚡ GENIUS MD BOT ⚡      ║
║    👑  Developer: ADITYA      ║
╚══════════════════════════════╝
✅ Bot chalu hai!
`);
loadSessions();
