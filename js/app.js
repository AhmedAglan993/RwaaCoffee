import { initializeApp } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-app.js";
import {
  getAuth, onAuthStateChanged, signInWithEmailAndPassword, signOut,
} from "https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js";
import {
  getFirestore, collection, doc, query, orderBy, onSnapshot,
  runTransaction, deleteDoc, serverTimestamp,
  setDoc, updateDoc, arrayUnion, arrayRemove,
} from "https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js";
import { firebaseConfig, COUNTRY_CODE, COLLECTION, LOGIN_DOMAIN } from "./firebase-config.js";

/* ---------------------------------------------------------
   أدوات مساعدة
--------------------------------------------------------- */
const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

const esc = (s) =>
  String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

const ARABIC_DIGITS = "٠١٢٣٤٥٦٧٨٩";
const PERSIAN_DIGITS = "۰۱۲۳۴۵۶۷۸۹";
function toLatinDigits(str) {
  return String(str ?? "").replace(/[٠-٩۰-۹]/g, (d) => {
    const i = ARABIC_DIGITS.indexOf(d);
    return i > -1 ? i : PERSIAN_DIGITS.indexOf(d);
  });
}

/** توحيد صيغة الرقم (مصر): 01012345678 / +201012345678 / 00201012345678 / 1012345678  => 01012345678 */
function normalizePhone(raw) {
  let s = toLatinDigits(raw).replace(/\D/g, "");
  if (s.startsWith("00")) s = s.slice(2);
  if (s.startsWith(COUNTRY_CODE) && s.length === COUNTRY_CODE.length + 10) {
    s = "0" + s.slice(COUNTRY_CODE.length);
  } else if (/^1[0125]\d{8}$/.test(s)) {
    s = "0" + s;
  }
  return s;
}
/** رقم موبايل مصري: 010 / 011 / 012 / 015 + 8 أرقام */
const isValidPhone = (p) => /^01[0125]\d{8}$/.test(p);

function waNumber(phone) {
  return phone.startsWith("0") ? COUNTRY_CODE + phone.slice(1) : phone;
}

const cleanText = (s) => String(s ?? "").replace(/\s+/g, " ").trim();

function formatDate(ts) {
  if (!ts) return "—";
  try {
    return ts.toDate().toLocaleDateString("ar-SA-u-nu-latn-ca-gregory", { year: "numeric", month: "long", day: "numeric" });
  } catch { return "—"; }
}

function showError(el, msg) {
  el.textContent = msg;
  el.hidden = !msg;
}

let toastTimer;
function toast(msg, type = "ok") {
  const t = $("#toast");
  t.textContent = msg;
  t.className = `toast show ${type}`;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (t.className = "toast"), 2400);
}

async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    const ta = document.createElement("textarea");
    ta.value = text; ta.style.position = "fixed"; ta.style.opacity = "0";
    document.body.appendChild(ta); ta.select();
    document.execCommand("copy");
    ta.remove();
  }
  toast("تم نسخ الرقم ✓");
}

/* ---------------------------------------------------------
   التهيئة
--------------------------------------------------------- */
const splash = $("#splash");
const hideSplash = () => splash.classList.add("hide");

const isConfigured = !String(firebaseConfig.apiKey).startsWith("PASTE");
if (!isConfigured) {
  hideSplash();
  $("#setupView").hidden = false;
  throw new Error("Firebase config is missing");
}

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);
const col = collection(db, COLLECTION);

/** كل العملاء في الذاكرة: Map(id => customer) */
let customers = new Map();
let unsubscribe = null;

/** أنواع البن (مصفوفة نصوص محفوظة في مستند واحد settings/beans) */
const DEFAULT_BEANS = ["برازيلي جولد", "برازيلي ريو", "كولومبي", "برازيلي رويال", "اسبرسو"];
const beansRef = doc(db, "settings", "beans");
let beanTypes = [];
let unsubscribeBeans = null;

