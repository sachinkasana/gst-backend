const app = require('./src/app');
const connectDB = require('./src/config/database');
const { port, env } = require('./src/config/env');

// Connect to database
connectDB();

// Start server
const server = app.listen(port, () => {
  console.log(`
  ╔═══════════════════════════════════════════╗
  ║   🚀 GST Invoice Server Running           ║
  ║   Environment: ${env.padEnd(27)}║
  ║   Port: ${port.toString().padEnd(33)}║
  ║   URL: http://localhost:${port.toString().padEnd(19)}║
  ╚═══════════════════════════════════════════╝
  `);
});

// Handle unhandled promise rejections
process.on('unhandledRejection', (err) => {
  console.error('❌ Unhandled Rejection:', err);
  server.close(() => process.exit(1));
});

// Handle SIGTERM
process.on('SIGTERM', () => {
  console.log('👋 SIGTERM received. Shutting down gracefully...');
  server.close(() => {
    console.log('✅ Process terminated');
  });
});
