# คู่มือ LINE Bot Thai OCR

ส่งรูปภาพเข้า LINE Official Account แล้วรับข้อความภาษาไทย/อังกฤษกลับมา ด้วย **[OpenThai2.0-OCR-Text](https://huggingface.co/iapp/OpenThai2.0-OCR-Text) ของ iApp Technology** ไม่มี Paid OCR API, GPU หรือฐานข้อมูล

Production ใช้ JavaScript ทั้งหมด: Next.js App Router + `onnxruntime-node` + `sharp` รันโมเดลบน CPU ของเซิร์ฟเวอร์ ไม่ส่งรูปภาพให้ Hugging Face ประมวลผล

**สถานะ:** ใช้งานผ่าน LINE OA เท่านั้น มี native loading animation ระหว่างอ่านภาพ ไม่มีหน้าเว็บและไม่มี public OCR API ทดสอบ OCR จริง, webhook tests และ production build บนเครื่องแล้ว ยังไม่ได้ยืนยัน end-to-end กับ LINE OA/Vercel cloud จริง ดู [ผลการตรวจสอบ](validation.md)

## 1. สิ่งที่ต้องเตรียม

- คอมพิวเตอร์ที่มี [Node.js](https://nodejs.org/en/download) **22.13+ ในรุ่น 22 LTS** และ [Git](https://git-scm.com/downloads) (ติดตั้ง Node แล้วจะมี npm มาด้วย)
- บัญชี [GitHub](https://github.com/) และ [Vercel](https://vercel.com/)
- บัญชี LINE และ [LINE Official Account Manager](https://manager.line.biz/)
- [LINE Developers Console](https://developers.line.biz/console/)

OCR ไม่คิดค่าบริการ API แต่ Vercel และ LINE มีข้อกำหนดและโควตาของแต่ละแผน ตรวจสอบ [Vercel Hobby](https://vercel.com/docs/plans/hobby), [LINE Messaging API pricing](https://developers.line.biz/en/docs/messaging-api/pricing/) ก่อนใช้งานจริง

## 2. Clone และติดตั้ง

เปิด Terminal (Windows ใช้ PowerShell) แล้วรันทีละบรรทัด:

```sh
git clone https://github.com/James-Chirawat/Linebot-OCR.git
cd Linebot-OCR
node --version
npm install
npm run models
```

`npm run models` ดาวน์โหลดไฟล์จาก Hugging Face ตาม revision ที่ตรึงไว้ พร้อมตรวจ SHA-256 ทุกไฟล์ ถ้ามีไฟล์ถูกต้องอยู่แล้วจะไม่ดาวน์โหลดซ้ำ น้ำหนัก detector + recognizer รวมประมาณ 4.2 MB ไม่ต้องสมัคร Hugging Face หรือกรอก token

`.npmrc` ตั้ง `onnxruntime-node-install=skip` เพื่อใช้ CPU binaries ที่มากับแพ็กเกจและไม่ดาวน์โหลด CUDA บน Linux ส่วน Vercel/Netlify ตั้ง `ONNXRUNTIME_NODE_INSTALL=skip` ไว้ใน deployment config ด้วย ตัวแปรนี้ใช้ตอนติดตั้ง ไม่ใช่ secret

เมื่อใช้ใน CI แนะนำ `npm ci` เพื่อใช้ dependency เวอร์ชันตรงกับ lockfile

## 3. ตั้งค่า Environment Variables

คัดลอก `.env.example` เป็น `.env.local`:

```sh
cp .env.example .env.local
```

PowerShell ใช้ `Copy-Item .env.example .env.local` หรือคัดลอกไฟล์ผ่าน File Explorer แล้วเปลี่ยนชื่อ

เปิด `.env.local` ด้วย editor แล้วใส่:

```dotenv
LINE_CHANNEL_ID=ค่าจาก LINE Developers
LINE_CHANNEL_SECRET=ค่าจาก LINE Developers
```

- `LINE_CHANNEL_ID`: Channel ID ของ Messaging API สำหรับออก stateless access token
- `LINE_CHANNEL_SECRET`: ใช้ตรวจ signature ของ webhook และออก stateless access token

ทดสอบ OCR engine บนเครื่องได้ด้วย `npm run test:ocr` โดยยังไม่กรอกค่าของ LINE ห้ามตั้งชื่อตัวแปรลับด้วย `NEXT_PUBLIC_` และห้าม commit `.env.local` ลง Git ไฟล์ `.gitignore` ป้องกัน `.env*` ไว้แล้ว

## 4. ทดลองบนเครื่อง

`npm run test:ocr` อ่านภาพตัวอย่างใน `tests/fixtures/` ด้วยโมเดลจริง ไม่ต้องใช้บัญชี LINE สำหรับการทดสอบนี้

```sh
npm run test:ocr
npm run dev
```

server เปิดที่ `http://localhost:3000` แต่ **ไม่มีหน้าเว็บ** การเข้า URL หลักจะได้ 404 ตามที่ออกแบบไว้ ใช้งานผ่าน `POST /api/webhook` เท่านั้น หากจะรับ webhook บนเครื่องต้องมี HTTPS tunnel ของคุณเอง สำหรับผู้เริ่มต้นแนะนำ deploy Vercel ตามหัวข้อ 7

รองรับ JPEG, PNG และ WebP ภาพนิ่ง ขนาดสูงสุด **4 MB และ 16 ล้านพิกเซล** รวมถึง PDF ไม่ติดรหัสผ่าน **4 MB / สูงสุด 3 หน้า** ไม่บันทึกรูปภาพหรือผล OCR ลงไฟล์/ฐานข้อมูล ไม่ log เนื้อหาภาพ ข้อความ หรือ token

ทดสอบ production บนเครื่อง:

```sh
npm run build
npm run test:production
```

หรือ `npm start` เพื่อเปิด webhook server ต่อเนื่อง ทดสอบกับ LINE OA ได้เมื่อมี public HTTPS URL ที่ชี้มาถึง server นี้

**แนบไฟล์ใน LINE:** ส่งรูปภาพหรือแนบ PDF เข้าแชต OA ได้เลย ระบบเริ่ม OCR อัตโนมัติ ไม่ต้องพิมพ์คำสั่งหรือกดปุ่มของบอต PDF แปลงเป็นภาพแล้วใช้ OCR เดิมทีละหน้า ผลลัพธ์แยกหน้าและแสดงค่าความมั่นใจกับเวลารวม ไม่บันทึกไฟล์ลงดิสก์

## 5. สร้าง LINE Official Account และ Messaging API

1. เข้าสู่ [LINE Official Account Manager](https://manager.line.biz/) สร้าง Official Account สำหรับ bot นี้
2. ในหน้าตั้งค่าของ OA เปิด **Messaging API** เลือก provider ที่คุณเป็นเจ้าของ แล้วดำเนินการเปิดใช้งานให้เสร็จ การเปิด Messaging API เริ่มจาก OA Manager ตาม [คู่มือทางการ](https://developers.line.biz/en/docs/messaging-api/getting-started/)
3. ไปที่ [LINE Developers Console](https://developers.line.biz/console/) → เลือก provider และ Messaging API channel ที่เพิ่งสร้าง
4. ใน **Basic settings** คัดลอก **Channel secret** ไปใส่ `LINE_CHANNEL_SECRET`
5. ใน **Basic settings** คัดลอก **Channel ID** ไปใส่ `LINE_CHANNEL_ID` ระบบออก [stateless access token](https://developers.line.biz/en/reference/messaging-api/#issue-stateless-channel-access-token) อายุ 15 นาทีจาก ID และ secret ให้อัตโนมัติ เก็บใช้ซ้ำในหน่วยความจำและขอใหม่ก่อนหมดอายุ 60 วินาที
6. ใน OA Manager → **Response settings** เปิดใช้ webhook และปิด auto-response ที่ตอบทุกข้อความ หากไม่ต้องการข้อความตอบซ้ำจาก OA

ชื่อเมนูอาจเปลี่ยนตามเวอร์ชันของ LINE ให้ยึด [Build a bot](https://developers.line.biz/en/docs/messaging-api/building-bot/) เป็นหลัก

## 6. Push source code ไป GitHub

ถ้า fork/clone มาจากเจ้าของเดิม ให้สร้าง repository ของตัวเองและเปลี่ยน remote ก่อน สำหรับ repository ปัจจุบันเจ้าของตั้ง remote ไว้แล้ว:

```sh
git status
git add .
git commit -m "Build LINE Thai OCR bot"
git push -u origin main
```

ตรวจ branch ด้วย `git branch --show-current` ถ้าใช้ชื่ออื่นให้แทน `main` ด้วยชื่อ branch นั้น ตรวจไฟล์ที่จะ commit ว่าไม่มี secrets โมเดล ONNX ไม่ต้อง push เพราะ build จะดาวน์โหลดให้

## 7. Deploy บน Vercel (เป้าหมายหลัก)

1. เข้าสู่ Vercel → **Add New Project** → เชื่อม GitHub → Import repository นี้
2. เลือก framework **Next.js**, Root Directory เป็น root ของ repository, Node.js **22.x**
3. ใช้ Install Command จาก `vercel.json`: `ONNXRUNTIME_NODE_INSTALL=skip npm ci` และ Build Command **`npm run build`** อย่าเปลี่ยนเป็น `next build` ตรง ๆ เพราะจะข้ามการดาวน์โหลดและตรวจไฟล์โมเดล
4. ใน Environment Variables เพิ่ม `LINE_CHANNEL_ID` และ `LINE_CHANNEL_SECRET` ให้ environment ที่จะทดสอบ
5. ไม่ต้องตั้ง Demo API Key เพราะไม่มีเว็บทดลองหรือ OCR endpoint สาธารณะ
6. กด Deploy รอจน build สำเร็จ ใช้ URL ของ deployment ตั้ง LINE webhook (URL หลักจะตอบ 404 เพราะไม่มีหน้าเว็บ)
7. ถ้าเปลี่ยน Environment Variables ให้ **Redeploy** เพื่อให้ค่ามีผล
8. ตั้ง webhook ตามหัวข้อถัดไป และทดสอบส่งภาพจริงก่อนเผยแพร่ tutorial ว่าใช้งาน end-to-end แล้ว

โค้ดใช้ Node.js runtime, `maxDuration = 60`, native packages แบบ server external และ output file tracing รวม model/dictionary/Linux x64 ONNX libraries มี `scripts/check-trace.js` ตรวจไฟล์และขนาดหลัง build และไม่ดาวน์โหลดโมเดลระหว่าง request

Trace ที่วัดบน macOS ประมาณ **79 MiB สำหรับ webhook บน macOS** ต่ำกว่างบแบบ conservative 250 MiB แต่ขนาด deployment จริงบน Linux อาจต่างออกไป ต้องตรวจ build logs ของ Vercel อีกครั้ง ไม่ต้องเปิด Edge Runtime ไม่ต้องมี persistent disk และไม่ต้องใส่ค่า memory ที่แผน Hobby อาจไม่รองรับ

LINE ต้องเรียก `/api/webhook` ได้โดยไม่ติดหน้า login ของ Vercel Deployment Protection ใช้ production URL ที่ตั้งค่าให้ LINE เข้าถึงได้ ตรวจ [Deployment Protection](https://vercel.com/docs/deployment-protection) หาก Verify ไม่ผ่าน

เอกสาร: [Vercel Next.js](https://vercel.com/docs/frameworks/full-stack/nextjs), [Function limits](https://vercel.com/docs/functions/limitations), [Duration](https://vercel.com/docs/functions/configuring-functions/duration), [Environment variables](https://vercel.com/docs/environment-variables)

## 8. ตั้ง Webhook URL, Verify และลองส่งภาพ

1. LINE Developers Console → channel → **Messaging API** → **Webhook settings**
2. ใส่ URL เป็น `https://ชื่อโปรเจกต์.vercel.app/api/webhook` (ต้องมี HTTPS และ path นี้)
3. กด **Verify** ควรแสดง Success โค้ดรองรับ `events: []` ที่ LINE ใช้ตรวจสอบ
4. เปิด **Use webhook** และสามารถเปิด **Webhook redelivery** เพื่อให้ retry เมื่อ server ตอบผิดพลาด
5. เพิ่ม OA เป็นเพื่อนด้วย QR code ใน channel แล้วส่งข้อความทักทาย ควรได้รับคำแนะนำภาษาไทย
6. ส่งภาพใน `tests/fixtures/thai.png` ควรได้รับ:

```text
📄 ข้อความที่อ่านได้จากรูปภาพ

สวัสดีครับ ภาษาไทย
ทดสอบอ่านข้อความจากภาพ

🎯 ความมั่นใจ: 99.7%
⏱ เวลาประมวลผล OCR: 0.13 วินาที
```

ค่าความมั่นใจมาจากโมเดล OCR และเวลาเป็นเวลาประมวลผลของ engine (รวมโหลดโมเดลเมื่อเป็น request แรก) ไม่รวมเวลารอเครือข่าย LINE ตัวเลขในตัวอย่างอาจต่างกันในแต่ละเครื่อง แม้ข้อความยาวจนต้องตัด ระบบจะเก็บค่าความมั่นใจและเวลาไว้ท้ายผลลัพธ์

7. ลองภาพของตัวเองและตรวจความถูกต้อง ไม่พบข้อความจะได้รับคำแนะนำให้ส่งภาพที่ชัดขึ้น

Verify สำเร็จยืนยันได้เฉพาะ endpoint/signature ยังไม่ได้ยืนยัน token ดาวน์โหลดภาพหรือ reply ต้องส่งรูปจริงด้วย

Webhook ตรวจ `X-Line-Signature` ด้วย HMAC-SHA256 ของ **raw body** ก่อน parse JSON ดาวน์โหลดภาพจาก LINE Content API แล้ว `await` ทั้ง OCR และ Reply API ก่อนตอบ HTTP ไม่มี fire-and-forget และไม่ใช้ Push API

จำกัดงบการทำงาน webhook ประมาณ 48 วินาทีและ OCR ต่อภาพไม่เกิน 38 วินาทีเพื่อเผื่อเวลา reply โดย [LINE กำหนดให้ใช้ replyToken ภายในหนึ่งนาทีและใช้ได้ครั้งเดียว](https://developers.line.biz/en/reference/messaging-api/#send-reply-message) ความล่าช้าของเครือข่าย/cold start ยังทำให้หมดอายุได้ ภาพใหญ่ควรแบ่งเป็นส่วนย่อย

ผลลัพธ์ยาวแบ่งไม่เกิน **5 ข้อความ × 5,000 UTF-16 units** ภายใน reply เดียว โดยไม่ตัด surrogate pair ถ้ายาวเกินทั้งหมดจะมีข้อความแจ้งว่าถูกตัด และให้แบ่งภาพส่งใหม่

## 9. Loading animation ใน LINE

เมื่อผู้ใช้ส่งรูปหรือ PDF ในแชตส่วนตัวกับ OA ระบบจะ:

1. ตรวจ signature และข้าม event ที่ตอบสำเร็จแล้ว
2. เรียก `POST https://api.line.me/v2/bot/chat/loading/start` ด้วย `chatId = event.source.userId` และ `loadingSeconds = 60`
3. ดาวน์โหลดไฟล์ → แปลงหน้า PDF เป็นภาพ (ถ้ามี) → อ่านข้อความด้วยโมเดล → Reply ผลลัพธ์
4. LINE ซ่อน animation อัตโนมัติเมื่อได้รับข้อความตอบกลับ หรือครบ 60 วินาที

เป็น loading animation ของ LINE เอง ไม่ส่งข้อความ “กำลังอ่าน” เพิ่มและไม่ใช้ Push API เรียก loading แบบ await โดยมี timeout 1.5 วินาที ถ้า API นี้ล้มเหลวจะยังอ่านภาพและตอบตามปกติ

**ข้อจำกัดของ LINE:** แสดงเฉพาะแชตส่วนตัวเมื่อผู้ใช้กำลังเปิดหน้าจอแชตกับ OA ไม่รองรับ group/room และไม่แสดงย้อนหลังเมื่อกลับมาเปิดแชต กลุ่มยังใช้ OCR ได้แต่ไม่มี animation ข้อความ text ตอบคำแนะนำทันทีจึงไม่เรียก loading

ดู [คู่มือ Loading animation](https://developers.line.biz/en/docs/messaging-api/use-loading-indicator/) และ [API reference](https://developers.line.biz/en/reference/messaging-api/nojs/#display-a-loading-indicator)

## 10. API และโครงสร้างโปรเจกต์

- `POST /api/webhook`: LINE webhook raw JSON และ `X-Line-Signature`; ข้อมูลถูกต้องตอบ `{ ok: true }`
- Webhook errors: `400` ข้อมูลไม่ถูกต้อง, `401` signature ไม่ผ่าน, `413` body เกินขนาด, `502` LINE API ล้มเหลว, `503` ตั้งค่าไม่ครบ/หมดงบ webhook ส่วนข้อผิดพลาดภาพ/งาน OCR จะตอบคำแนะนำผ่าน LINE

```text
app/api/webhook/     LINE webhook route adapter
lib/ocr/             engine, detector, recognizer, preprocessing, geometry, postprocessing
lib/line.js          LINE Content/Reply API และ signature
lib/pdf.js           แปลง PDF เป็นภาพและ OCR ทีละหน้า
lib/webhook.js       Webhook workflow + best-effort deduplication
scripts/             ดาวน์โหลดโมเดล, ตรวจ trace, สร้าง fixtures, production smoke test
models/              ไฟล์โมเดล local (Git ignored)
tests/fixtures/      ภาพจริงสำหรับทดสอบ + expected text
tests/reference/     Python upstream เฉพาะการทดสอบเทียบผล (ไม่ใช้ใน production)
```

Pipeline: ขอบขาว → BGR normalize/CHW → DB probability map → threshold/connected regions/minimum-area rectangle → score/unclip → perspective crop → resize สูง 48 → flatten พื้นหลัง → normalize → recognizer → CTC blank/dedup/dictionary → Thai canonicalization → confidence filter → reading order

ใช้ singleton promise cache สำหรับ ONNX sessions, CPU provider 1 thread และ recognition batch 4 บรรทัด เพื่อจำกัดหน่วยความจำ อ่านได้สูงสุด 240 กรอบก่อน split ถ้างานหนาแน่นเกินให้แบ่งภาพ ไม่มีการลบ/เขียนทับรูปต้นฉบับของผู้ใช้

## 11. ทดสอบซ้ำ

```sh
npm run models
npm test
npm run test:ocr
npm run build
npm run test:production
```

- `npm test`: signature, empty events, text/image/file workflows, การส่งไฟล์ตรงโดยไม่มีปุ่มเลือก, ขอบเขต PDF ผ่าน mocked LINE API, loading animation, file limits, CTC, geometry และ regression ของ preprocessing
- `npm run test:ocr`: โหลด ONNX จริง อ่าน PNG ไทย/อังกฤษ/หลายบรรทัด ภาพหมุน/เอียง blank, invalid image และ PDF สแกนไทย/อังกฤษ; ไม่ใช้ OCR mock
- `npm run test:production`: เปิด production server ชั่วคราวที่พอร์ตว่างอัตโนมัติ, ยิง HTTP จริง, ตรวจ signature และยืนยันว่าเว็บกับ `/api/ocr` ถูกลบแล้ว จากนั้นปิด server ให้อัตโนมัติ ใช้ test credentials แบบสุ่ม ไม่ส่งข้อความไป LINE จริง
- ผลทดสอบที่สร้างบนเครื่องอยู่ใน `test-results/` (Git ignored)
- มี GitHub Actions สำหรับทดสอบ Node 22 บน Ubuntu หลัง push; ยังไม่ถือว่า CI ผ่านจนกว่าจะมี run ของ repository จริง
- มี PNG fixtures พร้อมใน source จึงไม่ต้องติดตั้งฟอนต์บนเครื่อง CI ถ้าจะสร้างใหม่ใช้ `npm run fixtures` และต้องมี Thonburi หรือ Noto Sans Thai บนเครื่อง

**ไม่จำเป็นต่อผู้เริ่มต้น:** เทียบกับ upstream Python โดยติดตั้งเฉพาะเครื่องนักพัฒนา:

```sh
python3 -m venv tests/reference/.venv
tests/reference/.venv/bin/pip install -r tests/reference/requirements.txt
npm run test:ocr
tests/reference/.venv/bin/python scripts/compare-reference.py
```

PowerShell ให้ใช้ `tests/reference/.venv/Scripts/python.exe` และ `pip.exe` ตามโครงสร้าง venv ของ Windows Production ไม่เรียก Python และ `npm install` ไม่ติดตั้ง Python dependencies

## 12. Troubleshooting

- **`ENOENT det.onnx` / dictionary หาย:** รัน `npm run models`; บน Vercel ต้องใช้ build command `npm run build` และตรวจ output tracing
- **Download/checksum error:** ตรวจอินเทอร์เน็ตไป Hugging Face แล้วรันใหม่ ห้ามเปลี่ยน checksum เพียงเพื่อข้าม error ถ้า upstream เปลี่ยนโมเดลต้องอัปเดต revision และทดสอบใหม่เป็นชุด
- **`onnxruntime_binding.node` / `libonnxruntime.so.1` โหลดไม่ได้:** ใช้ Node 22, Node.js runtime และ `npm ci` บนระบบปลายทาง อย่ายก `node_modules` จาก macOS ไป Linux ตรวจ native files ใน function bundle
- **LINE Verify ตอบ 401:** ใช้ Channel secret ของ channel ที่ตั้ง webhook นี้ ตรวจว่าไม่มี proxy เปลี่ยน raw JSON
- **LINE Verify ตอบ 503:** ยังไม่ได้ตั้ง Channel secret หรือ env ใหม่ยังไม่ redeploy
- **Verify ผ่านแต่ไม่ตอบภาพ:** ตรวจ Channel ID/secret ของ Messaging API, Use webhook, สิทธิ์ OA/channel, response settings และ function error code ใน logs; Verify ไม่ได้ตรวจ token ส่งข้อความ
- **401/403 จาก Vercel ก่อนถึงโค้ด:** ตรวจ Deployment Protection และใช้ URL ที่ LINE เรียกถึงได้
- **413 / อ่านไฟล์ภาพไม่ได้:** ส่ง JPEG/PNG/WebP ภาพนิ่งไม่เกิน 4 MB/16 MP; ลดขนาดภาพ HEIC หรือภาพเคลื่อนไหวก่อน
- **ไม่พบข้อความ:** ตรวจว่าภาพคมชัด ตัวพิมพ์ไม่เล็ก/มี noise มาก โมเดลกรองบรรทัด confidence ต่ำตาม config ต้นฉบับ
- **429 / หมดเวลา / invalid reply token:** รอสักครู่ แบ่งภาพให้เล็กลงและส่งใหม่ ตรวจ cold start และ usage logs ไม่มี Push fallback
- **ตอบซ้ำหลัง redelivery:** deduplication เป็น in-memory ต่อ instance เท่านั้น ไม่ใช่ exactly-once ข้าม instance; LINE token ใช้ได้ครั้งเดียว และระบบไม่มีฐานข้อมูลถาวร
- **ฟอนต์ไทยใน test fixture เป็นกล่อง:** ใช้ PNG ที่ commit มา หรือติดตั้งฟอนต์ไทยก่อน generate fixtures ใหม่

## 13. ข้อจำกัดของ JavaScript port

อ้างอิง runtime จาก revision ที่ตรึงไว้ แต่ไม่ได้อ้างว่าเทียบเท่า upstream ทุกภาพ:

- ใช้ connected foreground boundaries แทน OpenCV `RETR_LIST` (ไม่เอา hole contours), minimum rectangle + DB unclip distance แทน round polygon offset; geometry อาจต่างเล็กน้อย
- ใช้ bilinear perspective sampling และ libvips resize แทน OpenCV cubic/linear จึงอาจต่างในตัวอักษรบางหรือภาพเอียงมาก
- รองรับ EXIF orientation, vertical-majority quarter turns, upside-down confidence comparison และ deskew ตั้งแต่ 2.5° ตามแนวทางต้นฉบับ ภาพหมุนที่มีเพียงหนึ่ง/สองบรรทัดอาจตรวจทิศไม่ได้
- มี background flattening, gap splitting แบบตรวจ confidence, detached-mark filtering และ recursive column reading order แต่ยังไม่ได้ทำ robustness benchmark ทั้งชุดของผู้พัฒนา ไม่มี word-level boxes หรือ table/Markdown reconstruction
- ตัวตรวจเวลาจะเช็กระหว่างขั้นตอน ไม่สามารถหยุด native ONNX run ที่กำลังทำงานกลางคัน; timeout/cold start และ memory บนแพลตฟอร์มจริงยังต้องวัด
- ผลทดสอบที่ผ่านเป็นภาพตัวพิมพ์สังเคราะห์สำหรับตรวจ correctness ของ pipeline ไม่ใช่การรับรอง accuracy บนเอกสารทุกชนิด

## 14. License และเครดิต

Source code ใช้ Apache-2.0 ดู [LICENSE](../LICENSE) และ [NOTICE](../NOTICE) โมเดลและ runtime ต้นฉบับโดย **iApp Technology** detector และ recognizer ตั้งต้นมาจาก **PaddlePaddle** ภายใต้ Apache-2.0

เมื่อแจก source/model ต่อให้แนบ license และ notice และระบุว่า JavaScript runtime นี้เป็น port ที่มีการแก้ไข ไม่ใช่ runtime ต้นฉบับของ iApp

เอกสารเพิ่มเติม: [Model repository](https://huggingface.co/iapp/OpenThai2.0-OCR-Text), [คู่มือ iApp ภาษาไทย](https://iapp.co.th/blog/openthai2p0-ocr-how-to-run), [ONNX Node.js](https://onnxruntime.ai/docs/get-started/with-javascript/node.html), [LINE signature](https://developers.line.biz/en/docs/messaging-api/verify-webhook-signature/), [LINE Content API](https://developers.line.biz/en/reference/messaging-api/#get-content), [Next.js Route Handlers](https://nextjs.org/docs/app/getting-started/route-handlers)
