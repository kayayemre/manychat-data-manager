const sqlite3 = require('sqlite3').verbose();
const bcrypt = require('bcryptjs');
require('dotenv').config();

// Veritabanı dosya yolu
const dbPath = process.env.DB_PATH || './database.db';

// Migration fonksiyonu
async function runMigration() {
  const db = new sqlite3.Database(dbPath, (err) => {
    if (err) {
      console.error('SQLite bağlantı hatası:', err.message);
      process.exit(1);
    } else {
      console.log('✅ Migration için SQLite veritabanına bağlandı');
    }
  });

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

  // Tüm kayıtlar için
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

  try {
    console.log('🔄 Migration başlatılıyor...');

    // 1. Users tablosunda role kolonu var mı kontrol et
    const tableInfo = await allQuery("PRAGMA table_info(users)");
    const hasRoleColumn = tableInfo.some(column => column.name === 'role');

    if (!hasRoleColumn) {
      console.log('📝 Users tablosuna role kolonu ekleniyor...');
      
      // Yeni users tablosu oluştur
      await runQuery(`
        CREATE TABLE users_new (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          username TEXT UNIQUE NOT NULL,
          password TEXT NOT NULL,
          role TEXT DEFAULT 'user' CHECK(role IN ('admin', 'user')),
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )
      `);

      // Eski verileri kopyala (admin rolü ile)
      const oldUsers = await allQuery("SELECT * FROM users");
      
      for (const user of oldUsers) {
        // İlk kullanıcıyı admin yap, diğerlerini user
        const role = user.id === 1 ? 'admin' : 'user';
        
        await runQuery(`
          INSERT INTO users_new (id, username, password, role, created_at)
          VALUES (?, ?, ?, ?, ?)
        `, [user.id, user.username, user.password, role, user.created_at]);
      }

      // Eski tabloyu sil ve yeni tabloyu isimlendir
      await runQuery("DROP TABLE users");
      await runQuery("ALTER TABLE users_new RENAME TO users");
      
      console.log('✅ Users tablosu güncellendi');
    } else {
      console.log('✅ Users tablosunda role kolonu zaten mevcut');
    }

    // 2. Status logs tablosunu kontrol et ve oluştur
    const tablesResult = await allQuery(`
      SELECT name FROM sqlite_master 
      WHERE type='table' AND name='status_logs'
    `);

    if (tablesResult.length === 0) {
      console.log('📝 Status logs tablosu oluşturuluyor...');
      
      await runQuery(`
        CREATE TABLE status_logs (
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
      
      console.log('✅ Status logs tablosu oluşturuldu');
    } else {
      console.log('✅ Status logs tablosu zaten mevcut');
    }

    // 3. Admin kullanıcı kontrolü
    const adminUser = await getQuery("SELECT * FROM users WHERE username = 'admin'");
    
    if (!adminUser) {
      console.log('📝 Admin kullanıcısı oluşturuluyor...');
      
      const hashedPassword = await bcrypt.hash('admin123', 10);
      await runQuery(`
        INSERT INTO users (username, password, role) 
        VALUES (?, ?, ?)
      `, ['admin', hashedPassword, 'admin']);
      
      console.log('✅ Admin kullanıcısı oluşturuldu (admin/admin123)');
    } else {
      // Mevcut admin kullanıcısının rolünü güncelle
      await runQuery(`
        UPDATE users SET role = 'admin' WHERE username = 'admin'
      `);
      console.log('✅ Admin kullanıcısının rolü güncellendi');
    }

    // 4. Trigger'ları kontrol et ve oluştur
    const triggers = await allQuery(`
      SELECT name FROM sqlite_master 
      WHERE type='trigger' AND name='update_manychat_data_updated_at'
    `);

    if (triggers.length === 0) {
      console.log('📝 Trigger oluşturuluyor...');
      
      await runQuery(`
        CREATE TRIGGER update_manychat_data_updated_at 
        AFTER UPDATE ON manychat_data
        BEGIN
          UPDATE manychat_data SET updated_at = CURRENT_TIMESTAMP 
          WHERE id = NEW.id;
        END;
      `);
      
      console.log('✅ Trigger oluşturuldu');
    } else {
      console.log('✅ Trigger zaten mevcut');
    }

    console.log('🎉 Migration başarıyla tamamlandı!');

    // Veritabanını kapat
    db.close((err) => {
      if (err) {
        console.error('Veritabanı kapatma hatası:', err.message);
      } else {
        console.log('✅ Veritabanı bağlantısı kapatıldı');
      }
      process.exit(0);
    });

  } catch (error) {
    console.error('❌ Migration hatası:', error);
    
    db.close((err) => {
      if (err) {
        console.error('Veritabanı kapatma hatası:', err.message);
      }
      process.exit(1);
    });
  }
}

// Migration'ı çalıştır
runMigration();