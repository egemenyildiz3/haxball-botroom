const { normalizeCmd } = require('../util');
const { sendMsg } = require('./helpers');

function routeAutoCommand(ctx) {
  const { room, player, args, command, displayName, cleanedName, isSuperAdmin, autoManager } = ctx;
  if (command !== '!oto' && command !== '!otomatik' && command !== '!auto') return null;

  if (!player.admin && !isSuperAdmin) {
    sendMsg(room, '❌ Bu komutu kullanmak için yönetici olmalısın.', player.id, 0xFF5555, 'bold');
    return false;
  }

  if (!autoManager) {
    sendMsg(room, '❌ Otomatik yönetim denetimi bu odada aktif değil.', player.id, 0xFF5555, 'bold');
    return false;
  }

  const sub = normalizeCmd(args[1] || 'durum');

  if (sub === 'kapat' || sub === 'off' || sub === 'kapali') {
    if (!autoManager.isEnabled()) {
      sendMsg(room, 'ℹ️ Otomatik yönetim zaten kapalı.', player.id, 0xFFCC00, 'normal');
      return false;
    }
    autoManager.disable();
    sendMsg(
      room,
      `🔒 Otomatik yönetim KAPATILDI (${displayName}). Artık takım dağıtımı, otomatik maç başlatma ve maç sonu rotasyonu yapılmayacak.`,
      null,
      0xFFCC00,
      'bold'
    );
    console.log(`[AUTO] Otomatik yönetim kapatıldı -> ${cleanedName}`);
  } else if (sub === 'ac' || sub === 'on' || sub === 'acik') {
    if (autoManager.isEnabled()) {
      sendMsg(room, 'ℹ️ Otomatik yönetim zaten açık.', player.id, 0xFFCC00, 'normal');
      return false;
    }
    autoManager.enable();
    sendMsg(
      room,
      `🔓 Otomatik yönetim AÇILDI (${displayName}). Takım dağıtımı ve otomatik maç başlatma yeniden devrede.`,
      null,
      0x00FF7F,
      'bold'
    );
    console.log(`[AUTO] Otomatik yönetim açıldı -> ${cleanedName}`);
  } else if (sub === 'durum' || sub === 'status') {
    sendMsg(room, autoManager.status(), player.id, 0x00BFFF, 'normal');
  } else {
    sendMsg(room, '❌ Kullanım: !oto aç | !oto kapat | !oto durum', player.id, 0xFF5555, 'bold');
  }

  return false;
}

module.exports = { routeAutoCommand };
