const axios = require('axios');
require('dotenv').config();

async function getSubscribersWithCorrectDream() {
  try {
    console.log('🔄 Doğru "Dream" değeri ile subscriber\'lar çekiliyor...');
    
    // Farklı Dream varyasyonlarını dene
    const dreamValues = [
      'Dream of Ölüdeniz',    // Tam değer
      'Dream',                // Sadece Dream
      'dream',                // Küçük harf
      'DREAM',                // Büyük harf
      'Dream of',             // Kısmi
      'Ölüdeniz'              // Sadece yer adı
    ];
    
    for (const dreamValue of dreamValues) {
      try {
        console.log(`\n🔍 "${dreamValue}" değeri test ediliyor...`);
        
        const response = await axios.get(`${process.env.MANYCHAT_API_URL}/subscriber/findByCustomField`, {
          headers: {
            'Authorization': `Bearer ${process.env.MANYCHAT_API_TOKEN}`,
            'Content-Type': 'application/json'
          },
          params: {
            field_id: 13286635, // otel_adi field ID
            field_value: dreamValue
          }
        });
        
        const count = response.data.data?.length || 0;
        console.log(`   📊 "${dreamValue}" ile ${count} subscriber bulundu`);
        
        if (count > 0) {
          console.log(`   🎉 BAŞARILI! "${dreamValue}" ile ${count} subscriber bulundu!`);
          
          // İlk 3'ünü göster
          const showCount = Math.min(3, count);
          console.log(`\n   👥 İlk ${showCount} subscriber:`);
          
          response.data.data.slice(0, showCount).forEach((sub, index) => {
            console.log(`\n   ${index + 1}. Subscriber:`);
            console.log(`      🆔 ID: ${sub.id}`);
            console.log(`      👤 İsim: ${sub.first_name || ''} ${sub.last_name || ''}`);
            console.log(`      📱 WhatsApp: ${sub.whatsapp_phone || 'Yok'}`);
            console.log(`      📧 Email: ${sub.email || 'Yok'}`);
            
            // Custom fields
            if (sub.custom_fields) {
              const otelAdi = sub.custom_fields.find(f => f.name === 'otel_adi')?.value;
              const conditions = sub.custom_fields.find(f => f.name === 'conditions')?.value;
              const fiyat = sub.custom_fields.find(f => f.name === 'cevap_fiyat1')?.value;
              
              console.log(`      🏨 Otel: "${otelAdi || 'Boş'}"`);
              console.log(`      🍽️ Konaklama: "${conditions || 'Boş'}"`);
              console.log(`      💰 Fiyat: "${fiyat || 'Boş'}"`);
            }
          });
          
          // WhatsApp istatistiği
          const withWhatsApp = response.data.data.filter(sub => 
            sub.whatsapp_phone && sub.whatsapp_phone.trim() !== ''
          );
          
          console.log(`\n   📊 ${withWhatsApp.length}/${count} subscriber'ın WhatsApp numarası var`);
          console.log(`   ✅ Bu değer ("${dreamValue}") ana sistemde kullanılabilir!`);
          
          break; // İlk başarılı bulunca dur
        }
        
      } catch (error) {
        console.log(`   ❌ "${dreamValue}" hatası: ${error.response?.data?.details?.messages?.[0]?.message}`);
      }
      
      // Rate limit koruması
      await new Promise(resolve => setTimeout(resolve, 150));
    }
    
  } catch (error) {
    console.log('❌ Main error:', error.response?.data);
  }
}

getSubscribersWithCorrectDream();