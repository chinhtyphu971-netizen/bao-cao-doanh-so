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
  {key:'early', name:'Về sớm 1 tiếng', short:'Về sớm', kind:'manual', w:10},
  {key:'iphone', name:'iPhone 18', short:'iPhone 18', kind:'manual', w:0.0001}];
const DEF_MKT = [
  {key:'jackpot', name:'Jackpot: tặng 100 sao', short:'100 sao', kind:'manual', w:3},
  {key:'star15', name:'Tặng 15 sao', short:'15 sao', kind:'manual', w:20},
  {key:'milk', name:'1 ly trà chanh', short:'Trà chanh', kind:'manual', w:18},
  {key:'star10', name:'Tặng 10 sao', short:'10 sao', kind:'manual', w:32},
  {key:'mktpass', name:'Thẻ miễn khoá nhập data', short:'Miễn khoá', kind:'mktpass', w:10},
  {key:'early', name:'Về sớm 1 tiếng', short:'Về sớm', kind:'manual', w:12},
  {key:'extra', name:'Thêm 1 lượt quay ngày mai', short:'+1 lượt', kind:'extra', w:5},
  {key:'iphone', name:'iPhone 18', short:'iPhone 18', kind:'manual', w:0.0001}];
// 📱 Giải đặc biệt (iPhone): tỉ lệ thật như cài; gộp mọi vòng tối đa 1 lần / năm (khoá ở luckyGrand/{năm})
const isGrand = p => !!(p && (p.key === 'iphone' || /iphone/i.test(String(p.name || ''))));
const GRAND_W = 0.0001; // 🔒 tỉ lệ iPhone tối đa 0,0001% — dù cài đặt bị sửa cao hơn, máy chủ vẫn ép về mức này
// ⏰ Vòng quay CHUYÊN CẦN (làm sẵn, bật/tắt ở luckyCfgAtt.enabled): quay bằng lượt trong attBal/{uid} (left = thường, vip = VIP)
const DEF_ATT = [
  {key:'jackpot', name:'Jackpot: tặng 100 sao', short:'100 sao', kind:'manual', w:3},
  {key:'star10', name:'Tặng 10 sao', short:'10 sao', kind:'manual', w:20},
  {key:'tea', name:'1 ly trà chanh', short:'Trà chanh', kind:'manual', w:15},
  {key:'star5', name:'Tặng 5 sao', short:'5 sao', kind:'manual', w:35},
  {key:'early30', name:'Phiếu về sớm 30 phút', short:'Về sớm 30p', kind:'early', n:30, w:12},
  {key:'attspin1', name:'Thêm 1 lượt quay chuyên cần', short:'+1 lượt', kind:'attspin', n:1, w:15}];
