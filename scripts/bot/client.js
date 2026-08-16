#!/usr/bin/env node
/**
 * Bot istemcisi (ayrı process).
 *
 * Odaya gerçek bir oyuncu olarak bağlanır, her fizik tick'inde oyun durumunu
 * okur ve brain.js'in verdiği karara göre tuşlara basar. Tarayıcı gerekmez:
 * node-haxball Haxball protokolünü doğrudan Node üzerinde konuşur.
 *
 * Kullanım: node scripts/bot/client.js --room <ROOM_ID>
 * Ana process ile IPC üzerinden haberleşir (process.send).
 */

const API = require('node-haxball')();
const { Utils, Room, Errors } = API;
const { decide } = require('./brain');

/**
 * Bağlantı hatalarını okunabilir metne çevirir. Language ayarlanmadığı için
 * HBError.toString() "undefined" döndürüyor; bu yüzden kod adına bakıyoruz.
 */
function describeError(err) {
  if (err === null || err === undefined) return 'bilinmiyor';

  const code = typeof err === 'object' ? (err.code ?? err.errorCode) : undefined;
  if (Number.isFinite(code)) {
    const name = Object.keys(Errors.ErrorCodes).find((k) => Errors.ErrorCodes[k] === code);
    return name ? `${name} (kod ${code})` : `kod ${code}`;
  }

  const text = String(err);
  return text && text !== 'undefined' && text !== '[object Object]' ? text : 'bilinmiyor';
}

const args = process.argv.slice(2);

function argValue(flag, fallback) {
  const i = args.indexOf(flag);
  return i !== -1 && args[i + 1] ? args[i + 1] : fallback;
}

const ROOM_ID = argValue('--room', process.env.HAXBALL_BOT_ROOM_ID || '');
const BOT_NAME = argValue('--name', process.env.HAXBALL_BOT_NAME || 'SpaceBot');
const BOT_AVATAR = argValue('--avatar', process.env.HAXBALL_BOT_AVATAR || '🤖');
const ROOM_PASSWORD = process.env.HAXBALL_BOT_ROOM_PASSWORD || undefined;
const AUTH_KEY = process.env.HAXBALL_BOT_AUTH_KEY || '';

// brain.js ayarlarını .env üzerinden geçmeye izin ver (opsiyonel)
const BRAIN_CONFIG = {};
if (process.env.HAXBALL_BOT_KICK_PADDING) {
  BRAIN_CONFIG.kickPadding = Number(process.env.HAXBALL_BOT_KICK_PADDING);
}
if (process.env.HAXBALL_BOT_SHOT_CONE) {
  BRAIN_CONFIG.goalMargin = Number(process.env.HAXBALL_BOT_SHOT_CONE);
}

const memory = { kickCooldown: 0 };
let room = null;
let lastKeyState = -1;
let lastRole = '';

function report(type, payload) {
  const msg = { type, ...payload };
  if (typeof process.send === 'function') {
    try { process.send(msg); } catch (e) {}
  }
  console.log(`[BOT] ${type}${payload && payload.detail ? `: ${payload.detail}` : ''}`);
}

if (!ROOM_ID) {
  console.error('[BOT] Oda kimliği verilmedi (--room). Çıkılıyor.');
  process.exit(1);
}

/**
 * Oyun durumunu brain.js'in beklediği sade görünüme dönüştürür.
 * Bot sahada değilse (izleyici / maç durmuş) null döner.
 */
