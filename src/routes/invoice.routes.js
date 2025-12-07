const express = require('express');
const router = express.Router();
const {
  createInvoice,
  getInvoices,
  getInvoice,
  updateInvoice,
  deleteInvoice,
  getDashboardStats,
  downloadInvoicePdf,
  getInvoiceTemplates
} = require('../controllers/invoiceController');
const { protect } = require('../middleware/auth.middleware');

router.use(protect); // All routes are protected

router.get('/stats/dashboard', getDashboardStats);
router.get('/templates', getInvoiceTemplates);

router.route('/')
  .get(getInvoices)
  .post(createInvoice);

router.get('/:id/pdf', downloadInvoicePdf);

router.route('/:id')
  .get(getInvoice)
  .put(updateInvoice)
  .delete(deleteInvoice);

module.exports = router;
