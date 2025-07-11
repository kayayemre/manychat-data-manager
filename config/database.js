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
      // Users tablosunda role kolonu var mı kontrol et
      const tableInfo = await allQuery("PRAGMA table_info(users)");
      const hasRoleColumn = tableInfo.some(column => column.name === 'role');

      if (!hasRoleColumn && tableInfo.length > 0) {
        console.log('⚠️  Mevcut veritabanı tespit edildi ancak role kolonu eksik!');
        console.log('🔧 Lütfen migration script çalıştırın: node migrate.js');
        throw new Error('Veritabanı migration gerekli. "node migrate.js" komutunu çalıştırın.');
      }

      // Kullanıcılar tablosu - role alanı eklendi
      await runQuery(`
        CREATE TABLE IF NOT EXISTS users (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          username TEXT UNIQUE NOT NULL,
          password TEXT NOT NULL,
          role TEXT DEFAULT 'user' CHECK(role IN ('admin', 'user')),
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )
      `);

      // ManyChat verileri tablosu - güncellendi
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

      // Status log tablosu - yeni
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

      // Trigger oluştur (SQLite'da biraz farklı)
      await runQuery(`
        CREATE TRIGGER IF NOT EXISTS update_manychat_data_updated_at 
        AFTER UPDATE ON manychat_data
        BEGIN
          UPDATE manychat_data SET updated_at = CURRENT_TIMESTAMP 
          WHERE id = NEW.id;
        END;
      `);

      // Varsayılan admin kullanıcı oluştur (sadece tablo boşsa)
      const userCount = await getQuery("SELECT COUNT(*) as count FROM users");
      
      if (userCount.count === 0) {
        const bcrypt = require('bcryptjs');
        const hashedPassword = await bcrypt.hash('admin123', 10);
        
        await runQuery(`
          INSERT INTO users (username, password, role) 
          VALUES (?, ?, ?)
        `, ['admin', hashedPassword, 'admin']);

        console.log('✅ Varsayılan admin kullanıcı oluşturuldu: admin/admin123');
      }
      
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

// Türkiye saatini al
function getTurkeyTime() {
  const now = new Date();
  const turkeyTime = new Date(now.toLocaleString("en-US", {timeZone: "Europe/Istanbul"}));
  return turkeyTime.toISOString().slice(0, 19).replace('T', ' ');
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
  getTurkeyTime,
  closeDatabase
};