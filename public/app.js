// ---------- helpers ----------

const $ = (sel, root = document) => root.querySelector(sel);
const view = $('#view');

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

let currentUser = null;

class AuthError extends Error {}

async function api(path, { method = 'GET', body } = {}) {
  const res = await fetch(`/api${path}`, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  // session หมดอายุ: กลับไปหน้าเข้าสู่ระบบ
  if (res.status === 401 && !path.startsWith('/auth/')) {
    currentUser = null;
    showChrome();
    throw new AuthError(data.error);
  }
  if (!res.ok) throw new Error(data.error || 'เกิดข้อผิดพลาด');
  return data;
}

function showChrome() {
  $('#nav').hidden = !currentUser;
  $('#user-menu').hidden = !currentUser;
  $('#user-name').textContent = currentUser ? `👤 ${currentUser.display_name}` : '';
}

let toastTimer;
function toast(message, isError = false) {
  const el = $('#toast');
  el.textContent = message;
  el.classList.toggle('error', isError);
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.hidden = true; }, 3000);
}

const formData = (form) => Object.fromEntries(new FormData(form).entries());

function todayISO() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

const fmtDate = (iso) => iso
  ? new Date(`${iso}T00:00:00`).toLocaleDateString('th-TH', { day: 'numeric', month: 'short', year: 'numeric' })
  : '-';
const fmtMoney = (n) => `${Number(n || 0).toLocaleString('th-TH', { maximumFractionDigits: 2 })} บาท`;
const daysUntil = (iso) => Math.round((new Date(`${iso}T00:00:00`) - new Date(`${todayISO()}T00:00:00`)) / 86400000);

// โหลดจาก /api/device-types ตอนเปิดเว็บ (กำหนดไว้ที่ seed.js)
const TYPE_LABEL = {};
const TYPE_ICON = {};
const KIND_LABEL = { maintenance: 'บำรุงรักษา', repair: 'ซ่อมแซม', checkup: 'ตรวจอาการ' };
const KIND_BADGE = { maintenance: 'green', repair: 'red', checkup: 'amber' };
const SEVERITY = {
  low: ['แก้ไขเองได้', 'green'],
  medium: ['ควรเฝ้าระวัง', 'amber'],
  high: ['ระวัง / อาจต้องใช้ช่าง', 'red'],
};
const GUIDE_CATEGORIES = { cleaning: 'ทำความสะอาด', battery: 'แบตเตอรี่', storage: 'พื้นที่จัดเก็บข้อมูล', usage: 'การใช้งาน', software: 'ซอฟต์แวร์' };
const REMINDER_PRESETS = [
  ['ทำความสะอาดภายนอกและหน้าจอ', 30],
  ['ทำความสะอาดช่องระบายอากาศ', 90],
  ['ตรวจสุขภาพแบตเตอรี่', 30],
  ['ล้างไฟล์และจัดการพื้นที่จัดเก็บ', 30],
  ['สำรองข้อมูลสำคัญ', 7],
  ['อัปเดตระบบและไดรเวอร์', 14],
  ['ทำความสะอาดช่องชาร์จ', 60],
  ['พิมพ์ทดสอบหัวพิมพ์ (กันหมึกแห้ง)', 7],
  ['ทำความสะอาดคีย์บอร์ด เมาส์ และหูฟัง', 14],
  ['ตรวจสุขภาพไดรฟ์และไฟล์สำรอง', 90],
];

function dueBadge(iso) {
  const d = daysUntil(iso);
  if (d < 0) return `<span class="badge red">เลยกำหนด ${-d} วัน</span>`;
  if (d === 0) return '<span class="badge red">ถึงกำหนดวันนี้</span>';
  if (d <= 7) return `<span class="badge amber">อีก ${d} วัน</span>`;
  return `<span class="badge">อีก ${d} วัน</span>`;
}

const deviceOptions = (devices, selected) => devices
  .map((d) => `<option value="${d.id}" ${String(d.id) === String(selected) ? 'selected' : ''}>${TYPE_ICON[d.type]} ${esc(d.name)}</option>`)
  .join('');

