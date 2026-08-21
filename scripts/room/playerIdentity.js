const { getCleanName } = require('../util');

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

function assignPlayerInternal(room, player, state, { playerAssignments, playerJoinOrder, getTimestamp }) {
  const cleanedName = getCleanName(player);
  const assignedId = String(state.nextJoinNumber).padStart(3, '0');
  state.nextJoinNumber = state.nextJoinNumber === 999 ? 100 : state.nextJoinNumber + 1;

  const taggedName = `[${assignedId}] ${cleanedName}`;
  playerAssignments.set(player.id, taggedName);
  playerJoinOrder.set(player.id, state.nextJoinOrder++);

  if (typeof room.setPlayerTeam === 'function') {
    try { room.setPlayerTeam(player.id, 0); } catch (e) {}
  }

  console.log(`[JOIN] Oyuncu katıldı: id=${player.id}, isim=${cleanedName} (Atanan Etiket: ${taggedName}). Zaman: ${getTimestamp()}`);
}

module.exports = {
  sanitizePlayer,
  assignPlayerInternal,
};
