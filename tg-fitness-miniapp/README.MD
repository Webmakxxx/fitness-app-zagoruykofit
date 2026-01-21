# TG Fitness Mini App (Trainer + Clients) — GitHub + Node + Apps Script(Calendar)

## 1) Что где работает
- app/ — Mini App (статический фронт) -> GitHub Pages
- server/ — Node.js (бот + API + cron уведомления) -> Render/Railway/VPS
- apps-script/ — Google Apps Script Web App -> команды к Google Calendar

## 2) BotFather
1) /setdomain -> укажите домен GitHub Pages (например: yourname.github.io)
2) /setmenubutton -> укажите WEBAPP_URL (полный URL на app/)
   Telegram Mini Apps docs описывает /setmenubutton (menu button).  

## 3) Google Apps Script (Calendar gateway)
1) Создайте проект Apps Script
2) Вставьте apps-script/Code.gs
3) Script Properties:
   - APPS_SCRIPT_SECRET = любой длинный секрет
4) Deploy -> Web App:
   - Execute as: Me
   - Who has access: Anyone
5) Получите URL вида .../exec и вставьте в env APPS_SCRIPT_URL

## 4) Google Calendar
- Создайте/выберите календарь тренера
- CALENDAR_ID возьмите из настроек календаря

## 5) Node server — переменные окружения
BOT_TOKEN=...
TRAINER_TELEGRAM_ID=123456789
TRAINER_USERNAME=@yourtrainer
WEBAPP_URL=https://yourname.github.io/yourrepo/app/
CALENDAR_ID=...
APPS_SCRIPT_URL=https://script.google.com/macros/s/.../exec
APPS_SCRIPT_SECRET=...

Опционально:
DATABASE_URL=postgres://... (если хотите Postgres)
PGSSL=true (если хост требует SSL)
SQLITE_PATH=./data.sqlite (если SQLite)

## 6) Локальный запуск
cd server
npm i
npm start

## 7) Webhook
Поставьте webhook на:
https://<your-server>/bot/webhook

Можно через curl:
curl -X POST "https://api.telegram.org/bot<BOT_TOKEN>/setWebhook" \
  -d "url=https://<your-server>/bot/webhook"

## 8) GitHub Pages
Repo Settings -> Pages:
- Source: Deploy from branch
- Branch: main
- Folder: /app

WEBAPP_URL должен указывать на папку app/ в Pages.

## 9) Деплой на Render (пример)
- Create Web Service -> connect GitHub repo
- Root directory: server
- Build: npm install
- Start: npm start
- Add env vars (как выше)
- Получите URL и поставьте webhook на /bot/webhook