const serverless = require('serverless-http');
const express = require('express');
const path = require('path');

const app = express();

// Configure express for Lambda
app.use(express.static(path.join(__dirname, 'dist'), {
  maxAge: '1d', // Cache static assets
  etag: false
}));

// Handle API routes if any
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Handle client-side routing - this should be last
app.get('*', (req, res) => {
  res.sendFile(path.resolve(__dirname, 'dist', 'index.html'));
});

// Export the handler
module.exports.handler = serverless(app, {
  binary: ['image/*', 'application/octet-stream', 'font/*']
});