const ExcelJS = require('exceljs');

/**
 * Generate Sales Register Excel
 */
exports.generateSalesRegisterExcel = async (invoices, business, startDate, endDate) => {
  const workbook = new ExcelJS.Workbook();
  const worksheet = workbook.addWorksheet('Sales Register');

  // Add title
  worksheet.mergeCells('A1:K1');
  worksheet.getCell('A1').value = `Sales Register - ${business.name}`;
  worksheet.getCell('A1').font = { bold: true, size: 14 };
  worksheet.getCell('A1').alignment = { horizontal: 'center' };

  // Add date range
  worksheet.mergeCells('A2:K2');
  worksheet.getCell('A2').value = `Period: ${startDate} to ${endDate}`;
  worksheet.getCell('A2').alignment = { horizontal: 'center' };

  // Add headers
  worksheet.addRow([]);
  const headerRow = worksheet.addRow([
    'Invoice No.',
    'Date',
    'Customer Name',
    'GSTIN',
    'Place of Supply',
    'Invoice Type',
    'Taxable Amount',
    'CGST',
    'SGST',
    'IGST',
    'Total Amount'
  ]);

  headerRow.font = { bold: true };
  headerRow.fill = {
    type: 'pattern',
    pattern: 'solid',
    fgColor: { argb: 'FFD3D3D3' }
  };

  // Add data
  invoices.forEach(invoice => {
    worksheet.addRow([
      invoice.invoiceNumber,
      new Date(invoice.invoiceDate).toLocaleDateString('en-IN'),
      invoice.customerDetails.name,
      invoice.customerDetails.gstin || 'N/A',
      invoice.customerDetails.state,
      invoice.invoiceType,
      invoice.subtotal - invoice.totalDiscount,
      invoice.totalCGST,
      invoice.totalSGST,
      invoice.totalIGST,
      invoice.grandTotal
    ]);
  });

  // Add totals
  const totalRow = worksheet.addRow([
    '',
    '',
    '',
    '',
    '',
    'TOTAL',
    invoices.reduce((sum, inv) => sum + (inv.subtotal - inv.totalDiscount), 0),
    invoices.reduce((sum, inv) => sum + inv.totalCGST, 0),
    invoices.reduce((sum, inv) => sum + inv.totalSGST, 0),
    invoices.reduce((sum, inv) => sum + inv.totalIGST, 0),
    invoices.reduce((sum, inv) => sum + inv.grandTotal, 0)
  ]);

  totalRow.font = { bold: true };

  // Set column widths
  worksheet.columns = [
    { width: 15 }, { width: 12 }, { width: 25 }, { width: 18 },
    { width: 20 }, { width: 12 }, { width: 15 }, { width: 12 },
    { width: 12 }, { width: 12 }, { width: 15 }
  ];

  // Generate buffer
  const buffer = await workbook.xlsx.writeBuffer();
  return buffer;
};

/**
 * Generate GSTR-1 Excel
 */
exports.generateGSTR1Excel = async (data, business, startDate, endDate) => {
  const workbook = new ExcelJS.Workbook();

  // B2B Sheet
  const b2bSheet = workbook.addWorksheet('B2B');
  b2bSheet.addRow(['GSTIN of Recipient', 'Invoice Number', 'Invoice Date', 'Invoice Value', 'Place of Supply', 'Rate', 'Taxable Value', 'CGST', 'SGST', 'IGST']);
  
  data.b2b.forEach(invoice => {
    invoice.items.forEach(item => {
      b2bSheet.addRow([
        invoice.customerDetails.gstin,
        invoice.invoiceNumber,
        new Date(invoice.invoiceDate).toLocaleDateString('en-IN'),
        invoice.grandTotal,
        invoice.customerDetails.state,
        item.gstRate,
        item.taxableAmount,
        item.cgst,
        item.sgst,
        item.igst
      ]);
    });
  });

  // B2CS Sheet
  const b2csSheet = workbook.addWorksheet('B2CS');
  b2csSheet.addRow(['Type', 'Place of Supply', 'Rate', 'Taxable Value', 'CGST', 'SGST']);
  
  data.b2cs.forEach(item => {
    b2csSheet.addRow([
      'OE', // Own state
      business.state,
      item.gstRate,
      item.taxableAmount,
      item.cgst,
      item.sgst
    ]);
  });

  // B2CL Sheet
  const b2clSheet = workbook.addWorksheet('B2CL');
  b2clSheet.addRow(['Invoice Number', 'Invoice Date', 'Invoice Value', 'Place of Supply', 'Rate', 'Taxable Value', 'IGST']);
  
  data.b2cl.forEach(invoice => {
    invoice.items.forEach(item => {
      b2clSheet.addRow([
        invoice.invoiceNumber,
        new Date(invoice.invoiceDate).toLocaleDateString('en-IN'),
        invoice.grandTotal,
        invoice.customerDetails.state,
        item.gstRate,
        item.taxableAmount,
        item.igst
      ]);
    });
  });

  const buffer = await workbook.xlsx.writeBuffer();
  return buffer;
};

/**
 * Generate Tax Summary Excel
 */
exports.generateTaxSummaryExcel = async (summary, totals, business, startDate, endDate) => {
  const workbook = new ExcelJS.Workbook();
  const worksheet = workbook.addWorksheet('Tax Summary');

  // Add title
  worksheet.mergeCells('A1:F1');
  worksheet.getCell('A1').value = `Tax Summary - ${business.name}`;
  worksheet.getCell('A1').font = { bold: true, size: 14 };
  worksheet.getCell('A1').alignment = { horizontal: 'center' };

  worksheet.mergeCells('A2:F2');
  worksheet.getCell('A2').value = `Period: ${startDate} to ${endDate}`;
  worksheet.getCell('A2').alignment = { horizontal: 'center' };

  // Add headers
  worksheet.addRow([]);
  const headerRow = worksheet.addRow(['GST Rate (%)', 'Taxable Amount', 'CGST', 'SGST', 'IGST', 'Total Amount']);
  headerRow.font = { bold: true };
  headerRow.fill = {
    type: 'pattern',
    pattern: 'solid',
    fgColor: { argb: 'FFD3D3D3' }
  };

  // Add data
  summary.forEach(item => {
    worksheet.addRow([
      item._id,
      item.taxableAmount,
      item.cgst,
      item.sgst,
      item.igst,
      item.totalAmount
    ]);
  });

  // Add totals
  const totalRow = worksheet.addRow([
    'TOTAL',
    totals.taxableAmount,
    totals.cgst,
    totals.sgst,
    totals.igst,
    totals.totalAmount
  ]);
  totalRow.font = { bold: true };

  worksheet.columns = [
    { width: 15 }, { width: 18 }, { width: 12 }, 
    { width: 12 }, { width: 12 }, { width: 18 }
  ];

  const buffer = await workbook.xlsx.writeBuffer();
  return buffer;
};
