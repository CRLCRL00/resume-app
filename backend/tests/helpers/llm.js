const llm = require('../../src/services/llm');

const ORIG = {
  chat: llm.chat,
  chatJson: llm.chatJson,
};

function stubChat(fn) {
  llm.chat = fn;
}

function stubChatJson(fn) {
  llm.chatJson = fn;
}

function restoreAll() {
  llm.chat = ORIG.chat;
  llm.chatJson = ORIG.chatJson;
}

module.exports = { stubChat, stubChatJson, restoreAll, ORIG };
