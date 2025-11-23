const Business = require('../models/Business');

// @desc    Get business details
// @route   GET /api/business
// @access  Private
exports.getBusiness = async (req, res) => {
  try {
    const business = await Business.findOne({ 
      userId: req.user.id 
    });

    if (!business) {
      return res.status(404).json({
        success: false,
        message: 'Business not found'
      });
    }

    res.status(200).json({
      success: true,
      data: business
    });
  } catch (error) {
    console.error('Get Business Error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error',
      error: error.message
    });
  }
};

// @desc    Update business details
// @route   PUT /api/business
// @access  Private
exports.updateBusiness = async (req, res) => {
  try {
    const {
      name,
      gstin,
      address,
      city,
      state,
      pincode,
      phone,
      invoicePrefix,
      bankDetails,
      termsConditions
    } = req.body;

    const business = await Business.findOne({ 
      userId: req.user.id 
    });

    if (!business) {
      return res.status(404).json({
        success: false,
        message: 'Business not found'
      });
    }

    // Update fields
    if (name) business.name = name;
    if (gstin !== undefined) business.gstin = gstin;
    if (address) business.address = address;
    if (city) business.city = city;
    if (state) business.state = state;
    if (pincode) business.pincode = pincode;
    if (phone) business.phone = phone;
    if (invoicePrefix) business.invoicePrefix = invoicePrefix;
    if (bankDetails) business.bankDetails = bankDetails;
    if (termsConditions) business.termsConditions = termsConditions;

    await business.save();

    res.status(200).json({
      success: true,
      message: 'Business updated successfully',
      data: business
    });
  } catch (error) {
    console.error('Update Business Error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error',
      error: error.message
    });
  }
};

// @desc    Get invoice settings
// @route   GET /api/business/invoice-settings
// @access  Private
exports.getInvoiceSettings = async (req, res) => {
  try {
    const business = await Business.findOne({ 
      userId: req.user.id 
    }).select('invoicePrefix invoiceCounter termsConditions bankDetails');

    res.status(200).json({
      success: true,
      data: business
    });
  } catch (error) {
    console.error('Get Invoice Settings Error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error',
      error: error.message
    });
  }
};
 