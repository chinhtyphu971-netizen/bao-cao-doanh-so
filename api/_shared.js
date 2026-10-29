// Dùng chung cho các hàm máy chủ (Vercel Serverless) — kết nối Firebase bằng tài khoản dịch vụ (admin)
const admin = require('firebase-admin');
function db(){
  if(!admin.apps.length){
    admin.initializeApp({
      credential: admin.credential.cert(JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT)),
      databaseURL: process.env.FIREBASE_DB_URL
    });
  }
  return admin.database();
}
// Mã hãng của Abit → tên hãng trong app
const CARRIER = {SPX:'SPX (Shopee Express)', JNT:'J&T Express', VIETTELPOST:'Viettel Post', GHTK:'GHTK', GHN:'GHN', BESTINC:'Best Express', VNPOST:'VNPost', NINJAVAN:'Ninja Van'};
function carrierName(code){ const c = String(code||'').trim().toUpperCase(); return CARRIER[c] || (code ? String(code) : null); }
module.exports = {admin, db, carrierName};
