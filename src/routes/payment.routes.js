const express = require('express');
const router = express.Router();
const {
  recordPayment,
  getInvoicePayments,
  getPayments
} = require('../controllers/paymentController');
const { protect } = require('../middleware/auth.middleware');

router.use(protect); // All routes are protected

router.post('/', recordPayment);
router.get('/', getPayments);
router.get('/invoice/:invoiceId', getInvoicePayments);

module.exports = router;
