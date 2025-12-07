const PDFDocument = require('pdfkit');
const Invoice = require('../models/Invoice');
const Business = require('../models/Business');
const Customer = require('../models/Customer');
const Product = require('../models/Product');
const { calculateGST, determineInvoiceType } = require('../utils/gstCalculator');
const { generateInvoiceNumber } = require('../utils/invoiceNumberGenerator');

const INVOICE_TEMPLATES = [
  { id: 'classic', name: 'Classic' },
  { id: 'modern', name: 'Modern' }
];

const resolveInvoiceTemplate = (template, fallback = 'classic') => {
  const ids = INVOICE_TEMPLATES.map((t) => t.id);
  if (ids.includes(template)) return template;
  if (ids.includes(fallback)) return fallback;
  return 'classic';
};

const TEMPLATE_THEMES = {
  classic: {
    headerFill: '#f5f5f5',
    rowFill: '#fcfcfc',
    borderColor: '#e5e5e5',
    summaryFill: null,
    accent: '#000000',
    titleColor: '#000000'
  },
  modern: {
    headerFill: '#e8f0ff',
    rowFill: '#f6f8ff',
    borderColor: '#d7def5',
    summaryFill: '#eef2ff',
    accent: '#2563eb',
    titleColor: '#111827'
  }
};

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
      isDraft,
      invoiceTemplate
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
      invoiceTemplate: resolveInvoiceTemplate(invoiceTemplate, business.defaultInvoiceTemplate),
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

// @desc    List supported invoice PDF templates
// @route   GET /api/invoices/templates
// @access  Private
exports.getInvoiceTemplates = async (_req, res) => {
  res.status(200).json({
    success: true,
    data: INVOICE_TEMPLATES
  });
};

