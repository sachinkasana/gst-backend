const Invoice = require('../models/Invoice');
const Business = require('../models/Business');
const { generateSalesRegisterExcel, generateGSTR1Excel, generateTaxSummaryExcel } = require('../utils/generateExcel');

// @desc    Get sales register
// @route   GET /api/reports/sales-register
// @access  Private
exports.getSalesRegister = async (req, res) => {
  try {
    const { startDate, endDate, format = 'json' } = req.query;

    // Validate dates
    if (!startDate || !endDate) {
      return res.status(400).json({
        success: false,
        message: 'Start date and end date are required'
      });
    }

    // Parse dates
    const start = new Date(startDate);
    const end = new Date(endDate);
    end.setHours(23, 59, 59, 999);

    if (start > end) {
      return res.status(400).json({
        success: false,
        message: 'Start date must be before end date'
      });
    }

    // Fetch invoices
    const invoices = await Invoice.find({
      businessId: req.user.businessId,
      isDraft: false,
      invoiceDate: {
        $gte: start,
        $lte: end
      }
    })
    .populate('customerId', 'name phone gstin')
    .sort({ invoiceDate: 1 });

    if (format === 'excel') {
      const business = await Business.findById(req.user.businessId);
      const buffer = await generateSalesRegisterExcel(invoices, business, startDate, endDate);
      
      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      res.setHeader('Content-Disposition', `attachment; filename=sales-register-${startDate}-to-${endDate}.xlsx`);
      return res.send(buffer);
    }

    res.status(200).json({
      success: true,
      data: invoices,
      count: invoices.length
    });
  } catch (error) {
    console.error('Get Sales Register Error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error',
      error: error.message
    });
  }
};

// @desc    Get GSTR-1 report
// @route   GET /api/reports/gstr1
// @access  Private
exports.getGSTR1Report = async (req, res) => {
  try {
    const { startDate, endDate, format = 'json' } = req.query;

    if (!startDate || !endDate) {
      return res.status(400).json({
        success: false,
        message: 'Start date and end date are required'
      });
    }

    const start = new Date(startDate);
    const end = new Date(endDate);
    end.setHours(23, 59, 59, 999);

    if (start > end) {
      return res.status(400).json({
        success: false,
        message: 'Start date must be before end date'
      });
    }

    // Fetch invoices
    const invoices = await Invoice.find({
      businessId: req.user.businessId,
      isDraft: false,
      invoiceDate: {
        $gte: start,
        $lte: end
      }
    })
    .populate('customerId', 'name phone gstin')
    .sort({ invoiceDate: 1 });

    // Separate by invoice type
    const b2bInvoices = invoices.filter(inv => inv.invoiceType === 'B2B');
    const b2csInvoices = invoices.filter(inv => inv.invoiceType === 'B2CS');
    const b2clInvoices = invoices.filter(inv => inv.invoiceType === 'B2CL');

    // Aggregate B2CS by rate
    const b2csAggregated = {};
    b2csInvoices.forEach(inv => {
      inv.items.forEach(item => {
        const key = `${item.gstRate}`;
        if (!b2csAggregated[key]) {
          b2csAggregated[key] = {
            gstRate: item.gstRate,
            taxableAmount: 0,
            cgst: 0,
            sgst: 0,
            totalAmount: 0,
            count: 0
          };
        }
        b2csAggregated[key].taxableAmount += item.taxableAmount;
        b2csAggregated[key].cgst += item.cgst;
        b2csAggregated[key].sgst += item.sgst;
        b2csAggregated[key].totalAmount += item.totalAmount;
        b2csAggregated[key].count += 1;
      });
    });

    // Aggregate B2CL by rate
    const b2clAggregated = {};
    b2clInvoices.forEach(inv => {
      inv.items.forEach(item => {
        const key = `${item.gstRate}`;
        if (!b2clAggregated[key]) {
          b2clAggregated[key] = {
            gstRate: item.gstRate,
            taxableAmount: 0,
            igst: 0,
            totalAmount: 0,
            count: 0
          };
        }
        b2clAggregated[key].taxableAmount += item.taxableAmount;
        b2clAggregated[key].igst += item.igst;
        b2clAggregated[key].totalAmount += item.totalAmount;
        b2clAggregated[key].count += 1;
      });
    });

    if (format === 'excel') {
      const business = await Business.findById(req.user.businessId);
      const buffer = await generateGSTR1Excel(
        {
          b2b: b2bInvoices,
          b2cs: Object.values(b2csAggregated),
          b2cl: Object.values(b2clAggregated)
        },
        business,
        startDate,
        endDate
      );
      
      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      res.setHeader('Content-Disposition', `attachment; filename=GSTR1-${startDate}-to-${endDate}.xlsx`);
      return res.send(buffer);
    }

    res.status(200).json({
      success: true,
      data: {
        b2b: b2bInvoices,
        b2cs: Object.values(b2csAggregated),
        b2cl: Object.values(b2clAggregated),
        summary: {
          b2bCount: b2bInvoices.length,
          b2csCount: b2csInvoices.length,
          b2clCount: b2clInvoices.length
        }
      }
    });
  } catch (error) {
    console.error('Get GSTR1 Report Error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error',
      error: error.message
    });
  }
};

