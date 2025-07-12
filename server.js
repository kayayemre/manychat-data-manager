const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const path = require('path');
require('dotenv').config();

// Rate limiting middleware'leri import et
const {
  generalRateLimit,
  searchStatusRateLimit,
  manualFetchRateLimit
} = require('./middleware/rateLimiter');

const { initDatabase, runQuery, getQuery, allQuery } = require('./config/database');
const ManyChatFetcher = require('./fetchManyChat');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware'ler
app.use(helmet());
app.use(cors());
app.use(express.json());

// Static dosyalar (public klasörü)
app.use(express.static(path.join(__dirname, 'public')));

// Genel rate limiting (tüm istekler için)
app.use(generalRateLimit);

// Ana sayfa route'u - ÖNEMLİ!
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// JWT token doğrulama middleware
const authenticateToken = (req, res, next) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) {
    return res.status(401).json({ error: 'Token gerekli' });
  }

  jwt.verify(token, process.env.JWT_SECRET, (err, user) => {
    if (err) {
      return res.status(403).json({ error: 'Geçersiz token' });
    }
    req.user = user;
    next();
  });
};

// Admin yetki kontrolü
const requireAdmin = (req, res, next) => {
  if (req.user?.role !== 'admin') {
    return res.status(403).json({ error: 'Bu işlem için admin yetkisi gerekli' });
  }
  next();
};

// Login endpoint
app.post('/api/auth/login', async (req, res) => {
  try {
    const { username, password } = req.body;
    
    const user = await getQuery('SELECT * FROM users WHERE username = ?', [username]);
    if (!user) {
      return res.status(401).json({ 
        success: false, 
        message: 'Kullanıcı adı veya şifre hatalı' 
      });
    }

    const isValid = await bcrypt.compare(password, user.password);
    if (!isValid) {
      return res.status(401).json({ 
        success: false, 
        message: 'Kullanıcı adı veya şifre hatalı' 
      });
    }

    const token = jwt.sign(
      { id: user.id, username: user.username, role: user.role },
      process.env.JWT_SECRET,
      { expiresIn: '24h' }
    );

    res.json({ 
      success: true,
      token, 
      user: { 
        id: user.id, 
        username: user.username, 
        role: user.role 
      } 
    });
  } catch (error) {
    console.error('Login hatası:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Sunucu hatası' 
    });
  }
});

// İstatistikler endpoint
app.get('/api/data/stats', authenticateToken, async (req, res) => {
  try {
    // Genel istatistikler
    const totalSubs = await getQuery('SELECT COUNT(*) as count FROM manychat_data');
    const totalCalled = await getQuery("SELECT COUNT(*) as count FROM manychat_data WHERE status = 'ARANDI'");
    
    // Bugünkü istatistikler
    const today = new Date().toISOString().split('T')[0];
    const newToday = await getQuery(
      'SELECT COUNT(*) as count FROM manychat_data WHERE DATE(created_at) = ?', 
      [today]
    );
    const calledToday = await getQuery(
      "SELECT COUNT(*) as count FROM manychat_data WHERE status = 'ARANDI' AND DATE(updated_at) = ?", 
      [today]
    );

    // Kullanıcı istatistikleri (bugün)
    const userStatsToday = await allQuery(`
      SELECT u.username, COUNT(*) as call_count_today
      FROM status_logs sl
      JOIN users u ON sl.user_id = u.id
      WHERE DATE(sl.changed_at) = ? AND sl.new_status = 'ARANDI'
      GROUP BY u.id, u.username
      ORDER BY call_count_today DESC
    `, [today]);

    // Kullanıcı istatistikleri (genel)
    const userStatsTotal = await allQuery(`
      SELECT u.username, COUNT(*) as call_count_total
      FROM status_logs sl
      JOIN users u ON sl.user_id = u.id
      WHERE sl.new_status = 'ARANDI'
      GROUP BY u.id, u.username
      ORDER BY call_count_total DESC
    `);

    const stats = {
      totalSubscribers: totalSubs.count,
      totalCalled: totalCalled.count,
      callRate: totalSubs.count > 0 ? Math.round((totalCalled.count / totalSubs.count) * 100) : 0,
      newToday: newToday.count,
      calledToday: calledToday.count,
      todayCallRate: newToday.count > 0 ? Math.round((calledToday.count / newToday.count) * 100) : 0,
      userStatsToday,
      userStatsTotal
    };

    res.json({ success: true, data: stats });
  } catch (error) {
    console.error('İstatistik hatası:', error);
    res.status(500).json({ 
      success: false, 
      message: 'İstatistikler alınamadı' 
    });
  }
});

