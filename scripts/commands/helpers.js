function sendMsg(room, text, targetId, color = 0x00FF7F, style = 'bold') {
  try {
    console.log(`[BOT MSG] ${targetId ? `(Hedef ID: ${targetId}) ` : '(Genel) '}${text}`);
    room.sendAnnouncement(text, targetId, color, style, 1);
  } catch (err) {
    console.warn('sendAnnouncement hatası:', err.message);
  }
}

function resolveTargetPlayer(room, args, playerAssignments) {
  if (typeof room.getPlayerList !== 'function' || args.length < 2) {
    return { target: null, reason: '' };
  }

  const players = room.getPlayerList().filter((p) => p.id !== 0);
  const firstArg = args[1];

  if (!isNaN(firstArg)) {
    const targetId = Number(firstArg);
    const pById = players.find((x) => x.id === targetId);
    if (pById) {
      return { target: pById, reason: args.slice(2).join(' ') };
    }
  }

  if (!isNaN(firstArg)) {
    const pByTag = players.find((p) => {
      const dName = (playerAssignments && playerAssignments.get(p.id)) || p.name || '';
      const tagMatch = dName.match(/^\[(\d+)\]/);
      return tagMatch && Number(tagMatch[1]) === Number(firstArg);
    });
    if (pByTag) {
      return { target: pByTag, reason: args.slice(2).join(' ') };
    }
  }

  const fullInput = args.slice(1).join(' ').trim().toLowerCase();
  let match = players.find((p) => {
    const dName = ((playerAssignments && playerAssignments.get(p.id)) || p.name || '').toLowerCase();
    const rawName = (p.name || '').toLowerCase();
    const cleanName = rawName.replace(/^\[\d+\]\s*/, '').trim();
    return dName === fullInput || rawName === fullInput || cleanName === fullInput;
  });
  if (match) {
    return { target: match, reason: '' };
  }

  const firstArgLower = firstArg.toLowerCase();
  match = players.find((p) => {
    const dName = ((playerAssignments && playerAssignments.get(p.id)) || p.name || '').toLowerCase();
    const rawName = (p.name || '').toLowerCase();
    const cleanName = rawName.replace(/^\[\d+\]\s*/, '').trim();
    return dName === firstArgLower || rawName === firstArgLower || cleanName === firstArgLower;
  });
  if (match) {
    return { target: match, reason: args.slice(2).join(' ') };
  }

  const partialMatches = players.filter((p) => {
    const dName = ((playerAssignments && playerAssignments.get(p.id)) || p.name || '').toLowerCase();
    const rawName = (p.name || '').toLowerCase();
    return dName.includes(firstArgLower) || rawName.includes(firstArgLower) || dName.includes(fullInput);
  });

  if (partialMatches.length === 1) {
    return { target: partialMatches[0], reason: args.slice(2).join(' ') };
  }

  if (partialMatches.length > 1) {
    return { target: null, reason: '', candidates: partialMatches };
  }

  return { target: null, reason: '' };
}

function candidateList(candidates, playerAssignments) {
  return candidates.map((c) => `#${c.id} ${(playerAssignments.get(c.id) || c.name || '').trim()}`).join(', ');
}

module.exports = {
  sendMsg,
  resolveTargetPlayer,
  candidateList,
};
