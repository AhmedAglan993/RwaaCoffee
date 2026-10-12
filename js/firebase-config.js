// =====================================================
//  إعدادات Firebase - ضع بيانات مشروعك هنا
//  (Firebase Console > Project settings > Your apps > Web app > Config)
//  راجع README.md للخطوات
// =====================================================
export const firebaseConfig = {
  apiKey: "AIzaSyDwhUT72z-qMPkVQeds2nAWc_CM25EY68o",
  authDomain: "rwaacoffee.firebaseapp.com",
  projectId: "rwaacoffee",
  storageBucket: "rwaacoffee.firebasestorage.app",
  messagingSenderId: "74124929681",
  appId: "1:74124929681:web:0295664052e00e1425ed30"
};

// مفتاح الدولة (مصر = 20) يُستخدم لتوحيد الأرقام ولروابط واتساب
export const COUNTRY_CODE = "20";

// تسجيل الدخول باسم مستخدم: يتحول داخلياً إلى بريد  username@LOGIN_DOMAIN
// (مثال: heely  =>  heely@rwaa.com). لا يلزم أن يكون بريداً حقيقياً.
export const LOGIN_DOMAIN = "rwaa.com";

// اسم مجموعة العملاء في قاعدة البيانات
export const COLLECTION = "customers";
