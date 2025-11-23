const mongoose = require('mongoose');

const productSchema = new mongoose.Schema({
  businessId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Business',
    required: true
  },
  name: {
    type: String,
    required: [true, 'Product name is required'],
    trim: true
  },
  hsnCode: {
    type: String,
    required: [true, 'HSN/SAC code is required'],
    trim: true
  },
  description: {
    type: String,
    trim: true
  },
  usageCount: {
    type: Number,
    default: 0
  },
  isActive: {
    type: Boolean,
    default: true
  }
}, {
  timestamps: true
});

// Index for autocomplete search
productSchema.index({ businessId: 1, name: 'text' });
productSchema.index({ businessId: 1, usageCount: -1 });

module.exports = mongoose.model('Product', productSchema);
