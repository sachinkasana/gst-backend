const mongoose = require('mongoose');

const businessSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  name: {
    type: String,
    required: [true, 'Business name is required'],
    trim: true
  },
  gstin: {
    type: String,
    trim: true,
    uppercase: true,
    match: [/^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[1-9A-Z]{1}Z[0-9A-Z]{1}$/, 'Invalid GSTIN format']
  },
  address: {
    type: String,
    trim: true
  },
  city: {
    type: String,
    trim: true
  },
  state: {
    type: String,
    required: [true, 'State is required']
  },
  pincode: {
    type: String,
    trim: true
  },
  phone: {
    type: String,
    trim: true
  },
  email: {
    type: String,
    trim: true,
    lowercase: true
  },
  logo: {
    type: String // URL or file path
  },
  invoicePrefix: {
    type: String,
    default: 'INV',
    trim: true
  },
  invoiceCounter: {
    type: Number,
    default: 0
  },
  bankDetails: {
    accountName: String,
    accountNumber: String,
    bankName: String,
    ifscCode: String,
    branch: String
  },
  termsConditions: {
    type: String,
    default: 'Payment is due within 7 days from the date of invoice.'
  },
  defaultInvoiceTemplate: {
    type: String,
    enum: ['gst'],
    default: 'gst'
  },
  signature: {
    type: String // URL or file path
  }
}, {
  timestamps: true
});

module.exports = mongoose.model('Business', businessSchema);
