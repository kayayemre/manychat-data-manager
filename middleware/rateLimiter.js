const rateLimit = require('express-rate-limit');

// Kullanıcı rolüne göre rate limiting
const createRoleBasedRateLimit = (options = {}) => {
  // Normal kullanıcılar için limit
  const userLimit = rateLimit({
    windowMs: 1 * 60 * 1000, // 1 dakika
    max: 3, // dakikada en fazla 3 istek
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: (req) => {
      // Kullanıcı ID'si ile limit
      return `user_${req.user?.id || req.ip}`;
    },
    message: {
      error: "Sakin ol şampiyon! Bu kadar hızlı aramış olamazsın! 1 dakikada en fazla 3 tane müşteri arayabilirsin. 1 dakika sonra yine gel ;)"
    },
    skip: (req) => {
      // Admin kullanıcıları atla
      return req.user?.role === 'admin';
    },
    ...options
  });

  // Admin kullanıcıları için daha yüksek limit (isteğe bağlı)
  const adminLimit = rateLimit({
    windowMs: 1 * 60 * 1000, // 1 dakika
    max: 50, // dakikada en fazla 50 istek (admin için)
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: (req) => {
      return `admin_${req.user?.id || req.ip}`;
    },
    message: {
      error: "Admin kullanıcısı olarak bile bu kadar hızlı işlem yapamazsın! Biraz yavaşla."
    },
    skip: (req) => {
      // Sadece admin kullanıcıları için
      return req.user?.role !== 'admin';
    },
    ...options
  });

  // Middleware fonksiyonu
  return (req, res, next) => {
    if (req.user?.role === 'admin') {
      // Admin kullanıcıları için yüksek limit
      adminLimit(req, res, next);
    } else {
      // Normal kullanıcılar için düşük limit
      userLimit(req, res, next);
    }
  };
};

// Arama durumu değişikliği için özel rate limiter
const searchStatusRateLimit = createRoleBasedRateLimit({
  windowMs: 1 * 60 * 1000, // 1 dakika
  max: 3, // Normal kullanıcılar için
});

// Genel API rate limiter
const generalRateLimit = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 dakika
  max: 100, // IP başına 15 dakikada 100 istek
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    error: "Çok fazla istek gönderildi, lütfen 15 dakika sonra tekrar deneyin."
  }
});

// Manuel veri çekme için rate limiter
const manualFetchRateLimit = rateLimit({
  windowMs: 5 * 60 * 1000, // 5 dakika
  max: 10, // 5 dakikada 10 istek
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => {
    return `manual_fetch_${req.user?.id || req.ip}`;
  },
  message: {
    error: "Manuel veri çekme işlemi için çok fazla istek gönderildi. 5 dakika sonra tekrar deneyin."
  },
  skip: (req) => {
    // Admin kullanıcıları için daha esnek
    return req.user?.role === 'admin';
  }
});

module.exports = {
  createRoleBasedRateLimit,
  searchStatusRateLimit,
  generalRateLimit,
  manualFetchRateLimit
};