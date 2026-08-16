const { sendMsg, resolveTargetPlayer } = require('./commands/helpers');
const { handleAutoLogin } = require('./commands/accountCommands');
const { handlePlayerChat } = require('./commands/router');

module.exports = {
  sendMsg,
  resolveTargetPlayer,
  handleAutoLogin,
  handlePlayerChat,
};
