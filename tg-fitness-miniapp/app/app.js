/* global Telegram */

const API_BASE = (function(){
  // В проде: укажите URL вашего server (Render/Railway/VPS), например:
  // return "https://your-service.onrender.com";
  // В локальной разработке:
  return "http://localhost:8080";
})();

const TRAIN_LOCATION = "DDX Fitness, ТЦ Сенная";

const elScreen = document.getElementById("screen");
const elSubtitle = document.getElementById("subtitle");
const elHint = document.getElementById("hint");
const elToast = document.getElementById("toast");

const tg = window.Telegram && window.Telegram.WebApp ? window.Telegram.WebApp : null;

function toast(msg){
  elToast.textContent = msg;
  elToast.classList.remove("hidden");
  setTimeout(()=> elToast.classList.add("hidden"), 2600);
}

function setHint(msg){ elHint.textContent = msg || ""; }

function htmEscape(s){
  return String(s)
    .replaceAll("&","&amp;")
    .replaceAll("<","&lt;")
    .replaceAll(">","&gt;")
    .replaceAll('"',"&quot;")
    .replaceAll("'","&#039;");
}

function fmtDate(d){
  const dt = new Date(d);
  const yyyy = dt.getFullYear();
  const mm = String(dt.getMonth()+1).padStart(2,"0");
  const dd = String(dt.getDate()).padStart(2,"0");
  return `${yyyy}-${mm}-${dd}`;
}

function fmtTimeISO(iso){
  const dt = new Date(iso);
  return dt.toLocaleTimeString("ru-RU",{hour:"2-digit",minute:"2-digit"});
}

function fmtDateHuman(iso){
  const dt = new Date(iso);
  return dt.toLocaleDateString("ru-RU",{weekday:"short", year:"numeric", month:"2-digit", day:"2-digit"});
}

function phoneMaskRU(input){
  // +7 (999) 999-99-99
  input.addEventListener("input", ()=>{
    let v = input.value.replace(/\D/g,"");
    if (v.startsWith("8")) v = "7"+v.slice(1);
    if (!v.startsWith("7")) v = "7"+v;
    v = v.slice(0,11);

    const p = v.slice(1);
    let out = "+7";
    if (p.length>0) out += " ("+p.slice(0,3);
    if (p.length>=3) out += ")";
    if (p.length>3) out += " "+p.slice(3,6);
    if (p.length>6) out += "-"+p.slice(6,8);
    if (p.length>8) out += "-"+p.slice(8,10);
    input.value = out;
  });
}

async function api(path, opts={}){
  const initData = tg ? (tg.initData || "") : "";
  const res = await fetch(API_BASE + path, {
    method: opts.method || "GET",
    headers: {
      "Content-Type":"application/json",
      "X-Telegram-InitData": initData
    },
    body: opts.body ? JSON.stringify(opts.body) : undefined
  });
  const json = await res.json().catch(()=> ({}));
  if (!res.ok){
    const msg = json && json.error ? json.error : ("HTTP "+res.status);
    throw new Error(msg);
  }
  return json;
}

function mustBeInTelegram(){
  if (!tg) return true;
  const initData = tg.initData || "";
  if (!initData) return true;
  return false;
}

function renderErrorTelegramContext(){
  elSubtitle.textContent = "Требуется запуск в Telegram";
  elScreen.innerHTML = `
    <div>
      <div class="title" style="font-weight:700;margin-bottom:6px;">Ошибка контекста Telegram</div>
      <div class="meta" style="color:var(--muted);font-size:13px;line-height:1.35;">
        Откройте приложение через кнопку <span class="kbd">Меню</span> у бота (Mini App) внутри Telegram, не в браузере.
        Если вы открыли ссылку извне — Telegram не передаст данные запуска, и приложение не сможет работать корректно.
      </div>
      <hr class="sep"/>
      <button class="btn" id="btnClose">Закрыть</button>
    </div>
  `;
  document.getElementById("btnClose").onclick = ()=>{
    try{ tg.close(); }catch(e){ /* ignore */ }
  };
}

function roleFromMe(me){
  return me && me.role ? me.role : "client";
}

function menuButtons(role){
  if (role === "trainer"){
    return [
      {id:"t_schedule", label:"График работы"},
      {id:"t_clients", label:"Клиентская база"},
      {id:"t_book", label:"Записать клиента"},
      {id:"t_bookings", label:"Записи"},
      {id:"t_broadcast", label:"Сообщение всем"}
    ];
  }
  return [
    {id:"c_book", label:"Записаться"},
    {id:"c_my", label:"Посмотреть записи"},
    {id:"c_chat", label:"Чат с тренером"},
    {id:"c_pack", label:"Мой пакет"}
  ];
}

