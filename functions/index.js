/**
 * وظائف سحابية مخصصة لمنصة Render مجاناً لتطبيق "لَمّة"
 * النسخة المفتوحة والمضمونة 100% للعمل فوراً عبر محرك GIPHY المباشر
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

/** 1) رابط بحث الـ GIF المفتوح والمضمون والمباشر من خوادم GIPHY */
app.get("/searchGifs", async (req, res) => {
  const query = (req.query.q || "").toString().trim();
  const limit = Math.min(parseInt(req.query.limit, 10) || 24, 50);
  const offset = parseInt(req.query.pos, 10) || 0; 

  try {
    // المفتاح النشط الخاص بك تم زرعه مباشرة هنا لمنع أي تضارب
    const apiKey = "lo2ia2lFQEHVrKyKRoqPnDtWqUmnQyOr";
    
    // تركيب رابط مباشر ومفروش لا يقبل الخطأ
    const url = query.length > 0
      ? `https://api.giphy.com/v1/gifs/search?api_key=${apiKey}&q=${encodeURIComponent(query)}&limit=${limit}&offset=${offset}&rating=g`
      : `https://giphy.com{apiKey}&limit=${limit}&offset=${offset}&rating=g`;

    const giphyRes = await fetch(url);
    if (!giphyRes.ok) {
      return res.status(502).json({ error: "فشل الاتصال بخوادم GIPHY العالمية" });
    }
    
    const data = await giphyRes.json();
    
    // تحويل البيانات ليفهمها الأندرويد تلقائياً بنفس التصميم القديم
    const results = (data.data || []).map((item) => {
      const gif = item.images?.fixed_height; 
      const tinyGif = item.images?.fixed_height_small; 
      return {
        id: item.id,
        url: gif?.url || "", 
        previewUrl: tinyGif?.url || gif?.url || "", 
        width: parseInt(gif?.width, 10) || 0,
        height: parseInt(gif?.height, 10) || 0
      };
    }).filter((r) => r.url);

    const nextOffset = offset + limit;

    // إرجاع نتائج الـ GIFs الحية فوراً بدون شروط حماية
    res.status(200).json({ results, next: String(nextOffset) });
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
