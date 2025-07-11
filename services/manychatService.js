const axios = require('axios');
const { runQuery, getQuery } = require('../config/database');

class ManyChatService {
constructor() {
  this.apiToken = process.env.MANYCHAT_API_TOKEN;
  this.apiUrl = process.env.MANYCHAT_API_URL;
  this.lastFetchTime = 0;
  this.headers = {
    'Authorization': `Bearer ${this.apiToken}`,
    'Content-Type': 'application/json'
  };
}

  // ManyChat'ten subscriber'ları çek
  async fetchSubscribers() {
    try {
      console.log('🔄 ManyChat verisi çekiliyor...');
      
      // Dream of Ölüdeniz oteli subscriber'ları
      const response = await axios.get(`${this.apiUrl}/subscriber/findByCustomField`, {
        headers: this.headers,
        params: {
          field_id: 13286635, // otel_adi field ID
          field_value: 'Dream of Ölüdeniz'
        }
      });

      if (response.data && response.data.data) {
        console.log(`✅ ${response.data.data.length} subscriber verisi alındı`);
        return response.data.data;
      } else {
        console.log('⚠️ Veri bulunamadı');
        return [];
      }
    } catch (error) {
      console.error('❌ ManyChat API hatası:', error.response?.data || error.message);
      return [];
    }
  }
  // ManyChat'ten subscriber'ları çek
async fetchSubscribers() {
  try {
    console.log('🔄 ManyChat verisi çekiliyor...');
    
    // Rate limit koruması - son çekme zamanını kontrol et
    const now = Date.now();
    const lastFetch = this.lastFetchTime || 0;
    const minInterval = 60000; // 1 dakika minimum aralık
    
    if (now - lastFetch < minInterval) {
      console.log('⚠️ Rate limit koruması - çok erken tekrar çekme girişimi');
      return [];
    }
    
    this.lastFetchTime = now;
    
    const response = await axios.get(`${this.apiUrl}/subscriber/findByCustomField`, {
      headers: this.headers,
      params: {
        field_id: 13286635,
        field_value: 'Dream of Ölüdeniz'
      }
    });

    if (response.data && response.data.data) {
      console.log(`✅ ${response.data.data.length} subscriber verisi alındı`);
      return response.data.data;
    } else {
      console.log('⚠️ Veri bulunamadı');
      return [];
    }
  } catch (error) {
    if (error.response?.status === 429) {
      console.error('❌ Rate limit aşıldı - 10 dakika bekleyin');
    } else {
      console.error('❌ ManyChat API hatası:', error.response?.data || error.message);
    }
    return [];
  }
}

  // Veriyi veritabanına kaydet
  async saveSubscribersToDatabase(subscribers) {
    if (!subscribers || subscribers.length === 0) {
      console.log('💾 Kaydedilecek veri yok');
      return;
    }

    try {
      let savedCount = 0;
      let updatedCount = 0;

      for (const subscriber of subscribers) {
        // Custom field değerlerini çıkar
        const customFields = {};
        if (subscriber.custom_fields) {
          subscriber.custom_fields.forEach(field => {
            customFields[field.name] = field.value;
          });
        }

        // Önce kayıt var mı kontrol et
        const existingRecord = await getQuery('SELECT id FROM manychat_data WHERE subscriber_id = ?', [subscriber.id]);
        
        if (existingRecord) {
          // Güncelle
          await runQuery(`
            UPDATE manychat_data SET 
              first_name = ?, last_name = ?, phone = ?, email = ?, 
              whatsapp_phone = ?, last_interaction = ?, 
              otel_adi = ?, conditions = ?, cevap_fiyat1 = ?,
              raw_data = ?, updated_at = CURRENT_TIMESTAMP
            WHERE subscriber_id = ?
          `, [
            subscriber.first_name || null,
            subscriber.last_name || null,
            subscriber.phone || null,
            subscriber.email || null,
            subscriber.whatsapp_phone || null,
            subscriber.last_interaction ? new Date(subscriber.last_interaction).toISOString() : null,
            customFields.otel_adi || null,
            customFields.conditions || null,
            customFields.cevap_fiyat1 || null,
            JSON.stringify(subscriber),
            subscriber.id
          ]);
          updatedCount++;
        } else {
          // Yeni kayıt ekle
          await runQuery(`
            INSERT INTO manychat_data (
              subscriber_id, first_name, last_name, phone, email, 
              whatsapp_phone, last_interaction, otel_adi, conditions, 
              cevap_fiyat1, raw_data
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          `, [
            subscriber.id,
            subscriber.first_name || null,
            subscriber.last_name || null,
            subscriber.phone || null,
            subscriber.email || null,
            subscriber.whatsapp_phone || null,
            subscriber.last_interaction ? new Date(subscriber.last_interaction).toISOString() : null,
            customFields.otel_adi || null,
            customFields.conditions || null,
            customFields.cevap_fiyat1 || null,
            JSON.stringify(subscriber)
          ]);
          savedCount++;
        }
      }

      console.log(`💾 ${savedCount} yeni kayıt eklendi, ${updatedCount} kayıt güncellendi`);
      
    } catch (error) {
      console.error('❌ Veritabanı kaydetme hatası:', error);
    }
  }

  // Ana veri çekme fonksiyonu
  async fetchAndSaveData() {
    try {
      const subscribers = await this.fetchSubscribers();
      await this.saveSubscribersToDatabase(subscribers);
      console.log('✅ Veri çekme ve kaydetme tamamlandı');
    } catch (error) {
      console.error('❌ Veri çekme/kaydetme hatası:', error);
    }
  }
}

const manyChatService = new ManyChatService();

// Otomatik veri çekme başlatma
function startDataFetching() {
  const intervalMinutes = process.env.DATA_FETCH_INTERVAL || 3;
  const intervalMs = intervalMinutes * 60 * 1000;
  
  console.log(`🔄 ${intervalMinutes} dakikada bir Dream of Ölüdeniz verileri çekiliyor...`);
  
  // İlk çekme
  manyChatService.fetchAndSaveData();
  
  // Periyodik çekme
  setInterval(() => {
    manyChatService.fetchAndSaveData();
  }, intervalMs);
}

module.exports = {
  manyChatService,
  startDataFetching
};