// Tambahkan baris ini di paling atas!
require('dotenv').config();

// =========================================================================
//         Tiket Bot Ultimate v8.2 - Radjiman "Ares Edition" (DEFINITIVE)
// =========================================================================
// Author: Mikazu Official + Serda Gilang (Konsep) + Google Gemini
// Versi ini berisi kode yang LENGKAP dan FINAL. Menggabungkan stabilitas
// v5.3 dengan arsitektur web server v8.0.
// =========================================================================

const { Telegraf, Markup, session } = require('telegraf');
const Database = require('better-sqlite3');
const cron = require('node-cron');
const fs = require('fs');
const axios = require('axios');
const PDFDocument = require('pdfkit');
const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const path = require('path');
const cors = require('cors');

// ===== Logger Kustom "Titan Vision" =====
const Logger = {
    info: (message) => console.log(`\x1b[36m[INFO]\x1b[0m ${new Date().toLocaleString('id-ID', { timeZone: 'Asia/Jakarta' })} - ${message}`),
    success: (message) => console.log(`\x1b[32m[SUCCESS]\x1b[0m ${new Date().toLocaleString('id-ID', { timeZone: 'Asia/Jakarta' })} - ${message}`),
    warn: (message) => console.warn(`\x1b[33m[WARN]\x1b[0m ${new Date().toLocaleString('id-ID', { timeZone: 'Asia/Jakarta' })} - ${message}`),
    error: (message, error) => console.error(`\x1b[31m[ERROR]\x1b[0m ${new Date().toLocaleString('id-ID', { timeZone: 'Asia/Jakarta' })} - ${message}`, error || ''),
};

// ===== Konfigurasi & Inisialisasi =====
const BOT_TOKEN = process.env.BOT_TOKEN;
if (!BOT_TOKEN) { Logger.error('FATAL: BOT_TOKEN belum di-set.'); process.exit(1); }
const ADMIN_IDS = process.env.ADMIN_IDS ? process.env.ADMIN_IDS.split(',').map(id => id.trim()) : [];
const DB_FILE = process.env.DB_FILE || 'ares_main.sqlite';
const TICKET_PRICE_DEFAULT = 15000;
const TZ = process.env.TZ || 'Asia/Pontianak';
const PHOTO_URL = 'https://files.catbox.moe/qm40k5.jpg';
const QRIS_PHOTO_URL = 'https://files.catbox.moe/jnh177.jpeg';
const CHANNEL_ID = process.env.CHANNEL_ID;
const GROUP_ID = process.env.GROUP_ID;

const bot = new Telegraf(BOT_TOKEN);
const db = new Database(DB_FILE);

