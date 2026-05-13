
const initSqlJs = require('sql.js');
const fs = require('fs');
const path = require('path');

async function run() {
    const SQL = await initSqlJs();
    const dbPath = './data/buddy.db';
    if (!fs.existsSync(dbPath)) {
        console.error("DB not found at " + dbPath);
        process.exit(1);
    }
    const buf = fs.readFileSync(dbPath);
    const db = new SQL.Database(buf);

    console.log("== Competency Vector (last 3) ==");
    const cv = db.exec("SELECT * FROM competency_vector ORDER BY id DESC LIMIT 3");
    console.log(JSON.stringify(cv, null, 2));

    console.log("\n== Turn Annotations (last 3) ==");
    const ta = db.exec("SELECT * FROM turn_annotations ORDER BY id DESC LIMIT 3");
    console.log(JSON.stringify(ta, null, 2));

    console.log("\n== Vocabulary Items Count ==");
    const vic = db.exec("SELECT COUNT(*) FROM vocabulary_items");
    console.log(JSON.stringify(vic, null, 2));
    
    console.log("\n== Error Log (last 3) ==");
    const el = db.exec("SELECT * FROM error_log ORDER BY id DESC LIMIT 3");
    console.log(JSON.stringify(el, null, 2));

    console.log("\n== Table info for vocabulary_items ==");
    const ti = db.exec("PRAGMA table_info(vocabulary_items)");
    console.log(JSON.stringify(ti, null, 2));
}

run().catch(console.error);