const DEF_ATTVIP = [
  {key:'iphone', name:'iPhone 18', short:'iPhone 18', kind:'manual', w:0.0001},
  {key:'jackpot', name:'Jackpot: tặng 100 sao', short:'100 sao', kind:'manual', w:5},
  {key:'star30', name:'Tặng 30 sao', short:'30 sao', kind:'manual', w:40},
  {key:'early60', name:'Phiếu về sớm 1 tiếng', short:'Về sớm 1h', kind:'early', n:60, w:15},
  {key:'milk', name:'1 ly trà sữa', short:'Trà sữa', kind:'manual', w:25},
  {key:'attspin2', name:'Thêm 2 lượt quay chuyên cần', short:'+2 lượt', kind:'attspin', n:2, w:15}];
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
    let body = req.body || {}; if (typeof body === 'string') { try { body = JSON.parse(body); } catch (e) { body = {}; } }
    if (body.pool === 'att' || body.pool === 'attvip') return await attSpin(D, uid, u, body.pool === 'attvip' ? 'attvip' : 'att', res);
    // Vòng quay Sale (staff / team_manager) hoặc vòng quay MKT (mkt / mkt_manager) — theo vai trò, không tin vào máy gửi lên
    const pool = u && ['mkt', 'mkt_manager'].includes(u.role) ? 'mkt' : 'sale';
    if (!u || !['staff', 'team_manager', 'mkt', 'mkt_manager'].includes(u.role) || u.active === false || u.loginBlocked)
      return res.status(403).json({error: 'Tài khoản này không tham gia vòng quay. Nếu bạn là Sale / MKT: đăng xuất rồi đăng nhập lại.'});
    const cv = (await D.ref(pool === 'mkt' ? 'luckyCfgMkt' : 'luckyCfg').once('value')).val() || {};
    const threshold = Number(cv.threshold) || (pool === 'mkt' ? 500 : 10000000), maxPerDay = Number(cv.maxPerDay) || (pool === 'mkt' ? 3 : 5);
    let prizes = (Array.isArray(cv.prizes) && cv.prizes.length ? cv.prizes : (pool === 'mkt' ? DEF_MKT : DEF)).filter(p => p && p.key && Number(p.w) > 0);
    prizes = prizes.map(x => isGrand(x) ? Object.assign({}, x, {w: Math.min(Number(x.w), GRAND_W)}) : x);
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
    const earned = Math.floor(revenue / threshold); // 🔁 mỗi 1 mốc = 1 lượt — không giới hạn số lượt, không giới hạn số người
    // 🎁 LƯỢT TẶNG — đếm GỘP qua các ngày: luckyBonus/{uid} = {n: tổng lượt quay theo mốc, left: lượt tặng còn lại}
    // cứ mỗi 5 lượt theo mốc → left +1; lượt tặng để dành được, quay lúc nào cũng được
    const BONUS_EVERY = 5, bRef = D.ref('luckyBonus/' + uid);
    const tierOf = x => (x.extra || x.bonus) ? 0 : (Number(x.tier) || 1);
    const extraFree = !!extra && !Object.values((await D.ref('luckySpin/' + day).once('value')).val() || {}).some(x => x && x.uid === uid && x.extra);
    let bonusHeld = false;
    if (!extraFree && Number(((await bRef.once('value')).val() || {}).left) > 0) { // giữ 1 lượt tặng (trừ trước, quay hỏng thì trả lại)
      const b = await bRef.transaction(cur => (cur && Number(cur.left) > 0) ? Object.assign({}, cur, {left: Number(cur.left) - 1}) : undefined);
      bonusHeld = !!b.committed;
    }
    if (!extraFree && !bonusHeld && revenue < threshold) return res.status(400).json({error: pool === 'mkt' ? `Chưa đạt mốc: hôm nay đã nhập ${money(revenue)} / ${money(threshold)} số hợp lệ.` : `Chưa đạt mốc: đã cọc hôm nay ${money(revenue)}đ / ${money(threshold)}đ.`, revenue});
    // Chọn giải theo tỉ lệ (giải đặc biệt: năm nay đã có người trúng → bỏ khỏi danh sách)
    const year = day.slice(0, 4), grandRef = D.ref('luckyGrand/' + year);
    if (prizes.some(isGrand) && (await grandRef.once('value')).exists()) prizes = prizes.filter(x => !isGrand(x));
    if (!prizes.length) return res.status(500).json({error: 'Chưa cài giải thưởng.'});
    const pick = list => { const tot = list.reduce((a, x) => a + Number(x.w), 0); let r = Math.random() * tot, k = 0;
      for (; k < list.length; k++) { r -= Number(list[k].w); if (r < 0) break; } return list[Math.min(k, list.length - 1)]; };
    let p = pick(prizes), grandHeld = false;
    if (isGrand(p)) { // giữ suất 1 giải / năm bằng transaction — người khác vừa trúng trước thì quay lại giải khác
      const g = await grandRef.transaction(cur => cur ? undefined : {uid, name: u.name || '', pool, day, at: Date.now()});
      if (g.committed) grandHeld = true; else { prizes = prizes.filter(x => !isGrand(x)); p = pick(prizes); }
    }
    const prize = {key: p.key, name: p.name || p.short || p.key, short: p.short || p.name || p.key, kind: p.kind || 'manual', n: Number(p.n) || null, icon: p.icon || null};
    let outcome = '', rank = null, tier = 0, key = '', need = 0;
    const tx = await D.ref('luckySpin/' + day).transaction(cur => {
      cur = cur || {};
      const mine = Object.values(cur).filter(x => x && x.uid === uid), tiers = new Set(mine.filter(x => tierOf(x) >= 1).map(tierOf));
      let isExtra = false, bonus = 0; tier = 0; key = '';
      if (extra && !mine.some(x => x.extra)) { isExtra = true; key = uid + '_x'; }
      else if (bonusHeld) { bonus = mine.filter(x => x.bonus).length + 1; key = uid + '_b' + bonus; }
      else if (!tiers.has(1)) {
        if (earned < 1) { outcome = 'below'; need = threshold; return; }
        const used = Object.values(cur).filter(x => x && !x.extra && tierOf(x) === 1 && !x.revoked && (x.pool || 'sale') === pool).length;
        tier = 1; rank = used + 1; key = cur[uid] ? uid + '_t1' : uid;
      } else {
        for (let t = 2; t <= earned; t++) if (!tiers.has(t)) { tier = t; break; }
        if (!tier) { outcome = 'below'; need = (Math.max(...tiers) + 1) * threshold; return; }
        rank = null; key = uid + '_t' + tier;
      }
      outcome = 'ok';
      cur[key] = {uid, k: key, name: u.name || '', branchId: (pool === 'mkt' ? u.mktBranchId : u.branchId) || null, pool: pool === 'mkt' ? 'mkt' : null, rank: isExtra || bonus ? null : rank, tier: isExtra || bonus ? null : tier, extra: isExtra || null, bonus: bonus || null, thr: threshold, revenue, prize, at: now};
      return cur;
    });
    if (!tx.committed && grandHeld) { try { await grandRef.remove(); } catch (e) {} } // không quay được → trả lại suất giải đặc biệt
    const rec = tx.committed ? ((tx.snapshot.val() || {})[key] || {}) : {};
    if (bonusHeld && !rec.bonus) { try { await bRef.child('left').transaction(v => (Number(v) || 0) + 1); } catch (e) {} } // không dùng lượt tặng → trả lại
    let bonusLeft = null;
    if (tx.committed && rec.tier) { // quay theo mốc → cộng dồn; đủ 5 / 10 / 15… lượt → tặng 1 lượt
      const b = await bRef.transaction(cur => { cur = cur || {}; const n = (Number(cur.n) || 0) + 1; return Object.assign({}, cur, {n, left: (Number(cur.left) || 0) + (n % BONUS_EVERY === 0 ? 1 : 0)}); });
      bonusLeft = b.snapshot.val();
    }
    if (!tx.committed) {
      if (outcome === 'below') return res.status(400).json({error: pool === 'mkt' ? `Bạn đã quay hết lượt — nhập đủ ${money(need)} số hợp lệ để có lượt tiếp.` : `Bạn đã quay hết lượt — đạt ${money(need)}đ đã cọc để có lượt tiếp.`, revenue});
      return res.status(409).json({error: `Hôm nay đã đủ ${maxPerDay} người quay — mai nhanh tay hơn nhé!`});
    }
    // Quyền lợi app tự áp dụng
    const inc = admin.database.ServerValue.increment, up = {};
    if (prize.kind === 'data' && prize.n) up[`luckyPerks/${tomorrow}/${uid}/priorityData`] = inc(prize.n);
    if (prize.kind === 'extra') up[`luckyPerks/${tomorrow}/${uid}/extraSpin`] = true;
    if (prize.kind === 'pass') up[`penaltyPasses/${uid}`] = inc(1);
    if (prize.kind === 'mktpass') up[`mktPasses/${uid}`] = inc(1); // 🛡️ thẻ miễn khoá nhập data (MKT)
    if (Object.keys(up).length) await D.ref().update(up);
    return res.json({ok: true, prize, rank, tier, bonus: !!rec.bonus, bonusInfo: bonusLeft, revenue});
  } catch (e) {
    console.error('lucky-spin', e);
    return res.status(500).json({error: 'Máy chủ lỗi, thử lại sau ít phút.'});
  }
};

