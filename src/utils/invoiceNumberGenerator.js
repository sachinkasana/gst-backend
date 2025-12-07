const Invoice = require('../models/Invoice');

/**
 * Generate a globally unique invoice number (e.g., INV-2025-0001)
 * Keeps the business invoiceCounter in sync with existing invoices
 */
exports.generateInvoiceNumber = async (business) => {
  const year = new Date().getFullYear();
  const prefix = business.invoicePrefix || 'INV';

  // Ensure counter is a number
  if (typeof business.invoiceCounter !== 'number') {
    business.invoiceCounter = 0;
  }

  const escapeRegex = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

  // Sync counter with latest invoice for this business/year to avoid reuse
  const latestInvoice = await Invoice.findOne({
    businessId: business._id,
    invoiceNumber: { $regex: `^${escapeRegex(prefix)}-${year}-` }
  })
  .sort({ createdAt: -1 })
  .select('invoiceNumber');

  if (latestInvoice) {
    const lastSegment = latestInvoice.invoiceNumber.split('-').pop();
    const lastNumber = parseInt(lastSegment, 10);
    if (!Number.isNaN(lastNumber) && lastNumber > business.invoiceCounter) {
      business.invoiceCounter = lastNumber;
    }
  }

  let invoiceNumber;

  // Loop until we find a number that does not exist (handles any duplicate gaps)
  // Unique index on invoiceNumber will still protect against races
  // but this minimizes collisions up front.
  // eslint-disable-next-line no-constant-condition
  while (true) {
    business.invoiceCounter += 1;
    invoiceNumber = `${prefix}-${year}-${String(business.invoiceCounter).padStart(4, '0')}`;

    const exists = await Invoice.exists({ invoiceNumber });
    if (!exists) {
      await business.save();
      break;
    }
  }

  return invoiceNumber;
};
