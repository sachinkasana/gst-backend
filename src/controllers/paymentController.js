const Payment = require('../models/Payment');
const Invoice = require('../models/Invoice');

// @desc    Record payment
// @route   POST /api/payments
// @access  Private
exports.recordPayment = async (req, res) => {
  try {
    const {
      invoiceId,
      amount,
      paymentMode,
      paymentDate,
      referenceNumber,
      notes
    } = req.body;

    // Get invoice
    const invoice = await Invoice.findOne({
      _id: invoiceId,
      businessId: req.user.businessId
    });

    if (!invoice) {
      return res.status(404).json({
        success: false,
        message: 'Invoice not found'
      });
    }

    // Validate payment amount
    if (amount > invoice.amountDue) {
      return res.status(400).json({
        success: false,
        message: `Payment amount cannot exceed due amount of ₹${invoice.amountDue}`
      });
    }

    // Create payment record
    const payment = await Payment.create({
      businessId: req.user.businessId,
      invoiceId,
      amount,
      paymentMode,
      paymentDate: paymentDate || new Date(),
      referenceNumber: referenceNumber || '',
      notes: notes || ''
    });

    // Update invoice
    invoice.amountPaid += amount;
    await invoice.save();

    res.status(201).json({
      success: true,
      message: 'Payment recorded successfully',
      data: {
        payment,
        invoice: {
          id: invoice._id,
          amountPaid: invoice.amountPaid,
          amountDue: invoice.amountDue,
          paymentStatus: invoice.paymentStatus
        }
      }
    });
  } catch (error) {
    console.error('Record Payment Error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error',
      error: error.message
    });
  }
};

// @desc    Get payments for an invoice
// @route   GET /api/payments/invoice/:invoiceId
// @access  Private
exports.getInvoicePayments = async (req, res) => {
  try {
    const payments = await Payment.find({
      invoiceId: req.params.invoiceId,
      businessId: req.user.businessId
    }).sort({ paymentDate: -1 });

    res.status(200).json({
      success: true,
      data: payments
    });
  } catch (error) {
    console.error('Get Invoice Payments Error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error',
      error: error.message
    });
  }
};

// @desc    Get all payments
// @route   GET /api/payments
// @access  Private
exports.getPayments = async (req, res) => {
  try {
    const { startDate, endDate, paymentMode, page = 1, limit = 50 } = req.query;

    const query = { businessId: req.user.businessId };

    if (paymentMode) {
      query.paymentMode = paymentMode;
    }

    if (startDate || endDate) {
      query.paymentDate = {};
      if (startDate) query.paymentDate.$gte = new Date(startDate);
      if (endDate) query.paymentDate.$lte = new Date(endDate);
    }

    const payments = await Payment.find(query)
      .populate('invoiceId', 'invoiceNumber customerDetails.name grandTotal')
      .sort({ paymentDate: -1 })
      .limit(limit * 1)
      .skip((page - 1) * limit);

    const count = await Payment.countDocuments(query);

    res.status(200).json({
      success: true,
      data: payments,
      pagination: {
        total: count,
        page: Number(page),
        pages: Math.ceil(count / limit)
      }
    });
  } catch (error) {
    console.error('Get Payments Error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error',
      error: error.message
    });
  }
};