function renderMainMenu(role){
  const btns = menuButtons(role);
  elScreen.innerHTML = `
    <div>
      <div class="row" style="gap:10px;">
        ${btns.map(b=>`<button class="btn secondary" data-nav="${b.id}" style="flex:1;min-width:180px;">${htmEscape(b.label)}</button>`).join("")}
      </div>
      <hr class="sep"/>
      <button class="btn" data-nav="profile">Профиль</button>
    </div>
  `;
  elScreen.querySelectorAll("[data-nav]").forEach(x=>{
    x.onclick = ()=> navigate(x.getAttribute("data-nav"));
  });
}

function renderLoader(title="Загрузка…"){
  elScreen.innerHTML = `
    <div>
      <div style="font-weight:700;margin-bottom:6px;">${htmEscape(title)}</div>
      <div style="color:var(--muted);font-size:13px;">Пожалуйста, подождите.</div>
    </div>
  `;
}

function renderRegistration(){
  elSubtitle.textContent = "Регистрация";
  elScreen.innerHTML = `
    <div>
      <div style="font-weight:700;margin-bottom:6px;">Регистрация</div>
      <div style="color:var(--muted);font-size:13px;line-height:1.35;">
        Укажите фамилию, имя и телефон. Можно также поделиться контактом.
      </div>

      <div class="label">Фамилия</div>
      <input class="input" id="lastName" placeholder="Иванов"/>

      <div class="label">Имя</div>
      <input class="input" id="firstName" placeholder="Иван"/>

      <div class="label">Телефон</div>
      <input class="input" id="phone" placeholder="+7 (999) 999-99-99" inputmode="tel"/>

      <div class="row" style="margin-top:12px;">
        <button class="btn" id="btnSave" style="flex:1;">Сохранить</button>
        <button class="btn secondary" id="btnShare" style="flex:1;">Поделиться контактом</button>
      </div>

      <hr class="sep"/>
      <button class="btn secondary" data-nav="menu">Назад</button>
    </div>
  `;

  const elPhone = document.getElementById("phone");
  phoneMaskRU(elPhone);

  document.getElementById("btnSave").onclick = async ()=>{
    const last = document.getElementById("lastName").value.trim();
    const first = document.getElementById("firstName").value.trim();
    const phone = elPhone.value.trim();
    if (!last || !first || phone.length < 10){
      toast("Заполните фамилию, имя и телефон.");
      return;
    }
    try{
      renderLoader("Сохранение…");
      await api("/api/profile", {method:"POST", body:{last_name:last, first_name:first, phone}});
      toast("Готово");
      await boot();
    }catch(e){
      toast(e.message);
      renderRegistration();
    }
  };

  document.getElementById("btnShare").onclick = ()=>{
    if (!tg){
      toast("Откройте внутри Telegram");
      return;
    }
    try{
      tg.requestContact(async (ok)=>{
        if (!ok){ toast("Контакт не предоставлен"); return; }
        // Telegram сам отправляет contact боту, а сервер по webhook обновит профиль.
        toast("Контакт отправлен боту. Обновляем…");
        setTimeout(()=> boot(), 800);
      });
    }catch(e){
      toast("Не удалось запросить контакт");
    }
  };

  elScreen.querySelector("[data-nav='menu']").onclick = ()=> navigate("menu");
}

function renderProfile(me){
  elSubtitle.textContent = "Профиль";
  const phone = me.profile && me.profile.phone ? me.profile.phone : "—";
  const name = me.profile && (me.profile.last_name || me.profile.first_name) ? `${me.profile.last_name||""} ${me.profile.first_name||""}`.trim() : "—";
  const dob = me.profile && me.profile.dob ? me.profile.dob : "—";
  const pack = me.profile && typeof me.profile.package_remaining === "number" ? me.profile.package_remaining : 0;

  elScreen.innerHTML = `
    <div>
      <div style="font-weight:700;margin-bottom:10px;">Профиль</div>
      <div class="list">
        <div class="item">
          <div>
            <div class="title">Имя</div>
            <div class="meta">${htmEscape(name)}</div>
          </div>
        </div>
        <div class="item">
          <div>
            <div class="title">Телефон</div>
            <div class="meta">${htmEscape(phone)}</div>
          </div>
        </div>
        <div class="item">
          <div>
            <div class="title">Дата рождения</div>
            <div class="meta">${htmEscape(dob)}</div>
          </div>
        </div>
        <div class="item">
          <div>
            <div class="title">Пакет</div>
            <div class="meta">${pack} тренировок</div>
          </div>
        </div>
      </div>

      <hr class="sep"/>
      <button class="btn secondary" id="btnEdit">Изменить данные</button>
      <button class="btn secondary" data-nav="menu" style="margin-top:10px;">Назад</button>
    </div>
  `;

  document.getElementById("btnEdit").onclick = ()=> renderRegistration();
  elScreen.querySelector("[data-nav='menu']").onclick = ()=> navigate("menu");
}

