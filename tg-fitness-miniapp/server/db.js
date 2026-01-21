const sqlite3 = require("sqlite3").verbose();
const { Client } = require("pg");

function isPostgres(){
  return !!process.env.DATABASE_URL;
}

async function initPostgres(){
  const client = new Client({ connectionString: process.env.DATABASE_URL, ssl: process.env.PGSSL === "true" ? {rejectUnauthorized:false} : undefined });
  await client.connect();

  await client.query(`
    create table if not exists users (
      id text primary key,
      telegram_id bigint unique,
      username text,
      last_name text,
      first_name text,
      phone text,
      dob text,
      package_remaining int default 0,
      role text default 'client',
      created_at timestamptz default now(),
      updated_at timestamptz default now()
    );
  `);

  await client.query(`
    create table if not exists schedule_days (
      day text primary key,
      start_time text,
      end_time text,
      breaks_json text,
      updated_at timestamptz default now()
    );
  `);

  await client.query(`
    create table if not exists settings (
      k text primary key,
      v text
    );
  `);

  await client.query(`
    create table if not exists bookings (
      id text primary key,
      user_id text,
      telegram_id bigint,
      last_name text,
      first_name text,
      phone text,
      start_iso text,
      end_iso text,
      event_id text,
      confirmed int default 0,
      status text default 'active',
      used_package int default 0,
      created_at timestamptz default now(),
      updated_at timestamptz default now()
    );
  `);

  await client.query(`
    create table if not exists logs (
      id bigserial primary key,
      ts timestamptz default now(),
      type text,
      payload_json text
    );
  `);

  return {
    kind: "pg",
    async getSetting(k, def=null){
      const r = await client.query("select v from settings where k=$1", [k]);
      return r.rows.length ? r.rows[0].v : def;
    },
    async setSetting(k, v){
      await client.query("insert into settings(k,v) values($1,$2) on conflict(k) do update set v=excluded.v", [k, String(v)]);
    },
    async upsertUser(u){
      await client.query(`
        insert into users(id, telegram_id, username, last_name, first_name, phone, dob, package_remaining, role, updated_at)
        values($1,$2,$3,$4,$5,$6,$7,$8,$9, now())
        on conflict(id) do update set
          telegram_id=excluded.telegram_id,
          username=excluded.username,
          last_name=excluded.last_name,
          first_name=excluded.first_name,
          phone=excluded.phone,
          dob=excluded.dob,
          package_remaining=excluded.package_remaining,
          role=excluded.role,
          updated_at=now()
      `, [u.id, u.telegram_id, u.username, u.last_name, u.first_name, u.phone, u.dob, u.package_remaining||0, u.role||"client"]);
    },
    async getUserByTelegramId(tid){
      const r = await client.query("select * from users where telegram_id=$1", [tid]);
      return r.rows[0] || null;
    },
    async getUserById(id){
      const r = await client.query("select * from users where id=$1", [id]);
      return r.rows[0] || null;
    },
    async listClients(){
      const r = await client.query("select * from users order by last_name asc, first_name asc");
      return r.rows;
    },
    async updateClient(id, patch){
      await client.query("update users set dob=$2, package_remaining=$3, updated_at=now() where id=$1", [id, patch.dob, patch.package_remaining]);
    },
    async upsertScheduleDay(day, start, end, breaksJson){
      await client.query(`
        insert into schedule_days(day,start_time,end_time,breaks_json,updated_at)
        values($1,$2,$3,$4, now())
        on conflict(day) do update set
          start_time=excluded.start_time,
          end_time=excluded.end_time,
          breaks_json=excluded.breaks_json,
          updated_at=now()
      `,[day,start,end,breaksJson]);
    },
    async getScheduleDay(day){
      const r = await client.query("select * from schedule_days where day=$1", [day]);
      return r.rows[0] || null;
    },
    async createBooking(b){
      await client.query(`
        insert into bookings(id,user_id,telegram_id,last_name,first_name,phone,start_iso,end_iso,event_id,confirmed,status,used_package,updated_at)
        values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12, now())
      `,[b.id,b.user_id,b.telegram_id,b.last_name,b.first_name,b.phone,b.start_iso,b.end_iso,b.event_id, b.confirmed?1:0, b.status||"active", b.used_package?1:0]);
    },
    async getBooking(id){
      const r = await client.query("select * from bookings where id=$1",[id]);
      return r.rows[0] || null;
    },
    async listUserBookings(telegram_id){
      const r = await client.query("select * from bookings where telegram_id=$1 and status='active' order by start_iso asc",[telegram_id]);
      return r.rows;
    },
    async listBookingsRange(fromIso, toIso){
      const r = await client.query("select * from bookings where status='active' and start_iso >= $1 and start_iso <= $2 order by start_iso asc",[fromIso,toIso]);
      return r.rows;
    },
    async setBookingConfirmed(id, val){
      await client.query("update bookings set confirmed=$2, updated_at=now() where id=$1",[id, val?1:0]);
    },
    async cancelBooking(id){
      await client.query("update bookings set status='cancelled', updated_at=now() where id=$1",[id]);
    },
    async log(type, payload){
      await client.query("insert into logs(type,payload_json) values($1,$2)", [type, JSON.stringify(payload||{})]);
    }
  };
}

