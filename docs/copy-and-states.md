# MoTrend UX Copywriting & State Transition Dictionary (Phase 1)

> **Статус**: Словарь текстов, состояний интерфейса и пользовательских сценариев.  
> **Принцип**: Человечный, кинематографичный и спокойный тон без технического жаргона и фальшивых обещаний.

---

## 1. Заголовки и позиционирование (Hero & Value Proposition)

| Идентификатор | Английский текст | Русский текст (для локализованных плашек) | Контекст использования |
| :--- | :--- | :--- | :--- |
| `hero.brand` | `MoTrend©` | `MoTrend©` | Логотип в шапке |
| `hero.tagline` | `Turn your photo into a viral video scene` | `Станьте главным героем вирусного видео` | Подзаголовок сервиса |
| `hero.casting_metaphor` | `Choose a scene. Upload one photo. Star in the trend.` | `Выберите сцену. Загрузите одно фото. Сыграйте главную роль.` | Продуктовое объяснение |

---

## 2. Руководство по фотографии (Photo Guidance)

| Идентификатор | Текст | Пояснение / Визуальный индикатор |
| :--- | :--- | :--- |
| `photo.picker_empty_title` | `Upload your photo` / `Загрузите ваше фото` | Заголовок пустой зоны загрузки |
| `photo.picker_empty_sub` | `Tap to browse or drag and drop` / `Нажмите для выбора или перетащите файл` | Подзаголовок зоны загрузки |
| `photo.rule_face` | `One clearly visible face` / `Одно четкое лицо анфас` | Зеленая галочка `✓` |
| `photo.rule_framing` | `Chest or waist-up framing` / `Ракурс по грудь или пояс` | Зеленая галочка `✓` |
| `photo.rule_clean` | `No sunglasses, masks, or group shots` / `Без очков, масок и лишних людей` | Серый крестик `×` |
| `photo.ready_badge` | `Photo ready` / `Фото готово` | Зеленый бейдж после выбора |
| `photo.replace_btn` | `Change photo` / `Заменить` | Кнопка быстрой смены фото |

---

## 3. Этапы генерации (Stage Tracker — вместо таймера)

| Этап / Статус бэкенда | Заголовок этапа | Описание этапа | Индикатор |
| :--- | :--- | :--- | :--- |
| **Этап 1: Загрузка** (`awaiting_upload` / `uploading`) | `Photo accepted` / `Фото принято` | `Face detected and optimized for high-res motion` | Зеленая галочка `✓` |
| **Этап 2: Очередь** (`queued`) | `Preparing your scene` / `Подготовка сцены` | `Matching lighting, angles, and cinematic color grade` | Мягкая пульсирующая мятная точка `◌` |
| **Этап 3: Рендеринг** (`processing`) | `Creating your video` / `Создание вашего видео` | `Synthesizing motion and expressions frame-by-frame` | Мягкая пульсирующая мятная точка `◌` |
| **Финальное спокойствие** (во время ожидания) | `Takes ~5–10 minutes. You can safely close this page.` | `Смело закрывайте страницу — видео создается в облаке и появится в вашем профиле.` | Иконка облака / защиты данных |

---

## 4. Ошибки и защитные сценарии (Humanized Error States)

| Ситуация | Было в старом UI (техническое) | Стало в новом дизайне (человеческое) | Первичное действие |
| :--- | :--- | :--- | :--- |
| **Недостаточно кредитов** | `You are short 10 credits` (alert) | `You need 10 more credits to cast this scene.` | Кнопка `Get credits` с открытием кошелька |
| **Сбой провайдера / тайм-аут** | `Temporary generation outage (credits refunded). Fix in progress.` | `Generation took longer than expected. Your 20 credits were fully refunded to your balance.` | Кнопка `Try another scene` / `Попробовать снова` |
| **Лицо не распознано / размыто** | `Photo validation failed (input_image_missing)` | `We couldn’t clearly detect a face. Please try a sharper, front-facing portrait.` | Кнопка `Choose another photo` |
| **Сбой связи / офлайн** | `NetworkError: Failed to fetch` | `Connection interrupted. Please check your internet and tap retry.` | Кнопка `Retry` |

---

## 5. Готовый результат и действия (Results & Retention)

| Идентификатор | Текст | Действие |
| :--- | :--- | :--- |
| `result.title` | `Your scene is ready!` / `Ваша сцена готова!` | Заголовок готового плеера |
| `result.btn_download` | `Save video` / `Скачать видео` | Прямое сохранение MP4 в галерею/загрузки |
| `result.btn_share` | `Share video` / `Поделиться` | Вызов системного меню «Поделиться» (iOS/Android) или копирование ссылки |
| `result.btn_new` | `Cast another scene` / `Создать еще видео` | Возврат в каталог с сохранением сессии |
| `result.retention` | `Downloads are kept safe in your profile for 7 days.` | Сноска о сроке хранения временных ссылок |
