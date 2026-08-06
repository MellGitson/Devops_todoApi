const client = require('prom-client');

const register = new client.Registry();
client.collectDefaultMetrics({ register });

const httpRequestsTotal = new client.Counter({
  name: 'http_requests_total',
  help: 'Nombre total de requetes HTTP servies',
  labelNames: ['method', 'route', 'status'],
  registers: [register],
});

const httpRequestDuration = new client.Histogram({
  name: 'http_request_duration_seconds',
  help: 'Duree des requetes HTTP en secondes',
  labelNames: ['method', 'route', 'status'],
  registers: [register],
});

const tasksCreatedTotal = new client.Counter({
  name: 'tasks_created_total',
  help: 'Nombre de taches creees depuis le demarrage',
  registers: [register],
});

function routeLabel(req) {
  if (req.route) {
    const base = req.baseUrl || '';
    const path = req.route.path === '/' ? '' : req.route.path;
    return `${base}${path}` || '/';
  }
  return 'unknown_route';
}

function metricsMiddleware(req, res, next) {
  const end = httpRequestDuration.startTimer();
  res.on('finish', () => {
    const labels = { method: req.method, route: routeLabel(req), status: res.statusCode };
    httpRequestsTotal.inc(labels);
    end(labels);
  });
  next();
}

module.exports = { register, metricsMiddleware, tasksCreatedTotal };