/* ---------------------------------------------------------
   تسجيل الدخول / الخروج
--------------------------------------------------------- */
const authMessages = {
  "auth/invalid-credential": "اسم المستخدم أو كلمة المرور غير صحيحة",
  "auth/wrong-password": "كلمة المرور غير صحيحة",
  "auth/user-not-found": "اسم المستخدم أو كلمة المرور غير صحيحة",
  "auth/invalid-email": "اسم المستخدم غير صحيح",
  "auth/too-many-requests": "محاولات كثيرة، حاول مرة أخرى بعد قليل",
  "auth/network-request-failed": "تعذّر الاتصال بالإنترنت",
};

$("#loginForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const username = $("#loginUser").value.trim().toLowerCase();
  const pass = $("#loginPassword").value;
  const err = $("#loginError");
  showError(err, "");
  if (!username || !pass) return showError(err, "أدخل اسم المستخدم وكلمة المرور");
  // يقبل اسم المستخدم فقط (heely) أو البريد الكامل (heely@rwaa.com)
  const isEmail = username.includes("@");
  if (!isEmail && !/^[a-z0-9._-]+$/.test(username)) return showError(err, "اسم المستخدم يجب أن يكون بالأحرف الإنجليزية أو الأرقام");
  const email = isEmail ? username : `${username}@${LOGIN_DOMAIN}`;
  const btn = $("#loginBtn");
  btn.disabled = true; btn.textContent = "جارٍ الدخول...";
  try {
    await signInWithEmailAndPassword(auth, email, pass);
  } catch (ex) {
    showError(err, authMessages[ex.code] || "تعذّر تسجيل الدخول");
  } finally {
    btn.disabled = false; btn.textContent = "دخول";
  }
});

$("#logoutBtn").addEventListener("click", () => signOut(auth));

onAuthStateChanged(auth, (user) => {
  hideSplash();
  if (user) {
    $("#loginView").hidden = true;
    $("#appView").hidden = false;
    startListening();
  } else {
    stopListening();
    $("#appView").hidden = true;
    $("#loginView").hidden = false;
    $("#loginPassword").value = "";
  }
});

function startListening() {
  stopListening();
  listenBeans();
  unsubscribe = onSnapshot(
    query(col, orderBy("createdAt", "desc")),
    (snap) => {
      customers = new Map();
      snap.forEach((d) => {
        const v = d.data({ serverTimestamps: "estimate" });
        customers.set(d.id, { id: d.id, ...v });
      });
      onDataChanged();
    },
    (err) => {
      console.error(err);
      toast(err.code === "permission-denied" ? "لا تملك صلاحية الوصول للبيانات" : "تعذّر تحميل البيانات", "err");
    }
  );
}
function stopListening() {
  if (unsubscribe) unsubscribe();
  if (unsubscribeBeans) unsubscribeBeans();
  unsubscribe = unsubscribeBeans = null;
  customers = new Map();
  beanTypes = [];
}

function listenBeans() {
  unsubscribeBeans = onSnapshot(
    beansRef,
    (snap) => {
      if (!snap.exists()) {
        // أول تشغيل: أضف الأنواع الافتراضية
        if (!snap.metadata.hasPendingWrites) setDoc(beansRef, { types: DEFAULT_BEANS }).catch(console.error);
        return;
      }
      const t = snap.data().types;
      beanTypes = Array.isArray(t) ? t : [];
      renderBeanSelects();
      renderBeanTypes();
      renderMsgFilter();
    },
    (err) => {
      console.error(err);
      toast(err.code === "permission-denied" ? "لا تملك صلاحية الوصول للبيانات" : "تعذّر تحميل أنواع البن", "err");
    }
  );
}

/* ---------------------------------------------------------
   التبويبات
--------------------------------------------------------- */
function switchTab(name) {
  $$(".panel").forEach((p) => p.classList.toggle("active", p.id === `tab-${name}`));
  $$(".tab").forEach((t) => t.classList.toggle("active", t.dataset.tab === name));
  window.scrollTo({ top: 0 });
}
$$(".tab").forEach((t) => t.addEventListener("click", () => switchTab(t.dataset.tab)));

/* ---------------------------------------------------------
   عرض القائمة
--------------------------------------------------------- */
function onDataChanged() {
  $$("[data-count]").forEach((b) => (b.textContent = customers.size));
  renderBeanTypes();
  renderList();
  selected.forEach((id) => !customers.has(id) && selected.delete(id));
  renderMsgFilter();
  renderMsgList();
  checkAddDuplicate();
  if (!$("#modal").hidden && currentId) {
    const c = customers.get(currentId);
    if (!c) closeModal();
    else if (!$("#viewMode").hidden) fillView(c);
  }
}

