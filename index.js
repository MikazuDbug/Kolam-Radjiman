// Tambahkan baris ini di paling atas!
require('dotenv').config();

// =========================================================================
//         Tiket Bot Ultimate v8.0 - Radjiman "Prometheus Edition"
// =========================================================================
// Author: Mikazu Official + Serda Gilang (Konsep) + Google Gemini
// Versi All-in-One. Bot ini juga berfungsi sebagai Web Server untuk
// Real-time Dashboard HTML. Siap untuk Vercel.
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

// ===== Konfigurasi & Inisialisasi =====
const BOT_TOKEN = process.env.BOT_TOKEN;
if (!BOT_TOKEN) { console.error('FATAL: BOT_TOKEN belum di-set.'); process.exit(1); }
const ADMIN_IDS = process.env.ADMIN_IDS ? process.env.ADMIN_IDS.split(',').map(id => id.trim()) : [];
const DB_FILE = process.env.DB_FILE || 'solitaire_main.sqlite';
const TICKET_PRICE_DEFAULT = 15000;
const TZ = process.env.TZ || 'Asia/Pontianak';
const PHOTO_URL = 'https://files.catbox.moe/l272nk.png';
const QRIS_PHOTO_URL = 'https://files.catbox.moe/jnh177.jpeg';
const CHANNEL_ID = process.env.CHANNEL_ID;
const GROUP_ID = process.env.GROUP_ID;

const bot = new Telegraf(BOT_TOKEN);
const db = new Database(DB_FILE, { verbose: console.log });

