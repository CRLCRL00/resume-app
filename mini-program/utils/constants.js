const SCORE_COLOR = {
  HIGH: '#07c160',
  MID:  '#ff9800',
  LOW:  '#999',
};

function scoreColor(score) {
  if (score >= 80) return SCORE_COLOR.HIGH;
  if (score >= 60) return SCORE_COLOR.MID;
  return SCORE_COLOR.LOW;
}

module.exports = { SCORE_COLOR, scoreColor };
