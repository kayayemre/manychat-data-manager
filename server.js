const express = require("express");
const cors = require("cors");
const helmet = require("helmet");
const rateLimit = require("express-rate-limit");
require('dotenv').config(); // Bu satır eklendi
const { createTables, testConnection, runQuery, allQuery, getQuery } = require("./config/database");
const ManyChatFetcher = require('./fetchManyChat'); // Veri çekme sistemi

const app = express();
const port = process.env.PORT || 3000;

// ManyChat veri çekme instance
let manyChatFetcher;

const app = express();
const port = process.env.PORT || 3000;

// Auto Migration Function
async function autoMigrate() {
  try {
    console.log('🔄 Otomatik migration kontrol ediliyor...');
    
    // Users tablosunda role kolonu var mı kontrol et
    const tableInfo = await allQuery("PRAGMA table_info(users)");
    const hasRoleColumn = tableInfo.some(column => column.name === 'role');

    if (!hasRoleColumn && tableInfo.length > 0) {
      console.log('📝 Production migration başlatılıyor...');
      
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

      // Eski verileri kopyala
      const oldUsers = await allQuery("SELECT * FROM users");
      
      for (const user of oldUsers) {
        const role = user.id === 1 ? 'admin' : 'user';
        await runQuery(`
          INSERT INTO users_new (id, username, password, role, created_at)
          VALUES (?, ?, ?, ?, ?)
        `, [user.id, user.username, user.password, role, user.created_at]);
      }

      // Eski tabloyu sil ve yeni tabloyu isimlendir
      await runQuery("DROP TABLE users");
      await runQuery("ALTER TABLE users_new RENAME TO users");
      
      console.log('✅ Users tablosu otomatik güncellendi');
    }

    // Status logs tablosunu kontrol et
    const tablesResult = await allQuery(`
      SELECT name FROM sqlite_master 
      WHERE type='table' AND name='status_logs'
    `);

    if (tablesResult.length === 0) {
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
      console.log('✅ Status logs tablosu otomatik oluşturuldu');
    }

    console.log('✅ Otomatik migration tamamlandı');
    
  } catch (error) {
    console.error('❌ Otomatik migration hatası:', error);
    throw error;
  }
}

// Security middleware
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'", "https://cdnjs.cloudflare.com"],
      scriptSrc: ["'self'", "'unsafe-inline'", "'unsafe-eval'"],
      scriptSrcAttr: ["'unsafe-inline'"], // Bu satırı ekledik
      fontSrc: ["'self'", "https://cdnjs.cloudflare.com"],
      imgSrc: ["'self'", "data:", "https:"],
      connectSrc: ["'self'"],
      objectSrc: ["'none'"],
      mediaSrc: ["'self'"],
      frameSrc: ["'none'"],
    },
  },
}));

// CORS middleware
app.use(cors({
  origin: process.env.NODE_ENV === 'production' 
    ? ['https://your-domain.com'] 
    : ['http://localhost:3000', 'http://127.0.0.1:3000'],
  credentials: true
}));

// Rate limiting
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 dakika
  max: 100, // IP başına maksimum istek
  message: {
    error: "Çok fazla istek gönderildi, lütfen 15 dakika sonra tekrar deneyin."
  }
});

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 dakika
  max: 5, // IP başına maksimum giriş denemesi
  message: {
    error: "Çok fazla giriş denemesi, lütfen 15 dakika sonra tekrar deneyin."
  }
});

app.use(limiter);
app.use('/api/auth/login', authLimiter);

// Body parser middleware
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Statik dosyalar
app.use(express.static("public"));

// Routes
const authRoutes = require("./routes/auth");
const dataRoutes = require("./routes/data");

app.use("/api/auth", authRoutes);
app.use("/api/data", dataRoutes);

// Ana route
app.get("/", (req, res) => {
  res.sendFile(__dirname + "/public/index.html");
});

// Manuel veri çekme endpoint
app.get("/api/fetch-data", async (req, res) => {
  try {
    if (!manyChatFetcher) {
      return res.status(500).json({ 
        success: false, 
        message: "Veri çekme sistemi başlatılmamış" 
      });
    }
    
    const result = await manyChatFetcher.manualFetch();
    res.json({ 
      success: true, 
      message: "Veri çekme tamamlandı",
      data: result
    });
  } catch (error) {
    res.status(500).json({ 
      success: false, 
      message: error.message 
    });
  }
});

// Health check endpoint
app.get("/health", (req, res) => {
  res.json({ 
    status: "OK", 
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    manychat_fetcher: manyChatFetcher ? "Active" : "Inactive"
  });
});

// 404 handler
app.use((req, res) => {
  res.status(404).json({ 
    success: false, 
    message: "Endpoint bulunamadı" 
  });
});

// Error handler
app.use((err, req, res, next) => {
  console.error("Server error:", err);
  res.status(500).json({ 
    success: false, 
    message: process.env.NODE_ENV === 'production' 
      ? "Sunucu hatası" 
      : err.message 
  });
});

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('SIGTERM alındı, sunucu kapatılıyor...');
  process.exit(0);
});

process.on('SIGINT', () => {
  console.log('SIGINT alındı, sunucu kapatılıyor...');
  process.exit(0);
});

// Sunucuyu başlat
async function startServer() {
  try {
    // Veritabanı bağlantısını test et
    await testConnection();
    
    // Otomatik migration
    await autoMigrate();
    
    // Tabloları oluştur
    await createTables();
    
    // Sunucuyu başlat
    app.listen(port, () => {
      console.log(`✅ Sunucu ${port} portunda çalışıyor`);
      console.log(`🌐 URL: http://localhost:${port}`);
      console.log(`📊 Health Check: http://localhost:${port}/health`);
      console.log(`🔒 Güvenlik middleware'leri aktif`);
      
      // ManyChat veri çekme sistemini başlat
      if (process.env.MANYCHAT_API_TOKEN) {
        manyChatFetcher = new ManyChatFetcher();
        manyChatFetcher.start();
        console.log(`🔄 ManyChat veri çekme sistemi başlatıldı`);
      } else {
        console.log(`⚠️  ManyChat API token bulunamadı, veri çekme devre dışı`);
      }
    });
    
  } catch (error) {
    console.error('❌ Sunucu başlatma hatası:', error);
    process.exit(1);
  }
}

startServer();