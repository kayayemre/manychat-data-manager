const express = require("express");
const router = express.Router();
const { allQuery, getQuery, runQuery, getTurkeyTime } = require("../config/database");

// JWT token kontrolü middleware
const jwt = require('jsonwebtoken');
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

// Abone listesi - sayfalama ve arama ile
router.get("/subscribers", authenticateToken, async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 20;
    const search = req.query.search || '';
    const status = req.query.status || '';
    
    const offset = (page - 1) * limit;
    
    // Base query
    let whereClause = "WHERE 1=1";
    let params = [];
    
    // Search filter
    if (search) {
      whereClause += ` AND (first_name LIKE ? OR last_name LIKE ? OR whatsapp_phone LIKE ?)`;
      const searchTerm = `%${search}%`;
      params.push(searchTerm, searchTerm, searchTerm);
    }
    
    // Status filter
    if (status) {
      whereClause += ` AND status = ?`;
      params.push(status);
    }
    
    // Count query
    const countQuery = `SELECT COUNT(*) as total FROM manychat_data ${whereClause}`;
    const countResult = await getQuery(countQuery, params);
    const total = countResult.total;
    
    // Data query with status logs
    const dataQuery = `
      SELECT 
        md.*,
        (
          SELECT GROUP_CONCAT(
            u.username || ' - ' || 
            datetime(sl.changed_at, '+3 hours') || ' (' || sl.new_status || ')', 
            ' | '
          )
          FROM status_logs sl
          JOIN users u ON sl.user_id = u.id
          WHERE sl.subscriber_id = md.id
          ORDER BY sl.changed_at DESC
          LIMIT 5
        ) as status_history
      FROM manychat_data md
      ${whereClause}
      ORDER BY md.updated_at DESC
      LIMIT ? OFFSET ?
    `;
    
    const dataParams = [...params, limit, offset];
    const subscribers = await allQuery(dataQuery, dataParams);
    
    // Format dates to Turkey time
    const formattedSubscribers = subscribers.map(sub => ({
      ...sub,
      created_at_turkey: sub.created_at ? new Date(sub.created_at + ' UTC').toLocaleString('tr-TR', {timeZone: 'Europe/Istanbul'}) : null,
      last_interaction_turkey: sub.last_interaction ? new Date(sub.last_interaction + ' UTC').toLocaleString('tr-TR', {timeZone: 'Europe/Istanbul'}) : null,
      updated_at_turkey: sub.updated_at ? new Date(sub.updated_at + ' UTC').toLocaleString('tr-TR', {timeZone: 'Europe/Istanbul'}) : null
    }));
    
    const totalPages = Math.ceil(total / limit);
    
    res.json({
      success: true,
      data: formattedSubscribers,
      pagination: {
        page,
        limit,
        total,
        totalPages,
        hasNext: page < totalPages,
        hasPrev: page > 1
      }
    });
    
  } catch (error) {
    console.error("Subscriber listesi hatası:", error);
    res.status(500).json({ 
      success: false, 
      message: "Subscriber listesi getirme hatası" 
    });
  }
});

// Status güncelleme
router.put("/subscribers/:id/status", authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    const { status } = req.body;

    if (!id || !status) {
      return res.status(400).json({ 
        success: false, 
        message: "Eksik bilgi: id veya status eksik." 
      });
    }

    if (!['ARANDI', 'ARANMADI'].includes(status)) {
      return res.status(400).json({ 
        success: false, 
        message: "Geçersiz status. 'ARANDI' veya 'ARANMADI' olmalı." 
      });
    }

    // Mevcut status'u al
    const currentSubscriber = await getQuery("SELECT status FROM manychat_data WHERE id = ?", [id]);
    
    if (!currentSubscriber) {
      return res.status(404).json({ 
        success: false, 
        message: "Subscriber bulunamadı" 
      });
    }

    const oldStatus = currentSubscriber.status;
    
    // Status'u güncelle
    await runQuery("UPDATE manychat_data SET status = ?, updated_at = ? WHERE id = ?", [
      status, 
      getTurkeyTime(), 
      id
    ]);
    
    // Status log ekle
    await runQuery(`
      INSERT INTO status_logs (subscriber_id, user_id, old_status, new_status, changed_at)
      VALUES (?, ?, ?, ?, ?)
    `, [id, req.user.userId, oldStatus, status, getTurkeyTime()]);
    
    res.json({ 
      success: true, 
      message: "Status başarıyla güncellendi" 
    });
    
  } catch (error) {
    console.error("Status güncelleme hatası:", error);
    res.status(500).json({ 
      success: false, 
      message: "Status güncelleme hatası" 
    });
  }
});

