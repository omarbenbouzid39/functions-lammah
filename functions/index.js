/**
 * وظائف سحابية مخصصة لمنصة Render مجاناً لتطبيق "لَمّة"
 * النسخة المفتوحة والمضمونة 100% للعمل فوراً في المتصفح والتطبيق
 */

const express = require("express");
const cors = require("cors");
const admin = require("firebase-admin");

// القراءة المباشرة من مسار الملفات السرية الآمن لمنصة Render
const serviceAccount = require("/etc/secrets/serviceAccountKey.json");

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount)
});

const app = express();
app.use(cors({ origin: true }));
app.use(express.json());

/** 1) رابط بحث الـ GIF المفتوح والمضمون (بدون قيود حماية مؤقتاً للتجربة) */
app.get("/searchGifs", async (req, res) => {
  const query = (req.query.q || "").toString().trim();
  const limit = Math.min(parseInt(req.query.limit, 10) || 24, 50);
  const page = Math.max(parseInt(req.query.pos, 10) || 1, 1); 

  try {
    // المفتاح النشط المفتوح لـ Pixabay مثبت ومباشر
    const apiKey = "46059632-6bb0856fe75390fe2f190e632";
    
    // صياغة الرابط المباشر
    const url = `https://pixabay.com{apiKey}&q=${encodeURIComponent(query)}&image_type=animation&per_page=${limit}&page=${page}`;

    const pixabayRes = await fetch(url);
    if (!pixabayRes.ok) {
      return res.status(502).json({ error: "فشل الاتصال بخوادم الصور" });
    }
    
    const data = await pixabayRes.json();
    
    // تحويل البيانات ليفهمها الأندرويد تلقائياً
    const results = (data.hits || []).map((item) => {
      return {
        id: String(item.id),
        url: item.webformatURL || "", 
        previewUrl: item.previewURL || item.webformatURL || "", 
        width: item.webformatWidth || 0,
        height: item.webformatHeight || 0
      };
    }).filter((r) => r.url);

    const nextPage = page + 1;

    // إرجاع النتائج فوراً لأي شخص يطلبها
    res.status(200).json({ results, next: String(nextPage) });
  } catch (e) {
    res.status(500).json({ error: "حدث عطل داخلي بسيط في السيرفر" });
  }
});

/** 2) رابط إرسال الإشعارات لـ Firebase عبر سيرفر Render */
app.post("/sendPush", async (req, res) => {
  const { uid, notif } = req.body;
  if (!uid || !notif) {
    return res.status(400).json({ error: "بيانات ناقصة لإرسال الإشعار" });
  }

  try {
    const userDoc = await admin.firestore().collection("users").doc(uid).get();
    const token = userDoc.get("fcmToken");
    if (!token) return res.status(404).json({ error: "لا يوجد رمز FCM للمستخدم" });

    const { title, body } = buildNotificationText(notif);
    if (!body) return res.status(400).json({ error: "محتوى الإشعار فارغ" });

    await admin.messaging().send({
      token,
      notification: { title, body },
      data: {
        type: String(notif.type || ""),
        postId: String(notif.postId || ""),
        fromUid: String(notif.fromUid || ""),
      },
      android: { priority: "high" },
    });

    res.status(200).json({ success: true });
  } catch (e) {
    res.status(500).json({ error: "فشل إرسال الإشعار" });
  }
});

function buildNotificationText(notif) {
  const name = notif.fromName || "شخص ما";
  switch (notif.type) {
    case "like": return { title: "لَمّة", body: `${name} أعجب بمنشورك` };
    case "comment": return { title: "لَمّة", body: `${name} علّق على منشورك` };
    case "friend_request": return { title: "لَمّة", body: `${name} أرسل لك طلب صداقة` };
    case "friend_accept": return { title: "لَمّة", body: `${name} قبل طلب صداقتك` };
    case "message": return { title: "لَمّة", body: `${name} أرسل لك رسالة جديدة` };
    default: return { title: "لَمّة", body: "" };
  }
}

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`السيرفر المفتوح يعمل الآن على المنفذ: ${PORT}`);
});
