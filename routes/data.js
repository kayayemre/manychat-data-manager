const express = require("express");
const router = express.Router();
const db = require("../config/database");

router.get("/abone-listesi", async (req, res) => {
  try {
    const rows = await db.all("SELECT * FROM abone_listesi ORDER BY id DESC");
    res.json(rows);
  } catch (error) {
    console.error("Veri getirme hatası:", error);
    res.status(500).json({ error: "Veri getirme hatası" });
  }
});

router.post("/durum-guncelle", async (req, res) => {
  const { id, durum } = req.body;

  if (!id || !durum) {
    return res.status(400).json({ error: "Eksik bilgi: id veya durum eksik." });
  }

  try {
    await db.run("UPDATE abone_listesi SET durum = ? WHERE id = ?", [durum, id]);
    res.status(200).json({ message: "Durum güncellendi" });
  } catch (error) {
    console.error("Durum güncelleme hatası:", error);
    res.status(500).json({ error: "Durum güncelleme hatası" });
  }
});

module.exports = router;