/* ---------------------------------------------------------
   أنواع البن (القوائم المنسدلة + قسم الإدارة)
--------------------------------------------------------- */
/** مفتاح مقارنة يتجاهل الفروق البسيطة (ى/ي، أ/إ/آ/ا، المسافات) */
const beanKey = (s) =>
  cleanText(s).toLowerCase().replace(/[أإآ]/g, "ا").replace(/ى/g, "ي").replace(/ـ/g, "");

function fillSelect(sel, selected, placeholder) {
  const values = [...beanTypes];
  // لو نوع العميل محذوف من القائمة، يبقى ظاهراً لكي لا يضيع
  if (selected && !values.some((b) => beanKey(b) === beanKey(selected))) values.push(selected);
  sel.innerHTML =
    (placeholder ? `<option value="">${esc(placeholder)}</option>` : "") +
    values.map((b) => `<option value="${esc(b)}">${esc(b)}</option>`).join("");
  const match = values.find((b) => beanKey(b) === beanKey(selected));
  sel.value = match ?? "";
}

function renderBeanSelects() {
  const add = $("#addBeans");
  fillSelect(add, add.value, "اختر البن المفضل");
  if (!$("#editMode").hidden) {
    const edit = $("#editBeans");
    fillSelect(edit, edit.value);
  }
}

function renderBeanTypes() {
  $$("[data-bean-count]").forEach((b) => (b.textContent = beanTypes.length));
  const counts = new Map();
  customers.forEach((c) => {
    const k = beanKey(c.beans);
    counts.set(k, (counts.get(k) || 0) + 1);
  });
  $("#beanList").innerHTML = beanTypes.length
    ? beanTypes.map((b) => `
      <div class="bean-item">
        <div>
          <strong>${esc(b)}</strong>
          <small class="muted">${counts.get(beanKey(b)) || 0} عميل</small>
        </div>
        <button type="button" class="btn btn-danger-outline btn-sm" data-bean="${esc(b)}">حذف</button>
      </div>`).join("")
    : `<p class="muted">لا توجد أنواع بن بعد</p>`;
}

$("#beanForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const err = $("#beanError");
  const input = $("#beanName");
  showError(err, "");
  const name = cleanText(input.value);
  if (!name) return showError(err, "أدخل اسم نوع البن");
  if (beanTypes.some((b) => beanKey(b) === beanKey(name))) return showError(err, "هذا النوع موجود بالفعل");
  const btn = $("#beanAddBtn");
  btn.disabled = true;
  try {
    await updateDoc(beansRef, { types: arrayUnion(name) });
    input.value = "";
    toast("تمت إضافة نوع البن ✓");
  } catch (ex) {
    console.error(ex);
    showError(err, "تعذّرت الإضافة، حاول مرة أخرى");
  } finally {
    btn.disabled = false;
  }
});

$("#beanList").addEventListener("click", (e) => {
  const btn = e.target.closest("[data-bean]");
  if (!btn) return;
  const name = btn.dataset.bean;
  openConfirm("حذف نوع البن", `هل تريد حذف «${name}» من قائمة الأنواع؟`, async () => {
    await updateDoc(beansRef, { types: arrayRemove(name) });
    toast("تم حذف نوع البن");
  });
});

function matches(c, q) {
  if (!q) return true;
  const nq = toLatinDigits(q).toLowerCase();
  const digits = nq.replace(/\D/g, "");
  return (
    (c.name || "").toLowerCase().includes(nq) ||
    (c.beans || "").toLowerCase().includes(nq) ||
    (digits && (c.phone || "").includes(digits))
  );
}

