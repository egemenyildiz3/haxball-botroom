const { normalizeCmd } = require('../util');
const { sendMsg } = require('./helpers');
const { routeAccountCommand } = require('./accountCommands');
const { routeAdminCommand } = require('./adminCommands');
const { routePlayerCommand } = require('./playerCommands');
const { routeBotCommand } = require('./botCommands');
const { routeAutoCommand } = require('./autoCommands');

const COMMAND_ROUTERS = [
  routeAdminCommand,
  routePlayerCommand,
  routeAccountCommand,
  routeAutoCommand,
  routeBotCommand,
];

function handlePlayerChat(room, player, msg, deps) {
  const text = String(msg || '').trim();

  const displayName = deps.playerAssignments.get(player.id) || (player.name ? player.name.replace(/^\[\d{3}\]\s*/, '').trim() : '');
  const cleanedName = (player.name || '').replace(/^\[\d{3}\]\s*/, '').trim();

  const args = text.split(' ');
  const command = normalizeCmd(args[0] || '');
  const playerToken = player.auth || player.conn || '';

  const userData = deps.loggedInPlayers.get(player.id);
  const isSuperAdmin = userData && userData.isadmin === 1;

  console.log(`[CHAT] ${displayName} : ${text}`);

  if (text.startsWith('/')) {
    return true;
  }

  if (!text.startsWith('!')) {
    const chatText = text.toLocaleLowerCase('tr-TR');

    if (deps.chatFilter && typeof deps.chatFilter.check === 'function') {
      const filterResult = deps.chatFilter.check(player, chatText, { loggedInPlayers: deps.loggedInPlayers });
      if (!filterResult.allowed) {
        if (!filterResult.silent) {
          sendMsg(room, filterResult.message, player.id, filterResult.color || 0xFFCC00, 'bold');
        }
        console.log(`[CHAT-FILTER] ${displayName} engellendi: ${filterResult.reason}`);
        return false;
      }
    }

    sendMsg(room, `💬 ${displayName}: ${chatText}`, null, 0xFFFFFF, 'normal');
    return false;
  }

  const ctx = {
    ...deps,
    room,
    player,
    msg,
    text,
    args,
    command,
    displayName,
    cleanedName,
    playerToken,
    userData,
    isSuperAdmin,
  };

  for (const route of COMMAND_ROUTERS) {
    const result = route(ctx);
    if (result !== null) return result;
  }

  sendMsg(room, '❌ Hatalı komut! Yardım için !yardım yazabilirsiniz.', player.id, 0xFF5555, 'bold');
  return false;
}

module.exports = { handlePlayerChat };
