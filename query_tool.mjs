import Database from 'better-sqlite3';
import os from 'os';
import path from 'path';

const dbPath = path.join(os.homedir(), '.executor', 'data.db');
const db = new Database(dbPath);
const rows = db.prepare("SELECT * FROM kv WHERE namespace LIKE '%secrets%' LIMIT 10").all();
console.log(JSON.stringify(rows, null, 2));
db.close();
