// POST /api/abit-webhook?key=<ABIT_WEBHOOK_KEY>
// Abit tự gửi về khi đơn đổi trạng thái → app tự điền MÃ VẬN ĐƠN + trạng thái giao hàng.
const {db, carrierName} = require('./_shared');

module.exports = async (req, res)=>{
  if(String((req.query || {}).key || '') !== String(process.env.ABIT_WEBHOOK_KEY || '_')) return res.status(403).json({Received:'false'});
  try{
    const D = db();
    const b = (typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {}));
    const invNo = String(b.invoice_no || '');
    if(!invNo) return res.json({Received:'true'});
    const id = (await D.ref('abitMap/' + invNo.replace(/[.#$\[\]\/]/g, '_')).once('value')).val();
    if(!id) return res.json({Received:'true'}); // đơn không do app tạo → bỏ qua
    const now = Date.now();
    const status = String(b.invoice_status || b.invoicestatus || '');
    const tracking = String(b.tracking_no || b.mavandon || '').trim();
    const upd = {};
    upd['invoices/' + id + '/abit/status'] = status || null;
    upd['invoices/' + id + '/abit/statusAt'] = now;
    if(tracking) upd['invoices/' + id + '/abit/tracking'] = tracking;
    if(b.donvi_vc) upd['invoices/' + id + '/abit/carrier'] = String(b.donvi_vc);
    // Tự điền vận đơn nếu Sale chưa điền (hoặc lần trước cũng do Abit điền)
    if(tracking){
      const ship = (await D.ref('packStatus/' + id + '/ship').once('value')).val();
      const hasManual = ship && !ship.auto && ((ship.codes && ship.codes.length) || ship.code);
      if(!hasManual){
        upd['packStatus/' + id + '/ship'] = {at: now, by: 'abit', byName: 'Abit tự động', auto: true,
          carrier: carrierName(b.donvi_vc) || (ship && ship.carrier) || null, code: tracking, codes: [tracking]};
      }
    }
    // Nhật ký (giữ 1 bản ghi cuối mỗi trạng thái)
    if(status) upd['abitEvents/' + id + '/' + status] = {at: now, tracking: tracking || null};
    await D.ref().update(upd);
    return res.json({Received:'true'});
  }catch(e){
    console.error(e);
    return res.status(200).json({Received:'true'}); // vẫn báo đã nhận để Abit không gửi lặp vô hạn
  }
};
