// ช่องเลือก (select) และช่องวันที่ (input[type=date]) แบบปรับแต่งเอง
// รายการที่เด้งลงมาของเบราว์เซอร์ตกแต่งด้วย CSS ไม่ได้ จึงซ่อนช่องเดิมไว้ (ฟอร์มยังส่งค่าจากช่องเดิม)
// แล้ววางปุ่มและรายการ/ปฏิทินของเราแทน — ทำงานอัตโนมัติกับทุกช่องที่เพิ่มเข้ามาในหน้า

const TH_WEEKDAYS = ['อา', 'จ', 'อ', 'พ', 'พฤ', 'ศ', 'ส'];
const pad = (n) => String(n).padStart(2, '0');
const iso = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const parseIso = (s) => (/^\d{4}-\d{2}-\d{2}$/.test(s) ? new Date(`${s}T00:00:00`) : null);
const thaiDate = (d) => d.toLocaleDateString('th-TH', { day: 'numeric', month: 'short', year: 'numeric' });
const thaiMonth = (d) => d.toLocaleDateString('th-TH', { month: 'long', year: 'numeric' });

let openPopup = null;
function closeOpen() {
  if (!openPopup) return;
  openPopup.close();
  openPopup = null;
}
document.addEventListener('mousedown', (e) => {
  if (openPopup && !openPopup.root.contains(e.target)) closeOpen();
});
window.addEventListener('hashchange', closeOpen);

const fire = (el) => {
  el.dispatchEvent(new Event('input', { bubbles: true }));
  el.dispatchEvent(new Event('change', { bubbles: true }));
};

function wrap(native, kind) {
  const root = document.createElement('div');
  root.className = `ui-field ui-${kind}`;
  native.before(root);
  root.append(native);
  native.classList.add('ui-native');
  native.tabIndex = -1;
  native.setAttribute('aria-hidden', 'true');
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'ui-trigger';
  button.disabled = native.disabled;
  root.append(button);
  return { root, button };
}

// ---------- select ----------

function enhanceSelect(select) {
  const { root, button } = wrap(select, 'select');
  button.setAttribute('aria-haspopup', 'listbox');
  const list = document.createElement('div');
  list.className = 'ui-popup ui-list';
  list.setAttribute('role', 'listbox');
  list.hidden = true;
  root.append(list);
  let active = -1;

  const options = () => [...select.options].filter((o) => !o.disabled);
  const syncLabel = () => {
    const opt = select.selectedOptions[0];
    button.innerHTML = `<span class="ui-value">${opt ? escapeHtml(opt.textContent.trim()) : ''}</span>`;
  };
  const draw = () => {
    list.innerHTML = '';
    for (const child of select.children) {
      if (child.tagName === 'OPTGROUP') {
        const head = document.createElement('div');
        head.className = 'ui-group';
        head.textContent = child.label;
        list.append(head);
        [...child.children].forEach((o) => list.append(optionEl(o)));
      } else {
        list.append(optionEl(child));
      }
    }
  };
  const optionEl = (o) => {
    const el = document.createElement('div');
    el.className = 'ui-option';
    el.setAttribute('role', 'option');
    el.setAttribute('aria-selected', String(o.selected));
    el.dataset.value = o.value;
    el.textContent = o.textContent.trim();
    if (o.disabled) el.setAttribute('aria-disabled', 'true');
    return el;
  };
  const highlight = (i) => {
    const els = [...list.querySelectorAll('.ui-option:not([aria-disabled])')];
    els.forEach((el, n) => el.classList.toggle('active', n === i));
    // เลื่อนเฉพาะในรายการ (scrollIntoView จะพาทั้งหน้าเลื่อนตามด้วย)
    const el = els[i];
    if (el) {
      const bottom = el.offsetTop + el.offsetHeight;
      if (el.offsetTop < list.scrollTop) list.scrollTop = el.offsetTop;
      else if (bottom > list.scrollTop + list.clientHeight) list.scrollTop = bottom - list.clientHeight;
    }
    active = i;
  };
  const choose = (value) => {
    if (select.value !== value) {
      select.value = value;
      fire(select);
    }
    syncLabel();
    closeOpen();
    button.focus();
  };
  const open = () => {
    closeOpen();
    draw();
    list.hidden = false;
    root.classList.add('open');
    button.setAttribute('aria-expanded', 'true');
    highlight(options().findIndex((o) => o.selected));
    openPopup = {
      root,
      close: () => {
        list.hidden = true;
        root.classList.remove('open');
        button.setAttribute('aria-expanded', 'false');
      },
    };
  };

  button.addEventListener('click', () => (list.hidden ? open() : closeOpen()));
  list.addEventListener('mousedown', (e) => e.preventDefault());
  list.addEventListener('click', (e) => {
    const el = e.target.closest('.ui-option:not([aria-disabled])');
    if (el) choose(el.dataset.value);
  });
  button.addEventListener('keydown', (e) => {
    const count = options().length;
    if (['ArrowDown', 'ArrowUp'].includes(e.key)) {
      e.preventDefault();
      if (list.hidden) return open();
      highlight(Math.max(0, Math.min(count - 1, active + (e.key === 'ArrowDown' ? 1 : -1))));
    } else if ((e.key === 'Enter' || e.key === ' ') && !list.hidden) {
      e.preventDefault();
      if (active >= 0) choose(options()[active].value);
    } else if (e.key === 'Escape' && !list.hidden) {
      e.preventDefault();
      closeOpen();
    }
  });
  // โค้ดหน้าเว็บเปลี่ยนค่าช่องเดิมเอง
  select.addEventListener('change', syncLabel);
  syncLabel();
}