function renderAuth(mode = 'login') {
  const isLogin = mode === 'login';
  view.innerHTML = `
    <div class="auth-wrap">
      <div class="auth-intro">
        <h1>♻ DeviceCare</h1>
        <p>ระบบช่วยนักศึกษาดูแลอุปกรณ์ไอที ยืดอายุการใช้งาน ลดค่าซ่อม และลดขยะอิเล็กทรอนิกส์</p>
      </div>
      <section class="card">
        <div class="tabs">
          <button data-mode="login" class="${isLogin ? 'on' : ''}">เข้าสู่ระบบ</button>
          <button data-mode="register" class="${isLogin ? '' : 'on'}">สมัครสมาชิก</button>
        </div>
        <form class="form" id="auth-form">
          ${isLogin ? '' : `
            <label>ชื่อที่แสดง<input name="display_name" required maxlength="50" placeholder="เช่น สมชาย" autocomplete="nickname"></label>`}
          <label>ชื่อผู้ใช้
            <input name="username" required maxlength="30" autocomplete="username" ${isLogin ? '' : 'pattern="[A-Za-z0-9_.]{3,30}"'}>
            ${isLogin ? '' : '<span class="hint">ภาษาอังกฤษ ตัวเลข _ หรือ . ยาว 3–30 ตัว</span>'}
          </label>
          <label>รหัสผ่าน
            <input name="password" type="password" required ${isLogin ? '' : 'minlength="8"'} autocomplete="${isLogin ? 'current-password' : 'new-password'}">
            ${isLogin ? '' : '<span class="hint">อย่างน้อย 8 ตัวอักษร</span>'}
          </label>
          <button class="btn" style="justify-content:center">${isLogin ? 'เข้าสู่ระบบ' : 'สมัครสมาชิก'}</button>
        </form>
      </section>
    </div>`;

  view.onclick = (e) => {
    const tab = e.target.closest('[data-mode]');
    if (tab) renderAuth(tab.dataset.mode);
  };
  $('#auth-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = e.target.querySelector('button');
    btn.disabled = true;
    try {
      currentUser = await api(`/auth/${mode}`, { method: 'POST', body: formData(e.target) });
      showChrome();
      if (location.hash && location.hash !== '#dashboard') location.hash = '#dashboard';
      else render();
      checkDueReminders();
    } catch (err) {
      toast(err.message, true);
      btn.disabled = false;
    }
  });
}

$('#logout').addEventListener('click', async () => {
  await api('/auth/logout', { method: 'POST' }).catch(() => {});
  currentUser = null;
  showChrome();
  $('#due-badge').hidden = true;
  render();
});

let linePoll;

function lineCard(line) {
  if (!line.configured) {
    return `
      <section class="card callout warn" style="margin-bottom:1rem">
        <h2>💬 แจ้งเตือนผ่าน LINE <span class="badge amber">ยังไม่เปิดใช้</span></h2>
        <p class="hint" style="margin:0">ผู้ดูแลระบบยังไม่ได้ตั้งค่า LINE (ดูขั้นตอนใน README.md)</p>
      </section>`;
  }
  if (line.linked) {
    return `
      <section class="card" style="margin-bottom:1rem">
        <div class="toolbar" style="margin:0">
          <div>
            <h2 style="margin:0">💬 แจ้งเตือนผ่าน LINE <span class="badge green">เชื่อมต่อแล้ว</span></h2>
            <div class="hint" style="font-size:.88rem">
              ส่งสรุปงานที่ถึงกำหนดทุกวันเวลา ${esc(line.notify_time)} น. แม้ปิดหน้าเว็บ${line.last_sent ? ` · ส่งล่าสุด ${esc(line.last_sent)}` : ''}
            </div>
          </div>
          <div style="display:flex;gap:.5rem;flex-wrap:wrap">
            <button class="btn secondary small" data-line="test">ส่งข้อความทดสอบ</button>
            <button class="btn secondary small" data-line="send-now">ส่งสรุปตอนนี้</button>
            <button class="btn ghost small" data-line="unlink">ยกเลิกการเชื่อมต่อ</button>
          </div>
        </div>
      </section>`;
  }
  return `
    <section class="card callout info" style="margin-bottom:1rem" id="line-card">
      <div class="toolbar" style="margin:0">
        <div>
          <h2 style="margin:0">💬 รับแจ้งเตือนทาง LINE</h2>
          <div class="hint" style="font-size:.88rem">เชื่อมต่อครั้งเดียว ระบบจะส่งสรุปงานที่ถึงกำหนดเข้า LINE ทุกวันเวลา ${esc(line.notify_time)} น.</div>
        </div>
        ${line.can_link
          ? '<button class="btn line-btn" data-line="link-code">เชื่อมต่อ LINE</button>'
          : '<span class="badge amber">ระบบยังไม่พร้อมให้เชื่อมต่อ</span>'}
      </div>
      <div id="link-steps"></div>
    </section>`;
}

