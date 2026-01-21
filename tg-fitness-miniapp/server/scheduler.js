const cron = require("node-cron");
const { DateTime } = require("luxon");
const { inlineConfirmCancel, sendMessage } = require("./telegram");

const TZ = "Europe/Moscow";

function canCancel(startIso){
  const start = DateTime.fromISO(startIso, {zone: TZ});
  const now = DateTime.now().setZone(TZ);
  return start.diff(now, "hours").hours > 12;
}

function shouldSend24h(startIso){
  const start = DateTime.fromISO(startIso, {zone: TZ});
  const now = DateTime.now().setZone(TZ);
  const diff = start.diff(now, "minutes").minutes;
  return diff <= 24*60 && diff > 23*60; // окно ~60 минут
}
function shouldSend90m(startIso){
  const start = DateTime.fromISO(startIso, {zone: TZ});
  const now = DateTime.now().setZone(TZ);
  const diff = start.diff(now, "minutes").minutes;
  return diff <= 90 && diff > 30; // окно ~60 минут
}

function startScheduler({db, gateway, trainerChatId}){
  // Каждые 10 минут: 24ч и 90мин
  cron.schedule("*/10 * * * *", async ()=>{
    try{
      const now = DateTime.now().setZone(TZ);
      const from = now.minus({days:1}).toISO();
      const to = now.plus({days:7}).toISO();
      const bookings = await db.listBookingsRange(from, to);

      for (const b of bookings){
        // 24 часа
        if (shouldSend24h(b.start_iso)){
          const text =
            `Напоминание: тренировка через 24 часа.\n`+
            `Дата: ${DateTime.fromISO(b.start_iso,{zone:TZ}).toFormat("dd.LL.yyyy")}\n`+
            `Время: ${DateTime.fromISO(b.start_iso,{zone:TZ}).toFormat("HH:mm")}–${DateTime.fromISO(b.end_iso,{zone:TZ}).toFormat("HH:mm")}\n`+
            `Отмена возможна только более чем за 12 часов.`;
          // клиенту
          await sendMessage(b.telegram_id, text, { reply_markup: inlineConfirmCancel(b.id) });
        }
        // 90 минут
        if (shouldSend90m(b.start_iso)){
          const text = `Тренировка через 1 ч 30 мин. Рекомендую сделать полноценный приём пищи заранее.`;
          await sendMessage(b.telegram_id, text);
        }
      }
    }catch(e){
      await db.log("scheduler_error", {where:"reminders", error:String(e.message||e)});
    }
  }, { timezone: TZ });

  // День рождения: каждый день в 10:00
  cron.schedule("0 10 * * *", async ()=>{
    try{
      const today = DateTime.now().setZone(TZ).toFormat("yyyy-LL-dd");
      const mmdd = today.slice(5);

      const clients = await db.listClients();
      for (const c of clients){
        if (!c.dob) continue;
        const d = String(c.dob);
        if (d.length < 10) continue;
        if (d.slice(5) !== mmdd) continue;
        if (!c.telegram_id) continue;

        const name = `${c.first_name||""}`.trim() || "!";
        await sendMessage(c.telegram_id, `С днём рождения, ${name}! 🎉\nЖелаю здоровья и отличных тренировок.`);
        await db.log("birthday_sent", {telegram_id:c.telegram_id, user_id:c.id});
        if (trainerChatId){
          await sendMessage(trainerChatId, `Сегодня ДР у клиента: ${c.last_name||""} ${c.first_name||""}`.trim());
        }
      }
    }catch(e){
      await db.log("scheduler_error", {where:"birthday", error:String(e.message||e)});
    }
  }, { timezone: TZ });

  return { canCancel };
}

module.exports = { startScheduler, canCancel };