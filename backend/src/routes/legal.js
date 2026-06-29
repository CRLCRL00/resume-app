const express = require('express');
const router = express.Router();
const legal = require('../services/legal');

router.get('/privacy', (req, res) => {
  res.json({ code: 0, data: legal.getPrivacy() });
});

router.get('/terms', (req, res) => {
  res.json({ code: 0, data: legal.getTerms() });
});

module.exports = router;
