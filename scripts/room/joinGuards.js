const { getCleanName } = require('../util');
const { sendMsg } = require('../commands/helpers');
const { isProtectedBotIdentity } = require('./botPolicy');

function isSuperAdminAuth(db, auth) {
  if (!auth) return false;

  try {
    const stmt = db.prepare(`
      SELECT 1 FROM users
      WHERE auth_key = ?
        AND auth_key != ''
        AND isadmin = 1
      LIMIT 1
    `);
    stmt.bind([auth]);
    const found = stmt.step();
    stmt.free();
    return found;
  } catch (err) {
    console.warn('[JOIN-GUARD] Superadmin auth kontrolü başarısız:', err.message);
    return false;
  }
}

function duplicateJoinMatch(room, player, state, botManager) {
  if (typeof room.getPlayerList !== 'function') return null;

  const playerAuth = player.auth || '';
  const playerConn = player.conn || '';
  if (!playerAuth && !playerConn) return null;

  for (const candidate of room.getPlayerList()) {
    if (!candidate || candidate.id === player.id || candidate.id === 0) continue;

    const candidateAuth = candidate.auth
      || state.playerAuths.get(String(candidate.id))
      || state.playerAuths.get(Number(candidate.id))
      || '';
    const candidateConn = candidate.conn || '';

    if (isProtectedBotIdentity(botManager, candidate)) continue;
    if (playerAuth && candidateAuth && playerAuth === candidateAuth) return { player: candidate, reason: 'auth' };
    if (playerConn && candidateConn && playerConn === candidateConn) return { player: candidate, reason: 'conn' };
  }

  return null;
}

function blockInvalidJoinName(room, player, deps) {
  const { getTimestamp, botManager } = deps;
  if (isProtectedBotIdentity(botManager, player)) return false;

  const name = String(player.name || '');
  const trimmedName = name.trim();
  let reason = '';

  if (name !== trimmedName) {
    reason = 'İsminizin başında veya sonunda boşluk olamaz.';
  } else if (name.toLowerCase().includes('spacebot')) {
    reason = 'SpaceBot ismi sadece oda botlarına özeldir.';
  }

  if (!reason) return false;

  console.log(`${getTimestamp()} [JOIN-GUARD] Geçersiz isim engellendi: "${name}" (ID: ${player.id}) - ${reason}`);

  try {
    sendMsg(room, `⚠️ ${reason}`, player.id, 0xFF5555, 'bold');
    room.kickPlayer(player.id, reason, false);
  } catch (e) {}

  return true;
}

function blockDuplicateJoin(room, state, player, deps) {
  const { db, getTimestamp, CONFIG_ALLOW_MULTIPLE_JOIN = 0, botManager } = deps;
  if (Number(CONFIG_ALLOW_MULTIPLE_JOIN) === 1) return false;
  if (isProtectedBotIdentity(botManager, player)) return false;
  if (isSuperAdminAuth(db, player.auth)) return false;

  const match = duplicateJoinMatch(room, player, state, botManager);
  if (!match) return false;

  const cleanName = getCleanName(player);
  const existingName = getCleanName(match.player);
  console.log(`${getTimestamp()} [DUPLICATE] Aynı ${match.reason} ile çift giriş engellendi: ${cleanName} (mevcut: ${existingName})`);

  try {
    sendMsg(room, `⚠️ ${cleanName}, aynı bağlantı/auth ile zaten odada bir oturum açık!`, player.id, 0xFF5555, 'bold');
    room.kickPlayer(player.id, 'Aynı bağlantıdan zaten bir oturum var.', false);
  } catch (e) {}

  return true;
}

module.exports = {
  blockInvalidJoinName,
  blockDuplicateJoin,
  duplicateJoinMatch,
  isSuperAdminAuth,
};
