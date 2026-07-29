const fs = require('fs');
const path = require('path');
const HaxballJS = require('haxball.js').default;

const { getTimestamp, sanitizeStadiumFileContents, sleep } = require('./util');
const { loadOrCreateDatabase, persistDatabase, initDatabase } = require('./db');
const { createRoom } = require('./room');

const MAP_FILE = path.join(__dirname, '..', 'maps', 'Spacebounce.hbs');
const DB_FILE = path.join(__dirname, '..', 'db', 'haxball-results.sqlite');
const ROOM_NAME = process.env.HAXBALL_ROOM_NAME || '🛰️🛰️ SPACEBOUNCE | ⚽ 4v4 🪐 🛰️🛰️';
const MAX_PLAYERS = Number(process.env.HAXBALL_MAX_PLAYERS || 16);
const SCORE_LIMIT = Number(process.env.HAXBALL_SCORE_LIMIT || 3);
const TIME_LIMIT = Number(process.env.HAXBALL_TIME_LIMIT || 4);
const SPEC_PROMOTION_COUNT = Number(process.env.HAXBALL_PROMOTION_COUNT || 4);
const PRIVATE_ROOM = false;
const TOKEN = process.env.HAXBALL_TOKEN;
const ADMIN_PASSWORD = process.env.HAXBALL_ADMIN_PASSWORD;

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
const loggedInPlayers = new Set();
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

  const HBInit = await HaxballJS();
  const room = HBInit({
    roomName: ROOM_NAME,
    maxPlayers: MAX_PLAYERS,
    public: !PRIVATE_ROOM,
    noPlayer: true,
    token: TOKEN,
    geo: { code: 'tr', lat: 37.0208, lon: 30.8541 },
  });

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
  });
}
