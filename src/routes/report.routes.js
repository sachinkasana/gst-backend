const express = require('express');
const router = express.Router();
const {
  getSalesRegister,
  getGSTR1Report,
  getTaxSummary
} = require('../controllers/reportController');
const { protect } = require('../middleware/auth.middleware');

router.use(protect); // All routes are protected

router.get('/sales-register', getSalesRegister);
router.get('/gstr1', getGSTR1Report);
router.get('/tax-summary', getTaxSummary);

module.exports = router;
