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
  {key:'iphone', name:'Tiền mặt 8.868.000đ', short:'8,868 triệu', kind:'manual', w:0.00001, icon:'💰'}];
const DEF_MKT = [
  {key:'jackpot', name:'Jackpot: tặng 100 sao', short:'100 sao', kind:'manual', w:3},
  {key:'star15', name:'Tặng 15 sao', short:'15 sao', kind:'manual', w:20},
  {key:'milk', name:'1 ly trà chanh', short:'Trà chanh', kind:'manual', w:18},
  {key:'star10', name:'Tặng 10 sao', short:'10 sao', kind:'manual', w:32},
  {key:'mktpass', name:'Thẻ miễn khoá nhập data', short:'Miễn khoá', kind:'mktpass', w:10},
  {key:'early', name:'Về sớm 1 tiếng', short:'Về sớm', kind:'manual', w:12},
  {key:'extra', name:'Thêm 1 lượt quay ngày mai', short:'+1 lượt', kind:'extra', w:5},
  {key:'iphone', name:'Tiền mặt 8.868.000đ', short:'8,868 triệu', kind:'manual', w:0.00001, icon:'💰'}];
// 📱 Giải đặc biệt (iPhone): tỉ lệ thật như cài; gộp mọi vòng tối đa 1 lần / năm (khoá ở luckyGrand/{năm})
const isGrand = p => !!(p && (p.key === 'iphone' || p.key === 'grand' || /iphone/i.test(String(p.name || ''))));
// 28/11: giải đặc biệt đổi từ iPhone → TIỀN MẶT 8.868.000đ (giữ nguyên tỉ lệ khoá + 1 giải / năm; key nội bộ vẫn là 'iphone' để khớp cài đặt cũ)
const GRAND_NAME = 'Tiền mặt 8.868.000đ', GRAND_SHORT = '8,868 triệu';
const grandName = p => isGrand(p) ? Object.assign({}, p, {name: GRAND_NAME, short: GRAND_SHORT, icon: '💰'}) : p;
const GRAND_W = 0.00001; // 🔒 tỉ lệ iPhone tối đa 0,00001% — dù cài đặt bị sửa cao hơn, máy chủ vẫn ép về mức này
// ⏰ Vòng quay CHUYÊN CẦN (làm sẵn, bật/tắt ở luckyCfgAtt.enabled): quay bằng lượt trong attBal/{uid} (left = thường, vip = VIP)
const DEF_ATT = [
  {key:'luck', name:'Chúc bạn may mắn lần sau', short:'May mắn sau', kind:'none', w:30}, {key:'early30', name:'Phiếu về sớm 30 phút', short:'Về sớm 30p', kind:'early', n:30, w:20},
  {key:'star5', name:'Tặng 5 sao', short:'5 sao', kind:'manual', w:20}, {key:'attspin1', name:'Thêm 1 lượt quay chuyên cần', short:'+1 lượt', kind:'attspin', n:1, w:14},
  {key:'star10', name:'Tặng 10 sao', short:'10 sao', kind:'manual', w:8}, {key:'tea', name:'1 ly trà chanh', short:'Trà chanh', kind:'manual', w:7},
  {key:'jackpot', name:'Jackpot: tặng 100 sao', short:'100 sao', kind:'manual', w:1}];
