# Shield Antivirus — Android App

## Структура проекта
- **Kotlin + Jetpack Compose + Material3**
- **Min SDK:** 26 (Android 8.0+)
- **Target SDK:** 35 (Android 15)
- **VirusTotal API v3** для проверки файлов
- **Room** для истории сканирований
- **WorkManager** для фоновых задач
- **DataStore** для настроек

## Экраны
1. **Login / Register** — авторизация (локальная, без интернета)
2. **Home** — статус защиты, статистика, кнопки сканирования
3. **Scan** — анимация сканирования с прогрессом
4. **Results** — результаты с угрозами
5. **History** — история всех сканирований
6. **Settings** — API ключ, настройки защиты

## Как собрать
1. Открой папку в **Android Studio**
2. В `local.properties` укажи путь к SDK
3. `Build → Make Project` или `gradlew assembleDebug`

## VirusTotal API ключ
1. Зарегистрируйся на [virustotal.com](https://virustotal.com)
2. В приложении: **Settings → VirusTotal API → вставь ключ → Save**
3. Бесплатный план: 4 запроса/минуту, 500/день

## Фичи
- ✅ Сканирование установленных APK через VirusTotal SHA-256
- ✅ Быстрое / Полное / Выборочное сканирование  
- ✅ Фоновый сервис 24/7 (foreground service)
- ✅ Уведомления при обнаружении угроз
- ✅ Автозапуск после перезагрузки
- ✅ Мониторинг установки новых приложений
- ✅ История сканирований (Room DB)
- ✅ Логин/регистрация с хешированием паролей
