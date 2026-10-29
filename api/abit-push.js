// POST /api/abit-push  {invoiceId}  (kèm Authorization: Bearer <Firebase ID token>)
// Kho đóng xong → tạo đơn bên Abit từ hoá đơn trong app. Gộp theo MÃ SP (Abit không có màu), màu/mẫu ghi vào ghi chú.
const {admin, db, carrierName} = require('./_shared');

function num(v){ const n = Number(v); return isFinite(n) ? n : 0; }
function buildOrder(inv, ps, username){
  const groups = {}; const detail = {};
  (inv.productGroups || []).forEach(g=>{
    const code = String(g.productCode || '').trim(); if(!code) return;
    const price = num(g.unitPrice);
    const qty = (g.colorLines || []).reduce((a,l)=>a + num(l.qty), 0); if(!qty) return;
    const k = code + '|' + price;
    if(!groups[k]) groups[k] = {price, amount:0, productName: g.productName || code, productcode: code};
    groups[k].amount += qty;
    (g.colorLines || []).forEach(l=>{
      const q = num(l.qty); if(!q) return;
      const d = [g.design, l.color, l.size].filter(Boolean).join(' ');
      (detail[code] = detail[code] || []).push(`${d || '—'} ×${q}`);
    });
  });
  const storeId = Number(process.env.ABIT_STORE_ID || 0); // ID kho trên Abit (chinhbad = 25875)
  const listProduct = Object.values(groups).map(x=>Object.assign({
    price: String(x.price), amount: String(x.amount), productName: x.productName, productcode: x.productcode,
    weight: '0', discount_percent_product: '0', discount_amount_product: '0', tax1: '0', qtyinstock: '0'
  }, storeId ? {storeId} : {}));
  const subtotal = Object.values(groups).reduce((a,x)=>a + x.price * x.amount, 0);
  const ghichu1 = Object.entries(detail).map(([c, arr])=>`${c}: ${arr.join(' · ')}`).join(' | ').slice(0, 1000);
  const custPhone = String(inv.customerPhone || '').replace(/\D/g, '');
  const phone = String(inv.shipPhone || '').replace(/\D/g, '') || custPhone; // SĐT NHẬN HÀNG (in trên tem); khác SĐT khách thì ghi chú lại
  return {
    name: inv.customerName || phone || 'Khách',
    telephone: phone,
    name_receiver: inv.shipName || inv.customerName || phone || 'Khách', // TÊN NGƯỜI NHẬN (in trên tem)
    invoicestatus: process.env.ABIT_STATUS || 'AutoCreated',
    city: (inv.shipAddr && inv.shipAddr.province) || '', district: (inv.shipAddr && inv.shipAddr.district) || '',
    address: inv.shipAddress || 'Chưa có địa chỉ — bổ sung trên Abit',
    note: `HĐ app ${inv.invoiceNumber || ''} · Sale ${inv.saleName || ''}${custPhone && custPhone !== phone ? ' · SĐT khách đặt: ' + custPhone : ''}`,
    ghichu1,
    ghichu2: String(inv.invoiceNumber || ''),
    notevanchuyen: ps && ps.pkgs ? `${ps.pkgs} kiện` : '',
    discount_percent: '0.000', discount_amount: '0.000', s_h_amount: '0.000',
    giamgia: '0', phuthu: '0', phivanchuyen: '0', adjustment: '0.000',
    taxtype: 'individual',
    deposits: num(inv.deposit),
    subtotal, taxtotal_invoice: '0.000', total: subtotal,
    accountid: 0,
    username: username || '', // TÊN ĐĂNG NHẬP ABIT của Sale → Abit gán đơn đúng nhân viên
    listProduct
  };
}

module.exports = async (req, res)=>{
  if(req.method !== 'POST') return res.status(405).json({ok:false, error:'Chỉ nhận POST'});
  let lockRef = null;
  try{
    const D = db();
    const tok = String(req.headers.authorization || '').replace(/^Bearer\s+/i, '');
    if(!tok) return res.status(401).json({ok:false, error:'Thiếu đăng nhập'});
    await admin.auth().verifyIdToken(tok);
    const id = String((req.body || {}).invoiceId || '');
    if(!/^[\w-]{3,80}$/.test(id)) return res.status(400).json({ok:false, error:'Mã hoá đơn không hợp lệ'});
    const [invS, psS] = await Promise.all([D.ref('invoices/' + id).once('value'), D.ref('packStatus/' + id).once('value')]);
    const inv = invS.val(), ps = psS.val();
    if(!inv) return res.status(404).json({ok:false, error:'Không thấy hoá đơn'});
    if(!ps || ps.legacy || !(ps.state === 'packed' || ps.state === 'partial')) return res.status(400).json({ok:false, error:'Đơn chưa đóng xong — chưa đẩy sang Abit'});
    if(inv.abit && inv.abit.invoice_no) return res.json({ok:true, invoice_no: inv.abit.invoice_no, existed:true}); // đã đẩy rồi → không tạo trùng
    // Tên đăng nhập Abit của Sale (Quản lý chung điền ở Cài đặt → Sửa). Chưa có → KHÔNG đẩy, tránh Abit chia đơn ngẫu nhiên
    const username = inv.saleId ? String((await D.ref('users/' + inv.saleId + '/abitAccount').once('value')).val() || '').trim() : '';
    if(!username) return res.status(400).json({ok:false, error:'Sale của đơn chưa có tên đăng nhập Abit — Quản lý chung vào Cài đặt → Sửa để điền'});
    // Khoá 60 giây chống đẩy 2 lần cùng lúc
    lockRef = D.ref('abitLocks/' + id);
    const tx = await lockRef.transaction(cur=> (cur && Date.now() - cur < 60000) ? undefined : Date.now());
    if(!tx.committed){ lockRef = null; return res.status(409).json({ok:false, error:'Đơn đang được đẩy, thử lại sau ít phút'}); }
    const order = buildOrder(inv, ps, username);
    if(!order.listProduct.length) throw new Error('Hoá đơn không có sản phẩm');
    const r = await fetch(process.env.ABIT_CREATE_URL, {method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify([order])});
    const text = await r.text(); let j = null; try{ j = JSON.parse(text); }catch(e){}
    const invNo = j && (j.invoice_no || (Array.isArray(j) && j[0] && j[0].invoice_no) || (j.data && j.data.invoice_no));
    if(!invNo){
      const err = (j && (j.message || j.msg)) || text.slice(0, 200) || ('HTTP ' + r.status);
      await D.ref('invoices/' + id + '/abit').set({error: String(err), at: Date.now()});
      return res.status(502).json({ok:false, error: String(err)});
    }
    const now = Date.now();
    await D.ref().update({
      ['invoices/' + id + '/abit']: {invoice_no: String(invNo), invoiceid: String((j && j.invoiceid) || ''), username, at: now},
      ['abitMap/' + String(invNo).replace(/[.#$\[\]\/]/g, '_')]: id
    });
    return res.json({ok:true, invoice_no: String(invNo)});
  }catch(e){
    return res.status(500).json({ok:false, error: String(e && e.message || e)});
  }finally{
    if(lockRef) lockRef.remove().catch(()=>{});
  }
};
module.exports.buildOrder = buildOrder;
