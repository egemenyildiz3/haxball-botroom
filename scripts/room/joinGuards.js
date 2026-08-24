const { getCleanName } = require('../util');
const { sendMsg } = require('../commands/helpers');
const { isProtectedBotIdentity } = require('./botPolicy');
const { hasCapability } = require('../roles');

function hasAuthCapability(db, auth, capability, roleCapabilities) {
  if (!auth) return false;

  try {
    const stmt = db.prepare(`
      SELECT role FROM users
      WHERE auth_key = ?
        AND auth_key != ''
      LIMIT 1
    `);
    stmt.bind([auth]);
    const row = stmt.step() ? stmt.getAsObject() : null;
    stmt.free();
    return !!(row && hasCapability(row, capability, roleCapabilities));
  } catch (err) {
    console.warn('[JOIN-GUARD] Auth capability kontrolü başarısız:', err.message);
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
    if (playerAuth && candidateAuth && playerAuth === candidateAuth) {
      return { player: candidate, reason: 'auth', auth: candidateAuth };
    }
    if (playerConn && candidateConn && playerConn === candidateConn) {
      return { player: candidate, reason: 'conn', auth: candidateAuth };
    }
  }

  return null;
}

function blockInvalidJoinName(room, player, deps) {
  const { getTimestamp, botManager, t = (key) => key } = deps;
  if (isProtectedBotIdentity(botManager, player)) return false;

  const name = String(player.name || '');
  const trimmedName = name.trim();
  let reason = '';

  if (name !== trimmedName) {
    reason = t('join.nameTrim');
  } else if (name.toLowerCase().includes('spacebot')) {
    reason = t('join.spaceBotName');
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
  const { db, getTimestamp, CONFIG_ALLOW_MULTIPLE_JOIN = 0, botManager, config, t = (key, vars = {}) => {
    if (key === 'join.duplicate') return `⚠️ ${vars.name}, aynı bağlantı/auth ile zaten odada bir oturum açık!`;
    if (key === 'join.duplicateReason') return 'Aynı bağlantıdan zaten bir oturum var.';
    return key;
  } } = deps;
  if (Number(CONFIG_ALLOW_MULTIPLE_JOIN) === 1) return false;
  if (isProtectedBotIdentity(botManager, player)) return false;

  const match = duplicateJoinMatch(room, player, state, botManager);
  if (!match) return false;

  const roleCapabilities = config && config.adminRules && config.adminRules.roleCapabilities;
  if (hasAuthCapability(db, player.auth, 'duplicate_join_exempt', roleCapabilities)) return false;
  if (hasAuthCapability(db, match.auth, 'duplicate_join_exempt', roleCapabilities)) return false;

  const cleanName = getCleanName(player);
  const existingName = getCleanName(match.player);
  console.log(`${getTimestamp()} [DUPLICATE] Aynı ${match.reason} ile çift giriş engellendi: ${cleanName} (mevcut: ${existingName})`);

  try {
    sendMsg(room, t('join.duplicate', { name: cleanName }), player.id, 0xFF5555, 'bold');
    room.kickPlayer(player.id, t('join.duplicateReason'), false);
  } catch (e) {}

  return true;
}

module.exports = {
  blockInvalidJoinName,
  blockDuplicateJoin,
  duplicateJoinMatch,
  hasAuthCapability,
};