async function renderClientBook(){
  elSubtitle.textContent = "Запись";
  renderLoader("Загрузка календаря…");
  const days = await api("/api/slots/days");
  elScreen.innerHTML = `
    <div>
      <div style="font-weight:700;margin-bottom:6px;">Записаться</div>
      <div style="color:var(--muted);font-size:13px;line-height:1.35;">
        Выберите дату, затем доступный слот.
      </div>

      <div class="label">Дата</div>
      <select id="daySelect" class="input">
        ${days.days.map(d=>`<option value="${d}">${d}</option>`).join("")}
      </select>

      <div id="slotsBox" style="margin-top:12px;"></div>

      <hr class="sep"/>
      <button class="btn secondary" data-nav="menu">Назад</button>
    </div>
  `;

  async function loadSlots(){
    const day = document.getElementById("daySelect").value;
    const slots = await api("/api/slots?day="+encodeURIComponent(day));
    const box = document.getElementById("slotsBox");
    if (!slots.slots.length){
      box.innerHTML = `<div class="badge warn">Нет свободных слотов</div>`;
      return;
    }
    box.innerHTML = `
      <div class="list">
        ${slots.slots.map(s=>`
          <div class="item">
            <div>
              <div class="title">${htmEscape(s.label)}</div>
              <div class="meta">${htmEscape(s.range)}</div>
            </div>
            <div class="right">
              <button class="btn small" data-book="${s.start}">Записаться</button>
            </div>
          </div>
        `).join("")}
      </div>
    `;
    box.querySelectorAll("[data-book]").forEach(btn=>{
      btn.onclick = async ()=>{
        try{
          const start = btn.getAttribute("data-book");
          renderLoader("Создаём запись…");
          await api("/api/book", {method:"POST", body:{start}});
          toast("Запись создана. Подтвердите за 24 часа до тренировки.");
          await renderClientMyBookings();
        }catch(e){
          toast(e.message);
          await renderClientBook();
        }
      };
    });
  }

  document.getElementById("daySelect").onchange = ()=> loadSlots().catch(e=>toast(e.message));
  await loadSlots();

  elScreen.querySelector("[data-nav='menu']").onclick = ()=> navigate("menu");
}

async function renderClientMyBookings(){
  elSubtitle.textContent = "Мои записи";
  renderLoader("Загрузка…");
  const b = await api("/api/my/bookings");
  if (!b.bookings.length){
    elScreen.innerHTML = `
      <div>
        <div style="font-weight:700;margin-bottom:6px;">Мои записи</div>
        <div class="badge warn">Нет активных записей</div>
        <hr class="sep"/>
        <button class="btn" data-nav="c_book">Записаться</button>
        <button class="btn secondary" data-nav="menu" style="margin-top:10px;">Назад</button>
      </div>
    `;
    elScreen.querySelector("[data-nav='c_book']").onclick = ()=> navigate("c_book");
    elScreen.querySelector("[data-nav='menu']").onclick = ()=> navigate("menu");
    return;
  }

  elScreen.innerHTML = `
    <div>
      <div style="font-weight:700;margin-bottom:6px;">Мои записи</div>
      <div class="list">
        ${b.bookings.map(x=>{
          const st = fmtDateHuman(x.start);
          const tm = `${fmtTimeISO(x.start)}–${fmtTimeISO(x.end)}`;
          const statusBadge = x.confirmed ? `<span class="badge ok">Подтверждено ✅</span>` : `<span class="badge">Не подтверждено</span>`;
          return `
            <div class="item">
              <div>
                <div class="title">${htmEscape(st)} · ${htmEscape(tm)}</div>
                <div class="meta">${htmEscape(TRAIN_LOCATION)}</div>
                <div style="margin-top:8px;">${statusBadge}</div>
              </div>
              <div class="right">
                ${x.can_cancel ? `<button class="btn danger small" data-cancel="${x.id}">Отменить</button>` : `<span class="badge warn">Отмена только &gt; 12 часов</span>`}
              </div>
            </div>
          `;
        }).join("")}
      </div>

      <hr class="sep"/>
      <button class="btn secondary" data-nav="menu">Назад</button>
    </div>
  `;

  elScreen.querySelectorAll("[data-cancel]").forEach(btn=>{
    btn.onclick = async ()=>{
      const id = btn.getAttribute("data-cancel");
      try{
        renderLoader("Отмена…");
        await api("/api/bookings/"+encodeURIComponent(id)+"/cancel", {method:"POST"});
        toast("Отменено");
        await renderClientMyBookings();
      }catch(e){
        toast(e.message);
        await renderClientMyBookings();
      }
    };
  });

  elScreen.querySelector("[data-nav='menu']").onclick = ()=> navigate("menu");
}