function showLinkSteps(line, { code, expires_in_minutes }) {
  $('#link-steps').innerHTML = `
    <div class="link-steps">
      <div class="link-step">
        <span class="num">1</span>
        <div>เพิ่มบัญชี DeviceCare${line.bot_id ? ` (<strong>${esc(line.bot_id)}</strong>)` : ''} เป็นเพื่อนใน LINE<br>
          ${line.add_friend_url
            ? `<a class="btn line-btn small" style="margin-top:.35rem" href="${esc(line.add_friend_url)}" target="_blank" rel="noopener">+ เพิ่มเพื่อน</a>
               <div class="hint">เปิดบนคอมจะแสดง QR code ให้สแกนด้วยมือถือ</div>`
            : ''}
        </div>
      </div>
      <div class="link-step">
        <span class="num">2</span>
        <div>พิมพ์รหัสนี้ส่งในแชต DeviceCare<br>
          <span class="code-box">${esc(code)}</span>
          <div class="hint">รหัสใช้ได้ ${expires_in_minutes} นาที</div>
        </div>
      </div>
      <div class="hint">⏳ กำลังรอการเชื่อมต่อ… หน้านี้จะอัปเดตเองเมื่อเชื่อมต่อสำเร็จ</div>
    </div>`;

  clearInterval(linePoll);
  const stopAt = Date.now() + expires_in_minutes * 60 * 1000;
  linePoll = setInterval(async () => {
    if (Date.now() > stopAt) return clearInterval(linePoll);
    const status = await api('/line').catch(() => null);
    if (status?.linked) {
      clearInterval(linePoll);
      toast('เชื่อมต่อ LINE สำเร็จ 🎉');
      render();
    }
  }, 3000);
}

const noDevicesCard = (what) => `
  <div class="card callout info">
    <p>ยังไม่มีอุปกรณ์ในระบบ กรุณาเพิ่มอุปกรณ์ก่อน${what}</p>
    <a class="btn" href="#devices">+ เพิ่มอุปกรณ์</a>
  </div>`;

// ---------- views ----------

