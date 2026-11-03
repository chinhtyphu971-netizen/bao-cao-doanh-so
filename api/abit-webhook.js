// POST /api/abit-webhook?key=<ABIT_WEBHOOK_KEY>
// Abit tự gửi về khi đơn đổi trạng thái → app tự điền MÃ VẬN ĐƠN + trạng thái giao hàng.
//
// Bản này chịu được nhiều kiểu dữ liệu Abit có thể gửi:
//   - 1 đối tượng JSON, MẢNG JSON [{...}], dạng form (x-www-form-urlencoded), hoặc bọc trong {data: ...}
//   - Tên trường khác nhau: mã vận đơn (tracking_no / tracking_code / mavandon / ma_van_don / billcode ...),
//     số đơn Abit (invoice_no / invoiceno ...), hãng (donvi_vc / carrier ...)
//   - Không tra được đơn qua abitMap → tìm theo SỐ HOÁ ĐƠN APP (ghichu2 lúc đẩy sang Abit)
// Mỗi lần Abit gửi về đều được GHI NHẬT KÝ ở Firebase: abitWebhookLog (giữ 2 ngày, dọn theo khoá — không tải cả nhánh) — để xem Abit gửi gì
// khi mã không tự điền (mở Firebase Console → Realtime Database → abitWebhookLog).
const {db, carrierName} = require('./_shared');

const KEY_INVNO = ['invoice_no', 'invoiceno', 'invoice_number', 'invoicenumber', 'ma_don', 'madon', 'order_no', 'orderno', 'so_hd', 'sohd'];
const KEY_TRACK = ['tracking_no', 'trackingno', 'tracking_code', 'trackingcode', 'tracking', 'mavandon', 'ma_van_don', 'ma_vd', 'mavd',
  'billcode', 'bill_code', 'shipping_code', 'shippingcode', 'shipment_code', 'waybill', 'waybill_no', 'label_id', 'ma_vc', 'mavc'];
const KEY_CARRIER = ['donvi_vc', 'donvivc', 'don_vi_vc', 'carrier', 'shipping_unit', 'dvvc', 'hang_vc', 'transport', 'shipper'];
const KEY_STATUS = ['invoice_status', 'invoicestatus', 'status', 'trang_thai', 'trangthai'];
const KEY_APPNO = ['ghichu2', 'ghi_chu_2', 'note2'];