// İstatistikler
router.get("/stats", authenticateToken, async (req, res) => {
  try {
    // Genel istatistikler
    const totalSubscribers = await getQuery("SELECT COUNT(*) as count FROM manychat_data");
    const arandiCount = await getQuery("SELECT COUNT(*) as count FROM manychat_data WHERE status = 'ARANDI'");
    const aranmadiCount = await getQuery("SELECT COUNT(*) as count FROM manychat_data WHERE status = 'ARANMADI'");
    
    // Bugün eklenen veriler (Türkiye saati)
    const today = new Date().toISOString().split('T')[0];
    const newToday = await getQuery(`
      SELECT COUNT(*) as count 
      FROM manychat_data 
      WHERE DATE(created_at, '+3 hours') = ?
    `, [today]);
    
    // Bugün aranan veriler
    const calledToday = await getQuery(`
      SELECT COUNT(*) as count 
      FROM status_logs 
      WHERE new_status = 'ARANDI' 
      AND DATE(changed_at, '+3 hours') = ?
    `, [today]);

    // Kullanıcı bazlı istatistikler - BUGÜN
    const userStatsToday = await allQuery(`
      SELECT 
        u.username,
        COUNT(sl.id) as call_count_today
      FROM users u
      LEFT JOIN status_logs sl ON u.id = sl.user_id 
        AND sl.new_status = 'ARANDI' 
        AND DATE(sl.changed_at, '+3 hours') = ?
      GROUP BY u.id, u.username
      HAVING call_count_today > 0
      ORDER BY call_count_today DESC
    `, [today]);

    // Kullanıcı bazlı istatistikler - GENEL (tüm zamanlar)
    const userStatsTotal = await allQuery(`
      SELECT 
        u.username,
        COUNT(sl.id) as call_count_total
      FROM users u
      LEFT JOIN status_logs sl ON u.id = sl.user_id 
        AND sl.new_status = 'ARANDI' 
      GROUP BY u.id, u.username
      HAVING call_count_total > 0
      ORDER BY call_count_total DESC
    `);

    const totalCalls = arandiCount.count;
    const todayCalls = calledToday.count;
    const callRate = totalSubscribers.count > 0 ? ((totalCalls / totalSubscribers.count) * 100).toFixed(1) : 0;
    const todayCallRate = newToday.count > 0 ? ((todayCalls / newToday.count) * 100).toFixed(1) : 0;

    res.json({
      success: true,
      data: {
        // Genel istatistikler
        totalSubscribers: totalSubscribers.count,
        totalCalled: totalCalls,
        callRate: parseFloat(callRate),
        newToday: newToday.count,
        calledToday: todayCalls,
        todayCallRate: parseFloat(todayCallRate),
        
        // Kullanıcı istatistikleri
        userStatsToday: userStatsToday,
        userStatsTotal: userStatsTotal,
        
        // Eski format (backward compatibility)
        arandiCount: totalCalls,
        aranmadiCount: aranmadiCount.count
      }
    });
    
  } catch (error) {
    console.error("İstatistik getirme hatası:", error);
    res.status(500).json({ 
      success: false, 
      message: "İstatistik getirme hatası" 
    });
  }
});

// Eski endpoint (backward compatibility)
router.get("/abone-listesi", authenticateToken, async (req, res) => {
  try {
    const rows = await allQuery("SELECT * FROM manychat_data ORDER BY id DESC");
    res.json(rows);
  } catch (error) {
    console.error("Veri getirme hatası:", error);
    res.status(500).json({ error: "Veri getirme hatası" });
  }
});

// Eski endpoint (backward compatibility)
router.post("/durum-guncelle", authenticateToken, async (req, res) => {
  const { id, durum } = req.body;

  if (!id || !durum) {
    return res.status(400).json({ error: "Eksik bilgi: id veya durum eksik." });
  }

  try {
    await runQuery("UPDATE manychat_data SET status = ? WHERE id = ?", [durum, id]);
    res.status(200).json({ message: "Durum güncellendi" });
  } catch (error) {
    console.error("Durum güncelleme hatası:", error);
    res.status(500).json({ error: "Durum güncelleme hatası" });
  }
});

module.exports = router;