const mongoose = require('mongoose');

const invoiceItemSchema = new mongoose.Schema({
  productName: {
    type: String,
    required: true,
    trim: true
  },
  hsnCode: {
    type: String,
    required: true,
    trim: true
  },
  description: {
    type: String,
    trim: true
  },
  quantity: {
    type: Number,
    required: true,
    min: 0
  },
  unit: {
    type: String,
    required: true,
    trim: true
  },
  rate: {
    type: Number,
    required: true,
    min: 0
  },
  gstRate: {
    type: Number,
    required: true,
    enum: [0, 5, 12, 18, 28]
  },
  discount: {
    type: Number,
    default: 0,
    min: 0
  },
  taxableAmount: {
    type: Number,
    required: true
  },
  cgst: {
    type: Number,
    default: 0
  },
  sgst: {
    type: Number,
    default: 0
  },
  igst: {
    type: Number,
    default: 0
  },
  totalAmount: {
    type: Number,
    required: true
  }
}, { _id: false });

const invoiceSchema = new mongoose.Schema({
  businessId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Business',
    required: true
  },
  invoiceNumber: {
    type: String,
    required: true,
    unique: true
  },
  invoiceDate: {
    type: Date,
    required: true,
    default: Date.now
  },
  dueDate: {
    type: Date
  },
  customerId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Customer',
    sparse: true // Allow null for B2C
  },
  customerDetails: {
    name: {
      type: String,
      required: true
    },
    phone: String,
    email: String,
    gstin: {
      type: String,
      sparse: true
    },
    address: String,
    city: String,
    state: {
      type: String,
      required: false // Make optional - will be required only for B2B
    },
    pincode: String
  },
  items: [invoiceItemSchema],
  subtotal: {
    type: Number,
    required: true
  },
  totalDiscount: {
    type: Number,
    default: 0
  },
  totalCGST: {
    type: Number,
    default: 0
  },
  totalSGST: {
    type: Number,
    default: 0
  },
  totalIGST: {
    type: Number,
    default: 0
  },
  grandTotal: {
    type: Number,
    required: true
  },
  roundOff: {
    type: Number,
    default: 0
  },
  paymentStatus: {
    type: String,
    enum: ['unpaid', 'partial', 'paid'],
    default: 'unpaid'
  },
  amountPaid: {
    type: Number,
    default: 0
  },
  amountDue: {
    type: Number
  },
  notes: {
    type: String,
    trim: true
  },
  termsConditions: {
    type: String,
    trim: true
  },
  invoiceType: {
    type: String,
    enum: ['B2B', 'B2CS', 'B2CL'],
    required: true
  },
  isDraft: {
    type: Boolean,
    default: false
  },
  pdfUrl: {
    type: String
  }
}, {
  timestamps: true
});

// Index for faster queries
invoiceSchema.index({ businessId: 1, invoiceNumber: 1 });
invoiceSchema.index({ businessId: 1, invoiceDate: -1 });
invoiceSchema.index({ businessId: 1, customerId: 1 });
invoiceSchema.index({ businessId: 1, paymentStatus: 1 });

// Calculate amount due before saving
invoiceSchema.pre('save', function(next) {
  this.amountDue = this.grandTotal - this.amountPaid;
  
  // Update payment status based on amount paid
  if (this.amountPaid === 0) {
    this.paymentStatus = 'unpaid';
  } else if (this.amountPaid >= this.grandTotal) {
    this.paymentStatus = 'paid';
  } else {
    this.paymentStatus = 'partial';
  }
  
  next();
});

module.exports = mongoose.model('Invoice', invoiceSchema);