async function renderClientPackage(){
  elSubtitle.textContent = "Мой пакет";
  renderLoader("Загрузка…");
  const me = await api("/api/me");
  const pack = (me.profile && typeof me.profile.package_remaining === "number") ? me.profile.package_remaining : 0;

  const comment = pack > 0
    ? "Пакет активен. Записывайтесь на удобные слоты."
    : "Сейчас у вас 0 в пакете: вы либо тренируетесь разово, либо пора продлить пакет для более удобного сервиса.";

  elScreen.innerHTML = `
    <div>
      <div style="font-weight:700;margin-bottom:6px;">Мой пакет</div>
      <div class="item">
        <div>
          <div class="title">Осталось тренировок</div>
          <div class="meta">${pack}</div>
        </div>
        <div class="right">
          ${pack > 0 ? `<span class="badge ok">Активен</span>` : `<span class="badge warn">0</span>`}
        </div>
      </div>
      <div style="margin-top:10px;color:var(--muted);font-size:13px;line-height:1.35;">${htmEscape(comment)}</div>

      <hr class="sep"/>
      <button class="btn secondary" data-nav="menu">Назад</button>
    </div>
  `;
  elScreen.querySelector("[data-nav='menu']").onclick = ()=> navigate("menu");
}

async function renderClientChat(me){
  elSubtitle.textContent = "Чат с тренером";
  elScreen.innerHTML = `
    <div>
      <div style="font-weight:700;margin-bottom:6px;">Чат с тренером</div>
      <div style="color:var(--muted);font-size:13px;line-height:1.35;">
        Нажмите кнопку ниже, чтобы открыть личный чат тренера.
      </div>
      <hr class="sep"/>
      <button class="btn" id="btnOpenChat">Открыть чат</button>
      <button class="btn secondary" data-nav="menu" style="margin-top:10px;">Назад</button>
    </div>
  `;
  document.getElementById("btnOpenChat").onclick = ()=>{
    const trainer = me.trainer;
    if (!trainer || !trainer.username){
      toast("Тренер не настроен");
      return;
    }
    const url = "https://t.me/" + trainer.username.replace("@","");
    try{
      tg.openTelegramLink(url);
    }catch(e){
      window.open(url, "_blank");
    }
  };
  elScreen.querySelector("[data-nav='menu']").onclick = ()=> navigate("menu");
}

/* ---------------- TRAINER UI ---------------- */

function renderTrainerTabs(active){
  const tabs = [
    {id:"t_schedule", label:"График"},
    {id:"t_clients", label:"Клиенты"},
    {id:"t_book", label:"Записать"},
    {id:"t_bookings", label:"Записи"},
    {id:"t_broadcast", label:"Рассылка"},
  ];
  return `
    <div class="tabs">
      ${tabs.map(t=>`<button class="tab ${t.id===active?'active':''}" data-nav="${t.id}">${htmEscape(t.label)}</button>`).join("")}
    </div>
  `;
}