// @desc    Get tax summary
// @route   GET /api/reports/tax-summary
// @access  Private
exports.getTaxSummary = async (req, res) => {
  try {
    const { startDate, endDate, format = 'json' } = req.query;

    if (!startDate || !endDate) {
      return res.status(400).json({
        success: false,
        message: 'Start date and end date are required'
      });
    }

    const start = new Date(startDate);
    const end = new Date(endDate);
    end.setHours(23, 59, 59, 999);

    if (start > end) {
      return res.status(400).json({
        success: false,
        message: 'Start date must be before end date'
      });
    }

    // Aggregate tax data by rate
    const summary = await Invoice.aggregate([
      {
        $match: {
          businessId: req.user.businessId,
          isDraft: false,
          invoiceDate: {
            $gte: start,
            $lte: end
          }
        }
      },
      {
        $unwind: '$items'
      },
      {
        $group: {
          _id: '$items.gstRate',
          taxableAmount: { $sum: '$items.taxableAmount' },
          cgst: { $sum: '$items.cgst' },
          sgst: { $sum: '$items.sgst' },
          igst: { $sum: '$items.igst' },
          totalTax: {
            $sum: {
              $add: ['$items.cgst', '$items.sgst', '$items.igst']
            }
          },
          totalAmount: { $sum: '$items.totalAmount' },
          invoiceCount: { $sum: 1 }
        }
      },
      {
        $sort: { _id: 1 }
      }
    ]);

    // Calculate totals
    const totals = {
      taxableAmount: 0,
      cgst: 0,
      sgst: 0,
      igst: 0,
      totalTax: 0,
      totalAmount: 0,
      invoiceCount: 0
    };

    summary.forEach(item => {
      totals.taxableAmount += item.taxableAmount;
      totals.cgst += item.cgst;
      totals.sgst += item.sgst;
      totals.igst += item.igst;
      totals.totalTax += item.totalTax;
      totals.totalAmount += item.totalAmount;
      totals.invoiceCount += item.invoiceCount;
    });

    if (format === 'excel') {
      const business = await Business.findById(req.user.businessId);
      const buffer = await generateTaxSummaryExcel(summary, totals, business, startDate, endDate);
      
      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      res.setHeader('Content-Disposition', `attachment; filename=tax-summary-${startDate}-to-${endDate}.xlsx`);
      return res.send(buffer);
    }

    res.status(200).json({
      success: true,
      data: {
        byRate: summary,
        totals
      }
    });
  } catch (error) {
    console.error('Get Tax Summary Error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error',
      error: error.message
    });
  }
};