function buildView(myId) {
  try {
    room.extrapolate();
  } catch (e) {
    // extrapolate maç durmuşken hata verebilir; görmezden gel
  }

  const state = room.state;
  const gameState = room.gameStateExt || room.gameState;
  if (!state || !gameState || !gameState.physicsState) return null;

  const players = state.players || [];
  const me = players.find((p) => p.id === myId);
  if (!me || !me.disc || !me.team) return null;

  const teamId = me.team.id;
  if (teamId !== 1 && teamId !== 2) return null; // izleyicideyiz

  const ball = gameState.physicsState.discs[0];
  if (!ball || !ball.pos) return null;

  const goals = (state.stadium && state.stadium.goals) || [];
  const ownGoal = goals.find((g) => g.team && g.team.id === teamId);
  const oppGoal = goals.find((g) => g.team && g.team.id !== teamId);
  if (!ownGoal || !oppGoal) return null;

  const toActor = (p) => ({
    id: p.id,
    pos: p.disc.pos,
    speed: p.disc.speed || { x: 0, y: 0 },
    radius: p.disc.radius,
  });

  const onPitch = players.filter((p) => p.disc && p.team && p.id !== myId);

  return {
    self: toActor(me),
    ball: {
      pos: ball.pos,
      speed: ball.speed || { x: 0, y: 0 },
      radius: ball.radius,
      damping: ball.damping,
    },
    teammates: onPitch.filter((p) => p.team.id === teamId).map(toActor),
    opponents: onPitch.filter((p) => p.team.id !== teamId && p.team.id !== 0).map(toActor),
    ownGoal: { p0: ownGoal.p0, p1: ownGoal.p1 },
    oppGoal: { p0: oppGoal.p0, p1: oppGoal.p1 },
    stadium: {
      width: (state.stadium && state.stadium.width) || 420,
      height: (state.stadium && state.stadium.height) || 200,
    },
  };
}

function onTick() {
  const myId = room.currentPlayerId;
  const view = buildView(myId);

  // Sahada değilsek tüm tuşları bırak
  if (!view) {
    if (lastKeyState !== 0) {
      room.setKeyState(0);
      lastKeyState = 0;
    }
    memory.kickCooldown = 0;
    return;
  }

  const move = decide(view, memory, BRAIN_CONFIG);
  const keyState = Utils.keyState(move.dirX, move.dirY, move.kick);

  // Aynı tuş durumunu tekrar tekrar göndermeyelim (ağ trafiği + input lag)
  if (keyState !== lastKeyState) {
    room.setKeyState(keyState);
    lastKeyState = keyState;
  }

  if (move.role !== lastRole) {
    lastRole = move.role;
    report('role', { role: move.role, detail: move.role });
  }
}

function onOpen(joined) {
  room = joined;

  room.onGameTick = () => {
    try {
      onTick();
    } catch (err) {
      console.error('[BOT] Tick hatası:', err.message);
    }
  };

  room.onGameStop = () => {
    memory.kickCooldown = 0;
    lastKeyState = -1;
    try { room.setKeyState(0); } catch (e) {}
  };

  report('joined', { playerId: room.currentPlayerId, detail: `oyuncu id=${room.currentPlayerId}` });
}

function shutdown(code) {
  try {
    if (room) {
      room.setKeyState(0);
      room.leave();
    }
  } catch (e) {}
  process.exit(code || 0);
}

process.on('SIGTERM', () => shutdown(0));
process.on('SIGINT', () => shutdown(0));

process.on('uncaughtException', (err) => {
  console.error('[BOT] Yakalanmamış istisna:', err.message);
});

(async () => {
  try {
    const authObj = AUTH_KEY
      ? await Utils.authFromKey(AUTH_KEY)
      : (await Utils.generateAuth())[1];

    report('connecting', { detail: `oda ${ROOM_ID}` });

    Room.join(
      { id: ROOM_ID, password: ROOM_PASSWORD, authObj },
      {
        storage: { player_name: BOT_NAME, avatar: BOT_AVATAR },
        noPluginMechanism: true,
        onOpen,
        onClose: (reason) => {
          report('closed', { detail: describeError(reason) });
          process.exit(0);
        },
      }
    );
  } catch (err) {
    console.error('[BOT] Bağlanılamadı:', err.message);
    process.exit(1);
  }
})();