async function renderTrainerSchedule(){
  elSubtitle.textContent = "Тренер · График";
  renderLoader("Загрузка…");
  const data = await api("/api/trainer/schedule");
  const duration = data.duration_min || 60;
  const days = data.days || [];

  elScreen.innerHTML = `
    <div>
      ${renderTrainerTabs("t_schedule")}
      <div style="font-weight:700;margin-bottom:6px;">Настройка графика</div>

      <div class="label">Длительность тренировки</div>
      <select class="input" id="dur">
        ${[30,60,90,120].map(m=>`<option value="${m}" ${m===duration?'selected':''}>${m} мин</option>`).join("")}
      </select>

      <div class="row" style="margin-top:12px;">
        <button class="btn" id="btnSaveDur" style="flex:1;">Сохранить длительность</button>
        <button class="btn secondary" id="btnRefresh" style="flex:1;">Обновить</button>
      </div>

      <hr class="sep"/>

      <div style="font-weight:700;margin-bottom:6px;">Дни месяца</div>
      <div style="color:var(--muted);font-size:13px;line-height:1.35;">
        Выберите дату, задайте интервал работы и перерывы. Можно копировать настройки на другие даты.
      </div>

      <div class="label">Дата</div>
      <input class="input" id="workDay" type="date"/>

      <div class="row" style="margin-top:10px;">
        <div class="col">
          <div class="label">Начало</div>
          <input class="input" id="workStart" type="time" value="10:00"/>
        </div>
        <div class="col">
          <div class="label">Конец</div>
          <input class="input" id="workEnd" type="time" value="21:00"/>
        </div>
      </div>

      <div class="label" style="margin-top:12px;">Перерывы (можно несколько)</div>
      <div id="breaks"></div>
      <div class="row" style="margin-top:10px;">
        <button class="btn secondary" id="btnAddBreak" style="flex:1;">Добавить перерыв</button>
        <button class="btn" id="btnSaveDay" style="flex:1;">Сохранить день</button>
      </div>

      <hr class="sep"/>

      <div style="font-weight:700;margin-bottom:6px;">Копирование</div>
      <div style="color:var(--muted);font-size:13px;line-height:1.35;">
        Копировать настройки выбранного дня на другие даты (через запятую).
      </div>
      <div class="label">Даты (YYYY-MM-DD, через запятую)</div>
      <input class="input" id="copyTo" placeholder="2026-01-25, 2026-01-26"/>
      <button class="btn" id="btnCopy" style="margin-top:10px;">Копировать</button>

      <hr class="sep"/>
      <button class="btn secondary" data-nav="menu">В меню</button>
    </div>
  `;

  elScreen.querySelectorAll("[data-nav]").forEach(x=> x.onclick = ()=> navigate(x.getAttribute("data-nav")));

  function breaksUI(list){
    const box = document.getElementById("breaks");
    if (!list.length){
      box.innerHTML = `<div class="badge">Перерывов нет</div>`;
      return;
    }
    box.innerHTML = list.map((b,idx)=>`
      <div class="item">
        <div style="flex:1;">
          <div class="row">
            <div class="col">
              <div class="label">Начало</div>
              <input class="input" type="time" data-b-start="${idx}" value="${b.start}"/>
            </div>
            <div class="col">
              <div class="label">Конец</div>
              <input class="input" type="time" data-b-end="${idx}" value="${b.end}"/>
            </div>
          </div>
        </div>
        <div class="right">
          <button class="btn danger small" data-b-del="${idx}">Удалить</button>
        </div>
      </div>
    `).join("");

    box.querySelectorAll("[data-b-del]").forEach(btn=>{
      btn.onclick = ()=>{
        const i = Number(btn.getAttribute("data-b-del"));
        list.splice(i,1);
        breaksUI(list);
      };
    });

    box.querySelectorAll("[data-b-start]").forEach(inp=>{
      inp.onchange = ()=>{ list[Number(inp.getAttribute("data-b-start"))].start = inp.value; };
    });
    box.querySelectorAll("[data-b-end]").forEach(inp=>{
      inp.onchange = ()=>{ list[Number(inp.getAttribute("data-b-end"))].end = inp.value; };
    });
  }

  let breaks = [];
  breaksUI(breaks);

  document.getElementById("btnAddBreak").onclick = ()=>{
    breaks.push({start:"13:00", end:"13:30"});
    breaksUI(breaks);
  };

  document.getElementById("btnSaveDur").onclick = async ()=>{
    try{
      await api("/api/trainer/schedule/duration", {method:"POST", body:{duration_min:Number(document.getElementById("dur").value)}});
      toast("Сохранено");
    }catch(e){ toast(e.message); }
  };

  document.getElementById("btnRefresh").onclick = ()=> renderTrainerSchedule().catch(e=>toast(e.message));

  // При выборе дня — подгружаем его настройки
  const workDay = document.getElementById("workDay");
  const today = new Date();
  workDay.value = fmtDate(today);
  async function loadDay(){
    const d = workDay.value;
    const day = await api("/api/trainer/schedule/day?day="+encodeURIComponent(d));
    document.getElementById("workStart").value = day.start || "10:00";
    document.getElementById("workEnd").value = day.end || "21:00";
    breaks = (day.breaks || []).map(x=>({start:x.start, end:x.end}));
    breaksUI(breaks);
  }
  workDay.onchange = ()=> loadDay().catch(e=>toast(e.message));
  await loadDay();

  document.getElementById("btnSaveDay").onclick = async ()=>{
    const d = workDay.value;
    const start = document.getElementById("workStart").value;
    const end = document.getElementById("workEnd").value;
    try{
      renderLoader("Сохранение…");
      await api("/api/trainer/schedule/day", {method:"POST", body:{day:d, start, end, breaks}});
      toast("День сохранён");
      await renderTrainerSchedule();
    }catch(e){
      toast(e.message);
      await renderTrainerSchedule();
    }
  };

  document.getElementById("btnCopy").onclick = async ()=>{
    const from = workDay.value;
    const list = document.getElementById("copyTo").value.split(",").map(x=>x.trim()).filter(Boolean);
    if (!list.length){ toast("Укажите даты"); return; }
    try{
      renderLoader("Копирование…");
      await api("/api/trainer/schedule/copy", {method:"POST", body:{from_day:from, to_days:list}});
      toast("Скопировано");
      await renderTrainerSchedule();
    }catch(e){
      toast(e.message);
      await renderTrainerSchedule();
    }
  };
}

