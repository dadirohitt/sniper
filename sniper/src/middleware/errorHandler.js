/**
 * middleware/errorHandler.js
 */

// ------------------------------------------------------------
// REQUEST LOGGER
// ------------------------------------------------------------

function requestLogger(req, res, next) {
  const start = Date.now();
  console.log(`[${new Date().toISOString()}] ${req.method} ${req.path}`);

  // Log response time on finish
  res.on('finish', () => {
    const duration = Date.now() - start;
    console.log(`[${new Date().toISOString()}] ${req.method} ${req.path} → ${res.statusCode} (${duration}ms)`);
  });

  next();
}

// ------------------------------------------------------------
// GLOBAL ERROR HANDLER
// ------------------------------------------------------------

function errorHandler(err, req, res, next) {
  console.error(`[ERROR] ${err.message}`);
  console.error(err.stack);

  // Don't leak internal errors to client
  const statusCode = err.statusCode || 500;
  const message    = statusCode === 500 ? 'Internal server error' : err.message;

  res.status(statusCode).json({ error: message });
}

module.exports = { requestLogger, errorHandler };
