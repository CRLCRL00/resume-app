const { build } = require('./resumePrompt');
const llm = require('./llm');

async function generate(sourceForm) {
  const { system, user } = await build(sourceForm);
  const result = await llm.chat(
    [
      { role: 'system', content: system },
      { role: 'user', content: user },
    ],
    { maxTokens: 1500, temperature: 0.7 }
  );
  return result.content.trim();
}

module.exports = { generate };