const { test, before, after } = require('node:test');
const assert = require('node:assert');
const http = require('node:http');

process.env.DB_HOST = process.env.DB_HOST || 'localhost';
process.env.DB_NAME = process.env.DB_NAME || 'todo_db';
process.env.DB_USER = process.env.DB_USER || 'todo_user';
process.env.DB_PASSWORD = process.env.DB_PASSWORD || 'todo_pass';

const app = require('../../src/app');
const { ensureSchema, pool } = require('../../src/db/pool');

let server;
let baseUrl;

before(async () => {
  await ensureSchema();
  server = app.listen(0);
  const { port } = server.address();
  baseUrl = `http://localhost:${port}`;
});

after(async () => {
  server.close();
  await pool.end();
});

function request(method, path, body) {
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : null;
    const req = http.request(
      `${baseUrl}${path}`,
      {
        method,
        headers: { 'Content-Type': 'application/json' },
      },
      (res) => {
        let raw = '';
        res.on('data', (chunk) => (raw += chunk));
        res.on('end', () => {
          let parsed;
          try {
            parsed = raw ? JSON.parse(raw) : null;
          } catch {
            parsed = raw;
          }
          resolve({ status: res.statusCode, body: parsed });
        });
      }
    );
    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
}

test('GET /health repond 200', async () => {
  const res = await request('GET', '/health');
  assert.strictEqual(res.status, 200);
});

test('creation puis GET renvoie la tache avec son id', async () => {
  const created = await request('POST', '/api/tasks', { description: 'Ecrire les tests' });
  assert.strictEqual(created.status, 201);
  assert.ok(created.body.id);

  const fetched = await request('GET', `/api/tasks/${created.body.id}`);
  assert.strictEqual(fetched.status, 200);
  assert.strictEqual(fetched.body.description, 'Ecrire les tests');
});

test('un id inexistant renvoie 404', async () => {
  const res = await request('GET', '/api/tasks/999999');
  assert.strictEqual(res.status, 404);
});

test('une description de 50000 caracteres renvoie 400 sans faire tomber le process', async () => {
  const res = await request('POST', '/api/tasks', { description: 'a'.repeat(50000) });
  assert.strictEqual(res.status, 400);

  const health = await request('GET', '/health');
  assert.strictEqual(health.status, 200);
});

test('une creation sans description renvoie 400', async () => {
  const res = await request('POST', '/api/tasks', {});
  assert.strictEqual(res.status, 400);
});

test('suppression puis disparition de la liste', async () => {
  const created = await request('POST', '/api/tasks', { description: 'A supprimer' });
  assert.strictEqual(created.status, 201);

  const deleted = await request('DELETE', `/api/tasks/${created.body.id}`);
  assert.strictEqual(deleted.status, 204);

  const fetched = await request('GET', `/api/tasks/${created.body.id}`);
  assert.strictEqual(fetched.status, 404);

  const list = await request('GET', '/api/tasks');
  assert.strictEqual(list.status, 200);
  assert.ok(!list.body.some((t) => t.id === created.body.id));
});