function renderList() {
  const q = cleanText($("#searchInput").value);
  const all = [...customers.values()];
  const list = all.filter((c) => matches(c, q));
  const box = $("#customerList");

  $("#countLine").textContent = all.length
    ? q ? `${list.length} نتيجة من ${all.length} عميل` : `إجمالي العملاء: ${all.length}`
    : "";

  $("#emptyState").hidden = list.length > 0;
  $("#emptyText").textContent = all.length ? "لا توجد نتائج مطابقة للبحث" : "لا يوجد عملاء مسجلون بعد";

  box.innerHTML = list.map((c) => `
    <article class="customer" data-id="${esc(c.id)}">
      <div class="customer-main">
        <div class="avatar">${esc([...(c.name || "?")][0])}</div>
        <div class="customer-info">
          <h4>${esc(c.name)}</h4>
          <div class="meta">
            <span class="phone" dir="ltr">${esc(c.phone)}</span>
            <span class="beans">☕ ${esc(c.beans)}</span>
          </div>
        </div>
      </div>
      <div class="customer-actions">
        <button type="button" class="btn btn-outline btn-sm" data-action="copy">نسخ الرقم</button>
        <button type="button" class="btn btn-outline btn-sm" data-action="view">عرض</button>
        <button type="button" class="btn btn-primary btn-sm" data-action="edit">تعديل</button>
      </div>
    </article>`).join("");
}

$("#searchInput").addEventListener("input", renderList);

$("#customerList").addEventListener("click", (e) => {
  const btn = e.target.closest("[data-action]");
  if (!btn) return;
  const id = btn.closest(".customer").dataset.id;
  const c = customers.get(id);
  if (!c) return;
  if (btn.dataset.action === "copy") copyText(c.phone);
  if (btn.dataset.action === "view") openModal(id, "view");
  if (btn.dataset.action === "edit") openModal(id, "edit");
});

/* ---------------------------------------------------------
   إضافة عميل + كشف التكرار
--------------------------------------------------------- */
const addPhone = $("#addPhone");
let dupId = null;

function checkAddDuplicate() {
  const p = normalizePhone(addPhone.value);
  const existing = p && customers.get(p);
  dupId = existing ? existing.id : null;
  $("#dupAlert").hidden = !existing;
  if (existing) {
    $("#dupName").textContent = existing.name;
    $("#dupPhone").textContent = existing.phone;
    $("#dupBeans").textContent = "☕ " + existing.beans;
  }
}
addPhone.addEventListener("input", checkAddDuplicate);
$("#dupView").addEventListener("click", () => dupId && openModal(dupId, "view"));
$("#dupEdit").addEventListener("click", () => dupId && openModal(dupId, "edit"));

function validate(name, phone, beans) {
  if (!name) return "أدخل اسم العميل";
  if (!phone) return "أدخل رقم الجوال";
  if (!isValidPhone(phone)) return "رقم الجوال غير صحيح (مثال: 01012345678)";
  if (!beans) return "أدخل البن المفضل";
  return "";
}

$("#addForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const err = $("#addError");
  showError(err, "");

  const name = cleanText($("#addName").value);
  const phone = normalizePhone(addPhone.value);
  const beans = cleanText($("#addBeans").value);

  const v = validate(name, phone, beans);
  if (v) return showError(err, v);

  checkAddDuplicate();
  if (dupId) {
    $("#dupAlert").scrollIntoView({ behavior: "smooth", block: "center" });
    return showError(err, "هذا الرقم مسجّل بالفعل، لا يمكن إضافته مرة أخرى");
  }

  const btn = $("#addBtn");
  btn.disabled = true; btn.textContent = "جارٍ الحفظ...";
  try {
    const ref = doc(db, COLLECTION, phone);
    await runTransaction(db, async (tx) => {
      const snap = await tx.get(ref);
      if (snap.exists()) throw new Error("DUP");
      tx.set(ref, { name, phone, beans, createdAt: serverTimestamp(), updatedAt: serverTimestamp() });
    });
    $("#addForm").reset();
    $("#dupAlert").hidden = true;
    toast("تمت إضافة العميل بنجاح ✓");
    $("#addName").focus();
  } catch (ex) {
    if (ex.message === "DUP") {
      showError(err, "هذا الرقم مسجّل بالفعل");
    } else {
      console.error(ex);
      showError(err, "تعذّر الحفظ، تحقق من الاتصال وحاول مرة أخرى");
    }
  } finally {
    btn.disabled = false; btn.textContent = "حفظ العميل";
  }
});

/* ---------------------------------------------------------
   نافذة العرض / التعديل
--------------------------------------------------------- */
const modal = $("#modal");
let currentId = null;

