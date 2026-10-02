# Простая установка на cPanel

Эта инструкция предназначена для человека без опыта программирования. Выполняйте
шаги по порядку. Не вводите пароли в этот документ и не отправляйте их по FTP.

## Перед началом

Заполнить нужно только эти значения:

- `<POSTGRES_USER>`
- `<URL_ENCODED_POSTGRES_PASSWORD>`
- `<POSTGRES_DATABASE>`
- `<CPANEL_USERNAME>`
- `<ADMIN_EMAIL>`
- `<ADMIN_PASSWORD>`
- `<CONTACT_DIGEST_SECRET>`: независимо сгенерированная секретная строка длиной
  не менее 32 символов

Пароль PostgreSQL в `DATABASE_URL` должен быть закодирован для URL. Например,
пробел нельзя оставлять как пробел.

## 8 шагов

1. **Создайте PostgreSQL в cPanel.**

   Откройте **PostgreSQL Databases** и создайте базу и пользователя. Подставьте
   их данные в строку `DATABASE_URL` ниже. Данные MySQL для базы `miracong_site`
   использовать нельзя. Сначала нужна PostgreSQL база в cPanel.

2. **Разместите релиз вне публичного каталога через cPanel File Manager/Terminal или SFTP с доступом к домашнему каталогу.**

   Загрузите содержимое в `/home/<CPANEL_USERNAME>/miracon-node-release/`.
   FTP-аккаунт, ограниченный `public_html`, не может безопасно выполнить этот
   этап: запросите доступ оператора; не заменяйте защищённое размещение загрузкой
   в публичный каталог.

3. **Создайте Node.js приложение в cPanel.**

   Откройте **Setup Node.js App**, нажмите **Create Application** и укажите:

   - **Node.js version:** любая предлагаемая cPanel версия `>=22.19.0`; `22.23.0`
     подходит, если она доступна
   - **Application mode:** `Production`
   - **Application root:** `miracon-node-release` вне `public_html` (полный путь `/home/<CPANEL_USERNAME>/miracon-node-release`)
   - **Application URL:** `miracon.gr` или `https://miracon.gr`, смотря какой формат требует поле
   - **Startup file:** `app.js`

4. **Добавьте переменные среды приложения.**

   В разделе **Environment variables** добавьте эти пары без изменений, заменив
   только значения в угловых скобках:

   ```dotenv
   DATABASE_URL=postgresql://<POSTGRES_USER>:<URL_ENCODED_POSTGRES_PASSWORD>@localhost:5432/<POSTGRES_DATABASE>
   MEDIA_ROOT=/home/<CPANEL_USERNAME>/miracon-media
   PUBLIC_SITE_URL=https://miracon.gr
   CONTACT_DIGEST_SECRET=<CONTACT_DIGEST_SECRET>
   CONTACT_SMTP_ENABLED=false
   ```

   `CONTACT_DIGEST_SECRET` и SMTP-пароль храните только в защищённой серверной
   конфигурации вне релиза и `public_html`; для публичной `.htaccess` задайте текущие
   значения в защищённом окружении, проверьте приоритет переменных, удалите
   лишь публичные строки с секретами (сохраняя Passenger), проверьте форму,
   затем смените оба секрета в защищённом окружении и проверьте ещё раз.
   Уведомления SMTP отключены по умолчанию. При их включении задайте полный
   серверный набор `CONTACT_SMTP_ENABLED=true`, `CONTACT_SMTP_HOST`,
   `CONTACT_SMTP_PORT`, `CONTACT_SMTP_USER`, `CONTACT_SMTP_PASSWORD`,
   `CONTACT_SMTP_FROM`, `CONTACT_SMTP_TO`; для автоответа дополнительно
   `CONTACT_AUTOREPLY_ENABLED=true` после теста EN/EL на своём ящике.
   Для SMTP допустим только порт 465 с TLS или 587 с обязательным STARTTLS.
   Миграция `0020_contact_mail_outbox.sql` и защищённый минутный Cron
   `node scripts/contact-mail-drain.mjs --apply` обязательны для доставки
   почты; Cron должен получать отдельное безопасное окружение. Подробности
   в `README.md` и `docs/production-release-runbook.md`.

5. **Установите зависимости, примените таблицы и создайте администратора.**

   На странице созданного Node.js приложения скопируйте показанную cPanel
   команду **Enter to the virtual environment**. Откройте **Terminal**, сначала
   выполните эту команду, а затем выполните команды ниже. Так `DATABASE_URL` и
   остальные переменные будут доступны скриптам.

   ```bash
   <КОМАНДА_ENTER_TO_VIRTUAL_ENVIRONMENT_ИЗ_CPANEL>
   cd /home/<CPANEL_USERNAME>/miracon-node-release
   npm ci --omit=dev
   npm run postgres:migrate
   printf '%s' '<ADMIN_PASSWORD>' | node scripts/provision-admin.mjs --email=<ADMIN_EMAIL> --password-stdin
   ```

   Первую команду не придумывайте: скопируйте ее со страницы Node.js приложения
   в cPanel. В последней команде замените только `<ADMIN_PASSWORD>` и
   `<ADMIN_EMAIL>`.
   Такой вариант безопаснее, чем передавать пароль как обычный аргумент команды.

6. **Создайте каталог для медиафайлов и разрешите приложению записывать в него.**

   Создайте `/home/<CPANEL_USERNAME>/miracon-media` в **File Manager** cPanel.
   Владелец приложения должен иметь право записи в этот каталог. Не создавайте
   каталог внутри `public_html`.

7. **Перезапустите Node.js приложение и проверьте его.**

   Нажмите **Restart Application** в cPanel, затем откройте
   `https://miracon.gr/api/health`. Успешный ответ должен содержать
   `ok`, `database: true` и `media: true`.

8. **Войдите в админ-панель и импортируйте проекты только при пустом списке.**

   Откройте `https://miracon.gr/admin`, войдите с `<ADMIN_EMAIL>` и
   `<ADMIN_PASSWORD>`. Если список проектов пуст, нажмите **Import current
   website projects**. Если проекты уже есть, эту кнопку не нажимайте.

