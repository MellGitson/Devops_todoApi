const express = require('express');
const tasksRouter = require('./routes/tasks');
const { bodyParserErrorHandler, notFoundHandler, errorHandler } = require('./middleware/errorHandler');

const app = express();

// Limite de corps sur express.json en plus de la limite de 1000 caracteres
// sur description : sans elle, Express parse un corps enorme avant meme
// d'atteindre la route de validation.
app.use(express.json({ limit: '100kb' }));
app.use(bodyParserErrorHandler);

app.get('/health', (req, res) => {
  res.status(500).json({ status: 'ko' });
});

app.use('/api/tasks', tasksRouter);

app.use(notFoundHandler);
app.use(errorHandler);

module.exports = app;
