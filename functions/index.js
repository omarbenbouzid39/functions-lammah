/**
 * وظائف سحابية مخصصة لمنصة Render مجاناً لتطبيق "لَمّة"
 */

const express = require("express");
const cors = require("cors");
const admin = require("firebase-admin");

// ⚠️ هام جداً: ستحتاج لتحميل ملف مفتاح الخدمة (Service Account Key) من Firebase Console
// وضعه في نفس المجلد باسم serviceAccountKey.json لتشغيل الحزمة خارج سحابة جوجل.
const serviceAccount = require("./serviceAccountKey.json");

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
```

---

### 3️⃣ الخطوة التقنية الهامة لتشغيل Firebase (ملف السيرفر المخفي)
بما أننا خرجنا من سحابة جوجل، يحتاج السيرفر الجديد إلى "إذن" للوصول لقاعدة بيانات مشروعك وصلاحية إرسال الإشعارات.
1. اذهب إلى لوحة تحكم **Firebase Console**.
2. اضغط على ترس الإعدادات ⚙️ بجانب Project Overview ثم اختر **Project settings**.
3. توجه إلى تبويب **Service accounts**.
4. اضغط على زر **Generate new private key** (توليد مفتاح خاص جديد).
5. سيتم تحميل ملف بصيغة `.json` على جهازك، قم بتغيير اسمه إلى `serviceAccountKey.json` وضعه داخل مجلد `functions` بجانب ملف `index.js` مباشرة.

---

### 4️⃣ طريقة النشر على Render
1. قم برفع مجلد الـ `functions` فقط (بما يحتويه من ملفات ومفتاح السيرفر) إلى مستودع خاص بك على موقع **GitHub** (تأكد من جعله Private لحماية ملفاتك).
2. سجل دخولك في موقع **Render** واربط حسابك بـ GitHub.
3. اضغط على **New +** ثم اختر **Web Service**.
4. اختر المستودع الخاص بك.
5. في الإعدادات الخاصة بـ Render، تأكد من وضع التالي:
   * **Runtime:** Node
   * **Build Command:** `npm install`
   * **Start Command:** `npm start`
6. اذهب إلى خيار **Environment Variables** (متغيرات البيئة) في Render، وأضف متغيراً جديداً باسم:
   * Key: `TENOR_API_KEY`
   * Value: (ضع مفتاح تينور الخاص بك هنا لتأمين الكود كما طلب المبرمج).

بمجرد اكتمال البناء، سيمنحك Render رابطاً مجانياً يبدأ بـ `https://...onrender.com` لتضعه في ملف الأندرويد كما تم توضيحه سابقاً!

<FollowUp>
الآن بعد أن جهزنا الكود، هل تحتاج إلى مساعدة في معرفة **كيفية تعديل كود الأندرويد ليرسل طلبات الإشعارات يدويًا** للرابط الجديد عبر السيرفر؟ أو هل تواجه أي صعوبة في **استخراج ملف `serviceAccountKey.json`** من Firebase؟
</FollowUp>