const views = {
  async dashboard() {
    const d = await api('/dashboard');
    const due = [...d.overdue, ...d.upcoming];
    const notifSupported = 'Notification' in window;
    view.innerHTML = `
      <div class="page-head">
        <h1>สวัสดี 👋 มาดูแลอุปกรณ์กันเถอะ</h1>
        <p>ดูแลเป็นประจำ ช่วยยืดอายุการใช้งาน ลดค่าซ่อม และลดขยะอิเล็กทรอนิกส์</p>
      </div>

      <div class="grid grid-4">
        <div class="card stat"><span class="stat-label">อุปกรณ์ของฉัน</span><span class="stat-value">${d.device_count}</span></div>
        <div class="card stat"><span class="stat-label">งานที่เลยกำหนด/ถึงกำหนด</span><span class="stat-value ${d.overdue.length ? 'danger' : ''}">${d.overdue.length}</span></div>
        <div class="card stat"><span class="stat-label">ครั้งที่บำรุงรักษา</span><span class="stat-value">${d.maintenance_count}</span></div>
        <div class="card stat"><span class="stat-label">ค่าใช้จ่ายรวม</span><span class="stat-value">${fmtMoney(d.total_cost)}</span></div>
      </div>

      <div class="grid grid-2" style="margin-top:1rem">
        <section class="card">
          <div class="toolbar">
            <h2>การดูแลที่ต้องทำ (7 วันข้างหน้า)</h2>
            ${notifSupported && Notification.permission === 'default'
              ? '<button class="btn secondary small" id="enable-notif">🔔 เปิดแจ้งเตือนเบราว์เซอร์</button>' : ''}
          </div>
          ${due.length ? `<ul class="list">${due.map((r) => `
            <li>
              <div class="grow">
                <div>${esc(r.title)}</div>
                <div class="sub">${esc(r.device_name)} · ${fmtDate(r.next_due)}</div>
              </div>
              ${dueBadge(r.next_due)}
              <button class="btn small" data-complete="${r.id}">ทำแล้ว</button>
            </li>`).join('')}</ul>`
            : '<div class="empty">ไม่มีงานที่ต้องทำในช่วงนี้ 🎉<br><a href="#reminders">ตั้งการแจ้งเตือน</a></div>'}
        </section>

        <section class="card">
          <h2>รายการล่าสุด</h2>
          ${d.recent_records.length ? `<ul class="list">${d.recent_records.map((r) => `
            <li>
              <div class="grow">
                <div>${esc(r.description)}</div>
                <div class="sub">${esc(r.device_name)} · ${fmtDate(r.date)}${r.cost ? ` · ${fmtMoney(r.cost)}` : ''}</div>
              </div>
              <span class="badge ${KIND_BADGE[r.kind]}">${KIND_LABEL[r.kind]}</span>
            </li>`).join('')}</ul>`
            : '<div class="empty">ยังไม่มีประวัติ<br><a href="#history">บันทึกรายการแรก</a></div>'}
        </section>
      </div>

      <div class="grid grid-2" style="margin-top:1rem">
        <section class="card">
          <h2>อาการที่ตรวจบ่อย</h2>
          ${d.top_symptoms.length ? `<ul class="list">${d.top_symptoms.map((s) => `
            <li><span>${s.icon}</span><span class="grow">${esc(s.title)}</span><span class="badge">${s.count} ครั้ง</span></li>`).join('')}</ul>`
            : '<div class="empty">ยังไม่มีการตรวจอาการ</div>'}
        </section>
        <section class="card callout info">
          <h2>เครื่องมีอาการผิดปกติ?</h2>
          <p>เลือกอาการ แล้วระบบจะแนะนำวิธีตรวจสอบเบื้องต้นอย่างปลอดภัย พร้อมบอกว่าเมื่อไหร่ควรส่งช่าง</p>
          <a class="btn" href="#diagnose">เริ่มตรวจอาการ →</a>
        </section>
      </div>`;

    $('#enable-notif')?.addEventListener('click', async () => {
      await Notification.requestPermission();
      checkDueReminders();
      render();
    });
    bindComplete();
  },

  async diagnose() {
    const state = { type: null, symptom: null, symptoms: [] };
    const devices = await api('/devices');

    const draw = () => {
      const step = state.symptom ? 3 : state.type ? 2 : 1;
      const stepper = ['เลือกประเภทอุปกรณ์', 'เลือกอาการ', 'คำแนะนำ']
        .map((s, i) => `<span class="${i + 1 <= step ? 'on' : ''}">${i + 1}. ${s}</span>`).join('');

      let body = '';
      if (step === 1) {
        body = `<div class="tiles">${Object.keys(TYPE_LABEL).map((t) => `
          <button class="tile" data-type="${t}"><span class="icon">${TYPE_ICON[t]}</span><strong>${TYPE_LABEL[t]}</strong></button>`).join('')}</div>`;
      } else if (step === 2) {
        body = `
          <p><button class="btn secondary small" data-back="type">← เปลี่ยนประเภท</button> ${TYPE_ICON[state.type]} ${TYPE_LABEL[state.type]}</p>
          <div class="tiles">${state.symptoms.map((s) => `
            <button class="tile" data-symptom="${s.code}">
              <span class="icon">${s.icon}</span><strong>${esc(s.title)}</strong>
              <span class="badge ${SEVERITY[s.severity][1]}">${SEVERITY[s.severity][0]}</span>
            </button>`).join('')}</div>`;
      } else {
        const s = state.symptom;
        const matching = devices.filter((d) => d.type === state.type);
        body = `
          <p><button class="btn secondary small" data-back="symptom">← เลือกอาการอื่น</button></p>
          <div class="grid grid-2">
            <section class="card">
              <h2>${s.icon} ${esc(s.title)} <span class="badge ${SEVERITY[s.severity][1]}">${SEVERITY[s.severity][0]}</span></h2>
              <p class="sub">ทำตามขั้นตอนทีละข้อ ติ๊กเมื่อทำเสร็จ</p>
              <ol class="steps">${s.steps.map((t, i) => `
                <li><label style="display:flex;gap:.5rem;font-weight:400"><input type="checkbox" style="width:auto"> <span>${esc(t)}</span></label></li>`).join('')}</ol>
            </section>
            <div class="stack">
              <section class="callout danger">
                <h2>⚠️ ควรติดต่อช่างเมื่อ</h2>
                <ul class="bullets">${s.see_technician.map((t) => `<li>${esc(t)}</li>`).join('')}</ul>
              </section>
              <section class="card">
                <h2>บันทึกลงประวัติ</h2>
                ${matching.length ? `
                  <form class="form" id="save-diagnosis">
                    <label>อุปกรณ์<select name="device_id" required>${deviceOptions(matching)}</select></label>
                    <label>หมายเหตุ (ไม่บังคับ)<textarea name="note" maxlength="300" placeholder="เช่น ทำความสะอาดช่องลมแล้ว อาการดีขึ้น"></textarea></label>
                    <button class="btn">บันทึกผลการตรวจ</button>
                  </form>`
                  : `<p class="sub">ยังไม่มี${TYPE_LABEL[state.type]}ในระบบ</p><a class="btn secondary" href="#devices">+ เพิ่มอุปกรณ์</a>`}
              </section>
            </div>
          </div>`;
      }

      view.innerHTML = `
        <div class="page-head">
          <h1>ตรวจสอบอาการเบื้องต้น</h1>
          <p>คำแนะนำนี้เป็นการตรวจสอบเบื้องต้นที่ทำได้เองอย่างปลอดภัย หากไม่มั่นใจ ควรปรึกษาช่าง</p>
        </div>
        <div class="stepper">${stepper}</div>
        ${body}`;
    };

    view.onclick = async (e) => {
      const btn = e.target.closest('button');
      if (!btn) return;
      if (btn.dataset.type) {
        state.type = btn.dataset.type;
        state.symptoms = await api(`/symptoms?type=${state.type}`);
        draw();
      } else if (btn.dataset.symptom) {
        state.symptom = state.symptoms.find((s) => s.code === btn.dataset.symptom);
        api('/diagnoses', { method: 'POST', body: { device_type: state.type, symptom_code: state.symptom.code } }).catch(() => {});
        draw();
      } else if (btn.dataset.back === 'type') {
        state.type = null;
        draw();
      } else if (btn.dataset.back === 'symptom') {
        state.symptom = null;
        draw();
      }
    };

    view.onsubmit = async (e) => {
      if (e.target.id !== 'save-diagnosis') return;
      e.preventDefault();
      const f = formData(e.target);
      const note = f.note.trim();
      try {
        await api('/records', {
          method: 'POST',
          body: {
            device_id: f.device_id,
            date: todayISO(),
            kind: 'checkup',
            description: `ตรวจอาการ: ${state.symptom.title}${note ? ` — ${note}` : ''}`,
            cost: 0,
            symptom_code: state.symptom.code,
          },
        });
        toast('บันทึกลงประวัติแล้ว');
        e.target.reset();
      } catch (err) {
        toast(err.message, true);
      }
    };

    draw();
  },

  async guides() {
    const guides = await api('/guides');
    let category = 'all';
    let type = '';

    const draw = () => {
      const list = guides.filter((g) =>
        (category === 'all' || g.category === category) && (!type || g.device_types.includes(type)));
      view.innerHTML = `
        <div class="page-head">
          <h1>คู่มือดูแลอุปกรณ์ไอที</h1>
          <p>วิธีดูแล ทำความสะอาด และใช้งานอย่างถูกต้อง เพื่อให้อุปกรณ์อยู่กับคุณได้นานขึ้น</p>
        </div>
        <div class="toolbar">
          <div class="filters" style="margin:0">
            ${[['all', 'ทั้งหมด'], ...Object.entries(GUIDE_CATEGORIES)]
              .map(([k, v]) => `<button class="chip ${category === k ? 'on' : ''}" data-filter="${k}">${v}</button>`).join('')}
          </div>
          <select id="guide-type">
            <option value="">ทุกอุปกรณ์</option>
            ${Object.entries(TYPE_LABEL).map(([k, v]) => `<option value="${k}" ${type === k ? 'selected' : ''}>${TYPE_ICON[k]} ${v}</option>`).join('')}
          </select>
        </div>
        ${list.length ? '' : '<div class="card empty">ไม่มีคู่มือในหมวดนี้สำหรับอุปกรณ์ที่เลือก</div>'}
        <div class="grid grid-2" style="margin-top:1rem">
          ${list.map((g) => `
            <details class="card guide">
              <summary>
                <span class="badge green">${GUIDE_CATEGORIES[g.category] ?? g.category}</span>
                ${g.device_types.map((t) => `<span class="badge">${TYPE_LABEL[t]}</span>`).join(' ')}
                <h3 style="margin-top:.4rem">${esc(g.title)}</h3>
                <p class="sub" style="margin:0;color:var(--muted)">${esc(g.summary)}</p>
              </summary>
              <div class="body"><ul class="bullets">${g.content.map((c) => `<li>${esc(c)}</li>`).join('')}</ul></div>
            </details>`).join('')}
        </div>`;
    };

    view.onclick = (e) => {
      const chip = e.target.closest('[data-filter]');
      if (!chip) return;
      category = chip.dataset.filter;
      draw();
    };
    view.onchange = (e) => {
      if (e.target.id !== 'guide-type') return;
      type = e.target.value;
      draw();
    };
    draw();
  },

  async reminders() {
    const [devices, reminders, line] = await Promise.all([api('/devices'), api('/reminders'), api('/line')]);
    view.innerHTML = `
      <div class="page-head">
        <h1>แจ้งเตือนการบำรุงรักษา</h1>
        <p>ตั้งรอบการดูแล เมื่อกด “ทำแล้ว” ระบบจะบันทึกลงประวัติและเลื่อนกำหนดครั้งถัดไปให้อัตโนมัติ</p>
      </div>

      ${lineCard(line)}
      ${devices.length ? `
      <section class="card">
        <h2>ตั้งการแจ้งเตือนใหม่</h2>
        <form class="form" id="reminder-form">
          <div class="form-row">
            <label>อุปกรณ์<select name="device_id" required>${deviceOptions(devices)}</select></label>
            <label>เลือกจากรายการแนะนำ
              <select id="preset">
                <option value="">— กำหนดเอง —</option>
                ${REMINDER_PRESETS.map(([t, d], i) => `<option value="${i}">${t} (ทุก ${d} วัน)</option>`).join('')}
              </select>
            </label>
          </div>
          <div class="form-row">
            <label>หัวข้อ<input name="title" required maxlength="100" placeholder="เช่น ทำความสะอาดช่องระบายอากาศ"></label>
            <label>ทำซ้ำทุก (วัน)<input name="interval_days" type="number" min="1" step="1" required value="30"></label>
            <label>ครั้งแรกวันที่<input name="next_due" type="date" value="${todayISO()}" required></label>
          </div>
          <div><button class="btn">+ เพิ่มการแจ้งเตือน</button></div>
        </form>
      </section>` : noDevicesCard('ตั้งการแจ้งเตือน')}

      <section class="card">
        <h2>การแจ้งเตือนทั้งหมด</h2>
        ${reminders.length ? `<ul class="list">${reminders.map((r) => `
          <li>
            <span>${TYPE_ICON[r.device_type]}</span>
            <div class="grow">
              <div>${esc(r.title)}</div>
              <div class="sub">${esc(r.device_name)} · ทุก ${r.interval_days} วัน · ครั้งถัดไป ${fmtDate(r.next_due)}</div>
            </div>
            ${dueBadge(r.next_due)}
            <button class="btn small" data-complete="${r.id}">ทำแล้ว</button>
            <button class="btn ghost small" data-delete-reminder="${r.id}" title="ลบ">✕</button>
          </li>`).join('')}</ul>`
          : '<div class="empty">ยังไม่มีการแจ้งเตือน</div>'}
      </section>`;

    $('#preset')?.addEventListener('change', (e) => {
      const preset = REMINDER_PRESETS[e.target.value];
      if (!preset) return;
      const { elements } = $('#reminder-form');
      elements.title.value = preset[0];
      elements.interval_days.value = preset[1];
    });

    $('#reminder-form')?.addEventListener('submit', async (e) => {
      e.preventDefault();
      try {
        await api('/reminders', { method: 'POST', body: formData(e.target) });
        toast('เพิ่มการแจ้งเตือนแล้ว');
        render();
      } catch (err) {
        toast(err.message, true);
      }
    });

    view.onclick = async (e) => {
      const lineBtn = e.target.closest('[data-line]');
      if (lineBtn) {
        const action = lineBtn.dataset.line;
        if (action === 'unlink' && !confirm('ยกเลิกการเชื่อมต่อ LINE? จะไม่ได้รับแจ้งเตือนทาง LINE อีก')) return;
        lineBtn.disabled = true;
        try {
          const result = await api(`/line/${action}`, { method: 'POST' });
          if (action === 'link-code') showLinkSteps(line, result);
          else if (action === 'unlink') render();
          else toast('ส่งเข้า LINE แล้ว');
        } catch (err) {
          toast(err.message, true);
        }
        lineBtn.disabled = false;
        return;
      }
      const id = e.target.closest('[data-delete-reminder]')?.dataset.deleteReminder;
      if (!id || !confirm('ลบการแจ้งเตือนนี้?')) return;
      await api(`/reminders/${id}`, { method: 'DELETE' }).catch((err) => toast(err.message, true));
      render();
    };
    bindComplete();
  },

  async history() {
    const params = new URLSearchParams(location.hash.split('?')[1]);
    const selected = params.get('device') || '';
    const [devices, records] = await Promise.all([
      api('/devices'),
      api(`/records${selected ? `?device_id=${encodeURIComponent(selected)}` : ''}`),
    ]);
    const total = records.reduce((sum, r) => sum + r.cost, 0);

    view.innerHTML = `
      <div class="page-head">
        <h1>ประวัติการดูแลและซ่อมแซม</h1>
        <p>บันทึกทุกครั้งที่ดูแลหรือซ่อม เพื่อติดตามค่าใช้จ่ายและสภาพอุปกรณ์ย้อนหลัง</p>
      </div>
      ${devices.length ? `
      <section class="card">
        <h2>บันทึกรายการใหม่</h2>
        <form class="form" id="record-form">
          <div class="form-row">
            <label>อุปกรณ์<select name="device_id" required>${deviceOptions(devices, selected)}</select></label>
            <label>วันที่<input name="date" type="date" required value="${todayISO()}"></label>
            <label>ประเภท
              <select name="kind">${Object.entries(KIND_LABEL).map(([k, v]) => `<option value="${k}">${v}</option>`).join('')}</select>
            </label>
            <label>ค่าใช้จ่าย (บาท)<input name="cost" type="number" min="0" step="0.01" value="0"></label>
          </div>
          <label>รายละเอียด<textarea name="description" required maxlength="500" placeholder="เช่น เปลี่ยนแบตเตอรี่ใหม่ที่ศูนย์บริการ"></textarea></label>
          <div><button class="btn">+ บันทึก</button></div>
        </form>
      </section>` : noDevicesCard('บันทึกประวัติ')}

      <section class="card">
        <div class="toolbar">
          <h2>รายการทั้งหมด <span class="badge">${records.length} รายการ · ${fmtMoney(total)}</span></h2>
          <select id="device-filter">
            <option value="">ทุกอุปกรณ์</option>
            ${deviceOptions(devices, selected)}
          </select>
        </div>
        ${records.length ? `
        <div class="table-wrap"><table>
          <thead><tr><th>วันที่</th><th>อุปกรณ์</th><th>ประเภท</th><th>รายละเอียด</th><th class="num">ค่าใช้จ่าย</th><th></th></tr></thead>
          <tbody>${records.map((r) => `
            <tr>
              <td style="white-space:nowrap">${fmtDate(r.date)}</td>
              <td>${esc(r.device_name)}</td>
              <td><span class="badge ${KIND_BADGE[r.kind]}">${KIND_LABEL[r.kind]}</span></td>
              <td>${esc(r.description)}</td>
              <td class="num">${r.cost ? fmtMoney(r.cost) : '-'}</td>
              <td><button class="btn ghost small" data-delete-record="${r.id}" title="ลบ">✕</button></td>
            </tr>`).join('')}</tbody>
        </table></div>`
          : '<div class="empty">ยังไม่มีประวัติ</div>'}
      </section>`;

    $('#device-filter').addEventListener('change', (e) => {
      location.hash = e.target.value ? `#history?device=${e.target.value}` : '#history';
    });

    $('#record-form')?.addEventListener('submit', async (e) => {
      e.preventDefault();
      try {
        await api('/records', { method: 'POST', body: formData(e.target) });
        toast('บันทึกแล้ว');
        render();
      } catch (err) {
        toast(err.message, true);
      }
    });

    view.onclick = async (e) => {
      const id = e.target.closest('[data-delete-record]')?.dataset.deleteRecord;
      if (!id || !confirm('ลบรายการนี้?')) return;
      await api(`/records/${id}`, { method: 'DELETE' }).catch((err) => toast(err.message, true));
      render();
    };
  },

  async devices() {
    const devices = await api('/devices');
    view.innerHTML = `
      <div class="page-head">
        <h1>อุปกรณ์ของฉัน</h1>
        <p>เพิ่มอุปกรณ์ที่ใช้เรียน เพื่อใช้ตั้งการแจ้งเตือนและบันทึกประวัติ</p>
      </div>
      <section class="card">
        <h2>เพิ่มอุปกรณ์</h2>
        <form class="form" id="device-form">
          <div class="form-row">
            <label>ชื่อเรียก<input name="name" required maxlength="80" placeholder="เช่น โน้ตบุ๊กเรียน"></label>
            <label>ประเภท<select name="type">${Object.entries(TYPE_LABEL).map(([k, v]) => `<option value="${k}">${v}</option>`).join('')}</select></label>
            <label>ยี่ห้อ/รุ่น<input name="brand" maxlength="80" placeholder="เช่น Acer Aspire 5"></label>
            <label>วันที่ซื้อ<input name="purchase_date" type="date"></label>
          </div>
          <div><button class="btn">+ เพิ่มอุปกรณ์</button></div>
        </form>
      </section>
      <div class="grid grid-3" style="margin-top:1rem">
        ${devices.map((d) => `
          <section class="card">
            <div class="toolbar" style="margin-bottom:.25rem">
              <h2>${TYPE_ICON[d.type]} ${esc(d.name)}</h2>
              <button class="btn ghost small" data-delete-device="${d.id}" title="ลบ">✕</button>
            </div>
            <p class="sub" style="color:var(--muted)">${TYPE_LABEL[d.type]}${d.brand ? ` · ${esc(d.brand)}` : ''}</p>
            <ul class="list">
              <li><span class="grow">ซื้อเมื่อ</span>${fmtDate(d.purchase_date)}</li>
              ${d.purchase_date ? `<li><span class="grow">อายุการใช้งาน</span>${ageText(d.purchase_date)}</li>` : ''}
              <li><span class="grow">บันทึกการดูแล</span>${d.record_count} ครั้ง</li>
              <li><span class="grow">ค่าใช้จ่ายรวม</span>${fmtMoney(d.total_cost)}</li>
            </ul>
            <a class="btn secondary small" href="#history?device=${d.id}">ดูประวัติ</a>
          </section>`).join('') || '<div class="card empty">ยังไม่มีอุปกรณ์</div>'}
      </div>`;

    $('#device-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      try {
        await api('/devices', { method: 'POST', body: formData(e.target) });
        toast('เพิ่มอุปกรณ์แล้ว');
        render();
      } catch (err) {
        toast(err.message, true);
      }
    });

    view.onclick = async (e) => {
      const id = e.target.closest('[data-delete-device]')?.dataset.deleteDevice;
      if (!id || !confirm('ลบอุปกรณ์นี้? การแจ้งเตือนและประวัติของอุปกรณ์นี้จะถูกลบด้วย')) return;
      await api(`/devices/${id}`, { method: 'DELETE' }).catch((err) => toast(err.message, true));
      render();
    };
  },
};

