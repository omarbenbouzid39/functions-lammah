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
    return await admin.auth().verifyIdToken(match[1]);
  } catch (e) {
    return null;
  }
}

/** 1) رابط بحث الـ GIF عبر تينور */
app.get("/searchGifs", async (req, res) => {
  const decoded = await requireAuth(req);
  if (!decoded) {
    return res.status(401).json({ error: "يجب تسجيل الدخول" });
  }

  const query = (req.query.q || "").toString().trim();
  const limit = Math.min(parseInt(req.query.limit, 10) || 24, 50);
  const pos = (req.query.pos || "").toString();

  try {
    const endpoint = query.length > 0
      ? "https://googleapis.com"
      : "https://googleapis.com";

    const url = new URL(endpoint);
    if (query.length > 0) url.searchParams.set("q", query);
    url.searchParams.set("key", TENOR_API_KEY);
    url.searchParams.set("client_key", "lammah_app");
    url.searchParams.set("limit", String(limit));
    url.searchParams.set("media_filter", "gif");
    url.searchParams.set("contentfilter", "medium");
    if (pos) url.searchParams.set("pos", pos);

    const tenorRes = await fetch(url.toString());
    if (!tenorRes.ok) {
      return res.status(502).json({ error: "تعذّر جلب نتائج GIF حاليًا" });
    }
    const data = await tenorRes.json();
    const results = (data.results || []).map((item) => {
      const gif = item.media_formats?.gif;
      const tinyGif = item.media_formats?.tinygif;
      return {
        id: item.id,
        url: gif?.url || "",
        previewUrl: tinyGif?.url || gif?.url || "",
        width: gif?.dims?.[0] || 0,
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
