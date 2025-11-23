module.exports = {
    GST_RATES: [0, 5, 12, 18, 28],
    
    UNITS: [
      'PCS', 'KG', 'GRAM', 'LITRE', 'ML', 
      'METER', 'CM', 'FEET', 'INCH',
      'HOURS', 'DAYS', 'BOX', 'SET', 'PAIR'
    ],
    
    PAYMENT_MODES: ['CASH', 'UPI', 'CARD', 'BANK_TRANSFER', 'CHEQUE'],
    
    PAYMENT_STATUS: {
      UNPAID: 'unpaid',
      PARTIAL: 'partial',
      PAID: 'paid'
    },
    
    CUSTOMER_TYPES: {
      B2B: 'B2B',
      B2C: 'B2C'
    },
    
    INVOICE_TYPES: {
      B2B: 'B2B',
      B2CS: 'B2CS', // B2C Small (intrastate < 2.5L)
      B2CL: 'B2CL'  // B2C Large (interstate > 2.5L)
    },
    
    INDIAN_STATES: [
      'Andhra Pradesh', 'Arunachal Pradesh', 'Assam', 'Bihar', 'Chhattisgarh',
      'Goa', 'Gujarat', 'Haryana', 'Himachal Pradesh', 'Jharkhand', 'Karnataka',
      'Kerala', 'Madhya Pradesh', 'Maharashtra', 'Manipur', 'Meghalaya', 'Mizoram',
      'Nagaland', 'Odisha', 'Punjab', 'Rajasthan', 'Sikkim', 'Tamil Nadu',
      'Telangana', 'Tripura', 'Uttar Pradesh', 'Uttarakhand', 'West Bengal',
      'Andaman and Nicobar Islands', 'Chandigarh', 'Dadra and Nagar Haveli and Daman and Diu',
      'Delhi', 'Jammu and Kashmir', 'Ladakh', 'Lakshadweep', 'Puducherry'
    ]
  };
  