function fillView(c) {
  $("#vName").textContent = c.name;
  $("#vPhone").textContent = c.phone;
  $("#vBeans").textContent = c.beans;
  $("#vDate").textContent = formatDate(c.createdAt);
  $("#vCall").href = `tel:${c.phone}`;
  $("#vWa").href = `https://wa.me/${waNumber(c.phone)}`;
}

function openModal(id, mode) {
  const c = customers.get(id);
  if (!c) return;
  currentId = id;
  modal.hidden = false;
  document.body.classList.add("no-scroll");
  if (mode === "edit") setEditMode(c); else setViewMode(c);
}

function setViewMode(c) {
  $("#modalTitle").textContent = "بيانات العميل";
  $("#editMode").hidden = true;
  $("#viewMode").hidden = false;
  fillView(c);
}

function setEditMode(c) {
  $("#modalTitle").textContent = "تعديل بيانات العميل";
  $("#viewMode").hidden = true;
  $("#editMode").hidden = false;
  $("#editName").value = c.name;
  $("#editPhone").value = c.phone;
  fillSelect($("#editBeans"), c.beans);
  showError($("#editError"), "");
  $("#editDup").hidden = true;
}

function closeModal() {
  modal.hidden = true;
  currentId = null;
  document.body.classList.remove("no-scroll");
}

$$("[data-close]").forEach((el) => el.addEventListener("click", closeModal));
document.addEventListener("keydown", (e) => {
  if (e.key !== "Escape") return;
  if (!$("#confirmBox").hidden) closeConfirm();
  else if (!modal.hidden) closeModal();
});

$("#vCopy").addEventListener("click", () => currentId && copyText(customers.get(currentId).phone));
$("#vEdit").addEventListener("click", () => currentId && setEditMode(customers.get(currentId)));
$("#editCancel").addEventListener("click", () => currentId && setViewMode(customers.get(currentId)));

/* تنبيه التكرار أثناء التعديل */
$("#editPhone").addEventListener("input", () => {
  const p = normalizePhone($("#editPhone").value);
  const other = p && p !== currentId && customers.get(p);
  const box = $("#editDup");
  box.hidden = !other;
  if (other) box.innerHTML = `<div class="dup-title">⚠️ هذا الرقم مسجّل لعميل آخر</div><div class="dup-info"><strong>${esc(other.name)}</strong><span dir="ltr">${esc(other.phone)}</span></div>`;
});

$("#editMode").addEventListener("submit", async (e) => {
  e.preventDefault();
  const err = $("#editError");
  showError(err, "");
  const oldId = currentId;
  const old = customers.get(oldId);
  if (!old) return;

  const name = cleanText($("#editName").value);
  const phone = normalizePhone($("#editPhone").value);
  const beans = cleanText($("#editBeans").value);

  const v = validate(name, phone, beans);
  if (v) return showError(err, v);
  if (phone !== oldId && customers.has(phone)) return showError(err, "هذا الرقم مسجّل لعميل آخر");

  const btn = $("#editSave");
  btn.disabled = true; btn.textContent = "جارٍ الحفظ...";
  try {
    await runTransaction(db, async (tx) => {
      const oldRef = doc(db, COLLECTION, oldId);
      const newRef = doc(db, COLLECTION, phone);
      if (phone === oldId) {
        tx.update(oldRef, { name, beans, updatedAt: serverTimestamp() });
      } else {
        const [newSnap, oldSnap] = [await tx.get(newRef), await tx.get(oldRef)];
        if (newSnap.exists()) throw new Error("DUP");
        const createdAt = oldSnap.exists() ? oldSnap.data().createdAt : serverTimestamp();
        tx.delete(oldRef);
        tx.set(newRef, { name, phone, beans, createdAt, updatedAt: serverTimestamp() });
      }
    });
    currentId = phone;
    toast("تم حفظ التعديلات ✓");
    // انتظر وصول البيانات المحدّثة ثم اعرضها
    const show = () => {
      const c = customers.get(phone);
      if (c) setViewMode(c); else setTimeout(show, 80);
    };
    show();
  } catch (ex) {
    if (ex.message === "DUP") showError(err, "هذا الرقم مسجّل لعميل آخر");
    else { console.error(ex); showError(err, "تعذّر الحفظ، حاول مرة أخرى"); }
  } finally {
    btn.disabled = false; btn.textContent = "حفظ التعديلات";
  }
});

