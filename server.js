const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
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

// Genel rate limiting (tüm istekler için)
app.use(generalRateLimit);

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

// Routes

// Login endpoint
app.post('/api/login', async (req, res) => {
  try {
    const { username, password } = req.body;
    
    const user = await getQuery('SELECT * FROM users WHERE username = ?', [username]);
    if (!user) {
      return res.status(401).json({ error: 'Kullanıcı adı veya şifre hatalı' });
    }

    const isValid = await bcrypt.compare(password, user.password);
    if (!isValid) {
      return res.status(401).json({ error: 'Kullanıcı adı veya şifre hatalı' });
    }

    const token = jwt.sign(
      { id: user.id, username: user.username, role: user.role },
      process.env.JWT_SECRET,
      { expiresIn: '24h' }
    );

    res.json({ 
      token, 
      user: { 
        id: user.id, 
        username: user.username, 
        role: user.role 
      } 
    });
  } catch (error) {
    res.status(500).json({ error: 'Sunucu hatası' });
  }
});

// Veri listesi endpoint
app.get('/api/data', authenticateToken, async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 50;
    const offset = (page - 1) * limit;
    
    const search = req.query.search || '';
    const status = req.query.status || '';
    
    let whereClause = '';
    let params = [];
    
    if (search) {
      whereClause += ' WHERE (first_name LIKE ? OR last_name LIKE ? OR phone LIKE ?)';
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
      data,
      pagination: {
        page,
        limit,
        total: totalResult.total,
        pages: Math.ceil(totalResult.total / limit)
      }
    });
  } catch (error) {
    res.status(500).json({ error: 'Veri alınamadı' });
  }
});

// Durum güncelleme endpoint - Rate limiting uygulanmış
app.put('/api/data/:id/status', authenticateToken, searchStatusRateLimit, async (req, res) => {
  try {
    const { id } = req.params;
    const { status } = req.body;
    
    // Önce eski durumu al
    const currentData = await getQuery('SELECT status FROM manychat_data WHERE id = ?', [id]);
    if (!currentData) {
      return res.status(404).json({ error: 'Kayıt bulunamadı' });
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
    
    res.json({ message: 'Durum güncellendi' });
  } catch (error) {
    console.error('Durum güncelleme hatası:', error);
    res.status(500).json({ error: 'Durum güncellenemedi' });
  }
});

// Manuel veri çekme endpoint - Rate limiting uygulanmış
app.post('/api/manual-fetch', authenticateToken, manualFetchRateLimit, async (req, res) => {
  try {
    const fetcher = new ManyChatFetcher();
    const result = await fetcher.manualFetch();
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: 'Manuel veri çekme başarısız' });
  }
});

// Admin sadece - kullanıcı yönetimi
app.get('/api/admin/users', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const users = await allQuery('SELECT id, username, role, created_at FROM users');
    res.json(users);
  } catch (error) {
    res.status(500).json({ error: 'Kullanıcılar alınamadı' });
  }
});

// Admin sadece - kullanıcı oluşturma
app.post('/api/admin/users', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const { username, password, role } = req.body;
    
    const hashedPassword = await bcrypt.hash(password, 10);
    const result = await runQuery(
      'INSERT INTO users (username, password, role) VALUES (?, ?, ?)',
      [username, hashedPassword, role]
    );
    
    res.json({ message: 'Kullanıcı oluşturuldu', id: result.lastID });
  } catch (error) {
    if (error.message.includes('UNIQUE constraint failed')) {
      res.status(400).json({ error: 'Bu kullanıcı adı zaten kullanılıyor' });
    } else {
      res.status(500).json({ error: 'Kullanıcı oluşturulamadı' });
    }
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
    res.json(logs);
  } catch (error) {
    res.status(500).json({ error: 'Loglar alınamadı' });
  }
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
    });
  } catch (error) {
    console.error('Sunucu başlatma hatası:', error);
    process.exit(1);
  }
}

startServer();