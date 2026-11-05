const db = require('../db');

const DEFAULT_SETTINGS = {
  canteen_name: 'QuickBite Canteen',
  qr_base_url: ''
};

async function getSettings(keys = Object.keys(DEFAULT_SETTINGS)) {
  if (keys.length === 0) {
    return { ...DEFAULT_SETTINGS };
  }

  const placeholders = keys.map(() => '?').join(', ');
  const rows = await db.query(
    `SELECT setting_key, setting_value FROM settings WHERE setting_key IN (${placeholders})`,
    keys
  );

  const settings = { ...DEFAULT_SETTINGS };
  for (const row of rows) {
    settings[row.setting_key] = row.setting_value ?? '';
  }

  return Object.fromEntries(keys.map((key) => [key, settings[key] ?? '']));
}

async function updateSettings(updates) {
  const entries = Object.entries(updates);

  await db.withTransaction(async (connection) => {
    for (const [key, value] of entries) {
      await connection.execute(
        `INSERT INTO settings (setting_key, setting_value)
         VALUES (?, ?)
         ON DUPLICATE KEY UPDATE setting_value = VALUES(setting_value)`,
        [key, value]
      );
    }
  });

  return getSettings(entries.map(([key]) => key));
}

module.exports = {
  DEFAULT_SETTINGS,
  getSettings,
  updateSettings
};
