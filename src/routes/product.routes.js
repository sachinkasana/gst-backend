const express = require('express');
const router = express.Router();
const {
  searchProducts,
  getProducts,
  createProduct,
  updateProduct,
  deleteProduct
} = require('../controllers/productController');
const { protect } = require('../middleware/auth.middleware');

router.use(protect); // All routes are protected

router.get('/search', searchProducts);

router.route('/')
  .get(getProducts)
  .post(createProduct);

router.route('/:id')
  .put(updateProduct)
  .delete(deleteProduct);

module.exports = router;
