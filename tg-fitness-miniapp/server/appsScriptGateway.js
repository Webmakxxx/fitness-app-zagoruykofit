const axios = require("axios");

function mustEnv(name){
  const v = process.env[name];
  if (!v) throw new Error(`Missing env: ${name}`);
  return v;
}

function makeGateway(){
  const url = mustEnv("APPS_SCRIPT_URL"); // URL deployed Web App (exec)
  const secret = mustEnv("APPS_SCRIPT_SECRET"); // shared secret for auth
  const calendarId = mustEnv("CALENDAR_ID");

  async function call(action, payload){
    const res = await axios.post(url, {
      secret,
      action,
      calendarId,
      ...payload
    }, { timeout: 30000 });
    if (!res.data || !res.data.ok){
      const msg = res.data && res.data.error ? res.data.error : "APPS_SCRIPT_ERROR";
      throw new Error(msg);
    }
    return res.data;
  }

  return {
    calendarId,
    createBookingEvent: (p)=> call("createBookingEvent", p),
    updateEventTitle: (p)=> call("updateEventTitle", p),
    deleteEvent: (p)=> call("deleteEvent", p),
    listBusy: (p)=> call("listBusy", p),
    upsertWorkDay: (p)=> call("upsertWorkDay", p)
  };
}

module.exports = { makeGateway };