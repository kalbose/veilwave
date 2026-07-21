# RuSamaraWave (Android)

Офлайн-приложение для голосовых заметок в формате **`.rswk`** (RSWK: Argon2id + XChaCha20-Poly1305).

## Сборка

```powershell
cd phone
npm install
npm run build:rsw
npm run test:rsw
npx cap sync android

$env:JAVA_HOME = "C:\Program Files\Android\Android Studio\jbr"
$env:ANDROID_HOME = "$env:LOCALAPPDATA\Android\Sdk"
cd android
.\gradlew.bat assembleRelease bundleRelease
```

Артефакты:
- `android/app/build/outputs/apk/release/app-release.apk`
- `android/app/build/outputs/bundle/release/app-release.aab`

Материалы RuStore: папка [`store/`](store/).

## Подпись

`android/app/keystore.properties` + `android/app/keystore/rusamarawave.jks`  
**Не публикуйте пароли keystore.** Для продакшена смените пароли.

## Сохранение файлов

`Загрузки/RuSamaraWave/*.rswk` и `*.wav`