async function renderTrainerClients(){
  elSubtitle.textContent = "Тренер · Клиенты";
  renderLoader("Загрузка…");
  const data = await api("/api/trainer/clients");
  let rows = data.clients || [];

  elScreen.innerHTML = `
    <div>
      ${renderTrainerTabs("t_clients")}
      <div style="font-weight:700;margin-bottom:6px;">Клиентская база</div>

      <div class="row">
        <input class="input" id="q" placeholder="Поиск: фамилия / имя / телефон" style="flex:1;"/>
        <button class="btn secondary" id="btnReloadList">Обновить</button>
      </div>

      <div style="margin-top:12px; overflow:auto;">
        <table class="table" id="tbl">
          <thead>
            <tr>
              <th>Фамилия</th>
              <th>Имя</th>
              <th>Телефон</th>
              <th>ДР</th>
              <th>Пакет</th>
              <th></th>
            </tr>
          </thead>
          <tbody></tbody>
        </table>
      </div>

      <hr class="sep"/>
      <button class="btn secondary" data-nav="menu">В меню</button>
    </div>
  `;
  elScreen.querySelectorAll("[data-nav]").forEach(x=> x.onclick = ()=> navigate(x.getAttribute("data-nav")));
  document.getElementById("btnReloadList").onclick = ()=> renderTrainerClients().catch(e=>toast(e.message));

  const tbody = document.querySelector("#tbl tbody");

  function renderTable(list){
    tbody.innerHTML = list.map(c=>`
      <tr>
        <td>${htmEscape(c.last_name||"")}</td>
        <td>${htmEscape(c.first_name||"")}</td>
        <td>${htmEscape(c.phone||"")}</td>
        <td>
          <input class="input" style="padding:8px" type="date" data-dob="${c.id}" value="${c.dob||""}"/>
        </td>
        <td>
          <input class="input" style="padding:8px; width:90px" type="number" min="0" data-pack="${c.id}" value="${Number(c.package_remaining||0)}"/>
        </td>
        <td><button class="btn small" data-save="${c.id}">Сохранить</button></td>
      </tr>
    `).join("");

    tbody.querySelectorAll("[data-save]").forEach(btn=>{
      btn.onclick = async ()=>{
        const id = btn.getAttribute("data-save");
        const dob = tbody.querySelector(`[data-dob="${id}"]`).value || null;
        const pack = Number(tbody.querySelector(`[data-pack="${id}"]`).value || 0);
        try{
          await api("/api/trainer/clients/"+encodeURIComponent(id), {method:"POST", body:{dob, package_remaining:pack}});
          toast("Сохранено");
        }catch(e){ toast(e.message); }
      };
    });
  }

  renderTable(rows);

  document.getElementById("q").oninput = (e)=>{
    const q = e.target.value.trim().toLowerCase();
    if (!q){ renderTable(rows); return; }
    renderTable(rows.filter(c=>{
      const s = `${c.last_name||""} ${c.first_name||""} ${c.phone||""}`.toLowerCase();
      return s.includes(q);
    }));
  };
}

