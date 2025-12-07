const PDFDocument = require('pdfkit');
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
    
    // Validate required fields
    if (!customerDetails || !customerDetails.name) {
      return res.status(400).json({
        success: false,
        message: 'Customer name is required'
      });
    }

    if (!items || items.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'At least one item is required'
      });
    }

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

      // For B2C without state, use business state as default
      const customerState = customerDetails.state || business.state;

      // Calculate GST based on states
      const gstAmount = calculateGST(
        taxableAmount,
        item.gstRate,
        business.state,
        customerState
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
    // If B2C (no GSTIN), check amount for B2CS vs B2CL
    let invoiceType = 'B2B';
    if (!customerDetails.gstin) {
      invoiceType = determineInvoiceType(
        null, // no GSTIN for B2C
        business.state,
        customerDetails.state || business.state,
        grandTotal
      );
    }

    // Create invoice
    const invoice = await Invoice.create({
      businessId: req.user.businessId,
      invoiceNumber,
      invoiceDate: new Date(),
      dueDate: dueDate || null,
      customerId: customerId || null,
      customerDetails: {
        name: customerDetails.name,
        phone: customerDetails.phone || '',
        gstin: customerDetails.gstin || '',
        address: customerDetails.address || '',
        city: customerDetails.city || '',
        state: customerDetails.state || business.state, // Use business state as fallback
        pincode: customerDetails.pincode || ''
      },
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

    // Save customer only if B2B (has GSTIN and customerId)
    if (customerId && customerDetails.gstin) {
      // Customer already saved, just update if needed
      const existingCustomer = await Customer.findById(customerId);
      if (existingCustomer) {
        existingCustomer.usageCount = (existingCustomer.usageCount || 0) + 1;
        await existingCustomer.save();
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

// Keep other exports as they are...
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

// @desc    Download invoice PDF
// @route   GET /api/invoices/:id/pdf
// @access  Private
exports.downloadInvoicePdf = async (req, res) => {
  try {
    const invoice = await Invoice.findOne({
      _id: req.params.id,
      businessId: req.user.businessId
    }).populate('customerId', 'name phone gstin email');

    if (!invoice) {
      return res.status(404).json({
        success: false,
        message: 'Invoice not found'
      });
    }

    const business = await Business.findById(req.user.businessId);
    if (!business) {
      return res.status(404).json({
        success: false,
        message: 'Business not found'
      });
    }

    const doc = new PDFDocument({ size: 'A4', margin: 40 });
    const formatCurrency = (value) => `₹${Number(value || 0).toFixed(2)}`;

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename=${invoice.invoiceNumber || 'invoice'}.pdf`);

    doc.on('error', (err) => {
      console.error('PDF generation error:', err);
      if (!res.headersSent) {
        res.status(500).end();
      }
    });

    doc.pipe(res);

    // Header
    doc.fontSize(20).text(business.name || 'Invoice', { align: 'left' });
    doc.moveDown(0.5);
    if (business.address) doc.fontSize(10).text(business.address);
    if (business.city || business.state) {
      doc.text([business.city, business.state].filter(Boolean).join(', '));
    }
    if (business.pincode) doc.text(`PIN: ${business.pincode}`);
    if (business.phone) doc.text(`Phone: ${business.phone}`);
    if (business.email) doc.text(`Email: ${business.email}`);
    if (business.gstin) doc.text(`GSTIN: ${business.gstin}`);

    doc.moveDown();
    doc.fontSize(16).text(`Invoice ${invoice.invoiceNumber}`, { align: 'right' });
    doc.fontSize(10).text(`Invoice Date: ${new Date(invoice.invoiceDate).toLocaleDateString()}`, { align: 'right' });
    doc.text(`Due Date: ${invoice.dueDate ? new Date(invoice.dueDate).toLocaleDateString() : 'N/A'}`, { align: 'right' });
    doc.text(`Type: ${invoice.invoiceType}`, { align: 'right' });

    doc.moveDown();

    // Customer details
    doc.fontSize(12).text('Bill To:', { underline: true });
    doc.fontSize(10);
    doc.text(invoice.customerDetails.name);
    if (invoice.customerDetails.address) doc.text(invoice.customerDetails.address);
    const cityState = [invoice.customerDetails.city, invoice.customerDetails.state].filter(Boolean).join(', ');
    if (cityState) doc.text(cityState);
    if (invoice.customerDetails.pincode) doc.text(`PIN: ${invoice.customerDetails.pincode}`);
    if (invoice.customerDetails.phone) doc.text(`Phone: ${invoice.customerDetails.phone}`);
    if (invoice.customerDetails.gstin) doc.text(`GSTIN: ${invoice.customerDetails.gstin}`);

    doc.moveDown();

    // Items table header
    const tableTop = doc.y;
    doc.font('Helvetica-Bold');
    doc.text('Item', 40, tableTop);
    doc.text('Qty', 250, tableTop);
    doc.text('Rate', 300, tableTop);
    doc.text('GST', 360, tableTop);
    doc.text('Amount', 430, tableTop);
    doc.moveDown();

    // Items rows
    doc.font('Helvetica');
    invoice.items.forEach((item, index) => {
      const y = tableTop + 20 + (index * 18);
      doc.text(item.productName, 40, y, { width: 180 });
      doc.text(item.quantity, 250, y);
      doc.text(formatCurrency(item.rate), 300, y);
      doc.text(`${item.gstRate}%`, 360, y);
      doc.text(formatCurrency(item.totalAmount), 430, y);
    });

    doc.moveDown(2);

    // Totals
    const summaryX = 360;
    doc.font('Helvetica-Bold');
    const addSummaryLine = (label, value) => {
      const y = doc.y;
      doc.text(label, summaryX, y);
      doc.text(value, summaryX + 80, y);
      doc.moveDown(0.5);
    };

    addSummaryLine('Subtotal:', formatCurrency(invoice.subtotal));
    addSummaryLine('Discount:', formatCurrency(invoice.totalDiscount));
    addSummaryLine('CGST:', formatCurrency(invoice.totalCGST));
    addSummaryLine('SGST:', formatCurrency(invoice.totalSGST));
    addSummaryLine('IGST:', formatCurrency(invoice.totalIGST));
    addSummaryLine('Grand Total:', formatCurrency(invoice.grandTotal));

    doc.moveDown();
    doc.font('Helvetica');
    doc.text(`Payment Status: ${invoice.paymentStatus}`);
    doc.text(`Amount Paid: ${formatCurrency(invoice.amountPaid || 0)}`);
    doc.text(`Amount Due: ${formatCurrency(invoice.amountDue || 0)}`);

    if (invoice.notes) {
      doc.moveDown();
      doc.font('Helvetica-Bold').text('Notes:');
      doc.font('Helvetica').text(invoice.notes);
    }

    if (business.termsConditions) {
      doc.moveDown();
      doc.font('Helvetica-Bold').text('Terms & Conditions:');
      doc.font('Helvetica').text(business.termsConditions);
    }

    doc.end();
  } catch (error) {
    console.error('Download Invoice PDF Error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error',
      error: error.message
    });
  }
};
