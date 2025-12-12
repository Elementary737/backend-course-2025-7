const fs = require('fs');
const path = require('path');
const express = require('express');
const multer = require('multer');
const { Command } = require('commander');
const swaggerUi = require('swagger-ui-express');
const swaggerJsdoc = require('swagger-jsdoc');

const program = new Command();
program
  .requiredOption('-h, --host <host>', 'Server host')
  .requiredOption('-p, --port <port>', 'Server port', (v) => parseInt(v, 10))
  .requiredOption('-c, --cache <dir>', 'Cache directory');
program.parse(process.argv);

const { host: HOST, port: PORT, cache } = program.opts();
const CACHE_DIR = path.resolve(cache);
const PHOTOS_DIR = path.join(CACHE_DIR, 'photos');
const DB_FILE = path.join(CACHE_DIR, 'inventory.json');

[ CACHE_DIR, PHOTOS_DIR ].forEach((dir) => !fs.existsSync(dir) && fs.mkdirSync(dir, { recursive: true }));

let inventory = (() => {
  try { return JSON.parse(fs.readFileSync(DB_FILE, 'utf8')); }
  catch { return []; }
})();

const saveInventory = () =>
  fs.writeFileSync(DB_FILE, JSON.stringify(inventory, null, 2), 'utf8');

const genId = () =>
  String(inventory.reduce((m, i) => Math.max(m, Number(i.id)), 0) + 1);

const app = express();
app.use(express.json(), express.urlencoded({ extended: false }));
const upload = multer({ dest: PHOTOS_DIR });

const idParam = {
  in: 'path',
  name: 'id',
  required: true,
  schema: { type: 'string' },
  description: 'Inventory item ID'
};

const swaggerOptions = {
  definition: {
    openapi: '3.0.0',
    info: {
      title: 'Inventory Service API',
      version: '1.0.0',
      description: 'Simple inventory service for Lab 6'
    },
    servers: [{ url: `http://${HOST}:${PORT}` }],
    paths: {
      '/register': {
        post: {
          summary: 'Register a new inventory item',
          requestBody: {
            required: true,
            content: {
              'multipart/form-data': {
                schema: {
                  type: 'object',
                  properties: {
                    inventory_name: { type: 'string', description: 'Item name (required)' },
                    description: { type: 'string', description: 'Item description' },
                    photo: { type: 'string', format: 'binary', description: 'Item photo file' }
                  },
                  required: ['inventory_name']
                }
              }
            }
          },
          responses: {
            201: { description: 'Inventory item created' },
            400: { description: 'Inventory name is missing' }
          }
        }
      },
      '/inventory': {
        get: {
          summary: 'Get all inventory items',
          responses: { 200: { description: 'List of all inventory items in JSON format' } }
        }
      },
      '/inventory/{id}': {
        get: {
          summary: 'Get inventory item by ID',
          parameters: [idParam],
          responses: {
            200: { description: 'Inventory item found' },
            404: { description: 'Inventory item not found' }
          }
        },
        put: {
          summary: 'Update inventory item name and/or description',
          parameters: [idParam],
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    inventory_name: { type: 'string', description: 'New item name' },
                    description: { type: 'string', description: 'New item description' }
                  }
                }
              }
            }
          },
          responses: {
            200: { description: 'Inventory item updated' },
            404: { description: 'Inventory item not found' }
          }
        },
        delete: {
          summary: 'Delete inventory item by ID',
          parameters: [idParam],
          responses: {
            200: { description: 'Inventory item deleted' },
            404: { description: 'Inventory item not found' }
          }
        }
      },
      '/inventory/{id}/photo': {
        get: {
          summary: 'Get inventory item photo',
          parameters: [idParam],
          responses: {
            200: { description: 'JPEG image with item photo' },
            404: { description: 'Item or photo not found' }
          }
        },
        put: {
          summary: 'Update inventory item photo',
          parameters: [idParam],
          requestBody: {
            required: true,
            content: {
              'multipart/form-data': {
                schema: {
                  type: 'object',
                  properties: {
                    photo: {
                      type: 'string',
                      format: 'binary',
                      description: 'New photo file for the item'
                    }
                  },
                  required: ['photo']
                }
              }
            }
          },
          responses: {
            200: { description: 'Item photo updated' },
            400: { description: 'Photo file is missing' },
            404: { description: 'Inventory item not found' }
          }
        }
      },
      '/search': {
        get: {
          summary: 'Search inventory item by ID (query params)',
          parameters: [
            {
              in: 'query',
              name: 'id',
              required: true,
              schema: { type: 'string' },
              description: 'Inventory item ID to search'
            },
            {
              in: 'query',
              name: 'has_photo',
              required: false,
              schema: { type: 'string' },
              description: 'If present, append photo URL to item description when photo exists'
            }
          ],
          responses: {
            200: { description: 'Inventory item found and returned' },
            404: { description: 'Inventory item not found' }
          }
        },
        post: {
          summary: 'Search inventory item by ID (form submission)',
          requestBody: {
            required: true,
            content: {
              'application/x-www-form-urlencoded': {
                schema: {
                  type: 'object',
                  properties: {
                    id: { type: 'string', description: 'Inventory item ID to search' },
                    has_photo: {
                      type: 'string',
                      description:
                        'If present, append photo URL to item description when photo exists'
                    }
                  },
                  required: ['id']
                }
              }
            }
          },
          responses: {
            200: { description: 'Inventory item found and returned' },
            404: { description: 'Inventory item not found' }
          }
        }
      }
    }
  },
  apis: []
};

