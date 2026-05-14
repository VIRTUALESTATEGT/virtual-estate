const app = require('../server.js');

// Vercel serverless handler
module.exports = (req, res) => {
  return app(req, res);
};
