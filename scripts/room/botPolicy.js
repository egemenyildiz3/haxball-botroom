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

function desiredBotCount(realCount, botCount, maxActivePlayers = 8) {
  return Math.min(botCount, Math.max(0, maxActivePlayers - Math.min(realCount, maxActivePlayers)));
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
  sortRealPlayersFirst,
};
