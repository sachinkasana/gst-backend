const Invoice = require('../models/Invoice');
const Business = require('../models/Business');
const Customer = require('../models/Customer');
const Product = require('../models/Product');
const { calculateGST, determineInvoiceType } = require('../utils/gstCalculator');
const { generateInvoiceNumber } = require('../utils/invoiceNumberGenerator');

// @desc    Create new invoice
// @route   POST /api/invoices
// @access  Private
exports.createInvoice = async (req, res) => {
  try {
    const {
      customerId,
      customerDetails,
      items,
      dueDate,
      notes,
      isDraft
    } = req.body;

    // Get business details
    const business = await Business.findById(req.user.businessId);
    
    // Generate invoice number
    const invoiceNumber = await generateInvoiceNumber(business);

    // Calculate totals and GST
    let subtotal = 0;
    let totalCGST = 0;
    let totalSGST = 0;
    let totalIGST = 0;
    let totalDiscount = 0;

    const processedItems = items.map(item => {
      const itemSubtotal = item.quantity * item.rate;
      const itemDiscount = item.discount || 0;
      const taxableAmount = itemSubtotal - itemDiscount;

      // Calculate GST based on states
      const gstAmount = calculateGST(
        taxableAmount,
        item.gstRate,
        business.state,
        customerDetails.state
      );

      subtotal += itemSubtotal;
      totalDiscount += itemDiscount;
      totalCGST += gstAmount.cgst;
      totalSGST += gstAmount.sgst;
      totalIGST += gstAmount.igst;

      return {
        productName: item.productName,
        hsnCode: item.hsnCode,
        description: item.description || '',
        quantity: item.quantity,
        unit: item.unit,
        rate: item.rate,
        gstRate: item.gstRate,
        discount: itemDiscount,
        taxableAmount,
        cgst: gstAmount.cgst,
        sgst: gstAmount.sgst,
        igst: gstAmount.igst,
        totalAmount: taxableAmount + gstAmount.cgst + gstAmount.sgst + gstAmount.igst
      };
    });

    const grandTotal = subtotal - totalDiscount + totalCGST + totalSGST + totalIGST;

    // Determine invoice type
    const invoiceType = determineInvoiceType(
      customerDetails.gstin,
      business.state,
      customerDetails.state,
      grandTotal
    );

    // Create invoice
    const invoice = await Invoice.create({
      businessId: req.user.businessId,
      invoiceNumber,
      invoiceDate: new Date(),
      dueDate: dueDate || null,
      customerId: customerId || null,
      customerDetails,
      items: processedItems,
      subtotal,
      totalDiscount,
      totalCGST,
      totalSGST,
      totalIGST,
      grandTotal,
      invoiceType,
      notes: notes || '',
      termsConditions: business.termsConditions,
      isDraft: isDraft || false
    });

    // Auto-create products if they don't exist
    for (let item of items) {
      const existingProduct = await Product.findOne({
        businessId: req.user.businessId,
        name: { $regex: `^${item.productName}$`, $options: 'i' }
      });

      if (!existingProduct) {
        await Product.create({
          businessId: req.user.businessId,
          name: item.productName,
          hsnCode: item.hsnCode,
          usageCount: 1
        });
      } else {
        // Increment usage count
        existingProduct.usageCount += 1;
        await existingProduct.save();
      }
    }

    // Populate customer details for response
    const populatedInvoice = await Invoice.findById(invoice._id)
      .populate('customerId', 'name phone gstin');

    res.status(201).json({
      success: true,
      message: 'Invoice created successfully',
      data: populatedInvoice
    });
  } catch (error) {
    console.error('Create Invoice Error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error',
      error: error.message
    });
  }
};

// @desc    Get all invoices
// @route   GET /api/invoices
// @access  Private
exports.getInvoices = async (req, res) => {
  try {
    const {
      search,
      customerId,
      paymentStatus,
      startDate,
      endDate,
      invoiceType,
      page = 1,
      limit = 20
    } = req.query;

    const query = { 
      businessId: req.user.businessId,
      isDraft: false
    };

    // Search by invoice number or customer name
    if (search) {
      query.$or = [
        { invoiceNumber: { $regex: search, $options: 'i' } },
        { 'customerDetails.name': { $regex: search, $options: 'i' } }
      ];
    }

    // Filter by customer
    if (customerId) {
      query.customerId = customerId;
    }

    // Filter by payment status
    if (paymentStatus) {
      query.paymentStatus = paymentStatus;
    }

    // Filter by invoice type
    if (invoiceType) {
      query.invoiceType = invoiceType;
    }

    // Filter by date range
    if (startDate || endDate) {
      query.invoiceDate = {};
      if (startDate) query.invoiceDate.$gte = new Date(startDate);
      if (endDate) query.invoiceDate.$lte = new Date(endDate);
    }

    const invoices = await Invoice.find(query)
      .populate('customerId', 'name phone gstin')
      .sort({ invoiceDate: -1 })
      .limit(limit * 1)
      .skip((page - 1) * limit);

    const count = await Invoice.countDocuments(query);

    res.status(200).json({
      success: true,
      data: invoices,
      pagination: {
        total: count,
        page: Number(page),
        pages: Math.ceil(count / limit)
      }
    });
  } catch (error) {
    console.error('Get Invoices Error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error',
      error: error.message
    });
  }
};

