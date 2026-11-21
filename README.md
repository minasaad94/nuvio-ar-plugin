# Arabic Direct Streams — Nuvio Native Plugins Pack (v2.1)

مستودع إضافات محلية (Native Plugins) لتطبيق **Nuvio** مع ملف إعدادات مركزي واحد (`domains.json`) لتحديث دومينات المصادر الثلاثة من مكان واحد بدون تعديل ملفات الكود.

## هيكل الملفات
```text
├── domains.json             # ملف مركزي لتحديث جميع الدومينات من مكان واحد
├── manifest.json            # ملف تعريف المستودع لتطبيق Nuvio
├── providers/
│   ├── cimanow.js
│   ├── akoam.js
│   └── arabseed.js
└── README.md
```

## خطوات التجهيز (مرة واحدة فقط)

1. ارفع الملفات إلى مستودع **Public** على GitHub (مثلاً باسم `nuvio-arabic-streams`).
2. افتح كل ملف من الثلاثة داخل `providers/` مرة واحدة فقط، وعدّل سطر `DOMAINS_URL` ليحمل اسم حسابك واسم المستودع:
   ```javascript
   DOMAINS_URL: 'https://raw.githubusercontent.com/YOUR_USERNAME/YOUR_REPO/main/domains.json',
   ```
3. أضف رابط المستودع داخل تطبيق **Nuvio** ← **Settings** ← **Plugins** ← **Add Repository**.

## التحديث مستقبلاً (في 10 ثواني من الموبايل)
عندما يتغير دومين أي موقع، افتح ملف **`domains.json`** فقط على GitHub، عدّل الدومين الجديد، واضغط **Commit**. ستقرأ الإضافات التحديث تلقائياً (الكاش يتحدث كل 30 دقيقة أو فوراً عند إعادة تشغيل التطبيق).
