require('dotenv').config();

module.exports = {
  env: process.env.NODE_ENV || 'development',
  port: process.env.PORT || 4000,
  mongoUri: process.env.MONGODB_URI || 'mongodb+srv://sachin:Sachin123@gst.o916bnn.mongodb.net/?appName=gst?retryWrites=true&w=majority',
  jwtSecret: process.env.JWT_SECRET || 'change-this-secret',
  jwtExpire: process.env.JWT_EXPIRE || '7d',
  frontendUrl: process.env.FRONTEND_URL || 'http://localhost:3000',
  uploadPath: process.env.UPLOAD_PATH || './uploads',
  maxFileSize: process.env.MAX_FILE_SIZE || 5242880, // 5MB
};
