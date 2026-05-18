import { readFileSync } from 'fs';

globalThis.__MODELS_CONFIG__ = JSON.parse(readFileSync('./models.json', 'utf-8'));
