const { sendMsg } = require('./helpers');
const { saveAdminRequest } = require('../db');

const ADMIN_REQUEST_COOLDOWN_MS = 15 * 60 * 1000;
const lastAdminRequestAt = new Map();

function requestKey(player) {
  return player.auth || player.conn || String(player.id);
}

function minutesLeft(ms) {
  return Math.max(1, Math.ceil(ms / 60000));
}

function routeRequestCommand(ctx) {
  const { command } = ctx;
  if (command !== '!admin') return null;

  const { room, player, args, cleanedName, db, DB_FILE, persistDatabase } = ctx;
  const aciklama = args.slice(1).join(' ').trim();

  if (!aciklama) {
    sendMsg(room, '📮 Kullanım: !admin <istek / talep / şikayet>', player.id, 0xFFCC00, 'bold');
    return false;
  }

  const key = requestKey(player);
  const now = Date.now();
  const previous = lastAdminRequestAt.get(key) || 0;
  const waitMs = ADMIN_REQUEST_COOLDOWN_MS - (now - previous);

  if (waitMs > 0) {
    sendMsg(room, `⏳ Bu komutu ${minutesLeft(waitMs)} dk sonra tekrar kullanabilirsin.`, player.id, 0xFFCC00, 'bold');
    return false;
  }

  const result = saveAdminRequest(db, DB_FILE, cleanedName || player.name || 'Bilinmeyen', aciklama, persistDatabase);
  if (!result.ok) {
    sendMsg(room, `❌ İstek kaydedilemedi: ${result.error}`, player.id, 0xFF5555, 'bold');
    return false;
  }

  lastAdminRequestAt.set(key, now);
  sendMsg(room, '✅ İsteğin adminlere iletilmek üzere kaydedildi.', player.id, 0x00FF7F, 'bold');
  console.log(`[ADMIN-REQUEST] ${cleanedName || player.name || 'Bilinmeyen'}: ${aciklama}`);
  return false;
}

module.exports = { routeRequestCommand };
