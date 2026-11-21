# ผลการตรวจสอบ 12 พฤศจิกายน 2026 — LINE OA only

ตรวจบน macOS arm64, Node.js v22.23.2 ไม่มีหน้าเว็บทดลองหรือ public OCR API แล้ว เหลือ `POST /api/webhook` สำหรับ LINE OA

## ผ่านแล้ว

- `npm test`: **25/25** ผ่าน signature, verification, LINE workflows, message splitting, stream/image limits, CTC, geometry, loading animation และการแสดงค่าความมั่นใจ/เวลาแม้ข้อความยาวเกินขีดจำกัด
- `npm run test:ocr`: **14/14** ผ่าน ONNX จริง ไทย/อังกฤษ/หลายบรรทัด, 90°/180°/270°/12°, JPEG/WebP, ภาพว่าง, invalid image และ signed LINE workflow ที่ mock เฉพาะ network รวม loading แต่ใช้ OCR จริง
- `npm run build`: ผ่าน เหลือ `/api/webhook` ใน route ของแอป
- Trace ของ webhook ประมาณ **70 MiB** มีโมเดล, dictionary, config และ ONNX native libraries สำหรับ Linux x64
- `npm run test:production`: ผ่าน signed empty webhook, invalid signature และยืนยัน `/` กับ `POST /api/ocr` ตอบ **404**
- ถอด dependencies ของ Tailwind/PostCSS สำหรับ UI ออก; npm install/uninstall ตรวจไม่พบ vulnerabilities

## Loading animation ที่เพิ่ม

- เรียก `/v2/bot/chat/loading/start` สำหรับ image event ในแชตส่วนตัว ก่อนดาวน์โหลดภาพและ OCR
- ส่ง `chatId` จาก `event.source.userId` และ `loadingSeconds: 60` โดยใช้ channel access token ฝั่ง server
- เรียกแบบ await, timeout 1.5 วินาที; หาก loading API error/timeout ยังทำ OCR และ reply ต่อได้
- LINE ซ่อน animation เมื่อส่งผลลัพธ์หรือครบเวลา ไม่ใช้ Push API และไม่ส่งข้อความกำลังอ่านเพิ่ม
- Tests ตรวจลำดับ loading → download → OCR → reply, ไม่เรียกซ้ำสำหรับ event ที่สำเร็จแล้ว, fallback เมื่อ loading ล้มเหลว, ข้าม group/room/missing userId และไม่เรียกกับ text event

Animation เป็นฟีเจอร์เฉพาะแชตส่วนตัวขณะผู้ใช้เปิดแชตกับ OA ตาม [เอกสาร LINE](https://developers.line.biz/en/docs/messaging-api/use-loading-indicator/) ยังไม่ได้ยืนยันภาพ animation บนแอป LINE จริง เพราะยังไม่ได้เชื่อม channel บัญชีผู้ใช้

## OCR จริง

ภาพตัวอย่างเป็น PNG ตัวพิมพ์สังเคราะห์ที่เรนเดอร์จริง ไม่ได้ mock ผลโมเดล ทั้ง 3 ภาพตรง expected text:

```text
สวัสดีครับ ภาษาไทย
ทดสอบอ่านข้อความจากภาพ
```

```text
Hello LINE OCR 123
Free text recognition
```

```text
สวัสดีประเทศไทย
Hello from LINE OCR
อ่านข้อความหลายบรรทัด
```

Confidence ของภาพหลักอยู่ประมาณ 0.9802–0.9970 ผลการเทียบกับ upstream Python ในการตรวจครั้งก่อนตรงกันทั้ง 3 ภาพ OCR engine ไม่ได้เปลี่ยนในการปรับเป็น LINE OA only ความเร็วบน local ไม่ใช่ cloud cold start หรือการรับรอง accuracy บนเอกสารทั่วไป

ข้อมูลทดสอบล่าสุดอยู่ใน `test-results/` (Git ignored) การตรวจ production รอบใหม่นี้ไม่มี public OCR HTTP request; OCR ตรวจผ่าน engine และ signed webhook integration ที่ mock LINE network

## ยังต้องยืนยันกับบัญชีจริง

- Vercel cloud deployment, native inference บน Linux และ cloud memory/time
- LINE Developers Verify, ส่งรูปจากแอป LINE, เห็น loading animation และรับข้อความ OCR จริง
- GitHub Actions Ubuntu หลัง commit/push; ยังไม่ได้ push งานนี้
- เอกสารจริงจำนวนมาก หลายคอลัมน์ ฟอนต์ตกแต่ง และลายมือ ไม่ได้ทำ robustness benchmark เต็มชุดของ iApp

## ขั้นตอนต่อไป

1. ตั้ง `LINE_CHANNEL_ID` และ `LINE_CHANNEL_SECRET` เท่านั้น
2. Commit/push แล้ว deploy ด้วย config ที่เตรียมไว้
3. ตั้ง `https://<deployment>/api/webhook`, Verify และเปิด Use webhook
4. เปิดแชตส่วนตัวกับ OA แล้วส่งรูปตัวอย่าง ดู loading และตรวจข้อความตอบกลับ

หากเข้า URL หลักแล้วได้ 404 เป็นพฤติกรรมที่ตั้งใจไว้ เพราะผู้ใช้ใช้งานผ่าน LINE OA เท่านั้น
