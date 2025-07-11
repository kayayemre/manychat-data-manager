const express = require('express');
const jwt = require('jsonwebtoken');
const { allQuery, getQuery, runQuery } = require('../config/database');
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

// Tüm verileri getir
router.get('/subscribers', authenticateToken, async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 50;
    const offset = (page - 1) * limit;
    const search = req.query.search || '';
    const status = req.query.status || '';

    let query = `
      SELECT 
        id, subscriber_id, first_name, last_name, phone, 
        whatsapp_phone, otel_adi, conditions, cevap_fiyat1,
        status, created_at, updated_at, last_interaction
      FROM manychat_data
      WHERE 1=1
    `;
    
    const params = [];

    if (search) {
      query += ` AND (first_name LIKE ? OR last_name LIKE ? OR whatsapp_phone LIKE ?)`;
      const searchTerm = `%${search}%`;
      params.push(searchTerm, searchTerm, searchTerm);
    }

    if (status) {
      query += ` AND status = ?`;
      params.push(status);
    }

    query += ` ORDER BY created_at DESC LIMIT ? OFFSET ?`;
    params.push(limit, offset);

    const result = await allQuery(query, params);

    let countQuery = 'SELECT COUNT(*) as count FROM manychat_data WHERE 1=1';
    const countParams = [];

    if (search) {
      countQuery += ` AND (first_name LIKE ? OR last_name LIKE ? OR whatsapp_phone LIKE ?)`;
      const searchTerm = `%${search}%`;
      countParams.push(searchTerm, searchTerm, searchTerm);
    }

    if (status) {
      countQuery += ` AND status = ?`;
      countParams.push(status);
    }

    const countResult = await getQuery(countQuery, countParams);
    const totalCount = countResult.count;

    res.json({
      success: true,
      data: result,
      pagination: {
        page,
        limit,
        total: totalCount,
        totalPages: Math.ceil(totalCount / limit)
      }
    });

  } catch (error) {
    console.error('Veri getirme hatası:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Sunucu hatası' 
    });
  }
});

// Status güncelle
router.put('/subscribers/:id/status', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    const { status } = req.body;
    
    if (!['ARANDI', 'ARANMADI'].includes(status)) {
      return res.status(400).json({ 
        success: false, 
        message: 'Geçersiz status. ARANDI veya ARANMADI olmalı' 
      });
    }

    let query, params;
    
    if (status === 'ARANDI') {
      // Arandı durumu - tarih ve kullanıcı bilgisi ekle
      query = `
        UPDATE manychat_data 
        SET status = $1, arama_tarihi = CURRENT_TIMESTAMP, arayan_kullanici = $2, updated_at = CURRENT_TIMESTAMP 
        WHERE id = $3
      `;
      params = [status, req.user.username, id];
    } else {
      // Aranmadı durumu - sadece status güncelle
      query = `
        UPDATE manychat_data 
        SET status = $1, updated_at = CURRENT_TIMESTAMP 
        WHERE id = $2
      `;
      params = [status, id];
    }
    
    const result = await pool.query(query, params);
    
    if (result.rowCount === 0) {
      return res.status(404).json({ 
        success: false, 
        message: 'Kayıt bulunamadı' 
      });
    }

    res.json({
      success: true,
      message: 'Status başarıyla güncellendi'
    });

  } catch (error) {
    console.error('Status güncelleme hatası:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Sunucu hatası' 
    });
  }
});

// İstatistikler
router.get('/stats', authenticateToken, async (req, res) => {
  try {
    const totalSubscribers = await getQuery('SELECT COUNT(*) as count FROM manychat_data');
    const arandiCount = await getQuery("SELECT COUNT(*) as count FROM manychat_data WHERE status = 'ARANDI'");
    const aranmadiCount = await getQuery("SELECT COUNT(*) as count FROM manychat_data WHERE status = 'ARANMADI'");
    const newToday = await getQuery("SELECT COUNT(*) as count FROM manychat_data WHERE DATE(created_at) = DATE('now')");

    res.json({
      success: true,
      data: {
        totalSubscribers: totalSubscribers.count,
        arandiCount: arandiCount.count,
        aranmadiCount: aranmadiCount.count,
        newToday: newToday.count
      }
    });

  } catch (error) {
    console.error('İstatistik getirme hatası:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Sunucu hatası' 
    });
  }
});

// Manuel veri çekme
router.post('/fetch-now', authenticateToken, async (req, res) => {
  try {
    const { manyChatService } = require('../services/manychatService');
    
    manyChatService.fetchAndSaveData();
    
    res.json({
      success: true,
      message: 'Veri çekme işlemi başlatıldı'
    });

  } catch (error) {
    console.error('Manuel veri çekme hatası:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Sunucu hatası' 
    });
  }
});

module.exports = router;