async function renderTrainerBookClient(){
  elSubtitle.textContent = "Тренер · Записать";
  renderLoader("Загрузка…");
  const clients = await api("/api/trainer/clients");
  const list = clients.clients || [];

  elScreen.innerHTML = `
    <div>
      ${renderTrainerTabs("t_book")}
      <div style="font-weight:700;margin-bottom:6px;">Записать клиента</div>
      <div style="color:var(--muted);font-size:13px;line-height:1.35;">
        Выберите клиента из базы или введите данные вручную. Затем выберите слот.
      </div>

      <div class="label">Клиент (поиск)</div>
      <input class="input" id="clientSearch" placeholder="Иванов Иван или +7..." list="clientsDatalist"/>
      <datalist id="clientsDatalist">
        ${list.map(c=>`<option value="${htmEscape((c.last_name||"")+" "+(c.first_name||"")+" · "+(c.phone||""))}"></option>`).join("")}
      </datalist>

      <div class="row" style="margin-top:10px;">
        <div class="col">
          <div class="label">Фамилия</div>
          <input class="input" id="ln" placeholder="Иванов"/>
        </div>
        <div class="col">
          <div class="label">Имя</div>
          <input class="input" id="fn" placeholder="Иван"/>
        </div>
      </div>

      <div class="label">Телефон</div>
      <input class="input" id="ph" placeholder="+7 (999) 999-99-99" inputmode="tel"/>

      <hr class="sep"/>

      <div class="label">Дата</div>
      <select id="daySelect" class="input"></select>

      <div id="slotsBox" style="margin-top:12px;"></div>

      <hr class="sep"/>
      <button class="btn secondary" data-nav="menu">В меню</button>
    </div>
  `;

  elScreen.querySelectorAll("[data-nav]").forEach(x=> x.onclick = ()=> navigate(x.getAttribute("data-nav")));

  const elPh = document.getElementById("ph");
  phoneMaskRU(elPh);

  // автозаполнение
  document.getElementById("clientSearch").onchange = ()=>{
    const v = document.getElementById("clientSearch").value;
    const hit = list.find(c=>{
      const s = `${(c.last_name||"")} ${(c.first_name||"")} · ${(c.phone||"")}`.trim();
      return s === v;
    });
    if (hit){
      document.getElementById("ln").value = hit.last_name||"";
      document.getElementById("fn").value = hit.first_name||"";
      document.getElementById("ph").value = hit.phone||"";
    }
  };

  const days = await api("/api/slots/days");
  const daySel = document.getElementById("daySelect");
  daySel.innerHTML = days.days.map(d=>`<option value="${d}">${d}</option>`).join("");

  async function loadSlots(){
    const day = daySel.value;
    const slots = await api("/api/slots?day="+encodeURIComponent(day));
    const box = document.getElementById("slotsBox");
    if (!slots.slots.length){
      box.innerHTML = `<div class="badge warn">Нет свободных слотов</div>`;
      return;
    }
    box.innerHTML = `
      <div class="list">
        ${slots.slots.map(s=>`
          <div class="item">
            <div>
              <div class="title">${htmEscape(s.label)}</div>
              <div class="meta">${htmEscape(s.range)}</div>
            </div>
            <div class="right">
              <button class="btn small" data-book="${s.start}">Записать</button>
            </div>
          </div>
        `).join("")}
      </div>
    `;
    box.querySelectorAll("[data-book]").forEach(btn=>{
      btn.onclick = async ()=>{
        const last_name = document.getElementById("ln").value.trim();
        const first_name = document.getElementById("fn").value.trim();
        const phone = document.getElementById("ph").value.trim();
        if (!last_name || !first_name || phone.length < 10){
          toast("Заполните данные клиента");
          return;
        }
        try{
          const start = btn.getAttribute("data-book");
          renderLoader("Создаём запись…");
          await api("/api/trainer/book", {method:"POST", body:{start, last_name, first_name, phone}});
          toast("Запись создана (клиенту придёт подтверждение)");
          await renderTrainerBookClient();
        }catch(e){
          toast(e.message);
          await renderTrainerBookClient();
        }
      };
    });
  }

  daySel.onchange = ()=> loadSlots().catch(e=>toast(e.message));
  await loadSlots();
}

async function renderTrainerBookings(){
  elSubtitle.textContent = "Тренер · Записи";
  renderLoader("Загрузка…");
  const now = new Date();
  const d1 = fmtDate(now);
  const d2 = fmtDate(new Date(now.getTime()+7*86400000));

  elScreen.innerHTML = `
    <div>
      ${renderTrainerTabs("t_bookings")}
      <div style="font-weight:700;margin-bottom:6px;">Записи клиентов</div>

      <div class="row">
        <div class="col">
          <div class="label">С</div>
          <input class="input" id="from" type="date" value="${d1}"/>
        </div>
        <div class="col">
          <div class="label">По</div>
          <input class="input" id="to" type="date" value="${d2}"/>
        </div>
      </div>

      <div class="row" style="margin-top:10px;">
        <button class="btn" id="btnLoad" style="flex:1;">Показать</button>
        <button class="btn secondary" id="btnToday" style="flex:1;">Сегодня</button>
      </div>

      <div id="box" style="margin-top:12px;"></div>

      <hr class="sep"/>
      <button class="btn secondary" data-nav="menu">В меню</button>
    </div>
  `;

  elScreen.querySelectorAll("[data-nav]").forEach(x=> x.onclick = ()=> navigate(x.getAttribute("data-nav")));

  document.getElementById("btnToday").onclick = ()=>{
    document.getElementById("from").value = d1;
    document.getElementById("to").value = d1;
  };

  async function load(){
    const from = document.getElementById("from").value;
    const to = document.getElementById("to").value;
    const data = await api(`/api/trainer/bookings?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`);
    const box = document.getElementById("box");
    if (!data.bookings.length){
      box.innerHTML = `<div class="badge warn">Записей нет</div>`;
      return;
    }
    box.innerHTML = `
      <div class="list">
        ${data.bookings.map(x=>{
          const st = fmtDateHuman(x.start);
          const tm = `${fmtTimeISO(x.start)}–${fmtTimeISO(x.end)}`;
          const who = `${x.last_name||""} ${x.first_name||""}`.trim();
          const b = x.confirmed ? `<span class="badge ok">✅ подтверждено</span>` : `<span class="badge">ожидает</span>`;
          return `
            <div class="item">
              <div>
                <div class="title">${htmEscape(st)} · ${htmEscape(tm)}</div>
                <div class="meta">${htmEscape(who)} · ${htmEscape(x.phone||"")}</div>
                <div style="margin-top:8px;">${b}</div>
              </div>
              <div class="right">
                <span class="badge">${htmEscape(TRAIN_LOCATION)}</span>
              </div>
            </div>
          `;
        }).join("")}
      </div>
    `;
  }

  document.getElementById("btnLoad").onclick = ()=> load().catch(e=>toast(e.message));
  await load();
}

