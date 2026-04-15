import Database from "better-sqlite3";

const db = new Database(process.env.APPDATA ? process.env.APPDATA + "\\executor\\data.db" : require('os').homedir() + "/.config/executor/data.db");
const rows = db.prepare("SELECT * FROM kv WHERE namespace LIKE '%openapi.bindings%' AND key LIKE '%github%' LIMIT 1").all();
console.log(JSON.stringify(rows, null, 2));