function ageText(iso) {
  const start = new Date(`${iso}T00:00:00`);
  const now = new Date();
  let months = (now.getFullYear() - start.getFullYear()) * 12 + now.getMonth() - start.getMonth();
  if (now.getDate() < start.getDate()) months--;
  if (months < 1) return 'ไม่ถึง 1 เดือน';
  const y = Math.floor(months / 12);
  const m = months % 12;
  return [y && `${y} ปี`, m && `${m} เดือน`].filter(Boolean).join(' ');
}

// ปุ่ม “ทำแล้ว” ใช้ทั้งในหน้าภาพรวมและหน้าแจ้งเตือน
function bindComplete() {
  view.querySelectorAll('[data-complete]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      btn.disabled = true;
      try {
        const r = await api(`/reminders/${btn.dataset.complete}/complete`, { method: 'POST' });
        toast(`บันทึกแล้ว · ครั้งถัดไป ${fmtDate(r.next_due)}`);
        render();
        checkDueReminders();
      } catch (err) {
        toast(err.message, true);
        btn.disabled = false;
      }
    });
  });
}

// ---------- reminder check (badge + browser notification) ----------

let notifiedIds = new Set();
async function checkDueReminders() {
  if (!currentUser) return;
  try {
    const { overdue } = await api('/dashboard');
    const badge = $('#due-badge');
    badge.textContent = overdue.length;
    badge.hidden = overdue.length === 0;

    const fresh = overdue.filter((r) => !notifiedIds.has(r.id));
    if (fresh.length && 'Notification' in window && Notification.permission === 'granted') {
      new Notification('DeviceCare: ถึงเวลาดูแลอุปกรณ์', {
        body: fresh.map((r) => `• ${r.title} (${r.device_name})`).join('\n'),
      });
    }
    notifiedIds = new Set(overdue.map((r) => r.id));
  } catch {
    // เงียบไว้ — ไม่ให้การเช็กเบื้องหลังรบกวนผู้ใช้
  }
}

// ---------- router ----------

async function render() {
  const name = location.hash.slice(1).split('?')[0] || 'dashboard';
  const page = views[name] ? name : 'dashboard';
  document.querySelectorAll('#nav a').forEach((a) => a.classList.toggle('active', a.getAttribute('href') === `#${page}`));
  view.onclick = null;
  view.onsubmit = null;
  view.onchange = null;
  clearInterval(linePoll);
  if (!currentUser) return renderAuth();
  try {
    await views[page]();
  } catch (err) {
    if (err instanceof AuthError) return renderAuth();
    view.innerHTML = `<div class="card callout danger">โหลดข้อมูลไม่สำเร็จ: ${esc(err.message)}</div>`;
  }
}

window.addEventListener('hashchange', () => { render(); window.scrollTo(0, 0); });

try {
  for (const t of await api('/device-types')) {
    TYPE_LABEL[t.key] = t.label;
    TYPE_ICON[t.key] = t.icon;
  }
} catch (err) {
  toast(`โหลดประเภทอุปกรณ์ไม่สำเร็จ: ${err.message}`, true);
}
currentUser = await api('/auth/me').catch(() => null);
showChrome();
render();
checkDueReminders();
setInterval(checkDueReminders, 30 * 60 * 1000);
