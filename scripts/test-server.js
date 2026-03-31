import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = 3001;

const scenarios = {
  'major': 'test-updates.json',
  'patch-only': 'test-updates-patch-only.json',
  'empty': 'test-updates-empty.json',
  'invalid': 'test-updates-invalid.json',
};

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  const scenario = url.searchParams.get('scenario') || 'major';

  console.log(`[${new Date().toISOString()}] Request: ${req.method} ${req.url} (scenario: ${scenario})`);

  if (req.method !== 'GET') {
    res.writeHead(405, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Method not allowed' }));
    return;
  }

  const filename = scenarios[scenario];
  if (!filename) {
    res.writeHead(400, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      error: `Unknown scenario: ${scenario}`,
      available: Object.keys(scenarios),
    }));
    return;
  }

  const filePath = path.join(__dirname, filename);

  try {
    const data = fs.readFileSync(filePath, 'utf-8');
    res.writeHead(200, {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
    });
    res.end(data);
  } catch (err) {
    console.error(`Error reading ${filePath}:`, err);
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Failed to read test file' }));
  }
});

server.listen(PORT, () => {
  console.log(`Test updates server running on http://localhost:${PORT}`);
  console.log('');
  console.log('Available scenarios:');
  console.log(`  ?scenario=major        - Major + minor releases (v99.0.0, v98.5.0)`);
  console.log(`  ?scenario=patch-only   - Patch release only (should NOT notify)`);
  console.log(`  ?scenario=empty        - Empty releases array`);
  console.log(`  ?scenario=invalid      - Invalid version string`);
  console.log('');
  console.log('Examples:');
  console.log(`  curl http://localhost:${PORT}/test-updates.json`);
  console.log(`  curl http://localhost:${PORT}/test-updates.json?scenario=patch-only`);
});