// @desc    Get single invoice
// @route   GET /api/invoices/:id
// @access  Private
exports.getInvoice = async (req, res) => {
  try {
    const invoice = await Invoice.findOne({
      _id: req.params.id,
      businessId: req.user.businessId
    }).populate('customerId', 'name phone gstin email address');

    if (!invoice) {
      return res.status(404).json({
        success: false,
        message: 'Invoice not found'
      });
    }

    res.status(200).json({
      success: true,
      data: invoice
    });
  } catch (error) {
    console.error('Get Invoice Error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error',
      error: error.message
    });
  }
};

// @desc    Update invoice
// @route   PUT /api/invoices/:id
// @access  Private
exports.updateInvoice = async (req, res) => {
  try {
    const invoice = await Invoice.findOne({
      _id: req.params.id,
      businessId: req.user.businessId
    });

    if (!invoice) {
      return res.status(404).json({
        success: false,
        message: 'Invoice not found'
      });
    }

    // Don't allow editing paid invoices
    if (invoice.paymentStatus === 'paid') {
      return res.status(400).json({
        success: false,
        message: 'Cannot edit paid invoice'
      });
    }

    // Similar logic to create invoice
    // For brevity, allowing only specific fields to update
    const { notes, dueDate } = req.body;

    if (notes !== undefined) invoice.notes = notes;
    if (dueDate) invoice.dueDate = dueDate;

    await invoice.save();

    res.status(200).json({
      success: true,
      message: 'Invoice updated successfully',
      data: invoice
    });
  } catch (error) {
    console.error('Update Invoice Error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error',
      error: error.message
    });
  }
};

// @desc    Delete invoice
// @route   DELETE /api/invoices/:id
// @access  Private
exports.deleteInvoice = async (req, res) => {
  try {
    const invoice = await Invoice.findOne({
      _id: req.params.id,
      businessId: req.user.businessId
    });

    if (!invoice) {
      return res.status(404).json({
        success: false,
        message: 'Invoice not found'
      });
    }

    // Don't allow deleting paid invoices
    if (invoice.paymentStatus === 'paid') {
      return res.status(400).json({
        success: false,
        message: 'Cannot delete paid invoice'
      });
    }

    await invoice.deleteOne();

    res.status(200).json({
      success: true,
      message: 'Invoice deleted successfully'
    });
  } catch (error) {
    console.error('Delete Invoice Error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error',
      error: error.message
    });
  }
};

// @desc    Get dashboard stats
// @route   GET /api/invoices/stats/dashboard
// @access  Private
exports.getDashboardStats = async (req, res) => {
  try {
    const businessId = req.user.businessId;
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const startOfMonth = new Date(today.getFullYear(), today.getMonth(), 1);

    // Today's sales
    const todaySales = await Invoice.aggregate([
      {
        $match: {
          businessId: businessId,
          isDraft: false,
          invoiceDate: { $gte: today }
        }
      },
      {
        $group: {
          _id: null,
          total: { $sum: '$grandTotal' },
          count: { $sum: 1 }
        }
      }
    ]);

    // This month's sales
    const monthSales = await Invoice.aggregate([
      {
        $match: {
          businessId: businessId,
          isDraft: false,
          invoiceDate: { $gte: startOfMonth }
        }
      },
      {
        $group: {
          _id: null,
          total: { $sum: '$grandTotal' },
          paid: {
            $sum: {
              $cond: [{ $eq: ['$paymentStatus', 'paid'] }, '$grandTotal', 0]
            }
          },
          unpaid: {
            $sum: {
              $cond: [{ $eq: ['$paymentStatus', 'unpaid'] }, '$grandTotal', 0]
            }
          },
          count: { $sum: 1 }
        }
      }
    ]);

    // Outstanding amount
    const outstanding = await Invoice.aggregate([
      {
        $match: {
          businessId: businessId,
          isDraft: false,
          paymentStatus: { $in: ['unpaid', 'partial'] }
        }
      },
      {
        $group: {
          _id: null,
          total: { $sum: '$amountDue' }
        }
      }
    ]);

    // Recent invoices
    const recentInvoices = await Invoice.find({
      businessId: businessId,
      isDraft: false
    })
    .sort({ invoiceDate: -1 })
    .limit(10)
    .select('invoiceNumber customerDetails.name grandTotal paymentStatus invoiceDate');

    res.status(200).json({
      success: true,
      data: {
        today: {
          sales: todaySales[0]?.total || 0,
          count: todaySales[0]?.count || 0
        },
        month: {
          sales: monthSales[0]?.total || 0,
          paid: monthSales[0]?.paid || 0,
          unpaid: monthSales[0]?.unpaid || 0,
          count: monthSales[0]?.count || 0
        },
        outstanding: outstanding[0]?.total || 0,
        recentInvoices
      }
    });
  } catch (error) {
    console.error('Get Dashboard Stats Error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error',
      error: error.message
    });
  }
};