// ===== Deklarasi Semua Fungsi Helper =====
const isAdmin = (ctx) => ADMIN_IDS.includes(String(ctx.from?.id));
const getTodayDate = () => new Date().toLocaleDateString('id-ID', { timeZone: TZ, weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
const getTodayDateISO = () => new Date(new Date().toLocaleString("en-US", { timeZone: TZ })).toISOString().split('T')[0];
const formatCurrency = (number) => `Rp${(number || 0).toLocaleString('id-ID')}`;
const formatNumber = (number) => (number || 0).toLocaleString('id-ID');
const getSetting = (key, defaultValue = null) => (db.prepare('SELECT value FROM settings WHERE key = ?').get(key) || { value: defaultValue }).value;
const setSetting = (key, value) => db.prepare("INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(key, String(value));
const getTicketPrice = () => parseInt(getSetting('ticket_price', TICKET_PRICE_DEFAULT));
const getLifetimeVisitors = () => parseInt(getSetting('lifetime_visitors', 0));
const getLifetimeRevenue = () => parseInt(getSetting('lifetime_revenue', 0));
const updateLifetimeData = (visitorChange, revenueChange) => { setSetting('lifetime_visitors', getLifetimeVisitors() + visitorChange); setSetting('lifetime_revenue', getLifetimeRevenue() + revenueChange); };
const getTodayStats = () => { const date = getTodayDateISO(); let stats = db.prepare(`SELECT * FROM visits WHERE date = ?`).get(date); if (!stats) { db.prepare(`INSERT INTO visits (date, count, revenue) VALUES (?, 0, 0)`).run(date); stats = { count: 0, revenue: 0 }; } return stats; };
const getMonthlyStats = () => { const monthStr = getTodayDateISO().substring(0, 7); const stats = db.prepare(`SELECT SUM(count) as count, SUM(revenue) as revenue FROM visits WHERE strftime('%Y-%m', date) = ?`).get(monthStr); return stats || { count: 0, revenue: 0 }; };
const getMonthlyBudget = () => parseInt(getSetting('monthly_budget', 0));

// ===== Setup Database =====
function setupDatabase() {
    Logger.info('Memeriksa struktur database...');
    db.prepare(`CREATE TABLE IF NOT EXISTS visits ( id INTEGER PRIMARY KEY AUTOINCREMENT, date TEXT NOT NULL UNIQUE, count INTEGER NOT NULL DEFAULT 0, revenue INTEGER NOT NULL DEFAULT 0 )`).run();
    db.prepare(`CREATE TABLE IF NOT EXISTS events ( id INTEGER PRIMARY KEY AUTOINCREMENT, timestamp TEXT NOT NULL, type TEXT NOT NULL, value INTEGER, notes TEXT, user_id INTEGER, username TEXT )`).run();
    db.prepare(`CREATE TABLE IF NOT EXISTS settings ( key TEXT PRIMARY KEY, value TEXT NOT NULL )`).run();
    const initTransaction = db.transaction(() => {
        if (!getSetting('ticket_price')) { setSetting('ticket_price', TICKET_PRICE_DEFAULT); }
        if (!getSetting('lifetime_visitors')) { setSetting('lifetime_visitors', '2881'); }
        if (!getSetting('lifetime_revenue')) { setSetting('lifetime_revenue', 2881 * TICKET_PRICE_DEFAULT); }
        if (!getSetting('monthly_budget')) { setSetting('monthly_budget', '0'); }
    });
    initTransaction();
    Logger.success('Database siap.');
}
setupDatabase();

// ===== Ares Protocol (Web Server & WebSocket) =====
const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });
app.use(cors());
app.use(express.static(path.join(__dirname, 'public')));
wss.broadcast = function broadcast(data) { const payload = JSON.stringify(data); wss.clients.forEach(function each(client) { if (client.readyState === WebSocket.OPEN) { client.send(payload); } }); };
function getDashboardData() {
    const today = getTodayStats();
    const totalExpenses = db.prepare(`SELECT SUM(value) as total FROM events WHERE type = 'expense' AND date(timestamp) LIKE ?`).get(`${getTodayDateISO().substring(0, 7)}%`)?.total || 0;
    return { today, lifetime: { visitors: getLifetimeVisitors(), revenue: getLifetimeRevenue() }, budget: { monthly: getMonthlyBudget(), spent: totalExpenses }, };
}
wss.on('connection', (ws) => { Logger.info('[WSS] Klien web baru terhubung.'); ws.send(JSON.stringify({ type: 'initial', payload: getDashboardData() })); ws.on('close', () => Logger.info('[WSS] Klien web terputus.')); });

// ===== Core Logic Functions with Broadcast =====
async function checkMilestone(oldTotal, newTotal) {
    const milestoneStep = 100; const oldMilestone = Math.floor(oldTotal / milestoneStep); const newMilestone = Math.floor(newTotal / milestoneStep);
    if (newMilestone > oldMilestone) {
        const achievedMilestone = newMilestone * milestoneStep; const message = `🎉 *PENCAPAIAN BARU!* 🎉\n\nSelamat! Kita telah berhasil melampaui **${formatNumber(achievedMilestone)}** total tiket terjual!`;
        const targetIds = [CHANNEL_ID, GROUP_ID].filter(id => id);
        for (const chatId of targetIds) { try { await bot.telegram.sendMessage(chatId, message, { parse_mode: 'Markdown' }); } catch (e) { Logger.error(`[MILESTONE] Gagal mengirim notifikasi ke ${chatId}:`, e.message); } }
    }
}
function logEvent(user, type, value = null, notes = null) {
    db.prepare(`INSERT INTO events (timestamp, type, value, notes, user_id, username) VALUES (?, ?, ?, ?, ?, ?)`).run(new Date().toISOString(), type, value, notes, user.id, user.username);
    if(type === 'expense') { wss.broadcast({ type: 'update', payload: getDashboardData(), log: `Pengeluaran: ${notes} (${formatCurrency(value)})` }); }
}
function updateData(countChange, type, user) {
    const oldLifetimeVisitors = getLifetimeVisitors(); const date = getTodayDateISO(); const ticketPrice = getTicketPrice(); const { count: currentCount } = getTodayStats(); const newCount = currentCount + countChange; const newRevenue = newCount * ticketPrice; const revenueChange = countChange * ticketPrice;
    db.prepare(`UPDATE visits SET count = ?, revenue = ? WHERE date = ?`).run(newCount, newRevenue, date);
    updateLifetimeData(countChange, revenueChange);
    logEvent(user, type, countChange);
    const newLifetimeVisitors = getLifetimeVisitors();
    checkMilestone(oldLifetimeVisitors, newLifetimeVisitors);
    wss.broadcast({ type: 'update', payload: getDashboardData(), log: `+${countChange} tiket via ${type.replace(/_/g, ' ')}` });
    return { count: newCount, revenue: newRevenue };
}
function setData(newCount, user) {
    const oldLifetimeVisitors = getLifetimeVisitors(); const date = getTodayDateISO(); const ticketPrice = getTicketPrice(); const { count: currentCount } = getTodayStats(); const visitorDiff = newCount - currentCount; const revenueDiff = visitorDiff * ticketPrice; const newRevenue = newCount * ticketPrice;
    db.prepare(`UPDATE visits SET count = ?, revenue = ? WHERE date = ?`).run(newCount, newRevenue, date);
    updateLifetimeData(visitorDiff, revenueDiff);
    logEvent(user, 'set', newCount);
    const newLifetimeVisitors = getLifetimeVisitors();
    checkMilestone(oldLifetimeVisitors, newLifetimeVisitors);
    wss.broadcast({ type: 'update', payload: getDashboardData(), log: `Jumlah di-set menjadi ${newCount} oleh admin` });
}
function resetToday(user) {
    const date = getTodayDateISO(); const ticketPrice = getTicketPrice(); const { count: currentCount } = getTodayStats(); const revenueToRemove = currentCount * ticketPrice;
    updateLifetimeData(-currentCount, -revenueToRemove);
    db.prepare(`UPDATE visits SET count = 0, revenue = 0 WHERE date = ?`).run(date);
    logEvent(user, 'reset', 0);
    wss.broadcast({ type: 'update', payload: getDashboardData(), log: `Data hari ini di-reset oleh admin` });
}

// ===== Tampilan & Menu Telegram =====
const ABOUT_TEXT = `*ℹ️ Tentang Bot & Developer*\n\n` + `Bot ini dirancang untuk melakukan manajemen dan rekapitulasi data kasir Kolam Renang Radjiman - YONZIPUR 6 SD secara digital, efisien, dan akurat.\n\n` + `========================\n` + `*Developer & Penggagas Konsep*\n\n` + `*Nama*   : Serda Gilang irchas A\n` + `*NRP*    : 21210305861299\n` + `*Contact*: [t.me/Gilangirchas15](https://t.me/Gilangirchas15)\n\n` + `*Development Support*:\n` + `Mikazu Official & Google Gemini\n` + `========================`;
const QRIS_TEXT = `*PEMBAYARAN DIGITAL VIA QRIS*\n\n1. Silakan perlihatkan QR Code di atas kepada pelanggan.\n2. Pastikan nominal pembayaran sesuai dengan jumlah tiket yang dibeli.\n3. Setelah pembayaran pelanggan berhasil, tekan tombol *✅ Konfirmasi Pembayaran* di bawah untuk mencatat tiket.`;
const QRIS_CONFIRM_TEXT = `*KONFIRMASI PEMBAYARAN QRIS*\n\nPembayaran oleh pelanggan sudah berhasil. Silakan masukkan jumlah tiket yang dibeli melalui tombol di bawah.`;

function generateMainMenuText(ctx) {
    let greeting = `*Kasir Digital*`; if (isAdmin(ctx)) { greeting = `*Selamat datang kembali, Komandan ${ctx.from.first_name}!*`; }
    const today = getTodayStats(); const month = getMonthlyStats(); const lifetimeVisitors = getLifetimeVisitors(); const lifetimeRevenue = getLifetimeRevenue(); const ticketPrice = getTicketPrice();
    return `*Kolam renang Radjiman - YONZIPUR 6 SD* 🏊‍♂️\n` + `${greeting} - ${getTodayDate()}\n` + `========================\n` + `📊 *DATA HARI INI*\n` + `   Pengunjung : \`${formatNumber(today.count)}\` orang\n` + `   Pendapatan : \`${formatCurrency(today.revenue)}\`\n` + `------------------------\n` + `🗓️ *DATA BULAN INI*\n` + `   Total Pengunjung : \`${formatNumber(month.count)}\` orang\n` + `   Total Pendapatan : \`${formatCurrency(month.revenue)}\`\n` + `------------------------\n` + `🌍 *DATA KESELURUHAN*\n` + `   Total Tiket Terjual : \`${formatNumber(lifetimeVisitors)}\` tiket\n` + `   Total Pendapatan    : \`${formatCurrency(lifetimeRevenue)}\`\n` + `========================\n` + `*Harga per Tiket:* \`${formatCurrency(ticketPrice)}\`\n\n` + `_Pilih aksi di bawah ini untuk memulai._`;
}
function getMainMenu(ctx) { const buttons = [ [Markup.button.callback('Tunai +1', 'add_1'), Markup.button.callback('+5', 'add_5'), Markup.button.callback('+10', 'add_10')], [Markup.button.callback('💳 Bayar via QRIS', 'show_qris')], [Markup.button.callback('🔄 Refresh', 'refresh_main'), Markup.button.callback('ℹ️ Tentang Bot', 'show_about')] ]; if (isAdmin(ctx)) { buttons.push([Markup.button.callback('⚙️ Panel Admin', 'admin_panel')]); } return Markup.inlineKeyboard(buttons); }
function getAdminMenu() { return Markup.inlineKeyboard([ [Markup.button.callback('📊 Buat Grafik Kinerja', 'admin_chart')], [Markup.button.callback('📦 Backup Manual Sekarang', 'admin_backup')], [Markup.button.callback('✏️ Set Jumlah', 'admin_set'), Markup.button.callback('🗑️ Reset Hari Ini', 'admin_reset')], [Markup.button.callback('💰 Ubah Harga Tiket', 'admin_price'), Markup.button.callback('💸 Catat Pengeluaran', 'admin_expense')], [Markup.button.callback('⬅️ Kembali ke Menu Utama', 'back_to_main')] ]); }
function getQrisMenu() { return Markup.inlineKeyboard([ [Markup.button.callback('✅ Konfirmasi Pembayaran', 'qris_confirm_start')], [Markup.button.callback('⬅️ Kembali ke Menu Utama', 'back_to_main')] ]); }
function getQrisConfirmMenu() { return Markup.inlineKeyboard([ [Markup.button.callback('+ 1', 'qris_add_1'), Markup.button.callback('+ 5', 'qris_add_5'), Markup.button.callback('+ 10', 'qris_add_10')], [Markup.button.callback('Kembali', 'show_qris')], ]); }
function getAboutMenu() { return Markup.inlineKeyboard([ [Markup.button.callback('⬅️ Kembali ke Menu Utama', 'back_to_main')] ]); }

async function sendMainMenu(ctx) {
    try {
        const text = generateMainMenuText(ctx); const keyboard = getMainMenu(ctx);
        if (ctx.session && ctx.session.mainMenuId) { await ctx.deleteMessage(ctx.session.mainMenuId).catch(() => {}); }
        const sentMessage = await ctx.replyWithPhoto(PHOTO_URL, { caption: text, parse_mode: 'Markdown', ...keyboard });
        ctx.session.mainMenuId = sentMessage.message_id;
    } catch(e) { Logger.error("Gagal mengirim menu utama:", e); await ctx.reply("Maaf, terjadi kesalahan saat memuat menu. Silakan coba /start lagi.").catch(err => Logger.error("Gagal mengirim pesan error fallback:", err)); }
}
async function updateMainMenu(ctx, message = null) {
    try {
        const text = generateMainMenuText(ctx); const keyboard = getMainMenu(ctx);
        if (message) { await ctx.answerCbQuery(message, { show_alert: false }); }
        await ctx.editMessageCaption(text, { ...keyboard, parse_mode: 'Markdown' });
    } catch (e) {
        if (e.description && e.description.includes('message is not modified')) { await ctx.answerCbQuery('Tidak ada perubahan data.'); }
        else { Logger.error('Gagal update menu, mengirim pesan baru:', e); await sendMainMenu(ctx); }
    }
}

// ===== Middleware & Command Handlers =====
bot.use(session());
bot.start(sendMainMenu);
bot.command('dashboard', sendMainMenu);
bot.command('add', isAdmin, (ctx) => { const num = parseInt(ctx.message.text.split(' ')[1] || '0', 10); if(isNaN(num) || num <= 0) return ctx.reply('Gunakan: /add <jumlah>'); updateData(num, 'add_cmd', ctx.from); ctx.reply(`✅ Berhasil menambahkan \`${num}\` pengunjung.`); });
bot.command('set', isAdmin, (ctx) => { const num = parseInt(ctx.message.text.split(' ')[1] || '0', 10); if(isNaN(num) || num < 0) return ctx.reply('Gunakan: /set <jumlah>'); setData(num, ctx.from); ctx.reply(`📌 Jumlah pengunjung hari ini berhasil di-set menjadi \`${num}\`.`); });
bot.command('reset', isAdmin, (ctx) => { resetToday(ctx.from); ctx.reply('♻️ Data hari ini telah direset menjadi `0`.'); });
bot.command('price', isAdmin, (ctx) => { const num = parseInt(ctx.message.text.split(' ')[1] || '0', 10); if(isNaN(num) || num <= 0) return ctx.reply('Gunakan: /price <harga>'); setSetting('ticket_price', num); logEvent(ctx.from, 'price_change', num); ctx.reply(`💰 Harga tiket berhasil diubah menjadi \`${formatCurrency(num)}\`.`); });
bot.command('keluar', isAdmin, (ctx) => { const args = ctx.message.text.split(' ').slice(1); const amount = parseInt(args[0], 10); const notes = args.slice(1).join(' '); if (isNaN(amount) || amount <= 0 || !notes) { return ctx.replyWithMarkdown('Format salah. Gunakan:\n`/keluar <jumlah> <keterangan>`'); } logEvent(ctx.from, 'expense', amount, notes); ctx.reply(`✅ Pengeluaran sebesar \`${formatCurrency(amount)}\` untuk \`${notes}\` berhasil dicatat.`); });
bot.command('backup', isAdmin, async (ctx) => { await ctx.replyWithChatAction('upload_document'); await sendManualBackup(ctx.from.id); });
bot.command('grafik', isAdmin, async (ctx) => { await sendPerformanceChart(ctx); });

// ===== Actions Handlers =====
bot.action(/add_(\d+)/, (ctx) => { const num = parseInt(ctx.match[1], 10); updateData(num, `add_${num}`, ctx.from); updateMainMenu(ctx, `+${num} Tiket (Tunai)`); });
bot.action(/qris_add_(\d+)/, (ctx) => { const num = parseInt(ctx.match[1], 10); updateData(num, `qris_add_${num}`, ctx.from); updateMainMenu(ctx, `+${num} Tiket (QRIS)`); });
bot.action('refresh_main', (ctx) => { updateMainMenu(ctx, '🔄 Data diperbarui'); });
bot.action('show_about', async (ctx) => { await ctx.editMessageCaption(ABOUT_TEXT, { ...getAboutMenu(), parse_mode: 'Markdown' }).catch(e => Logger.error('Gagal edit ke menu About', e)); });
bot.action('show_qris', async (ctx) => { await ctx.editMessageMedia({ type: 'photo', media: QRIS_PHOTO_URL }); await ctx.editMessageCaption(QRIS_TEXT, { ...getQrisMenu(), parse_mode: 'Markdown' }).catch(e => Logger.error('Gagal edit ke menu QRIS', e)); });
bot.action('qris_confirm_start', async (ctx) => { await ctx.editMessageCaption(QRIS_CONFIRM_TEXT, { ...getQrisConfirmMenu(), parse_mode: 'Markdown' }).catch(e => Logger.error('Gagal edit ke konfirmasi QRIS', e)); });
bot.action('back_to_main', (ctx) => { updateMainMenu(ctx, '⬅️ Kembali'); });
bot.action('admin_panel', async (ctx) => { if (!isAdmin(ctx)) return ctx.answerCbQuery('❌ Akses Ditolak!', { show_alert: true }); const text = `*⚙️ Panel Admin Sentinel*\n\nSelamat datang di pusat kendali.`; await ctx.editMessageCaption(text, { ...getAdminMenu(), parse_mode: 'Markdown' }).catch(e => Logger.error('Gagal edit ke Panel Admin', e)); });
bot.action('admin_backup', async (ctx) => { if (!isAdmin(ctx)) return ctx.answerCbQuery('❌ Akses Ditolak!', { show_alert: true }); await ctx.answerCbQuery('Memproses backup manual...'); await bot.telegram.sendMessage(ctx.from.id, "Membuat file backup manual..."); await sendManualBackup(ctx.from.id); });
bot.action('admin_chart', async (ctx) => { if (!isAdmin(ctx)) return ctx.answerCbQuery('❌ Akses Ditolak!', { show_alert: true }); await ctx.answerCbQuery('Membuat grafik kinerja...'); await sendPerformanceChart(ctx); });
bot.action('admin_expense', async(ctx) => { if (!isAdmin(ctx)) return ctx.answerCbQuery('❌ Akses Ditolak!', { show_alert: true }); await ctx.answerCbQuery('Gunakan perintah /keluar di chat', { show_alert: true }); await ctx.replyWithMarkdown('Untuk mencatat pengeluaran, silakan kirim pesan dengan format:\n`/keluar <jumlah> <keterangan>`'); });
bot.action('admin_reset', async (ctx) => { if (!isAdmin(ctx)) return ctx.answerCbQuery('❌ Akses Ditolak!', { show_alert: true }); resetToday(ctx.from); await ctx.answerCbQuery('♻️ Data hari ini berhasil di-reset!', { show_alert: true }); updateMainMenu(ctx); });
bot.action(/admin_(set|price)/, async (ctx) => { if (!isAdmin(ctx)) return ctx.answerCbQuery('❌ Akses Ditolak!', { show_alert: true }); const type = ctx.match[1]; const command = type === 'set' ? '/set jumlah' : '/price harga'; const example = type === 'set' ? '/set 50' : '/price 20000'; await ctx.answerCbQuery(`Gunakan perintah chat untuk aksi ini.`, { show_alert: true }); await ctx.reply(`Untuk mengubah *${type}*, silakan kirim pesan dengan format:\n\`${command}\`\n\nContoh:\n\`${example}\``, { parse_mode: 'Markdown' }); });

// ===== Fitur Inti (Grafik, Backup, dll.) =====
async function sendManualBackup(chatId) { try { const timestamp = new Date().toISOString().replace(/:/g, '-'); await bot.telegram.sendDocument(chatId, { source: fs.createReadStream(DB_FILE), filename: `backup-manual-radjiman-${timestamp}.sqlite` }, { caption: `*Backup Database Manual*\n\nSimpan file ini di tempat yang aman.`, parse_mode: 'Markdown' }); } catch(e) { Logger.error(`[BACKUP] Gagal mengirim backup manual ke ${chatId}:`, e); await bot.telegram.sendMessage(chatId, `❌ Gagal mengirim file backup.`); } }
async function sendAutomatedBackup() { if (!ADMIN_IDS || ADMIN_IDS.length === 0) { Logger.warn("[BACKUP OTOMATIS] Tidak ada ADMIN_IDS. Backup dibatalkan."); return; } const primaryAdminId = ADMIN_IDS[0]; Logger.info(`[BACKUP OTOMATIS] Memulai proses backup ke admin utama: ${primaryAdminId}`); try { const timestamp = new Date().toISOString().replace(/:/g, '-'); await bot.telegram.sendDocument(primaryAdminId, { source: fs.createReadStream(DB_FILE), filename: `backup-otomatis-radjiman-${timestamp}.sqlite` }, { caption: `*Backup Database Otomatis Harian*\n\nFile ini dibuat oleh Sistem Sentinel.`, parse_mode: 'Markdown' }); const backupTime = new Date().toLocaleString('id-ID', {timeZone: TZ}); setSetting('last_auto_backup', backupTime); Logger.success(`[BACKUP OTOMATIS] Berhasil mengirim backup ke ${primaryAdminId}.`); } catch (e) { Logger.error(`[BACKUP OTOMATIS] GAGAL mengirim backup ke ${primaryAdminId}:`, e); } }
async function generateChartUrl() { const labels = []; const data = []; for (let i = 6; i >= 0; i--) { const d = new Date(); d.setDate(d.getDate() - i); const dateISO = d.toISOString().split('T')[0]; const dayLabel = d.toLocaleDateString('id-ID', { weekday: 'short' }); labels.push(dayLabel); const row = db.prepare('SELECT count FROM visits WHERE date = ?').get(dateISO); data.push(row ? row.count : 0); } const chartConfig = { type: 'bar', data: { labels, datasets: [{ label: 'Pengunjung', data, backgroundColor: 'rgba(75, 192, 192, 0.5)', borderColor: 'rgba(75, 192, 192, 1)', borderWidth: 1 }] }, options: { title: { display: true, text: 'Kinerja Pengunjung 7 Hari Terakhir' }, legend: { display: false }, scales: { yAxes: [{ ticks: { beginAtZero: true } }] } } }; const encodedConfig = encodeURIComponent(JSON.stringify(chartConfig)); return `https://quickchart.io/chart?c=${encodedConfig}&width=600&height=400&backgroundColor=white`; }
async function sendPerformanceChart(ctx) { await ctx.replyWithChatAction('upload_photo').catch(e => Logger.warn('Gagal send chat action', e)); try { const chartUrl = await generateChartUrl(); await ctx.replyWithPhoto(chartUrl, { caption: `*Grafik Kinerja Mingguan*\n\nVisualisasi data jumlah pengunjung selama 7 hari terakhir.`, parse_mode: 'Markdown' }); } catch (error) { Logger.error(`[GRAFIK] Gagal membuat atau mengirim grafik:`, error); await ctx.reply('❌ Maaf, terjadi kesalahan saat membuat grafik kinerja.'); } }

// ===== Cron Jobs & Server Start =====
cron.schedule('0 18 * * *', () => { Logger.info('[CRON] Pukul 18:00 - Waktu Laporan Harian.'); /* ... */ }, { timezone: TZ });
cron.schedule('0 23 * * *', () => { sendAutomatedBackup(); }, { timezone: TZ });

// Jalankan bot melalui webhook untuk Vercel
app.use(bot.webhookCallback(`/api/webhook`));
const PORT = process.env.PORT || 3000;
server.listen(PORT, async () => {
    Logger.info(`[HTTP/WSS] Server Ares berjalan di port ${PORT}`);
    if (process.env.VERCEL_URL) {
        const webhookUrl = `https://${process.env.VERCEL_URL}/api/webhook`;
        try { await bot.telegram.setWebhook(webhookUrl); Logger.success(`Webhook berhasil diatur ke: ${webhookUrl}`); }
        catch (e) { Logger.error('Gagal mengatur webhook:', e); }
    } else {
        bot.launch().then(() => Logger.success(`Bot berjalan dalam mode polling lokal.`));
    }
});
process.once('SIGINT', () => { Logger.warn('SIGINT diterima, mematikan bot...'); bot.stop('SIGINT') });
process.once('SIGTERM', () => { Logger.warn('SIGTERM diterima, mematikan bot...'); bot.stop('SIGTERM') });
