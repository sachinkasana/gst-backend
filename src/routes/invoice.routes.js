const express = require('express');
const router = express.Router();
const {
  createInvoice,
  getInvoices,
  getInvoice,
  updateInvoice,
  deleteInvoice,
  getDashboardStats
} = require('../controllers/invoiceController');
const { protect } = require('../middleware/auth.middleware');

router.use(protect); // All routes are protected

router.get('/stats/dashboard', getDashboardStats);

router.route('/')
  .get(getInvoices)
  .post(createInvoice);

router.route('/:id')
  .get(getInvoice)
  .put(updateInvoice)
  .delete(deleteInvoice);

module.exports = router;
