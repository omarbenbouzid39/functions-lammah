/**
 * وظائف سحابية مخصصة لمنصة Render مجاناً لتطبيق "لَمّة"
 */

const express = require("express");
const cors = require("cors");
const admin = require("firebase-admin");

// ⚠️ هام جداً: ستحتاج لتحميل ملف مفتاح الخدمة (Service Account Key) من Firebase Console
// وضعه في نفس المجلد باسم serviceAccountKey.json لتشغيل الحزمة خارج سحابة جوجل.
// القراءة المباشرة من مسار الملفات السرية الآمن لمنصة Render
const serviceAccount = require("/etc/secrets/serviceAccountKey.json");

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount)
});

const app = express();
app.use(cors({ origin: true }));
app.use(express.json());

// جلب مفتاح تينور من بيئة العمل في Render لمنع كشفه
const TENOR_API_KEY = process.env.TENOR_API_KEY;

/** التحقق من توكن Firebase Auth القادم من الأندرويد */
async function requireAuth(req) {
  const header = req.get("Authorization") || "";
  const match = header.match(/^Bearer (.+)$/);
  if (!match) return null;
  try {
/** 1) رابط بحث الـ GIF عبر جي في (GIPHY API) */
app.get("/searchGifs", async (req, res) => {
  const decoded = await requireAuth(req);
  if (!decoded) {
    return res.status(401).json({ error: "يجب تسجيل الدخول" });
  }

  const query = (req.query.q || "").toString().trim();
  const limit = Math.min(parseInt(req.query.limit, 10) || 24, 50);
  const offset = parseInt(req.query.pos, 10) || 0; // GIPHY يستخدم الأرقام للتنقل بين الصفحات

  try {
    // تحديد رابط البحث أو الصور الشائعة بناءً على طلب المستخدم
    const endpoint = query.length > 0
      ? "https://giphy.com"
      : "https://giphy.com";

    const url = new URL(endpoint);
    url.searchParams.set("api_key", process.env.TENOR_API_KEY); // سنترك اسم المتغير في رندر كما هو لسهولة العمل
    if (query.length > 0) url.searchParams.set("q", query);
    url.searchParams.set("limit", String(limit));
    url.searchParams.set("offset", String(offset));
    url.searchParams.set("rating", "g"); // محتوى آمن وعائلي

    const giphyRes = await fetch(url.toString());
    if (!giphyRes.ok) {
      return res.status(502).json({ error: "تعذّر جلب نتائج GIF حاليًا" });
    }
    
    const data = await giphyRes.json();
    
    // تحويل البيانات لكي يفهمها تطبيق الأندرويد بنفس الصيغة القديمة تماماً
    const results = (data.data || []).map((item) => {
      const gif = item.images?.fixed_height; // جلب الصورة العادية
      const tinyGif = item.images?.fixed_height_small; // جلب الصورة المصغرة للمعاينة
      return {
        id: item.id,
        url: gif?.url || "",
        previewUrl: tinyGif?.url || gif?.url || "",
        width: parseInt(gif?.width, 10) || 0,
        height: parseInt(gif?.height, 10) || 0,
      };
    }).filter((r) => r.url);

    // حساب الصفحة التالية للأندروindex
    const nextOffset = offset + limit;

    res.status(200).json({ results, next: String(nextOffset) });
  } catch (e) {
    res.status(500).json({ error: "حدث خطأ غير متوقع" });
  }
});

        height: gif?.dims?.[1] || 0,
      };
    }).filter((r) => r.url);

    res.status(200).json({ results, next: data.next || "" });
  } catch (e) {
    res.status(500).json({ error: "حدث خطأ غير متوقع" });
  }
});

/** 2) رابط إرسال الإشعارات البديل لـ Render */
app.post("/sendPush", async (req, res) => {
  const { uid, notif } = req.body;
  if (!uid || !notif) {
    return res.status(400).json({ error: "بيانات ناقصة" });
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

// تشغيل السيرفر على المنفذ الذي تحدده Render تلقائياً
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});
