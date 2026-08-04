const express = require('express');
const { pool } = require('../db/pool');

const router = express.Router();

const VALID_STATUSES = ['todo', 'in_progress', 'done'];

function validateDescription(description) {
  if (typeof description !== 'string' || description.trim().length === 0) {
    return 'description est requise et doit etre une chaine non vide';
  }
  if (description.length > 1000) {
    return 'description ne doit pas depasser 1000 caracteres';
  }
  return null;
}

function validateStatus(status) {
  if (status === undefined) return null;
  if (!VALID_STATUSES.includes(status)) {
    return `status doit etre l'une des valeurs : ${VALID_STATUSES.join(', ')}`;
  }
  return null;
}

router.post('/', async (req, res, next) => {
  try {
    const { description, status } = req.body || {};

    const descError = validateDescription(description);
    if (descError) return res.status(400).json({ error: descError });

    const statusError = validateStatus(status);
    if (statusError) return res.status(400).json({ error: statusError });

    const result = await pool.query(
      `INSERT INTO tasks (description, status) VALUES ($1, $2) RETURNING *`,
      [description, status || 'todo']
    );

    res.status(201).json(result.rows[0]);
  } catch (err) {
    next(err);
  }
});

router.get('/', async (req, res, next) => {
  try {
    const result = await pool.query(`SELECT * FROM tasks ORDER BY id ASC`);
    res.json(result.rows);
  } catch (err) {
    next(err);
  }
});

router.get('/:id', async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) {
      return res.status(400).json({ error: 'id doit etre un entier' });
    }

    const result = await pool.query(`SELECT * FROM tasks WHERE id = $1`, [id]);
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'tache introuvable' });
    }

    res.json(result.rows[0]);
  } catch (err) {
    next(err);
  }
});

router.put('/:id', async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) {
      return res.status(400).json({ error: 'id doit etre un entier' });
    }

    const { description, status } = req.body || {};

    if (description !== undefined) {
      const descError = validateDescription(description);
      if (descError) return res.status(400).json({ error: descError });
    }

    const statusError = validateStatus(status);
    if (statusError) return res.status(400).json({ error: statusError });

    const existing = await pool.query(`SELECT * FROM tasks WHERE id = $1`, [id]);
    if (existing.rows.length === 0) {
      return res.status(404).json({ error: 'tache introuvable' });
    }

    const updated = {
      description: description !== undefined ? description : existing.rows[0].description,
      status: status !== undefined ? status : existing.rows[0].status,
    };

    const result = await pool.query(
      `UPDATE tasks SET description = $1, status = $2, updated_at = now() WHERE id = $3 RETURNING *`,
      [updated.description, updated.status, id]
    );

    res.json(result.rows[0]);
  } catch (err) {
    next(err);
  }
});

router.delete('/:id', async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) {
      return res.status(400).json({ error: 'id doit etre un entier' });
    }

    const result = await pool.query(`DELETE FROM tasks WHERE id = $1 RETURNING *`, [id]);
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'tache introuvable' });
    }

    res.status(204).send();
  } catch (err) {
    next(err);
  }
});

module.exports = router;