// Đọc body về dạng danh sách các đơn (mỗi phần tử là 1 đối tượng phẳng, khoá viết thường)
function parseBody(req){
  let b = req.body;
  if(Buffer.isBuffer(b)) b = b.toString('utf8');
  if(typeof b === 'string'){
    const s = b.trim();
    if(s.startsWith('{') || s.startsWith('[')){ try{ b = JSON.parse(s); }catch(e){ b = {}; } }
    else { const o = {}; new URLSearchParams(s).forEach((v, k)=>{ o[k] = v; }); b = o; }
  }
  if(b && !Array.isArray(b) && typeof b === 'object' && b.data !== undefined){
    let d = b.data;
    if(typeof d === 'string'){ try{ d = JSON.parse(d); }catch(e){} }
    if(d && typeof d === 'object') b = Array.isArray(d) ? d : Object.assign({}, b, d);
  }
  const list = Array.isArray(b) ? b : [b || {}];
  return list.filter(x=>x && typeof x === 'object').map(x=>{
    const o = {};
    Object.entries(x).forEach(([k, v])=>{ o[String(k).toLowerCase()] = v; });
    return o;
  });
}
function pick(o, keys, fuzzy){
  for(const k of keys){ const v = o[k]; if(v !== undefined && v !== null && String(v).trim() !== '') return String(v).trim(); }
  if(fuzzy){ // khoá lạ nhưng có chữ "tracking" / "vandon" / "billcode"
    for(const [k, v] of Object.entries(o)){
      if(fuzzy.test(k) && v !== null && typeof v !== 'object' && String(v).trim() !== '') return String(v).trim();
    }
  }
  return '';
}
const safeKey = s=>String(s).replace(/[.#$\[\]\/]/g, '_');

async function findInvoiceId(D, invNo, appNo){
  if(invNo){
    const id = (await D.ref('abitMap/' + safeKey(invNo)).once('value')).val();
    if(id) return {id, via: 'abitMap'};
  }
  if(appNo){ // số hoá đơn app (ghichu2) — dùng chỉ mục invoiceNumber đã có trong Rules
    const snap = await D.ref('invoices').orderByChild('invoiceNumber').equalTo(appNo).limitToFirst(1).once('value');
    const v = snap.val(); const id = v ? Object.keys(v)[0] : null;
    if(id) return {id, via: 'invoiceNumber'};
  }
  return {id: null, via: ''};
}

async function handleOne(D, o, now){
  const invNo = pick(o, KEY_INVNO);
  const appNo = pick(o, KEY_APPNO);
  const tracking = pick(o, KEY_TRACK, /track|van_?don|bill_?code|waybill/);
  const carrierCode = pick(o, KEY_CARRIER);
  const status = pick(o, KEY_STATUS);
  const {id, via} = await findInvoiceId(D, invNo, appNo);
  const result = {invNo: invNo || null, appNo: appNo || null, tracking: tracking || null, carrier: carrierCode || null, status: status || null, invoiceId: id, via: via || null};
  if(!id){ result.note = 'Không tìm thấy hoá đơn trong app (không có trong abitMap, ghichu2 không khớp số HĐ)'; return result; }

  const upd = {};
  if(status){ upd['invoices/' + id + '/abit/status'] = status; upd['invoices/' + id + '/abit/statusAt'] = now; }
  if(invNo){
    upd['invoices/' + id + '/abit/invoice_no'] = invNo;
    if(via !== 'abitMap') upd['abitMap/' + safeKey(invNo)] = id; // lần sau tra nhanh
  }
  if(tracking) upd['invoices/' + id + '/abit/tracking'] = tracking;
  if(carrierCode) upd['invoices/' + id + '/abit/carrier'] = carrierCode;

  if(tracking){
    const ship = (await D.ref('packStatus/' + id + '/ship').once('value')).val();
    const manualCodes = ship && !ship.auto ? ((Array.isArray(ship.codes) && ship.codes.length) ? ship.codes : (ship.code ? [ship.code] : [])) : [];
    if(!manualCodes.length){
      // Sale chưa điền tay → Abit điền (giữ hãng Sale đã chọn nếu Abit không gửi hãng)
      upd['packStatus/' + id + '/ship'] = {at: (ship && ship.at) || now, by: 'abit', byName: 'Abit tự động', auto: true,
        carrier: carrierName(carrierCode) || (ship && ship.carrier) || null, code: tracking, codes: [tracking], autoAt: now};
      result.filled = true;
    } else if(!manualCodes.includes(tracking)){
      result.note = 'Sale đã tự điền mã khác → không ghi đè (mã Abit lưu ở invoices/' + id + '/abit/tracking)';
    }
  } else {
    result.note = 'Abit gửi về nhưng không có mã vận đơn (có thể trạng thái này chưa có mã)';
  }
  if(status) upd['abitEvents/' + id + '/' + safeKey(status)] = {at: now, tracking: tracking || null};
  if(Object.keys(upd).length) await D.ref().update(upd);
  return result;
}

module.exports = async (req, res)=>{
  const q = req.query || {};
  if(String(q.key || req.headers['x-webhook-key'] || '') !== String(process.env.ABIT_WEBHOOK_KEY || '_')) return res.status(403).json({Received:'false'});
  if(req.method === 'GET') return res.json({Received:'true', ok:true, note:'Webhook Abit đang chạy'}); // mở link trên trình duyệt để kiểm tra
  const now = Date.now();
  let D = null, results = [], raw = '';
  try{
    D = db();
    raw = typeof req.body === 'string' ? req.body : JSON.stringify(req.body || {});
    const items = parseBody(req);
    for(const o of items){
      try{ results.push(await handleOne(D, o, now)); }
      catch(e){ results.push({error: String(e && e.message || e)}); }
    }
  }catch(e){
    console.error(e);
    results.push({error: String(e && e.message || e)});
  }
  // Nhật ký: nguyên văn dữ liệu Abit gửi + kết quả xử lý (giữ 2 ngày, mỗi dòng ≤ 1.5KB)
  // TIẾT KIỆM DỮ LIỆU: dọn nhật ký cũ theo KHOÁ (push key xếp theo thời gian, Firebase luôn có sẵn chỉ mục)
  // và chỉ dọn thỉnh thoảng (~1/20 lượt) → mỗi lần chỉ đọc tối đa 40 dòng cũ nhất, không tải cả nhánh.
  // (Bản trước lọc theo trường "at" chưa có chỉ mục → Firebase tải TOÀN BỘ nhật ký mỗi lượt gọi — rất tốn.)
  try{
    if(D){
      const log = D.ref('abitWebhookLog');
      await log.push({at: now, contentType: String(req.headers['content-type'] || '').slice(0, 80), raw: String(raw).slice(0, 1500), results});
      if(Math.random() < 0.05){
        const old = await log.orderByKey().limitToFirst(40).once('value');
        const del = {}; old.forEach(c=>{ const v = c.val(); if(!v || !(Number(v.at) > now - 2*86400000)) del[c.key] = null; });
        if(Object.keys(del).length) await log.update(del);
      }
    }
  }catch(e){ console.error('ghi nhật ký webhook lỗi:', e); }
  return res.status(200).json({Received:'true'}); // luôn báo đã nhận để Abit không gửi lặp vô hạn
};
module.exports.parseBody = parseBody;
module.exports.handleOne = handleOne;
