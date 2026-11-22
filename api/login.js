// Đăng nhập kiểm tra trên MÁY CHỦ: nhận tên + PIN → đúng thì cấp "vé" Firebase (custom token) mang mã người dùng + vai trò.
// Nhờ vậy Rules của Firebase chỉ cho đọc/ghi khi đã đăng nhập đúng — mở link app hay gõ thẳng link database đều không đọc được gì.
// Sai PIN 5 lần liền → khoá tên đó 10 phút (chống dò PIN).
const {admin, db} = require('./_shared');
const MAX_FAIL = 5, LOCK_MS = 10 * 60 * 1000;
const norm = s => String(s || '').trim().normalize('NFC').toLowerCase();

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') return res.status(405).json({error: 'Chỉ nhận POST'});
  let body = req.body || {};
  if (typeof body === 'string') { try { body = JSON.parse(body); } catch (e) { body = {}; } }
  const name = String(body.name || '').slice(0, 80), pin = String(body.pin || '');
  if (!/^\d{4}$/.test(pin) || (!name && !body.uid)) return res.status(400).json({error: 'Nhập tên và mã PIN gồm đúng 4 số.'});
  try {
    const d = db();
    const users = (await d.ref('users').once('value')).val() || {};
    const list = Object.keys(users).map(k => Object.assign({id: k}, users[k] || {}));
    const u = body.uid ? list.find(x => x.id === String(body.uid)) : list.find(x => norm(x.name) === norm(name));
    if (!u) return res.status(404).json({error: 'Chưa có tài khoản với tên này. Liên hệ Quản lý để được tạo tài khoản trước khi đăng nhập.'});
    const failRef = d.ref('loginFails/' + u.id);
    const f = (await failRef.once('value')).val() || {};
    const now = Date.now();
    if ((f.n || 0) >= MAX_FAIL && now - (f.at || 0) < LOCK_MS) {
      const mins = Math.ceil((LOCK_MS - (now - f.at)) / 60000);
      return res.status(429).json({error: `Nhập sai PIN quá nhiều lần. Thử lại sau ${mins} phút.`});
    }
    const secret = (await d.ref('userPins/' + u.id).once('value')).val();
    const realPin = String(secret != null ? secret : (u.pin || ''));
    if (!realPin || realPin !== pin) {
      const n = ((f.n || 0) >= MAX_FAIL ? 0 : (f.n || 0)) + 1;
      await failRef.set({n, at: now});
      return res.status(401).json({error: n >= MAX_FAIL ? 'Sai mã PIN. Tên này bị khoá 10 phút.' : `Sai mã PIN cho tên này. (còn ${MAX_FAIL - n} lần thử)`});
    }
    if (u.loginBlocked) return res.status(403).json({error: 'Tài khoản này đã ngừng hoạt động. Liên hệ Quản lý nếu cần mở lại.'});
    if (f.n) await failRef.remove();
    if (body.verify) return res.status(200).json({ok: true, userId: u.id}); // chỉ xác nhận lại PIN (hộp "nhập lại PIN"), không cấp vé mới
    const token = await admin.auth().createCustomToken(u.id, {r: String(u.role || 'staff')});
    return res.status(200).json({ok: true, token, userId: u.id});
  } catch (e) {
    console.error('login error', e);
    return res.status(500).json({error: 'Máy chủ lỗi, thử lại sau ít phút.'});
  }
};
