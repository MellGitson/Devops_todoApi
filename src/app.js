const express = require('express');
const tasksRouter = require('./routes/tasks');

const app = express();

// Limite de corps sur express.json en plus de la limite de 1000 caracteres
// sur description : sans elle, Express parse un corps enorme avant meme
// d'atteindre la route de validation.
app.use(express.json({ limit: '100kb' }));

app.use((err, req, res, next) => {
  if (err.type === 'entity.parse.failed' || err.type === 'entity.too.large') {
    return res.status(400).json({ error: 'corps de requete invalide ou trop volumineux' });
  }
  next(err);
});

app.get('/health', (req, res) => {
  res.status(200).json({ status: 'ok' });
});

app.use('/api/tasks', tasksRouter);

app.use((req, res) => {
  res.status(404).json({ error: 'route introuvable' });
});

app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: 'erreur interne du serveur' });
});

module.exports = app;
