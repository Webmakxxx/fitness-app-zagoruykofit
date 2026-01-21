require("dotenv").config();
const express = require("express");
const bodyParser = require("body-parser");
const cors = require("cors");
const crypto = require("crypto");
const { DateTime } = require("luxon");

const { initDb } = require("./db");
const { makeGateway } = require("./appsScriptGateway");
const { verifyTelegramInitData, normalizeRUPhone } = require("./utils");
const { sendMessage, answerCallbackQuery, mainKeyboard, inlineConfirmCancel } = require("./telegram");
const { startScheduler } = require("./scheduler");

const TZ = "Europe/Moscow";
const TRAIN_LOCATION = "DDX Fitness, ТЦ Сенная";

function mustEnv(name){
  const v = process.env[name];
  if (!v) throw new Error(`Missing env: ${name}`);
  return v;
}

function uuid(){
  return crypto.randomUUID();
}

function isTrainer(telegramId){
  const t = Number(process.env.TRAINER_TELEGRAM_ID || 0);
  return t && Number(telegramId) === t;
}

function botWebAppUrl(){
  return mustEnv("WEBAPP_URL"); // URL GitHub Pages: .../app/
}

function trainerUsername(){
  return (process.env.TRAINER_USERNAME || "").trim();
}

async function main(){
  const db = await initDb();
  const gateway = makeGateway();

  // settings defaults
  const curDur = await db.getSetting("duration_min", null);
  if (!curDur) await db.setSetting("duration_min", "60");

  const trainerChatId = Number(process.env.TRAINER_TELEGRAM_ID || 0);

  const { canCancel } = startScheduler({db, gateway, trainerChatId});

  const app = express();
  app.use(cors());
  app.use(bodyParser.json({limit:"2mb"}));

  // ---------- AUTH MIDDLEWARE for Mini App API ----------
  async function auth(req, res, next){
    const initData = req.header("X-Telegram-InitData") || "";
    const token = mustEnv("BOT_TOKEN");
    const v = verifyTelegramInitData(initData, token, 86400);
    if (!v.ok){
      return res.status(401).json({error:`UNAUTHORIZED: ${v.error}`});
    }
    if (!v.user || !v.user.id){
      return res.status(401).json({error:"UNAUTHORIZED: NO_USER"});
    }

    const telegram_id = Number(v.user.id);
    let user = await db.getUserByTelegramId(telegram_id);
    if (!user){
      user = {
        id: uuid(),
        telegram_id,
        username: v.user.username ? "@"+v.user.username : null,
        last_name: null,
        first_name: null,
        phone: null,
        dob: null,
        package_remaining: 0,
        role: isTrainer(telegram_id) ? "trainer" : "client"
      };
      await db.upsertUser(user);
      user = await db.getUserByTelegramId(telegram_id);
    }else{
      // ensure role
      const role = isTrainer(telegram_id) ? "trainer" : (user.role || "client");
      if (role !== user.role){
        user.role = role;
        await db.upsertUser(user);
        user = await db.getUserByTelegramId(telegram_id);
      }
    }

    req.me = user;
    req.tgUser = v.user;
    next();
  }

  function requireTrainer(req, res, next){
    if (!req.me || req.me.role !== "trainer"){
      return res.status(403).json({error:"FORBIDDEN"});
    }
    next();
  }

  // ---------- TELEGRAM WEBHOOK ----------
  app.post("/bot/webhook", async (req, res)=>{
    res.json({ok:true});
    const update = req.body || {};
    try{
      // Message
      if (update.message){
        const msg = update.message;
        const chatId = msg.chat && msg.chat.id;

        // /start -> show keyboard with webapp
        if (msg.text && msg.text.startsWith("/start")){
          await sendMessage(chatId, "Откройте приложение кнопкой ниже.", {
            reply_markup: mainKeyboard(botWebAppUrl())
          });
          return;
        }

        // Contact shared
        if (msg.contact){
          const tid = msg.from && msg.from.id;
          if (!tid) return;
          let u = await db.getUserByTelegramId(Number(tid));
          if (!u){
            u = { id: uuid(), telegram_id:Number(tid), role:isTrainer(tid)?"trainer":"client" };
          }
          const phone = normalizeRUPhone(msg.contact.phone_number || "");
          u.phone = phone;
          u.first_name = u.first_name || msg.contact.first_name || null;
          u.last_name = u.last_name || msg.contact.last_name || null;
          u.username = msg.from.username ? "@"+msg.from.username : u.username;
          await db.upsertUser(u);
          await db.log("contact_shared", {telegram_id:tid, phone});
          await sendMessage(chatId, "Контакт получен. Вернитесь в приложение и обновите экран.");
          return;
        }
      }

      // Callback query (confirm/cancel)
      if (update.callback_query){
        const cq = update.callback_query;
        const data = String(cq.data || "");
        const chatId = cq.message && cq.message.chat && cq.message.chat.id;
        const fromId = cq.from && cq.from.id;

        if (!data.includes(":")) return;
        const [action, bookingId] = data.split(":");

        const booking = await db.getBooking(bookingId);
        if (!booking){
          await answerCallbackQuery(cq.id, "Запись не найдена");
          return;
        }
        if (Number(booking.telegram_id) !== Number(fromId)){
          await answerCallbackQuery(cq.id, "Недоступно");
          return;
        }

        if (action === "confirm"){
          // update event title with ✅
          if (booking.event_id){
            const title = `${booking.last_name} ${booking.first_name}`.trim();
            const after = await computeRemainingAfterBooking(db, booking.telegram_id, booking.used_package);
            // Но у нас уже посчитано при создании события; чтобы не усложнять — не пересчитываем, а просто добавляем ✅
            await gateway.updateEventTitle({ eventId: booking.event_id, appendCheck: true });
          }
          await db.setBookingConfirmed(bookingId, true);
          await db.log("booking_confirmed", {bookingId});
          await answerCallbackQuery(cq.id, "Подтверждено");
          await sendMessage(chatId, "Запись подтверждена ✅");

          if (trainerChatId){
            await sendMessage(trainerChatId, `Клиент подтвердил запись: ${booking.last_name} ${booking.first_name} · ${DateTime.fromISO(booking.start_iso,{zone:TZ}).toFormat("dd.LL HH:mm")}`);
          }
          return;
        }

        if (action === "cancel"){
          if (!canCancel(booking.start_iso)){
            await answerCallbackQuery(cq.id, "Отмена только более чем за 12 часов");
            return;
          }
          // delete event
          if (booking.event_id){
            await gateway.deleteEvent({ eventId: booking.event_id });
          }
          await db.cancelBooking(bookingId);

          // если использовали пакет — вернём 1
          if (Number(booking.used_package) === 1){
            const u = await db.getUserByTelegramId(Number(booking.telegram_id));
            if (u){
              const newPack = Number(u.package_remaining || 0) + 1;
              u.package_remaining = newPack;
              await db.upsertUser(u);
            }
          }

          await db.log("booking_cancelled", {bookingId});
          await answerCallbackQuery(cq.id, "Отменено");
          await sendMessage(chatId, "Запись отменена.");

          if (trainerChatId){
            await sendMessage(trainerChatId, `Клиент отменил запись: ${booking.last_name} ${booking.first_name} · ${DateTime.fromISO(booking.start_iso,{zone:TZ}).toFormat("dd.LL HH:mm")}`);
          }
          return;
        }
      }
    }catch(e){
      await db.log("webhook_error", {error:String(e.message||e), update});
    }
  });

  // ---------- Mini App API ----------
  app.get("/api/health", (req,res)=> res.json({ok:true, kind:db.kind}));

  app.get("/api/me", auth, async (req,res)=>{
    const me = req.me;
    res.json({
      role: me.role,
      profile: {
        id: me.id,
        telegram_id: me.telegram_id,
        username: me.username,
        last_name: me.last_name,
        first_name: me.first_name,
        phone: me.phone,
        dob: me.dob,
        package_remaining: Number(me.package_remaining||0)
      },
      trainer: {
        username: trainerUsername() || null
      }
    });
  });

  app.post("/api/profile", auth, async (req,res)=>{
    const me = req.me;
    const { last_name, first_name, phone } = req.body || {};
    if (!last_name || !first_name || !phone){
      return res.status(400).json({error:"BAD_REQUEST"});
    }
    me.last_name = String(last_name).trim();
    me.first_name = String(first_name).trim();
    me.phone = normalizeRUPhone(phone);
    await db.upsertUser(me);
    await db.log("profile_updated", {telegram_id:me.telegram_id});
    res.json({ok:true});
  });

  // --- Slots days list (next 30 days) ---
  app.get("/api/slots/days", auth, async (req,res)=>{
    const days = [];
    const now = DateTime.now().setZone(TZ);
    for (let i=0;i<30;i++){
      days.push(now.plus({days:i}).toFormat("yyyy-LL-dd"));
    }
    res.json({days});
  });

  // --- Slots for day ---
  app.get("/api/slots", auth, async (req,res)=>{
    const day = String(req.query.day||"").trim();
    if (!day) return res.status(400).json({error:"BAD_DAY"});

    const durationMin = Number(await db.getSetting("duration_min","60"));
    const schedule = await db.getScheduleDay(day);
    if (!schedule || !schedule.start_time || !schedule.end_time){
      return res.json({slots:[]});
    }
    const start = DateTime.fromFormat(`${day} ${schedule.start_time}`, "yyyy-LL-dd HH:mm", {zone:TZ});
    const end = DateTime.fromFormat(`${day} ${schedule.end_time}`, "yyyy-LL-dd HH:mm", {zone:TZ});
    if (!start.isValid || !end.isValid || end <= start) return res.json({slots:[]});

    const breaks = safeBreaks(schedule.breaks_json);
    const busy = await gateway.listBusy({ day });

    const slots = buildSlots({start, end, durationMin, breaks, busy});
    res.json({slots});
  });

  // --- Client book ---
  app.post("/api/book", auth, async (req,res)=>{
    const me = req.me;
    if (me.role === "trainer") return res.status(400).json({error:"TRAINER_USE_TRAINER_BOOK"});
    if (!me.last_name || !me.first_name || !me.phone){
      return res.status(400).json({error:"NO_PROFILE"});
    }

    const startIso = String((req.body||{}).start||"");
    const start = DateTime.fromISO(startIso, {zone:TZ});
    if (!start.isValid) return res.status(400).json({error:"BAD_START"});
    const durationMin = Number(await db.getSetting("duration_min","60"));
    const end = start.plus({minutes:durationMin});

    // check availability again
    const day = start.toFormat("yyyy-LL-dd");
    const schedule = await db.getScheduleDay(day);
    if (!schedule || !schedule.start_time || !schedule.end_time){
      return res.status(400).json({error:"NO_SCHEDULE"});
    }
    const workStart = DateTime.fromFormat(`${day} ${schedule.start_time}`, "yyyy-LL-dd HH:mm", {zone:TZ});
    const workEnd = DateTime.fromFormat(`${day} ${schedule.end_time}`, "yyyy-LL-dd HH:mm", {zone:TZ});
    if (start < workStart || end > workEnd) return res.status(400).json({error:"OUT_OF_WORK_HOURS"});

    const breaks = safeBreaks(schedule.breaks_json);
    if (inBreak(start, end, breaks)) return res.status(400).json({error:"IN_BREAK"});

    const busy = await gateway.listBusy({ day });
    if (overlapsBusy(start, end, busy)) return res.status(400).json({error:"BUSY"});

    // package logic: decrement if >0
    let pack = Number(me.package_remaining||0);
    let used_package = 0;
    let after = 0;
    if (pack > 0){
      used_package = 1;
      after = pack - 1;
      me.package_remaining = after;
      await db.upsertUser(me);
      if (after === 2){
        await sendMessage(me.telegram_id, "У вас осталось 2 тренировки в пакете. Рекомендую продлить пакет заранее.");
      }
    }else{
      after = 0;
    }

    const titleBase = `${me.last_name} ${me.first_name}`.trim();
    const title = `${titleBase} (${after})`;

    const bookingId = uuid();
    const created = await gateway.createBookingEvent({
      startIso: start.toISO(),
      endIso: end.toISO(),
      title,
      location: TRAIN_LOCATION,
      description: me.phone,
      bookingId
    });

    await db.createBooking({
      id: bookingId,
      user_id: me.id,
      telegram_id: me.telegram_id,
      last_name: me.last_name,
      first_name: me.first_name,
      phone: me.phone,
      start_iso: start.toISO(),
      end_iso: end.toISO(),
      event_id: created.eventId,
      confirmed: 0,
      status: "active",
      used_package
    });

    // trainer notification
    if (trainerChatId){
      await sendMessage(trainerChatId, `Новая запись: ${me.last_name} ${me.first_name} · ${start.toFormat("dd.LL HH:mm")}`);
    }

    res.json({ok:true, bookingId});
  });

  // --- Client bookings ---
  app.get("/api/my/bookings", auth, async (req,res)=>{
    const me = req.me;
    const list = await db.listUserBookings(me.telegram_id);
    const now = DateTime.now().setZone(TZ);

    const bookings = list.map(b=>{
      const start = DateTime.fromISO(b.start_iso,{zone:TZ});
      const can = start.diff(now,"hours").hours > 12;
      return {
        id: b.id,
        start: b.start_iso,
        end: b.end_iso,
        confirmed: Number(b.confirmed)===1,
        can_cancel: can
      };
    });
    res.json({bookings});
  });

  // --- Client cancel ---
  app.post("/api/bookings/:id/cancel", auth, async (req,res)=>{
    const me = req.me;
    const id = String(req.params.id||"");
    const b = await db.getBooking(id);
    if (!b || b.status !== "active") return res.status(404).json({error:"NOT_FOUND"});
    if (Number(b.telegram_id) !== Number(me.telegram_id)) return res.status(403).json({error:"FORBIDDEN"});
    if (!canCancel(b.start_iso)) return res.status(400).json({error:"CANCEL_ONLY_12H"});

    if (b.event_id) await gateway.deleteEvent({eventId:b.event_id});
    await db.cancelBooking(id);

    if (Number(b.used_package)===1){
      const u = await db.getUserByTelegramId(Number(me.telegram_id));
      u.package_remaining = Number(u.package_remaining||0)+1;
      await db.upsertUser(u);
    }

    if (trainerChatId){
      await sendMessage(trainerChatId, `Клиент отменил запись: ${b.last_name} ${b.first_name} · ${DateTime.fromISO(b.start_iso,{zone:TZ}).toFormat("dd.LL HH:mm")}`);
    }

    res.json({ok:true});
  });

  // ---------- TRAINER API ----------
  app.get("/api/trainer/schedule", auth, requireTrainer, async (req,res)=>{
    const duration_min = Number(await db.getSetting("duration_min","60"));
    res.json({duration_min});
  });

  app.post("/api/trainer/schedule/duration", auth, requireTrainer, async (req,res)=>{
    const m = Number((req.body||{}).duration_min||0);
    if (![30,60,90,120].includes(m)) return res.status(400).json({error:"BAD_DURATION"});
    await db.setSetting("duration_min", String(m));
    await db.log("duration_set", {duration_min:m});
    res.json({ok:true});
  });

  app.get("/api/trainer/schedule/day", auth, requireTrainer, async (req,res)=>{
    const day = String(req.query.day||"").trim();
    if (!day) return res.status(400).json({error:"BAD_DAY"});
    const s = await db.getScheduleDay(day);
    if (!s) return res.json({day, start:null, end:null, breaks:[]});
    res.json({day, start:s.start_time||null, end:s.end_time||null, breaks:safeBreaks(s.breaks_json)});
  });

  app.post("/api/trainer/schedule/day", auth, requireTrainer, async (req,res)=>{
    const { day, start, end, breaks } = req.body || {};
    if (!day || !start || !end) return res.status(400).json({error:"BAD_REQUEST"});
    const breaksJson = JSON.stringify((breaks||[]).map(x=>({start:x.start, end:x.end})));
    await db.upsertScheduleDay(day, start, end, breaksJson);

    // sync to calendar (visible work range + breaks)
    await gateway.upsertWorkDay({ day, start, end, breaks: (breaks||[]) });

    await db.log("schedule_day_set", {day,start,end,breaks});
    res.json({ok:true});
  });

  app.post("/api/trainer/schedule/copy", auth, requireTrainer, async (req,res)=>{
    const { from_day, to_days } = req.body || {};
    if (!from_day || !Array.isArray(to_days) || !to_days.length) return res.status(400).json({error:"BAD_REQUEST"});
    const s = await db.getScheduleDay(from_day);
    if (!s) return res.status(404).json({error:"FROM_DAY_NOT_FOUND"});
    for (const d of to_days){
      await db.upsertScheduleDay(d, s.start_time, s.end_time, s.breaks_json);
      await gateway.upsertWorkDay({ day:d, start:s.start_time, end:s.end_time, breaks: safeBreaks(s.breaks_json) });
    }
    await db.log("schedule_copied", {from_day,to_days});
    res.json({ok:true});
  });

  app.get("/api/trainer/clients", auth, requireTrainer, async (req,res)=>{
    const clients = await db.listClients();
    res.json({clients: clients.map(c=>({
      id: c.id,
      telegram_id: c.telegram_id,
      username: c.username,
      last_name: c.last_name,
      first_name: c.first_name,
      phone: c.phone,
      dob: c.dob,
      package_remaining: Number(c.package_remaining||0)
    }))});
  });

  app.post("/api/trainer/clients/:id", auth, requireTrainer, async (req,res)=>{
    const id = String(req.params.id||"");
    const { dob, package_remaining } = req.body || {};
    if (typeof package_remaining !== "number" || package_remaining < 0) return res.status(400).json({error:"BAD_PACKAGE"});
    await db.updateClient(id, {dob: dob || null, package_remaining});
    await db.log("client_updated", {id, dob, package_remaining});
    res.json({ok:true});
  });

  app.post("/api/trainer/book", auth, requireTrainer, async (req,res)=>{
    const { start, last_name, first_name, phone } = req.body || {};
    if (!start || !last_name || !first_name || !phone) return res.status(400).json({error:"BAD_REQUEST"});

    const startDT = DateTime.fromISO(String(start), {zone:TZ});
    if (!startDT.isValid) return res.status(400).json({error:"BAD_START"});
    const durationMin = Number(await db.getSetting("duration_min","60"));
    const endDT = startDT.plus({minutes:durationMin});

    const day = startDT.toFormat("yyyy-LL-dd");
    const schedule = await db.getScheduleDay(day);
    if (!schedule || !schedule.start_time || !schedule.end_time){
      return res.status(400).json({error:"NO_SCHEDULE"});
    }
    const workStart = DateTime.fromFormat(`${day} ${schedule.start_time}`, "yyyy-LL-dd HH:mm", {zone:TZ});
    const workEnd = DateTime.fromFormat(`${day} ${schedule.end_time}`, "yyyy-LL-dd HH:mm", {zone:TZ});
    if (startDT < workStart || endDT > workEnd) return res.status(400).json({error:"OUT_OF_WORK_HOURS"});
    const breaks = safeBreaks(schedule.breaks_json);
    if (inBreak(startDT, endDT, breaks)) return res.status(400).json({error:"IN_BREAK"});
    const busy = await gateway.listBusy({ day });
    if (overlapsBusy(startDT, endDT, busy)) return res.status(400).json({error:"BUSY"});

    // find or create client user (by phone match)
    const normPhone = normalizeRUPhone(phone);
    let clients = await db.listClients();
    let u = clients.find(c=> (c.phone||"") === normPhone);

    if (!u){
      // new user without telegram_id
      u = {
        id: uuid(),
        telegram_id: null,
        username: null,
        last_name: String(last_name).trim(),
        first_name: String(first_name).trim(),
        phone: normPhone,
        dob: null,
        package_remaining: 0,
        role: "client"
      };
      await db.upsertUser(u);
      u = await db.getUserById(u.id);
    }else{
      // update name/phone if needed
      u.last_name = String(last_name).trim();
      u.first_name = String(first_name).trim();
      u.phone = normPhone;
      await db.upsertUser(u);
    }

    let pack = Number(u.package_remaining||0);
    let used_package = 0;
    let after = 0;
    if (pack > 0){
      used_package = 1;
      after = pack - 1;
      u.package_remaining = after;
      await db.upsertUser(u);
      if (u.telegram_id && after === 2){
        await sendMessage(u.telegram_id, "У вас осталось 2 тренировки в пакете. Рекомендую продлить пакет заранее.");
      }
    }else{
      after = 0;
    }

    const titleBase = `${u.last_name} ${u.first_name}`.trim();
    const title = `${titleBase} (${after})`;
    const bookingId = uuid();

    const created = await gateway.createBookingEvent({
      startIso: startDT.toISO(),
      endIso: endDT.toISO(),
      title,
      location: TRAIN_LOCATION,
      description: normPhone,
      bookingId
    });

    await db.createBooking({
      id: bookingId,
      user_id: u.id,
      telegram_id: u.telegram_id || 0,
      last_name: u.last_name,
      first_name: u.first_name,
      phone: u.phone,
      start_iso: startDT.toISO(),
      end_iso: endDT.toISO(),
      event_id: created.eventId,
      confirmed: 0,
      status: "active",
      used_package
    });

    // notify client if possible
    if (u.telegram_id){
      await sendMessage(u.telegram_id,
        `Вы записаны на тренировку.\nДата: ${startDT.toFormat("dd.LL.yyyy")}\nВремя: ${startDT.toFormat("HH:mm")}–${endDT.toFormat("HH:mm")}\nПодтвердите запись за 24 часа.`,
        { reply_markup: inlineConfirmCancel(bookingId) }
      );
    }

    await db.log("trainer_booked", {bookingId, day});
    res.json({ok:true, bookingId});
  });

  app.get("/api/trainer/bookings", auth, requireTrainer, async (req,res)=>{
    const from = String(req.query.from||"").trim();
    const to = String(req.query.to||"").trim();
    if (!from || !to) return res.status(400).json({error:"BAD_RANGE"});

    const fromIso = DateTime.fromFormat(from+" 00:00","yyyy-LL-dd HH:mm",{zone:TZ}).toISO();
    const toIso = DateTime.fromFormat(to+" 23:59","yyyy-LL-dd HH:mm",{zone:TZ}).toISO();
    const bookings = await db.listBookingsRange(fromIso, toIso);
    res.json({bookings: bookings.map(b=>({
      id: b.id,
      last_name: b.last_name,
      first_name: b.first_name,
      phone: b.phone,
      start: b.start_iso,
      end: b.end_iso,
      confirmed: Number(b.confirmed)===1
    }))});
  });

  app.post("/api/trainer/broadcast", auth, requireTrainer, async (req,res)=>{
    const text = String((req.body||{}).text||"").trim();
    if (!text) return res.status(400).json({error:"NO_TEXT"});

    const clients = await db.listClients();
    let sent=0, failed=0;
    for (const c of clients){
      if (!c.telegram_id) continue;
      try{
        await sendMessage(c.telegram_id, text);
        sent++;
      }catch(e){
        failed++;
      }
    }
    await db.log("broadcast", {sent, failed});
    res.json({ok:true, sent, failed});
  });

  // ---------- START ----------
  const port = Number(process.env.PORT || 8080);
  app.listen(port, ()=>{
    console.log("Server started on port", port);
    console.log("DB:", db.kind);
  });
}

