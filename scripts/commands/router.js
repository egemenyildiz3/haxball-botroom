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

const TEAM_RADIO_COLORS = {
  1: 0xFF7777,
  2: 0x77A7FF,
};

function adminChatPrefix(isAdminChat, isSuperAdmin) {
  if (isSuperAdmin) return '[KURUCU] ';
  if (isAdminChat) return '[ADMIN] ';
  return '';
}

function playerTeamId(player) {
  if (!player || !player.team) return 0;
  if (typeof player.team === 'number') return player.team;
  return player.team.id || 0;
}

function isAdminLike(player, loggedInPlayers) {
  const userData = loggedInPlayers && loggedInPlayers.get(player.id);
  return !!(player.admin || (userData && userData.isadmin === 1));
}

function fallbackT(key, vars = {}) {
  const messages = {
    'common.unknownCommand': '❌ Hatalı komut! Yardım için !yardım yazabilirsiniz.',
    'chat.muted': '🔇 Sohbet şu anda kapalı. Komutları kullanabilirsin.',
    'chat.playerMuted': `🔇 ${vars.minutes} dk daha susturuldunuz. Komutları kullanabilirsiniz.`,
    'teamRadio.onlyPlayers': '📻 Telsizi sadece sahadaki oyuncular kullanabilir.',
    'teamRadio.usage': '📻 Kullanım: !t <mesaj>',
    'teamRadio.red': 'KIRMIZI',
    'teamRadio.blue': 'MAVİ',
    'teamRadio.team': 'TAKIM',
    'teamRadio.message': `📻 [${vars.team} TELSİZ] ${vars.name}: ${vars.message}`,
  };
  return messages[key] || key;
}

function sendTeamRadio(room, player, message, { displayName, loggedInPlayers, t = fallbackT }) {
  const teamId = playerTeamId(player);

  if (teamId !== 1 && teamId !== 2) {
    sendMsg(room, t('teamRadio.onlyPlayers'), player.id, 0xFFCC00, 'bold');
    return false;
  }

  const radioText = message.trim().toLocaleLowerCase('tr-TR');
  if (!radioText) {
    sendMsg(room, t('teamRadio.usage'), player.id, 0xFFCC00, 'bold');
    return false;
  }

  if (typeof room.getPlayerList !== 'function') return false;

  const color = TEAM_RADIO_COLORS[teamId] || 0x00BFFF;
  const teamName = teamId === 1 ? t('teamRadio.red') : teamId === 2 ? t('teamRadio.blue') : t('teamRadio.team');
  const text = t('teamRadio.message', { team: teamName, name: displayName, message: radioText });
  const recipients = room.getPlayerList()
    .filter((p) => p.id !== 0 && (playerTeamId(p) === teamId || isAdminLike(p, loggedInPlayers)));
  const sent = new Set();

  for (const recipient of recipients) {
    if (sent.has(recipient.id)) continue;
    sent.add(recipient.id);
    sendMsg(room, text, recipient.id, color, 'bold');
  }

  console.log(`[TEAM-RADIO] team=${teamName} ${displayName}: ${radioText}`);
  return false;
}

function handlePlayerChat(room, player, msg, deps) {
  const text = String(msg || '').trim();
  const t = deps.t || fallbackT;
  const chatConfig = deps.config && deps.config.chat ? deps.config.chat : {};

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

  if (command === '!t' || command === '!takim' || command === '!team') {
    return sendTeamRadio(room, player, args.slice(1).join(' '), {
      displayName,
      loggedInPlayers: deps.loggedInPlayers,
      t,
    });
  }

  if (!text.startsWith('!')) {
    const chatText = text.toLocaleLowerCase('tr-TR');
    const isAdminChat = player.admin || isSuperAdmin;

    if (deps.chatMuted && !isAdminChat) {
      sendMsg(room, t('chat.muted'), player.id, 0xFFCC00, 'bold');
      return false;
    }

    if (deps.mutedPlayers && !isAdminChat) {
      const key = muteKey(player);
      const mute = key ? deps.mutedPlayers.get(key) : null;
      if (mute && mute.until > Date.now()) {
        sendMsg(room, t('chat.playerMuted', { minutes: minutesLeft(mute.until - Date.now()) }), player.id, 0xFFCC00, 'bold');
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
      isAdminChat ? (chatConfig.adminColor || 0xCC99FF) : (chatConfig.normalColor || 0xFFFFFF),
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

  sendMsg(room, t('common.unknownCommand'), player.id, 0xFF5555, 'bold');
  return false;
}

module.exports = { handlePlayerChat };
