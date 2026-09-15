```js
/**
 * Lammah Functions — Render Backend
 *
 * الوظائف:
 * 1. Firebase Auth verification
 * 2. Firestore access
 * 3. FCM Push Notifications
 * 4. GIPHY GIF Search
 * 5. Health Check
 *
 * التشغيل:
 * npm start
 */

const express = require("express");
const cors = require("cors");
const admin = require("firebase-admin");

// ============================================================
// Firebase Admin
// ============================================================
//
// لا نستخدم serviceAccountKey.json.
// ضع بيانات Firebase في Environment Variables داخل Render.
//
// المتغيرات المطلوبة:
// FIREBASE_PROJECT_ID
// FIREBASE_CLIENT_EMAIL
// FIREBASE_PRIVATE_KEY
//
// ============================================================

const FIREBASE_PROJECT_ID = process.env.FIREBASE_PROJECT_ID;
const FIREBASE_CLIENT_EMAIL = process.env.FIREBASE_CLIENT_EMAIL;
const FIREBASE_PRIVATE_KEY = process.env.FIREBASE_PRIVATE_KEY;

if (
  !FIREBASE_PROJECT_ID ||
  !FIREBASE_CLIENT_EMAIL ||
  !FIREBASE_PRIVATE_KEY
) {
  console.error(
    "❌ Firebase environment variables are missing."
  );
  process.exit(1);
}

const privateKey = FIREBASE_PRIVATE_KEY.replace(/\\n/g, "\n");

admin.initializeApp({
  credential: admin.credential.cert({
    projectId: FIREBASE_PROJECT_ID,
    clientEmail: FIREBASE_CLIENT_EMAIL,
    privateKey: privateKey,
  }),
});

const db = admin.firestore();
const messaging = admin.messaging();

// ============================================================
// Express
// ============================================================

const app = express();

app.use(
  cors({
    origin: true,
    methods: ["GET", "POST", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
  })
);

app.use(express.json({ limit: "1mb" }));

// ============================================================
// Environment Variables
// ============================================================

const GIPHY_API_KEY = process.env.GIPHY_API_KEY;

const PORT = process.env.PORT || 3000;

// ============================================================
// Firebase Auth
// ============================================================

async function requireAuth(req) {
  const header = req.get("Authorization") || "";

  const match = header.match(/^Bearer (.+)$/);

  if (!match) {
    return null;
  }

  try {
    const decodedToken = await admin
      .auth()
      .verifyIdToken(match[1]);

    return decodedToken;
  } catch (error) {
    console.error("Firebase Auth error:", error.message);
    return null;
  }
}

// ============================================================
// Health Check
// ============================================================

app.get("/health", async (req, res) => {
  try {
    // اختبار بسيط للوصول إلى Firestore
    await db.collection("users").limit(1).get();

    res.status(200).json({
      status: "ok",
      server: "lammah-render",
      firebase: "connected",
      notifications: "ready",
      giphy: GIPHY_API_KEY ? "configured" : "missing",
    });
  } catch (error) {
    console.error("Health check error:", error);

    res.status(500).json({
      status: "error",
      server: "lammah-render",
      firebase: "error",
      error: error.message,
    });
  }
});

// ============================================================
// GIPHY — Search GIFs
// ============================================================

app.get("/searchGifs", async (req, res) => {
  const decoded = await requireAuth(req);

  if (!decoded) {
    return res.status(401).json({
      error: "يجب تسجيل الدخول",
    });
  }

  if (!GIPHY_API_KEY) {
    return res.status(500).json({
      error: "GIPHY API key غير موجود في الخادم",
    });
  }

  const query = String(req.query.q || "").trim();

  const limit = Math.min(
    parseInt(req.query.limit, 10) || 24,
    50
  );

  const offset = Math.max(
    parseInt(req.query.offset, 10) || 0,
    0
  );

  if (!query) {
    return res.status(400).json({
      error: "يجب إدخال كلمة للبحث",
    });
  }

  try {
    const url = new URL(
      "https://api.giphy.com/v1/gifs/search"
    );

    url.searchParams.set("api_key", GIPHY_API_KEY);
    url.searchParams.set("q", query);
    url.searchParams.set("limit", String(limit));
    url.searchParams.set("offset", String(offset));

    // محتوى مناسب للتطبيق
    url.searchParams.set("rating", "pg-13");

    const giphyRes = await fetch(url.toString());

    if (!giphyRes.ok) {
      const errorText = await giphyRes.text();

      console.error(
        "GIPHY API error:",
        giphyRes.status,
        errorText
      );

      return res.status(502).json({
        error: "تعذر جلب نتائج GIF حاليًا",
      });
    }

    const data = await giphyRes.json();

    const results = (data.data || [])
      .map((item) => {
        const original = item.images?.original;
        const preview = item.images?.fixed_width_small;

        return {
          id: item.id || "",

          url: original?.url || "",

          previewUrl:
            preview?.url ||
            original?.url ||
            "",

          width:
            parseInt(original?.width, 10) || 0,

          height:
            parseInt(original?.height, 10) || 0,

          title: item.title || "",

          username: item.username || "",

          source: "giphy",
        };
      })
      .filter((gif) => gif.url);

    res.status(200).json({
      results,

      pagination: {
        total:
          data.pagination?.total_count || 0,

        count:
          data.pagination?.count || results.length,

        offset:
          data.pagination?.offset || offset,
      },

      // لتسهيل التعامل مع التطبيق
      nextOffset: offset + results.length,
    });
  } catch (error) {
    console.error("GIPHY search error:", error);

    res.status(500).json({
      error: "حدث خطأ غير متوقع أثناء البحث عن GIF",
    });
  }
});

// ============================================================
// FCM — Send Push Notification
// ============================================================

app.post("/sendPush", async (req, res) => {
  try {
    const { uid, notif } = req.body;

    if (!uid || !notif) {
      return res.status(400).json({
        error: "بيانات ناقصة",
      });
    }

    // --------------------------------------------------------
    // التحقق من وجود المستخدم
    // --------------------------------------------------------

    const userDoc = await db
      .collection("users")
      .doc(uid)
      .get();

    if (!userDoc.exists) {
      return res.status(404).json({
        error: "المستخدم غير موجود",
      });
    }

    // --------------------------------------------------------
    // جلب FCM Token
    // --------------------------------------------------------

    const userData = userDoc.data() || {};

    const token = userData.fcmToken;

    if (!token) {
      return res.status(404).json({
        error: "لا يوجد رمز FCM للمستخدم",
      });
    }

    // --------------------------------------------------------
    // بناء نص الإشعار
    // --------------------------------------------------------

    const { title, body } =
      buildNotificationText(notif);

    if (!body) {
      return res.status(400).json({
        error: "محتوى الإشعار فارغ",
      });
    }

    // --------------------------------------------------------
    // إرسال FCM
    // --------------------------------------------------------

    const message = {
      token,

      notification: {
        title,
        body,
      },

      data: {
        type: String(notif.type || ""),
        postId: String(notif.postId || ""),
        fromUid: String(notif.fromUid || ""),
        conversationId: String(
          notif.conversationId || ""
        ),
      },

      android: {
        priority: "high",

        notification: {
          channelId: "lammah_notifications",
          sound: "default",
        },
      },
    };

    const response = await messaging.send(message);

    console.log(
      `✅ Push notification sent to ${uid}: ${response}`
    );

    return res.status(200).json({
      success: true,
      messageId: response,
    });
  } catch (error) {
    console.error(
      "❌ Push notification error:",
      error
    );

    // --------------------------------------------------------
    // إذا كان FCM Token منتهيًا أو غير صالح
    // --------------------------------------------------------

    if (
      error.code ===
        "messaging/registration-token-not-registered" ||
      error.code ===
        "messaging/invalid-registration-token"
    ) {
      try {
        const uid = req.body?.uid;

        if (uid) {
          await db
            .collection("users")
            .doc(uid)
            .update({
              fcmToken: admin.firestore.FieldValue.delete(),
            });

          console.log(
            `🧹 Invalid FCM token removed for ${uid}`
          );
        }
      } catch (cleanupError) {
        console.error(
          "Token cleanup error:",
          cleanupError.message
        );
      }
    }

    return res.status(500).json({
      error: "فشل إرسال الإشعار",
      code: error.code || "unknown",
    });
  }
});

// ============================================================
// Test Push Notification
// ============================================================
//
// للاختبار فقط.
//
// POST /testPush
//
// Body:
// {
//   "uid": "USER_UID"
// }
//
// ============================================================

app.post("/testPush", async (req, res) => {
  try {
    const { uid } = req.body;

    if (!uid) {
      return res.status(400).json({
        error: "uid مطلوب",
      });
    }

    const userDoc = await db
      .collection("users")
      .doc(uid)
      .get();

    if (!userDoc.exists) {
      return res.status(404).json({
        error: "المستخدم غير موجود",
      });
    }

    const token = userDoc.get("fcmToken");

    if (!token) {
      return res.status(404).json({
        error: "المستخدم لا يملك FCM Token",
      });
    }

    const response = await messaging.send({
      token,

      notification: {
        title: "لَمّة 🔔",
        body: "هذا إشعار تجريبي من Render",
      },

      data: {
        type: "test",
      },

      android: {
        priority: "high",

        notification: {
          channelId: "lammah_notifications",
          sound: "default",
        },
      },
    });

    console.log(
      `✅ Test notification sent: ${response}`
    );

    return res.status(200).json({
      success: true,
      messageId: response,
      message: "تم إرسال الإشعار التجريبي",
    });
  } catch (error) {
    console.error(
      "❌ Test notification error:",
      error
    );

    return res.status(500).json({
      success: false,
      error: error.message,
      code: error.code || "unknown",
    });
  }
});

// ============================================================
// Notification Text
// ============================================================

function buildNotificationText(notif) {
  const name = notif.fromName || "شخص ما";

  switch (notif.type) {
    case "like":
      return {
        title: "لَمّة ❤️",
        body: `${name} أعجب بمنشورك`,
      };

    case "comment":
      return {
        title: "لَمّة 💬",
        body: `${name} علّق على منشورك`,
      };

    case "friend_request":
      return {
        title: "لَمّة 👥",
        body: `${name} أرسل لك طلب صداقة`,
      };

    case "friend_accept":
      return {
        title: "لَمّة 🤝",
        body: `${name} قبل طلب صداقتك`,
      };

    case "message":
      return {
        title: "لَمّة 💬",
        body: `${name} أرسل لك رسالة جديدة`,
      };

    default:
      return {
        title: "لَمّة",
        body: "",
      };
  }
}

// ============================================================
// 404
// ============================================================

app.use((req, res) => {
  res.status(404).json({
    error: "Endpoint غير موجود",
    path: req.path,
  });
});

// ============================================================
// Error Handler
// ============================================================

app.use((error, req, res, next) => {
  console.error("Server error:", error);

  res.status(500).json({
    error: "حدث خطأ في الخادم",
  });
});

// ============================================================
// Start Server
// ============================================================

app.listen(PORT, () => {
  console.log("======================================");
  console.log("🚀 Lammah Render Server");
  console.log(`🌐 Port: ${PORT}`);
  console.log("🔥 Firebase Admin: initialized");
  console.log(
    `🖼️ GIPHY: ${
      GIPHY_API_KEY ? "configured" : "MISSING"
    }`
  );
  console.log("🔔 FCM: ready");
  console.log("======================================");
});
```