// ⏰ Quay vòng chuyên cần: trừ 1 lượt (transaction) → chọn giải → ghi luckySpin/{ngày}/{push} (pool att / attvip) → áp quyền lợi
async function attSpin(D, uid, u, pool, res) {
  if (!u || u.active === false || u.loginBlocked) return res.status(403).json({error: 'Tài khoản này không quay được.'});
  const cfg = (await D.ref('luckyCfgAtt').once('value')).val() || {};
  if (!cfg.enabled) return res.status(403).json({error: 'Vòng quay chuyên cần chưa áp dụng.'});
  const cv = pool === 'attvip' ? ((await D.ref('luckyCfgAttVip').once('value')).val() || {}) : cfg;
  let prizes = (Array.isArray(cv.prizes) && cv.prizes.length ? cv.prizes : (pool === 'attvip' ? DEF_ATTVIP : DEF_ATT)).filter(p => p && p.key && Number(p.w) > 0);
  prizes = pool === 'attvip' ? prizes.map(x => isGrand(x) ? Object.assign({}, x, {w: Math.min(Number(x.w), GRAND_W)}) : x) : prizes.filter(x => !isGrand(x)); // iPhone chỉ ở vòng VIP
  const now = Date.now(), day = vnDay(now), year = day.slice(0, 4), grandRef = D.ref('luckyGrand/' + year);
  if (prizes.some(isGrand) && (await grandRef.once('value')).exists()) prizes = prizes.filter(x => !isGrand(x));
  if (!prizes.length) return res.status(500).json({error: 'Chưa cài giải thưởng.'});
  const f = pool === 'attvip' ? 'vip' : 'left', bRef = D.ref('attBal/' + uid);
  const held = await bRef.transaction(cur => (cur && Number(cur[f]) > 0) ? Object.assign({}, cur, {[f]: Number(cur[f]) - 1}) : undefined);
  if (!held.committed) return res.status(400).json({error: pool === 'attvip' ? 'Bạn chưa có lượt VIP — đúng giờ 5 ngày liên tiếp để có.' : 'Bạn chưa có lượt quay chuyên cần — chấm công đúng giờ cả 2 lần trong ngày để có.'});
  const pick = list => { const tot = list.reduce((a, x) => a + Number(x.w), 0); let r = Math.random() * tot, k = 0;
    for (; k < list.length; k++) { r -= Number(list[k].w); if (r < 0) break; } return list[Math.min(k, list.length - 1)]; };
  let p = pick(prizes);
  if (isGrand(p)) { const g = await grandRef.transaction(cur => cur ? undefined : {uid, name: u.name || '', pool, day, at: now});
    if (!g.committed) { prizes = prizes.filter(x => !isGrand(x)); p = pick(prizes); } }
  const prize = {key: p.key, name: p.name || p.short || p.key, short: p.short || p.name || p.key, kind: p.kind || 'manual', n: Number(p.n) || null, icon: p.icon || null};
  const ref = D.ref('luckySpin/' + day).push(), key = ref.key;
  try { await ref.set({uid, k: key, name: u.name || '', branchId: u.branchId || u.mktBranchId || null, pool, revenue: null, prize, at: now}); }
  catch (e) { try { await bRef.child(f).transaction(v => (Number(v) || 0) + 1); } catch (e2) {} throw e; }
  const inc = admin.database.ServerValue.increment, up = {};
  if (prize.kind === 'attspin') up[`attBal/${uid}/left`] = inc(Number(prize.n) || 1);
  if (prize.kind === 'early') { const pk = D.ref('earlyPasses/' + uid).push().key; up[`earlyPasses/${uid}/${pk}`] = {min: Number(prize.n) || 30, at: now, exp: now + 7 * 86400000, from: key}; }
  if (Object.keys(up).length) await D.ref().update(up);
  return res.json({ok: true, prize, pool});
}
