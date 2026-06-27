const express = require('express');
const router = express.Router();

router.get('/', (req, res) => {
  res.json({
    code: 0,
    data: {
      status: 'ok',
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
    },
  });
});

module.exports = router;