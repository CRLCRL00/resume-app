const pool = require('../config/db');
const { AppError } = require('../middleware/errorHandler');

async function build(sourceForm) {
  const [rows] = await pool.query(
    "SELECT content FROM prompts WHERE code = 'resume_generate' AND is_active = 1 LIMIT 1"
  );
  if (!rows.length) throw new AppError(1200, 'prompt not configured', 500);

  const promptContent = rows[0].content;
  const system = promptContent.replace('{user_form}', '').trim();
  const user = JSON.stringify(sourceForm, null, 2);

  return { system, user };
}

module.exports = { build };