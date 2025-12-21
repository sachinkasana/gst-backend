const PDFDocument = require('pdfkit');
const Invoice = require('../models/Invoice');
const Business = require('../models/Business');
const Customer = require('../models/Customer');
const Product = require('../models/Product');
const { calculateGST, determineInvoiceType } = require('../utils/gstCalculator');
const { generateInvoiceNumber } = require('../utils/invoiceNumberGenerator');

const INVOICE_TEMPLATES = [
  { id: 'gst', name: 'GST Standard' }
];

const resolveInvoiceTemplate = (template, fallback = 'gst') => {
  const ids = INVOICE_TEMPLATES.map((t) => t.id);
  if (ids.includes(template)) return template;
  if (ids.includes(fallback)) return fallback;
  return 'gst';
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
      invoiceDate,
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
      invoiceDate: invoiceDate ? new Date(invoiceDate) : new Date(),
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

const numberToWords = (amount = 0) => {
  const rounded = Math.round(Number(amount || 0) * 100);
  const rupees = Math.floor(rounded / 100);
  const paise = rounded % 100;

  const belowTwenty = [
    'Zero', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine',
    'Ten', 'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen'
  ];
  const tens = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];

  const twoDigitWords = (num) => {
    if (num < 20) return belowTwenty[num];
    const tenPart = tens[Math.floor(num / 10)];
    const unitPart = num % 10 ? ` ${belowTwenty[num % 10]}` : '';
    return `${tenPart}${unitPart}`;
  };

  const segmentToWords = (num) => {
    if (num === 0) return '';
    if (num < 100) return twoDigitWords(num);
    const hundred = Math.floor(num / 100);
    const remainder = num % 100;
    const hundredText = `${belowTwenty[hundred]} Hundred`;
    if (remainder === 0) return hundredText;
    return `${hundredText} ${twoDigitWords(remainder)}`;
  };

  if (rupees === 0) return 'Zero Rupees Only';

  const crore = Math.floor(rupees / 10000000);
  const lakh = Math.floor((rupees % 10000000) / 100000);
  const thousand = Math.floor((rupees % 100000) / 1000);
  const hundred = rupees % 1000;

  const words = [];
  if (crore) words.push(`${twoDigitWords(crore)} Crore`);
  if (lakh) words.push(`${twoDigitWords(lakh)} Lakh`);
  if (thousand) words.push(`${twoDigitWords(thousand)} Thousand`);
  if (hundred) words.push(segmentToWords(hundred));

  const rupeeText = `${words.join(' ').trim()} Rupees`;
  const paiseText = paise ? ` and ${twoDigitWords(paise)} Paise` : '';

  return `${rupeeText}${paiseText} Only`;
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

function renderGstInvoiceTemplate(doc, invoice, business, formatCurrency, formatDate) {
  const startX = doc.page.margins.left;
  const pageWidth = doc.page.width - doc.page.margins.left - doc.page.margins.right;
  const muted = '#111827';
  const border = '#d1d5db';
  const lightFill = '#f8fafc';

  const safeText = (value, fallback = '-') => (value && value.toString().trim()) || fallback;
  const joinWithComma = (parts) => parts.filter(Boolean).join(', ');

  // Header
  const addressLine = joinWithComma([business.address, business.city, business.state, business.pincode]);
  const contactLine = [
    business.phone && `Phone: ${business.phone}`,
    business.email && `Email: ${business.email}`,
    business.gstin && `GSTIN: ${business.gstin}`
  ].filter(Boolean).join('  |  ');

  doc.font('Helvetica-Bold').fontSize(16).fillColor(muted)
    .text(safeText(business.name, 'Tax Invoice'), startX, doc.y, { width: pageWidth, align: 'center' });
  doc.font('Helvetica').fontSize(9).fillColor(muted);
  if (addressLine) {
    doc.text(addressLine, startX, doc.y, { width: pageWidth, align: 'center' });
  }
  if (contactLine) {
    doc.text(contactLine, startX, doc.y, { width: pageWidth, align: 'center' });
  }
  doc.moveDown(0.5);
  doc.font('Helvetica-Bold').fontSize(12).text('TAX INVOICE', startX, doc.y, { width: pageWidth, align: 'center' });
  doc.moveDown(0.5);

  // Invoice meta grid
  const metaTop = doc.y;
  const metaRows = [
    [
      { label: 'Reverse Charge', value: 'No' },
      { label: 'Invoice No', value: safeText(invoice.invoiceNumber, '-') },
      { label: 'Invoice Date', value: formatDate(invoice.invoiceDate) }
    ],
    [
      { label: 'Due Date', value: formatDate(invoice.dueDate) },
      { label: 'Place of Supply', value: safeText(invoice.customerDetails.state || business.state, '-') },
      { label: 'State', value: safeText(business.state, '-') }
    ]
  ];
  const metaRowHeight = 26;
  const metaCellWidth = pageWidth / 3;

  metaRows.forEach((row, rowIndex) => {
    row.forEach((cell, cellIndex) => {
      const x = startX + cellIndex * metaCellWidth;
      const y = metaTop + rowIndex * metaRowHeight;
      doc.rect(x, y, metaCellWidth, metaRowHeight).strokeColor(border).stroke();
      doc.font('Helvetica-Bold').fontSize(9).fillColor(muted).text(cell.label, x + 6, y + 6);
      doc.font('Helvetica').fontSize(9).fillColor(muted).text(cell.value || '-', x + 6, y + 14, {
        width: metaCellWidth - 12
      });
    });
    doc.moveTo(startX, metaTop + (rowIndex + 1) * metaRowHeight)
      .lineTo(startX + pageWidth, metaTop + (rowIndex + 1) * metaRowHeight)
      .strokeColor(border)
      .stroke();
  });

  doc.y = metaTop + metaRows.length * metaRowHeight + 10;

  // Receiver / Consignee
  const detailsTop = doc.y;
  const boxHeight = 90;
  const halfWidth = pageWidth / 2;
  doc.rect(startX, detailsTop, pageWidth, boxHeight).strokeColor(muted).stroke();
  doc.rect(startX, detailsTop, halfWidth, boxHeight).strokeColor(muted).stroke();

  const receiverLines = [
    invoice.customerDetails.name,
    invoice.customerDetails.address,
    joinWithComma([invoice.customerDetails.city, invoice.customerDetails.state, invoice.customerDetails.pincode]),
    invoice.customerDetails.phone && `Mobile: ${invoice.customerDetails.phone}`,
    invoice.customerDetails.gstin && `GSTIN: ${invoice.customerDetails.gstin}`
  ].filter(Boolean);

  const consigneeLines = [
    invoice.customerDetails.name,
    invoice.customerDetails.address,
    joinWithComma([invoice.customerDetails.city, invoice.customerDetails.state, invoice.customerDetails.pincode]),
    invoice.customerDetails.phone && `Mobile: ${invoice.customerDetails.phone}`,
    invoice.customerDetails.gstin && `GSTIN: ${invoice.customerDetails.gstin}`
  ].filter(Boolean);

  doc.font('Helvetica-Bold').fontSize(10).fillColor(muted).text('Details of Receiver | Billed To:', startX + 6, detailsTop + 6);
  doc.font('Helvetica').fontSize(9);
  receiverLines.forEach((line, idx) => {
    doc.text(line, startX + 6, detailsTop + 22 + idx * 12, { width: halfWidth - 12 });
  });

  doc.font('Helvetica-Bold').fontSize(10).fillColor(muted).text('Details of Consignee | Shipped To:', startX + halfWidth + 6, detailsTop + 6);
  doc.font('Helvetica').fontSize(9);
  consigneeLines.forEach((line, idx) => {
    doc.text(line, startX + halfWidth + 6, detailsTop + 22 + idx * 12, { width: halfWidth - 12 });
  });

  doc.y = detailsTop + boxHeight + 12;

  // Items table
  const hasIGST = (invoice.totalIGST || 0) > 0;
  const columns = hasIGST
    ? [
        { key: 'index', label: 'S.No', width: 18, align: 'center' },
        { key: 'productName', label: 'Description of Goods/Services', width: 120 },
        { key: 'hsnCode', label: 'HSN/SAC', width: 45 },
        { key: 'quantity', label: 'Qty', width: 32, align: 'center' },
        { key: 'rate', label: 'Rate', width: 50, align: 'right', formatter: formatCurrency },
        { key: 'taxableAmount', label: 'Taxable Value', width: 60, align: 'right', formatter: formatCurrency },
        { key: 'igst', label: 'IGST', width: 65, align: 'center', formatter: (v, item) => `${(item.gstRate || 0).toFixed(2)}%\n${formatCurrency(item.igst || 0)}` },
        { key: 'totalAmount', label: 'Total', width: 60, align: 'right', formatter: formatCurrency }
      ]
    : [
        { key: 'index', label: 'S.No', width: 18, align: 'center' },
        { key: 'productName', label: 'Description of Goods/Services', width: 120 },
        { key: 'hsnCode', label: 'HSN/SAC', width: 45 },
        { key: 'quantity', label: 'Qty', width: 32, align: 'center' },
        { key: 'rate', label: 'Rate', width: 50, align: 'right', formatter: formatCurrency },
        { key: 'taxableAmount', label: 'Taxable Value', width: 60, align: 'right', formatter: formatCurrency },
        { key: 'cgst', label: 'CGST', width: 55, align: 'center', formatter: (v, item) => `${((item.gstRate || 0) / 2).toFixed(2)}%\n${formatCurrency(item.cgst || 0)}` },
        { key: 'sgst', label: 'SGST', width: 55, align: 'center', formatter: (v, item) => `${((item.gstRate || 0) / 2).toFixed(2)}%\n${formatCurrency(item.sgst || 0)}` },
        { key: 'totalAmount', label: 'Total', width: 60, align: 'right', formatter: formatCurrency }
      ];

  const tableWidth = columns.reduce((sum, col) => sum + col.width, 0);
  const tableTop = doc.y;
  const headerHeight = 22;

  doc.save();
  doc.rect(startX, tableTop, tableWidth, headerHeight).fillAndStroke('#eef2ff', border);
  doc.restore();

  doc.font('Helvetica-Bold').fontSize(9).fillColor(muted);
  let headerX = startX;
  columns.forEach((col) => {
    doc.text(col.label, headerX + 4, tableTop + 6, { width: col.width - 8, align: col.align || 'left' });
    headerX += col.width;
  });

  let rowY = tableTop + headerHeight;
  invoice.items.forEach((item, index) => {
    const cells = columns.map((col) => {
      if (col.key === 'index') return String(index + 1);
      if (col.key === 'quantity') {
        const qty = item.quantity || 0;
        return item.unit ? `${qty} ${item.unit}` : `${qty}`;
      }
      if (col.formatter) return col.formatter(item[col.key] || 0, item);
      return safeText(item[col.key], '-');
    });

    const heights = cells.map((text, idx) =>
      doc.heightOfString(text, { width: columns[idx].width - 8, align: columns[idx].align || 'left', lineGap: 1 })
    );
    const rowHeight = Math.max(18, Math.max(...heights) + 6);

    doc.save();
    if (index % 2 === 0) {
      doc.rect(startX, rowY, tableWidth, rowHeight).fill(lightFill);
    }
    doc.rect(startX, rowY, tableWidth, rowHeight).strokeColor(border).stroke();
    doc.restore();

    let cellX = startX;
    doc.font('Helvetica').fontSize(9).fillColor(muted);
    cells.forEach((text, idx) => {
      doc.text(text || '-', cellX + 4, rowY + 4, {
        width: columns[idx].width - 8,
        align: columns[idx].align || 'left',
        lineGap: 2
      });
      cellX += columns[idx].width;
    });
    rowY += rowHeight;
  });

  // Vertical boundaries
  let lineX = startX;
  columns.forEach((col) => {
    doc.moveTo(lineX, tableTop).lineTo(lineX, rowY).strokeColor(border).stroke();
    lineX += col.width;
  });
  doc.moveTo(startX + tableWidth, tableTop).lineTo(startX + tableWidth, rowY).strokeColor(border).stroke();

  doc.y = rowY + 10;

  const totalQuantity = invoice.items.reduce((sum, item) => sum + Number(item.quantity || 0), 0);
  const totalTaxable = invoice.items.reduce((sum, item) => sum + Number(item.taxableAmount || 0), 0);
  const totalTax = (invoice.totalCGST || 0) + (invoice.totalSGST || 0) + (invoice.totalIGST || 0);

  doc.font('Helvetica-Bold').fontSize(9).fillColor(muted)
    .text(`Total Quantity: ${totalQuantity}`, startX, doc.y, { width: pageWidth / 2 });
  doc.text(`Taxable Value: ${formatCurrency(totalTaxable)}`, startX + pageWidth / 2, doc.y, { width: pageWidth / 2, align: 'right' });
  doc.moveDown(0.3);
  doc.text(`Tax Amount (GST): ${formatCurrency(totalTax)}`, startX, doc.y, { width: pageWidth / 2 });
  doc.text(`Grand Total: ${formatCurrency(invoice.grandTotal)}`, startX + pageWidth / 2, doc.y, { width: pageWidth / 2, align: 'right' });
  doc.moveDown(0.8);

  doc.font('Helvetica-Bold').fontSize(10).fillColor(muted).text('Invoice Value (in words)', startX, doc.y);
  doc.font('Helvetica').fontSize(9).fillColor(muted)
    .text(numberToWords(invoice.grandTotal), startX, doc.y + 2, { width: pageWidth });
  doc.moveDown(1);

  const columnGap = 16;
  const leftWidth = (pageWidth - columnGap) * 0.55;
  const rightWidth = pageWidth - leftWidth - columnGap;
  const rightX = startX + leftWidth + columnGap;
  const sectionStartY = doc.y;

  // Left column: Bank + Terms
  doc.y = sectionStartY;
  doc.font('Helvetica-Bold').fontSize(10).fillColor(muted).text('Bank Details', startX, doc.y);
  const bank = business.bankDetails || {};
  const bankLines = [
    bank.accountName && `Account Holder: ${bank.accountName}`,
    bank.accountNumber && `Account Number: ${bank.accountNumber}`,
    bank.bankName && `Bank: ${bank.bankName}`,
    bank.ifscCode && `IFSC: ${bank.ifscCode}`,
    bank.branch && `Branch: ${bank.branch}`
  ].filter(Boolean);
  doc.font('Helvetica').fontSize(9).fillColor(muted);
  if (bankLines.length) {
    bankLines.forEach((line) => doc.text(line, startX, doc.y + 2, { width: leftWidth }));
  } else {
    doc.text('Bank details not provided', startX, doc.y + 2, { width: leftWidth });
  }
  doc.moveDown(0.6);
  doc.font('Helvetica-Bold').fontSize(10).fillColor(muted).text('Terms and Conditions', startX, doc.y);
  doc.font('Helvetica').fontSize(9).fillColor(muted)
    .text(safeText(business.termsConditions, 'Payment is due within 7 days.'), startX, doc.y + 2, { width: leftWidth });
  if (invoice.notes) {
    doc.moveDown(0.4);
    doc.font('Helvetica-Bold').fontSize(10).fillColor(muted).text('Notes', startX, doc.y);
    doc.font('Helvetica').fontSize(9).fillColor(muted)
      .text(invoice.notes, startX, doc.y + 2, { width: leftWidth });
  }
  const leftBottom = doc.y;

  // Right column: Tax summary + declaration
  doc.y = sectionStartY;
  doc.font('Helvetica-Bold').fontSize(10).fillColor(muted).text('Tax Summary', rightX, doc.y, { width: rightWidth });
  doc.font('Helvetica').fontSize(9).fillColor(muted);
  const summaryRows = [
    { label: 'Amount Before Tax', value: formatCurrency(totalTaxable) },
    { label: 'Add: CGST', value: formatCurrency(invoice.totalCGST || 0) },
    { label: 'Add: SGST', value: formatCurrency(invoice.totalSGST || 0) },
    { label: 'Add: IGST', value: formatCurrency(invoice.totalIGST || 0) },
    { label: 'Tax Amount (GST)', value: formatCurrency(totalTax) },
    { label: 'Amount With Tax', value: formatCurrency(invoice.grandTotal) }
  ];
  summaryRows.forEach((row) => {
    doc.text(row.label, rightX, doc.y + 4, { width: rightWidth - 120 });
    doc.text(row.value, rightX + rightWidth - 120, doc.y, { width: 120, align: 'right' });
    doc.moveDown(0.3);
  });

  doc.moveDown(0.8);
  doc.text('Certified that the particulars given above are true and correct.', rightX, doc.y, { width: rightWidth });
  doc.moveDown(1.2);
  doc.font('Helvetica-Bold').fontSize(9).text(`For, ${safeText(business.name, 'Authorized')}`, rightX, doc.y, { width: rightWidth, align: 'right' });
  doc.moveDown(1.2);
  doc.font('Helvetica').fontSize(9).text('Authorized Signatory', rightX, doc.y, { width: rightWidth, align: 'right' });
  const rightBottom = doc.y;

  doc.y = Math.max(leftBottom, rightBottom) + 12;
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
    const currencyFormatter = new Intl.NumberFormat('en-IN', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    });
    const formatCurrency = (value, prefix = 'Rs.') =>
      `${prefix} ${currencyFormatter.format(Number(value || 0))}`;
    const formatCurrencyINR = (value) => formatCurrency(value, 'INR');
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
    renderGstInvoiceTemplate(doc, invoice, business, formatCurrencyINR, formatDate);

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
