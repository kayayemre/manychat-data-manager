const sqlite3 = require('sqlite3').verbose();
const path = require('path');

// Veritabanı dosya yolu
const dbPath = process.env.DB_PATH || './database.db';

// Veritabanı bağlantısı
const db = new sqlite3.Database(dbPath, (err) => {
  if (err) {
    console.error('SQLite bağlantı hatası:', err.message);
  } else {
    console.log('✅ SQLite veritabanına bağlandı');
  }
});

// Veritabanı bağlantısını test et
async function testConnection() {
  return new Promise((resolve, reject) => {
    db.get("SELECT datetime('now') as current_time", (err, row) => {
      if (err) {
        reject(err);
      } else {
        console.log('✅ Veritabanı bağlantısı test edildi:', row.current_time);
        resolve(true);
      }
    });
  });
}

// Tabloları oluştur
async function createTables() {
  return new Promise(async (resolve, reject) => {
    try {
      // Kullanıcılar tablosu
      await runQuery(`
        CREATE TABLE IF NOT EXISTS users (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          username TEXT UNIQUE NOT NULL,
          password TEXT NOT NULL,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )
      `);

      // ManyChat verileri tablosu
await runQuery(`
  CREATE TABLE IF NOT EXISTS manychat_data (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    subscriber_id TEXT NOT NULL UNIQUE,
    first_name TEXT,
    last_name TEXT,
    profile_pic TEXT,
    locale TEXT,
    timezone TEXT,
    gender TEXT,
    phone TEXT,
    email TEXT,
    whatsapp_phone TEXT,
    subscribed_at DATETIME,
    last_interaction DATETIME,
    status TEXT DEFAULT 'ARANMADI',
    otel_adi TEXT,
    conditions TEXT,
    cevap_fiyat1 TEXT,
    raw_data TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )
`);

      // Trigger oluştur (SQLite'da biraz farklı)
      await runQuery(`
        CREATE TRIGGER IF NOT EXISTS update_manychat_data_updated_at 
        AFTER UPDATE ON manychat_data
        BEGIN
          UPDATE manychat_data SET updated_at = CURRENT_TIMESTAMP 
          WHERE id = NEW.id;
        END;
      `);

      // Varsayılan kullanıcı oluştur
      const bcrypt = require('bcryptjs');
      const hashedPassword = await bcrypt.hash('admin123', 10);
      
      await runQuery(`
        INSERT OR IGNORE INTO users (username, password) 
        VALUES (?, ?)
      `, ['admin', hashedPassword]);

      console.log('✅ Varsayılan kullanıcı oluşturuldu: admin/admin123');
      console.log('✅ Tüm tablolar hazır');
      resolve();
      
    } catch (error) {
      console.error('Tablo oluşturma hatası:', error);
      reject(error);
    }
  });
}

// Query çalıştırma yardımcı fonksiyonu
function runQuery(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function(err) {
      if (err) {
        reject(err);
      } else {
        resolve({ lastID: this.lastID, changes: this.changes });
      }
    });
  });
}

// Select sorguları için
function allQuery(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => {
      if (err) {
        reject(err);
      } else {
        resolve(rows);
      }
    });
  });
}

// Tek kayıt için
function getQuery(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => {
      if (err) {
        reject(err);
      } else {
        resolve(row);
      }
    });
  });
}

// Veritabanını kapat
function closeDatabase() {
  return new Promise((resolve) => {
    db.close((err) => {
      if (err) {
        console.error('Veritabanı kapatma hatası:', err.message);
      } else {
        console.log('✅ Veritabanı bağlantısı kapatıldı');
      }
      resolve();
    });
  });
}

module.exports = {
  db,
  testConnection,
  createTables,
  runQuery,
  allQuery,
  getQuery,
  closeDatabase
};