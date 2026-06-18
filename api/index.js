const app = require('../server.js');

// Vercel serverless handler — delegates entirely to the Express app in server.js.
// Health/warmup endpoint is registered in server.js as a public route.
module.exports = (req, res) => {
  return app(req, res);
};
