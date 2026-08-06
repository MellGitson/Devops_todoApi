const express = require('express');
const Task = require('../models/task');
const { tasksCreatedTotal } = require('../metrics');

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

    const task = await Task.create(description, status);
    tasksCreatedTotal.inc();
    res.status(201).json(task);
  } catch (err) {
    next(err);
  }
});

router.get('/', async (req, res, next) => {
  try {
    const tasks = await Task.findAll();
    res.json(tasks);
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

    const task = await Task.findById(id);
    if (!task) {
      return res.status(404).json({ error: 'tache introuvable' });
    }

    res.json(task);
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

    const existing = await Task.findById(id);
    if (!existing) {
      return res.status(404).json({ error: 'tache introuvable' });
    }

    const task = await Task.update(id, {
      description: description !== undefined ? description : existing.description,
      status: status !== undefined ? status : existing.status,
    });

    res.json(task);
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

    const task = await Task.remove(id);
    if (!task) {
      return res.status(404).json({ error: 'tache introuvable' });
    }

    res.status(204).send();
  } catch (err) {
    next(err);
  }
});

module.exports = router;
