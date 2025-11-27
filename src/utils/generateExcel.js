const ExcelJS = require('exceljs');

// Utility to add borders to cells
const addBorders = (worksheet, startRow, endRow, startCol, endCol) => {
  const border = {
    top: { style: 'thin' },
    left: { style: 'thin' },
    bottom: { style: 'thin' },
    right: { style: 'thin' }
  };

  for (let row = startRow; row <= endRow; row++) {
    for (let col = startCol; col <= endCol; col++) {
      const cell = worksheet.getCell(row, col);
      cell.border = border;
    }
  }
};

// Utility to format currency
const formatCurrency = (value) => {
  return `₹${parseFloat(value).toFixed(2)}`;
};

/**
 * Generate Sales Register Excel
 */
exports.generateSalesRegisterExcel = async (invoices, business, startDate, endDate) => {
  const workbook = new ExcelJS.Workbook();
  const worksheet = workbook.addWorksheet('Sales Register');

  // Set column widths
  worksheet.columns = [
    { width: 12 },  // Invoice No
    { width: 12 },  // Date
    { width: 25 },  // Customer Name
    { width: 15 },  // GSTIN
    { width: 15 },  // Phone
    { width: 15 },  // State
    { width: 15 },  // Invoice Type
    { width: 15 },  // Taxable Amount
    { width: 12 },  // CGST
    { width: 12 },  // SGST
    { width: 12 },  // IGST
    { width: 15 }   // Total Amount
  ];

  // Title
  worksheet.mergeCells('A1:L1');
  const titleCell = worksheet.getCell('A1');
  titleCell.value = `Sales Register - ${business.name}`;
  titleCell.font = { bold: true, size: 14 };
  titleCell.alignment = { horizontal: 'center', vertical: 'center' };
  worksheet.getRow(1).height = 25;

  // Period
  worksheet.mergeCells('A2:L2');
  const periodCell = worksheet.getCell('A2');
  periodCell.value = `Period: ${startDate} to ${endDate}`;
  periodCell.alignment = { horizontal: 'center' };
  periodCell.font = { size: 11 };

  // Headers
  const headerRow = worksheet.getRow(4);
  const headers = [
    'Invoice No.', 'Date', 'Customer Name', 'GSTIN', 'Phone',
    'State', 'Invoice Type', 'Taxable Amount', 'CGST', 'SGST', 'IGST', 'Total Amount'
  ];

  headers.forEach((header, index) => {
    const cell = headerRow.getCell(index + 1);
    cell.value = header;
    cell.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF366092' } };
    cell.alignment = { horizontal: 'center', vertical: 'center', wrapText: true };
  });
  headerRow.height = 25;

  // Data rows
  let dataRowNum = 5;
  let totals = {
    taxable: 0,
    cgst: 0,
    sgst: 0,
    igst: 0,
    total: 0
  };

  invoices.forEach((invoice) => {
    const row = worksheet.getRow(dataRowNum);
    const taxableAmount = invoice.subtotal - invoice.totalDiscount;

    row.values = [
      invoice.invoiceNumber,
      new Date(invoice.invoiceDate).toLocaleDateString('en-IN'),
      invoice.customerDetails.name,
      invoice.customerDetails.gstin || 'N/A',
      invoice.customerDetails.phone || '-',
      invoice.customerDetails.state || '-',
      invoice.invoiceType,
      taxableAmount,
      invoice.totalCGST,
      invoice.totalSGST,
      invoice.totalIGST,
      invoice.grandTotal
    ];

    // Format numbers
    row.getCell(8).numFmt = '₹#,##0.00';
    row.getCell(9).numFmt = '₹#,##0.00';
    row.getCell(10).numFmt = '₹#,##0.00';
    row.getCell(11).numFmt = '₹#,##0.00';
    row.getCell(12).numFmt = '₹#,##0.00';

    // Center align
    row.getCell(1).alignment = { horizontal: 'center' };
    row.getCell(2).alignment = { horizontal: 'center' };
    row.getCell(7).alignment = { horizontal: 'center' };

    totals.taxable += taxableAmount;
    totals.cgst += invoice.totalCGST;
    totals.sgst += invoice.totalSGST;
    totals.igst += invoice.totalIGST;
    totals.total += invoice.grandTotal;

    dataRowNum++;
  });

  // Totals row
  const totalRow = worksheet.getRow(dataRowNum);
  totalRow.values = ['', '', '', '', '', '', 'TOTAL', totals.taxable, totals.cgst, totals.sgst, totals.igst, totals.total];
  totalRow.font = { bold: true };
  totalRow.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE6E6E6' } };

  // Format totals
  totalRow.getCell(8).numFmt = '₹#,##0.00';
  totalRow.getCell(9).numFmt = '₹#,##0.00';
  totalRow.getCell(10).numFmt = '₹#,##0.00';
  totalRow.getCell(11).numFmt = '₹#,##0.00';
  totalRow.getCell(12).numFmt = '₹#,##0.00';

  // Add borders
  addBorders(worksheet, 4, dataRowNum, 1, 12);

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
  b2bSheet.columns = [
    { width: 15 }, { width: 12 }, { width: 12 }, { width: 15 },
    { width: 12 }, { width: 15 }, { width: 15 }, { width: 12 },
    { width: 12 }, { width: 12 }, { width: 12 }
  ];

  // B2B Title
  b2bSheet.mergeCells('A1:K1');
  const b2bTitle = b2bSheet.getCell('A1');
  b2bTitle.value = `GSTR-1 B2B - ${business.name}`;
  b2bTitle.font = { bold: true, size: 12 };
  b2bTitle.alignment = { horizontal: 'center' };

  // B2B Headers
  const b2bHeaders = b2bSheet.getRow(3);
  b2bHeaders.values = [
    'GSTIN', 'Invoice No.', 'Date', 'Invoice Value', 'Place of Supply',
    'HSN/SAC', 'Rate', 'Taxable Value', 'CGST', 'SGST', 'IGST'
  ];
  b2bHeaders.font = { bold: true, color: { argb: 'FFFFFFFF' } };
  b2bHeaders.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF366092' } };

  let b2bRow = 4;
  data.b2b.forEach((invoice) => {
    invoice.items.forEach((item) => {
      const row = b2bSheet.getRow(b2bRow);
      row.values = [
        invoice.customerDetails.gstin,
        invoice.invoiceNumber,
        new Date(invoice.invoiceDate).toLocaleDateString('en-IN'),
        invoice.grandTotal,
        invoice.customerDetails.state,
        item.hsnCode,
        `${item.gstRate}%`,
        item.taxableAmount,
        item.cgst,
        item.sgst,
        item.igst
      ];

      row.getCell(4).numFmt = '₹#,##0.00';
      row.getCell(8).numFmt = '₹#,##0.00';
      row.getCell(9).numFmt = '₹#,##0.00';
      row.getCell(10).numFmt = '₹#,##0.00';
      row.getCell(11).numFmt = '₹#,##0.00';

      b2bRow++;
    });
  });

  // B2CS Sheet
  const b2csSheet = workbook.addWorksheet('B2CS');
  b2csSheet.columns = [
    { width: 15 }, { width: 15 }, { width: 12 }, { width: 15 },
    { width: 12 }, { width: 12 }
  ];

  b2csSheet.mergeCells('A1:F1');
  const b2csTitle = b2csSheet.getCell('A1');
  b2csTitle.value = `GSTR-1 B2CS (Small) - ${business.name}`;
  b2csTitle.font = { bold: true, size: 12 };
  b2csTitle.alignment = { horizontal: 'center' };

  const b2csHeaders = b2csSheet.getRow(3);
  b2csHeaders.values = [
    'Type', 'Place of Supply', 'GST Rate', 'Taxable Value', 'CGST', 'SGST'
  ];
  b2csHeaders.font = { bold: true, color: { argb: 'FFFFFFFF' } };
  b2csHeaders.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF366092' } };

  let b2csRow = 4;
  data.b2cs.forEach((item) => {
    const row = b2csSheet.getRow(b2csRow);
    row.values = [
      'OE',
      business.state,
      `${item.gstRate}%`,
      item.taxableAmount,
      item.cgst,
      item.sgst
    ];

    row.getCell(4).numFmt = '₹#,##0.00';
    row.getCell(5).numFmt = '₹#,##0.00';
    row.getCell(6).numFmt = '₹#,##0.00';

    b2csRow++;
  });

  // B2CL Sheet
  const b2clSheet = workbook.addWorksheet('B2CL');
  b2clSheet.columns = [
    { width: 12 }, { width: 12 }, { width: 15 }, { width: 15 },
    { width: 12 }, { width: 15 }, { width: 12 }
  ];

  b2clSheet.mergeCells('A1:G1');
  const b2clTitle = b2clSheet.getCell('A1');
  b2clTitle.value = `GSTR-1 B2CL (Large) - ${business.name}`;
  b2clTitle.font = { bold: true, size: 12 };
  b2clTitle.alignment = { horizontal: 'center' };

  const b2clHeaders = b2clSheet.getRow(3);
  b2clHeaders.values = [
    'Invoice No.', 'Date', 'Invoice Value', 'Place of Supply',
    'HSN/SAC', 'Taxable Value', 'IGST'
  ];
  b2clHeaders.font = { bold: true, color: { argb: 'FFFFFFFF' } };
  b2clHeaders.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF366092' } };

  let b2clRow = 4;
  data.b2cl.forEach((invoice) => {
    invoice.items.forEach((item) => {
      const row = b2clSheet.getRow(b2clRow);
      row.values = [
        invoice.invoiceNumber,
        new Date(invoice.invoiceDate).toLocaleDateString('en-IN'),
        invoice.grandTotal,
        invoice.customerDetails.state,
        item.hsnCode,
        item.taxableAmount,
        item.igst
      ];

      row.getCell(3).numFmt = '₹#,##0.00';
      row.getCell(6).numFmt = '₹#,##0.00';
      row.getCell(7).numFmt = '₹#,##0.00';

      b2clRow++;
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

  worksheet.columns = [
    { width: 15 }, { width: 18 }, { width: 12 },
    { width: 12 }, { width: 12 }, { width: 12 }, { width: 15 }
  ];

  // Title
  worksheet.mergeCells('A1:G1');
  const titleCell = worksheet.getCell('A1');
  titleCell.value = `Tax Summary - ${business.name}`;
  titleCell.font = { bold: true, size: 14 };
  titleCell.alignment = { horizontal: 'center', vertical: 'center' };
  worksheet.getRow(1).height = 25;

  // Period
  worksheet.mergeCells('A2:G2');
  const periodCell = worksheet.getCell('A2');
  periodCell.value = `Period: ${startDate} to ${endDate}`;
  periodCell.alignment = { horizontal: 'center' };

  // Headers
  const headerRow = worksheet.getRow(4);
  const headers = ['GST Rate (%)', 'Taxable Amount', 'CGST', 'SGST', 'IGST', 'Total Tax', 'Total Amount'];

  headers.forEach((header, index) => {
    const cell = headerRow.getCell(index + 1);
    cell.value = header;
    cell.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF366092' } };
    cell.alignment = { horizontal: 'center' };
  });
  headerRow.height = 25;

  // Data rows
  let rowNum = 5;
  summary.forEach((item) => {
    const row = worksheet.getRow(rowNum);
    row.values = [
      `${item._id}%`,
      item.taxableAmount,
      item.cgst,
      item.sgst,
      item.igst,
      item.totalTax,
      item.totalAmount
    ];

    row.getCell(2).numFmt = '₹#,##0.00';
    row.getCell(3).numFmt = '₹#,##0.00';
    row.getCell(4).numFmt = '₹#,##0.00';
    row.getCell(5).numFmt = '₹#,##0.00';
    row.getCell(6).numFmt = '₹#,##0.00';
    row.getCell(7).numFmt = '₹#,##0.00';

    row.getCell(1).alignment = { horizontal: 'center' };

    rowNum++;
  });

  // Totals row
  const totalRow = worksheet.getRow(rowNum);
  totalRow.values = [
    'TOTAL',
    totals.taxableAmount,
    totals.cgst,
    totals.sgst,
    totals.igst,
    totals.totalTax,
    totals.totalAmount
  ];
  totalRow.font = { bold: true };
  totalRow.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE6E6E6' } };

  totalRow.getCell(2).numFmt = '₹#,##0.00';
  totalRow.getCell(3).numFmt = '₹#,##0.00';
  totalRow.getCell(4).numFmt = '₹#,##0.00';
  totalRow.getCell(5).numFmt = '₹#,##0.00';
  totalRow.getCell(6).numFmt = '₹#,##0.00';
  totalRow.getCell(7).numFmt = '₹#,##0.00';

  // Add borders
  addBorders(worksheet, 4, rowNum, 1, 7);

  const buffer = await workbook.xlsx.writeBuffer();
  return buffer;
};
