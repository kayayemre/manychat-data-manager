const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const path = require('path');
require('dotenv').config();

const db = require('./config/database');
const authRoutes = require('./routes/auth');
const dataRoutes = require('./routes/data');
const { startDataFetching } = require('./services/manychatService');

const app = express();
const PORT = process.env.PORT || 3000;

// Güvenlik middleware'leri
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "'unsafe-inline'"],
      scriptSrcAttr: ["'unsafe-inline'"], // Bu satırı ekleyin
      styleSrc: ["'self'", "'unsafe-inline'", "https://cdnjs.cloudflare.com"],
      fontSrc: ["'self'", "https://cdnjs.cloudflare.com"]
    }
  }
}));
app.use(cors());

// Rate limiting
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 dakika
  max: 100 // IP başına maksimum 100 istek
});
app.use(limiter);

// Body parser
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Statik dosyalar
app.use(express.static(path.join(__dirname, 'public')));

// Routes
app.use('/api/auth', authRoutes);
app.use('/api/data', dataRoutes);

// Ana sayfa
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Veritabanı bağlantısını test et
async function initializeApp() {
  try {
    await db.testConnection();
    console.log('✅ Veritabanı bağlantısı başarılı');
    
    // Tabloları oluştur
    await db.createTables();
    console.log('✅ Veritabanı tabloları hazır');
    
    // ManyChat veri çekme servisini başlat
    startDataFetching();
    console.log('✅ ManyChat veri çekme servisi başlatıldı');
    
    // Sunucuyu başlat
    app.listen(PORT, () => {
      console.log(`🚀 Sunucu http://localhost:${PORT} adresinde çalışıyor`);
    });
    
  } catch (error) {
    console.error('❌ Uygulama başlatılırken hata:', error);
    process.exit(1);
  }
}

// Uygulamayı başlat
initializeApp();

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('Sunucu kapatılıyor...');
  process.exit(0);
});

process.on('SIGINT', () => {
  console.log('Sunucu kapatılıyor...');
  process.exit(0);
});