app.use('/docs', swaggerUi.serve, swaggerUi.setup(swaggerJsdoc(swaggerOptions)));

const guard = (allowed) => (req, res, next) =>
  allowed.includes(req.method) ? next() : res.status(405).send('Method not allowed');

const findItem = (id) => inventory.find((i) => i.id === id);
const photoUrl = (req, item) =>
  item.photoFilename ? `${req.protocol}://${req.get('host')}/inventory/${item.id}/photo` : null;
const dto = (req, item) => ({
  id: item.id,
  inventory_name: item.inventory_name,
  description: item.description,
  photo_url: photoUrl(req, item)
});

app
  .route('/register')
  .all(guard(['POST']))
  .post(upload.single('photo'), (req, res) => {
    const { inventory_name, description } = req.body;
    if (!inventory_name || !inventory_name.trim())
      return res.status(400).json({ error: 'inventory_name is required' });

    const item = {
      id: genId(),
      inventory_name,
      description: description || '',
      photoFilename: req.file?.filename || null
    };

    inventory.push(item);
    saveInventory();
    res.status(201).json(dto(req, item));
  });

app
  .route('/inventory')
  .all(guard(['GET']))
  .get((req, res) => res.json(inventory.map((i) => dto(req, i))));

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
    const { inventory_name, description } = req.body;
    if (inventory_name !== undefined) item.inventory_name = inventory_name;
    if (description !== undefined) item.description = description;
    saveInventory();
    res.json(dto(req, item));
  })
  .delete((req, res) => {
    const idx = inventory.findIndex((i) => i.id === req.params.id);
    if (idx === -1) return res.status(404).json({ error: 'Not found' });
    const [removed] = inventory.splice(idx, 1);
    if (removed.photoFilename) {
      fs.promises.unlink(path.join(PHOTOS_DIR, removed.photoFilename)).catch(() => {});
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
    res.set('Content-Type', 'image/jpeg').sendFile(file);
  })
  .put(upload.single('photo'), (req, res) => {
    const item = findItem(req.params.id);
    if (!item) return res.status(404).json({ error: 'Not found' });
    if (!req.file) return res.status(400).json({ error: 'photo file is required' });

    if (item.photoFilename) {
      fs.promises.unlink(path.join(PHOTOS_DIR, item.photoFilename)).catch(() => {});
    }
    item.photoFilename = req.file.filename;
    saveInventory();
    res.json({ id: item.id, photo_url: photoUrl(req, item), message: 'Photo updated' });
  });

['RegisterForm', 'SearchForm'].forEach((name) => {
  app
    .route(`/${name}.html`)
    .all(guard(['GET']))
    .get((req, res) =>
      res
        .set('Content-Type', 'text/html; charset=utf-8')
        .sendFile(path.join(__dirname, `${name}.html`))
    );
});

const handleSearch = (req, res, params) => {
  const { id, has_photo } = params;

  if (!id) {
    return res.status(400).json({ error: 'id is required' });
  }

  const item = findItem(String(id));
  if (!item) return res.status(404).json({ error: 'Not found' });

  const url = photoUrl(req, item);
  let desc = item.description;

  if (has_photo && url) {
    desc = `${desc}\nPhoto: ${url}`;
    item.description = desc;
    saveInventory();
  }

  res.json({ ...dto(req, item), description: desc });
};

app
  .route('/search')
  .all(guard(['GET', 'POST']))
  .get((req, res) => {
    handleSearch(req, res, req.query); 
  })
  .post((req, res) => {
    handleSearch(req, res, req.body);  
  });

app.use((req, res) => res.status(404).send('Not found'));

app.listen(PORT, HOST, () => {
  console.log(`Server running at http://${HOST}:${PORT}/`);
  console.log(`Cache directory: ${CACHE_DIR}`);
});


