const { createChatFilter } = require('../chatFilter');

function createRoomState() {
  return {
    lastTouchPlayer: null,
    secondLastTouchPlayer: null,
    touchHistory: [],
    currentGame: null,
    lastGameTickAt: null,
    kickoffWatch: null,
    ballRecovery: null,
    joinIdsByPlayer: new Map(),
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
    mutedPlayers: new Map(),
    lastInputAt: new Map(),
    inactivityWarnings: new Set(),
    chatFilter: createChatFilter(),
  };
}

module.exports = { createRoomState };
