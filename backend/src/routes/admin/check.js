const express = require('express');
const router = express.Router();
const { userAuth } = require('../../middleware/auth');
const { adminAuth } = require('../../middleware/adminAuth');

router.get('/check', userAuth, adminAuth, (req, res) => {
  res.json({ code: 0, data: { isAdmin: true } });
});

module.exports = router;