/* ---------------------------------------------------------
   الحذف
--------------------------------------------------------- */
const confirmBox = $("#confirmBox");
const closeConfirm = () => (confirmBox.hidden = true);
$$("[data-close-confirm]").forEach((el) => el.addEventListener("click", closeConfirm));

let confirmAction = null;

function openConfirm(title, text, action) {
  $("#confirmTitle").textContent = title;
  $("#confirmText").textContent = text;
  confirmAction = action;
  confirmBox.hidden = false;
}

$("#vDelete").addEventListener("click", () => {
  const c = customers.get(currentId);
  if (!c) return;
  const id = c.id;
  openConfirm("حذف العميل", `هل تريد حذف العميل «${c.name}» نهائياً؟ لا يمكن التراجع عن هذا الإجراء.`, async () => {
    await deleteDoc(doc(db, COLLECTION, id));
    closeModal();
    toast("تم حذف العميل");
  });
});

$("#confirmYes").addEventListener("click", async () => {
  if (!confirmAction) return;
  const btn = $("#confirmYes");
  btn.disabled = true;
  try {
    await confirmAction();
    closeConfirm();
  } catch (ex) {
    console.error(ex);
    toast("تعذّر تنفيذ الحذف", "err");
  } finally {
    btn.disabled = false;
  }
});

/* ---------------------------------------------------------
   الرسائل (إرسال موجَّه عبر واتساب بدون API)
   - نص الرسالة وحالة "تم الإرسال" تُحفظ على هذا الجهاز
--------------------------------------------------------- */
const MSG_KEY = "rwaa_msg_template";
const SENT_KEY = "rwaa_msg_sent";
const DEFAULT_MSG = "أهلاً {الاسم} 👋\nمعك بن رواق - أصل المحوج ☕\n";

const selected = new Set();
const msgText = $("#msgText");
msgText.value = localStorage.getItem(MSG_KEY) ?? DEFAULT_MSG;

const currentTemplate = () => msgText.value.trim();

function buildMessage(c) {
  return currentTemplate().replace(/\{الاسم\}/g, c.name).replace(/\{البن\}/g, c.beans);
}

/** حالة الإرسال مرتبطة بنص الرسالة: لو تغيّر النص تبدأ حملة جديدة */
function getSent() {
  try {
    const s = JSON.parse(localStorage.getItem(SENT_KEY) || "null");
    if (s && s.msg === currentTemplate() && Array.isArray(s.ids)) return new Set(s.ids);
  } catch { /* تجاهل */ }
  return new Set();
}
function markSent(id) {
  const ids = getSent();
  ids.add(id);
  localStorage.setItem(SENT_KEY, JSON.stringify({ msg: currentTemplate(), ids: [...ids] }));
}

function renderMsgFilter() {
  const sel = $("#msgBeanFilter");
  const prev = sel.value;
  const keys = new Map();
  beanTypes.forEach((b) => keys.set(beanKey(b), b));
  customers.forEach((c) => c.beans && !keys.has(beanKey(c.beans)) && keys.set(beanKey(c.beans), c.beans));
  sel.innerHTML =
    `<option value="">كل أنواع البن</option>` +
    [...keys].map(([k, b]) => `<option value="${esc(k)}">${esc(b)}</option>`).join("");
  sel.value = keys.has(prev) ? prev : "";
}

function visibleForMessages() {
  const bean = $("#msgBeanFilter").value;
  const q = cleanText($("#msgSearch").value);
  return [...customers.values()].filter((c) => (!bean || beanKey(c.beans) === bean) && matches(c, q));
}

