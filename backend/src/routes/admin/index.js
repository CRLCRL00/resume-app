const express = require('express');
const router = express.Router();

router.use(require('./check'));
router.use(require('./jobs'));
router.use(require('./prompts'));
router.use(require('./logs'));

module.exports = router;