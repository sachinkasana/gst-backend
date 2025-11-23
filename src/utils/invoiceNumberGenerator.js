/**
 * Generate unique invoice number
 * @param {Object} business - Business document
 * @returns {String} - Invoice number (e.g., INV-2025-0001)
 */
exports.generateInvoiceNumber = async (business) => {
    const year = new Date().getFullYear();
    const prefix = business.invoicePrefix || 'INV';
    
    // Increment counter
    business.invoiceCounter += 1;
    await business.save();
    
    // Format: INV-2025-0001
    const paddedNumber = String(business.invoiceCounter).padStart(4, '0');
    return `${prefix}-${year}-${paddedNumber}`;
  };
  