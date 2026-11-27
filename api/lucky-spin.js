// 🎡 VÒNG QUAY MAY MẮN — máy chủ kiểm tra & quay (Sale không tự quay trên máy mình được)
// POST, header Authorization: Bearer <Firebase ID token của người đang đăng nhập>
// 1) Đúng là Sale / Quản lý team đang làm  2) Doanh số ĐÃ CỌC hôm nay (giờ VN) ≥ mốc, hoặc có "lượt quay thêm" hôm nay
// 3) Giao dịch trên luckySpin/{ngày}: mỗi người 1 lượt, tối đa N người (không tính lượt thêm)  4) Chọn giải theo tỉ lệ + ghi quyền lợi
const {admin, db} = require('./_shared');
const DEF = [
  {key:'jackpot', name:'Jackpot: tặng 50 sao', short:'50 sao', kind:'manual', w:3},
  {key:'data10', name:'+10 data ưu tiên', short:'+10 data', kind:'data', n:10, w:15},
  {key:'milk', name:'1 ly trà sữa', short:'Trà sữa', kind:'manual', w:20},
  {key:'data5', name:'+5 data ưu tiên', short:'+5 data', kind:'data', n:5, w:22},
  {key:'pass', name:'Thẻ miễn phạt báo cáo', short:'Miễn phạt', kind:'pass', w:10},
  {key:'extra', name:'Thêm 1 lượt quay ngày mai', short:'+1 lượt', kind:'extra', w:10},
  {key:'gift', name:'Quà nhỏ', short:'Quà nhỏ', kind:'manual', w:10},
  {key:'early', name:'Về sớm 1 tiếng', short:'Về sớm', kind:'manual', w:10}];
const DEF_MKT = [
  {key:'jackpot', name:'Jackpot: tặng 100 sao', short:'100 sao', kind:'manual', w:3},
  {key:'star15', name:'Tặng 15 sao', short:'15 sao', kind:'manual', w:20},
  {key:'milk', name:'1 ly trà chanh', short:'Trà chanh', kind:'manual', w:18},
  {key:'star10', name:'Tặng 10 sao', short:'10 sao', kind:'manual', w:32},
  {key:'mktpass', name:'Thẻ miễn khoá nhập data', short:'Miễn khoá', kind:'mktpass', w:10},
  {key:'early', name:'Về sớm 1 tiếng', short:'Về sớm', kind:'manual', w:12},
  {key:'extra', name:'Thêm 1 lượt quay ngày mai', short:'+1 lượt', kind:'extra', w:5}];
