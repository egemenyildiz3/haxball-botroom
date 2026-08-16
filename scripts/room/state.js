const { createChatFilter } = require('../chatFilter');

function createRoomState() {
  return {
    lastTouchPlayer: null,
    secondLastTouchPlayer: null,
    currentGame: null,
    nextJoinNumber: 100,
    nextJoinOrder: 1,
    playerAuths: new Map(),
    afkPlayers: new Set([0]),
    manualPlacements: new Map(),
    isRebalancing: false,
    rebalanceRequested: false,
    autoManageEnabled: true,
    chatFilter: createChatFilter(),
  };
}

module.exports = { createRoomState };
