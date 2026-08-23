const { normalizeCmd } = require('../util');
const { sendMsg } = require('./helpers');
const { routeAccountCommand } = require('./accountCommands');
const { routeAdminCommand } = require('./adminCommands');
const { routePlayerCommand } = require('./playerCommands');
const { routeBotCommand } = require('./botCommands');
const { routeAutoCommand } = require('./autoCommands');
const { routeRequestCommand } = require('./requestCommands');
const { routeMuteCommand, muteKey, minutesLeft } = require('./muteCommands');

const COMMAND_ROUTERS = [
  routeAdminCommand,
  routeRequestCommand,
  routeMuteCommand,
  routePlayerCommand,
  routeAccountCommand,
  routeAutoCommand,
  routeBotCommand,
];

const NORMAL_CHAT_COLOR = 0xFFFFFF;
const ADMIN_CHAT_COLOR = 0xCC99FF;

function adminChatPrefix(isAdminChat, isSuperAdmin) {
  if (isSuperAdmin) return '[KURUCU] ';
  if (isAdminChat) return '[ADMIN] ';
  return '';
}

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
    const isAdminChat = player.admin || isSuperAdmin;

    if (deps.chatMuted && !isAdminChat) {
      sendMsg(room, '🔇 Sohbet şu anda kapalı. Komutları kullanabilirsin.', player.id, 0xFFCC00, 'bold');
      return false;
    }

    if (deps.mutedPlayers && !isAdminChat) {
      const key = muteKey(player);
      const mute = key ? deps.mutedPlayers.get(key) : null;
      if (mute && mute.until > Date.now()) {
        sendMsg(room, `🔇 ${minutesLeft(mute.until - Date.now())} dk daha susturuldunuz. Komutları kullanabilirsiniz.`, player.id, 0xFFCC00, 'bold');
        return false;
      }
      if (mute) deps.mutedPlayers.delete(key);
    }

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

    sendMsg(
      room,
      `💬 ${adminChatPrefix(isAdminChat, isSuperAdmin)}${displayName}: ${chatText}`,
      null,
      isAdminChat ? ADMIN_CHAT_COLOR : NORMAL_CHAT_COLOR,
      isAdminChat ? 'bold' : 'normal'
    );
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
