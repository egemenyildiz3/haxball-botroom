const { createChatFilter } = require('../chatFilter');

function createRoomState() {
  return {
    lastTouchPlayer: null,
    secondLastTouchPlayer: null,
    touchHistory: [],
    currentGame: null,
    nextJoinNumber: 100,
    nextJoinOrder: 1,
    playerAuths: new Map(),
    afkPlayers: new Set([0]),
    manualPlacements: new Map(),
    isRebalancing: false,
    rebalanceRequested: false,
    startGamePending: false,
    teamChangesLocked: false,
    lockedTeams: new Map(),
    autoManageEnabled: true,
    chatMuted: false,
    chatFilter: createChatFilter(),
  };
}

module.exports = { createRoomState };
