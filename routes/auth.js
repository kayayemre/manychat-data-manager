const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { getQuery, runQuery } = require('../config/database');
const router = express.Router();

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
      { userId: user.id, username: user.username },
      process.env.JWT_SECRET,
      { expiresIn: '24h' }
    );

    res.json({
      success: true,
      message: 'Giriş başarılı',
      token,
      user: {
        id: user.id,
        username: user.username,
        role: user.role || 'user'
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
router.post('/register', authenticateToken, async (req, res) => {
  try {
    const { username, password } = req.body;
    
    // Admin kontrolü
    const adminUser = await getQuery('SELECT role FROM users WHERE id = ?', [req.user.userId]);
    if (!adminUser || adminUser.role !== 'admin') {
      return res.status(403).json({ 
        success: false, 
        message: 'Sadece admin kullanıcı ekleyebilir' 
      });
    }
    
    if (!username || !password) {
      return res.status(400).json({ 
        success: false, 
        message: 'Kullanıcı adı ve şifre gerekli' 
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
    
    const result = await runQuery('INSERT INTO users (username, password, role) VALUES (?, ?, ?)', [username, hashedPassword, 'user']);
    
    res.status(201).json({
      success: true,
      message: 'Kullanıcı başarıyla oluşturuldu',
      user: {
        id: result.lastID,
        username: username,
        role: 'user'
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

module.exports = router;