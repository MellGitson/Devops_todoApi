const { pool } = require('../db/pool');

async function create(description, status) {
  const result = await pool.query(
    `INSERT INTO tasks (description, status) VALUES ($1, $2) RETURNING *`,
    [description, status || 'todo']
  );
  return result.rows[0];
}

async function findAll() {
  const result = await pool.query(`SELECT * FROM tasks ORDER BY id ASC`);
  return result.rows;
}

async function findById(id) {
  const result = await pool.query(`SELECT * FROM tasks WHERE id = $1`, [id]);
  return result.rows[0] || null;
}

async function update(id, { description, status }) {
  const result = await pool.query(
    `UPDATE tasks SET description = $1, status = $2, updated_at = now() WHERE id = $3 RETURNING *`,
    [description, status, id]
  );
  return result.rows[0] || null;
}

async function remove(id) {
  const result = await pool.query(`DELETE FROM tasks WHERE id = $1 RETURNING *`, [id]);
  return result.rows[0] || null;
}

module.exports = { create, findAll, findById, update, remove };
