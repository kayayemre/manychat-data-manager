const express = require("express");
const app = express();
const port = process.env.PORT || 3000;
const authRoutes = require("./routes/auth");
const dataRoutes = require("./routes/data");

// Middleware'leri tanımla
app.use(express.json()); // JSON verileri alabilmek için GEREKLİ
app.use(express.urlencoded({ extended: true })); // form verileri için (opsiyonel)

// Statik dosyalar (public klasörü varsa)
app.use(express.static("public"));

// Rotalar
app.use("/api/auth", authRoutes);
app.use("/api/data", dataRoutes);

// Ana route
app.get("/", (req, res) => {
  res.send("Sunucu çalışıyor");
});

// Sunucuyu başlat
app.listen(port, () => {
  console.log(`Sunucu ${port} portunda çalışıyor`);
});