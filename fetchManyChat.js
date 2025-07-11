const axios = require('axios');
const { runQuery, getQuery, getTurkeyTime } = require('./config/database');
require('dotenv').config();

class ManyChatFetcher {
  constructor() {
    this.apiToken = process.env.MANYCHAT_API_TOKEN;
    this.apiUrl = process.env.MANYCHAT_API_URL;
    this.interval = (process.env.DATA_FETCH_INTERVAL || 4) * 60 * 1000; // dakika -> ms
  }

  async fetchSubscribers() {
    try {
      console.log('🔄 ManyChat verisi çekiliyor...');
      
      // ManyChat API'den subscriber'ları çek
      const response = await axios.get(`${this.apiUrl}/subscriber/findByCustomField`, {
        headers: {
          'Authorization': `Bearer ${this.apiToken}`,
          'Content-Type': 'application/json'
        },
        params: {
          field_id: 13286635, // otel_adi field ID
          field_value: 'Dream of Ölüdeniz' // Doğru değer test-api.js'den
        }
      });

      const subscribers = response.data.data || [];
      console.log(`📊 ${subscribers.length} subscriber bulundu`);

      let newCount = 0;
      let updatedCount = 0;

      for (const subscriber of subscribers) {
        await this.saveSubscriber(subscriber, { newCount, updatedCount });
      }

      console.log(`✅ Veri çekme tamamlandı: ${newCount} yeni, ${updatedCount} güncellendi`);
      return { newCount, updatedCount, total: subscribers.length };

    } catch (error) {
      console.error('❌ ManyChat veri çekme hatası:', error.response?.data || error.message);
      throw error;
    }
  }

  async saveSubscriber(subscriber, counters) {
    try {
      // Mevcut subscriber kontrolü
      const existing = await getQuery(
        'SELECT id FROM manychat_data WHERE subscriber_id = ?',
        [subscriber.id]
      );

      // Custom field'ları parse et
      const customFields = {};
      if (subscriber.custom_fields) {
        subscriber.custom_fields.forEach(field => {
          customFields[field.name] = field.value;
        });
      }

      const subscriberData = {
        subscriber_id: subscriber.id,
        first_name: subscriber.first_name || null,
        last_name: subscriber.last_name || null,
        profile_pic: subscriber.profile_pic || null,
        locale: subscriber.locale || null,
        timezone: subscriber.timezone || null,
        gender: subscriber.gender || null,
        phone: subscriber.phone || null,
        email: subscriber.email || null,
        whatsapp_phone: subscriber.whatsapp_phone || null,
        subscribed_at: subscriber.subscribed_at || null,
        last_interaction: subscriber.last_interaction_at || null,
        otel_adi: customFields.otel_adi || null,
        conditions: customFields.conditions || null,
        cevap_fiyat1: customFields.cevap_fiyat1 || null,
        raw_data: JSON.stringify(subscriber),
        updated_at: getTurkeyTime()
      };

      if (existing) {
        // Güncelle
        await runQuery(`
          UPDATE manychat_data SET
            first_name = ?, last_name = ?, profile_pic = ?, locale = ?, timezone = ?,
            gender = ?, phone = ?, email = ?, whatsapp_phone = ?, subscribed_at = ?,
            last_interaction = ?, otel_adi = ?, conditions = ?, cevap_fiyat1 = ?,
            raw_data = ?, updated_at = ?
          WHERE subscriber_id = ?
        `, [
          subscriberData.first_name, subscriberData.last_name, subscriberData.profile_pic,
          subscriberData.locale, subscriberData.timezone, subscriberData.gender,
          subscriberData.phone, subscriberData.email, subscriberData.whatsapp_phone,
          subscriberData.subscribed_at, subscriberData.last_interaction, subscriberData.otel_adi,
          subscriberData.conditions, subscriberData.cevap_fiyat1, subscriberData.raw_data,
          subscriberData.updated_at, subscriberData.subscriber_id
        ]);
        counters.updatedCount++;
      } else {
        // Yeni ekle
        await runQuery(`
          INSERT INTO manychat_data (
            subscriber_id, first_name, last_name, profile_pic, locale, timezone,
            gender, phone, email, whatsapp_phone, subscribed_at, last_interaction,
            otel_adi, conditions, cevap_fiyat1, raw_data, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `, [
          subscriberData.subscriber_id, subscriberData.first_name, subscriberData.last_name,
          subscriberData.profile_pic, subscriberData.locale, subscriberData.timezone,
          subscriberData.gender, subscriberData.phone, subscriberData.email,
          subscriberData.whatsapp_phone, subscriberData.subscribed_at, subscriberData.last_interaction,
          subscriberData.otel_adi, subscriberData.conditions, subscriberData.cevap_fiyat1,
          subscriberData.raw_data, getTurkeyTime(), getTurkeyTime()
        ]);
        counters.newCount++;
      }

    } catch (error) {
      console.error('Subscriber kayıt hatası:', error);
    }
  }

  start() {
    console.log(`🚀 ManyChat veri çekme başlatıldı (${this.interval / 60000} dakikada bir)`);
    
    // İlk veri çekme
    this.fetchSubscribers().catch(console.error);
    
    // Periyodik veri çekme
    setInterval(() => {
      this.fetchSubscribers().catch(console.error);
    }, this.interval);
  }

  // Manuel veri çekme (API endpoint için)
  async manualFetch() {
    return await this.fetchSubscribers();
  }
}

module.exports = ManyChatFetcher;