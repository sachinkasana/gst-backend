/**
 * Calculate GST based on business and customer states
 * @param {Number} taxableAmount - Amount before tax
 * @param {Number} gstRate - GST rate (0, 5, 12, 18, 28)
 * @param {String} businessState - Business state
 * @param {String} customerState - Customer state
 * @returns {Object} - { cgst, sgst, igst }
 */
exports.calculateGST = (taxableAmount, gstRate, businessState, customerState) => {
    const gstAmount = (taxableAmount * gstRate) / 100;
  
    // Intrastate (same state) - CGST + SGST
    if (businessState === customerState) {
      return {
        cgst: gstAmount / 2,
        sgst: gstAmount / 2,
        igst: 0
      };
    }
  
    // Interstate (different states) - IGST
    return {
      cgst: 0,
      sgst: 0,
      igst: gstAmount
    };
  };
  
  /**
   * Determine invoice type based on customer and transaction details
   * @param {String} gstin - Customer GSTIN
   * @param {String} businessState - Business state
   * @param {String} customerState - Customer state
   * @param {Number} amount - Invoice amount
   * @returns {String} - 'B2B', 'B2CS', or 'B2CL'
   */
  exports.determineInvoiceType = (gstin, businessState, customerState, amount) => {
    // B2B - Customer has GSTIN
    if (gstin && gstin.trim() !== '') {
      return 'B2B';
    }
  
    // B2C Large - Interstate and amount > 2.5 lakh
    if (businessState !== customerState && amount > 250000) {
      return 'B2CL';
    }
  
    // B2C Small - All other B2C transactions
    return 'B2CS';
  };
  
  /**
   * Validate GSTIN format
   * @param {String} gstin - GSTIN to validate
   * @returns {Boolean}
   */
  exports.validateGSTIN = (gstin) => {
    if (!gstin) return true; // Optional field
    
    const gstinRegex = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[1-9A-Z]{1}Z[0-9A-Z]{1}$/;
    return gstinRegex.test(gstin);
  };
  