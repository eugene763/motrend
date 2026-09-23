# MoTrend Component Specification (Phase 1)

> **Статус**: Спецификация компонентной модели для веб-интерфейса и будущего переноса в Flutter.  
> **Дизайн-система**: Токены `design/tokens.json`, стили `public/styles/tokens.css`.

---

## 1. AppShell
- **Назначение**: Корневой адаптивный контейнер приложения.
- **HTML структура**:
  ```html
  <div class="mo-app-shell">
    <header class="mo-header">
      <div class="mo-header-inner mo-container-wide">
        <a href="/" class="mo-brand">MoTrend<span class="mo-brand-mark">©</span></a>
        <div class="mo-header-actions">
          <div id="creditPillMount"></div>
          <button id="btnHeaderAuth" class="mo-btn mo-btn-secondary mo-btn-sm">Войти</button>
        </div>
      </div>
    </header>
    <main class="mo-main">
      <div class="mo-container">
        <!-- Активный контекст генерации / кастинга -->
      </div>
    </main>
    <footer class="mo-footer">
      <!-- Копирайт, правовые ссылки -->
    </footer>
  </div>
  ```
- **Flutter эквивалент**: `Scaffold` со `SliverAppBar`, `SafeArea` и адаптивным `ConstrainedBox(maxWidth: 580)`.

---

## 2. TrendCard & TrendPreview
- **Назначение**: Карточка сцены в ленте кастинга с автовоспроизведением 9:16 и обработкой автоплея.
- **HTML структура**:
  ```html
  <article class="mo-trend-card" data-template-id="yung_lean_storm2">
    <div class="mo-trend-media">
      <video class="mo-trend-video" playsinline muted loop autoplay preload="metadata" poster="..."></video>
      <div class="mo-play-fallback" aria-hidden="true">
        <svg class="mo-icon-play" viewBox="0 0 24 24"><polygon points="6,4 20,12 6,20"></polygon></svg>
      </div>
      <div class="mo-media-badges">
        <span class="mo-badge mo-badge-new">NEW</span>
        <span class="mo-badge">10s</span>
      </div>
      <div class="mo-media-cost">
        <span class="mo-cost-pill">20 кредитов</span>
      </div>
    </div>
    <div class="mo-trend-info">
      <h3 class="mo-type-title-md">Yung Lean Storm II</h3>
      <p class="mo-type-body-sm">Неоновый ураган · Face swap</p>
    </div>
    <button class="mo-btn mo-btn-secondary mo-btn-block mo-btn-select">Выбрать сцену</button>
  </article>
  ```
- **Поведение автоплея на iOS Safari**:
  - Если браузер (например, в Low Power Mode) отклоняет `video.play()`, ловится `.catch()`:
  - На контейнере выставляется класс `.is-autoplay-blocked`.
  - По центру плавно проявляется `.mo-play-fallback` (полупрозрачный круг с иконкой Play и размытием фона).
  - При первом клике/тапе пользователя видео запускается, а значок Play исчезает.

---

## 3. PhotoPicker & PhotoGuidance
- **Назначение**: Кинематографичная зона выбора и превью единственного фото.
- **HTML структура**:
  ```html
  <section class="mo-photo-section">
    <div class="mo-photo-picker" id="photoDropZone">
      <input type="file" id="filePhoto" accept="image/*" class="mo-visually-hidden"/>
      
      <!-- Состояние до выбора -->
      <div class="mo-picker-empty" id="photoEmptyState">
        <div class="mo-picker-icon-circle">
          <svg class="mo-icon" viewBox="0 0 24 24"><path d="..."></path></svg>
        </div>
        <div class="mo-type-title-md">Загрузите ваше фото</div>
        <div class="mo-type-body-sm">Нажмите или перетащите файл сюда</div>
      </div>

      <!-- Состояние после выбора фото -->
      <div class="mo-picker-preview" id="photoPreviewState" style="display:none;">
        <img id="photoPreviewImg" alt="Превью выбранного лица" class="mo-face-thumb"/>
        <div class="mo-picker-meta">
          <div id="photoFileName" class="mo-type-body-md mo-truncate">photo.jpg</div>
          <div id="photoFileSize" class="mo-type-body-sm">1.8 MB · оптимизировано</div>
        </div>
        <button type="button" id="btnChangePhoto" class="mo-btn mo-btn-ghost mo-btn-sm">Заменить</button>
      </div>
    </div>

    <!-- Встроенное контекстное обучение (PhotoGuidance) -->
    <div class="mo-photo-guidance">
      <div class="mo-guidance-item">
        <span class="mo-guidance-check">✓</span> Четкое лицо анфас
      </div>
      <div class="mo-guidance-item">
        <span class="mo-guidance-check">✓</span> По грудь или по пояс
      </div>
      <div class="mo-guidance-item">
        <span class="mo-guidance-cross">×</span> Без очков и масок
      </div>
    </div>
  </section>
  ```