function renderMsgList() {
  const list = visibleForMessages();
  const sent = getSent();

  $("#msgEmpty").hidden = list.length > 0;
  $("#msgList").innerHTML = list.map((c) => `
    <div class="msg-row ${selected.has(c.id) ? "is-selected" : ""}" data-id="${esc(c.id)}">
      <label class="msg-check">
        <input type="checkbox" data-sel ${selected.has(c.id) ? "checked" : ""}>
        <span class="msg-who">
          <strong>${esc(c.name)}</strong>
          <small><span dir="ltr">${esc(c.phone)}</span> · ☕ ${esc(c.beans)}</small>
        </span>
      </label>
      ${sent.has(c.id) ? `<span class="sent-tag">تم الإرسال ✓</span>` : ""}
      <button type="button" class="btn btn-whatsapp btn-sm" data-send>${sent.has(c.id) ? "إعادة" : "إرسال"}</button>
    </div>`).join("");

  const pending = [...selected].filter((id) => !sent.has(id)).length;
  $("#msgSelCount").textContent = selected.size ? `المحدد: ${selected.size}` : "";
  const next = $("#msgSendNext");
  next.textContent = selected.size
    ? pending ? `إرسال للتالي (المتبقي ${pending})` : "تم الإرسال للجميع ✓"
    : "حدّد العملاء أولاً";
  next.disabled = !pending;

  // معاينة
  const sample = customers.get([...selected][0]) || list[0];
  const box = $("#msgPreview");
  box.hidden = !(sample && currentTemplate());
  if (!box.hidden) $("#msgPreviewText").textContent = buildMessage(sample);
}

function sendTo(id) {
  const c = customers.get(id);
  if (!c) return;
  if (!currentTemplate()) {
    toast("اكتب نص الرسالة أولاً", "err");
    msgText.focus();
    return;
  }
  window.open(`https://wa.me/${waNumber(c.phone)}?text=${encodeURIComponent(buildMessage(c))}`, "_blank", "noopener");
  markSent(id);
  renderMsgList();
}

msgText.addEventListener("input", () => {
  localStorage.setItem(MSG_KEY, msgText.value);
  renderMsgList();
});

$$(".chip").forEach((chip) =>
  chip.addEventListener("click", () => {
    const tag = chip.dataset.insert;
    const s = msgText.selectionStart ?? msgText.value.length;
    const e = msgText.selectionEnd ?? s;
    msgText.setRangeText(tag, s, e, "end");
    msgText.focus();
    msgText.dispatchEvent(new Event("input"));
  })
);

$("#msgSearch").addEventListener("input", renderMsgList);
$("#msgBeanFilter").addEventListener("change", renderMsgList);

$("#msgSelectAll").addEventListener("click", () => {
  visibleForMessages().forEach((c) => selected.add(c.id));
  renderMsgList();
});
$("#msgSelectNone").addEventListener("click", () => {
  selected.clear();
  renderMsgList();
});

$("#msgList").addEventListener("change", (e) => {
  if (!e.target.matches("[data-sel]")) return;
  const id = e.target.closest(".msg-row").dataset.id;
  e.target.checked ? selected.add(id) : selected.delete(id);
  renderMsgList();
});
$("#msgList").addEventListener("click", (e) => {
  const btn = e.target.closest("[data-send]");
  if (btn) sendTo(btn.closest(".msg-row").dataset.id);
});

$("#msgSendNext").addEventListener("click", () => {
  const sent = getSent();
  const nextId = [...customers.keys()].find((id) => selected.has(id) && !sent.has(id));
  if (nextId) sendTo(nextId);
});

$("#msgReset").addEventListener("click", () => {
  localStorage.removeItem(SENT_KEY);
  renderMsgList();
  toast("تم تصفير حالة الإرسال");
});

/* ---------------------------------------------------------
   تصدير Excel (CSV)
--------------------------------------------------------- */
$("#exportBtn").addEventListener("click", () => {
  if (!customers.size) return toast("لا توجد بيانات للتصدير", "err");
  const q = (v) => `"${String(v ?? "").replace(/"/g, '""')}"`;
  const rows = [["الاسم", "رقم الجوال", "البن المفضل", "تاريخ التسجيل"].map(q).join(",")];
  [...customers.values()].forEach((c) => {
    const date = c.createdAt ? c.createdAt.toDate().toISOString().slice(0, 10) : "";
    rows.push([q(c.name), `="${c.phone}"`, q(c.beans), q(date)].join(","));
  });
  const blob = new Blob(["\uFEFF" + rows.join("\r\n")], { type: "text/csv;charset=utf-8" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `عملاء-بن-رواق-${new Date().toISOString().slice(0, 10)}.csv`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
});
