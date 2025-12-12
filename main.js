require('dotenv').config();

const fs = require('fs');
const path = require('path');
const express = require('express');
const multer = require('multer');
const { Command } = require('commander');
const swaggerUi = require('swagger-ui-express');
const swaggerJsdoc = require('swagger-jsdoc');

const DEFAULT_HOST = process.env.HOST || '0.0.0.0';
const DEFAULT_PORT = Number(process.env.PORT) || 3000;
const DEFAULT_CACHE_DIR = process.env.CACHE_DIR || 'cache';

const program = new Command();
program
  .option('-h, --host <host>', 'Server host', DEFAULT_HOST)
  .option('-p, --port <port>', 'Server port', Number, DEFAULT_PORT)
  .option('-c, --cache <dir>', 'Cache directory', DEFAULT_CACHE_DIR)
  .parse(process.argv);

const { host: HOST, port: PORT, cache } = program.opts();

const CACHE_DIR = path.resolve(cache);
const PHOTOS_DIR = path.join(CACHE_DIR, 'photos');
const DB_FILE = path.join(CACHE_DIR, 'inventory.json');

[CACHE_DIR, PHOTOS_DIR].forEach((dir) => {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
});

const loadInventory = () => {
  try {
    return JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
  } catch {
    return [];
  }
};

let inventory = loadInventory();

const saveInventory = () => {
  fs.writeFileSync(DB_FILE, JSON.stringify(inventory, null, 2));
};

const genId = () =>
  String(Math.max(0, ...inventory.map((i) => Number(i.id))) + 1);

const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: false }));

const upload = multer({ dest: PHOTOS_DIR });

const guard = (methods) => (req, res, next) =>
  methods.includes(req.method)
    ? next()
    : res.status(405).send('Method not allowed');

const findItem = (id) => inventory.find((i) => i.id === id);

const photoUrl = (req, item) =>
  item.photoFilename
    ? `${req.protocol}://${req.get('host')}/inventory/${item.id}/photo`
    : null;

const dto = (req, item) => ({
  id: item.id,
  inventory_name: item.inventory_name,
  description: item.description,
  photo_url: photoUrl(req, item),
});

const swaggerOptions = {
  definition: {
    openapi: '3.0.0',
    info: {
      title: 'Inventory Service API',
      version: '1.0.0',
      description: 'Inventory service'
    },
    servers: [{ url: `http://${HOST}:${PORT}` }]
  },
  apis: []
};

app.use('/docs', swaggerUi.serve, swaggerUi.setup(swaggerJsdoc(swaggerOptions)));

app
  .route('/register')
  .all(guard(['POST']))
  .post(upload.single('photo'), (req, res) => {
    const { inventory_name, description = '' } = req.body;

    if (!inventory_name || !inventory_name.trim()) {
      return res.status(400).json({ error: 'inventory_name is required' });
    }

    const item = {
      id: genId(),
      inventory_name,
      description,
      photoFilename: req.file ? req.file.filename : null,
    };

    inventory.push(item);
    saveInventory();

    res.status(201).json(dto(req, item));
  });

app
  .route('/inventory')
  .all(guard(['GET']))
  .get((req, res) => {
    res.json(inventory.map((i) => dto(req, i)));
  });

app
  .route('/inventory/:id')
  .all(guard(['GET', 'PUT', 'DELETE']))
  .get((req, res) => {
    const item = findItem(req.params.id);
    if (!item) return res.status(404).json({ error: 'Not found' });
    res.json(dto(req, item));
  })
  .put((req, res) => {
    const item = findItem(req.params.id);
    if (!item) return res.status(404).json({ error: 'Not found' });

    if (req.body.inventory_name !== undefined)
      item.inventory_name = req.body.inventory_name;
    if (req.body.description !== undefined)
      item.description = req.body.description;

    saveInventory();
    res.json(dto(req, item));
  })
  .delete((req, res) => {
    const index = inventory.findIndex((i) => i.id === req.params.id);
    if (index === -1) return res.status(404).json({ error: 'Not found' });

    const [removed] = inventory.splice(index, 1);
    if (removed.photoFilename) {
      fs.promises
        .unlink(path.join(PHOTOS_DIR, removed.photoFilename))
        .catch(() => {});
    }

    saveInventory();
    res.json({ message: 'Deleted' });
  });

app
  .route('/inventory/:id/photo')
  .all(guard(['GET', 'PUT']))
  .get((req, res) => {
    const item = findItem(req.params.id);
    if (!item || !item.photoFilename) return res.status(404).send('Not found');

    const file = path.join(PHOTOS_DIR, item.photoFilename);
    if (!fs.existsSync(file)) return res.status(404).send('Not found');

    res.type('jpg').sendFile(file);
  })
  .put(upload.single('photo'), (req, res) => {
    const item = findItem(req.params.id);
    if (!item) return res.status(404).json({ error: 'Not found' });
    if (!req.file) return res.status(400).json({ error: 'photo file is required' });

    if (item.photoFilename) {
      fs.promises
        .unlink(path.join(PHOTOS_DIR, item.photoFilename))
        .catch(() => {});
    }

    item.photoFilename = req.file.filename;
    saveInventory();

    res.json({
      id: item.id,
      photo_url: photoUrl(req, item),
      message: 'Photo updated',
    });
  });

app.use((req, res) => res.status(404).send('Not found'));

app.listen(PORT, HOST, () => {
  console.log(`Server running at http://${HOST}:${PORT}`);
  console.log(`Cache directory: ${CACHE_DIR}`);
});
