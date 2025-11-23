const express = require('express');
const router = express.Router();
const { getBusiness, updateBusiness, getInvoiceSettings } = require('../controllers/businessController');
const { protect } = require('../middleware/auth.middleware');

router.use(protect); // All routes are protected

router.get('/', getBusiness);
router.put('/', updateBusiness);
router.get('/invoice-settings', getInvoiceSettings);

module.exports = router;
