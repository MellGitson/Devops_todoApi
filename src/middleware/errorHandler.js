function bodyParserErrorHandler(err, req, res, next) {
  if (err.type === 'entity.parse.failed' || err.type === 'entity.too.large') {
    return res.status(400).json({ error: 'corps de requete invalide ou trop volumineux' });
  }
  next(err);
}

function notFoundHandler(req, res) {
  res.status(404).json({ error: 'route introuvable' });
}

function errorHandler(err, req, res, next) {
  console.error(err);
  res.status(500).json({ error: 'erreur interne du serveur' });
}

module.exports = { bodyParserErrorHandler, notFoundHandler, errorHandler };
