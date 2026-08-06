const express = require('express');
const tasksRouter = require('./routes/tasks');
const { bodyParserErrorHandler, notFoundHandler, errorHandler } = require('./middleware/errorHandler');
const { register, metricsMiddleware } = require('./metrics');

const app = express();

app.use(metricsMiddleware);

// Limite de corps sur express.json en plus de la limite de 1000 caracteres
// sur description : sans elle, Express parse un corps enorme avant meme
// d'atteindre la route de validation.
app.use(express.json({ limit: '100kb' }));
app.use(bodyParserErrorHandler);

app.get('/health', (req, res) => {
  res.status(200).json({ status: 'ok' });
});

app.get('/metrics', async (req, res) => {
  res.set('Content-Type', register.contentType);
  res.end(await register.metrics());
});

app.use('/api/tasks', tasksRouter);

app.use(notFoundHandler);
app.use(errorHandler);

module.exports = app;
