const sqlite3 = require('sqlite3').verbose();
const path = require('path');
require('dotenv').config();

// Veritabanı dosya yolu
const dbPath = process.env.DB_PATH || './database.db';

// Veritabanı bağlantısı
let db;

// Veritabanı başlatma
async function initDatabase() {
  return new Promise((resolve, reject) => {
    db = new sqlite3.Database(dbPath, (err) => {
      if (err) {
        console.error('SQLite bağlantı hatası:', err.message);
        reject(err);
      } else {
        console.log('✅ SQLite veritabanına bağlandı');
        
        // Tabloları oluştur
        createTables()
          .then(() => {
            console.log('✅ Veritabanı tabloları hazır');
            resolve();
          })
          .catch(reject);
      }
    });
  });
}

// Tabloları oluştur
async function createTables() {
  // Users tablosu
  await runQuery(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT UNIQUE NOT NULL,
      password TEXT NOT NULL,
      role TEXT DEFAULT 'user' CHECK(role IN ('admin', 'user')),
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // ManyChat data tablosu
  await runQuery(`
    CREATE TABLE IF NOT EXISTS manychat_data (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      subscriber_id INTEGER UNIQUE NOT NULL,
      first_name TEXT,
      last_name TEXT,
      profile_pic TEXT,
      locale TEXT,
      timezone TEXT,
      gender TEXT,
      phone TEXT,
      email TEXT,
      whatsapp_phone TEXT,
      subscribed_at TEXT,
      last_interaction TEXT,
      otel_adi TEXT,
      conditions TEXT,
      cevap_fiyat1 TEXT,
      status TEXT DEFAULT 'pending' CHECK(status IN ('pending', 'called', 'not_interested', 'interested', 'booked')),
      raw_data TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // Status logs tablosu
  await runQuery(`
    CREATE TABLE IF NOT EXISTS status_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      subscriber_id INTEGER NOT NULL,
      user_id INTEGER NOT NULL,
      old_status TEXT,
      new_status TEXT,
      changed_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (subscriber_id) REFERENCES manychat_data(id),
      FOREIGN KEY (user_id) REFERENCES users(id)
    )
  `);

  // Trigger oluştur
  await runQuery(`
    CREATE TRIGGER IF NOT EXISTS update_manychat_data_updated_at 
    AFTER UPDATE ON manychat_data
    BEGIN
      UPDATE manychat_data SET updated_at = CURRENT_TIMESTAMP 
      WHERE id = NEW.id;
    END;
  `);
}

// Query çalıştırma yardımcı fonksiyonu
function runQuery(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function(err) {
      if (err) {
        console.error('Query hatası:', err.message);
        reject(err);
      } else {
        resolve({ lastID: this.lastID, changes: this.changes });
      }
    });
  });
}

// Tek kayıt için
function getQuery(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => {
      if (err) {
        console.error('Get query hatası:', err.message);
        reject(err);
      } else {
        resolve(row);
      }
    });
  });
}

// Tüm kayıtlar için
function allQuery(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => {
      if (err) {
        console.error('All query hatası:', err.message);
        reject(err);
      } else {
        resolve(rows);
      }
    });
  });
}

// Türkiye saati
function getTurkeyTime() {
  const now = new Date();
  const turkeyTime = new Date(now.getTime() + (3 * 60 * 60 * 1000)); // UTC+3
  return turkeyTime.toISOString().replace('T', ' ').substr(0, 19);
}

// Veritabanı kapatma
function closeDatabase() {
  return new Promise((resolve, reject) => {
    if (db) {
      db.close((err) => {
        if (err) {
          console.error('Veritabanı kapatma hatası:', err.message);
          reject(err);
        } else {
          console.log('✅ Veritabanı bağlantısı kapatıldı');
          resolve();
        }
      });
    } else {
      resolve();
    }
  });
}

// Graceful shutdown
process.on('SIGINT', async () => {
  console.log('\n🔄 Sunucu kapatılıyor...');
  await closeDatabase();
  process.exit(0);
});

process.on('SIGTERM', async () => {
  console.log('\n🔄 Sunucu kapatılıyor...');
  await closeDatabase();
  process.exit(0);
});

module.exports = {
  initDatabase,
  runQuery,
  getQuery,
  allQuery,
  getTurkeyTime,
  closeDatabase
};