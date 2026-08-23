const fs = require('fs');
const path = require('path');
const { createHostRoom } = require('./bot/hostRoom');

const { getTimestamp, sanitizeStadiumFileContents, sleep } = require('./util');
const { loadOrCreateDatabase, persistDatabase, initDatabase } = require('./db');
const { createRoom } = require('./room');
const { createBotManager } = require('./bot/manager');
const config = require('./config');
const { createTranslator } = require('./i18n');

const MAP_FILE = path.join(__dirname, '..', 'maps', 'Spacebounce.hbs');
const DB_FILE = path.join(__dirname, '..', 'db', 'haxball-results.sqlite');
const TOKEN = process.env.HAXBALL_TOKEN;
const t = createTranslator(config.room.language);

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
    botName: config.bot.baseName,
    botNames: config.bot.names,
    maxBots: config.bot.max,
    avatar: config.bot.avatar,
  });

  // Host kapanırken bot process'leri ortada kalmasın
  const cleanupBots = () => botManager.stopAll();
  process.on('exit', cleanupBots);
  process.on('SIGTERM', () => { cleanupBots(); process.exit(0); });
  process.on('SIGINT', () => { cleanupBots(); process.exit(0); });

  const host = createHostRoom({
    roomName: config.room.name,
    playerName: 'Host-admin',
    maxPlayers: config.room.maxPlayers,
    public: config.room.public,
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
      console.log(`${getTimestamp()} 🤖 Bot motoru hazır.`);
    }
  }, 250);

  await createRoom(room, {
    ROOM_NAME: config.room.name,
    SCORE_LIMIT: config.room.scoreLimit,
    TIME_LIMIT: config.room.timeLimit,
    SPEC_PROMOTION_COUNT: config.room.promotionCount,
    mapData,
    db,
    DB_FILE,
    persistDatabase,
    ADMIN_PASSWORD: config.adminRules.password,
    playerAssignments,
    playerJoinOrder,
    loggedInPlayers,
    leavingIntentions,
    getTimestamp,
    sleep,
    CONFIG_ADMIN_CAN_BAN: config.adminRules.canBan ? 1 : 0,
    CONFIG_ADMIN_CAN_GIVE_ADMIN: config.adminRules.canGiveAdmin ? 1 : 0,
    CONFIG_ALLOW_MULTIPLE_JOIN: config.adminRules.allowMultipleJoin ? 1 : 0,
    botManager,
    config,
    t,
  });

  if (config.bot.autostart > 0) {
    const autoStartBots = setInterval(() => {
      if (!botManager.isReady()) return;

      clearInterval(autoStartBots);
      const result = botManager.start(config.bot.autostart);
      const status = result.ok ? 'başlatıldı' : 'başlatılamadı';
      console.log(`${getTimestamp()} 🤖 Otomatik bot başlatma ${status}: ${result.message}`);
    }, 250);
  }
}
