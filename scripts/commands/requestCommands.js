const { sendMsg } = require('./helpers');
const { saveAdminRequest } = require('../db');

const lastAdminRequestAt = new Map();

function requestKey(player) {
  return player.auth || player.conn || String(player.id);
}

function minutesLeft(ms) {
  return Math.max(1, Math.ceil(ms / 60000));
}

function routeRequestCommand(ctx) {
  if (ctx.commandKey !== 'adminRequest') return null;

  const { room, player, args, cleanedName, persistDatabase } = ctx;
  const db = ctx.roomDb || ctx.db;
  const DB_FILE = ctx.ROOM_DB_FILE || ctx.DB_FILE;
  const sharedDb = ctx.sharedDb || ctx.db;
  const t = ctx.t || ((key, vars = {}) => {
    const messages = {
      'request.usage': '📮 Kullanım: !admin <istek / talep / şikayet>',
      'request.cooldown': `⏳ Bu komutu ${vars.minutes} dk sonra tekrar kullanabilirsin.`,
      'request.error': `❌ İstek kaydedilemedi: ${vars.error}`,
      'request.success': '✅ İsteğin Adminlere iletilmek üzere kaydedildi.',
    };
    return messages[key] || key;
  });
  const cooldownMs = ctx.config && ctx.config.adminRequests && typeof ctx.config.adminRequests.cooldownMs === 'number'
    ? ctx.config.adminRequests.cooldownMs
    : 15 * 60 * 1000;
  const aciklama = args.slice(1).join(' ').trim();

  if (!aciklama) {
    sendMsg(room, t('request.usage'), player.id, 0xFFCC00, 'bold');
    return false;
  }

  const key = requestKey(player);
  const now = Date.now();
  const previous = lastAdminRequestAt.get(key) || 0;
  const waitMs = cooldownMs - (now - previous);

  if (waitMs > 0) {
    sendMsg(room, t('request.cooldown', { minutes: minutesLeft(waitMs) }), player.id, 0xFFCC00, 'bold');
    return false;
  }

  const result = saveAdminRequest(db, DB_FILE, cleanedName || player.name || 'Bilinmeyen', aciklama, persistDatabase, sharedDb);
  if (!result.ok) {
    sendMsg(room, t('request.error', { error: result.error }), player.id, 0xFF5555, 'bold');
    return false;
  }

  lastAdminRequestAt.set(key, now);
  sendMsg(room, t('request.success'), player.id, 0x00FF7F, 'bold');
  console.log(`[ADMIN-REQUEST] ${cleanedName || player.name || 'Bilinmeyen'}: ${aciklama}`);
  return false;
}

module.exports = { routeRequestCommand };
