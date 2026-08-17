const fs = require('fs');
const path = require('path');
const { createHostRoom } = require('./bot/hostRoom');

const { getTimestamp, sanitizeStadiumFileContents, sleep } = require('./util');
const { loadOrCreateDatabase, persistDatabase, initDatabase } = require('./db');
const { createRoom } = require('./room');
const { createBotManager } = require('./bot/manager');

const MAP_FILE = path.join(__dirname, '..', 'maps', 'Spacebounce.hbs');
const DB_FILE = path.join(__dirname, '..', 'db', 'haxball-results.sqlite');
const ROOM_NAME = process.env.HAXBALL_ROOM_NAME || '🛰️🛰️ SPACEBOUNCE | ⚽ 4v4 🪐 🛰️🛰️';
const MAX_PLAYERS = Number(process.env.HAXBALL_MAX_PLAYERS || 16);
const SCORE_LIMIT = Number(process.env.HAXBALL_SCORE_LIMIT || 3);
const TIME_LIMIT = Number(process.env.HAXBALL_TIME_LIMIT || 4);
const SPEC_PROMOTION_COUNT = Number(process.env.HAXBALL_PROMOTION_COUNT || 4);
const PUBLIC_ROOM = Number(process.env.HAXBALL_PUBLIC ?? 1) === 1;
const TOKEN = process.env.HAXBALL_TOKEN;
const ADMIN_PASSWORD = process.env.HAXBALL_ADMIN_PASSWORD;

// Configs read from .env (with defaults)
const CONFIG_ADMIN_CAN_BAN = Number(process.env.CONFIG_ADMIN_CAN_BAN ?? 1);
const CONFIG_ADMIN_CAN_GIVE_ADMIN = Number(process.env.CONFIG_ADMIN_CAN_GIVE_ADMIN ?? 0);
const CONFIG_ALLOW_MULTIPLE_JOIN = Number(process.env.CONFIG_ALLOW_MULTIPLE_JOIN ?? 0);

// Yapay zeka bot ayarları
const BOT_NAME = process.env.HAXBALL_BOT_NAME || 'SpaceBot';
const BOT_MAX = Number(process.env.HAXBALL_BOT_MAX || 8);
const BOT_AVATAR = process.env.HAXBALL_BOT_AVATAR || '🤖';
const BOT_AUTOSTART = Number(process.env.HAXBALL_BOT_AUTOSTART ?? 3);
const BOT_LEARNING_ENABLED = Number(process.env.HAXBALL_BOT_LEARNING ?? 1) === 1;
const BOT_LEARNING_FILE = process.env.HAXBALL_BOT_LEARNING_FILE
  ? path.resolve(__dirname, '..', process.env.HAXBALL_BOT_LEARNING_FILE)
  : path.join(__dirname, '..', 'db', 'bot-learning.json');

let SQL = null;
let db = null;

if (!TOKEN) {
  console.error('HAXBALL_TOKEN çevre değişkeni bulunamadı.');
  console.error('Lütfen botu başlatmadan önce HAXBALL_TOKEN değişkenini tanımlayın.');
  process.exit(1);
}

const mapDataRaw = fs.readFileSync(MAP_FILE, 'utf8');
const mapData = sanitizeStadiumFileContents(mapDataRaw);
const playerAssignments = new Map();
const playerJoinOrder = new Map();
const loggedInPlayers = new Map();
const leavingIntentions = new Map();

startRoom().catch((error) => {
  console.error('Haxball odası başlatılamadı:', error);
  process.exit(1);
});

async function startRoom() {
  console.log(`${getTimestamp()} Haxball odası başlatılıyor...`);

  const initSqlJs = require('sql.js');
  SQL = await initSqlJs({
    locateFile: (file) => path.join(__dirname, '..', 'node_modules', 'sql.js', 'dist', file),
  });

  db = loadOrCreateDatabase(SQL, DB_FILE);
  initDatabase(db);
  persistDatabase(db, DB_FILE);

  const botManager = createBotManager({
    botName: BOT_NAME,
    maxBots: BOT_MAX,
    avatar: BOT_AVATAR,
    learningEnabled: BOT_LEARNING_ENABLED,
    learningFile: BOT_LEARNING_FILE,
  });

  // Host kapanırken bot process'leri ortada kalmasın
  const cleanupBots = () => botManager.stopAll();
  process.on('exit', cleanupBots);
  process.on('SIGTERM', () => { cleanupBots(); process.exit(0); });
  process.on('SIGINT', () => { cleanupBots(); process.exit(0); });

  // Oda node-haxball ile açılıyor (arayüz haxball.js ile aynı). Sebebi:
  // bellek içi bot oyuncuları sadece bu kütüphanenin host modunda mümkün.
  const host = createHostRoom({
    roomName: ROOM_NAME,
    playerName: 'Host-admin',
    maxPlayers: MAX_PLAYERS,
    public: PUBLIC_ROOM,
    noPlayer: false,
    token: TOKEN,
    geo: { code: 'tr', lat: 37.0208, lon: 30.8541 },
  });

  const room = host.room;

  // Ham oda nesnesi onOpen ile geliyor; hazır olunca botları bağla.
  const waitForRaw = setInterval(() => {
    const raw = host.getRaw();
    if (raw) {
      clearInterval(waitForRaw);
      botManager.attach(raw, host.api);
      console.log(`${getTimestamp()} 🤖 Bot motoru hazır (!bot aç ile kullanılabilir).`);
    }
  }, 250);

  await createRoom(room, {
    ROOM_NAME,
    SCORE_LIMIT,
    TIME_LIMIT,
    SPEC_PROMOTION_COUNT,
    mapData,
    db,
    DB_FILE,
    persistDatabase,
    ADMIN_PASSWORD,
    playerAssignments,
    playerJoinOrder,
    loggedInPlayers,
    leavingIntentions,
    getTimestamp,
    sleep,
    CONFIG_ADMIN_CAN_BAN,
    CONFIG_ADMIN_CAN_GIVE_ADMIN,
    CONFIG_ALLOW_MULTIPLE_JOIN,
    botManager,
  });

  if (BOT_AUTOSTART > 0) {
    const autoStartBots = setInterval(() => {
      if (!botManager.isReady()) return;

      clearInterval(autoStartBots);
      const result = botManager.start(BOT_AUTOSTART);
      const status = result.ok ? 'başlatıldı' : 'başlatılamadı';
      console.log(`${getTimestamp()} 🤖 Otomatik bot başlatma ${status}: ${result.message}`);
    }, 250);
  }
}