const DEF_ATTVIP = [
  {key:'iphone', name:'Tiền mặt 8.868.000đ', short:'8,868 triệu', kind:'manual', w:0.00001, icon:'💰'},
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
    if (body.pool === 'attvip') return res.status(400).json({error: 'Không có vòng chuyên cần VIP — đủ 5 ngày đúng giờ thì Sale / MKT được thêm lượt ở vòng của mình.'});
    if (body.pool === 'att') return await attSpin(D, uid, u, 'att', res);
    if (u && u.role === 'packer') return await packSpin(D, uid, u, res); // 📦 vòng quay kho
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
    let revenue = 0, revenue2 = 0; // revenue2: doanh thu nguồn (chỉ MKT)
    if (pool === 'mkt') { // MKT: số SĐT hợp lệ đã nhập hôm nay (chỉ số hợp lệ, đã lọc trùng mới được ghi vào kho)
      const ls = await D.ref('leads').orderByChild('createdBy').equalTo(uid).once('value');
      ls.forEach(c => { const v = c.val(); const t = Number(v && v.importedAt); if (t >= dayStart && t < dayStart + 86400000) revenue++; });
      // 💵 + doanh thu Sale chốt HÔM NAY từ các Nguồn MKT này phụ trách (data chốt hôm nay đều được sửa hôm nay → lọc theo _u)
      const clean = x => String(x || '').normalize('NFC').replace(/[\u200B-\u200D\uFEFF\u00A0]/g, ' ').replace(/\s+/g, ' ').trim();
      const srcs = new Set((u.assignedSources || []).map(clean).filter(Boolean));
      if (srcs.size) {
        const cs = await D.ref('leads').orderByChild('_u').startAt(dayStart).once('value');
        cs.forEach(c => { const v = c.val(); if (!v || v.status !== 'Đã chốt' || v.recare || v.closedDate !== day) return;
          let src = v.source; if (!src && v.raw) { const k = Object.keys(v.raw).find(k => /ngu[oôồ]n/i.test(k) || /source/i.test(k)); if (k) src = v.raw[k]; }
          if (srcs.has(clean(src))) revenue2 += Number(v.closedAmount) || 0; });
      }
    } else { // Sale: doanh số ĐÃ CỌC hôm nay (theo giờ đánh dấu cọc — giống phần Mục tiêu)
      const snap = await D.ref('invoices').orderByChild('depositLink/markedAt').startAt(dayStart).endAt(dayStart + 86400000 - 1).once('value');
      snap.forEach(c => { const v = c.val(); if (v && v.saleId === uid && v.depositLink) revenue += Number(v.totalAmount) || 0; });
    }
    const extra = !!(await D.ref(`luckyPerks/${day}/${uid}/extraSpin`).once('value')).val();
    const thrRev = Number(cv.thrRev) || 10000000;
    const earned = Math.floor(revenue / threshold) + (pool === 'mkt' ? Math.floor(revenue2 / thrRev) : 0); // 🔁 mỗi 1 mốc = 1 lượt — không giới hạn số lượt, không giới hạn số người
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
    if (!extraFree && !bonusHeld && earned < 1) return res.status(400).json({error: pool === 'mkt' ? `Chưa đạt mốc: hôm nay đã nhập ${money(revenue)} / ${money(threshold)} số hợp lệ · doanh thu nguồn ${money(revenue2)}đ / ${money(thrRev)}đ.` : `Chưa đạt mốc: đã cọc hôm nay ${money(revenue)}đ / ${money(threshold)}đ.`, revenue});
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
    p = grandName(p); const prize = {key: p.key, name: p.name || p.short || p.key, short: p.short || p.name || p.key, kind: p.kind || 'manual', n: Number(p.n) || null, icon: p.icon || null};
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
        if (!tier) { outcome = 'below'; need = (Math.max(...tiers) + 1) * threshold; return; } // (MKT: thông báo riêng bên dưới)
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
      if (outcome === 'below') return res.status(400).json({error: pool === 'mkt' ? `Bạn đã quay hết lượt — nhập thêm ${money(threshold - (revenue % threshold))} số hợp lệ hoặc thêm ${money(thrRev - (revenue2 % thrRev))}đ doanh thu nguồn để có lượt tiếp.` : `Bạn đã quay hết lượt — đạt ${money(need)}đ đã cọc để có lượt tiếp.`, revenue});
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
// 📋 DATA TỰ TÌM → lượt chuyên cần: Sale điền mỗi 15 SĐT hợp lệ (mới, không trùng) trong NGÀY vào "Data tự tìm" = +1 lượt chuyên cần
// (tính từ 28/11/2026, để dành được; quay khi vòng chuyên cần được bật). Máy chủ tự đếm lại từ selfLeads mỗi lần quay → không sửa tay được.
const SELF_FROM = '2026-11-28', SELF_PER = 15;
const selfNorm = raw => { let d = String(raw || '').replace(/[^\d+]/g, ''); if (d.startsWith('+84')) d = '0' + d.slice(3); else if (d.startsWith('84') && d.length === 11) d = '0' + d.slice(2);
  d = d.replace(/\D/g, ''); if (d.length === 9 && /^[35789]/.test(d)) d = '0' + d; return /^0[35789]\d{8}$/.test(d) ? d : null; };
const selfFb = raw => { const m = String(raw || '').trim().toLowerCase().match(/(?:https?:\/\/)?(?:www\.|m\.|web\.|mbasic\.|business\.)?(facebook\.com|fb\.com|fb\.me|m\.me)\/([^\s?#]+)(\?[^\s#]*)?/);
  if (!m) return null; const path = m[2].replace(/\/+$/, ''), q = m[3] || '';
  if (/^profile\.php$/.test(path)) { const id = (q.match(/[?&]id=(\d+)/) || [])[1]; return id ? 'fb:' + id : null; }
  if (/^people\//.test(path)) { const id = (path.match(/(\d{6,})$/) || [])[1]; if (id) return 'fb:' + id; }
  return path.length >= 3 ? 'fb:' + path : null; };
const selfKey = raw => selfNorm(raw) || selfFb(raw); // SĐT HOẶC link Facebook đều tính
const SELF_OK_STATUS = ['đã liên hệ', 'đã nhắn tin', 'nhắn tin chưa gọi', 'đã gọi', 'đang tư vấn', 'đã lên hđ', 'đã chốt', 'không có nhu cầu']; // phải ĐÃ liên hệ / nhắn tin mới tính
async function selfEarned(D, uid) {
  const rows = Object.values((await D.ref('selfLeads').orderByChild('userId').equalTo(uid).once('value')).val() || {}).sort((a, b) => (Number(a.createdAt) || 0) - (Number(b.createdAt) || 0));
  const seen = new Set(), perDay = {};
  rows.forEach(r => { const ph = selfKey(r && r.phone); if (!ph || seen.has(ph) || !SELF_OK_STATUS.includes(String(r.status || '').trim().toLowerCase())) return; seen.add(ph); const d = vnDay(Number(r.createdAt) || 0); if (d >= SELF_FROM) perDay[d] = (perDay[d] || 0) + 1; });
  return Object.values(perDay).reduce((a, n) => a + Math.floor(n / SELF_PER), 0);
}
async function attSpin(D, uid, u, pool, res) {
  if (!u || u.active === false || u.loginBlocked || !['staff', 'team_manager', 'mkt', 'mkt_manager'].includes(u.role)) return res.status(403).json({error: 'Vòng quay chuyên cần chỉ dành cho Sale và MKT.'});
  const cfg = (await D.ref('luckyCfgAtt').once('value')).val() || {};
  // Chưa bật chấm công: Sale vẫn quay được lượt chuyên cần có từ Data tự tìm (từ 28/11) + lượt "+1" trúng thưởng
  if (!cfg.enabled && !(pool === 'att' && ['staff', 'team_manager'].includes(u.role))) return res.status(403).json({error: 'Vòng quay chuyên cần chưa áp dụng.'});
  const cv = pool === 'attvip' ? ((await D.ref('luckyCfgAttVip').once('value')).val() || {}) : cfg;
  let prizes = (Array.isArray(cv.prizes) && cv.prizes.length ? cv.prizes : (pool === 'attvip' ? DEF_ATTVIP : DEF_ATT)).filter(p => p && p.key && Number(p.w) > 0);
  prizes = pool === 'attvip' ? prizes.map(x => isGrand(x) ? Object.assign({}, x, {w: Math.min(Number(x.w), GRAND_W)}) : x) : prizes.filter(x => !isGrand(x)); // iPhone chỉ ở vòng VIP
  const now = Date.now(), day = vnDay(now), year = day.slice(0, 4), grandRef = D.ref('luckyGrand/' + year);
  if (prizes.some(isGrand) && (await grandRef.once('value')).exists()) prizes = prizes.filter(x => !isGrand(x));
  if (!prizes.length) return res.status(500).json({error: 'Chưa cài giải thưởng.'});
  const f = pool === 'attvip' ? 'vip' : 'left', bRef = D.ref('attBal/' + uid);
  let held = await bRef.transaction(cur => (cur && Number(cur[f]) > 0) ? Object.assign({}, cur, {[f]: Number(cur[f]) - 1}) : undefined), viaSelf = false;
  if (!held.committed && pool === 'att' && ['staff', 'team_manager'].includes(u.role)) { // hết lượt chấm công → dùng lượt từ Data tự tìm
    const earned = await selfEarned(D, uid);
    held = await bRef.transaction(cur => { cur = cur || {}; const sp = Number(cur.selfSpun) || 0; return sp < earned ? Object.assign({}, cur, {selfSpun: sp + 1}) : undefined; });
    viaSelf = held.committed;
  }
  if (!held.committed) return res.status(400).json({error: pool === 'attvip' ? 'Bạn chưa có lượt VIP — đúng giờ 5 ngày liên tiếp để có.' : 'Bạn chưa có lượt quay chuyên cần — vào làm đúng giờ' + (['staff', 'team_manager'].includes(u.role) ? ' hoặc có đủ 15 SĐT / link FB mới đã liên hệ / nhắn tin trong Data tự tìm hôm nay' : '') + ' để có.'});
  const pick = list => { const tot = list.reduce((a, x) => a + Number(x.w), 0); let r = Math.random() * tot, k = 0;
    for (; k < list.length; k++) { r -= Number(list[k].w); if (r < 0) break; } return list[Math.min(k, list.length - 1)]; };
  let p = pick(prizes);
  if (isGrand(p)) { const g = await grandRef.transaction(cur => cur ? undefined : {uid, name: u.name || '', pool, day, at: now});
    if (!g.committed) { prizes = prizes.filter(x => !isGrand(x)); p = pick(prizes); } }
  p = grandName(p); const prize = {key: p.key, name: p.name || p.short || p.key, short: p.short || p.name || p.key, kind: p.kind || 'manual', n: Number(p.n) || null, icon: p.icon || null};
  const ref = D.ref('luckySpin/' + day).push(), key = ref.key;
  try { await ref.set({uid, k: key, name: u.name || '', branchId: u.branchId || u.mktBranchId || null, pool, revenue: null, prize, at: now}); }
  catch (e) { try { if (viaSelf) await bRef.child('selfSpun').transaction(v => Math.max(0, (Number(v) || 0) - 1)); else await bRef.child(f).transaction(v => (Number(v) || 0) + 1); } catch (e2) {} throw e; }
  const inc = admin.database.ServerValue.increment, up = {};
  if (prize.kind === 'attspin') up[`attBal/${uid}/left`] = inc(Number(prize.n) || 1);
  if (prize.kind === 'early') { const pk = D.ref('earlyPasses/' + uid).push().key; up[`earlyPasses/${uid}/${pk}`] = {min: Number(prize.n) || 30, at: now, exp: now + 7 * 86400000, from: key}; }
  if (Object.keys(up).length) await D.ref().update(up);
  // 🎁 Lượt chuyên cần (kể cả lượt từ Data tự tìm) cũng ĐẾM GỘP vào "5 lượt tặng 1 lượt đặc biệt" (luckyBonus — quay ở vòng Sale / MKT của mình)
  let gift = false;
  if (pool === 'att') { try { await D.ref('luckyBonus/' + uid).transaction(cur => { cur = cur || {}; const n = (Number(cur.n) || 0) + 1; gift = n % 5 === 0; return Object.assign({}, cur, {n, left: (Number(cur.left) || 0) + (gift ? 1 : 0)}); }); } catch (e) {} }
  return res.json({ok: true, prize, pool, gift});
}

// 📦 Quay vòng KHO: lượt = floor(tổng sp đã nhặt từ 28/11 / mốc) + lượt +1 trúng thưởng − đã quay; + lượt tặng 🎁 (luckyBonus, đủ 5 tặng 1)
const DEF_PACK = [
  {key:'special', name:'Giải đặc biệt 50k', short:'Đặc biệt 50k', kind:'manual', w:2, icon:'🎁'}, {key:'cash5', name:'5k tiền mặt', short:'5k', kind:'manual', w:30, icon:'💵'},
  {key:'tea', name:'1 ly trà chanh', short:'Trà chanh', kind:'manual', w:8, icon:'🍋'}, {key:'milkbox', name:'1 hộp sữa nhỏ', short:'Hộp sữa', kind:'manual', w:25, icon:'🥛'},
  {key:'noclean', name:'Miễn dọn kho / đổ rác 1 lần', short:'Miễn dọn kho', kind:'manual', w:10}, {key:'luck', name:'Chúc bạn may mắn lần sau', short:'May mắn sau', kind:'none', w:15},
  {key:'packspin', name:'Thêm 1 lượt quay', short:'+1 lượt', kind:'packspin', n:1, w:10}];
async function packSpin(D, uid, u, res) {
  if (u.active === false || u.loginBlocked || u.sharedDesk) return res.status(403).json({error: 'Tài khoản này không quay được.'});
  const cv = (await D.ref('luckyCfgPack').once('value')).val() || {};
  const thr = Math.max(50, Number(cv.threshold) || 500);
  let prizes = (Array.isArray(cv.prizes) && cv.prizes.length ? cv.prizes : DEF_PACK).filter(p => p && p.key && Number(p.w) > 0 && !isGrand(p));
  if (!prizes.length) return res.status(500).json({error: 'Chưa cài giải thưởng.'});
  const pRef = D.ref('packCount/' + uid), bRef = D.ref('luckyBonus/' + uid);
  let kind = '', qty = 0;
  const tx = await pRef.transaction(cur => { cur = cur || {}; qty = Object.values(cur.days || {}).reduce((a, x) => a + (Number(x) || 0), 0);
    const earned = Math.floor(qty / thr) + (Number(cur.extra) || 0), spun = Number(cur.spun) || 0;
    if (spun >= earned) { kind = ''; return; } kind = 'tier'; return Object.assign({}, cur, {spun: spun + 1}); });
  let bonusUsed = false;
  if (!tx.committed) { // hết lượt theo mốc → dùng lượt tặng nếu có
    const b = await bRef.transaction(cur => (cur && Number(cur.left) > 0) ? Object.assign({}, cur, {left: Number(cur.left) - 1}) : undefined);
    if (!b.committed) return res.status(400).json({error: `Bạn chưa có lượt — nhặt thêm ${(thr - (qty % thr)).toLocaleString('vi-VN')} sp để có lượt tiếp.`});
    bonusUsed = true;
  }
  const pick = list => { const tot = list.reduce((a, x) => a + Number(x.w), 0); let r = Math.random() * tot, k = 0;
    for (; k < list.length; k++) { r -= Number(list[k].w); if (r < 0) break; } return list[Math.min(k, list.length - 1)]; };
  const now = Date.now(), day = vnDay(now), grandRef = D.ref('luckyGrand/' + day.slice(0, 4));
  // 🌟 Lượt tặng (đủ 5 lượt) = VÒNG ĐẶC BIỆT: thêm ô giải đặc biệt 8.868.000đ, tỉ lệ khoá GRAND_W, mỗi năm 1 giải
  if (bonusUsed && !(await grandRef.once('value')).exists()) prizes = prizes.concat([{key: 'iphone', name: GRAND_NAME, short: GRAND_SHORT, kind: 'manual', w: GRAND_W, icon: '💰'}]);
  let p = pick(prizes);
  if (isGrand(p)) { const g = await grandRef.transaction(cur => cur ? undefined : {uid, name: u.name || '', pool: 'pack', day, at: now});
    if (!g.committed) { prizes = prizes.filter(x => !isGrand(x)); p = pick(prizes); } }
  p = grandName(p); const prize = {key: p.key, name: p.name || p.short || p.key, short: p.short || p.name || p.key, kind: p.kind || 'manual', n: Number(p.n) || null, icon: p.icon || null};
  const ref = D.ref('luckySpin/' + day).push(), key = ref.key;
  await ref.set({uid, k: key, name: u.name || '', pool: 'pack', bonus: bonusUsed || null, thr, revenue: qty, prize, at: now});
  const inc = admin.database.ServerValue.increment, up = {};
  if (prize.kind === 'packspin') up[`packCount/${uid}/extra`] = inc(Number(prize.n) || 1);
  if (Object.keys(up).length) await D.ref().update(up);
  if (!bonusUsed) await bRef.transaction(cur => { cur = cur || {}; const n = (Number(cur.n) || 0) + 1; return Object.assign({}, cur, {n, left: (Number(cur.left) || 0) + (n % 5 === 0 ? 1 : 0)}); });
  return res.json({ok: true, prize, pool: 'pack', bonus: bonusUsed});
}
