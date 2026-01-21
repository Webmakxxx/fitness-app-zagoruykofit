const crypto = require("crypto");

function timingSafeEqualHex(a, b){
  const ba = Buffer.from(String(a), "hex");
  const bb = Buffer.from(String(b), "hex");
  if (ba.length !== bb.length) return false;
  return crypto.timingSafeEqual(ba, bb);
}

/**
 * Проверка initData (Telegram WebApp) по алгоритму Telegram:
 * secret_key = HMAC_SHA256("WebAppData", bot_token)
 * hash = HMAC_SHA256(secret_key, data_check_string)
 */
function verifyTelegramInitData(initData, botToken, maxAgeSec = 86400){
  if (!initData) return {ok:false, error:"EMPTY_INIT_DATA"};
  const params = new URLSearchParams(initData);
  const hash = params.get("hash");
  if (!hash) return {ok:false, error:"NO_HASH"};

  const authDate = Number(params.get("auth_date") || 0);
  if (!authDate) return {ok:false, error:"NO_AUTH_DATE"};

  const now = Math.floor(Date.now()/1000);
  if (maxAgeSec && (now - authDate > maxAgeSec)){
    return {ok:false, error:"INIT_DATA_TOO_OLD"};
  }

  params.delete("hash");

  const pairs = [];
  for (const [k,v] of params.entries()){
    pairs.push([k,v]);
  }
  pairs.sort((a,b)=> a[0].localeCompare(b[0]));
  const dataCheckString = pairs.map(([k,v])=> `${k}=${v}`).join("\n");

  const secretKey = crypto.createHmac("sha256", "WebAppData").update(botToken).digest();
  const calc = crypto.createHmac("sha256", secretKey).update(dataCheckString).digest("hex");

  if (!timingSafeEqualHex(calc, hash)) return {ok:false, error:"BAD_HASH"};

  // parse user
  let user = null;
  const userRaw = params.get("user");
  if (userRaw){
    try{ user = JSON.parse(userRaw); }catch(e){ user=null; }
  }
  return {ok:true, user, auth_date:authDate};
}

function normalizeRUPhone(input){
  const digits = String(input||"").replace(/\D/g,"");
  let d = digits;
  if (d.startsWith("8")) d = "7" + d.slice(1);
  if (!d.startsWith("7")) d = "7" + d;
  d = d.slice(0,11);
  const p = d.slice(1);

  let out = "+7";
  if (p.length>0) out += " ("+p.slice(0,3);
  if (p.length>=3) out += ")";
  if (p.length>3) out += " "+p.slice(3,6);
  if (p.length>6) out += "-"+p.slice(6,8);
  if (p.length>8) out += "-"+p.slice(8,10);
  return out;
}

function safeJson(x, fallback=null){
  try{ return JSON.parse(x); }catch(e){ return fallback; }
}

module.exports = {
  verifyTelegramInitData,
  normalizeRUPhone,
  safeJson
};