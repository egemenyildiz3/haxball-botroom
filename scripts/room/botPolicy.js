function isBotPlayer(botManager, player) {
  return !!(
    player
    && botManager
    && typeof botManager.isBotPlayer === 'function'
    && botManager.isBotPlayer(player.id)
  );
}

function isProtectedBotIdentity(botManager, player) {
  return !!(
    player
    && botManager
    && typeof botManager.isProtectedBotIdentity === 'function'
    && botManager.isProtectedBotIdentity(player)
  );
}

function desiredEvenActiveCount(realCount, botCount, maxActivePlayers = 8) {
  const desired = Math.min(maxActivePlayers, Math.max(0, realCount) + Math.max(0, botCount));
  return desired % 2 === 0 ? desired : Math.max(0, desired - 1);
}

function desiredBotCount(realCount, botCount, maxActivePlayers = 8) {
  const desiredActive = desiredEvenActiveCount(realCount, botCount, maxActivePlayers);
  return Math.min(botCount, Math.max(0, desiredActive - Math.min(realCount, desiredActive)));
}

function sortRealPlayersFirst(botManager, playerJoinOrder) {
  return (a, b) => {
    const botDelta = Number(isBotPlayer(botManager, a)) - Number(isBotPlayer(botManager, b));
    if (botDelta !== 0) return botDelta;
    return (playerJoinOrder.get(a.id) ?? 0) - (playerJoinOrder.get(b.id) ?? 0);
  };
}

module.exports = {
  isBotPlayer,
  isProtectedBotIdentity,
  desiredBotCount,
  desiredEvenActiveCount,
  sortRealPlayersFirst,
};
