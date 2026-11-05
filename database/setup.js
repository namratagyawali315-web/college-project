'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { createRequire } = require('node:module');

const backendDir = path.resolve(__dirname, '..', 'backend');
const envPath = path.join(backendDir, '.env');
const backendRequire = createRequire(path.join(backendDir, 'package.json'));
const mysql = backendRequire('mysql2/promise');
const bcrypt = backendRequire('bcryptjs');

if (!fs.existsSync(envPath)) {
  throw new Error('Missing backend/.env. Copy backend/.env.example to backend/.env first.');
}

const config = backendRequire('./config');
const { host, port, user, password, database } = config.db;
const adminUsername = String(config.adminSeed.username || '').trim();
const adminPassword = String(config.adminSeed.password || '');
const adminDisplayName = String(config.adminSeed.displayName || '').trim();

if (!/^[A-Za-z0-9_]+$/.test(database)) {
  throw new Error('DB_NAME may only contain letters, numbers, and underscores.');
}

if (!adminUsername || adminUsername.length > 50) {
  throw new Error('ADMIN_USERNAME must be between 1 and 50 characters.');
}

if (adminPassword.length < 8 || adminPassword.length > 128) {
  throw new Error('ADMIN_PASSWORD must be between 8 and 128 characters.');
}

if (!adminDisplayName || adminDisplayName.length > 100) {
  throw new Error('ADMIN_DISPLAY_NAME must be between 1 and 100 characters.');
}

function readSql(filename) {
  return fs.readFileSync(path.join(__dirname, filename), 'utf8');
}

async function main() {
  const schemaSql = readSql('schema.sql');
  const seedSql = readSql('seed.sql');
  let connection;

  try {
    connection = await mysql.createConnection({
      host,
      port,
      user,
      password,
      charset: 'utf8mb4',
      multipleStatements: true
    });

    await connection.query(
      `CREATE DATABASE IF NOT EXISTS \`${database}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`
    );
    await connection.query(`USE \`${database}\``);
    await connection.query(schemaSql);

    let seeded = false;
    let adminCreated = false;

    try {
      await connection.beginTransaction();

      const [beforeRows] = await connection.query(
        `SELECT
           (SELECT COUNT(*) FROM categories) AS category_count,
           (SELECT COUNT(*) FROM menu_items) AS menu_item_count,
           (SELECT COUNT(*) FROM dining_tables) AS table_count`
      );
      const before = beforeRows[0];

      if (
        Number(before.category_count) === 0 &&
        Number(before.menu_item_count) === 0 &&
        Number(before.table_count) === 0
      ) {
        await connection.query(seedSql);
        seeded = true;
      }

      await connection.execute(
        `INSERT IGNORE INTO settings (setting_key, setting_value) VALUES (?, ?), (?, ?)`,
        ['canteen_name', 'QuickBite Canteen', 'qr_base_url', '']
      );

      const [adminRows] = await connection.query('SELECT id FROM admins LIMIT 1');
      if (adminRows.length === 0) {
        const passwordHash = await bcrypt.hash(adminPassword, 12);
        await connection.execute(
          `INSERT INTO admins (username, password_hash, display_name, token_version)
           VALUES (?, ?, ?, 1)`,
          [adminUsername, passwordHash, adminDisplayName]
        );
        adminCreated = true;
      }

      await connection.commit();
    } catch (error) {
      try {
        await connection.rollback();
      } catch {
      }
      throw error;
    }

    const [countRows] = await connection.query(
      `SELECT
         (SELECT COUNT(*) FROM categories) AS category_count,
         (SELECT COUNT(*) FROM menu_items) AS menu_item_count,
         (SELECT COUNT(*) FROM dining_tables) AS table_count,
         (SELECT COUNT(*) FROM admins) AS admin_count`
    );
    const counts = countRows[0];

    console.log(`Database ready: ${database} at ${host}:${port}`);
    console.log(seeded ? 'Sample menu and tables inserted.' : 'Existing sample data kept; seed skipped.');
    console.log(
      adminCreated
        ? `Admin account created: ${adminUsername}`
        : 'Admin account already exists; admin seed skipped.'
    );
    console.log(
      `Rows: ${counts.category_count} categories, ${counts.menu_item_count} menu items, ` +
        `${counts.table_count} tables, ${counts.admin_count} admins.`
    );
  } finally {
    if (connection) {
      await connection.end();
    }
  }
}

main().catch((error) => {
  console.error(`Database setup failed: ${error.message}`);
  if (error.code === 'ECONNREFUSED') {
    console.error('Start MySQL from XAMPP, then run the setup again.');
  }
  process.exitCode = 1;
});
