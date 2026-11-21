# Arabic Direct Streams — Nuvio Native Plugins Pack (v2.2 / MySeed Edition)

مستودع إضافات محلية (Native Plugins) لتطبيق **Nuvio** مضبوط مسبقاً على مستودع `minasaad94/nuvio-ar-plugin` ومجهّز للرفع المباشر بدون أي تعديل يدوي في الروابط.

## المحتويات
```text
├── domains.json             # ملف الدومينات المركزي (يتضمن https://m.myseed.tv)
├── manifest.json            # تعريف المصادر لتطبيق Nuvio (v2.2.0)
├── providers/
│   ├── myseed.js            # سكرابر MySeed / ArabSeed المحدث (مفعّل افتراضياً)
│   ├── cimanow.js           # سكرابر CimaNow (محدّث لرابط مستودعك)
│   ├── akoam.js             # سكرابر Akoam (محدّث لرابط مستودعك)
│   └── arabseed.js          # النسخة الكلاسيكية الاحتياطية من عرب سيد
└── README.md
```

## خطوات الرفع والتحديث على GitHub
1. فك ضغط ملف `nuvio-arabic-plugins-v4.zip` وارفع محتوياته إلى جذر مستودع `minasaad94/nuvio-ar-plugin` (استبدل الملفات القديمة).
2. داخل تطبيق **Nuvio** ← **Settings** ← **Plugins / Local Scrapers** ← اضغط **Refresh** للمستودع.
3. تأكد أن مصدر **MySeed (ArabSeed)** ظاهر ومفعّل.
4. مستقبلاً عند تغيّر أي دومين، عدّل ملف `domains.json` فقط على GitHub.
