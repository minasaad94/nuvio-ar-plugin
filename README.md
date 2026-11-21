# Arabic Direct Streams — Nuvio Native Plugins Pack (v2.3 / MySeed Fixed)

تحديث شامل لمصدر **MySeed (`https://m.myseed.tv`)** بناءً على الهيكلة الفعلية لصفحة المشاهدة:
- إزالة رابط الـ SEO الوهمي (`/video/ID.mp4`) الذي كان يظهر كـ `Auto` ولا يعمل.
- جلب جميع الجودات المتاحة (`1080p`, `720p`, `480p`) عبر AJAX مع `csrf__token`.
- فك تغليف روابط السيرفرات الخارجية (`m.myseed.pics/vid/?id=BASE64`) وفحص السيرفر المباشر (`/vids.php?t=...`).
- إظهار حجم الملف ونوع النسخة (مترجم / مدبلج) في عنوان الرابط داخل Nuvio.

## خطوات التحديث
1. استبدل ملفات مستودع `minasaad94/nuvio-ar-plugin` بمحتويات `nuvio-arabic-plugins-v5.zip` (أو استبدل `providers/myseed.js` و `manifest.json` فقط).
2. داخل تطبيق **Nuvio** ← **Settings** ← **Plugins** ← اضغط **Refresh**.
