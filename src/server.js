const app = require('./app');
const { ensureSchema } = require('./db/pool');

const PORT = process.env.PORT || 3000;

async function start() {
  try {
    await ensureSchema();
  } catch (err) {
    console.error('Impossible d\'initialiser le schema :', err.message);
  }

  const server = app.listen(PORT, () => {
    console.log(`Todo API a l'ecoute sur le port ${PORT}`);
  });

  // En PID 1 (conteneur), un process Linux perd les actions par defaut sur
  // les signaux : sans handler explicite, SIGTERM est ignore et Docker
  // force un SIGKILL (exit code 137) apres le delai de grace.
  const shutdown = (signal) => {
    console.log(`${signal} recu, arret du serveur...`);
    server.close(() => {
      console.log('Serveur arrete proprement.');
      process.exit(0);
    });
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

start();
