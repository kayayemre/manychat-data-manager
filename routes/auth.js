const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
require('dotenv').config(); // Bu satır eklendi
const { getQuery, runQuery, allQuery } = require('../config/database');
const router = express.Router();

// JWT Secret kontrolü
if (!process.env.JWT_SECRET) {
  console.error('❌ JWT_SECRET çevre değişkeni tanımlanmamış!');
  process.exit(1);
}

// JWT token kontrolü middleware
const authenticateToken = (req, res, next) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) {
    return res.status(401).json({ 
      success: false, 
      message: 'Erişim token gerekli' 
    });
  }

  jwt.verify(token, process.env.JWT_SECRET, (err, user) => {
    if (err) {
      return res.status(403).json({ 
        success: false, 
        message: 'Geçersiz token' 
      });
    }
    req.user = user;
    next();
  });
};

// Admin kontrolü middleware
const requireAdmin = async (req, res, next) => {
  try {
    const user = await getQuery('SELECT role FROM users WHERE id = ?', [req.user.userId]);
    if (!user || user.role !== 'admin') {
      return res.status(403).json({ 
        success: false, 
        message: 'Bu işlem için admin yetkisi gerekli' 
      });
    }
    next();
  } catch (error) {
    console.error('Admin kontrol hatası:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Sunucu hatası' 
    });
  }
};

// Giriş yapma
router.post('/login', async (req, res) => {
  try {
    const { username, password } = req.body;
    
    if (!username || !password) {
      return res.status(400).json({ 
        success: false, 
        message: 'Kullanıcı adı ve şifre gerekli' 
      });
    }

    const user = await getQuery('SELECT * FROM users WHERE username = ?', [username]);
    
    if (!user) {
      return res.status(401).json({ 
        success: false, 
        message: 'Kullanıcı bulunamadı' 
      });
    }
    
    const isPasswordValid = await bcrypt.compare(password, user.password);
    
    if (!isPasswordValid) {
      return res.status(401).json({ 
        success: false, 
        message: 'Geçersiz şifre' 
      });
    }

    const token = jwt.sign(
      { userId: user.id, username: user.username, role: user.role },
      process.env.JWT_SECRET,
      { expiresIn: '24h' }
    );

    console.log('Giriş başarılı - Kullanıcı:', user.username, 'Role:', user.role); // Debug log

    res.json({
      success: true,
      message: 'Giriş başarılı',
      token,
      user: {
        id: user.id,
        username: user.username,
        role: user.role
      }
    });

  } catch (error) {
    console.error('Giriş hatası:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Sunucu hatası' 
    });
  }
});

// Yeni kullanıcı kaydetme (sadece admin yapabilir)
router.post('/register', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const { username, password, role = 'user' } = req.body;
    
    if (!username || !password) {
      return res.status(400).json({ 
        success: false, 
        message: 'Kullanıcı adı ve şifre gerekli' 
      });
    }

    if (!['admin', 'user'].includes(role)) {
      return res.status(400).json({ 
        success: false, 
        message: 'Geçersiz rol. "admin" veya "user" olmalı' 
      });
    }

    if (password.length < 6) {
      return res.status(400).json({ 
        success: false, 
        message: 'Şifre en az 6 karakter olmalı' 
      });
    }

    const existingUser = await getQuery('SELECT id FROM users WHERE username = ?', [username]);
    
    if (existingUser) {
      return res.status(409).json({ 
        success: false, 
        message: 'Bu kullanıcı adı zaten alınmış' 
      });
    }

    const hashedPassword = await bcrypt.hash(password, 10);
    
    const result = await runQuery(
      'INSERT INTO users (username, password, role) VALUES (?, ?, ?)', 
      [username, hashedPassword, role]
    );
    
    res.status(201).json({
      success: true,
      message: 'Kullanıcı başarıyla oluşturuldu',
      user: {
        id: result.lastID,
        username: username,
        role: role
      }
    });

  } catch (error) {
    console.error('Kayıt hatası:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Sunucu hatası' 
    });
  }
});

// Kullanıcı listesi (sadece admin görebilir)
router.get('/users', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const users = await allQuery(`
      SELECT id, username, role, created_at 
      FROM users 
      ORDER BY created_at DESC
    `);
    
    res.json({
      success: true,
      data: users
    });

  } catch (error) {
    console.error('Kullanıcı listesi hatası:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Sunucu hatası' 
    });
  }
});

// Kullanıcı silme (sadece admin yapabilir, kendini silemez)
router.delete('/users/:id', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    
    console.log('Kullanıcı silme isteği - ID:', id, 'Requesting User ID:', req.user.userId);
    
    if (parseInt(id) === req.user.userId) {
      return res.status(400).json({ 
        success: false, 
        message: 'Kendi hesabınızı silemezsiniz' 
      });
    }

    const user = await getQuery('SELECT username FROM users WHERE id = ?', [id]);
    
    if (!user) {
      return res.status(404).json({ 
        success: false, 
        message: 'Kullanıcı bulunamadı' 
      });
    }

    // Kullanıcıyı sil
    const result = await runQuery('DELETE FROM users WHERE id = ?', [id]);
    console.log('Silme sonucu:', result);
    
    res.json({
      success: true,
      message: `${user.username} kullanıcısı başarıyla silindi`
    });

  } catch (error) {
    console.error('Kullanıcı silme hatası:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Sunucu hatası: ' + error.message 
    });
  }
});

module.exports = router;