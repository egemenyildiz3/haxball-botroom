const { getCleanName } = require('../util');

const MIN_JOIN_ID = 100;
const MAX_JOIN_ID = 999;

function sanitizePlayer(room, player, state) {
  if (!player || typeof player.id === 'undefined') return player;

  const realPlayer = (typeof room.getPlayer === 'function') ? (room.getPlayer(player.id) || player) : player;
  const cachedAuth = state.playerAuths.get(String(player.id)) || state.playerAuths.get(Number(player.id)) || '';

  return {
    ...realPlayer,
    auth: player.auth || cachedAuth || realPlayer.auth || '',
    conn: player.conn || realPlayer.conn || '',
    name: realPlayer.name || player.name || '',
    id: realPlayer.id ?? player.id,
    team: realPlayer.team ?? player.team ?? 0,
    admin: realPlayer.admin ?? player.admin ?? false,
  };
}

function randomJoinId() {
  return MIN_JOIN_ID + Math.floor(Math.random() * (MAX_JOIN_ID - MIN_JOIN_ID + 1));
}

function distanceToClosest(id, usedIds) {
  if (usedIds.size === 0) return Infinity;

  let best = Infinity;
  for (const used of usedIds) {
    best = Math.min(best, Math.abs(id - used));
  }
  return best;
}

function allocateJoinId(state) {
  const usedIds = new Set(state.joinIdsByPlayer.values());
  if (usedIds.size >= (MAX_JOIN_ID - MIN_JOIN_ID + 1)) return randomJoinId();
  if (usedIds.size === 0) return randomJoinId();

  let bestIds = [];
  let bestScore = -1;

  for (let id = MIN_JOIN_ID; id <= MAX_JOIN_ID; id++) {
    if (usedIds.has(id)) continue;

    const score = distanceToClosest(id, usedIds);
    if (score > bestScore) {
      bestScore = score;
      bestIds = [id];
    } else if (score === bestScore) {
      bestIds.push(id);
    }
  }

  return bestIds[Math.floor(Math.random() * bestIds.length)];
}

function assignPlayerInternal(room, player, state, { playerAssignments, playerJoinOrder, getTimestamp }) {
  const cleanedName = getCleanName(player);
  const assignedId = allocateJoinId(state);
  state.joinIdsByPlayer.set(player.id, assignedId);

  const taggedName = `[${String(assignedId).padStart(3, '0')}] ${cleanedName}`;
  playerAssignments.set(player.id, taggedName);
  playerJoinOrder.set(player.id, state.nextJoinOrder++);

  if (typeof room.setPlayerTeam === 'function') {
    try { room.setPlayerTeam(player.id, 0); } catch (e) {}
  }

  console.log(`[JOIN] Oyuncu katıldı: id=${player.id}, isim=${cleanedName} (Atanan Etiket: ${taggedName}). Zaman: ${getTimestamp()}`);
}

module.exports = {
  sanitizePlayer,
  allocateJoinId,
  assignPlayerInternal,
};
