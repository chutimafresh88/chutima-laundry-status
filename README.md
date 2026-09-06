# ชุติมา FRESH LAUNDRY — Customer Status

หน้าเว็บสาธารณะสำหรับให้ลูกค้าติดตามสถานะคิวจาก QR Code

- เว็บไซต์: https://chutimafresh88.github.io/chutima-laundry-status/
- เส้นทาง QR: `/q/{public_token}`
- แสดงเฉพาะเลขคิว สถานะ เวลาโดยประมาณ และสถานะตะกร้า
- ไม่แสดงชื่อ เบอร์โทร ยอดเงิน ข้อมูลการชำระเงิน หรือ PIN

ข้อมูลสถานะอ่านผ่าน Supabase RPC `get_public_queue_status` ด้วย Publishable key ฝั่งเบราว์เซอร์ โดยไม่มี Secret key หรือ service-role key ใน Repository นี้

## เว็บหลังบ้านสินค้า

เปิด [หลังบ้านสินค้า](https://chutimafresh88.github.io/chutima-laundry-status/office/) สำหรับสินค้า รับเข้า ตรวจนับ และจัดซื้อ หน้าเข้าสู่ระบบเปิดผ่าน GitHub Pages ส่วนข้อมูลร้านต้องใช้บัญชี Supabase ที่มีสิทธิ์ owner และถูกป้องกันด้วย Row Level Security

ไฟล์ใน `office/` เป็นเว็บที่สร้างพร้อมใช้งาน ไม่มีข้อมูลร้าน รหัสผ่าน หรือคีย์ลับเครื่อง POS รวมอยู่ โค้ดต้นฉบับเก็บใน repository ของโปรแกรมร้าน สาขา `web-backoffice` โฟลเดอร์ `inventory-office/`

การซิงก์สินค้าอัตโนมัติกับโปรแกรม POS ยังต้องติดตั้งส่วนเชื่อมต่อที่รองรับ ระบบ QR ติดตามคิวเดิมอยู่ที่หน้าแรก
