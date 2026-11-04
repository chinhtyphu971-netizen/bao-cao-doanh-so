// POST /api/abit-push  {invoiceId}  (kèm Authorization: Bearer <Firebase ID token>)
// Kho đóng xong → tạo đơn bên Abit từ hoá đơn trong app. Gộp theo MÃ SP (Abit không có màu), màu/mẫu ghi vào ghi chú.
const {admin, db, carrierName} = require('./_shared');

function num(v){ const n = Number(v); return isFinite(n) ? n : 0; }
// part (tuỳ chọn) = 1 kiện khi đơn tách nhiều kiện: {i, n, items:[{code, price, qty, label}], deposit}
function buildOrder(inv, ps, username, part){
  const groups = {}; const detail = {};
  if(part){
    // Kiện i/N: chỉ hàng trong kiện này (đơn giá theo hoá đơn), gộp theo mã + giá
    const nameOf = {}; (inv.productGroups || []).forEach(g=>{ const c = String(g.productCode||'').trim().toUpperCase(); if(c && !nameOf[c]) nameOf[c] = g.productName || g.productCode; });
    part.items.forEach(it=>{
      const code = String(it.code||'').trim(); if(!code || !(it.qty > 0)) return;
      const k = code + '|' + it.price;
      if(!groups[k]) groups[k] = {price: it.price, amount: 0, productName: nameOf[code.toUpperCase()] || code, productcode: code};
      groups[k].amount += it.qty;
      (detail[code] = detail[code] || []).push(`${String(it.label||'').split(' · ').slice(1).join(' ') || '—'} ×${it.qty}`);
    });
  } else (inv.productGroups || []).forEach(g=>{
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
  // TIỀN CỌC: mặc định gửi Tổng = tiền hàng, cọc ghi riêng (deposits) — để Abit tự trừ khi tính tiền thu hộ (COD).
  // Nếu kiểm tra thấy Abit KHÔNG tự trừ (COD vẫn = tiền hàng) → bật biến môi trường ABIT_TOTAL_MINUS_DEPOSIT = 1 trên Vercel
  // để gửi Tổng = tiền hàng − cọc (COD đúng). KHÔNG bật nếu Abit đã tự trừ, kẻo trừ cọc 2 lần.
  const minusDeposit = String(process.env.ABIT_TOTAL_MINUS_DEPOSIT || '') === '1';
  const deposit = part ? Math.max(0, Math.min(subtotal, num(part.deposit))) : Math.max(0, Math.min(subtotal, num(inv.deposit)));
  const total = minusDeposit ? subtotal - deposit : subtotal;
  // Đơn nhiều kiện: ghi THẬT NỔI BẬT để kho Abit / shipper lấy & giao đủ (Abit chưa có trường số kiện riêng)
  const pkgs = part ? 1 : Math.max(1, Number(ps && ps.pkgs) || 1);
  const ghichu1 = ((part ? `[KIỆN ${part.i}/${part.n}] ` : (pkgs > 1 ? `[${pkgs} KIỆN] ` : '')) + Object.entries(detail).map(([c, arr])=>`${c}: ${arr.join(' · ')}`).join(' | ')).slice(0, 1000);
  const custPhone = String(inv.customerPhone || '').replace(/\D/g, '');
  const phone = String(inv.shipPhone || '').replace(/\D/g, '') || custPhone; // SĐT NHẬN HÀNG (in trên tem); khác SĐT khách thì ghi chú lại
  return Object.assign({
    name: inv.customerName || phone || 'Khách',
    telephone: phone,
    name_receiver: inv.shipName || inv.customerName || phone || 'Khách', // TÊN NGƯỜI NHẬN (in trên tem)
    invoicestatus: process.env.ABIT_STATUS || 'AutoCreated',
    city: (inv.shipAddr && inv.shipAddr.province) || '', district: (inv.shipAddr && inv.shipAddr.district) || '',
    address: inv.shipAddress || 'Chưa có địa chỉ — bổ sung trên Abit',
    note: `HĐ app ${inv.invoiceNumber || ''}${part ? ` · KIỆN ${part.i}/${part.n}` : ''} · Sale ${inv.saleName || ''}${custPhone && custPhone !== phone ? ' · SĐT khách đặt: ' + custPhone : ''}`,
    ghichu1,
    ghichu2: String(inv.invoiceNumber || ''),
    notevanchuyen: part ? `Kiện ${part.i}/${part.n} của HĐ ${inv.invoiceNumber || ''} (đơn tách ${part.n} kiện, mỗi kiện 1 vận đơn)` : (pkgs > 1 ? `⚠️ ĐƠN ${pkgs} KIỆN — lấy & giao đủ ${pkgs} kiện` : (ps && ps.pkgs ? '1 kiện' : '')),
    discount_percent: '0.000', discount_amount: '0.000', s_h_amount: '0.000',
    giamgia: '0', phuthu: '0', phivanchuyen: '0', adjustment: '0.000',
    taxtype: 'individual',
    deposits: deposit,
    subtotal, taxtotal_invoice: '0.000', total,
    accountid: 0,
    username: username || '', // TÊN ĐĂNG NHẬP ABIT của Sale → Abit gán đơn đúng nhân viên
    listProduct
  }, storeId ? {
    // KHO GỬI của cả đơn (không chỉ từng sản phẩm) — thiếu thì lúc "Gửi vận đơn" Abit báo "kiểm tra lại tên kho hàng gửi"
    storeid: String(storeId), productstoreid: storeId
  } : {});
}

// Đơn kho đã chia nhiều kiện (packStatus.pkgSplit) → danh sách kiện; cọc trừ lần lượt từ kiện 1
function splitParts(inv, ps){
  const sp = ps && ps.state === 'packed' && ps.pkgSplit; const n = sp ? Number(sp.n) || 0 : 0;
  if(!sp || n < 2 || !Array.isArray(sp.lines)) return null;
  const parts = Array.from({length: n}, (_, k)=>({i: k + 1, n, items: [], value: 0, deposit: 0}));
  sp.lines.forEach(l=>(l.q || []).forEach((qty, k)=>{ qty = Number(qty) || 0; if(qty > 0 && parts[k]){ parts[k].items.push({code: l.code, price: num(l.price), qty, label: l.label}); parts[k].value += qty * num(l.price); } }));
  if(parts.some(p=>!p.items.length)) return null; // kiện trống → coi như không tách
  let dep = Math.max(0, num(inv.deposit));
  parts.forEach(p=>{ const use = Math.min(dep, p.value); p.deposit = use; dep -= use; });
  return parts;
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
    const parts = splitParts(inv, ps);
    const doneParts = (inv.abit && inv.abit.parts) || {};
    if(inv.abit && inv.abit.invoice_no && (!parts || parts.every(p=>doneParts[p.i] && doneParts[p.i].invoice_no))) return res.json({ok:true, invoice_no: inv.abit.invoice_no, existed:true}); // đã đẩy rồi → không tạo trùng
    // Tên đăng nhập Abit của Sale (Quản lý chung điền ở Cài đặt → Sửa). Chưa có → KHÔNG đẩy, tránh Abit chia đơn ngẫu nhiên
    const username = inv.saleId ? String((await D.ref('users/' + inv.saleId + '/abitAccount').once('value')).val() || '').trim() : '';
    if(!username) return res.status(400).json({ok:false, error:'Sale của đơn chưa có tên đăng nhập Abit — Quản lý chung vào Cài đặt → Sửa để điền'});
    // Khoá 60 giây chống đẩy 2 lần cùng lúc
    lockRef = D.ref('abitLocks/' + id);
    const tx = await lockRef.transaction(cur=> (cur && Date.now() - cur < 60000) ? undefined : Date.now());
    if(!tx.committed){ lockRef = null; return res.status(409).json({ok:false, error:'Đơn đang được đẩy, thử lại sau ít phút'}); }
    const createOne = async (order)=>{
      if(!order.listProduct.length) throw new Error('Hoá đơn không có sản phẩm');
      const r = await fetch(process.env.ABIT_CREATE_URL, {method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify([order])});
      const text = await r.text(); let j = null; try{ j = JSON.parse(text); }catch(e){}
      const invNo = j && (j.invoice_no || (Array.isArray(j) && j[0] && j[0].invoice_no) || (j.data && j.data.invoice_no));
      if(!invNo) return {error: String((j && (j.message || j.msg)) || text.slice(0, 200) || ('HTTP ' + r.status))};
      return {invNo: String(invNo), invoiceid: String((j && j.invoiceid) || '')};
    };
    const mapKey = x=>'abitMap/' + String(x).replace(/[.#$\[\]\/]/g, '_');
    const now = Date.now();
    if(!parts){ // 1 kiện → 1 đơn như cũ
      const out = await createOne(buildOrder(inv, ps, username));
      if(out.error){ await D.ref('invoices/' + id + '/abit').set({error: out.error, at: Date.now()}); return res.status(502).json({ok:false, error: out.error}); }
      await D.ref().update({['invoices/' + id + '/abit']: {invoice_no: out.invNo, invoiceid: out.invoiceid, username, at: now}, [mapKey(out.invNo)]: id});
      return res.json({ok:true, invoice_no: out.invNo});
    }
    // Nhiều kiện → MỖI KIỆN 1 ĐƠN (bỏ qua kiện đã tạo ở lần trước nếu lần trước lỗi giữa chừng)
    const up = {}, made = Object.assign({}, doneParts); let firstErr = null;
    for(const p of parts){
      if(made[p.i] && made[p.i].invoice_no) continue;
      const out = await createOne(buildOrder(inv, ps, username, p));
      if(out.error){ firstErr = `Kiện ${p.i}/${p.n}: ${out.error}`; break; }
      made[p.i] = {invoice_no: out.invNo, invoiceid: out.invoiceid, value: p.value, deposit: p.deposit, at: now};
      up[mapKey(out.invNo)] = id;
    }
    const first = (made[1] && made[1].invoice_no) || (Object.values(made)[0] || {}).invoice_no || null;
    up['invoices/' + id + '/abit'] = Object.assign({username, at: now, pkgCount: parts.length, parts: made}, first ? {invoice_no: first} : {}, firstErr ? {error: firstErr} : {});
    await D.ref().update(up);
    if(firstErr) return res.status(502).json({ok:false, error: firstErr, created: Object.keys(made).length});
    return res.json({ok:true, invoice_no: first, parts: Object.values(made).map(x=>x.invoice_no)});
  }catch(e){
    return res.status(500).json({ok:false, error: String(e && e.message || e)});
  }finally{
    if(lockRef) lockRef.remove().catch(()=>{});
  }
};
module.exports.buildOrder = buildOrder;
module.exports.splitParts = splitParts;