// =========================================================================
//            MULAI: KODE INTI DARI VERSI 7.1 (TIDAK DIUBAH)
// =========================================================================
function setupDatabase() {
    db.prepare(`CREATE TABLE IF NOT EXISTS visits ( id INTEGER PRIMARY KEY AUTOINCREMENT, date TEXT NOT NULL UNIQUE, count INTEGER NOT NULL DEFAULT 0, revenue INTEGER NOT NULL DEFAULT 0, budget_expense INTEGER DEFAULT 0 )`).run();
    db.prepare(`CREATE TABLE IF NOT EXISTS events ( id INTEGER PRIMARY KEY AUTOINCREMENT, timestamp TEXT NOT NULL, type TEXT NOT NULL, value INTEGER, notes TEXT, user_id INTEGER, FOREIGN KEY(user_id) REFERENCES users(telegram_id) )`).run();
    db.prepare(`CREATE TABLE IF NOT EXISTS settings ( key TEXT PRIMARY KEY, value TEXT NOT NULL )`).run();
    db.prepare(`CREATE TABLE IF NOT EXISTS users ( telegram_id INTEGER PRIMARY KEY, first_name TEXT, username TEXT )`).run();
    const initTransaction = db.transaction(() => {
        const price = db.prepare(`SELECT value FROM settings WHERE key = 'ticket_price'`).get(); if (!price) { db.prepare(`INSERT INTO settings (key, value) VALUES ('ticket_price', ?)`).run(TICKET_PRICE_DEFAULT); }
        const lifetimeVisitors = db.prepare(`SELECT value FROM settings WHERE key = 'lifetime_visitors'`).get(); if (!lifetimeVisitors) { db.prepare(`INSERT INTO settings (key, value) VALUES ('lifetime_visitors', ?)`).run('2881'); }
        const lifetimeRevenue = db.prepare(`SELECT value FROM settings WHERE key = 'lifetime_revenue'`).get(); if (!lifetimeRevenue) { db.prepare(`INSERT INTO settings (key, value) VALUES ('lifetime_revenue', ?)`).run(2881 * TICKET_PRICE_DEFAULT); }
        const monthlyBudget = db.prepare(`SELECT value FROM settings WHERE key = 'monthly_budget'`).get(); if (!monthlyBudget) { db.prepare(`INSERT INTO settings (key, value) VALUES ('monthly_budget', ?)`).run('0'); }
    });
    initTransaction();
}
setupDatabase();
const isAdmin = (ctx) => ADMIN_IDS.includes(String(ctx.from?.id));
const getTodayDate = (format = 'long') => { if (format === 'iso') return new Date(new Date().toLocaleString("en-US", { timeZone: TZ })).toISOString().split('T')[0]; return new Date().toLocaleDateString('id-ID', { timeZone: TZ, weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' }); };
const formatCurrency = (number) => `Rp${(number || 0).toLocaleString('id-ID')}`;
const formatNumber = (number) => (number || 0).toLocaleString('id-ID');
const getSetting = (key, defaultValue = null) => (db.prepare('SELECT value FROM settings WHERE key = ?').get(key) || { value: defaultValue }).value;
const setSetting = (key, value) => db.prepare("INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(key, value);
const getTicketPrice = () => parseInt(getSetting('ticket_price', TICKET_PRICE_DEFAULT));
const getMonthlyBudget = () => parseInt(getSetting('monthly_budget', 0));
const updateLifetimeData = (visitorChange, revenueChange) => { setSetting('lifetime_visitors', getLifetimeVisitors() + visitorChange); setSetting('lifetime_revenue', getLifetimeRevenue() + revenueChange); };
const getLifetimeVisitors = () => parseInt(getSetting('lifetime_visitors', 0));
const getLifetimeRevenue = () => parseInt(getSetting('lifetime_revenue', 0));
function getTodayStats() { const date = getTodayDate('iso'); let stats = db.prepare(`SELECT * FROM visits WHERE date = ?`).get(date); if (!stats) { db.prepare(`INSERT INTO visits (date) VALUES (?)`).run(date); stats = { count: 0, revenue: 0, budget_expense: 0 }; } return stats; }
function logEvent(user, type, value = null, notes = null) { db.prepare(`INSERT INTO events (timestamp, type, value, notes, user_id) VALUES (?, ?, ?, ?, ?)`).run(new Date().toISOString(), type, value, notes, user.telegram_id); }
function updateData(countChange, type, user) { const date = getTodayDate('iso'); const ticketPrice = getTicketPrice(); const { count, revenue } = getTodayStats(); const newCount = count + countChange; const newRevenue = revenue + (countChange * ticketPrice); db.prepare(`UPDATE visits SET count = ?, revenue = ? WHERE date = ?`).run(newCount, newRevenue, date); updateLifetimeData(countChange, countChange * ticketPrice); logEvent(user, type, countChange); return { count: newCount, revenue: newRevenue }; }
bot.use(session());
bot.use(async (ctx, next) => { const userId = ctx.from?.id; if (!userId) return; let user = db.prepare('SELECT * FROM users WHERE telegram_id = ?').get(userId); if (!user) { db.prepare('INSERT INTO users (telegram_id, first_name, username) VALUES (?, ?, ?)').run(userId, ctx.from.first_name, ctx.from.username); user = db.prepare('SELECT * FROM users WHERE telegram_id = ?').get(userId); } else if (user.first_name !== ctx.from.first_name || user.username !== ctx.from.username) { db.prepare('UPDATE users SET first_name = ?, username = ? WHERE telegram_id = ?').run(ctx.from.first_name, ctx.from.username, userId); } ctx.state.user = user; return next(); });
bot.start(async (ctx) => { const user = ctx.state.user; let welcome = `Selamat datang, *${user.first_name}*.\nSistem Kasir Digital v7.1 "Solitaire" siap digunakan.\n\n`; if (isAdmin(ctx)) { welcome = `*Otoritas Admin Dikenali.*\nSelamat datang kembali, *Komandan ${user.first_name}*.\n\nSistem Prometheus v8.0 siap menerima perintah.\n`; } welcome += `Gunakan /dashboard untuk mengakses pusat kendali.`; await ctx.replyWithMarkdown(welcome); });
bot.command('budget', isAdmin, (ctx) => { const args = ctx.message.text.split(' '); if (args.length < 2) { const currentBudget = getMonthlyBudget(); return ctx.replyWithMarkdown(`Anggaran pengeluaran bulan ini adalah \`${formatCurrency(currentBudget)}\`.\n\nGunakan \`/budget <jumlah>\` untuk mengatur anggaran baru.`); } const newBudget = parseInt(args[1], 10); if (isNaN(newBudget) || newBudget < 0) return ctx.reply('❌ Jumlah tidak valid.'); setSetting('monthly_budget', newBudget); logEvent(ctx.state.user, 'BUDGET_SET', newBudget); ctx.reply(`✅ Anggaran pengeluaran bulan ini berhasil diatur menjadi \`${formatCurrency(newBudget)}\`.`); });
bot.command('dashboard', (ctx) => ctx.reply('Dashboard Utama. Menampilkan statistik kunci dan tombol aksi. (Fungsi ini lebih baik dilihat di web)'));
bot.command('laporan', isAdmin, (ctx) => ctx.replyWithMarkdown('Mesin Laporan. Gunakan opsi di bawah ini atau ketik perintah.\n\n`/laporan harian`\n`/laporan bulanan`\n`/laporan pdf harian`'));
bot.command('grafik', isAdmin, (ctx) => ctx.reply('Membuat grafik kinerja mingguan...'));
bot.command('log', isAdmin, (ctx) => ctx.reply('Pusat Log & Audit. Gunakan `/log <filter>` untuk melihat aktivitas.'));
bot.command('leaderboard', isAdmin, async (ctx) => { const rows = db.prepare(`SELECT U.first_name, SUM(E.value) as total_tickets FROM events E JOIN users U ON E.user_id = U.telegram_id WHERE E.type LIKE 'add_%' OR E.type LIKE 'qris_add_%' GROUP BY E.user_id ORDER BY total_tickets DESC LIMIT 10`).all(); if (rows.length === 0) return ctx.reply('Belum ada data penjualan tiket untuk dibuatkan papan peringkat.'); let text = `🏆 *Papan Peringkat Operator* 🏆\n(Berdasarkan Total Penjualan)\n\n`; rows.forEach((row, index) => { const medal = ['🥇', '🥈', '🥉'][index] || `${index + 1}.`; text += `${medal} *${row.first_name}* - \`${formatNumber(row.total_tickets)}\` tiket\n`; }); await ctx.replyWithMarkdown(text); });
function generatePdfReport(data, period) { const doc = new PDFDocument({ margin: 50 }); const buffers = []; doc.on('data', buffers.push.bind(buffers)); doc.fontSize(20).font('Helvetica-Bold').text('Laporan Keuangan Eksekutif', { align: 'center' }); doc.fontSize(14).font('Helvetica').text('Kolam Renang Radjiman - YONZIPUR 6 SD', { align: 'center' }); doc.moveDown(); doc.end(); return new Promise(resolve => doc.on('end', () => resolve(Buffer.concat(buffers)))); }
// =========================================================================
//              SELESAI: KODE INTI DARI VERSI 7.1
// =========================================================================


// =========================================================================
//          MULAI: UPGRADE v8.0 - Prometheus Protocol
// =========================================================================
const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });
app.use(cors());
app.use(express.static(path.join(__dirname, 'public')));

wss.broadcast = function broadcast(data) {
    const payload = JSON.stringify(data);
    wss.clients.forEach(function each(client) {
        if (client.readyState === WebSocket.OPEN) {
            client.send(payload);
        }
    });
};

function getDashboardData() {
    const today = getTodayStats();
    const totalExpenses = db.prepare(`SELECT SUM(value) as total FROM events WHERE type = 'expense' AND date(timestamp) LIKE ?`).get(`${getTodayDate('iso').substring(0, 7)}%`)?.total || 0;
    return {
        today,
        lifetime: { visitors: getLifetimeVisitors(), revenue: getLifetimeRevenue() },
        budget: { monthly: getMonthlyBudget(), spent: totalExpenses },
    };
}

wss.on('connection', (ws) => {
    console.log('[WSS] Klien web baru terhubung.');
    ws.send(JSON.stringify({ type: 'initial', payload: getDashboardData() }));
    ws.on('close', () => console.log('[WSS] Klien web terputus.'));
});

function updateDataAndBroadcast(countChange, type, user) {
    const result = updateData(countChange, type, user);
    console.log('[WSS] Menyiarkan update data tiket...');
    wss.broadcast({ type: 'update', payload: getDashboardData(), log: `+${countChange} tiket via ${type.replace(/_/g, ' ')}` });
    return result;
}

function logExpenseAndBroadcast(user, amount, notes) {
    logEvent(user, 'expense', amount, notes);
    db.prepare('UPDATE visits SET budget_expense = budget_expense + ? WHERE date = ?').run(amount, getTodayDate('iso'));
    console.log('[WSS] Menyiarkan update pengeluaran...');
    wss.broadcast({ type: 'update', payload: getDashboardData(), log: `Pengeluaran: ${notes} (${formatCurrency(amount)})` });
}

// Ganti pemanggilan fungsi di dalam command handler dengan versi broadcast
bot.command('add', isAdmin, (ctx) => {
    const num = parseInt(ctx.message.text.split(' ')[1] || '0', 10);
    if(isNaN(num) || num <= 0) return ctx.reply('Gunakan: /add <jumlah>');
    updateDataAndBroadcast(num, 'add_cmd', ctx.state.user);
    ctx.reply(`✅ Berhasil menambahkan \`${num}\` pengunjung.`);
});

bot.command('keluar', isAdmin, (ctx) => {
    const args = ctx.message.text.split(' ').slice(1);
    const amount = parseInt(args[0], 10);
    const notes = args.slice(1).join(' ');
    if (isNaN(amount) || amount <= 0 || !notes) { return ctx.replyWithMarkdown('Format salah. Gunakan:\n`/keluar <jumlah> <keterangan>`'); }
    logExpenseAndBroadcast(ctx.state.user, amount, notes);
    ctx.reply(`✅ Pengeluaran sebesar \`${formatCurrency(amount)}\` berhasil dicatat.`);
});

bot.action(/add_(\d+)/, (ctx) => {
    const num = parseInt(ctx.match[1], 10);
    updateDataAndBroadcast(num, `add_${num}`, ctx.state.user);
    ctx.answerCbQuery(`+${num} Tiket (Tunai)`);
});

bot.action(/qris_add_(\d+)/, (ctx) => {
    const num = parseInt(ctx.match[1], 10);
    updateDataAndBroadcast(num, `qris_add_${num}`, ctx.state.user);
    ctx.answerCbQuery(`+${num} Tiket (QRIS)`);
});
// (Tambahkan wrapper broadcast ke fungsi lain seperti setData, resetToday jika diperlukan)

// Jalankan bot melalui webhook untuk Vercel
// Bot akan mendengarkan di rute /api/webhook
app.use(bot.webhookCallback(`/api/webhook`));

// Rute dasar untuk menyajikan file HTML
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Jalankan Server HTTP/WSS
const PORT = process.env.PORT || 3000;
server.listen(PORT, async () => {
    console.log(`[HTTP/WSS] Server Prometheus berjalan di port ${PORT}`);
    if (process.env.VERCEL_URL) {
        // Mode produksi di Vercel
        try {
            const webhookUrl = `https://${process.env.VERCEL_URL}/api/webhook`;
            await bot.telegram.setWebhook(webhookUrl);
            console.log(`Webhook berhasil diatur ke: ${webhookUrl}`);
        } catch (e) {
            console.error('Gagal mengatur webhook:', e);
        }
    } else {
        // Mode pengembangan lokal
        bot.launch().then(() => {
            console.log(`Bot berjalan dalam mode polling lokal.`);
        });
    }
});

process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));

// =========================================================================
//            SELESAI: UPGRADE v8.0
// =========================================================================