async function initSqlite(){
  const path = process.env.SQLITE_PATH || "./data.sqlite";
  const db = new sqlite3.Database(path);

  function run(sql, params=[]){
    return new Promise((resolve,reject)=>{
      db.run(sql, params, function(err){
        if (err) reject(err); else resolve(this);
      });
    });
  }
  function get(sql, params=[]){
    return new Promise((resolve,reject)=>{
      db.get(sql, params, (err,row)=> err?reject(err):resolve(row||null));
    });
  }
  function all(sql, params=[]){
    return new Promise((resolve,reject)=>{
      db.all(sql, params, (err,rows)=> err?reject(err):resolve(rows||[]));
    });
  }

  await run(`
    create table if not exists users(
      id text primary key,
      telegram_id integer unique,
      username text,
      last_name text,
      first_name text,
      phone text,
      dob text,
      package_remaining integer default 0,
      role text default 'client',
      created_at text default (datetime('now')),
      updated_at text default (datetime('now'))
    )
  `);

  await run(`
    create table if not exists schedule_days(
      day text primary key,
      start_time text,
      end_time text,
      breaks_json text,
      updated_at text default (datetime('now'))
    )
  `);

  await run(`
    create table if not exists settings(
      k text primary key,
      v text
    )
  `);

  await run(`
    create table if not exists bookings(
      id text primary key,
      user_id text,
      telegram_id integer,
      last_name text,
      first_name text,
      phone text,
      start_iso text,
      end_iso text,
      event_id text,
      confirmed integer default 0,
      status text default 'active',
      used_package integer default 0,
      created_at text default (datetime('now')),
      updated_at text default (datetime('now'))
    )
  `);

  await run(`
    create table if not exists logs(
      id integer primary key autoincrement,
      ts text default (datetime('now')),
      type text,
      payload_json text
    )
  `);

  return {
    kind: "sqlite",
    async getSetting(k, def=null){
      const r = await get("select v from settings where k=?",[k]);
      return r ? r.v : def;
    },
    async setSetting(k, v){
      await run("insert into settings(k,v) values(?,?) on conflict(k) do update set v=excluded.v",[k,String(v)]);
    },
    async upsertUser(u){
      await run(`
        insert into users(id,telegram_id,username,last_name,first_name,phone,dob,package_remaining,role,updated_at)
        values(?,?,?,?,?,?,?,?,?,datetime('now'))
        on conflict(id) do update set
          telegram_id=excluded.telegram_id,
          username=excluded.username,
          last_name=excluded.last_name,
          first_name=excluded.first_name,
          phone=excluded.phone,
          dob=excluded.dob,
          package_remaining=excluded.package_remaining,
          role=excluded.role,
          updated_at=datetime('now')
      `,[u.id,u.telegram_id,u.username,u.last_name,u.first_name,u.phone,u.dob,u.package_remaining||0,u.role||"client"]);
    },
    async getUserByTelegramId(tid){
      return await get("select * from users where telegram_id=?",[tid]);
    },
    async getUserById(id){
      return await get("select * from users where id=?",[id]);
    },
    async listClients(){
      return await all("select * from users order by last_name asc, first_name asc");
    },
    async updateClient(id, patch){
      await run("update users set dob=?, package_remaining=?, updated_at=datetime('now') where id=?",[patch.dob, patch.package_remaining, id]);
    },
    async upsertScheduleDay(day, start, end, breaksJson){
      await run(`
        insert into schedule_days(day,start_time,end_time,breaks_json,updated_at)
        values(?,?,?,?,datetime('now'))
        on conflict(day) do update set
          start_time=excluded.start_time,
          end_time=excluded.end_time,
          breaks_json=excluded.breaks_json,
          updated_at=datetime('now')
      `,[day,start,end,breaksJson]);
    },
    async getScheduleDay(day){
      return await get("select * from schedule_days where day=?",[day]);
    },
    async createBooking(b){
      await run(`
        insert into bookings(id,user_id,telegram_id,last_name,first_name,phone,start_iso,end_iso,event_id,confirmed,status,used_package,updated_at)
        values(?,?,?,?,?,?,?,?,?,?,?,?,datetime('now'))
      `,[b.id,b.user_id,b.telegram_id,b.last_name,b.first_name,b.phone,b.start_iso,b.end_iso,b.event_id,b.confirmed?1:0,b.status||"active",b.used_package?1:0]);
    },
    async getBooking(id){
      return await get("select * from bookings where id=?",[id]);
    },
    async listUserBookings(telegram_id){
      return await all("select * from bookings where telegram_id=? and status='active' order by start_iso asc",[telegram_id]);
    },
    async listBookingsRange(fromIso,toIso){
      return await all("select * from bookings where status='active' and start_iso>=? and start_iso<=? order by start_iso asc",[fromIso,toIso]);
    },
    async setBookingConfirmed(id,val){
      await run("update bookings set confirmed=?, updated_at=datetime('now') where id=?",[val?1:0,id]);
    },
    async cancelBooking(id){
      await run("update bookings set status='cancelled', updated_at=datetime('now') where id=?",[id]);
    },
    async log(type, payload){
      await run("insert into logs(type,payload_json) values(?,?)",[type, JSON.stringify(payload||{})]);
    }
  };
}

async function initDb(){
  if (isPostgres()){
    return await initPostgres();
  }
  return await initSqlite();
}

module.exports = { initDb };