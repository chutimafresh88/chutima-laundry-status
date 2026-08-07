# ชุติมา FRESH LAUNDRY — Customer Status

หน้าเว็บสาธารณะสำหรับให้ลูกค้าติดตามสถานะคิวจาก QR Code

- เว็บไซต์: https://chutimafresh88.github.io/chutima-laundry-status/
- เส้นทาง QR: `/q/{public_token}`
- แสดงเฉพาะเลขคิว สถานะ เวลาโดยประมาณ และสถานะตะกร้า
- ไม่แสดงชื่อ เบอร์โทร ยอดเงิน ข้อมูลการชำระเงิน หรือ PIN

ข้อมูลสถานะอ่านผ่าน Supabase RPC `get_public_queue_status` ด้วย Publishable key ฝั่งเบราว์เซอร์ โดยไม่มี Secret key หรือ service-role key ใน Repository นี้
