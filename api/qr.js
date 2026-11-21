// GET /api/qr?bank=MB&num=123456 → ảnh mã QR chuyển khoản (VietQR) đi qua máy chủ mình
// Lý do: ảnh từ img.vietqr.io không cho trình duyệt "chụp" vào ảnh hoá đơn (thiếu CORS) → ảnh hoá đơn trên điện thoại bị mất QR.
module.exports = async (req, res) => {
  const bank = String((req.query || {}).bank || ''), num = String((req.query || {}).num || '');
  if (!/^[\w.-]{1,40}$/.test(bank) || !/^[\w.-]{1,40}$/.test(num)) return res.status(400).end('bad');
  try {
    const r = await fetch(`https://img.vietqr.io/image/${encodeURIComponent(bank)}-${encodeURIComponent(num)}-qr_only.png`);
    if (!r.ok) return res.status(502).end('upstream');
    const buf = Buffer.from(await r.arrayBuffer());
    res.setHeader('Content-Type', r.headers.get('content-type') || 'image/png');
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Cache-Control', 'public, max-age=86400, s-maxage=604800');
    return res.status(200).end(buf);
  } catch (e) { return res.status(502).end('error'); }
};
