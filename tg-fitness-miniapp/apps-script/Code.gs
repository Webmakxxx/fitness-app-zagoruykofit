const TZ = 'Europe/Moscow';

function doPost(e) {
  try {
    const body = JSON.parse(e.postData.contents || '{}');

    const secret = String(body.secret || '');
    const expected = String(PropertiesService.getScriptProperties().getProperty('APPS_SCRIPT_SECRET') || '');
    if (!expected || secret !== expected) {
      return json_({ ok: false, error: 'UNAUTHORIZED' });
    }

    const action = String(body.action || '');
    const calendarId = String(body.calendarId || '');

    if (!calendarId) return json_({ ok: false, error: 'NO_CALENDAR_ID' });

    if (action === 'createBookingEvent') {
      return json_(createBookingEvent_(calendarId, body));
    }
    if (action === 'updateEventTitle') {
      return json_(updateEventTitle_(calendarId, body));
    }
    if (action === 'deleteEvent') {
      return json_(deleteEvent_(calendarId, body));
    }
    if (action === 'listBusy') {
      return json_(listBusy_(calendarId, body));
    }
    if (action === 'upsertWorkDay') {
      return json_(upsertWorkDay_(calendarId, body));
    }

    return json_({ ok: false, error: 'UNKNOWN_ACTION' });
  } catch (err) {
    return json_({ ok: false, error: String(err && err.message ? err.message : err) });
  }
}

function createBookingEvent_(calendarId, body) {
  const cal = CalendarApp.getCalendarById(calendarId);
  if (!cal) return { ok: false, error: 'CALENDAR_NOT_FOUND' };

  const startIso = String(body.startIso || '');
  const endIso = String(body.endIso || '');
  const title = String(body.title || '');
  const location = String(body.location || '');
  const description = String(body.description || '');
  const bookingId = String(body.bookingId || '');

  if (!startIso || !endIso || !title) return { ok:false, error:'BAD_INPUT' };

  const start = new Date(startIso);
  const end = new Date(endIso);

  const desc = [
    description,
    '',
    '---',
    'SOURCE: TG_MINIAPP',
    'BOOKING_ID: ' + bookingId
  ].join('\n');

  const ev = cal.createEvent(title, start, end, {
    location: location,
    description: desc
  });

  return { ok:true, eventId: ev.getId() };
}

function updateEventTitle_(calendarId, body) {
  const cal = CalendarApp.getCalendarById(calendarId);
  if (!cal) return { ok: false, error: 'CALENDAR_NOT_FOUND' };

  const eventId = String(body.eventId || '');
  const appendCheck = !!body.appendCheck;

  if (!eventId) return { ok:false, error:'NO_EVENT_ID' };
  const ev = cal.getEventById(eventId);
  if (!ev) return { ok:false, error:'EVENT_NOT_FOUND' };

  let t = ev.getTitle();
  if (appendCheck) {
    if (!t.includes('✅')) t = t + ' ✅';
  } else {
    ev.setTitle(String(body.title || t));
    return { ok:true };
  }

  ev.setTitle(t);
  return { ok:true };
}

function deleteEvent_(calendarId, body) {
  const cal = CalendarApp.getCalendarById(calendarId);
  if (!cal) return { ok: false, error: 'CALENDAR_NOT_FOUND' };

  const eventId = String(body.eventId || '');
  if (!eventId) return { ok:false, error:'NO_EVENT_ID' };

  const ev = cal.getEventById(eventId);
  if (!ev) return { ok:true }; // idempotent

  ev.deleteEvent();
  return { ok:true };
}

function listBusy_(calendarId, body) {
  const cal = CalendarApp.getCalendarById(calendarId);
  if (!cal) return { ok: false, error: 'CALENDAR_NOT_FOUND' };

  const day = String(body.day || '');
  if (!day) return { ok:false, error:'NO_DAY' };

  const start = new Date(day + 'T00:00:00');
  const end = new Date(day + 'T23:59:59');

  const events = cal.getEvents(start, end);

  const busy = [];
  for (var i=0; i<events.length; i++){
    const ev = events[i];
    const title = ev.getTitle() || '';

    // WORK события — только визуализация графика, не блокируют
    if (title.startsWith('WORK:')) continue;

    busy.push({
      start: ev.getStartTime().toISOString(),
      end: ev.getEndTime().toISOString(),
      title: title
    });
  }

  return { ok:true, busy: busy };
}

function upsertWorkDay_(calendarId, body){
  const cal = CalendarApp.getCalendarById(calendarId);
  if (!cal) return { ok: false, error: 'CALENDAR_NOT_FOUND' };

  const day = String(body.day||'');
  const startT = String(body.start||'');
  const endT = String(body.end||'');
  const breaks = Array.isArray(body.breaks) ? body.breaks : [];

  if (!day || !startT || !endT) return { ok:false, error:'BAD_INPUT' };

  const start = new Date(day + 'T00:00:00');
  const end = new Date(day + 'T23:59:59');

  // delete previous WORK/BREAK events of that day
  const events = cal.getEvents(start, end);
  for (var i=0; i<events.length; i++){
    const t = events[i].getTitle() || '';
    if (t.startsWith('WORK:') || t.startsWith('BREAK:')){
      events[i].deleteEvent();
    }
  }

  // create WORK event (non-blocking because we ignore it in listBusy_)
  const ws = new Date(day + 'T' + startT + ':00');
  const we = new Date(day + 'T' + endT + ':00');
  cal.createEvent('WORK: ' + startT + '-' + endT, ws, we, {
    description: 'Рабочий диапазон тренера (визуализация).'
  });

  // create BREAK events (blocking)
  for (var j=0; j<breaks.length; j++){
    const b = breaks[j] || {};
    if (!b.start || !b.end) continue;
    const bs = new Date(day + 'T' + b.start + ':00');
    const be = new Date(day + 'T' + b.end + ':00');
    cal.createEvent('BREAK: ' + b.start + '-' + b.end, bs, be, {
      description: 'Перерыв (слоты недоступны).'
    });
  }

  return { ok:true };
}

function json_(obj){
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}