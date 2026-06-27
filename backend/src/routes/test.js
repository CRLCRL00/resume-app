const express = require('express');
const router = express.Router();
const llmService = require('../services/llm');

router.get('/llm', async (req, res, next) => {
  try {
    const result = await llmService.chat(
      [{ role: 'user', content: '只回复 pong 一个词，不要任何其他内容' }],
      { maxTokens: 10, temperature: 0 }
    );
    res.json({
      code: 0,
      data: {
        reply: result.content,
        usage: result.usage,
        model: 'deepseek-chat',
      },
    });
  } catch (err) {
    next(err);
  }
});

module.exports = router;