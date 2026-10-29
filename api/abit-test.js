// MỞ TRÊN TRÌNH DUYỆT để thử tạo 1 đơn mẫu bên Abit (không cần Firebase):
//   https://bao-cao-doanh-so.vercel.app/api/abit-test?key=<ABIT_WEBHOOK_KEY>&code=A55
// Đơn mẫu ghi rõ "ĐƠN THỬ API — XOÁ GIÚP". Thử xong vào Abit xoá / huỷ đơn này.
module.exports = async (req, res)=>{
  const q = req.query || {};
  if(String(q.key || '') !== String(process.env.ABIT_WEBHOOK_KEY || '_')) return res.status(403).send('Sai mã key');
  if(!process.env.ABIT_CREATE_URL) return res.status(500).send('Chưa cài biến ABIT_CREATE_URL trên Vercel');
  const code = String(q.code || 'A55').slice(0, 40);
  const order = {
    name: 'ĐƠN THỬ API — XOÁ GIÚP', telephone: '0900000000', name_receiver: 'Người nhận thử',
    invoicestatus: process.env.ABIT_STATUS || 'AutoCreated',
    city: 'Thành phố Hà Nội', district: 'Quận Hai Bà Trưng',
    address: '203 Minh Khai, Phường Minh Khai, Quận Hai Bà Trưng, Thành phố Hà Nội',
    note: 'ĐƠN THỬ kết nối API từ app báo cáo doanh số — xoá giúp',
    ghichu1: `${code}: H2 HỒNG M ×1 · H21 TRẮNG ×1`, ghichu2: 'TEST-0001', notevanchuyen: '1 kiện',
    discount_percent: '0.000', discount_amount: '0.000', s_h_amount: '0.000', giamgia: '0', phuthu: '0', phivanchuyen: '0', adjustment: '0.000',
    taxtype: 'individual', deposits: 1000, subtotal: 2000, taxtotal_invoice: '0.000', total: 2000, accountid: 0,
    listProduct: [{price: '1000', amount: '2', productName: code, productcode: code, weight: '0', discount_percent_product: '0', discount_amount_product: '0', tax1: '0', qtyinstock: '0'}]
  };
  try{
    const r = await fetch(process.env.ABIT_CREATE_URL, {method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify([order])});
    const text = await r.text();
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    return res.status(200).send(`<h2>Kết quả thử tạo đơn Abit</h2><p>Mã HTTP: <b>${r.status}</b></p><p>Abit trả về:</p><pre style="white-space:pre-wrap;background:#f4f4f4;padding:10px;">${text.replace(/</g,'&lt;')}</pre><h3>Dữ liệu đã gửi:</h3><pre style="white-space:pre-wrap;background:#f4f4f4;padding:10px;">${JSON.stringify(order, null, 2).replace(/</g,'&lt;')}</pre>`);
  }catch(e){ return res.status(500).send('Lỗi gọi Abit: ' + String(e && e.message || e)); }
};
