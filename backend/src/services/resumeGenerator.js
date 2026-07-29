const { build } = require('./resumePrompt');
const llm = require('./llm');

/**
 * R-JobSearch-Insight-1: 简历生成后,加 STAR 故事点
 *
 * 基于本次求职实战经验:STAR 答案比简历本身更决定面试成败。
 * 一次生成同时给: 简历全文 + 3-5 个 STAR 故事点 (可直接复用面试)。
 *
 * @param {Object} sourceForm - 用户填的资料
 * @returns {Promise<{resume: string, storyPoints: Array, mode: string}>}
 *   - resume: 完整简历 (Markdown)
 *   - storyPoints: [{title, situation, task, action, result}] × 3-5
 *   - mode: 'structured' (LLM 返 JSON 成功) | 'plaintext' (fallback)
 */
async function generate(sourceForm) {
  const { system, user } = await build(sourceForm);

  // 优化:追加 JSON 输出指令,要求 LLM 同时输出 STAR 故事点
  // 用户求职实战经验:STAR 答案比通用简历有用
  const jsonInstruction = `

【输出格式要求】
请严格输出 JSON (不要 \`\`\`json 包裹,直接 JSON):
{
  "resume": "完整简历内容 (Markdown 格式,500-800 字)",
  "storyPoints": [
    {
      "title": "故事标题 (一句话概括,15 字内)",
      "situation": "背景/挑战 (2-3 句话)",
      "task": "你的任务 (1-2 句话)",
      "action": "你做了什么 (3-5 句话,强调 AI 协作)",
      "result": "量化结果 (2-3 句话,有数据)"
    }
    // 至少 3 个,最多 5 个
  ]
}

【关键】action 部分必须强调"AI 协作":用 Claude/DeepSeek 等 AI 工具协作完成,不写代码也能产出生产级 AI 应用。这是 2026 年大厂最认可的画像。`;

  const result = await llm.chat(
    [
      { role: 'system', content: system },
      { role: 'user', content: user + jsonInstruction },
    ],
    { maxTokens: 2500, temperature: 0.7 } // 增大 tokens,因为输出更长了
  );

  const content = result.content.trim();

  // 尝试解析 JSON (LLM 输出可能包 ```json ... ``` 或多余字符)
  try {
    let jsonStr = content;
    const m = content.match(/```(?:json)?\s*([\s\S]+?)\s*```/);
    if (m) jsonStr = m[1];
    // 找第一个 { 到最后一个 }
    const start = jsonStr.indexOf('{');
    const end = jsonStr.lastIndexOf('}');
    if (start >= 0 && end > start) {
      jsonStr = jsonStr.slice(start, end + 1);
    }
    const parsed = JSON.parse(jsonStr);
    return {
      resume: parsed.resume || content,
      storyPoints: Array.isArray(parsed.storyPoints) ? parsed.storyPoints : [],
      mode: 'structured',
    };
  } catch (e) {
    // Fallback: LLM 没返 JSON,直接当纯文本简历
    return {
      resume: content,
      storyPoints: [],
      mode: 'plaintext',
    };
  }
}

module.exports = { generate };