- **Клиентская обработка**: Файл мгновенно читается в `ImageBitmap` / `HTMLImageElement`, валидируется и отрисовывается в миниатюру через `URL.createObjectURL`. Пользователь видит свое лицо до нажатия кнопки создания.

---

## 4. GenerationStatus (Stage Tracker вместо таймера)
- **Назначение**: Отображение прогресса генерации через 3 смысловых этапа без фейковых процентов.
- **HTML структура**:
  ```html
  <div class="mo-stage-tracker" role="status" aria-live="polite">
    <div class="mo-stage-item is-done" data-stage="upload">
      <div class="mo-stage-marker">
        <svg class="mo-icon-check" viewBox="0 0 24 24"><polyline points="20 6 9 17 4 12"></polyline></svg>
      </div>
      <div class="mo-stage-content">
        <div class="mo-stage-title">Фото принято</div>
        <div class="mo-stage-desc">Лицо успешно распознано и оптимизировано</div>
      </div>
    </div>

    <div class="mo-stage-item is-active" data-stage="prepare">
      <div class="mo-stage-marker">
        <span class="mo-pulse-dot"></span>
      </div>
      <div class="mo-stage-content">
        <div class="mo-stage-title">Подготовка сцены</div>
        <div class="mo-stage-desc">Синхронизируем освещение и ракурс видео</div>
      </div>
    </div>

    <div class="mo-stage-item is-waiting" data-stage="render">
      <div class="mo-stage-marker">
        <span class="mo-idle-dot"></span>
      </div>
      <div class="mo-stage-content">
        <div class="mo-stage-title">Создание вашего видео</div>
        <div class="mo-stage-desc">Генерация финального ролика в высоком качестве</div>
      </div>
    </div>

    <div class="mo-reassurance-note">
      <svg class="mo-icon-cloud" viewBox="0 0 24 24"><path d="..."></path></svg>
      <span>Обычно занимает 5–10 минут. Вы можете закрыть страницу — результат сохранится в профиле.</span>
    </div>
  </div>
  ```

---

## 5. ResultPlayer & ResultActions
- **Назначение**: Презентация готового ролика.
- **HTML структура**:
  ```html
  <div class="mo-result-card">
    <div class="mo-result-media">
      <video class="mo-result-video" controls playsinline loop src="..."></video>
    </div>
    <div class="mo-result-actions">
      <a href="..." class="mo-btn mo-btn-primary mo-btn-block">Скачать видео</a>
      <button class="mo-btn mo-btn-secondary" id="btnShare">Поделиться</button>
      <button class="mo-btn mo-btn-ghost" id="btnNewCast">Создать еще одно видео</button>
    </div>
    <div class="mo-retention-hint">
      Ссылка для скачивания активна 7 дней. Видео защищено и доступно в вашем аккаунте.
    </div>
  </div>
  ```

---

## 6. CreditPill & CreditConfirmation
- **Назначение**: Прозрачный баланс и подтверждение списания перед стартом.
- **Интеграция**:
  - `CreditPill` в шапке показывает реальный баланс (`🪙 45 кредитов`).
  - `CreditConfirmation` внутри кнопки генерации:  
    `"Создать видео · 20 кредитов"`  
    Если кредитов не хватает (например, есть 10 из 20):  
    `"Пополнить баланс · не хватает 10 кредитов"` -> открывает кошелек с фокусом на недостающую сумму.