// ---------- date ----------

function enhanceDate(input) {
  const { root, button } = wrap(input, 'date');
  button.setAttribute('aria-haspopup', 'dialog');
  const cal = document.createElement('div');
  cal.className = 'ui-popup ui-calendar';
  cal.setAttribute('role', 'dialog');
  cal.hidden = true;
  root.append(cal);
  let view = new Date();

  const icon = '<svg class="ui-cal-icon" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"><rect x="3" y="4.5" width="14" height="12.5" rx="2.5"/><path d="M3 8.5h14M7 2.8v3.4M13 2.8v3.4"/></svg>';
  const syncLabel = () => {
    const d = parseIso(input.value);
    button.innerHTML = `<span class="ui-value ${d ? '' : 'ui-placeholder'}">${d ? thaiDate(d) : 'เลือกวันที่'}</span>${icon}`;
  };
  const draw = () => {
    const selected = input.value;
    const today = iso(new Date());
    const first = new Date(view.getFullYear(), view.getMonth(), 1);
    const start = new Date(first);
    start.setDate(1 - first.getDay());
    let days = '';
    for (let i = 0; i < 42; i++) {
      const d = new Date(start);
      d.setDate(start.getDate() + i);
      const key = iso(d);
      const cls = ['ui-day', d.getMonth() !== view.getMonth() && 'muted', key === today && 'today', key === selected && 'selected']
        .filter(Boolean).join(' ');
      days += `<button type="button" class="${cls}" data-date="${key}" aria-label="${thaiDate(d)}">${d.getDate()}</button>`;
    }
    cal.innerHTML = `
      <div class="ui-cal-head">
        <button type="button" class="ui-nav" data-nav="-1" aria-label="เดือนก่อนหน้า">‹</button>
        <strong>${thaiMonth(view)}</strong>
        <button type="button" class="ui-nav" data-nav="1" aria-label="เดือนถัดไป">›</button>
      </div>
      <div class="ui-weekdays">${TH_WEEKDAYS.map((w) => `<span>${w}</span>`).join('')}</div>
      <div class="ui-days">${days}</div>
      <div class="ui-cal-foot">
        ${input.required ? '<span></span>' : '<button type="button" class="ui-link" data-clear>ล้าง</button>'}
        <button type="button" class="ui-link" data-today>วันนี้</button>
      </div>`;
  };
  const choose = (value) => {
    if (input.value !== value) {
      input.value = value;
      fire(input);
    }
    syncLabel();
    closeOpen();
    button.focus();
  };
  const open = () => {
    closeOpen();
    view = parseIso(input.value) ?? new Date();
    draw();
    cal.hidden = false;
    root.classList.add('open');
    button.setAttribute('aria-expanded', 'true');
    openPopup = {
      root,
      close: () => {
        cal.hidden = true;
        root.classList.remove('open');
        button.setAttribute('aria-expanded', 'false');
      },
    };
  };

  button.addEventListener('click', () => (cal.hidden ? open() : closeOpen()));
  cal.addEventListener('click', (e) => {
    const t = e.target.closest('button');
    if (!t) return;
    if (t.dataset.nav) {
      view = new Date(view.getFullYear(), view.getMonth() + Number(t.dataset.nav), 1);
      draw();
    } else if (t.dataset.date) {
      choose(t.dataset.date);
    } else if ('today' in t.dataset) {
      choose(iso(new Date()));
    } else if ('clear' in t.dataset) {
      choose('');
    }
  });
  root.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !cal.hidden) {
      e.preventDefault();
      closeOpen();
      button.focus();
    }
  });
  input.addEventListener('change', syncLabel);
  // form.reset() คืนค่าเดิมโดยไม่มี change event
  input.form?.addEventListener('reset', () => setTimeout(syncLabel));
  syncLabel();
}

function escapeHtml(s) {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function enhance(root) {
  root.querySelectorAll?.('select:not(.ui-native):not([multiple])').forEach(enhanceSelect);
  root.querySelectorAll?.('input[type="date"]:not(.ui-native)').forEach(enhanceDate);
}

export function startFancyControls() {
  enhance(document);
  new MutationObserver((records) => {
    for (const r of records) r.addedNodes.forEach((n) => n.nodeType === 1 && enhance(n.parentElement ?? n));
  }).observe(document.body, { childList: true, subtree: true });
}