async function renderTrainerBroadcast(){
  elSubtitle.textContent = "Тренер · Рассылка";
  elScreen.innerHTML = `
    <div>
      ${renderTrainerTabs("t_broadcast")}
      <div style="font-weight:700;margin-bottom:6px;">Сообщение всем клиентам</div>
      <div style="color:var(--muted);font-size:13px;line-height:1.35;">
        Сообщение получат все клиенты, у которых есть Telegram ID (кто открывал бота).
      </div>

      <div class="label">Текст</div>
      <textarea class="input" id="msg" placeholder="Например: Завтра есть 2 свободных слота…"></textarea>

      <div class="row" style="margin-top:12px;">
        <button class="btn" id="btnSend" style="flex:1;">Отправить</button>
        <button class="btn secondary" data-nav="menu" style="flex:1;">Назад</button>
      </div>
    </div>
  `;
  elScreen.querySelectorAll("[data-nav]").forEach(x=> x.onclick = ()=> navigate(x.getAttribute("data-nav")));

  document.getElementById("btnSend").onclick = async ()=>{
    const text = document.getElementById("msg").value.trim();
    if (!text){ toast("Введите текст"); return; }
    try{
      renderLoader("Отправка…");
      const r = await api("/api/trainer/broadcast", {method:"POST", body:{text}});
      toast(`Отправлено: ${r.sent}, ошибок: ${r.failed}`);
      await renderTrainerBroadcast();
    }catch(e){
      toast(e.message);
      await renderTrainerBroadcast();
    }
  };
}

/* -------------- NAV -------------- */

let state = {
  me: null
};

async function navigate(id){
  const me = state.me;
  const role = roleFromMe(me);

  if (id === "menu"){
    elSubtitle.textContent = role === "trainer" ? "Тренер" : "Клиент";
    renderMainMenu(role);
    return;
  }
  if (id === "profile"){ renderProfile(me); return; }

  // client
  if (id === "c_book"){ await renderClientBook(); return; }
  if (id === "c_my"){ await renderClientMyBookings(); return; }
  if (id === "c_chat"){ await renderClientChat(me); return; }
  if (id === "c_pack"){ await renderClientPackage(); return; }

  // trainer
  if (id === "t_schedule"){ await renderTrainerSchedule(); return; }
  if (id === "t_clients"){ await renderTrainerClients(); return; }
  if (id === "t_book"){ await renderTrainerBookClient(); return; }
  if (id === "t_bookings"){ await renderTrainerBookings(); return; }
  if (id === "t_broadcast"){ await renderTrainerBroadcast(); return; }

  // fallback
  renderMainMenu(role);
}

async function boot(){
  setHint("");
  if (mustBeInTelegram()){
    renderErrorTelegramContext();
    return;
  }

  try{
    if (tg){
      tg.expand();
      tg.ready();
      try{ tg.setHeaderColor("#fff7fb"); }catch(e){}
      try{ tg.setBackgroundColor("#fff7fb"); }catch(e){}
    }
    elSubtitle.textContent = "Проверка…";
    renderLoader("Проверка доступа…");
    const me = await api("/api/me");
    state.me = me;

    const role = roleFromMe(me);
    elSubtitle.textContent = role === "trainer" ? "Тренер" : "Клиент";

    const prof = me.profile || {};
    const hasProfile = !!(prof.last_name && prof.first_name && prof.phone);

    if (!hasProfile && role !== "trainer"){
      renderRegistration();
      return;
    }
    renderMainMenu(role);
  }catch(e){
    toast(e.message);
    renderErrorTelegramContext();
  }
}

document.getElementById("btnReload").onclick = ()=> boot().catch(()=>{});
boot().catch(()=>{});