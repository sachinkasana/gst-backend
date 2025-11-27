const app = require('./src/app');
const connectDB = require('./src/config/database');
const { port, env } = require('./src/config/env');

let server;

// Connect to database and start server
const startServer = async () => {
  try {
    // Connect to MongoDB
    await connectDB();

    // Start server
    server = app.listen(port, () => {
      console.log(`
  ╔═══════════════════════════════════════════╗
  ║   🚀 GST Invoice Server Running           ║
  ║   Environment: ${env.padEnd(27)}║
  ║   Port: ${port.toString().padEnd(33)}║
  ║   URL: http://localhost:${port.toString().padEnd(19)}║
  ╚═══════════════════════════════════════════╝
  `);
    });
  } catch (error) {
    console.error('❌ Failed to start server:', error);
    process.exit(1);
  }
};

// Start server only if not in test environment
if (require.main === module) {
  startServer();
}

// Handle unhandled promise rejections
process.on('unhandledRejection', (err) => {
  console.error('❌ Unhandled Rejection:', err);
  if (server) {
    server.close(() => process.exit(1));
  }
});

// Handle SIGTERM (Vercel sends this on shutdown)
process.on('SIGTERM', () => {
  console.log('👋 SIGTERM received. Shutting down gracefully...');
  if (server) {
    server.close(() => {
      console.log('✅ Process terminated');
      mongoose.connection.close();
    });
  }
});

module.exports = app;