const vnDay = t => new Date(t + 7 * 3600000).toISOString().slice(0, 10);
const money = n => (Number(n) || 0).toLocaleString('vi-VN');

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') return res.status(405).json({error: 'Chỉ nhận POST'});
  try {
    const m = String(req.headers.authorization || '').match(/^Bearer (.+)$/);
    if (!m) return res.status(401).json({error: 'Chưa đăng nhập.'});
    const D = db(); // ⚠ khởi tạo Firebase admin TRƯỚC khi gọi admin.auth()
    let dec; try { dec = await admin.auth().verifyIdToken(m[1]); } catch (e) { return res.status(401).json({error: 'Phiên đăng nhập hết hạn — tải lại app rồi thử lại.'}); }
    const uid = dec.uid;
    const u = (await D.ref('users/' + uid).once('value')).val();
    // Vòng quay Sale (staff / team_manager) hoặc vòng quay MKT (mkt / mkt_manager) — theo vai trò, không tin vào máy gửi lên
    const pool = u && ['mkt', 'mkt_manager'].includes(u.role) ? 'mkt' : 'sale';
    if (!u || !['staff', 'team_manager', 'mkt', 'mkt_manager'].includes(u.role) || u.active === false || u.loginBlocked)
      return res.status(403).json({error: 'Tài khoản này không tham gia vòng quay. Nếu bạn là Sale / MKT: đăng xuất rồi đăng nhập lại.'});
    const cv = (await D.ref(pool === 'mkt' ? 'luckyCfgMkt' : 'luckyCfg').once('value')).val() || {};
    const threshold = Number(cv.threshold) || (pool === 'mkt' ? 500 : 10000000), maxPerDay = Number(cv.maxPerDay) || (pool === 'mkt' ? 3 : 5);
    const prizes = (Array.isArray(cv.prizes) && cv.prizes.length ? cv.prizes : (pool === 'mkt' ? DEF_MKT : DEF)).filter(p => p && p.key && Number(p.w) > 0);
    if (!prizes.length) return res.status(500).json({error: 'Chưa cài giải thưởng.'});
    const now = Date.now(), day = vnDay(now);
    const dayStart = Date.parse(day + 'T00:00:00+07:00'), tomorrow = vnDay(dayStart + 86400000 + 3600000);
    let revenue = 0;
    if (pool === 'mkt') { // MKT: số SĐT hợp lệ đã nhập hôm nay (chỉ số hợp lệ, đã lọc trùng mới được ghi vào kho)
      const ls = await D.ref('leads').orderByChild('createdBy').equalTo(uid).once('value');
      ls.forEach(c => { const v = c.val(); const t = Number(v && v.importedAt); if (t >= dayStart && t < dayStart + 86400000) revenue++; });
    } else { // Sale: doanh số ĐÃ CỌC hôm nay (theo giờ đánh dấu cọc — giống phần Mục tiêu)
      const snap = await D.ref('invoices').orderByChild('depositLink/markedAt').startAt(dayStart).endAt(dayStart + 86400000 - 1).once('value');
      snap.forEach(c => { const v = c.val(); if (v && v.saleId === uid && v.depositLink) revenue += Number(v.totalAmount) || 0; });
    }
    const extra = !!(await D.ref(`luckyPerks/${day}/${uid}/extraSpin`).once('value')).val();
    if (!extra && revenue < threshold) return res.status(400).json({error: pool === 'mkt' ? `Chưa đạt mốc: hôm nay đã nhập ${money(revenue)} / ${money(threshold)} số hợp lệ.` : `Chưa đạt mốc: đã cọc hôm nay ${money(revenue)}đ / ${money(threshold)}đ.`, revenue});
    // Chọn giải theo tỉ lệ
    const tot = prizes.reduce((a, p) => a + Number(p.w), 0); let r = Math.random() * tot, i = 0;
    for (; i < prizes.length; i++) { r -= Number(prizes[i].w); if (r < 0) break; } if (i >= prizes.length) i = prizes.length - 1;
    const p = prizes[i];
    const prize = {key: p.key, name: p.name || p.short || p.key, short: p.short || p.name || p.key, kind: p.kind || 'manual', n: Number(p.n) || null};
    let outcome = '', rank = null;
    const tx = await D.ref('luckySpin/' + day).transaction(cur => {
      cur = cur || {};
      if (cur[uid]) { outcome = 'done'; return; }
      const used = Object.values(cur).filter(x => x && !x.extra && !x.revoked && (x.pool || 'sale') === pool).length;
      if (!extra && used >= maxPerDay) { outcome = 'full'; return; }
      outcome = 'ok'; rank = extra ? null : used + 1;
      cur[uid] = {uid, name: u.name || '', branchId: (pool === 'mkt' ? u.mktBranchId : u.branchId) || null, pool: pool === 'mkt' ? 'mkt' : null, rank, extra: extra || null, revenue, prize, at: now};
      return cur;
    });
    if (!tx.committed) {
      if (outcome === 'done') { const old = (tx.snapshot.val() || {})[uid] || {}; return res.json({ok: true, already: true, prize: old.prize, rank: old.rank || null, revenue}); }
      return res.status(409).json({error: `Hôm nay đã đủ ${maxPerDay} người quay — mai nhanh tay hơn nhé!`});
    }
    // Quyền lợi app tự áp dụng
    const inc = admin.database.ServerValue.increment, up = {};
    if (prize.kind === 'data' && prize.n) up[`luckyPerks/${tomorrow}/${uid}/priorityData`] = inc(prize.n);
    if (prize.kind === 'extra') up[`luckyPerks/${tomorrow}/${uid}/extraSpin`] = true;
    if (prize.kind === 'pass') up[`penaltyPasses/${uid}`] = inc(1);
    if (prize.kind === 'mktpass') up[`mktPasses/${uid}`] = inc(1); // 🛡️ thẻ miễn khoá nhập data (MKT)
    if (Object.keys(up).length) await D.ref().update(up);
    return res.json({ok: true, prize, rank, revenue});
  } catch (e) {
    console.error('lucky-spin', e);
    return res.status(500).json({error: 'Máy chủ lỗi, thử lại sau ít phút.'});
  }
};
