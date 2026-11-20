import { defineConfig } from 'vite';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const rootDir = path.dirname(fileURLToPath(import.meta.url));
const datasetDir = path.resolve(rootDir, '../audio-dataset');

function buildDatasetManifest() {
  if (!fs.existsSync(datasetDir)) return {};

  return Object.fromEntries(
    fs.readdirSync(datasetDir, { withFileTypes: true })
      .filter(entry => entry.isDirectory())
      .sort((a, b) => a.name.localeCompare(b.name))
      .map(entry => {
        const mp3Dir = path.join(datasetDir, entry.name, 'mp3');
        const files = fs.existsSync(mp3Dir)
          ? fs.readdirSync(mp3Dir).filter(file => file.toLowerCase().endsWith('.mp3')).sort()
          : [];
        return [entry.name, files];
      })
  );
}

function datasetManifestPlugin() {
  return {
    name: 'attune-dataset-manifest',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        if (req.url !== '/audio-dataset-manifest.json') {
          next();
          return;
        }
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify(buildDatasetManifest()));
      });
    },
    generateBundle() {
      this.emitFile({
        type: 'asset',
        fileName: 'audio-dataset-manifest.json',
        source: JSON.stringify(buildDatasetManifest())
      });
    }
  };
}

export default defineConfig({
  publicDir: '../audio-dataset',
  plugins: [datasetManifestPlugin()]
});