function safeBreaks(json){
  try{
    const a = JSON.parse(json||"[]");
    if (!Array.isArray(a)) return [];
    return a
      .filter(x=>x && x.start && x.end)
      .map(x=>({start:String(x.start), end:String(x.end)}));
  }catch(e){
    return [];
  }
}

function inBreak(startDT, endDT, breaks){
  for (const b of breaks){
    const bs = DateTime.fromFormat(startDT.toFormat("yyyy-LL-dd")+" "+b.start, "yyyy-LL-dd HH:mm", {zone:TZ});
    const be = DateTime.fromFormat(startDT.toFormat("yyyy-LL-dd")+" "+b.end, "yyyy-LL-dd HH:mm", {zone:TZ});
    if (bs.isValid && be.isValid){
      if (startDT < be && endDT > bs) return true;
    }
  }
  return false;
}

function overlapsBusy(startDT, endDT, busy){
  // busy = [{start,end,title}]
  for (const x of (busy.busy||[])){
    const bs = DateTime.fromISO(x.start,{zone:TZ});
    const be = DateTime.fromISO(x.end,{zone:TZ});
    if (!bs.isValid || !be.isValid) continue;
    if (startDT < be && endDT > bs) return true;
  }
  return false;
}

function buildSlots({start, end, durationMin, breaks, busy}){
  const slots = [];
  let cur = start;
  const busyArr = (busy.busy||[]).map(x=>({
    start: DateTime.fromISO(x.start,{zone:TZ}),
    end: DateTime.fromISO(x.end,{zone:TZ})
  })).filter(x=>x.start.isValid && x.end.isValid);

  while (cur.plus({minutes:durationMin}) <= end){
    const e = cur.plus({minutes:durationMin});
    const inBr = inBreak(cur, e, breaks);
    let inBusy = false;
    for (const b of busyArr){
      if (cur < b.end && e > b.start){ inBusy = true; break; }
    }
    if (!inBr && !inBusy){
      const label = `${cur.toFormat("HH:mm")}–${e.toFormat("HH:mm")}`;
      slots.push({
        start: cur.toISO(),
        end: e.toISO(),
        label,
        range: `${cur.toFormat("dd.LL.yyyy")} · ${label}`
      });
    }
    cur = cur.plus({minutes:durationMin});
  }
  return slots;
}

async function computeRemainingAfterBooking(db, telegramId, usedPackage){
  if (!usedPackage) return 0;
  const u = await db.getUserByTelegramId(Number(telegramId));
  return u ? Number(u.package_remaining||0) : 0;
}

main().catch(err=>{
  console.error(err);
  process.exit(1);
});