function renderInvoiceTemplate(doc, invoice, business, formatCurrency, formatDate, theme = {}) {
  const colors = {
    headerFill: theme.headerFill || '#f5f5f5',
    rowFill: theme.rowFill || '#fcfcfc',
    borderColor: theme.borderColor || '#e5e5e5',
    summaryFill: theme.summaryFill || null,
    accent: theme.accent || '#000000',
    titleColor: theme.titleColor || '#000000'
  };

  const addLabelValue = (label, value, x, y, options = {}) => {
    doc.font('Helvetica-Bold').fontSize(9).fillColor(colors.accent).text(label, x, y, options);
    doc.font('Helvetica').fontSize(10).fillColor('#000000').text(value, x + (options.labelWidth || 70), y, options);
  };

  // Header: business (left) + invoice meta (right)
  const headerTop = doc.y;
  const rightColumnX = 330;

  doc.font('Helvetica-Bold').fontSize(18).fillColor(colors.titleColor).text(business.name || 'Invoice', 40, headerTop);
  doc.font('Helvetica').fontSize(10).fillColor('#000000');
  const businessLines = [
    business.address,
    [business.city, business.state].filter(Boolean).join(', '),
    business.pincode ? `PIN: ${business.pincode}` : '',
    business.phone ? `Phone: ${business.phone}` : '',
    business.email ? `Email: ${business.email}` : '',
    business.gstin ? `GSTIN: ${business.gstin}` : ''
  ].filter(Boolean);
  businessLines.forEach((line) => doc.text(line, 40));

  doc.font('Helvetica-Bold').fontSize(12).fillColor(colors.accent).text('Invoice', rightColumnX, headerTop, { align: 'left' });
  doc.font('Helvetica').fontSize(10).fillColor('#000000');
  addLabelValue('Invoice No:', invoice.invoiceNumber || '-', rightColumnX, headerTop + 18, { labelWidth: 70 });
  addLabelValue('Date:', formatDate(invoice.invoiceDate), rightColumnX, headerTop + 32, { labelWidth: 70 });
  addLabelValue('Due Date:', formatDate(invoice.dueDate), rightColumnX, headerTop + 46, { labelWidth: 70 });
  addLabelValue('Type:', invoice.invoiceType || '-', rightColumnX, headerTop + 60, { labelWidth: 70 });
  addLabelValue('Place of Supply:', invoice.customerDetails.state || business.state || '-', rightColumnX, headerTop + 74, { labelWidth: 70 });

  doc.moveDown(2);
  doc.moveTo(40, doc.y).lineTo(doc.page.width - doc.page.margins.right, doc.y).strokeColor(colors.borderColor).stroke();
  doc.moveDown();

  // Customer block
  doc.font('Helvetica-Bold').fontSize(12).fillColor(colors.titleColor).text('Bill To');
  doc.font('Helvetica').fontSize(10).fillColor('#000000');
  const customerLines = [
    invoice.customerDetails.name,
    invoice.customerDetails.address,
    [invoice.customerDetails.city, invoice.customerDetails.state].filter(Boolean).join(', '),
    invoice.customerDetails.pincode ? `PIN: ${invoice.customerDetails.pincode}` : '',
    invoice.customerDetails.phone ? `Phone: ${invoice.customerDetails.phone}` : '',
    invoice.customerDetails.gstin ? `GSTIN: ${invoice.customerDetails.gstin}` : ''
  ].filter(Boolean);
  customerLines.forEach((line) => doc.text(line, 40));

  doc.moveDown(0.5);

  // Items table
  const tableTop = doc.y + 10;
  const tableWidth = doc.page.width - doc.page.margins.left - doc.page.margins.right;
  const columns = [
    { label: 'Item', property: 'productName', width: 150, align: 'left' },
    { label: 'HSN/SAC', property: 'hsnCode', width: 60, align: 'left' },
    { label: 'Qty', property: 'quantity', width: 40, align: 'right' },
    { label: 'Rate', property: 'rate', width: 70, align: 'right', formatter: formatCurrency },
    { label: 'GST', property: 'gstRate', width: 40, align: 'right', formatter: (v) => `${v}%` },
    { label: 'Taxable', property: 'taxableAmount', width: 70, align: 'right', formatter: formatCurrency },
    { label: 'Amount', property: 'totalAmount', width: 80, align: 'right', formatter: formatCurrency }
  ];

  doc.save();
  doc.rect(40, tableTop, tableWidth, 22).fill(colors.headerFill);
  doc.restore();

  doc.fillColor(colors.titleColor).font('Helvetica-Bold').fontSize(10);
  let currentX = 45;
  columns.forEach((col) => {
    doc.text(col.label, currentX, tableTop + 6, { width: col.width, align: col.align });
    currentX += col.width + 10;
  });

  doc.font('Helvetica').fontSize(10).fillColor('#000000');
  let rowY = tableTop + 26;
  invoice.items.forEach((item, index) => {
    currentX = 45;
    const rowHeight = 18;

    if (index % 2 === 0) {
      doc.save();
      doc.rect(40, rowY - 2, tableWidth, rowHeight).fill(colors.rowFill);
      doc.restore();
      doc.fillColor('#000000');
    }

    columns.forEach((col) => {
      const value = col.formatter ? col.formatter(item[col.property] || 0) : (item[col.property] || '');
      doc.text(value, currentX, rowY + 2, { width: col.width, align: col.align });
      currentX += col.width + 10;
    });
    rowY += rowHeight;
  });

  doc.moveTo(40, tableTop).lineTo(40, rowY - 2).strokeColor(colors.borderColor).stroke();
  doc.moveTo(doc.page.width - doc.page.margins.right, tableTop).lineTo(doc.page.width - doc.page.margins.right, rowY - 2).strokeColor(colors.borderColor).stroke();
  doc.moveDown(1);
  doc.y = rowY + 6;

  // Totals and payment summary block
  const summaryWidth = 220;
  const summaryX = doc.page.width - doc.page.margins.right - summaryWidth;
  const summaryTop = doc.y;

  const addSummaryLine = (label, value, bold = false) => {
    doc.font(bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(10).fillColor('#000000');
    doc.text(label, summaryX + 10, doc.y, { width: 110 });
    doc.text(value, summaryX + 120, doc.y, { width: 80, align: 'right' });
    doc.moveDown(0.4);
  };

  doc.save();
  if (colors.summaryFill) {
    doc.rect(summaryX, summaryTop - 6, summaryWidth, 140).fill(colors.summaryFill);
  }
  doc.rect(summaryX, summaryTop - 6, summaryWidth, 140).strokeColor(colors.borderColor).stroke();
  doc.restore();

  doc.y = summaryTop;
  addSummaryLine('Subtotal', formatCurrency(invoice.subtotal));
  addSummaryLine('Discount', formatCurrency(invoice.totalDiscount || 0));

  if ((invoice.totalCGST || 0) > 0 || (invoice.totalSGST || 0) > 0) {
    addSummaryLine('CGST', formatCurrency(invoice.totalCGST || 0));
    addSummaryLine('SGST', formatCurrency(invoice.totalSGST || 0));
  } else {
    addSummaryLine('IGST', formatCurrency(invoice.totalIGST || 0));
  }

  addSummaryLine('Grand Total', formatCurrency(invoice.grandTotal || 0), true);

  doc.moveDown();
  doc.font('Helvetica-Bold').fontSize(10).fillColor(colors.accent).text('Payment', summaryX + 10, doc.y);
  doc.moveDown(0.2);
  doc.font('Helvetica').fontSize(10).fillColor('#000000');
  addSummaryLine('Status', invoice.paymentStatus || '-', false);
  addSummaryLine('Paid', formatCurrency(invoice.amountPaid || 0), false);
  addSummaryLine('Due', formatCurrency(invoice.amountDue || 0), true);

  doc.moveDown(1);

  // Notes and terms
  if (invoice.notes) {
    doc.font('Helvetica-Bold').fontSize(11).fillColor(colors.titleColor).text('Notes');
    doc.font('Helvetica').fontSize(10).fillColor('#000000').text(invoice.notes);
    doc.moveDown(0.5);
  }

  if (business.termsConditions) {
    doc.font('Helvetica-Bold').fontSize(11).fillColor(colors.titleColor).text('Terms & Conditions');
    doc.font('Helvetica').fontSize(10).fillColor('#000000').text(business.termsConditions);
  }
}

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

    const { notes, dueDate, invoiceTemplate } = req.body;

    if (notes !== undefined) invoice.notes = notes;
    if (dueDate) invoice.dueDate = dueDate;
    if (invoiceTemplate) {
      invoice.invoiceTemplate = resolveInvoiceTemplate(invoiceTemplate, invoice.invoiceTemplate);
    }

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
    const formatCurrency = (value) =>
      new Intl.NumberFormat('en-IN', {
        style: 'currency',
        currency: 'INR',
        minimumFractionDigits: 2,
        maximumFractionDigits: 2
      }).format(Number(value || 0));
    const formatDate = (date) =>
      date ? new Date(date).toLocaleDateString('en-GB') : 'N/A';
    const selectedTemplate = resolveInvoiceTemplate(
      invoice.invoiceTemplate || business.defaultInvoiceTemplate
    );

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename=${invoice.invoiceNumber || 'invoice'}.pdf`);

    doc.on('error', (err) => {
      console.error('PDF generation error:', err);
      if (!res.headersSent) {
        res.status(500).end();
      }
    });

    doc.pipe(res);
    const theme = TEMPLATE_THEMES[selectedTemplate] || TEMPLATE_THEMES.classic;
    renderInvoiceTemplate(doc, invoice, business, formatCurrency, formatDate, theme);

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
