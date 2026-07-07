const express = require('express');
const router = express.Router();

router.use(require('./check'));
// 2FA 管理路由挂载在前，避免被更宽松的中间件顺序影响；自身走 adminAuth + requireCsrf
router.use('/2fa', require('./twoFactor'));
router.use(require('./jobs'));
router.use(require('./prompts'));
router.use(require('./logs'));
router.use(require('./legal'));
router.use(require('./admins'));
router.use(require('./audit'));

module.exports = router;