function loadingStages() {
  return [
    { at: 0, text: '提交中...' },
    { at: 1000, text: '生成中...' },
    { at: 15000, text: '生成中，首次较慢，请耐心等待' },
  ];
}

module.exports = { loadingStages };