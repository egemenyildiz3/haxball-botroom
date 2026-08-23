const { normalizeCmd } = require('../util');
const { sendMsg } = require('./helpers');

function routeBotCommand(ctx) {
  const { room, player, args, botManager } = ctx;
  const t = ctx.t || ((key) => ({
    'bot.needAdmin': '❌ Bot kontrolü için Admin olmalısın.',
    'bot.unavailable': '❌ Bot yöneticisi bu odada aktif değil.',
    'bot.usage': '❌ Kullanım: !bot aç [adet] | !bot kapat | !bot hepsi | !bot durum',
  }[key] || key));
  if (ctx.commandKey !== 'bot') return null;

  if (!player.admin && !(typeof ctx.hasCapability === 'function' && ctx.hasCapability('bot'))) {
    sendMsg(room, t('bot.needAdmin'), player.id, 0xFF5555, 'bold');
    return false;
  }

  if (!botManager) {
    sendMsg(room, t('bot.unavailable'), player.id, 0xFF5555, 'bold');
    return false;
  }

  const sub = normalizeCmd(args[1] || 'durum');

  if (sub === 'ac' || sub === 'on' || sub === 'baslat' || sub === 'add' || sub === 'start') {
    const result = botManager.start(args[2] || 1);
    sendMsg(room, result.message, null, result.ok ? 0x00FF7F : 0xFF5555, 'bold');
  } else if (sub === 'kapat' || sub === 'off' || sub === 'durdur' || sub === 'remove' || sub === 'stop') {
    const result = typeof botManager.stopLast === 'function' ? botManager.stopLast() : botManager.stop();
    sendMsg(room, result.message, null, result.ok ? 0x00FF7F : 0xFF5555, 'bold');
  } else if (sub === 'hepsi' || sub === 'all' || sub === 'temizle' || sub === 'clear') {
    const result = botManager.stop();
    sendMsg(room, result.message, null, result.ok ? 0x00FF7F : 0xFF5555, 'bold');
  } else if (sub === 'durum' || sub === 'status') {
    sendMsg(room, botManager.status(), player.id, 0x00BFFF, 'normal');
  } else {
    sendMsg(room, t('bot.usage'), player.id, 0xFF5555, 'bold');
  }

  return false;
}

module.exports = { routeBotCommand };