// Subscriber listesi endpoint
app.get('/api/data/subscribers', authenticateToken, async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 20;
    const offset = (page - 1) * limit;
    
    const search = req.query.search || '';
    const status = req.query.status || '';
    
    let whereClause = '';
    let params = [];
    
    if (search) {
      whereClause += ' WHERE (first_name LIKE ? OR last_name LIKE ? OR whatsapp_phone LIKE ?)';
      params.push(`%${search}%`, `%${search}%`, `%${search}%`);
    }
    
    if (status) {
      whereClause += search ? ' AND' : ' WHERE';
      whereClause += ' status = ?';
      params.push(status);
    }
    
    const countQuery = `SELECT COUNT(*) as total FROM manychat_data${whereClause}`;
    const dataQuery = `SELECT * FROM manychat_data${whereClause} ORDER BY updated_at DESC LIMIT ? OFFSET ?`;
    
    const [totalResult, data] = await Promise.all([
      getQuery(countQuery, params),
      allQuery(dataQuery, [...params, limit, offset])
    ]);
    
    res.json({
      success: true,
      data: data,
      pagination: {
        page,
        limit,
        total: totalResult.total,
        totalPages: Math.ceil(totalResult.total / limit)
      }
    });
  } catch (error) {
    console.error('Subscriber listesi hatası:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Veriler alınamadı' 
    });
  }
});

// Durum güncelleme endpoint - Rate limiting uygulanmış
app.put('/api/data/subscribers/:id/status', authenticateToken, searchStatusRateLimit, async (req, res) => {
  try {
    const { id } = req.params;
    const { status } = req.body;
    
    // Önce eski durumu al
    const currentData = await getQuery('SELECT status FROM manychat_data WHERE id = ?', [id]);
    if (!currentData) {
      return res.status(404).json({ 
        success: false, 
        message: 'Kayıt bulunamadı' 
      });
    }
    
    // Durumu güncelle
    await runQuery(
      'UPDATE manychat_data SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
      [status, id]
    );
    
    // Status log kaydet
    await runQuery(`
      INSERT INTO status_logs (subscriber_id, user_id, old_status, new_status, changed_at)
      VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)
    `, [id, req.user.id, currentData.status, status]);
    
    res.json({ 
      success: true, 
      message: 'Durum güncellendi' 
    });
  } catch (error) {
    console.error('Durum güncelleme hatası:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Durum güncellenemedi' 
    });
  }
});

// Manuel veri çekme endpoint - Rate limiting uygulanmış
app.post('/api/fetch-data', authenticateToken, manualFetchRateLimit, async (req, res) => {
  try {
    const fetcher = new ManyChatFetcher();
    const result = await fetcher.manualFetch();
    res.json({ 
      success: true, 
      data: result 
    });
  } catch (error) {
    console.error('Manuel veri çekme hatası:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Manuel veri çekme başarısız' 
    });
  }
});

// Admin sadece - kullanıcı yönetimi
app.get('/api/auth/users', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const users = await allQuery('SELECT id, username, role, created_at FROM users');
    res.json({ 
      success: true, 
      data: users 
    });
  } catch (error) {
    console.error('Kullanıcı listesi hatası:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Kullanıcılar alınamadı' 
    });
  }
});

// Admin sadece - kullanıcı oluşturma
app.post('/api/auth/register', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const { username, password, role } = req.body;
    
    const hashedPassword = await bcrypt.hash(password, 10);
    const result = await runQuery(
      'INSERT INTO users (username, password, role) VALUES (?, ?, ?)',
      [username, hashedPassword, role]
    );
    
    res.json({ 
      success: true, 
      message: 'Kullanıcı oluşturuldu', 
      id: result.lastID 
    });
  } catch (error) {
    console.error('Kullanıcı oluşturma hatası:', error);
    if (error.message.includes('UNIQUE constraint failed')) {
      res.status(400).json({ 
        success: false, 
        message: 'Bu kullanıcı adı zaten kullanılıyor' 
      });
    } else {
      res.status(500).json({ 
        success: false, 
        message: 'Kullanıcı oluşturulamadı' 
      });
    }
  }
});

// Admin sadece - kullanıcı silme
app.delete('/api/auth/users/:id', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    
    // Admin kullanıcısını silmeyi engelle
    const user = await getQuery('SELECT username FROM users WHERE id = ?', [id]);
    if (user?.username === 'admin') {
      return res.status(400).json({ 
        success: false, 
        message: 'Ana admin kullanıcısı silinemez' 
      });
    }
    
    await runQuery('DELETE FROM users WHERE id = ?', [id]);
    res.json({ 
      success: true, 
      message: 'Kullanıcı silindi' 
    });
  } catch (error) {
    console.error('Kullanıcı silme hatası:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Kullanıcı silinemedi' 
    });
  }
});

// Status logs endpoint
app.get('/api/status-logs', authenticateToken, async (req, res) => {
  try {
    const logs = await allQuery(`
      SELECT sl.*, u.username, md.first_name, md.last_name
      FROM status_logs sl
      JOIN users u ON sl.user_id = u.id
      JOIN manychat_data md ON sl.subscriber_id = md.id
      ORDER BY sl.changed_at DESC
      LIMIT 100
    `);
    res.json({ 
      success: true, 
      data: logs 
    });
  } catch (error) {
    console.error('Status logs hatası:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Loglar alınamadı' 
    });
  }
});

// 404 handler - En sonda olmalı
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Sunucu başlatma
async function startServer() {
  try {
    await initDatabase();
    
    // ManyChat veri çekme işlemini başlat
    const fetcher = new ManyChatFetcher();
    fetcher.start();
    
    app.listen(PORT, () => {
      console.log(`🚀 Sunucu ${PORT} portunda çalışıyor`);
      console.log(`📱 Uygulama: http://localhost:${PORT}`);
    });
  } catch (error) {
    console.error('Sunucu başlatma hatası:', error);
    process.exit(1);
  }
}

startServer();