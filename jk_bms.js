(function () {
  "use strict";

  if (window.__JK_BMS_NATIVE_UI__) return;
  window.__JK_BMS_NATIVE_UI__ = true;

  const UI_VERSION = "2026.09.08-v5";

  /* ============================================================
     I18N — plain-object dictionary, zero external dependencies (per the
     directive: no i18next/FormatJS/CDN locale files, two languages don't
     need one). Language is a PRESENTATION concern only: internal
     identifiers (entity keys, wire ids, Modbus register names, storage
     keys) are never translated and never derived from a translated
     string — that stays true throughout this file, deliberately, so a
     future refactor can't accidentally start using a translated label as
     a lookup key.
     ============================================================ */
  const I18N = {
    en: {
      nav: { overview: "Overview", cells: "Cells", electrical: "Electrical", health: "Health", configuration: "Configuration", diagnostics: "Diagnostics" },
      common: {
        on: "On", off: "Off", unknown: "Unknown", sending: "Sending…", confirmQuestion: "Confirm?",
        notAvailable: "Not available", normal: "Normal", allSystemsNormal: "All systems normal",
        tapForTrend: "Tap a reading for its trend", tapForDetail: "Tap for detail", elapsed: "Elapsed",
        save: "Save", cancel: "Cancel", close: "Close", noChangedValues: "No changed values",
        durationHour: "h", durationMinute: "m", durationSecond: "s"
      },
      freshness: {
        live: "Live", delayed: "Delayed", stale: "Stale", offline: "Offline", reconnecting: "Reconnecting",
        connected: "Connected", connecting: "Connecting…", disconnected: "Disconnected",
        agoSuffix: " · {age}s ago",
        bmsOfflineAgo: "BMS offline{ago} — showing last known values",
        bmsStaleAgo: "BMS communication stale{ago} — showing last known values",
        reconnectingMsg: "Reconnecting to device…",
        browserDisconnected: "Browser disconnected from device — reconnecting…"
      },
      topology: {
        titleLoading: "Battery topology not confirmed yet",
        titlePending: "Confirming cell count change…",
        titleMismatch: "Battery topology not confirmed",
        titleInvalid: "Battery topology not confirmed",
        titleOffline: "Battery topology unknown — BMS offline",
        titleWriteUncertain: "Cell count change unconfirmed — verifying with the BMS",
        configured: "Configured", connected: "Connected", measured: "Detected", rawVoltage: "BMS pack voltage", activeSum: "Active cell sum",
        cells_one: "{count} cell", cells_other: "{count} cells",
        blockedRewrite: "Resolve the current topology mismatch before changing cell count again.",
        confirmRewrite: "Topology is still unconfirmed — change cell count anyway?",
        reason: {
          OK: "Nominal.",
          AWAITING_SNAPSHOT: "Waiting for a full, consistent reading from the BMS.",
          COUNT_OUT_OF_RANGE: "Configuration error: the BMS reported a cell count outside the 1–32 range.",
          NO_CONNECTED_CELLS: "The BMS reports no connected cell channels.",
          NO_VALID_VOLTAGE: "No cell channel is reporting a plausible voltage.",
          MASK_COUNT_DIFFERS: "The connected-cell count does not match the configured cell count.",
          VOLTAGE_COUNT_DIFFERS: "The number of cells with a plausible voltage does not match the configured cell count.",
          ACTIVE_RANGE_GAP: "A cell inside the configured range is missing a plausible voltage reading.",
          VOLTAGE_SUM_DIFFERS: "The BMS pack voltage does not match the sum of the active cells' voltages.",
          MASK_NOT_CONTIGUOUS: "The connected-cell mask has the right count but the wrong channels — a gap or an extra high channel.",
          BMS_OFFLINE: "Communication with the BMS has been lost — the last known topology cannot be trusted.",
          WRITE_IN_PROGRESS: "A cell count change is being written and verified.",
          WRITE_UNCERTAIN: "The BMS did not confirm the cell count change — it may or may not have been applied. Re-verifying automatically."
        }
      },
      stage: { bulk: "Bulk", absorption: "Absorption", float: "Float", idle: "Idle", charging: "Charging", discharging: "Discharging", offline: "Offline", unknown: "Unknown", lockout: "Locked out" },
      soc: { label: "State of charge" },
      hero: {
        remaining: "Remaining", lifetimeDelivered: "Lifetime delivered",
        ofCapacity: "of {nominal} {unit}",
        cycle_one: "{count} cycle", cycle_other: "{count} cycles"
      },
      power: { charge: "Charge", discharge: "Discharge", balance: "Balance" },
      telemetry: { voltage: "Voltage", current: "Current", power: "Power", balance: "Balance", mosfet: "MOSFET", derivedTooltip: "Computed from voltage × current — not an independent measurement" },
      health: {
        cells: "Cells", thermal: "Thermal", protection: "Protection",
        cell_one: "Δ across {count} cell", cell_other: "Δ across {count} cells", noCellData: "No cell data",
        probe_one: "Max of {count} probe", probe_other: "Max of {count} probes", noProbeData: "No probe data",
        alert: "Alert", noActiveAlarms: "No active alarms"
      },
      cells: {
        title: "Cells", subtitle: "{count}S pack · voltage & wire resistance",
        trend: "Trend", voltage: "Voltage", wireR: "Wire R",
        average: "Average", delta: "Delta", min: "Min", max: "Max", balancing: "Balancing",
        cellHistoryAria: "Cell {n} history", cellLabel: "Cell {n}",
        // Explicit, distinct from a plain "--" (which means "not fresh
        // yet") -- shown for wire resistance on channels 17-32
        // specifically, where no register is polled at all (a structural
        // gap, not a staleness one) — user-directed rework, 2026-09-17.
        resistanceUnsupported: "Not read"
      },
      electrical: {
        title: "Electrical", stateOfHealth: "State of health",
        chargeCycle: "Charge cycle", chargeCycleCaption: "Pack voltage · 60h history",
        chargeCycleMeta: "60h history · 1 min/sample · 6h window",
        chartAria: "Charge cycle timeline. Drag, swipe, use Left/Right arrow keys, or scroll horizontally to pan through the pack's history.",
        stage: "Stage", now: "Now", target: "Target", timer: "Timer",
        noSamplesWindow: "No samples logged yet for this window.",
        cc: {
          now: "Now", liveStatus: "Current status", fullOffline: "No connection",
          shortIdle: "Idle", shortCharge: "Charge", shortAbs: "Abs.", shortFloat: "Float", shortDischarge: "Discharge", shortOffline: "Offline",
          zoomIn: "Zoom in (shorter time range)", zoomOut: "Zoom out (longer time range)",
          hoursShort_one: "{count}h", hoursShort_other: "{count}h",
          metaWindow_one: "{count}h history · {window}h window", metaWindow_other: "{count}h history · {window}h window",
          agoShort_one: "{count}h ago", agoShort_other: "{count}h ago"
        }
      },
      thermal: {
        title: "Thermal", maxProbe: "Max probe", minProbe: "Min probe",
        footnote: "This BMS reports T1, T2, T4 and T5 (T3 is not present on the Modbus map). No configurable thermal protection threshold is exposed, so no status word is shown beyond the measured values.",
        protectionTitle: "Protection & lockouts", noActiveAlarms: "No active alarms",
        allMonitoredNormal: "All monitored protections are normal", emergencyLockout: "Emergency lockout"
      },
      configuration: {
        title: "Configuration", caption: "BMS registers", save: "OK",
        registers: "BMS registers", readOnly: "Read only", registerUnavailable: "Not reported",
        setupPasscode: "Setup passcode",
        blockedNote: "Other pack parameters — OVP/UVP, charge/discharge current limits, balance start voltage, balance delta, calibration — are not exposed as writable Modbus registers in this configuration and are not shown here.",
        sentUnverified: "Sent — device does not expose read-back confirmation.",
        fields: {
          heatingActivation: "Heating activation", heatingDeactivation: "Heating deactivation",
          dryContact1Source: "Dry contact 1 source", dryContact2Source: "Dry contact 2 source",
          dryContact1Trigger: "Dry contact 1 trigger value", dryContact1Recovery: "Dry contact 1 recovery value",
          dryContact2Trigger: "Dry contact 2 trigger value", dryContact2Recovery: "Dry contact 2 recovery value"
        }
      },
      writeRegistry: {
        title: "Register write registry (Stage 4)",
        caption: "Production write endpoint — status per field",
        live: "Ready to write", authorizationRequired: "Authorization required", blocked: "Blocked",
        preflight: "Preflight", write: "Write", checking: "Checking…",
        confirmPrompt: "Write {key}\n\nCurrent raw: {currentRaw}\nProposed value: {value}\nMerged raw after write: {mergedRaw}\nOther bits in this register (unaffected): {siblingBits}\n\nProceed with this write?",
        preflightFailed: "Preflight failed: {reason}",
        notReady: "Not ready to write yet — run preflight first.",
        authorizationRequiredNote: "Write path exists but is not yet authorized for live use (safety class: {cls}). Server also rejects this even if attempted.",
        blockedNote: "{reason}",
      },
      diagnostics: {
        title: "Diagnostics", bmsCommunication: "BMS communication", lastBmsUpdate: "Last BMS update",
        browserConnection: "Browser connection", firmware: "Firmware", uiBuild: "UI build",
        wifiSignal: "Wi-Fi signal", ipAddress: "IP address", uptime: "Uptime",
        lastCommand: "Last command", command: "Command", outcome: "Outcome", at: "At",
        writeOutcomes: "Write outcomes since load", confirmed: "Confirmed", mismatch: "Mismatch", timeout: "Timeout", error: "Error",
        sentUnverified: "Sent (unverified)",
        readEntities: "BMS parameter values", readEntitiesCaption: "Values received from ESPHome",
        readEntityId: "Entity", readEntityType: "Type", readEntityValue: "Value",
        readEntityCount: "{received} received",
        resolver: {
          title: "Battery state resolver", floatBit: "Float bit", chargeMos: "Charge MOS", dischargeMos: "Discharge MOS",
          direction: "Current direction", candidate: "Candidate", candidateSamples: "Candidate fresh samples",
          sampleAge: "Current sample age", unknownReason: "Unknown reason",
          lastKnownState: "Last known state", lastKnownPhase: "Last known phase",
          idleNoiseMin: "Idle noise min", idleNoiseMax: "Idle noise max",
          dirNeutral: "Neutral", dirCharge: "Charge", dirDischarge: "Discharge",
          reasonNA: "N/A", reasonNoTelemetry: "No telemetry since boot", reasonPostReconnect: "Awaiting fresh sample (reconnect)"
        },
        soh: {
          title: "Battery health source", source: "SOH source", sourceProtocol: "Protocol (native register)",
          sourceUnavailable: "Unavailable", register: "Register", ratedCapacity: "Rated capacity",
          learnedCapacity: "BMS learned capacity", chargeCycles: "Charge cycles"
        }
      },
      settings: {
        title: "Settings", deviceName: "Device name", deviceNamePlaceholder: "Pack name", saveName: "Save name",
        appearance: "Appearance", light: "Light", dark: "Dark", auto: "Auto",
        language: "Language", interface: "Interface"
      },
      trendModal: {
        illustrative: "Illustrative · not measured", min: "Min", avg: "Avg", max: "Max",
        illustrativeTrend: "Illustrative trend", now: "now",
        lastMinutes_one: "Last {count} minute", lastMinutes_other: "Last {count} minutes",
        metrics: {
          voltage: "Total voltage", current: "Current", power: "Power", balance: "Balance current",
          mosfet: "MOSFET temperature", t1: "Temperature 1", t2: "Temperature 2", t4: "Temperature 4", t5: "Temperature 5",
          avgVoltage: "Average cell voltage", deltaVoltage: "Cell voltage delta",
          avgResistance: "Average wire resistance", deltaResistance: "Wire resistance delta"
        }
      },
      tx: {
        confirmed: "Confirmed", notConfirmed: "Requested {value} — {detail}. Not confirmed.",
        noConfirmation: "No confirmation from BMS", requestFailed: "Request failed", requestTimedOut: "Request timed out",
        rejectedBusy: "Rejected — another write to this register is already in progress",
        enabling: "Enabling {label}…", disabling: "Disabling {label}…", saving: "Saving…", saved: "Saved",
        anotherInProgress: "Another write is already in progress for this field", sending: "Sending…",
        describeReports: "BMS reports {value}", describeNoValue: "no value reported",
        uncertainRecovering: "No ACK/readback yet — verifying the actual value…",
        recoveredAfterUncertainty: "(confirmed after a recovery check)",
        recoveredMismatchAfterUncertainty: "The write did not take effect (confirmed by a recovery check)."
      },
      deviceName: {
        tooLong: "Keep it under 32 characters.", saved: "Name saved.", reverted: "Reverted to the default name.",
        timedOut: "Request timed out.", saveFailed: "Save failed."
      }
    },
    uk: {
      nav: { overview: "Огляд", cells: "Комірки", electrical: "Електрика", health: "Стан", configuration: "Налаштування", diagnostics: "Діагностика" },
      common: {
        on: "Увімк", off: "Вимк", unknown: "Невідомо", sending: "Надсилання…", confirmQuestion: "Підтвердити?",
        notAvailable: "Недоступно", normal: "Норма", allSystemsNormal: "Усе працює нормально",
        tapForTrend: "Торкніться, щоб побачити графік", tapForDetail: "Торкніться для деталей", elapsed: "Минуло",
        save: "Зберегти", cancel: "Скасувати", close: "Закрити", noChangedValues: "Немає змінених значень",
        durationHour: "г", durationMinute: "хв", durationSecond: "с"
      },
      freshness: {
        live: "Наживо", delayed: "Затримка", stale: "Застаріло", offline: "Офлайн", reconnecting: "Перепідключення",
        connected: "З'єднано", connecting: "Підключення…", disconnected: "Роз'єднано",
        agoSuffix: " · {age} с тому",
        bmsOfflineAgo: "BMS офлайн{ago} — показані останні відомі значення",
        bmsStaleAgo: "Зв'язок із BMS застарів{ago} — показані останні відомі значення",
        reconnectingMsg: "Перепідключення до пристрою…",
        browserDisconnected: "Браузер втратив з'єднання з пристроєм — перепідключення…"
      },
      topology: {
        titleLoading: "Топологія батареї ще не підтверджена",
        titlePending: "Підтвердження зміни кількості комірок…",
        titleMismatch: "Топологія батареї не підтверджена",
        titleInvalid: "Топологія батареї не підтверджена",
        titleOffline: "Топологія батареї невідома — BMS офлайн",
        titleWriteUncertain: "Зміну кількості комірок не підтверджено — перевіряємо BMS",
        configured: "Налаштовано", connected: "Підключено", measured: "Виявлено", rawVoltage: "Напруга BMS", activeSum: "Сума активних комірок",
        cells_one: "{count} комірка", cells_few: "{count} комірки", cells_many: "{count} комірок", cells_other: "{count} комірок",
        blockedRewrite: "Спершу вирішіть поточну невідповідність топології, перш ніж знову змінювати кількість комірок.",
        confirmRewrite: "Топологія ще не підтверджена — усе одно змінити кількість комірок?",
        reason: {
          OK: "Норма.",
          AWAITING_SNAPSHOT: "Очікування повного узгодженого знімку даних від BMS.",
          COUNT_OUT_OF_RANGE: "Помилка конфігурації: BMS повідомила кількість комірок поза діапазоном 1–32.",
          NO_CONNECTED_CELLS: "BMS не повідомляє про жодного підключеного каналу комірки.",
          NO_VALID_VOLTAGE: "Жоден канал комірки не повідомляє правдоподібну напругу.",
          MASK_COUNT_DIFFERS: "Кількість підключених комірок не збігається з налаштованою кількістю.",
          VOLTAGE_COUNT_DIFFERS: "Кількість комірок із правдоподібною напругою не збігається з налаштованою кількістю.",
          ACTIVE_RANGE_GAP: "У межах налаштованого діапазону є комірка без правдоподібної напруги.",
          VOLTAGE_SUM_DIFFERS: "Напруга батареї від BMS не збігається із сумою напруг активних комірок.",
          MASK_NOT_CONTIGUOUS: "Маска підключених комірок має правильну кількість бітів, але не ті канали — є пропуск або зайвий старший канал.",
          BMS_OFFLINE: "Втрачено зв'язок із BMS — останній відомій топології не можна довіряти.",
          WRITE_IN_PROGRESS: "Зміна кількості комірок записується й перевіряється.",
          WRITE_UNCERTAIN: "BMS не підтвердила зміну кількості комірок — вона могла або не могла застосуватись. Автоматична повторна перевірка."
        }
      },
      stage: { bulk: "Основний", absorption: "Абсорбція", float: "Підтримка", idle: "Очікування", charging: "Заряд", discharging: "Розряд", offline: "Офлайн", unknown: "Невідомо", lockout: "Заблоковано" },
      soc: { label: "Рівень заряду" },
      hero: {
        remaining: "Залишок", lifetimeDelivered: "Усього віддано",
        ofCapacity: "з {nominal} {unit}",
        cycle_one: "{count} цикл", cycle_few: "{count} цикли", cycle_many: "{count} циклів", cycle_other: "{count} циклу"
      },
      power: { charge: "Заряд", discharge: "Розряд", balance: "Балансування" },
      telemetry: { voltage: "Напруга", current: "Струм", power: "Потужність", balance: "Баланс", mosfet: "MOSFET", derivedTooltip: "Розраховано з напруги × струму — не окреме вимірювання" },
      health: {
        cells: "Комірки", thermal: "Термо", protection: "Захист",
        cell_one: "Δ між {count} коміркою", cell_few: "Δ між {count} комірками", cell_many: "Δ між {count} комірками", cell_other: "Δ між {count} комірками",
        noCellData: "Немає даних про комірки",
        probe_one: "Макс. з {count} датчика", probe_few: "Макс. з {count} датчиків", probe_many: "Макс. з {count} датчиків", probe_other: "Макс. з {count} датчиків",
        noProbeData: "Немає даних датчиків",
        alert: "Тривога", noActiveAlarms: "Активних тривог немає"
      },
      cells: {
        title: "Комірки", subtitle: "Батарея {count}S · напруга та опір",
        trend: "Графік", voltage: "Напруга", wireR: "Опір",
        average: "Середнє", delta: "Різниця", min: "Мін", max: "Макс", balancing: "Балансування",
        cellHistoryAria: "Історія комірки {n}", cellLabel: "Комірка {n}",
        resistanceUnsupported: "Не зчитується"
      },
      electrical: {
        title: "Електрика", stateOfHealth: "Стан здоров'я батареї",
        chargeCycle: "Цикл заряду", chargeCycleCaption: "Напруга батареї · історія за 60 год",
        chargeCycleMeta: "Історія 60 год · 1 хв/семпл · вікно 6 год",
        chartAria: "Хронологія циклу заряду. Перетягніть, проведіть пальцем, скористайтесь стрілками ← → або горизонтальним скролом для перегляду історії.",
        stage: "Стадія", now: "Зараз", target: "Ціль", timer: "Таймер",
        noSamplesWindow: "Для цього вікна ще немає записаних даних.",
        cc: {
          now: "Зараз", liveStatus: "Поточний стан", fullOffline: "Немає зв'язку",
          shortIdle: "Очікування", shortCharge: "Заряд", shortAbs: "Абсорб.", shortFloat: "Підтримка", shortDischarge: "Розряд", shortOffline: "Офлайн",
          zoomIn: "Наблизити (коротший період)", zoomOut: "Віддалити (довший період)",
          hoursShort_one: "{count} год", hoursShort_few: "{count} год", hoursShort_many: "{count} год",
          metaWindow_one: "{count} год історії · вікно {window} год", metaWindow_few: "{count} год історії · вікно {window} год", metaWindow_many: "{count} год історії · вікно {window} год",
          agoShort_one: "{count} год тому", agoShort_few: "{count} год тому", agoShort_many: "{count} год тому"
        }
      },
      thermal: {
        title: "Термо", maxProbe: "Макс. датчик", minProbe: "Мін. датчик",
        footnote: "Ця BMS повідомляє T1, T2, T4 і T5 (T3 відсутній у карті Modbus). Налаштовуваний поріг термозахисту не доступний, тому статусне слово понад виміряні значення не показується.",
        protectionTitle: "Захист і блокування", noActiveAlarms: "Активних тривог немає",
        allMonitoredNormal: "Усі контрольовані захисти в нормі", emergencyLockout: "Аварійне блокування"
      },
      configuration: {
        title: "Налаштування", caption: "Регістри BMS", save: "ОК",
        registers: "Регістри BMS", readOnly: "Тільки читання", registerUnavailable: "Не отримано",
        setupPasscode: "Пароль налаштувань",
        blockedNote: "Інші параметри батареї — OVP/UVP, обмеження струму заряду/розряду, напруга старту балансування, дельта балансування, калібрування — не доступні для запису через Modbus у цій конфігурації й тому не показані.",
        sentUnverified: "Надіслано — пристрій не підтверджує зчитуванням це значення.",
        fields: {
          heatingActivation: "Увімкнення підігріву", heatingDeactivation: "Вимкнення підігріву",
          dryContact1Source: "Джерело сухого контакту 1", dryContact2Source: "Джерело сухого контакту 2",
          dryContact1Trigger: "Поріг спрацювання · сухий контакт 1", dryContact1Recovery: "Поріг відновлення · сухий контакт 1",
          dryContact2Trigger: "Поріг спрацювання · сухий контакт 2", dryContact2Recovery: "Поріг відновлення · сухий контакт 2"
        }
      },
      writeRegistry: {
        title: "Реєстр запису регістрів (Stage 4)",
        caption: "Виробничий endpoint запису — статус по кожному полю",
        live: "Готово до запису", authorizationRequired: "Потрібна авторизація", blocked: "Заблоковано",
        preflight: "Перевірка", write: "Записати", checking: "Перевірка…",
        confirmPrompt: "Записати {key}\n\nПоточне raw: {currentRaw}\nПропоноване значення: {value}\nOб'єднане raw після запису: {mergedRaw}\nІнші біти цього регістра (не зміняться): {siblingBits}\n\nПродовжити запис?",
        preflightFailed: "Перевірка не пройшла: {reason}",
        notReady: "Ще не готово до запису — спочатку виконайте перевірку.",
        authorizationRequiredNote: "Шлях запису існує, але ще не авторизований для реального використання (клас безпеки: {cls}). Сервер також відхилить це, навіть якщо спробувати.",
        blockedNote: "{reason}",
      },
      diagnostics: {
        title: "Діагностика", bmsCommunication: "Зв'язок із BMS", lastBmsUpdate: "Останнє оновлення BMS",
        browserConnection: "З'єднання браузера", firmware: "Прошивка", uiBuild: "Версія UI",
        wifiSignal: "Рівень Wi-Fi", ipAddress: "IP-адреса", uptime: "Час роботи",
        lastCommand: "Остання команда", command: "Команда", outcome: "Результат", at: "О",
        writeOutcomes: "Результати запису з моменту завантаження", confirmed: "Підтверджено", mismatch: "Розбіжність", timeout: "Тайм-аут", error: "Помилка",
        sentUnverified: "Надіслано (без підтвердження)",
        readEntities: "Значення параметрів BMS", readEntitiesCaption: "Фактично отримано від ESPHome",
        readEntityId: "Сутність", readEntityType: "Тип", readEntityValue: "Значення",
        readEntityCount: "Отримано: {received}",
        resolver: {
          title: "Резолвер стану батареї", floatBit: "Біт Float", chargeMos: "MOS заряду", dischargeMos: "MOS розряду",
          direction: "Напрямок струму", candidate: "Кандидат", candidateSamples: "Свіжих семплів кандидата",
          sampleAge: "Вік семпла струму", unknownReason: "Причина Unknown",
          lastKnownState: "Останній відомий стан", lastKnownPhase: "Остання відома фаза",
          idleNoiseMin: "Мін. шум у спокої", idleNoiseMax: "Макс. шум у спокої",
          dirNeutral: "Нейтрально", dirCharge: "Заряд", dirDischarge: "Розряд",
          reasonNA: "Н/Д", reasonNoTelemetry: "Немає телеметрії з моменту завантаження", reasonPostReconnect: "Очікування свіжого семпла (перепідключення)"
        },
        soh: {
          title: "Джерело стану батареї", source: "Джерело SOH", sourceProtocol: "Протокол (нативний регістр)",
          sourceUnavailable: "Недоступно", register: "Регістр", ratedCapacity: "Номінальна ємність",
          learnedCapacity: "Виміряна ємність BMS", chargeCycles: "Цикли заряду"
        }
      },
      settings: {
        title: "Налаштування", deviceName: "Назва пристрою", deviceNamePlaceholder: "Назва батареї", saveName: "Зберегти назву",
        appearance: "Вигляд", light: "Світла", dark: "Темна", auto: "Авто",
        language: "Мова", interface: "Інтерфейс"
      },
      trendModal: {
        illustrative: "Ілюстративно · не виміряно", min: "Мін", avg: "Сер", max: "Макс",
        illustrativeTrend: "Ілюстративний графік", now: "зараз",
        lastMinutes_one: "Остання {count} хвилина", lastMinutes_few: "Останні {count} хвилини", lastMinutes_many: "Останні {count} хвилин",
        metrics: {
          voltage: "Загальна напруга", current: "Струм", power: "Потужність", balance: "Струм балансування",
          mosfet: "Температура MOSFET", t1: "Температура 1", t2: "Температура 2", t4: "Температура 4", t5: "Температура 5",
          avgVoltage: "Середня напруга комірки", deltaVoltage: "Різниця напруги комірок",
          avgResistance: "Середній опір ", deltaResistance: "Різниця опору"
        }
      },
      tx: {
        confirmed: "Підтверджено", notConfirmed: "Запит {value} — {detail}. Не підтверджено.",
        noConfirmation: "Немає підтвердження від BMS", requestFailed: "Запит не виконано", requestTimedOut: "Тайм-аут запиту",
        rejectedBusy: "Відхилено — інший запис до цього регістра вже виконується",
        enabling: "Увімкнення: {label}…", disabling: "Вимкнення: {label}…", saving: "Збереження…", saved: "Збережено",
        anotherInProgress: "Для цього поля вже виконується інший запис", sending: "Надсилання…",
        describeReports: "BMS повідомляє {value}", describeNoValue: "значення не надійшло",
        uncertainRecovering: "Немає ACK/зчитування — перевіряємо фактичне значення…",
        recoveredAfterUncertainty: "(підтверджено після перевірки відновлення)",
        recoveredMismatchAfterUncertainty: "Запис не застосувався (підтверджено перевіркою відновлення)."
      },
      deviceName: {
        tooLong: "Не більше 32 символів.", saved: "Назву збережено.", reverted: "Повернуто типову назву.",
        timedOut: "Тайм-аут запиту.", saveFailed: "Не вдалося зберегти."
      }
    }
  };

  const LANGUAGE_KEY = "jkBms.language";
  const SUPPORTED_LANGS = ["en", "uk"];
  let currentLang = "en"; // overwritten synchronously below, before build() ever runs

  function detectInitialLanguage() {
    try {
      const stored = localStorage.getItem(LANGUAGE_KEY);
      if (stored && SUPPORTED_LANGS.indexOf(stored) !== -1) return stored;
    } catch (_) { /* localStorage unavailable — fall through to browser locale */ }
    // Browser locale is only a first-run RECOMMENDATION — an explicit
    // localStorage choice above always wins over it, permanently.
    const nav = (navigator.language || "en").toLowerCase();
    return nav.indexOf("uk") === 0 ? "uk" : "en";
  }
  // Resolved synchronously at script-eval time — before build() ever runs —
  // so the very first render is already in the right language. No flash
  // of one language swapping to another on load.
  currentLang = detectInitialLanguage();
  if (document.documentElement) document.documentElement.lang = currentLang;

  // {name} placeholder substitution — deliberately not full ICU, this is a
  // 2-language embedded UI, not a general-purpose i18n framework (no
  // external dependency, per the directive).
  function interpolate(str, params) {
    if (!params) return str;
    return str.replace(/\{(\w+)\}/g, (m, key) => (Object.prototype.hasOwnProperty.call(params, key) ? params[key] : m));
  }

  function lookupKey(dict, key) {
    const parts = key.split(".");
    let node = dict;
    for (let i = 0; i < parts.length; i += 1) {
      if (node == null || typeof node !== "object") return undefined;
      node = node[parts[i]];
    }
    return typeof node === "string" ? node : undefined;
  }

  // t("a.b.c", {param: val}) — current language, falling back to English,
  // falling back to the raw key itself (never blank, and a missing key is
  // visually obvious rather than silently empty).
  function t(key, params) {
    let raw = lookupKey(I18N[currentLang], key);
    if (raw === undefined) {
      if (currentLang !== "en") {
        // eslint-disable-next-line no-console
        if (window.console && console.warn) console.warn(`[i18n] missing key "${key}" for "${currentLang}", falling back to English`);
      }
      raw = lookupKey(I18N.en, key);
    }
    if (raw === undefined) {
      if (window.console && console.warn) console.warn(`[i18n] missing key "${key}" in English fallback too`);
      return key;
    }
    return interpolate(raw, params);
  }

  // Ukrainian plural rule (Slavic 3-way: one/few/many, falling back to a
  // 4th "other" bucket some of this dictionary's counts use); English is
  // the simple one/other CLDR rule. Both resolve through the same
  // {base}_{form} key convention already used above (hero.cycle_one etc).
  function pluralForm(lang, n) {
    const mod10 = n % 10, mod100 = n % 100;
    if (lang === "uk") {
      if (mod10 === 1 && mod100 !== 11) return "one";
      if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return "few";
      return "many";
    }
    return n === 1 ? "one" : "other";
  }

  function tp(baseKey, count, params) {
    const form = pluralForm(currentLang, count);
    const key = `${baseKey}_${form}`;
    const merged = Object.assign({ count }, params);
    if (lookupKey(I18N[currentLang], key) === undefined) {
      // Missing plural bucket for this language (e.g. no _few defined) —
      // fall through the SAME language's _other before dropping to English,
      // so a partially-specified plural set still reads naturally.
      const otherKey = `${baseKey}_other`;
      if (lookupKey(I18N[currentLang], otherKey) !== undefined) return t(otherKey, merged);
    }
    return t(key, merged);
  }

  // Every element carrying data-i18n gets its textContent replaced (never
  // innerHTML — translation strings are static and known ahead of time,
  // but textContent is the deliberate, cheap-to-justify default that
  // keeps this true even if a string is edited carelessly later).
  // data-i18n-title / data-i18n-aria similarly cover the two attribute
  // forms this file actually uses (title tooltips, aria-label).
  function applyI18nToRoot(root) {
    (root || document).querySelectorAll("[data-i18n]").forEach((el) => { el.textContent = t(el.dataset.i18n); });
    (root || document).querySelectorAll("[data-i18n-title]").forEach((el) => { el.title = t(el.dataset.i18nTitle); });
    (root || document).querySelectorAll("[data-i18n-aria]").forEach((el) => {
      const param = el.dataset.i18nAriaParam;
      el.setAttribute("aria-label", param === undefined ? t(el.dataset.i18nAria) : t(el.dataset.i18nAria, { n: param }));
    });
    (root || document).querySelectorAll("[data-i18n-placeholder]").forEach((el) => { el.placeholder = t(el.dataset.i18nPlaceholder); });
    (root || document).querySelectorAll("[data-unit]").forEach((el) => { el.textContent = unitLabel(el.dataset.unit); });
  }

  const DEVICE_ID = "jk-bms";
  // The transport layer remains provisioned for the protocol's own
  // documented channel capacity; presentation uses the live CellCount
  // register through activeCellCount(). User-directed rework (2026-09-17):
  // the JK-PB protocol documents 32 cell channels (CellVol/CellWireRes/
  // CellConWireRes all span index 0-31 in both the official PDF and the V2
  // workbook — see registers.canonical.json's cell_count safety_notes),
  // not 16 as this constant used to assume — 16 was this specific deployed
  // unit's own observed CellCount, never a protocol ceiling. Keep the pool
  // fixed at this protocol maximum (so entity ids/buffers exist for the
  // full documented range), but derive the *active* count from the live
  // CellCount register below (activeCellCount()) — that's what actually
  // decides how many of these 32 card slots render, for ANY configured N
  // from 1 to 32, not a fixed set of hardcoded topology sizes. This is a
  // fixture-tested software range, not a claim that any real deployed unit
  // has been hardware-verified beyond its own observed CellCount.
  const MAX_CELL_COUNT = 32;
  const REQUEST_TIMEOUT_MS = 8000;
  // Matches the ring buffer's own 30s sample interval (batterylifepo4.yaml)
  // — no point polling /history.json faster than new samples can appear.
  const HISTORY_REFRESH_MS = 30000;
  // Resolve ESPHome endpoints against the page directory. This works both at
  // http://jk-bms.local/ and behind an Nginx prefix such as /jk-bms/.
  const PAGE_BASE_URL = new URL("./", window.location.href);
  const entityByWireId = new Map();
  // Routing/duplication fix (user-directed, 2026-09-17): a distinct
  // sentinel value (never a real canonical key string) registered into
  // entityByWireId for a KNOWN "legacy companion" entity's wire id (see
  // PROTOCOL_CATALOG.legacyCompanionEntities, consumed below) -- distinct
  // from both a real resolved key (normal processing) and `undefined`
  // (a genuinely unknown SSE entity, still shown defensively by the raw-
  // fallback path elsewhere in this file). ingestPayload() checks for it
  // and returns immediately: the legacy entity's real ESPHome/Home
  // Assistant publication is untouched (this project's SSE stream is a
  // read-only mirror of it, never the other way around), it is simply
  // never written into state[] (so it can never downgrade the exact
  // value already resolved for the same canonical field) and never given
  // its own diagnostic row (so it can never duplicate that field's one
  // canonical UI row).
  const LEGACY_COMPANION_SUPPRESSED = Symbol("legacy_companion_suppressed");
  const domCache = new Map();
  const renderers = new Map();
  const READABLE_DOMAINS = new Set(["sensor", "binary_sensor", "text_sensor", "number", "select"]);
  const diagnosticReadouts = new Map();
  const diagnosticReadoutRows = new Map();
  // wireId -> {row, label, value} for renderDiagnosticSoftwareVariables()'s
  // own rows (Діагностика's software/computed-state list) -- kept separate
  // from diagnosticReadoutRows' own per-rebuild lifecycle (see that
  // function's comment) so a register-list rebuild can never silently
  // orphan these rows' DOM-node cache.
  const diagSoftwareVarRows = new Map();
  let diagnosticReadoutRebuild = 0;
  let diagnosticReadoutRebuildDeferred = false;
  // UI state for per-register write feedback. It is intentionally separate
  // from a button DOM node: incoming telemetry may rebuild the register list
  // while a write is awaiting its BMS read-back.
  const registerWriteVisualStates = new Map();
  const dirty = new Set();
  const cellVoltageBuffer = new Float32Array(MAX_CELL_COUNT);
  const cellResistanceBuffer = new Float32Array(MAX_CELL_COUNT);
  const cellVoltageKeys = new Array(MAX_CELL_COUNT);
  const cellResistanceKeys = new Array(MAX_CELL_COUNT);
  let frameRequest = 0;
  let eventSource = null;
  let cellMode = "v"; // "v" | "r" — shared by the cell chart and the cell grid's readout order
  let lastAlarmMarkupKey = null;
  let historyData = null; // last successful /history.json payload
  let historyTimer = 0;
  let staleSweepTimer = 0;

  // Output permissions live in Configuration with the rest of the BMS
  // registers. Overview is a read-only status surface that links there.
  //
  // Owner-authorized write re-enablement (2026-09-10): populated with the
  // fields whose owner_write_override is set in registers.canonical.json
  // (repo owner's explicit risk acceptance on their own hardware — see
  // docs/adr/0001-protocol-catalog.md's addendum). Every field NOT listed
  // here stays exactly as fail-closed as before — this is an allowlist,
  // not a default, and the corresponding validator/tests assert it stays
  // in sync with the canonical source's owner_write_override set.
  // Reverted to fail-closed for "charging"/"discharging" (2026-09-10,
  // second critical audit — both write_safety_class "disruptive",
  // pending independent write-contract verification). "balancing" is
  // write_safety_class "normal" and stays unlocked.
  // Third critical audit (2026-09-10): "balancing" reverted to fail-closed
  // too — registers.canonical.json had wrongly classified it "normal"
  // when batterylifepo4.yaml's own comment always declared
  // charging/discharging/balancing all "disruptive" together. CONTROL_DEFS
  // is now empty; kept as a real (not dead) allowlist for whichever
  // control register is independently verified first.
  const CONTROL_DEFS = Object.freeze({});

  const DEVICE_NAME_ENDPOINT = "/text/device_name_override/set";

  // Modbus register address for every RW register the generic Write
  // Transaction Manager (jk_write_tx_core.h / register_catalog.json,
  // "manager":"generic") tracks — used ONLY to correlate this browser's
  // own write against the matching entry in the write_tx_snapshot JSON
  // (see watchWriteTxSnapshot() below) for a fast, forced-readback-backed
  // confirmation instead of waiting on the target entity's own possibly-
  // slow poll cycle. cell_count and setup_passcode are deliberately
  // absent — each has its own bespoke transaction/confirmation path
  // already (sendCellCountWrite / the unverifiable passcode flow) and
  // isn't tracked by the generic snapshot. Keep in sync with
  // register_catalog.json — test/register_catalog/validate.js checks it.
  // >>> BEGIN GENERATED PROTOCOL CATALOG (Stage 1, IMPLEMENTATION_ROADMAP.md) — DO NOT EDIT BY HAND.
  // Regenerate with: node tools/protocol/generate.js
  // Source of truth: protocol/registers.canonical.json + protocol/non_register_entities.canonical.json
  // `node tools/protocol/generate.js --check` fails if this block drifts from that source.
  // Generated by tools/protocol/generate.js from protocol/registers.canonical.json + protocol/non_register_entities.canonical.json. DO NOT EDIT BY HAND. catalog_version=1.1.0 source_hash=c89302fd57887a88
  const PROTOCOL_CATALOG = Object.freeze({
    releaseGenerationId: "26ffcd7e41736249",
    genericTxAddress: Object.freeze({
      smart_sleep: 0x1000,
      cell_uvpr: 0x1008,
      cell_ovpr: 0x1010,
      start_balance_trigger: 0x1014,
      soc_100: 0x1018,
      soc_0: 0x101C,
      cell_rcv: 0x1020,
      cell_rfv: 0x1024,
      charge_ocpr_time: 0x1034,
      discharge_ocpr_time: 0x1040,
      scpr_time: 0x1044,
      max_balance_current: 0x1048,
      charge_otpr: 0x1050,
      discharge_otpr: 0x1058,
      charge_utpr: 0x1060,
      mos_otpr: 0x1068,
      battery_capacity: 0x107C,
      start_balance: 0x1084,
      cell_connection_wire_resistance_1: 0x1088,
      cell_connection_wire_resistance_2: 0x108C,
      cell_connection_wire_resistance_3: 0x1090,
      cell_connection_wire_resistance_4: 0x1094,
      cell_connection_wire_resistance_5: 0x1098,
      cell_connection_wire_resistance_6: 0x109C,
      cell_connection_wire_resistance_7: 0x10A0,
      cell_connection_wire_resistance_8: 0x10A4,
      cell_connection_wire_resistance_9: 0x10A8,
      cell_connection_wire_resistance_10: 0x10AC,
      cell_connection_wire_resistance_11: 0x10B0,
      cell_connection_wire_resistance_12: 0x10B4,
      cell_connection_wire_resistance_13: 0x10B8,
      cell_connection_wire_resistance_14: 0x10BC,
      cell_connection_wire_resistance_15: 0x10C0,
      cell_connection_wire_resistance_16: 0x10C4,
      cell_connection_wire_resistance_17: 0x10C8,
      cell_connection_wire_resistance_18: 0x10CC,
      cell_connection_wire_resistance_19: 0x10D0,
      cell_connection_wire_resistance_20: 0x10D4,
      cell_connection_wire_resistance_21: 0x10D8,
      cell_connection_wire_resistance_22: 0x10DC,
      cell_connection_wire_resistance_23: 0x10E0,
      cell_connection_wire_resistance_24: 0x10E4,
      cell_connection_wire_resistance_25: 0x10E8,
      cell_connection_wire_resistance_26: 0x10EC,
      cell_connection_wire_resistance_27: 0x10F0,
      cell_connection_wire_resistance_28: 0x10F4,
      cell_connection_wire_resistance_29: 0x10F8,
      cell_connection_wire_resistance_30: 0x10FC,
      cell_connection_wire_resistance_31: 0x1100,
      cell_connection_wire_resistance_32: 0x1104,
      heat_en: 0x1114,
      disable_temp_sensor: 0x1114,
      gps_heartbeat: 0x1114,
      port_switch: 0x1114,
      lcd_always_on: 0x1114,
      special_charger: 0x1114,
      smart_sleep_enabled: 0x1114,
      disable_pcl_module: 0x1114,
      timed_stored_data: 0x1114,
      smart_sleep_timeout_hours: 0x1118,
    }),
    nonRegisterKeys: Object.freeze([
      "total_voltage", "current", "power", "charging_power",
      "discharging_power", "charging_current", "discharging_current", "connected_cell_count",
      "measured_cell_count", "active_cells_voltage_sum", "effective_cell_count", "last_confirmed_cell_count",
      "topology_revision", "topology_data_freshness", "topology_state", "topology_reason",
      "cellcount_tx_id", "cellcount_tx_status_code", "setup_passcode_tx_status_code", "write_tx_snapshot",
      "battery_state", "charge_phase", "charge_status", "battery_state_candidate",
      "battery_state_candidate_age", "battery_state_direction", "battery_state_candidate_samples", "battery_state_unknown_reason",
      "battery_state_last_known", "charge_phase_last_known", "current_sample_age", "idle_current_noise_min",
      "idle_current_noise_max", "battery_state_time", "charge_phase_time", "charge_status_time",
      "min_cell_voltage", "max_cell_voltage", "min_voltage_cell", "max_voltage_cell",
      "bms_last_update_age", "bms_health", "runtime", "alarms",
      "wifi_signal", "system_uptime", "wifi_ip_address", "firmware_version",
      "ui_version", "browser_connection", "write_result_counters", "device_name_override",
      "device_name",
    ]),
    // Declared rw in the ESPHome entity, but effective_access is "r": the write path was REMOVED from
    // batterylifepo4.yaml (Stage 1 Remediation, Крок G). The Settings UI renders these read-only with
    // this reason instead of an editable input.
    blockedWriteKeys: Object.freeze({
      cell_uvp: "verification_status implementation_only_unverified",
      cell_ovp: "verification_status implementation_only_unverified",
      system_power_off: "verification_status implementation_only_unverified",
      continued_charge_current: "verification_status implementation_only_unverified",
      charge_ocp_delay: "verification_status implementation_only_unverified",
      continued_discharge_current: "verification_status implementation_only_unverified",
      discharge_ocp_delay: "verification_status implementation_only_unverified",
      charge_otp: "verification_status implementation_only_unverified",
      discharge_otp: "verification_status implementation_only_unverified",
      charge_utp: "verification_status implementation_only_unverified",
      mos_otp: "verification_status implementation_only_unverified",
      cell_count: "verification_status corroborated_with_limitations",
      charging: "verification_status implementation_only_unverified",
      discharging: "verification_status implementation_only_unverified",
      balancing: "verification_status implementation_only_unverified",
      scp_delay: "verification_status implementation_only_unverified",
      dev_addr: "Stage 3 (typed-petting-puzzle plan) deliberately does not write-enable this field even though its evidence is independently corroborated (workbook V2 + official PDF) -- write-enablement is Stage 4's own risk-tiered scope (write_safety_class triage, real packed read-modify-write, hardware-in-the-loop verification), a distinct decision from evidence sufficiency. EFFECTIVE_ACCESS PROMOTED (2026-09-20, typed-petting-puzzle plan §5 Phase 5): verification_status=confirmed + a real write_safety_class already establish this field is eligible; effective_access promoted to rw. dynamic_dependency stays resolved=false until the generated write registry + RMW mechanism are built and tested for this field (tracked in protocol/generated/stage4_rw_inventory.json).",
      tim_prodischarge: "Stage 3 (typed-petting-puzzle plan) deliberately does not write-enable this field even though its evidence is independently corroborated (workbook V2 + official PDF) -- write-enablement is Stage 4's own risk-tiered scope (write_safety_class triage, real packed read-modify-write, hardware-in-the-loop verification), a distinct decision from evidence sufficiency. EFFECTIVE_ACCESS PROMOTED (2026-09-20, typed-petting-puzzle plan §5 Phase 5): verification_status=confirmed + a real write_safety_class already establish this field is eligible; effective_access promoted to rw. dynamic_dependency stays resolved=false until the generated write registry + RMW mechanism are built and tested for this field (tracked in protocol/generated/stage4_rw_inventory.json).",
      heating_activation_temperature: "verification_status implementation_only_unverified",
      heating_deactivation_temperature: "verification_status implementation_only_unverified",
      setup_passcode: "verification_status implementation_only_unverified",
      uart1_mprtol_nbr: "Stage 3 (typed-petting-puzzle plan) deliberately does not write-enable this field even though its evidence is independently corroborated (workbook V2 + official PDF) -- write-enablement is Stage 4's own risk-tiered scope (write_safety_class triage, real packed read-modify-write, hardware-in-the-loop verification), a distinct decision from evidence sufficiency. EFFECTIVE_ACCESS PROMOTED (2026-09-20, typed-petting-puzzle plan §5 Phase 5): verification_status=confirmed + a real write_safety_class already establish this field is eligible; effective_access promoted to rw. dynamic_dependency stays resolved=false until the generated write registry + RMW mechanism are built and tested for this field (tracked in protocol/generated/stage4_rw_inventory.json).",
      can_mprtol_nbr: "Stage 3 (typed-petting-puzzle plan) deliberately does not write-enable this field even though its evidence is independently corroborated (workbook V2 + official PDF) -- write-enablement is Stage 4's own risk-tiered scope (write_safety_class triage, real packed read-modify-write, hardware-in-the-loop verification), a distinct decision from evidence sufficiency. EFFECTIVE_ACCESS PROMOTED (2026-09-20, typed-petting-puzzle plan §5 Phase 5): verification_status=confirmed + a real write_safety_class already establish this field is eligible; effective_access promoted to rw. dynamic_dependency stays resolved=false until the generated write registry + RMW mechanism are built and tested for this field (tracked in protocol/generated/stage4_rw_inventory.json).",
      uart2_mprtol_nbr: "Stage 3 (typed-petting-puzzle plan) deliberately does not write-enable this field even though its evidence is independently corroborated (workbook V2 + official PDF) -- write-enablement is Stage 4's own risk-tiered scope (write_safety_class triage, real packed read-modify-write, hardware-in-the-loop verification), a distinct decision from evidence sufficiency. EFFECTIVE_ACCESS PROMOTED (2026-09-20, typed-petting-puzzle plan §5 Phase 5): verification_status=confirmed + a real write_safety_class already establish this field is eligible; effective_access promoted to rw. dynamic_dependency stays resolved=false until the generated write registry + RMW mechanism are built and tested for this field (tracked in protocol/generated/stage4_rw_inventory.json).",
      lcd_buzzer_trigger: "this field's OWN enum semantics (which physical trigger condition each 0-255 code selects) are not confirmed by any evidence source available this session",
      dry_contact_1_trigger_source: "this field's OWN enum semantics (0-12) are not confirmed by any evidence source available this session",
      dry_contact_2_trigger_source: "this field's OWN enum semantics (0-12) are not confirmed by any evidence source available this session",
      lcd_buzzer_trigger_val: "Stage 3 (typed-petting-puzzle plan) deliberately does not write-enable this field even though its evidence is independently corroborated (workbook V2 + official PDF) -- write-enablement is Stage 4's own risk-tiered scope (write_safety_class triage, real packed read-modify-write, hardware-in-the-loop verification), a distinct decision from evidence sufficiency. EFFECTIVE_ACCESS PROMOTED (2026-09-20, typed-petting-puzzle plan §5 Phase 5): verification_status=confirmed + a real write_safety_class already establish this field is eligible; effective_access promoted to rw. dynamic_dependency stays resolved=false until the generated write registry + RMW mechanism are built and tested for this field (tracked in protocol/generated/stage4_rw_inventory.json).",
      lcd_buzzer_release_val: "Stage 3 (typed-petting-puzzle plan) deliberately does not write-enable this field even though its evidence is independently corroborated (workbook V2 + official PDF) -- write-enablement is Stage 4's own risk-tiered scope (write_safety_class triage, real packed read-modify-write, hardware-in-the-loop verification), a distinct decision from evidence sufficiency. EFFECTIVE_ACCESS PROMOTED (2026-09-20, typed-petting-puzzle plan §5 Phase 5): verification_status=confirmed + a real write_safety_class already establish this field is eligible; effective_access promoted to rw. dynamic_dependency stays resolved=false until the generated write registry + RMW mechanism are built and tested for this field (tracked in protocol/generated/stage4_rw_inventory.json).",
      dry_contact_1_trigger_value: "physical unit/scale is determined by the selected trigger source enum value; NO source value has a confirmed unit/scale mapping in any evidence available this session",
      dry_contact_1_recovery_value: "physical unit/scale is determined by the selected trigger source enum value; NO source value has a confirmed unit/scale mapping in any evidence available this session",
      dry_contact_2_trigger_value: "physical unit/scale is determined by the selected trigger source enum value; NO source value has a confirmed unit/scale mapping in any evidence available this session",
      dry_contact_2_recovery_value: "physical unit/scale is determined by the selected trigger source enum value; NO source value has a confirmed unit/scale mapping in any evidence available this session",
      data_stored_period: "Stage 3 (typed-petting-puzzle plan) deliberately does not write-enable this field even though its evidence is independently corroborated (workbook V2 + official PDF) -- write-enablement is Stage 4's own risk-tiered scope (write_safety_class triage, real packed read-modify-write, hardware-in-the-loop verification), a distinct decision from evidence sufficiency. EFFECTIVE_ACCESS PROMOTED (2026-09-20, typed-petting-puzzle plan §5 Phase 5): verification_status=confirmed + a real write_safety_class already establish this field is eligible; effective_access promoted to rw. dynamic_dependency stays resolved=false until the generated write registry + RMW mechanism are built and tested for this field (tracked in protocol/generated/stage4_rw_inventory.json).",
      rcv_time: "verification_status implementation_only_unverified",
      rfv_time: "verification_status implementation_only_unverified",
    }),
    // Stage 5: authoritative per-field unit/precision/bounds/poll-tier
    // metadata, sourced from protocol/registers.canonical.json — the single
    // place unit/min/max/step/freshness data should be read from, replacing
    // the hand-maintained tables this project previously duplicated it into.
    fieldMeta: Object.freeze({
      smart_sleep: { unit: "V", ukUnit: "В", enUnit: "V", precision: 3, min: 0, max: 6, step: 0.001, pollGroup: "config_slow_300s", freshnessBudgetS: 320, labelUk: "Напруга розумного сну", labelEn: "Smart sleep voltage", uiSection: "settings", uiOrder: 10, uiGroup: null, editorKind: "number", enumMap: null },
      cell_uvp: { unit: "V", ukUnit: "В", enUnit: "V", precision: 3, min: 0, max: 6, step: 0.001, pollGroup: "config_slow_300s", freshnessBudgetS: 320, labelUk: "Захист комірки від низької напруги (UVP)", labelEn: "Cell under-voltage protection (UVP)", uiSection: "settings", uiOrder: 20, uiGroup: null, editorKind: "readonly", enumMap: null },
      cell_uvpr: { unit: "V", ukUnit: "В", enUnit: "V", precision: 3, min: 0, max: 6, step: 0.001, pollGroup: "config_slow_300s", freshnessBudgetS: 320, labelUk: "Відновлення після глибокого розряду (UVPR)", labelEn: "Cell under-voltage protection recovery (UVPR)", uiSection: "settings", uiOrder: 30, uiGroup: null, editorKind: "number", enumMap: null },
      cell_ovp: { unit: "V", ukUnit: "В", enUnit: "V", precision: 3, min: 0, max: 6, step: 0.001, pollGroup: "config_slow_300s", freshnessBudgetS: 320, labelUk: "Захист комірки від перенапруги (OVP)", labelEn: "Cell over-voltage protection (OVP)", uiSection: "settings", uiOrder: 40, uiGroup: null, editorKind: "readonly", enumMap: null },
      cell_ovpr: { unit: "V", ukUnit: "В", enUnit: "V", precision: 3, min: 0, max: 6, step: 0.001, pollGroup: "config_slow_300s", freshnessBudgetS: 320, labelUk: "Відновлення після перенапруги (OVPR)", labelEn: "Cell over-voltage protection recovery (OVPR)", uiSection: "settings", uiOrder: 50, uiGroup: null, editorKind: "number", enumMap: null },
      start_balance_trigger: { unit: "V", ukUnit: "В", enUnit: "V", precision: 3, min: 0, max: 1, step: 0.001, pollGroup: "config_slow_300s", freshnessBudgetS: 320, labelUk: "Дельта запуску балансування", labelEn: "Balance start delta", uiSection: "settings", uiOrder: 60, uiGroup: null, editorKind: "number", enumMap: null },
      soc_100: { unit: "V", ukUnit: "В", enUnit: "V", precision: 3, min: 0, max: 6, step: 0.001, pollGroup: "config_slow_300s", freshnessBudgetS: 320, labelUk: "Напруга 100% заряду", labelEn: "100% SOC voltage", uiSection: "settings", uiOrder: 70, uiGroup: null, editorKind: "number", enumMap: null },
      soc_0: { unit: "V", ukUnit: "В", enUnit: "V", precision: 3, min: 0, max: 6, step: 0.001, pollGroup: "config_slow_300s", freshnessBudgetS: 320, labelUk: "Напруга 0% заряду", labelEn: "0% SOC voltage", uiSection: "settings", uiOrder: 80, uiGroup: null, editorKind: "number", enumMap: null },
      cell_rcv: { unit: "V", ukUnit: "В", enUnit: "V", precision: 3, min: 0, max: 6, step: 0.001, pollGroup: "config_slow_300s", freshnessBudgetS: 320, labelUk: "Цільова напруга заряду (RCV)", labelEn: "Cell request charge voltage (RCV)", uiSection: "settings", uiOrder: 90, uiGroup: null, editorKind: "number", enumMap: null },
      cell_rfv: { unit: "V", ukUnit: "В", enUnit: "V", precision: 3, min: 0, max: 6, step: 0.001, pollGroup: "config_slow_300s", freshnessBudgetS: 320, labelUk: "Цільова напруга підтримки (RFV)", labelEn: "Cell request float voltage (RFV)", uiSection: "settings", uiOrder: 100, uiGroup: null, editorKind: "number", enumMap: null },
      system_power_off: { unit: "V", ukUnit: "В", enUnit: "V", precision: 3, min: 0, max: 6, step: 0.001, pollGroup: "config_slow_300s", freshnessBudgetS: 320, labelUk: "Аварійний поріг вимкнення (UVP)", labelEn: "System power-off voltage", uiSection: "settings", uiOrder: 110, uiGroup: null, editorKind: "readonly", enumMap: null },
      continued_charge_current: { unit: "A", ukUnit: "А", enUnit: "A", precision: 3, min: 0, max: 2000, step: 0.001, pollGroup: "config_slow_300s", freshnessBudgetS: 320, labelUk: "Тривалий струм заряду", labelEn: "Continued charge current", uiSection: "settings", uiOrder: 120, uiGroup: null, editorKind: "readonly", enumMap: null },
      charge_ocp_delay: { unit: "s", ukUnit: "с", enUnit: "s", precision: 0, min: 0, max: 2147483647, step: 1, pollGroup: "config_slow_300s", freshnessBudgetS: 320, labelUk: "Затримка захисту струму заряду", labelEn: "Charge OCP delay", uiSection: "settings", uiOrder: 130, uiGroup: null, editorKind: "readonly", enumMap: null },
      charge_ocpr_time: { unit: "s", ukUnit: "с", enUnit: "s", precision: 0, min: 0, max: 2147483647, step: 1, pollGroup: "config_slow_300s", freshnessBudgetS: 320, labelUk: "Відновлення захисту струму заряду", labelEn: "Charge OCP recovery time", uiSection: "settings", uiOrder: 140, uiGroup: null, editorKind: "number", enumMap: null },
      continued_discharge_current: { unit: "A", ukUnit: "А", enUnit: "A", precision: 3, min: 0, max: 2000, step: 0.001, pollGroup: "config_slow_300s", freshnessBudgetS: 320, labelUk: "Тривалий струм розряду", labelEn: "Continued discharge current", uiSection: "settings", uiOrder: 150, uiGroup: null, editorKind: "readonly", enumMap: null },
      discharge_ocp_delay: { unit: "s", ukUnit: "с", enUnit: "s", precision: 0, min: 0, max: 2147483647, step: 1, pollGroup: "config_slow_300s", freshnessBudgetS: 320, labelUk: "Затримка захисту струму розряду", labelEn: "Discharge OCP delay", uiSection: "settings", uiOrder: 160, uiGroup: null, editorKind: "readonly", enumMap: null },
      discharge_ocpr_time: { unit: "s", ukUnit: "с", enUnit: "s", precision: 0, min: 0, max: 2147483647, step: 1, pollGroup: "config_slow_300s", freshnessBudgetS: 320, labelUk: "Відновлення захисту струму розряду", labelEn: "Discharge OCP recovery time", uiSection: "settings", uiOrder: 170, uiGroup: null, editorKind: "number", enumMap: null },
      scpr_time: { unit: "s", ukUnit: "с", enUnit: "s", precision: 0, min: 0, max: 2147483647, step: 1, pollGroup: "config_slow_300s", freshnessBudgetS: 320, labelUk: "Відновлення після короткого замикання", labelEn: "Short-circuit protection recovery time", uiSection: "settings", uiOrder: 180, uiGroup: null, editorKind: "number", enumMap: null },
      max_balance_current: { unit: "A", ukUnit: "А", enUnit: "A", precision: 3, min: 0, max: 20, step: 0.001, pollGroup: "config_slow_300s", freshnessBudgetS: 320, labelUk: "Макс. струм балансування", labelEn: "Max balance current", uiSection: "settings", uiOrder: 190, uiGroup: null, editorKind: "number", enumMap: null },
      charge_otp: { unit: "°C", ukUnit: "°C", enUnit: "°C", precision: 1, min: -100, max: 200, step: 0.1, pollGroup: "config_slow_300s", freshnessBudgetS: 320, labelUk: "Перегрів під час заряду", labelEn: "Charge over-temperature protection", uiSection: "settings", uiOrder: 200, uiGroup: null, editorKind: "readonly", enumMap: null },
      charge_otpr: { unit: "°C", ukUnit: "°C", enUnit: "°C", precision: 1, min: -100, max: 200, step: 0.1, pollGroup: "config_slow_300s", freshnessBudgetS: 320, labelUk: "Відновлення температури заряду", labelEn: "Charge OTP recovery", uiSection: "settings", uiOrder: 210, uiGroup: null, editorKind: "number", enumMap: null },
      discharge_otp: { unit: "°C", ukUnit: "°C", enUnit: "°C", precision: 1, min: -100, max: 200, step: 0.1, pollGroup: "config_slow_300s", freshnessBudgetS: 320, labelUk: "Перегрів під час розряду", labelEn: "Discharge over-temperature protection", uiSection: "settings", uiOrder: 220, uiGroup: null, editorKind: "readonly", enumMap: null },
      discharge_otpr: { unit: "°C", ukUnit: "°C", enUnit: "°C", precision: 1, min: -100, max: 200, step: 0.1, pollGroup: "config_slow_300s", freshnessBudgetS: 320, labelUk: "Відновлення температури розряду", labelEn: "Discharge OTP recovery", uiSection: "settings", uiOrder: 230, uiGroup: null, editorKind: "number", enumMap: null },
      charge_utp: { unit: "°C", ukUnit: "°C", enUnit: "°C", precision: 1, min: -100, max: 200, step: 0.1, pollGroup: "config_slow_300s", freshnessBudgetS: 320, labelUk: "Низька температура заряду", labelEn: "Charge under-temperature protection", uiSection: "settings", uiOrder: 240, uiGroup: null, editorKind: "readonly", enumMap: null },
      charge_utpr: { unit: "°C", ukUnit: "°C", enUnit: "°C", precision: 1, min: -100, max: 200, step: 0.1, pollGroup: "config_slow_300s", freshnessBudgetS: 320, labelUk: "Відновлення низької температури заряду", labelEn: "Charge UTP recovery", uiSection: "settings", uiOrder: 250, uiGroup: null, editorKind: "number", enumMap: null },
      mos_otp: { unit: "°C", ukUnit: "°C", enUnit: "°C", precision: 1, min: -100, max: 200, step: 0.1, pollGroup: "config_slow_300s", freshnessBudgetS: 320, labelUk: "Перегрів MOSFET", labelEn: "MOSFET over-temperature protection", uiSection: "settings", uiOrder: 260, uiGroup: null, editorKind: "readonly", enumMap: null },
      mos_otpr: { unit: "°C", ukUnit: "°C", enUnit: "°C", precision: 1, min: -100, max: 200, step: 0.1, pollGroup: "config_slow_300s", freshnessBudgetS: 320, labelUk: "Відновлення температури MOSFET", labelEn: "MOSFET OTP recovery", uiSection: "settings", uiOrder: 270, uiGroup: null, editorKind: "number", enumMap: null },
      cell_count: { unit: "", ukUnit: "", enUnit: "", precision: 0, min: 1, max: null, step: 1, pollGroup: "config_slow_300s", freshnessBudgetS: 320, labelUk: "Кількість комірок", labelEn: "Cell count", uiSection: "settings", uiOrder: 15, uiGroup: null, editorKind: "readonly", enumMap: null },
      charging: { unit: "", ukUnit: "", enUnit: "", precision: 0, min: 0, max: 1, step: 1, pollGroup: "telemetry_15s", freshnessBudgetS: 30, labelUk: "Заряд дозволено", labelEn: "Charge enabled", uiSection: "settings", uiOrder: 400, uiGroup: null, editorKind: "readonly", enumMap: Object.freeze({ "0": "Off", "1": "On" }) },
      discharging: { unit: "", ukUnit: "", enUnit: "", precision: 0, min: 0, max: 1, step: 1, pollGroup: "telemetry_15s", freshnessBudgetS: 30, labelUk: "Розряд дозволено", labelEn: "Discharge enabled", uiSection: "settings", uiOrder: 410, uiGroup: null, editorKind: "readonly", enumMap: Object.freeze({ "0": "Off", "1": "On" }) },
      balancing: { unit: "", ukUnit: "", enUnit: "", precision: 0, min: 0, max: 1, step: 1, pollGroup: "telemetry_15s", freshnessBudgetS: 30, labelUk: "Балансування дозволено", labelEn: "Balancing enabled", uiSection: "settings", uiOrder: 420, uiGroup: null, editorKind: "readonly", enumMap: Object.freeze({ "0": "Off", "1": "On" }) },
      battery_capacity: { unit: "Ah", ukUnit: "А·год", enUnit: "Ah", precision: 3, min: 1, max: 2000, step: 0.001, pollGroup: "config_slow_300s", freshnessBudgetS: 320, labelUk: "Номінальна ємність", labelEn: "Rated battery capacity", uiSection: "settings", uiOrder: 290, uiGroup: null, editorKind: "number", enumMap: null },
      scp_delay: { unit: "µs", ukUnit: "мкс", enUnit: "µs", precision: 0, min: 0, max: 2147483647, step: 1, pollGroup: "config_slow_300s", freshnessBudgetS: 320, labelUk: "Затримка короткого замикання", labelEn: "Short-circuit protection delay", uiSection: "settings", uiOrder: 300, uiGroup: null, editorKind: "readonly", enumMap: null },
      start_balance: { unit: "V", ukUnit: "В", enUnit: "V", precision: 3, min: 0, max: 6, step: 0.001, pollGroup: "config_slow_300s", freshnessBudgetS: 320, labelUk: "Напруга запуску балансування", labelEn: "Balance start voltage", uiSection: "settings", uiOrder: 310, uiGroup: null, editorKind: "number", enumMap: null },
      cell_connection_wire_resistance_1: { unit: "µΩ", ukUnit: "мкОм", enUnit: "µΩ", precision: 0, min: 0, max: 4294967295, step: 1, pollGroup: "config_slow_300s", freshnessBudgetS: 320, labelUk: "Налаштування опору з'єднувального проводу 01", labelEn: "Cell connection wire resistance calibration 01", uiSection: "none", uiOrder: 1301, uiGroup: null, editorKind: "number", enumMap: null },
      cell_connection_wire_resistance_2: { unit: "µΩ", ukUnit: "мкОм", enUnit: "µΩ", precision: 0, min: 0, max: 4294967295, step: 1, pollGroup: "config_slow_300s", freshnessBudgetS: 320, labelUk: "Налаштування опору з'єднувального проводу 02", labelEn: "Cell connection wire resistance calibration 02", uiSection: "none", uiOrder: 1302, uiGroup: null, editorKind: "number", enumMap: null },
      cell_connection_wire_resistance_3: { unit: "µΩ", ukUnit: "мкОм", enUnit: "µΩ", precision: 0, min: 0, max: 4294967295, step: 1, pollGroup: "config_slow_300s", freshnessBudgetS: 320, labelUk: "Налаштування опору з'єднувального проводу 03", labelEn: "Cell connection wire resistance calibration 03", uiSection: "none", uiOrder: 1303, uiGroup: null, editorKind: "number", enumMap: null },
      cell_connection_wire_resistance_4: { unit: "µΩ", ukUnit: "мкОм", enUnit: "µΩ", precision: 0, min: 0, max: 4294967295, step: 1, pollGroup: "config_slow_300s", freshnessBudgetS: 320, labelUk: "Налаштування опору з'єднувального проводу 04", labelEn: "Cell connection wire resistance calibration 04", uiSection: "none", uiOrder: 1304, uiGroup: null, editorKind: "number", enumMap: null },
      cell_connection_wire_resistance_5: { unit: "µΩ", ukUnit: "мкОм", enUnit: "µΩ", precision: 0, min: 0, max: 4294967295, step: 1, pollGroup: "config_slow_300s", freshnessBudgetS: 320, labelUk: "Налаштування опору з'єднувального проводу 05", labelEn: "Cell connection wire resistance calibration 05", uiSection: "none", uiOrder: 1305, uiGroup: null, editorKind: "number", enumMap: null },
      cell_connection_wire_resistance_6: { unit: "µΩ", ukUnit: "мкОм", enUnit: "µΩ", precision: 0, min: 0, max: 4294967295, step: 1, pollGroup: "config_slow_300s", freshnessBudgetS: 320, labelUk: "Налаштування опору з'єднувального проводу 06", labelEn: "Cell connection wire resistance calibration 06", uiSection: "none", uiOrder: 1306, uiGroup: null, editorKind: "number", enumMap: null },
      cell_connection_wire_resistance_7: { unit: "µΩ", ukUnit: "мкОм", enUnit: "µΩ", precision: 0, min: 0, max: 4294967295, step: 1, pollGroup: "config_slow_300s", freshnessBudgetS: 320, labelUk: "Налаштування опору з'єднувального проводу 07", labelEn: "Cell connection wire resistance calibration 07", uiSection: "none", uiOrder: 1307, uiGroup: null, editorKind: "number", enumMap: null },
      cell_connection_wire_resistance_8: { unit: "µΩ", ukUnit: "мкОм", enUnit: "µΩ", precision: 0, min: 0, max: 4294967295, step: 1, pollGroup: "config_slow_300s", freshnessBudgetS: 320, labelUk: "Налаштування опору з'єднувального проводу 08", labelEn: "Cell connection wire resistance calibration 08", uiSection: "none", uiOrder: 1308, uiGroup: null, editorKind: "number", enumMap: null },
      cell_connection_wire_resistance_9: { unit: "µΩ", ukUnit: "мкОм", enUnit: "µΩ", precision: 0, min: 0, max: 4294967295, step: 1, pollGroup: "config_slow_300s", freshnessBudgetS: 320, labelUk: "Налаштування опору з'єднувального проводу 09", labelEn: "Cell connection wire resistance calibration 09", uiSection: "none", uiOrder: 1309, uiGroup: null, editorKind: "number", enumMap: null },
      cell_connection_wire_resistance_10: { unit: "µΩ", ukUnit: "мкОм", enUnit: "µΩ", precision: 0, min: 0, max: 4294967295, step: 1, pollGroup: "config_slow_300s", freshnessBudgetS: 320, labelUk: "Налаштування опору з'єднувального проводу 10", labelEn: "Cell connection wire resistance calibration 10", uiSection: "none", uiOrder: 1310, uiGroup: null, editorKind: "number", enumMap: null },
      cell_connection_wire_resistance_11: { unit: "µΩ", ukUnit: "мкОм", enUnit: "µΩ", precision: 0, min: 0, max: 4294967295, step: 1, pollGroup: "config_slow_300s", freshnessBudgetS: 320, labelUk: "Налаштування опору з'єднувального проводу 11", labelEn: "Cell connection wire resistance calibration 11", uiSection: "none", uiOrder: 1311, uiGroup: null, editorKind: "number", enumMap: null },
      cell_connection_wire_resistance_12: { unit: "µΩ", ukUnit: "мкОм", enUnit: "µΩ", precision: 0, min: 0, max: 4294967295, step: 1, pollGroup: "config_slow_300s", freshnessBudgetS: 320, labelUk: "Налаштування опору з'єднувального проводу 12", labelEn: "Cell connection wire resistance calibration 12", uiSection: "none", uiOrder: 1312, uiGroup: null, editorKind: "number", enumMap: null },
      cell_connection_wire_resistance_13: { unit: "µΩ", ukUnit: "мкОм", enUnit: "µΩ", precision: 0, min: 0, max: 4294967295, step: 1, pollGroup: "config_slow_300s", freshnessBudgetS: 320, labelUk: "Налаштування опору з'єднувального проводу 13", labelEn: "Cell connection wire resistance calibration 13", uiSection: "none", uiOrder: 1313, uiGroup: null, editorKind: "number", enumMap: null },
      cell_connection_wire_resistance_14: { unit: "µΩ", ukUnit: "мкОм", enUnit: "µΩ", precision: 0, min: 0, max: 4294967295, step: 1, pollGroup: "config_slow_300s", freshnessBudgetS: 320, labelUk: "Налаштування опору з'єднувального проводу 14", labelEn: "Cell connection wire resistance calibration 14", uiSection: "none", uiOrder: 1314, uiGroup: null, editorKind: "number", enumMap: null },
      cell_connection_wire_resistance_15: { unit: "µΩ", ukUnit: "мкОм", enUnit: "µΩ", precision: 0, min: 0, max: 4294967295, step: 1, pollGroup: "config_slow_300s", freshnessBudgetS: 320, labelUk: "Налаштування опору з'єднувального проводу 15", labelEn: "Cell connection wire resistance calibration 15", uiSection: "none", uiOrder: 1315, uiGroup: null, editorKind: "number", enumMap: null },
      cell_connection_wire_resistance_16: { unit: "µΩ", ukUnit: "мкОм", enUnit: "µΩ", precision: 0, min: 0, max: 4294967295, step: 1, pollGroup: "config_slow_300s", freshnessBudgetS: 320, labelUk: "Налаштування опору з'єднувального проводу 16", labelEn: "Cell connection wire resistance calibration 16", uiSection: "none", uiOrder: 1316, uiGroup: null, editorKind: "number", enumMap: null },
      cell_connection_wire_resistance_17: { unit: "µΩ", ukUnit: "мкОм", enUnit: "µΩ", precision: 0, min: 0, max: 4294967295, step: 1, pollGroup: "config_slow_300s", freshnessBudgetS: 320, labelUk: "Налаштування опору з'єднувального проводу 17", labelEn: "Cell connection wire resistance calibration 17", uiSection: "none", uiOrder: 1317, uiGroup: null, editorKind: "number", enumMap: null },
      cell_connection_wire_resistance_18: { unit: "µΩ", ukUnit: "мкОм", enUnit: "µΩ", precision: 0, min: 0, max: 4294967295, step: 1, pollGroup: "config_slow_300s", freshnessBudgetS: 320, labelUk: "Налаштування опору з'єднувального проводу 18", labelEn: "Cell connection wire resistance calibration 18", uiSection: "none", uiOrder: 1318, uiGroup: null, editorKind: "number", enumMap: null },
      cell_connection_wire_resistance_19: { unit: "µΩ", ukUnit: "мкОм", enUnit: "µΩ", precision: 0, min: 0, max: 4294967295, step: 1, pollGroup: "config_slow_300s", freshnessBudgetS: 320, labelUk: "Налаштування опору з'єднувального проводу 19", labelEn: "Cell connection wire resistance calibration 19", uiSection: "none", uiOrder: 1319, uiGroup: null, editorKind: "number", enumMap: null },
      cell_connection_wire_resistance_20: { unit: "µΩ", ukUnit: "мкОм", enUnit: "µΩ", precision: 0, min: 0, max: 4294967295, step: 1, pollGroup: "config_slow_300s", freshnessBudgetS: 320, labelUk: "Налаштування опору з'єднувального проводу 20", labelEn: "Cell connection wire resistance calibration 20", uiSection: "none", uiOrder: 1320, uiGroup: null, editorKind: "number", enumMap: null },
      cell_connection_wire_resistance_21: { unit: "µΩ", ukUnit: "мкОм", enUnit: "µΩ", precision: 0, min: 0, max: 4294967295, step: 1, pollGroup: "config_slow_300s", freshnessBudgetS: 320, labelUk: "Налаштування опору з'єднувального проводу 21", labelEn: "Cell connection wire resistance calibration 21", uiSection: "none", uiOrder: 1321, uiGroup: null, editorKind: "number", enumMap: null },
      cell_connection_wire_resistance_22: { unit: "µΩ", ukUnit: "мкОм", enUnit: "µΩ", precision: 0, min: 0, max: 4294967295, step: 1, pollGroup: "config_slow_300s", freshnessBudgetS: 320, labelUk: "Налаштування опору з'єднувального проводу 22", labelEn: "Cell connection wire resistance calibration 22", uiSection: "none", uiOrder: 1322, uiGroup: null, editorKind: "number", enumMap: null },
      cell_connection_wire_resistance_23: { unit: "µΩ", ukUnit: "мкОм", enUnit: "µΩ", precision: 0, min: 0, max: 4294967295, step: 1, pollGroup: "config_slow_300s", freshnessBudgetS: 320, labelUk: "Налаштування опору з'єднувального проводу 23", labelEn: "Cell connection wire resistance calibration 23", uiSection: "none", uiOrder: 1323, uiGroup: null, editorKind: "number", enumMap: null },
      cell_connection_wire_resistance_24: { unit: "µΩ", ukUnit: "мкОм", enUnit: "µΩ", precision: 0, min: 0, max: 4294967295, step: 1, pollGroup: "config_slow_300s", freshnessBudgetS: 320, labelUk: "Налаштування опору з'єднувального проводу 24", labelEn: "Cell connection wire resistance calibration 24", uiSection: "none", uiOrder: 1324, uiGroup: null, editorKind: "number", enumMap: null },
      cell_connection_wire_resistance_25: { unit: "µΩ", ukUnit: "мкОм", enUnit: "µΩ", precision: 0, min: 0, max: 4294967295, step: 1, pollGroup: "config_slow_300s", freshnessBudgetS: 320, labelUk: "Налаштування опору з'єднувального проводу 25", labelEn: "Cell connection wire resistance calibration 25", uiSection: "none", uiOrder: 1325, uiGroup: null, editorKind: "number", enumMap: null },
      cell_connection_wire_resistance_26: { unit: "µΩ", ukUnit: "мкОм", enUnit: "µΩ", precision: 0, min: 0, max: 4294967295, step: 1, pollGroup: "config_slow_300s", freshnessBudgetS: 320, labelUk: "Налаштування опору з'єднувального проводу 26", labelEn: "Cell connection wire resistance calibration 26", uiSection: "none", uiOrder: 1326, uiGroup: null, editorKind: "number", enumMap: null },
      cell_connection_wire_resistance_27: { unit: "µΩ", ukUnit: "мкОм", enUnit: "µΩ", precision: 0, min: 0, max: 4294967295, step: 1, pollGroup: "config_slow_300s", freshnessBudgetS: 320, labelUk: "Налаштування опору з'єднувального проводу 27", labelEn: "Cell connection wire resistance calibration 27", uiSection: "none", uiOrder: 1327, uiGroup: null, editorKind: "number", enumMap: null },
      cell_connection_wire_resistance_28: { unit: "µΩ", ukUnit: "мкОм", enUnit: "µΩ", precision: 0, min: 0, max: 4294967295, step: 1, pollGroup: "config_slow_300s", freshnessBudgetS: 320, labelUk: "Налаштування опору з'єднувального проводу 28", labelEn: "Cell connection wire resistance calibration 28", uiSection: "none", uiOrder: 1328, uiGroup: null, editorKind: "number", enumMap: null },
      cell_connection_wire_resistance_29: { unit: "µΩ", ukUnit: "мкОм", enUnit: "µΩ", precision: 0, min: 0, max: 4294967295, step: 1, pollGroup: "config_slow_300s", freshnessBudgetS: 320, labelUk: "Налаштування опору з'єднувального проводу 29", labelEn: "Cell connection wire resistance calibration 29", uiSection: "none", uiOrder: 1329, uiGroup: null, editorKind: "number", enumMap: null },
      cell_connection_wire_resistance_30: { unit: "µΩ", ukUnit: "мкОм", enUnit: "µΩ", precision: 0, min: 0, max: 4294967295, step: 1, pollGroup: "config_slow_300s", freshnessBudgetS: 320, labelUk: "Налаштування опору з'єднувального проводу 30", labelEn: "Cell connection wire resistance calibration 30", uiSection: "none", uiOrder: 1330, uiGroup: null, editorKind: "number", enumMap: null },
      cell_connection_wire_resistance_31: { unit: "µΩ", ukUnit: "мкОм", enUnit: "µΩ", precision: 0, min: 0, max: 4294967295, step: 1, pollGroup: "config_slow_300s", freshnessBudgetS: 320, labelUk: "Налаштування опору з'єднувального проводу 31", labelEn: "Cell connection wire resistance calibration 31", uiSection: "none", uiOrder: 1331, uiGroup: null, editorKind: "number", enumMap: null },
      cell_connection_wire_resistance_32: { unit: "µΩ", ukUnit: "мкОм", enUnit: "µΩ", precision: 0, min: 0, max: 4294967295, step: 1, pollGroup: "config_slow_300s", freshnessBudgetS: 320, labelUk: "Налаштування опору з'єднувального проводу 32", labelEn: "Cell connection wire resistance calibration 32", uiSection: "none", uiOrder: 1332, uiGroup: null, editorKind: "number", enumMap: null },
      dev_addr: { unit: "", ukUnit: "", enUnit: "", precision: 0, min: null, max: null, step: null, pollGroup: "config_slow_300s", freshnessBudgetS: 320, labelUk: "Адреса пристрою Modbus", labelEn: "Modbus device address", uiSection: "settings", uiOrder: 709, uiGroup: null, editorKind: "readonly", enumMap: null },
      tim_prodischarge: { unit: "s", ukUnit: "с", enUnit: "s", precision: 0, min: null, max: null, step: null, pollGroup: "config_slow_300s", freshnessBudgetS: 320, labelUk: "Тривалість передзаряду перед розрядом", labelEn: "Pre-discharge precharge duration", uiSection: "settings", uiOrder: 707, uiGroup: null, editorKind: "readonly", enumMap: null },
      heat_en: { unit: "", ukUnit: "", enUnit: "", precision: 0, min: 0, max: 1, step: 1, pollGroup: "telemetry_15s", freshnessBudgetS: 30, labelUk: "Перемикач нагрівача (HeatEN)", labelEn: "Heater enable (HeatEN)", uiSection: "diagnostics", uiOrder: 1301, uiGroup: null, editorKind: "number", enumMap: null },
      disable_temp_sensor: { unit: "", ukUnit: "", enUnit: "", precision: 0, min: 0, max: 1, step: 1, pollGroup: "telemetry_15s", freshnessBudgetS: 30, labelUk: "Блокування термодатчиків", labelEn: "Disable temperature sensors", uiSection: "diagnostics", uiOrder: 1302, uiGroup: null, editorKind: "number", enumMap: null },
      gps_heartbeat: { unit: "", ukUnit: "", enUnit: "", precision: 0, min: 0, max: 1, step: 1, pollGroup: "telemetry_15s", freshnessBudgetS: 30, labelUk: "Контроль серцебиття GPS", labelEn: "GPS heartbeat check", uiSection: "diagnostics", uiOrder: 1303, uiGroup: null, editorKind: "number", enumMap: null },
      port_switch: { unit: "", ukUnit: "", enUnit: "", precision: 0, min: 0, max: 1, step: 1, pollGroup: "telemetry_15s", freshnessBudgetS: 30, labelUk: "Функція мультиплексного порту", labelEn: "Multiplexed port function", uiSection: "diagnostics", uiOrder: 1304, uiGroup: null, editorKind: "number", enumMap: Object.freeze({ "0": "CAN", "1": "RS485" }) },
      lcd_always_on: { unit: "", ukUnit: "", enUnit: "", precision: 0, min: 0, max: 1, step: 1, pollGroup: "telemetry_15s", freshnessBudgetS: 30, labelUk: "Постійно увімкнене підсвічування LCD", labelEn: "LCD always on", uiSection: "diagnostics", uiOrder: 1305, uiGroup: null, editorKind: "number", enumMap: null },
      special_charger: { unit: "", ukUnit: "", enUnit: "", precision: 0, min: 0, max: 1, step: 1, pollGroup: "telemetry_15s", freshnessBudgetS: 30, labelUk: "Розпізнавання спеціального зарядного", labelEn: "Special charger detection", uiSection: "diagnostics", uiOrder: 1306, uiGroup: null, editorKind: "number", enumMap: null },
      smart_sleep_enabled: { unit: "", ukUnit: "", enUnit: "", precision: 0, min: 0, max: 1, step: 1, pollGroup: "telemetry_15s", freshnessBudgetS: 30, labelUk: "Дозвіл розумного сну (SmartSleep)", labelEn: "Smart sleep enable", uiSection: "diagnostics", uiOrder: 1307, uiGroup: null, editorKind: "number", enumMap: null },
      disable_pcl_module: { unit: "", ukUnit: "", enUnit: "", precision: 0, min: 0, max: 1, step: 1, pollGroup: "telemetry_15s", freshnessBudgetS: 30, labelUk: "Блокування модуля паралельного лімітування", labelEn: "Disable parallel current-limiting module", uiSection: "diagnostics", uiOrder: 1308, uiGroup: null, editorKind: "number", enumMap: null },
      timed_stored_data: { unit: "", ukUnit: "", enUnit: "", precision: 0, min: 0, max: 1, step: 1, pollGroup: "telemetry_15s", freshnessBudgetS: 30, labelUk: "Періодичне збереження даних", labelEn: "Timed data storage", uiSection: "diagnostics", uiOrder: 1309, uiGroup: null, editorKind: "number", enumMap: null },
      charging_float_mode: { unit: "", ukUnit: "", enUnit: "", precision: 0, min: 0, max: 1, step: 1, pollGroup: "telemetry_15s", freshnessBudgetS: 30, labelUk: "Режим підтримки", labelEn: "Float/support mode", uiSection: "diagnostics", uiOrder: 1300, uiGroup: null, editorKind: "readonly", enumMap: null },
      smart_sleep_timeout_hours: { unit: "h", ukUnit: "год", enUnit: "h", precision: 0, min: 0, max: 255, step: 1, pollGroup: "telemetry_15s", freshnessBudgetS: 30, labelUk: "Таймаут розумного сну", labelEn: "Smart sleep timeout", uiSection: "diagnostics", uiOrder: 1310, uiGroup: null, editorKind: "number", enumMap: null },
      data_domain_enable_0: { unit: "", ukUnit: "", enUnit: "", precision: 0, min: 0, max: 255, step: 1, pollGroup: "telemetry_15s", freshnessBudgetS: 30, labelUk: "Службовий байт дозволу передачі даних 0", labelEn: "Data domain enable byte 0", uiSection: "diagnostics", uiOrder: 1311, uiGroup: null, editorKind: "readonly", enumMap: null },
      heating_activation_temperature: { unit: "°C", ukUnit: "°C", enUnit: "°C", precision: 0, min: -40, max: 100, step: 1, pollGroup: "config_slow_300s", freshnessBudgetS: 320, labelUk: "Температура ввімкнення підігріву", labelEn: "Heating activation temperature", uiSection: "settings", uiOrder: 500, uiGroup: null, editorKind: "readonly", enumMap: null },
      heating_deactivation_temperature: { unit: "°C", ukUnit: "°C", enUnit: "°C", precision: 0, min: -40, max: 100, step: 1, pollGroup: "config_slow_300s", freshnessBudgetS: 320, labelUk: "Температура вимкнення підігріву", labelEn: "Heating deactivation temperature", uiSection: "settings", uiOrder: 510, uiGroup: null, editorKind: "readonly", enumMap: null },
      cell_voltage_1: { unit: "V", ukUnit: "В", enUnit: "V", precision: 3, min: 0, max: 6, step: 0.001, pollGroup: "cell_block_1s", freshnessBudgetS: 3, labelUk: "Напруга комірки 01", labelEn: "Cell voltage 01", uiSection: "cells", uiOrder: 1001, uiGroup: null, editorKind: "readonly", enumMap: null },
      cell_voltage_2: { unit: "V", ukUnit: "В", enUnit: "V", precision: 3, min: 0, max: 6, step: 0.001, pollGroup: "cell_block_1s", freshnessBudgetS: 3, labelUk: "Напруга комірки 02", labelEn: "Cell voltage 02", uiSection: "cells", uiOrder: 1002, uiGroup: null, editorKind: "readonly", enumMap: null },
      cell_voltage_3: { unit: "V", ukUnit: "В", enUnit: "V", precision: 3, min: 0, max: 6, step: 0.001, pollGroup: "cell_block_1s", freshnessBudgetS: 3, labelUk: "Напруга комірки 03", labelEn: "Cell voltage 03", uiSection: "cells", uiOrder: 1003, uiGroup: null, editorKind: "readonly", enumMap: null },
      cell_voltage_4: { unit: "V", ukUnit: "В", enUnit: "V", precision: 3, min: 0, max: 6, step: 0.001, pollGroup: "cell_block_1s", freshnessBudgetS: 3, labelUk: "Напруга комірки 04", labelEn: "Cell voltage 04", uiSection: "cells", uiOrder: 1004, uiGroup: null, editorKind: "readonly", enumMap: null },
      cell_voltage_5: { unit: "V", ukUnit: "В", enUnit: "V", precision: 3, min: 0, max: 6, step: 0.001, pollGroup: "cell_block_1s", freshnessBudgetS: 3, labelUk: "Напруга комірки 05", labelEn: "Cell voltage 05", uiSection: "cells", uiOrder: 1005, uiGroup: null, editorKind: "readonly", enumMap: null },
      cell_voltage_6: { unit: "V", ukUnit: "В", enUnit: "V", precision: 3, min: 0, max: 6, step: 0.001, pollGroup: "cell_block_1s", freshnessBudgetS: 3, labelUk: "Напруга комірки 06", labelEn: "Cell voltage 06", uiSection: "cells", uiOrder: 1006, uiGroup: null, editorKind: "readonly", enumMap: null },
      cell_voltage_7: { unit: "V", ukUnit: "В", enUnit: "V", precision: 3, min: 0, max: 6, step: 0.001, pollGroup: "cell_block_1s", freshnessBudgetS: 3, labelUk: "Напруга комірки 07", labelEn: "Cell voltage 07", uiSection: "cells", uiOrder: 1007, uiGroup: null, editorKind: "readonly", enumMap: null },
      cell_voltage_8: { unit: "V", ukUnit: "В", enUnit: "V", precision: 3, min: 0, max: 6, step: 0.001, pollGroup: "cell_block_1s", freshnessBudgetS: 3, labelUk: "Напруга комірки 08", labelEn: "Cell voltage 08", uiSection: "cells", uiOrder: 1008, uiGroup: null, editorKind: "readonly", enumMap: null },
      cell_voltage_9: { unit: "V", ukUnit: "В", enUnit: "V", precision: 3, min: 0, max: 6, step: 0.001, pollGroup: "cell_block_1s", freshnessBudgetS: 3, labelUk: "Напруга комірки 09", labelEn: "Cell voltage 09", uiSection: "cells", uiOrder: 1009, uiGroup: null, editorKind: "readonly", enumMap: null },
      cell_voltage_10: { unit: "V", ukUnit: "В", enUnit: "V", precision: 3, min: 0, max: 6, step: 0.001, pollGroup: "cell_block_1s", freshnessBudgetS: 3, labelUk: "Напруга комірки 10", labelEn: "Cell voltage 10", uiSection: "cells", uiOrder: 1010, uiGroup: null, editorKind: "readonly", enumMap: null },
      cell_voltage_11: { unit: "V", ukUnit: "В", enUnit: "V", precision: 3, min: 0, max: 6, step: 0.001, pollGroup: "cell_block_1s", freshnessBudgetS: 3, labelUk: "Напруга комірки 11", labelEn: "Cell voltage 11", uiSection: "cells", uiOrder: 1011, uiGroup: null, editorKind: "readonly", enumMap: null },
      cell_voltage_12: { unit: "V", ukUnit: "В", enUnit: "V", precision: 3, min: 0, max: 6, step: 0.001, pollGroup: "cell_block_1s", freshnessBudgetS: 3, labelUk: "Напруга комірки 12", labelEn: "Cell voltage 12", uiSection: "cells", uiOrder: 1012, uiGroup: null, editorKind: "readonly", enumMap: null },
      cell_voltage_13: { unit: "V", ukUnit: "В", enUnit: "V", precision: 3, min: 0, max: 6, step: 0.001, pollGroup: "cell_block_1s", freshnessBudgetS: 3, labelUk: "Напруга комірки 13", labelEn: "Cell voltage 13", uiSection: "cells", uiOrder: 1013, uiGroup: null, editorKind: "readonly", enumMap: null },
      cell_voltage_14: { unit: "V", ukUnit: "В", enUnit: "V", precision: 3, min: 0, max: 6, step: 0.001, pollGroup: "cell_block_1s", freshnessBudgetS: 3, labelUk: "Напруга комірки 14", labelEn: "Cell voltage 14", uiSection: "cells", uiOrder: 1014, uiGroup: null, editorKind: "readonly", enumMap: null },
      cell_voltage_15: { unit: "V", ukUnit: "В", enUnit: "V", precision: 3, min: 0, max: 6, step: 0.001, pollGroup: "cell_block_1s", freshnessBudgetS: 3, labelUk: "Напруга комірки 15", labelEn: "Cell voltage 15", uiSection: "cells", uiOrder: 1015, uiGroup: null, editorKind: "readonly", enumMap: null },
      cell_voltage_16: { unit: "V", ukUnit: "В", enUnit: "V", precision: 3, min: 0, max: 6, step: 0.001, pollGroup: "cell_block_1s", freshnessBudgetS: 3, labelUk: "Напруга комірки 16", labelEn: "Cell voltage 16", uiSection: "cells", uiOrder: 1016, uiGroup: null, editorKind: "readonly", enumMap: null },
      cell_voltage_17: { unit: "V", ukUnit: "В", enUnit: "V", precision: 3, min: 0, max: 6, step: 0.001, pollGroup: "cell_block_1s", freshnessBudgetS: 3, labelUk: "Напруга комірки 17", labelEn: "Cell voltage 17", uiSection: "cells", uiOrder: 1017, uiGroup: null, editorKind: "readonly", enumMap: null },
      cell_voltage_18: { unit: "V", ukUnit: "В", enUnit: "V", precision: 3, min: 0, max: 6, step: 0.001, pollGroup: "cell_block_1s", freshnessBudgetS: 3, labelUk: "Напруга комірки 18", labelEn: "Cell voltage 18", uiSection: "cells", uiOrder: 1018, uiGroup: null, editorKind: "readonly", enumMap: null },
      cell_voltage_19: { unit: "V", ukUnit: "В", enUnit: "V", precision: 3, min: 0, max: 6, step: 0.001, pollGroup: "cell_block_1s", freshnessBudgetS: 3, labelUk: "Напруга комірки 19", labelEn: "Cell voltage 19", uiSection: "cells", uiOrder: 1019, uiGroup: null, editorKind: "readonly", enumMap: null },
      cell_voltage_20: { unit: "V", ukUnit: "В", enUnit: "V", precision: 3, min: 0, max: 6, step: 0.001, pollGroup: "cell_block_1s", freshnessBudgetS: 3, labelUk: "Напруга комірки 20", labelEn: "Cell voltage 20", uiSection: "cells", uiOrder: 1020, uiGroup: null, editorKind: "readonly", enumMap: null },
      cell_voltage_21: { unit: "V", ukUnit: "В", enUnit: "V", precision: 3, min: 0, max: 6, step: 0.001, pollGroup: "cell_block_1s", freshnessBudgetS: 3, labelUk: "Напруга комірки 21", labelEn: "Cell voltage 21", uiSection: "cells", uiOrder: 1021, uiGroup: null, editorKind: "readonly", enumMap: null },
      cell_voltage_22: { unit: "V", ukUnit: "В", enUnit: "V", precision: 3, min: 0, max: 6, step: 0.001, pollGroup: "cell_block_1s", freshnessBudgetS: 3, labelUk: "Напруга комірки 22", labelEn: "Cell voltage 22", uiSection: "cells", uiOrder: 1022, uiGroup: null, editorKind: "readonly", enumMap: null },
      cell_voltage_23: { unit: "V", ukUnit: "В", enUnit: "V", precision: 3, min: 0, max: 6, step: 0.001, pollGroup: "cell_block_1s", freshnessBudgetS: 3, labelUk: "Напруга комірки 23", labelEn: "Cell voltage 23", uiSection: "cells", uiOrder: 1023, uiGroup: null, editorKind: "readonly", enumMap: null },
      cell_voltage_24: { unit: "V", ukUnit: "В", enUnit: "V", precision: 3, min: 0, max: 6, step: 0.001, pollGroup: "cell_block_1s", freshnessBudgetS: 3, labelUk: "Напруга комірки 24", labelEn: "Cell voltage 24", uiSection: "cells", uiOrder: 1024, uiGroup: null, editorKind: "readonly", enumMap: null },
      cell_voltage_25: { unit: "V", ukUnit: "В", enUnit: "V", precision: 3, min: 0, max: 6, step: 0.001, pollGroup: "cell_block_1s", freshnessBudgetS: 3, labelUk: "Напруга комірки 25", labelEn: "Cell voltage 25", uiSection: "cells", uiOrder: 1025, uiGroup: null, editorKind: "readonly", enumMap: null },
      cell_voltage_26: { unit: "V", ukUnit: "В", enUnit: "V", precision: 3, min: 0, max: 6, step: 0.001, pollGroup: "cell_block_1s", freshnessBudgetS: 3, labelUk: "Напруга комірки 26", labelEn: "Cell voltage 26", uiSection: "cells", uiOrder: 1026, uiGroup: null, editorKind: "readonly", enumMap: null },
      cell_voltage_27: { unit: "V", ukUnit: "В", enUnit: "V", precision: 3, min: 0, max: 6, step: 0.001, pollGroup: "cell_block_1s", freshnessBudgetS: 3, labelUk: "Напруга комірки 27", labelEn: "Cell voltage 27", uiSection: "cells", uiOrder: 1027, uiGroup: null, editorKind: "readonly", enumMap: null },
      cell_voltage_28: { unit: "V", ukUnit: "В", enUnit: "V", precision: 3, min: 0, max: 6, step: 0.001, pollGroup: "cell_block_1s", freshnessBudgetS: 3, labelUk: "Напруга комірки 28", labelEn: "Cell voltage 28", uiSection: "cells", uiOrder: 1028, uiGroup: null, editorKind: "readonly", enumMap: null },
      cell_voltage_29: { unit: "V", ukUnit: "В", enUnit: "V", precision: 3, min: 0, max: 6, step: 0.001, pollGroup: "cell_block_1s", freshnessBudgetS: 3, labelUk: "Напруга комірки 29", labelEn: "Cell voltage 29", uiSection: "cells", uiOrder: 1029, uiGroup: null, editorKind: "readonly", enumMap: null },
      cell_voltage_30: { unit: "V", ukUnit: "В", enUnit: "V", precision: 3, min: 0, max: 6, step: 0.001, pollGroup: "cell_block_1s", freshnessBudgetS: 3, labelUk: "Напруга комірки 30", labelEn: "Cell voltage 30", uiSection: "cells", uiOrder: 1030, uiGroup: null, editorKind: "readonly", enumMap: null },
      cell_voltage_31: { unit: "V", ukUnit: "В", enUnit: "V", precision: 3, min: 0, max: 6, step: 0.001, pollGroup: "cell_block_1s", freshnessBudgetS: 3, labelUk: "Напруга комірки 31", labelEn: "Cell voltage 31", uiSection: "cells", uiOrder: 1031, uiGroup: null, editorKind: "readonly", enumMap: null },
      cell_voltage_32: { unit: "V", ukUnit: "В", enUnit: "V", precision: 3, min: 0, max: 6, step: 0.001, pollGroup: "cell_block_1s", freshnessBudgetS: 3, labelUk: "Напруга комірки 32", labelEn: "Cell voltage 32", uiSection: "cells", uiOrder: 1032, uiGroup: null, editorKind: "readonly", enumMap: null },
      cell_connected_mask: { unit: "", ukUnit: "", enUnit: "", precision: 0, min: 0, max: 4294967295, step: 1, pollGroup: "cell_block_1s", freshnessBudgetS: 3, labelUk: "Маска підключених комірок", labelEn: "Connected cell mask", uiSection: "diagnostics", uiOrder: 1100, uiGroup: null, editorKind: "readonly", enumMap: null },
      average_cell_voltage: { unit: "V", ukUnit: "В", enUnit: "V", precision: 3, min: 0, max: 6, step: 0.001, pollGroup: "cell_block_1s", freshnessBudgetS: 3, labelUk: "Середня напруга комірки", labelEn: "Average cell voltage", uiSection: "cells", uiOrder: 1120, uiGroup: null, editorKind: "readonly", enumMap: null },
      delta_cell_voltage: { unit: "V", ukUnit: "В", enUnit: "V", precision: 3, min: 0, max: 6, step: 0.001, pollGroup: "cell_block_1s", freshnessBudgetS: 3, labelUk: "Різниця напруг комірок", labelEn: "Delta cell voltage", uiSection: "cells", uiOrder: 1130, uiGroup: null, editorKind: "readonly", enumMap: null },
      max_voltage_cell_index_native: { unit: "", ukUnit: "", enUnit: "", precision: 0, min: 0, max: 255, step: 1, pollGroup: "telemetry_15s", freshnessBudgetS: 30, labelUk: "Номер комірки з макс. напругою (нативний регістр)", labelEn: "Max voltage cell index (native register)", uiSection: "diagnostics", uiOrder: 1110, uiGroup: null, editorKind: "readonly", enumMap: null },
      min_voltage_cell_index_native: { unit: "", ukUnit: "", enUnit: "", precision: 0, min: 0, max: 255, step: 1, pollGroup: "telemetry_15s", freshnessBudgetS: 30, labelUk: "Номер комірки з мін. напругою (нативний регістр)", labelEn: "Min voltage cell index (native register)", uiSection: "diagnostics", uiOrder: 1120, uiGroup: null, editorKind: "readonly", enumMap: null },
      cell_resistance_1: { unit: "mΩ", ukUnit: "мОм", enUnit: "mΩ", precision: 3, min: 0, max: 65.535, step: 0.001, pollGroup: "cell_block_1s", freshnessBudgetS: 3, labelUk: "Опір проводу комірки 01", labelEn: "Cell wire resistance 01", uiSection: "cells", uiOrder: 1201, uiGroup: null, editorKind: "readonly", enumMap: null },
      cell_resistance_2: { unit: "mΩ", ukUnit: "мОм", enUnit: "mΩ", precision: 3, min: 0, max: 65.535, step: 0.001, pollGroup: "cell_block_1s", freshnessBudgetS: 3, labelUk: "Опір проводу комірки 02", labelEn: "Cell wire resistance 02", uiSection: "cells", uiOrder: 1202, uiGroup: null, editorKind: "readonly", enumMap: null },
      cell_resistance_3: { unit: "mΩ", ukUnit: "мОм", enUnit: "mΩ", precision: 3, min: 0, max: 65.535, step: 0.001, pollGroup: "cell_block_1s", freshnessBudgetS: 3, labelUk: "Опір проводу комірки 03", labelEn: "Cell wire resistance 03", uiSection: "cells", uiOrder: 1203, uiGroup: null, editorKind: "readonly", enumMap: null },
      cell_resistance_4: { unit: "mΩ", ukUnit: "мОм", enUnit: "mΩ", precision: 3, min: 0, max: 65.535, step: 0.001, pollGroup: "cell_block_1s", freshnessBudgetS: 3, labelUk: "Опір проводу комірки 04", labelEn: "Cell wire resistance 04", uiSection: "cells", uiOrder: 1204, uiGroup: null, editorKind: "readonly", enumMap: null },
      cell_resistance_5: { unit: "mΩ", ukUnit: "мОм", enUnit: "mΩ", precision: 3, min: 0, max: 65.535, step: 0.001, pollGroup: "cell_block_1s", freshnessBudgetS: 3, labelUk: "Опір проводу комірки 05", labelEn: "Cell wire resistance 05", uiSection: "cells", uiOrder: 1205, uiGroup: null, editorKind: "readonly", enumMap: null },
      cell_resistance_6: { unit: "mΩ", ukUnit: "мОм", enUnit: "mΩ", precision: 3, min: 0, max: 65.535, step: 0.001, pollGroup: "cell_block_1s", freshnessBudgetS: 3, labelUk: "Опір проводу комірки 06", labelEn: "Cell wire resistance 06", uiSection: "cells", uiOrder: 1206, uiGroup: null, editorKind: "readonly", enumMap: null },
      cell_resistance_7: { unit: "mΩ", ukUnit: "мОм", enUnit: "mΩ", precision: 3, min: 0, max: 65.535, step: 0.001, pollGroup: "cell_block_1s", freshnessBudgetS: 3, labelUk: "Опір проводу комірки 07", labelEn: "Cell wire resistance 07", uiSection: "cells", uiOrder: 1207, uiGroup: null, editorKind: "readonly", enumMap: null },
      cell_resistance_8: { unit: "mΩ", ukUnit: "мОм", enUnit: "mΩ", precision: 3, min: 0, max: 65.535, step: 0.001, pollGroup: "cell_block_1s", freshnessBudgetS: 3, labelUk: "Опір проводу комірки 08", labelEn: "Cell wire resistance 08", uiSection: "cells", uiOrder: 1208, uiGroup: null, editorKind: "readonly", enumMap: null },
      cell_resistance_9: { unit: "mΩ", ukUnit: "мОм", enUnit: "mΩ", precision: 3, min: 0, max: 65.535, step: 0.001, pollGroup: "cell_block_1s", freshnessBudgetS: 3, labelUk: "Опір проводу комірки 09", labelEn: "Cell wire resistance 09", uiSection: "cells", uiOrder: 1209, uiGroup: null, editorKind: "readonly", enumMap: null },
      cell_resistance_10: { unit: "mΩ", ukUnit: "мОм", enUnit: "mΩ", precision: 3, min: 0, max: 65.535, step: 0.001, pollGroup: "cell_block_1s", freshnessBudgetS: 3, labelUk: "Опір проводу комірки 10", labelEn: "Cell wire resistance 10", uiSection: "cells", uiOrder: 1210, uiGroup: null, editorKind: "readonly", enumMap: null },
      cell_resistance_11: { unit: "mΩ", ukUnit: "мОм", enUnit: "mΩ", precision: 3, min: 0, max: 65.535, step: 0.001, pollGroup: "cell_block_1s", freshnessBudgetS: 3, labelUk: "Опір проводу комірки 11", labelEn: "Cell wire resistance 11", uiSection: "cells", uiOrder: 1211, uiGroup: null, editorKind: "readonly", enumMap: null },
      cell_resistance_12: { unit: "mΩ", ukUnit: "мОм", enUnit: "mΩ", precision: 3, min: 0, max: 65.535, step: 0.001, pollGroup: "cell_block_1s", freshnessBudgetS: 3, labelUk: "Опір проводу комірки 12", labelEn: "Cell wire resistance 12", uiSection: "cells", uiOrder: 1212, uiGroup: null, editorKind: "readonly", enumMap: null },
      cell_resistance_13: { unit: "mΩ", ukUnit: "мОм", enUnit: "mΩ", precision: 3, min: 0, max: 65.535, step: 0.001, pollGroup: "cell_block_1s", freshnessBudgetS: 3, labelUk: "Опір проводу комірки 13", labelEn: "Cell wire resistance 13", uiSection: "cells", uiOrder: 1213, uiGroup: null, editorKind: "readonly", enumMap: null },
      cell_resistance_14: { unit: "mΩ", ukUnit: "мОм", enUnit: "mΩ", precision: 3, min: 0, max: 65.535, step: 0.001, pollGroup: "cell_block_1s", freshnessBudgetS: 3, labelUk: "Опір проводу комірки 14", labelEn: "Cell wire resistance 14", uiSection: "cells", uiOrder: 1214, uiGroup: null, editorKind: "readonly", enumMap: null },
      cell_resistance_15: { unit: "mΩ", ukUnit: "мОм", enUnit: "mΩ", precision: 3, min: 0, max: 65.535, step: 0.001, pollGroup: "cell_block_1s", freshnessBudgetS: 3, labelUk: "Опір проводу комірки 15", labelEn: "Cell wire resistance 15", uiSection: "cells", uiOrder: 1215, uiGroup: null, editorKind: "readonly", enumMap: null },
      cell_resistance_16: { unit: "mΩ", ukUnit: "мОм", enUnit: "mΩ", precision: 3, min: 0, max: 65.535, step: 0.001, pollGroup: "cell_block_1s", freshnessBudgetS: 3, labelUk: "Опір проводу комірки 16", labelEn: "Cell wire resistance 16", uiSection: "cells", uiOrder: 1216, uiGroup: null, editorKind: "readonly", enumMap: null },
      cell_resistance_17: { unit: "mΩ", ukUnit: "мОм", enUnit: "mΩ", precision: 3, min: 0, max: 65.535, step: 0.001, pollGroup: "telemetry_15s", freshnessBudgetS: 30, labelUk: "Опір проводу комірки 17", labelEn: "Cell wire resistance 17", uiSection: "cells", uiOrder: 1217, uiGroup: null, editorKind: "readonly", enumMap: null },
      cell_resistance_18: { unit: "mΩ", ukUnit: "мОм", enUnit: "mΩ", precision: 3, min: 0, max: 65.535, step: 0.001, pollGroup: "telemetry_15s", freshnessBudgetS: 30, labelUk: "Опір проводу комірки 18", labelEn: "Cell wire resistance 18", uiSection: "cells", uiOrder: 1218, uiGroup: null, editorKind: "readonly", enumMap: null },
      cell_resistance_19: { unit: "mΩ", ukUnit: "мОм", enUnit: "mΩ", precision: 3, min: 0, max: 65.535, step: 0.001, pollGroup: "telemetry_15s", freshnessBudgetS: 30, labelUk: "Опір проводу комірки 19", labelEn: "Cell wire resistance 19", uiSection: "cells", uiOrder: 1219, uiGroup: null, editorKind: "readonly", enumMap: null },
      cell_resistance_20: { unit: "mΩ", ukUnit: "мОм", enUnit: "mΩ", precision: 3, min: 0, max: 65.535, step: 0.001, pollGroup: "telemetry_15s", freshnessBudgetS: 30, labelUk: "Опір проводу комірки 20", labelEn: "Cell wire resistance 20", uiSection: "cells", uiOrder: 1220, uiGroup: null, editorKind: "readonly", enumMap: null },
      cell_resistance_21: { unit: "mΩ", ukUnit: "мОм", enUnit: "mΩ", precision: 3, min: 0, max: 65.535, step: 0.001, pollGroup: "telemetry_15s", freshnessBudgetS: 30, labelUk: "Опір проводу комірки 21", labelEn: "Cell wire resistance 21", uiSection: "cells", uiOrder: 1221, uiGroup: null, editorKind: "readonly", enumMap: null },
      cell_resistance_22: { unit: "mΩ", ukUnit: "мОм", enUnit: "mΩ", precision: 3, min: 0, max: 65.535, step: 0.001, pollGroup: "telemetry_15s", freshnessBudgetS: 30, labelUk: "Опір проводу комірки 22", labelEn: "Cell wire resistance 22", uiSection: "cells", uiOrder: 1222, uiGroup: null, editorKind: "readonly", enumMap: null },
      cell_resistance_23: { unit: "mΩ", ukUnit: "мОм", enUnit: "mΩ", precision: 3, min: 0, max: 65.535, step: 0.001, pollGroup: "telemetry_15s", freshnessBudgetS: 30, labelUk: "Опір проводу комірки 23", labelEn: "Cell wire resistance 23", uiSection: "cells", uiOrder: 1223, uiGroup: null, editorKind: "readonly", enumMap: null },
      cell_resistance_24: { unit: "mΩ", ukUnit: "мОм", enUnit: "mΩ", precision: 3, min: 0, max: 65.535, step: 0.001, pollGroup: "telemetry_15s", freshnessBudgetS: 30, labelUk: "Опір проводу комірки 24", labelEn: "Cell wire resistance 24", uiSection: "cells", uiOrder: 1224, uiGroup: null, editorKind: "readonly", enumMap: null },
      cell_resistance_25: { unit: "mΩ", ukUnit: "мОм", enUnit: "mΩ", precision: 3, min: 0, max: 65.535, step: 0.001, pollGroup: "telemetry_15s", freshnessBudgetS: 30, labelUk: "Опір проводу комірки 25", labelEn: "Cell wire resistance 25", uiSection: "cells", uiOrder: 1225, uiGroup: null, editorKind: "readonly", enumMap: null },
      cell_resistance_26: { unit: "mΩ", ukUnit: "мОм", enUnit: "mΩ", precision: 3, min: 0, max: 65.535, step: 0.001, pollGroup: "telemetry_15s", freshnessBudgetS: 30, labelUk: "Опір проводу комірки 26", labelEn: "Cell wire resistance 26", uiSection: "cells", uiOrder: 1226, uiGroup: null, editorKind: "readonly", enumMap: null },
      cell_resistance_27: { unit: "mΩ", ukUnit: "мОм", enUnit: "mΩ", precision: 3, min: 0, max: 65.535, step: 0.001, pollGroup: "telemetry_15s", freshnessBudgetS: 30, labelUk: "Опір проводу комірки 27", labelEn: "Cell wire resistance 27", uiSection: "cells", uiOrder: 1227, uiGroup: null, editorKind: "readonly", enumMap: null },
      cell_resistance_28: { unit: "mΩ", ukUnit: "мОм", enUnit: "mΩ", precision: 3, min: 0, max: 65.535, step: 0.001, pollGroup: "telemetry_15s", freshnessBudgetS: 30, labelUk: "Опір проводу комірки 28", labelEn: "Cell wire resistance 28", uiSection: "cells", uiOrder: 1228, uiGroup: null, editorKind: "readonly", enumMap: null },
      cell_resistance_29: { unit: "mΩ", ukUnit: "мОм", enUnit: "mΩ", precision: 3, min: 0, max: 65.535, step: 0.001, pollGroup: "telemetry_15s", freshnessBudgetS: 30, labelUk: "Опір проводу комірки 29", labelEn: "Cell wire resistance 29", uiSection: "cells", uiOrder: 1229, uiGroup: null, editorKind: "readonly", enumMap: null },
      cell_resistance_30: { unit: "mΩ", ukUnit: "мОм", enUnit: "mΩ", precision: 3, min: 0, max: 65.535, step: 0.001, pollGroup: "telemetry_15s", freshnessBudgetS: 30, labelUk: "Опір проводу комірки 30", labelEn: "Cell wire resistance 30", uiSection: "cells", uiOrder: 1230, uiGroup: null, editorKind: "readonly", enumMap: null },
      cell_resistance_31: { unit: "mΩ", ukUnit: "мОм", enUnit: "mΩ", precision: 3, min: 0, max: 65.535, step: 0.001, pollGroup: "telemetry_15s", freshnessBudgetS: 30, labelUk: "Опір проводу комірки 31", labelEn: "Cell wire resistance 31", uiSection: "cells", uiOrder: 1231, uiGroup: null, editorKind: "readonly", enumMap: null },
      cell_resistance_32: { unit: "mΩ", ukUnit: "мОм", enUnit: "mΩ", precision: 3, min: 0, max: 65.535, step: 0.001, pollGroup: "telemetry_15s", freshnessBudgetS: 30, labelUk: "Опір проводу комірки 32", labelEn: "Cell wire resistance 32", uiSection: "cells", uiOrder: 1232, uiGroup: null, editorKind: "readonly", enumMap: null },
      mosfet_temperature: { unit: "°C", ukUnit: "°C", enUnit: "°C", precision: 1, min: -100, max: 200, step: 0.1, pollGroup: "telemetry_15s", freshnessBudgetS: 30, labelUk: "Температура MOSFET", labelEn: "MOSFET temperature", uiSection: "cells", uiOrder: 1310, uiGroup: null, editorKind: "readonly", enumMap: null },
      cell_wire_resistance_status_mask: { unit: "", ukUnit: "", enUnit: "", precision: 0, min: 0, max: 4294967295, step: 1, pollGroup: "telemetry_15s", freshnessBudgetS: 30, labelUk: "Маска стану опору проводів комірок (нативний регістр)", labelEn: "Cell wire resistance status mask (native register)", uiSection: "diagnostics", uiOrder: 1130, uiGroup: null, editorKind: "readonly", enumMap: null },
      total_voltage_raw: { unit: "V", ukUnit: "В", enUnit: "V", precision: 3, min: 0, max: 200, step: 0.001, pollGroup: "telemetry_15s", freshnessBudgetS: 30, labelUk: "Напруга батареї (нативний регістр)", labelEn: "Battery voltage (native register)", uiSection: "diagnostics", uiOrder: 1320, uiGroup: null, editorKind: "readonly", enumMap: null },
      native_bms_power: { unit: "W", ukUnit: "Вт", enUnit: "W", precision: 3, min: 0, max: 100000, step: 0.001, pollGroup: "telemetry_15s", freshnessBudgetS: 30, labelUk: "Потужність BMS (нативне значення)", labelEn: "Native BMS power", uiSection: "diagnostics", uiOrder: 1330, uiGroup: null, editorKind: "readonly", enumMap: null },
      current_raw: { unit: "A", ukUnit: "А", enUnit: "A", precision: 3, min: -3000, max: 3000, step: 0.001, pollGroup: "telemetry_15s", freshnessBudgetS: 30, labelUk: "Струм (нативний регістр)", labelEn: "Current (native register)", uiSection: "diagnostics", uiOrder: 1340, uiGroup: null, editorKind: "readonly", enumMap: null },
      temperature_1: { unit: "°C", ukUnit: "°C", enUnit: "°C", precision: 1, min: -100, max: 200, step: 0.1, pollGroup: "telemetry_15s", freshnessBudgetS: 30, labelUk: "Температура 1", labelEn: "Temperature 1", uiSection: "diagnostics", uiOrder: 1350, uiGroup: null, editorKind: "readonly", enumMap: null },
      temperature_2: { unit: "°C", ukUnit: "°C", enUnit: "°C", precision: 1, min: -100, max: 200, step: 0.1, pollGroup: "telemetry_15s", freshnessBudgetS: 30, labelUk: "Температура 2", labelEn: "Temperature 2", uiSection: "diagnostics", uiOrder: 1360, uiGroup: null, editorKind: "readonly", enumMap: null },
      alarms_bitmask: { unit: "", ukUnit: "", enUnit: "", precision: 0, min: 0, max: 4294967295, step: 1, pollGroup: "telemetry_15s", freshnessBudgetS: 30, labelUk: "Маска тривог", labelEn: "Alarms bitmask", uiSection: "diagnostics", uiOrder: 1370, uiGroup: null, editorKind: "readonly", enumMap: null },
      alarm_wire_res: { unit: "", ukUnit: "", enUnit: "", precision: 0, min: 0, max: 1, step: 1, pollGroup: "telemetry_15s", freshnessBudgetS: 30, labelUk: "Тривога: Занадто високий опір балансувального дроту (активна = так)", labelEn: "Alarm: Wire resistance too high (On = active)", uiSection: "diagnostics", uiOrder: 1600, uiGroup: null, editorKind: "readonly", enumMap: null },
      alarm_mos_otp: { unit: "", ukUnit: "", enUnit: "", precision: 0, min: 0, max: 1, step: 1, pollGroup: "telemetry_15s", freshnessBudgetS: 30, labelUk: "Тривога: Перегрів MOS (активна = так)", labelEn: "Alarm: MOS over-temperature (On = active)", uiSection: "diagnostics", uiOrder: 1601, uiGroup: null, editorKind: "readonly", enumMap: null },
      alarm_cell_quantity: { unit: "", ukUnit: "", enUnit: "", precision: 0, min: 0, max: 1, step: 1, pollGroup: "telemetry_15s", freshnessBudgetS: 30, labelUk: "Тривога: Кількість комірок не відповідає налаштуванню (активна = так)", labelEn: "Alarm: Cell quantity mismatch (On = active)", uiSection: "diagnostics", uiOrder: 1602, uiGroup: null, editorKind: "readonly", enumMap: null },
      alarm_cur_sensor_err: { unit: "", ukUnit: "", enUnit: "", precision: 0, min: 0, max: 1, step: 1, pollGroup: "telemetry_15s", freshnessBudgetS: 30, labelUk: "Тривога: Помилка датчика струму (активна = так)", labelEn: "Alarm: Current sensor error (On = active)", uiSection: "diagnostics", uiOrder: 1603, uiGroup: null, editorKind: "readonly", enumMap: null },
      alarm_cell_ovp: { unit: "", ukUnit: "", enUnit: "", precision: 0, min: 0, max: 1, step: 1, pollGroup: "telemetry_15s", freshnessBudgetS: 30, labelUk: "Тривога: Захист від перенапруги комірки (активна = так)", labelEn: "Alarm: Cell overvoltage protection (On = active)", uiSection: "diagnostics", uiOrder: 1604, uiGroup: null, editorKind: "readonly", enumMap: null },
      alarm_bat_ovp: { unit: "", ukUnit: "", enUnit: "", precision: 0, min: 0, max: 1, step: 1, pollGroup: "telemetry_15s", freshnessBudgetS: 30, labelUk: "Тривога: Захист від перенапруги батареї (активна = так)", labelEn: "Alarm: Battery overvoltage protection (On = active)", uiSection: "diagnostics", uiOrder: 1605, uiGroup: null, editorKind: "readonly", enumMap: null },
      alarm_ch_ocp: { unit: "", ukUnit: "", enUnit: "", precision: 0, min: 0, max: 1, step: 1, pollGroup: "telemetry_15s", freshnessBudgetS: 30, labelUk: "Тривога: Захист від надструму заряду (активна = так)", labelEn: "Alarm: Charge overcurrent protection (On = active)", uiSection: "diagnostics", uiOrder: 1606, uiGroup: null, editorKind: "readonly", enumMap: null },
      alarm_ch_scp: { unit: "", ukUnit: "", enUnit: "", precision: 0, min: 0, max: 1, step: 1, pollGroup: "telemetry_15s", freshnessBudgetS: 30, labelUk: "Тривога: Захист від короткого замикання заряду (активна = так)", labelEn: "Alarm: Charge short-circuit protection (On = active)", uiSection: "diagnostics", uiOrder: 1607, uiGroup: null, editorKind: "readonly", enumMap: null },
      alarm_ch_otp: { unit: "", ukUnit: "", enUnit: "", precision: 0, min: 0, max: 1, step: 1, pollGroup: "telemetry_15s", freshnessBudgetS: 30, labelUk: "Тривога: Захист від перегріву заряду (активна = так)", labelEn: "Alarm: Charge over-temperature protection (On = active)", uiSection: "diagnostics", uiOrder: 1608, uiGroup: null, editorKind: "readonly", enumMap: null },
      alarm_ch_utp: { unit: "", ukUnit: "", enUnit: "", precision: 0, min: 0, max: 1, step: 1, pollGroup: "telemetry_15s", freshnessBudgetS: 30, labelUk: "Тривога: Захист від низької температури заряду (активна = так)", labelEn: "Alarm: Charge under-temperature protection (On = active)", uiSection: "diagnostics", uiOrder: 1609, uiGroup: null, editorKind: "readonly", enumMap: null },
      alarm_cpu_aux_commu_err: { unit: "", ukUnit: "", enUnit: "", precision: 0, min: 0, max: 1, step: 1, pollGroup: "telemetry_15s", freshnessBudgetS: 30, labelUk: "Тривога: Помилка внутрішньої комунікації (активна = так)", labelEn: "Alarm: Internal communication error (On = active)", uiSection: "diagnostics", uiOrder: 1610, uiGroup: null, editorKind: "readonly", enumMap: null },
      alarm_cell_uvp: { unit: "", ukUnit: "", enUnit: "", precision: 0, min: 0, max: 1, step: 1, pollGroup: "telemetry_15s", freshnessBudgetS: 30, labelUk: "Тривога: Захист від глибокого розряду комірки (активна = так)", labelEn: "Alarm: Cell undervoltage protection (On = active)", uiSection: "diagnostics", uiOrder: 1611, uiGroup: null, editorKind: "readonly", enumMap: null },
      alarm_bat_uvp: { unit: "", ukUnit: "", enUnit: "", precision: 0, min: 0, max: 1, step: 1, pollGroup: "telemetry_15s", freshnessBudgetS: 30, labelUk: "Тривога: Захист від глибокого розряду батареї (активна = так)", labelEn: "Alarm: Battery undervoltage protection (On = active)", uiSection: "diagnostics", uiOrder: 1612, uiGroup: null, editorKind: "readonly", enumMap: null },
      alarm_dch_ocp: { unit: "", ukUnit: "", enUnit: "", precision: 0, min: 0, max: 1, step: 1, pollGroup: "telemetry_15s", freshnessBudgetS: 30, labelUk: "Тривога: Захист від надструму розряду (активна = так)", labelEn: "Alarm: Discharge overcurrent protection (On = active)", uiSection: "diagnostics", uiOrder: 1613, uiGroup: null, editorKind: "readonly", enumMap: null },
      alarm_dch_scp: { unit: "", ukUnit: "", enUnit: "", precision: 0, min: 0, max: 1, step: 1, pollGroup: "telemetry_15s", freshnessBudgetS: 30, labelUk: "Тривога: Захист від короткого замикання розряду (активна = так)", labelEn: "Alarm: Discharge short-circuit protection (On = active)", uiSection: "diagnostics", uiOrder: 1614, uiGroup: null, editorKind: "readonly", enumMap: null },
      alarm_dch_otp: { unit: "", ukUnit: "", enUnit: "", precision: 0, min: 0, max: 1, step: 1, pollGroup: "telemetry_15s", freshnessBudgetS: 30, labelUk: "Тривога: Захист від перегріву розряду (активна = так)", labelEn: "Alarm: Discharge over-temperature protection (On = active)", uiSection: "diagnostics", uiOrder: 1615, uiGroup: null, editorKind: "readonly", enumMap: null },
      alarm_charge_mos: { unit: "", ukUnit: "", enUnit: "", precision: 0, min: 0, max: 1, step: 1, pollGroup: "telemetry_15s", freshnessBudgetS: 30, labelUk: "Тривога: Несправність зарядного MOS (активна = так)", labelEn: "Alarm: Charge MOS fault (On = active)", uiSection: "diagnostics", uiOrder: 1616, uiGroup: null, editorKind: "readonly", enumMap: null },
      alarm_discharge_mos: { unit: "", ukUnit: "", enUnit: "", precision: 0, min: 0, max: 1, step: 1, pollGroup: "telemetry_15s", freshnessBudgetS: 30, labelUk: "Тривога: Несправність розрядного MOS (активна = так)", labelEn: "Alarm: Discharge MOS fault (On = active)", uiSection: "diagnostics", uiOrder: 1617, uiGroup: null, editorKind: "readonly", enumMap: null },
      gps_disconnected: { unit: "", ukUnit: "", enUnit: "", precision: 0, min: 0, max: 1, step: 1, pollGroup: "telemetry_15s", freshnessBudgetS: 30, labelUk: "Тривога: GPS відключено (активна = так)", labelEn: "Alarm: GPS disconnected (On = active)", uiSection: "diagnostics", uiOrder: 1618, uiGroup: null, editorKind: "readonly", enumMap: null },
      modify_pwd_in_time: { unit: "", ukUnit: "", enUnit: "", precision: 0, min: 0, max: 1, step: 1, pollGroup: "telemetry_15s", freshnessBudgetS: 30, labelUk: "Тривога: Потрібна своєчасна зміна пароля (активна = так)", labelEn: "Alarm: Password change reminder (On = active)", uiSection: "diagnostics", uiOrder: 1619, uiGroup: null, editorKind: "readonly", enumMap: null },
      discharge_on_failed: { unit: "", ukUnit: "", enUnit: "", precision: 0, min: 0, max: 1, step: 1, pollGroup: "telemetry_15s", freshnessBudgetS: 30, labelUk: "Тривога: Не вдалося увімкнути розряд (активна = так)", labelEn: "Alarm: Discharge enable failed (On = active)", uiSection: "diagnostics", uiOrder: 1620, uiGroup: null, editorKind: "readonly", enumMap: null },
      battery_over_temp_alarm: { unit: "", ukUnit: "", enUnit: "", precision: 0, min: 0, max: 1, step: 1, pollGroup: "telemetry_15s", freshnessBudgetS: 30, labelUk: "Тривога: Перегрів батареї (активна = так)", labelEn: "Alarm: Battery over-temperature alarm (On = active)", uiSection: "diagnostics", uiOrder: 1621, uiGroup: null, editorKind: "readonly", enumMap: null },
      balance_current: { unit: "A", ukUnit: "А", enUnit: "A", precision: 3, min: -20, max: 20, step: 0.001, pollGroup: "telemetry_15s", freshnessBudgetS: 30, labelUk: "Струм балансування", labelEn: "Balance current", uiSection: "cells", uiOrder: 1380, uiGroup: null, editorKind: "readonly", enumMap: null },
      balancing_active: { unit: "", ukUnit: "", enUnit: "", precision: 0, min: 0, max: 2, step: 1, pollGroup: "telemetry_15s", freshnessBudgetS: 30, labelUk: "Балансування активне", labelEn: "Balancing active", uiSection: "diagnostics", uiOrder: 1390, uiGroup: null, editorKind: "readonly", enumMap: Object.freeze({ "0": "idle", "1": "charge_direction", "2": "discharge_direction" }) },
      state_of_charge: { unit: "%", ukUnit: "%", enUnit: "%", precision: 0, min: 0, max: 100, step: 1, pollGroup: "telemetry_15s", freshnessBudgetS: 30, labelUk: "Рівень заряду (SOC)", labelEn: "State of charge (SOC)", uiSection: "overview", uiOrder: 1400, uiGroup: null, editorKind: "readonly", enumMap: null },
      capacity_remaining: { unit: "Ah", ukUnit: "А·год", enUnit: "Ah", precision: 3, min: 0, max: 2000, step: 0.001, pollGroup: "telemetry_15s", freshnessBudgetS: 30, labelUk: "Залишкова ємність", labelEn: "Capacity remaining", uiSection: "overview", uiOrder: 1410, uiGroup: null, editorKind: "readonly", enumMap: null },
      full_charge_capacity: { unit: "Ah", ukUnit: "А·год", enUnit: "Ah", precision: 3, min: 0, max: 2000, step: 0.001, pollGroup: "telemetry_15s", freshnessBudgetS: 30, labelUk: "Повна зарядна ємність BMS", labelEn: "Full charge capacity", uiSection: "diagnostics", uiOrder: 1420, uiGroup: null, editorKind: "readonly", enumMap: null },
      charging_cycles: { unit: "", ukUnit: "", enUnit: "", precision: 0, min: 0, max: 4294967295, step: 1, pollGroup: "telemetry_15s", freshnessBudgetS: 30, labelUk: "Цикли заряду", labelEn: "Charging cycles", uiSection: "diagnostics", uiOrder: 1430, uiGroup: null, editorKind: "readonly", enumMap: null },
      cycle_capacity: { unit: "Ah", ukUnit: "А·год", enUnit: "Ah", precision: 3, min: 0, max: 2000000, step: 0.001, pollGroup: "telemetry_15s", freshnessBudgetS: 30, labelUk: "Загальна віддана ємність", labelEn: "Total charging cycle capacity", uiSection: "diagnostics", uiOrder: 1440, uiGroup: null, editorKind: "readonly", enumMap: null },
      state_of_health: { unit: "%", ukUnit: "%", enUnit: "%", precision: 0, min: 0, max: 100, step: 1, pollGroup: "telemetry_15s", freshnessBudgetS: 30, labelUk: "Стан здоров'я батареї (SOH)", labelEn: "State of health (SOH)", uiSection: "overview", uiOrder: 1450, uiGroup: null, editorKind: "readonly", enumMap: null },
      precharge_status: { unit: "", ukUnit: "", enUnit: "", precision: 0, min: 0, max: 1, step: 1, pollGroup: "telemetry_15s", freshnessBudgetS: 30, labelUk: "Стан попереднього заряду", labelEn: "Precharge status", uiSection: "diagnostics", uiOrder: 1460, uiGroup: null, editorKind: "readonly", enumMap: null },
      custom_alarm_1: { unit: "", ukUnit: "", enUnit: "", precision: 0, min: 0, max: 65535, step: 1, pollGroup: "telemetry_15s", freshnessBudgetS: 30, labelUk: "Користувацька тривога 1", labelEn: "Custom alarm 1", uiSection: "diagnostics", uiOrder: 1470, uiGroup: null, editorKind: "readonly", enumMap: null },
      total_runtime: { unit: "s", ukUnit: "с", enUnit: "s", precision: 0, min: 0, max: 4294967295, step: 1, pollGroup: "telemetry_15s", freshnessBudgetS: 30, labelUk: "Час роботи", labelEn: "Runtime", uiSection: "diagnostics", uiOrder: 1480, uiGroup: null, editorKind: "readonly", enumMap: null },
      charging_active: { unit: "", ukUnit: "", enUnit: "", precision: 0, min: 0, max: 1, step: 1, pollGroup: "telemetry_15s", freshnessBudgetS: 30, labelUk: "Заряд активний", labelEn: "Charging active", uiSection: "overview", uiOrder: 1490, uiGroup: null, editorKind: "readonly", enumMap: null },
      discharging_active: { unit: "", ukUnit: "", enUnit: "", precision: 0, min: 0, max: 1, step: 1, pollGroup: "telemetry_15s", freshnessBudgetS: 30, labelUk: "Розряд активний", labelEn: "Discharging active", uiSection: "overview", uiOrder: 1500, uiGroup: null, editorKind: "readonly", enumMap: null },
      custom_alarm_2: { unit: "", ukUnit: "", enUnit: "", precision: 0, min: 0, max: 65535, step: 1, pollGroup: "telemetry_15s", freshnessBudgetS: 30, labelUk: "Користувацька тривога 2", labelEn: "Custom alarm 2", uiSection: "diagnostics", uiOrder: 1510, uiGroup: null, editorKind: "readonly", enumMap: null },
      discharge_ocpr_left: { unit: "s", ukUnit: "с", enUnit: "s", precision: 0, min: 0, max: 65535, step: 1, pollGroup: "telemetry_15s", freshnessBudgetS: 30, labelUk: "Залишок відновлення OCP розряду", labelEn: "Discharge OCP recovery remaining", uiSection: "diagnostics", uiOrder: 1520, uiGroup: null, editorKind: "readonly", enumMap: null },
      discharge_scpr_left: { unit: "s", ukUnit: "с", enUnit: "s", precision: 0, min: 0, max: 65535, step: 1, pollGroup: "telemetry_15s", freshnessBudgetS: 30, labelUk: "Залишок відновлення SCP розряду", labelEn: "Discharge SCP recovery remaining", uiSection: "diagnostics", uiOrder: 1530, uiGroup: null, editorKind: "readonly", enumMap: null },
      charge_ocpr_left: { unit: "s", ukUnit: "с", enUnit: "s", precision: 0, min: 0, max: 65535, step: 1, pollGroup: "telemetry_15s", freshnessBudgetS: 30, labelUk: "Залишок відновлення OCP заряду", labelEn: "Charge OCP recovery remaining", uiSection: "diagnostics", uiOrder: 1540, uiGroup: null, editorKind: "readonly", enumMap: null },
      charge_scpr_left: { unit: "s", ukUnit: "с", enUnit: "s", precision: 0, min: 0, max: 65535, step: 1, pollGroup: "telemetry_15s", freshnessBudgetS: 30, labelUk: "Залишок відновлення SCP заряду", labelEn: "Charge SCP recovery remaining", uiSection: "diagnostics", uiOrder: 1550, uiGroup: null, editorKind: "readonly", enumMap: null },
      uvpr_left: { unit: "s", ukUnit: "с", enUnit: "s", precision: 0, min: 0, max: 65535, step: 1, pollGroup: "telemetry_15s", freshnessBudgetS: 30, labelUk: "Залишок відновлення після низької напруги", labelEn: "UVP recovery remaining", uiSection: "diagnostics", uiOrder: 1560, uiGroup: null, editorKind: "readonly", enumMap: null },
      ovpr_left: { unit: "s", ukUnit: "с", enUnit: "s", precision: 0, min: 0, max: 65535, step: 1, pollGroup: "telemetry_15s", freshnessBudgetS: 30, labelUk: "Залишок відновлення після перенапруги", labelEn: "OVP recovery remaining", uiSection: "diagnostics", uiOrder: 1570, uiGroup: null, editorKind: "readonly", enumMap: null },
      sensor_heating_mask: { unit: "", ukUnit: "", enUnit: "", precision: 0, min: 0, max: 65535, step: 1, pollGroup: "telemetry_15s", freshnessBudgetS: 30, labelUk: "Маска відсутніх датчиків / стан підігріву", labelEn: "Absent-sensor mask / heating status", uiSection: "diagnostics", uiOrder: 1580, uiGroup: null, editorKind: "readonly", enumMap: null },
      heating_active: { unit: "", ukUnit: "", enUnit: "", precision: 0, min: 0, max: 1, step: 1, pollGroup: "telemetry_15s", freshnessBudgetS: 30, labelUk: "Нагрів активний", labelEn: "Heating active", uiSection: "diagnostics", uiOrder: 1581, uiGroup: null, editorKind: "readonly", enumMap: null },
      bat_temp_sensor_1_present: { unit: "", ukUnit: "", enUnit: "", precision: 0, min: 0, max: 1, step: 1, pollGroup: "telemetry_15s", freshnessBudgetS: 30, labelUk: "Датчик температури батареї 1 присутній", labelEn: "Battery temp sensor 1 present", uiSection: "diagnostics", uiOrder: 1582, uiGroup: null, editorKind: "readonly", enumMap: null },
      bat_temp_sensor_2_present: { unit: "", ukUnit: "", enUnit: "", precision: 0, min: 0, max: 1, step: 1, pollGroup: "telemetry_15s", freshnessBudgetS: 30, labelUk: "Датчик температури батареї 2 присутній", labelEn: "Battery temp sensor 2 present", uiSection: "diagnostics", uiOrder: 1583, uiGroup: null, editorKind: "readonly", enumMap: null },
      bat_temp_sensor_3_present: { unit: "", ukUnit: "", enUnit: "", precision: 0, min: 0, max: 1, step: 1, pollGroup: "telemetry_15s", freshnessBudgetS: 30, labelUk: "Датчик температури батареї 3 присутній", labelEn: "Battery temp sensor 3 present", uiSection: "diagnostics", uiOrder: 1584, uiGroup: null, editorKind: "readonly", enumMap: null },
      bat_temp_sensor_4_present: { unit: "", ukUnit: "", enUnit: "", precision: 0, min: 0, max: 1, step: 1, pollGroup: "telemetry_15s", freshnessBudgetS: 30, labelUk: "Датчик температури батареї 4 присутній", labelEn: "Battery temp sensor 4 present", uiSection: "diagnostics", uiOrder: 1585, uiGroup: null, editorKind: "readonly", enumMap: null },
      bat_temp_sensor_5_present: { unit: "", ukUnit: "", enUnit: "", precision: 0, min: 0, max: 1, step: 1, pollGroup: "telemetry_15s", freshnessBudgetS: 30, labelUk: "Датчик температури батареї 5 присутній", labelEn: "Battery temp sensor 5 present", uiSection: "diagnostics", uiOrder: 1586, uiGroup: null, editorKind: "readonly", enumMap: null },
      mos_temp_sensor_status_bit_raw: { unit: "", ukUnit: "", enUnit: "", precision: 0, min: 0, max: 1, step: 1, pollGroup: "telemetry_15s", freshnessBudgetS: 30, labelUk: "MOS датчик температури, статус-біт (сирий, полярність підтверджена лише одним джерелом)", labelEn: "MOS temperature sensor status bit (raw, single-source polarity)", uiSection: "diagnostics", uiOrder: 1581, uiGroup: null, editorKind: "readonly", enumMap: null },
      reserved_0x12d2: { unit: "", ukUnit: "", enUnit: "", precision: 0, min: null, max: null, step: null, pollGroup: "telemetry_15s", freshnessBudgetS: 30, labelUk: "Зарезервовано (0x12D2)", labelEn: "Reserved (0x12D2)", uiSection: "none", uiOrder: 0, uiGroup: null, editorKind: "readonly", enumMap: null },
      emergency_timer: { unit: "s", ukUnit: "с", enUnit: "s", precision: 0, min: 0, max: 65535, step: 1, pollGroup: "telemetry_15s", freshnessBudgetS: 30, labelUk: "Аварійний таймер", labelEn: "Emergency timer", uiSection: "diagnostics", uiOrder: 1590, uiGroup: null, editorKind: "readonly", enumMap: null },
      battery_current_correction: { unit: "", ukUnit: "", enUnit: "", precision: 0, min: 0, max: 65535, step: 1, pollGroup: "telemetry_15s", freshnessBudgetS: 30, labelUk: "Корекція струму батареї", labelEn: "Battery current correction", uiSection: "diagnostics", uiOrder: 1600, uiGroup: null, editorKind: "readonly", enumMap: null },
      charge_current_measurement_voltage: { unit: "mV", ukUnit: "мВ", enUnit: "mV", precision: 0, min: 0, max: 65535, step: 1, pollGroup: "telemetry_15s", freshnessBudgetS: 30, labelUk: "Напруга вимірювання струму заряду", labelEn: "Charge current measurement voltage", uiSection: "diagnostics", uiOrder: 1610, uiGroup: null, editorKind: "readonly", enumMap: null },
      discharge_current_measurement_voltage: { unit: "mV", ukUnit: "мВ", enUnit: "mV", precision: 0, min: 0, max: 65535, step: 1, pollGroup: "telemetry_15s", freshnessBudgetS: 30, labelUk: "Напруга вимірювання струму розряду", labelEn: "Discharge current measurement voltage", uiSection: "diagnostics", uiOrder: 1620, uiGroup: null, editorKind: "readonly", enumMap: null },
      battery_voltage_correction: { unit: "", ukUnit: "", enUnit: "", precision: 6, min: null, max: null, step: 1, pollGroup: "telemetry_15s", freshnessBudgetS: 30, labelUk: "Корекція напруги батареї", labelEn: "Battery voltage correction", uiSection: "diagnostics", uiOrder: 1630, uiGroup: null, editorKind: "readonly", enumMap: null },
      alternate_battery_voltage: { unit: "V", ukUnit: "В", enUnit: "V", precision: 2, min: 0, max: 655.35, step: 0.01, pollGroup: "telemetry_15s", freshnessBudgetS: 30, labelUk: "Альтернативна напруга батареї", labelEn: "Alternate battery voltage", uiSection: "diagnostics", uiOrder: 1640, uiGroup: null, editorKind: "readonly", enumMap: null },
      heating_current: { unit: "A", ukUnit: "А", enUnit: "A", precision: 3, min: -20, max: 20, step: 0.001, pollGroup: "telemetry_15s", freshnessBudgetS: 30, labelUk: "Струм підігріву", labelEn: "Heating current", uiSection: "diagnostics", uiOrder: 1650, uiGroup: null, editorKind: "readonly", enumMap: null },
      rvd_12ee_h: { unit: "", ukUnit: "", enUnit: "", precision: 0, min: null, max: null, step: null, pollGroup: "telemetry_15s", freshnessBudgetS: 30, labelUk: "Зарезервовано (0x12EE, старший байт)", labelEn: "Reserved (0x12EE, high byte)", uiSection: "none", uiOrder: 0, uiGroup: null, editorKind: "readonly", enumMap: null },
      charger_plugged: { unit: "", ukUnit: "", enUnit: "", precision: 0, min: null, max: null, step: null, pollGroup: "telemetry_15s", freshnessBudgetS: 30, labelUk: "Стан підключення зарядного пристрою", labelEn: "Charger plugged state", uiSection: "settings", uiOrder: 716, uiGroup: null, editorKind: "readonly", enumMap: null },
      bms_system_ticks: { unit: "s", ukUnit: "с", enUnit: "s", precision: 1, min: 0, max: 429496729.5, step: 0.1, pollGroup: "telemetry_15s", freshnessBudgetS: 30, labelUk: "Системні тики BMS", labelEn: "BMS system ticks", uiSection: "diagnostics", uiOrder: 1660, uiGroup: null, editorKind: "readonly", enumMap: null },
      temperature_sensor_3: { unit: "°C", ukUnit: "°C", enUnit: "°C", precision: 1, min: -100, max: 200, step: 0.1, pollGroup: "telemetry_15s", freshnessBudgetS: 30, labelUk: "Температура 3", labelEn: "Temperature 3", uiSection: "diagnostics", uiOrder: 1670, uiGroup: null, editorKind: "readonly", enumMap: null },
      temperature_4: { unit: "°C", ukUnit: "°C", enUnit: "°C", precision: 1, min: -100, max: 200, step: 0.1, pollGroup: "telemetry_15s", freshnessBudgetS: 30, labelUk: "Температура 4", labelEn: "Temperature 4", uiSection: "diagnostics", uiOrder: 1680, uiGroup: null, editorKind: "readonly", enumMap: null },
      temperature_5: { unit: "°C", ukUnit: "°C", enUnit: "°C", precision: 1, min: -100, max: 200, step: 0.1, pollGroup: "telemetry_15s", freshnessBudgetS: 30, labelUk: "Температура 5", labelEn: "Temperature 5", uiSection: "diagnostics", uiOrder: 1690, uiGroup: null, editorKind: "readonly", enumMap: null },
      rtc_ticks: { unit: "s", ukUnit: "с", enUnit: "s", precision: 0, min: null, max: null, step: null, pollGroup: "telemetry_15s", freshnessBudgetS: 30, labelUk: "Лічильник RTC (з 2020-01-01)", labelEn: "RTC tick counter (since 2020-01-01)", uiSection: "settings", uiOrder: 705, uiGroup: null, editorKind: "readonly", enumMap: null },
      time_enter_sleep: { unit: "s", ukUnit: "с", enUnit: "s", precision: 0, min: null, max: null, step: null, pollGroup: "telemetry_15s", freshnessBudgetS: 30, labelUk: "Час до входу в сон", labelEn: "Time until sleep entry", uiSection: "settings", uiOrder: 706, uiGroup: null, editorKind: "readonly", enumMap: null },
      rvd_130c_l: { unit: "", ukUnit: "", enUnit: "", precision: 0, min: null, max: null, step: null, pollGroup: "telemetry_15s", freshnessBudgetS: 30, labelUk: "Зарезервовано (0x130C, молодший байт)", labelEn: "Reserved (0x130C, low byte)", uiSection: "none", uiOrder: 0, uiGroup: null, editorKind: "readonly", enumMap: null },
      pcl_module_sta: { unit: "", ukUnit: "", enUnit: "", precision: 0, min: null, max: null, step: null, pollGroup: "telemetry_15s", freshnessBudgetS: 30, labelUk: "Стан модуля обмеження паралельного струму", labelEn: "Parallel-current-limiting module state", uiSection: "settings", uiOrder: 717, uiGroup: null, editorKind: "readonly", enumMap: null },
      device_model: { unit: "", ukUnit: "", enUnit: "", precision: 0, min: null, max: null, step: null, pollGroup: "telemetry_15s", freshnessBudgetS: 30, labelUk: "Модель BMS", labelEn: "BMS model", uiSection: "diagnostics", uiOrder: 700, uiGroup: null, editorKind: "readonly", enumMap: null },
      hardware_version: { unit: "", ukUnit: "", enUnit: "", precision: 0, min: null, max: null, step: null, pollGroup: "telemetry_15s", freshnessBudgetS: 30, labelUk: "Апаратна версія BMS", labelEn: "Hardware version", uiSection: "settings", uiOrder: 701, uiGroup: null, editorKind: "readonly", enumMap: null },
      software_version: { unit: "", ukUnit: "", enUnit: "", precision: 0, min: null, max: null, step: null, pollGroup: "telemetry_15s", freshnessBudgetS: 30, labelUk: "Програмна версія BMS", labelEn: "Software version", uiSection: "settings", uiOrder: 702, uiGroup: null, editorKind: "readonly", enumMap: null },
      odd_run_time: { unit: "s", ukUnit: "с", enUnit: "s", precision: 0, min: null, max: null, step: null, pollGroup: "telemetry_15s", freshnessBudgetS: 30, labelUk: "Сумарний час роботи", labelEn: "Cumulative run time", uiSection: "settings", uiOrder: 703, uiGroup: null, editorKind: "readonly", enumMap: null },
      pwr_on_times: { unit: "", ukUnit: "", enUnit: "", precision: 0, min: null, max: null, step: null, pollGroup: "telemetry_15s", freshnessBudgetS: 30, labelUk: "Кількість вмикань живлення", labelEn: "Power-on count", uiSection: "settings", uiOrder: 704, uiGroup: null, editorKind: "readonly", enumMap: null },
      setup_passcode: { unit: "", ukUnit: "", enUnit: "", precision: 0, min: null, max: null, step: null, pollGroup: "on_demand_passcode", freshnessBudgetS: 5, labelUk: "Пароль налаштувань", labelEn: "Setup passcode", uiSection: "settings", uiOrder: 900, uiGroup: null, editorKind: "readonly", enumMap: null },
      uart1_mprtol_nbr: { unit: "", ukUnit: "", enUnit: "", precision: 0, min: null, max: null, step: null, pollGroup: "config_slow_300s", freshnessBudgetS: 320, labelUk: "Тип протоколу UART1", labelEn: "UART1 protocol type", uiSection: "settings", uiOrder: 712, uiGroup: null, editorKind: "readonly", enumMap: null },
      can_mprtol_nbr: { unit: "", ukUnit: "", enUnit: "", precision: 0, min: null, max: null, step: null, pollGroup: "config_slow_300s", freshnessBudgetS: 320, labelUk: "Тип протоколу CAN", labelEn: "CAN protocol type", uiSection: "settings", uiOrder: 713, uiGroup: null, editorKind: "readonly", enumMap: null },
      uart1_mprtol_enable: { unit: "", ukUnit: "", enUnit: "", precision: 0, min: null, max: null, step: null, pollGroup: "config_slow_300s", freshnessBudgetS: 320, labelUk: "UART1 протокол увімкнено (сирий hex)", labelEn: "UART1 protocol enable (raw hex)", uiSection: "diagnostics", uiOrder: 1700, uiGroup: null, editorKind: "readonly", enumMap: null },
      uart_mprtol_enable_0_15: { unit: "", ukUnit: "", enUnit: "", precision: 0, min: null, max: null, step: null, pollGroup: "config_slow_300s", freshnessBudgetS: 320, labelUk: "CAN протокол увімкнено [0-15] (сирий hex)", labelEn: "CAN protocol enable [0-15] (raw hex)", uiSection: "diagnostics", uiOrder: 1700, uiGroup: null, editorKind: "readonly", enumMap: null },
      uart2_mprtol_nbr: { unit: "", ukUnit: "", enUnit: "", precision: 0, min: null, max: null, step: null, pollGroup: "config_slow_300s", freshnessBudgetS: 320, labelUk: "Тип протоколу UART2", labelEn: "UART2 protocol type", uiSection: "settings", uiOrder: 714, uiGroup: null, editorKind: "readonly", enumMap: null },
      uart2_mprtol_enable_0: { unit: "", ukUnit: "", enUnit: "", precision: 0, min: null, max: null, step: null, pollGroup: "config_slow_300s", freshnessBudgetS: 320, labelUk: "UART2, протокол 0, стан увімкнення", labelEn: "UART2 protocol slot 0 enable state", uiSection: "settings", uiOrder: 715, uiGroup: null, editorKind: "readonly", enumMap: null },
      lcd_buzzer_trigger: { unit: "", ukUnit: "", enUnit: "", precision: 0, min: 0, max: 255, step: 1, pollGroup: "config_slow_300s", freshnessBudgetS: 320, labelUk: "Джерело спрацювання LCD-зумера", labelEn: "LCD/buzzer trigger source", uiSection: "settings", uiOrder: 540, uiGroup: null, editorKind: "readonly", enumMap: null },
      dry_contact_1_trigger_source: { unit: "", ukUnit: "", enUnit: "", precision: 0, min: 0, max: 12, step: 1, pollGroup: "config_slow_300s", freshnessBudgetS: 320, labelUk: "Джерело сухого контакту 1", labelEn: "Dry contact 1 trigger source", uiSection: "settings", uiOrder: 550, uiGroup: null, editorKind: "readonly", enumMap: null },
      dry_contact_2_trigger_source: { unit: "", ukUnit: "", enUnit: "", precision: 0, min: 0, max: 12, step: 1, pollGroup: "config_slow_300s", freshnessBudgetS: 320, labelUk: "Джерело сухого контакту 2", labelEn: "Dry contact 2 trigger source", uiSection: "settings", uiOrder: 560, uiGroup: null, editorKind: "readonly", enumMap: null },
      uart_protocol_library_version: { unit: "", ukUnit: "", enUnit: "", precision: 0, min: 0, max: 255, step: 1, pollGroup: "config_slow_300s", freshnessBudgetS: 320, labelUk: "Версія бібліотеки UART-протоколу", labelEn: "UART protocol library version", uiSection: "diagnostics", uiOrder: 570, uiGroup: null, editorKind: "readonly", enumMap: null },
      lcd_buzzer_trigger_val: { unit: "", ukUnit: "", enUnit: "", precision: 0, min: null, max: null, step: null, pollGroup: "config_slow_300s", freshnessBudgetS: 320, labelUk: "Поріг спрацювання LCD-зумера", labelEn: "LCD/buzzer trigger threshold", uiSection: "settings", uiOrder: 710, uiGroup: null, editorKind: "readonly", enumMap: null },
      lcd_buzzer_release_val: { unit: "", ukUnit: "", enUnit: "", precision: 0, min: null, max: null, step: null, pollGroup: "config_slow_300s", freshnessBudgetS: 320, labelUk: "Поріг вимкнення LCD-зумера", labelEn: "LCD/buzzer release threshold", uiSection: "settings", uiOrder: 711, uiGroup: null, editorKind: "readonly", enumMap: null },
      dry_contact_1_trigger_value: { unit: "raw", ukUnit: "необроблено", enUnit: "raw", precision: 0, min: -16777215, max: 16777215, step: 1, pollGroup: "config_slow_300s", freshnessBudgetS: 320, labelUk: "Поріг сухого контакту 1", labelEn: "Dry contact 1 trigger value", uiSection: "settings", uiOrder: 600, uiGroup: null, editorKind: "readonly", enumMap: null },
      dry_contact_1_recovery_value: { unit: "raw", ukUnit: "необроблено", enUnit: "raw", precision: 0, min: -16777215, max: 16777215, step: 1, pollGroup: "config_slow_300s", freshnessBudgetS: 320, labelUk: "Відновлення сухого контакту 1", labelEn: "Dry contact 1 recovery value", uiSection: "settings", uiOrder: 610, uiGroup: null, editorKind: "readonly", enumMap: null },
      dry_contact_2_trigger_value: { unit: "raw", ukUnit: "необроблено", enUnit: "raw", precision: 0, min: -16777215, max: 16777215, step: 1, pollGroup: "config_slow_300s", freshnessBudgetS: 320, labelUk: "Поріг сухого контакту 2", labelEn: "Dry contact 2 trigger value", uiSection: "settings", uiOrder: 620, uiGroup: null, editorKind: "readonly", enumMap: null },
      dry_contact_2_recovery_value: { unit: "raw", ukUnit: "необроблено", enUnit: "raw", precision: 0, min: -16777215, max: 16777215, step: 1, pollGroup: "config_slow_300s", freshnessBudgetS: 320, labelUk: "Відновлення сухого контакту 2", labelEn: "Dry contact 2 recovery value", uiSection: "settings", uiOrder: 630, uiGroup: null, editorKind: "readonly", enumMap: null },
      data_stored_period: { unit: "s", ukUnit: "с", enUnit: "s", precision: 0, min: null, max: null, step: null, pollGroup: "config_slow_300s", freshnessBudgetS: 320, labelUk: "Період запису у Flash", labelEn: "Flash log-write interval", uiSection: "settings", uiOrder: 708, uiGroup: null, editorKind: "readonly", enumMap: null },
      rcv_time: { unit: "h", ukUnit: "год", enUnit: "h", precision: 1, min: 0, max: 25.5, step: 0.1, pollGroup: "config_slow_300s", freshnessBudgetS: 320, labelUk: "Час RCV", labelEn: "RCV time", uiSection: "settings", uiOrder: 520, uiGroup: null, editorKind: "readonly", enumMap: null },
      rfv_time: { unit: "h", ukUnit: "год", enUnit: "h", precision: 1, min: 0, max: 25.5, step: 0.1, pollGroup: "config_slow_300s", freshnessBudgetS: 320, labelUk: "Час RFV", labelEn: "RFV time", uiSection: "settings", uiOrder: 530, uiGroup: null, editorKind: "readonly", enumMap: null },
      rvd_1506_l: { unit: "", ukUnit: "", enUnit: "", precision: 0, min: null, max: null, step: null, pollGroup: "telemetry_15s", freshnessBudgetS: 30, labelUk: "Зарезервовано (0x1506, молодший байт)", labelEn: "Reserved (0x1506, low byte)", uiSection: "none", uiOrder: 0, uiGroup: null, editorKind: "readonly", enumMap: null },
      can_mptl_ver: { unit: "", ukUnit: "", enUnit: "", precision: 0, min: null, max: null, step: null, pollGroup: "telemetry_15s", freshnessBudgetS: 30, labelUk: "Версія протоколу CAN", labelEn: "CAN protocol library version", uiSection: "settings", uiOrder: 718, uiGroup: null, editorKind: "readonly", enumMap: null },
      total_voltage: { unit: "V", ukUnit: "В", enUnit: "V", precision: null, min: null, max: null, step: null, pollGroup: "telemetry_15s", freshnessBudgetS: 30, labelUk: "Загальна напруга", labelEn: "Total voltage", uiSection: null, uiOrder: null, uiGroup: null, editorKind: null, enumMap: null },
      current: { unit: "A", ukUnit: "А", enUnit: "A", precision: null, min: null, max: null, step: null, pollGroup: "telemetry_15s", freshnessBudgetS: 30, labelUk: "Струм", labelEn: "Current", uiSection: null, uiOrder: null, uiGroup: null, editorKind: null, enumMap: null },
      power: { unit: "W", ukUnit: "Вт", enUnit: "W", precision: null, min: null, max: null, step: null, pollGroup: null, freshnessBudgetS: null, labelUk: "Потужність", labelEn: "Power", uiSection: null, uiOrder: null, uiGroup: null, editorKind: null, enumMap: null },
      charging_power: { unit: "W", ukUnit: "Вт", enUnit: "W", precision: null, min: null, max: null, step: null, pollGroup: null, freshnessBudgetS: null, labelUk: "Потужність заряду", labelEn: "Charging power", uiSection: null, uiOrder: null, uiGroup: null, editorKind: null, enumMap: null },
      discharging_power: { unit: "W", ukUnit: "Вт", enUnit: "W", precision: null, min: null, max: null, step: null, pollGroup: null, freshnessBudgetS: null, labelUk: "Потужність розряду", labelEn: "Discharging power", uiSection: null, uiOrder: null, uiGroup: null, editorKind: null, enumMap: null },
      charging_current: { unit: "A", ukUnit: "А", enUnit: "A", precision: null, min: null, max: null, step: null, pollGroup: null, freshnessBudgetS: null, labelUk: "Струм заряду", labelEn: "Charging current", uiSection: null, uiOrder: null, uiGroup: null, editorKind: null, enumMap: null },
      discharging_current: { unit: "A", ukUnit: "А", enUnit: "A", precision: null, min: null, max: null, step: null, pollGroup: null, freshnessBudgetS: null, labelUk: "Струм розряду", labelEn: "Discharging current", uiSection: null, uiOrder: null, uiGroup: null, editorKind: null, enumMap: null },
      connected_cell_count: { unit: "", ukUnit: "", enUnit: "", precision: null, min: null, max: null, step: null, pollGroup: null, freshnessBudgetS: null, labelUk: "Підключено комірок", labelEn: "Connected cell count", uiSection: null, uiOrder: null, uiGroup: null, editorKind: null, enumMap: null },
      measured_cell_count: { unit: "", ukUnit: "", enUnit: "", precision: null, min: null, max: null, step: null, pollGroup: null, freshnessBudgetS: null, labelUk: "Виміряно комірок", labelEn: "Measured cell count", uiSection: null, uiOrder: null, uiGroup: null, editorKind: null, enumMap: null },
      active_cells_voltage_sum: { unit: "V", ukUnit: "В", enUnit: "V", precision: null, min: null, max: null, step: null, pollGroup: null, freshnessBudgetS: null, labelUk: "Сума напруг активних комірок", labelEn: "Active cells voltage sum", uiSection: null, uiOrder: null, uiGroup: null, editorKind: null, enumMap: null },
      effective_cell_count: { unit: "", ukUnit: "", enUnit: "", precision: null, min: null, max: null, step: null, pollGroup: null, freshnessBudgetS: null, labelUk: "Ефективна кількість комірок", labelEn: "Effective cell count", uiSection: null, uiOrder: null, uiGroup: null, editorKind: null, enumMap: null },
      last_confirmed_cell_count: { unit: "", ukUnit: "", enUnit: "", precision: null, min: null, max: null, step: null, pollGroup: null, freshnessBudgetS: null, labelUk: "Останнє підтверджене число комірок", labelEn: "Last confirmed cell count", uiSection: null, uiOrder: null, uiGroup: null, editorKind: null, enumMap: null },
      topology_revision: { unit: "", ukUnit: "", enUnit: "", precision: null, min: null, max: null, step: null, pollGroup: null, freshnessBudgetS: null, labelUk: "Ревізія топології", labelEn: "Topology revision", uiSection: null, uiOrder: null, uiGroup: null, editorKind: null, enumMap: null },
      topology_data_freshness: { unit: "s", ukUnit: "с", enUnit: "s", precision: null, min: null, max: null, step: null, pollGroup: null, freshnessBudgetS: null, labelUk: "Свіжість даних топології", labelEn: "Topology data freshness", uiSection: null, uiOrder: null, uiGroup: null, editorKind: null, enumMap: null },
      topology_state: { unit: "", ukUnit: "", enUnit: "", precision: null, min: null, max: null, step: null, pollGroup: null, freshnessBudgetS: null, labelUk: "Стан топології", labelEn: "Topology state", uiSection: null, uiOrder: null, uiGroup: null, editorKind: null, enumMap: null },
      topology_reason: { unit: "", ukUnit: "", enUnit: "", precision: null, min: null, max: null, step: null, pollGroup: null, freshnessBudgetS: null, labelUk: "Причина стану топології", labelEn: "Topology state reason", uiSection: null, uiOrder: null, uiGroup: null, editorKind: null, enumMap: null },
      cellcount_tx_id: { unit: "", ukUnit: "", enUnit: "", precision: null, min: null, max: null, step: null, pollGroup: null, freshnessBudgetS: null, labelUk: "ID транзакції кількості комірок", labelEn: "Cell count transaction id", uiSection: null, uiOrder: null, uiGroup: null, editorKind: null, enumMap: null },
      cellcount_tx_status_code: { unit: "", ukUnit: "", enUnit: "", precision: null, min: null, max: null, step: null, pollGroup: null, freshnessBudgetS: null, labelUk: "Код статусу транзакції кількості комірок", labelEn: "Cell count transaction status code", uiSection: null, uiOrder: null, uiGroup: null, editorKind: null, enumMap: null },
      setup_passcode_tx_status_code: { unit: "", ukUnit: "", enUnit: "", precision: null, min: null, max: null, step: null, pollGroup: null, freshnessBudgetS: null, labelUk: "Код статусу транзакції пароля", labelEn: "Passcode transaction status code", uiSection: null, uiOrder: null, uiGroup: null, editorKind: null, enumMap: null },
      write_tx_snapshot: { unit: "", ukUnit: "", enUnit: "", precision: null, min: null, max: null, step: null, pollGroup: null, freshnessBudgetS: null, labelUk: "Знімок транзакції запису", labelEn: "Write transaction snapshot", uiSection: null, uiOrder: null, uiGroup: null, editorKind: null, enumMap: null },
      battery_state: { unit: "", ukUnit: "", enUnit: "", precision: null, min: null, max: null, step: null, pollGroup: null, freshnessBudgetS: null, labelUk: "Стан батареї", labelEn: "Battery state", uiSection: null, uiOrder: null, uiGroup: null, editorKind: null, enumMap: null },
      charge_phase: { unit: "", ukUnit: "", enUnit: "", precision: null, min: null, max: null, step: null, pollGroup: null, freshnessBudgetS: null, labelUk: "Фаза заряду", labelEn: "Charge phase", uiSection: null, uiOrder: null, uiGroup: null, editorKind: null, enumMap: null },
      charge_status: { unit: "", ukUnit: "", enUnit: "", precision: null, min: null, max: null, step: null, pollGroup: null, freshnessBudgetS: null, labelUk: "Статус заряду", labelEn: "Charge status", uiSection: null, uiOrder: null, uiGroup: null, editorKind: null, enumMap: null },
      battery_state_candidate: { unit: "", ukUnit: "", enUnit: "", precision: null, min: null, max: null, step: null, pollGroup: null, freshnessBudgetS: null, labelUk: "Кандидат стану", labelEn: "State candidate", uiSection: null, uiOrder: null, uiGroup: null, editorKind: null, enumMap: null },
      battery_state_candidate_age: { unit: "s", ukUnit: "с", enUnit: "s", precision: null, min: null, max: null, step: null, pollGroup: null, freshnessBudgetS: null, labelUk: "Вік кандидата стану", labelEn: "State candidate age", uiSection: null, uiOrder: null, uiGroup: null, editorKind: null, enumMap: null },
      battery_state_direction: { unit: "", ukUnit: "", enUnit: "", precision: null, min: null, max: null, step: null, pollGroup: null, freshnessBudgetS: null, labelUk: "Напрямок струму", labelEn: "Current direction", uiSection: null, uiOrder: null, uiGroup: null, editorKind: null, enumMap: null },
      battery_state_candidate_samples: { unit: "", ukUnit: "", enUnit: "", precision: null, min: null, max: null, step: null, pollGroup: null, freshnessBudgetS: null, labelUk: "Семпли кандидата", labelEn: "Candidate fresh samples", uiSection: null, uiOrder: null, uiGroup: null, editorKind: null, enumMap: null },
      battery_state_unknown_reason: { unit: "", ukUnit: "", enUnit: "", precision: null, min: null, max: null, step: null, pollGroup: null, freshnessBudgetS: null, labelUk: "Причина невідомого стану", labelEn: "State-unknown reason", uiSection: null, uiOrder: null, uiGroup: null, editorKind: null, enumMap: null },
      battery_state_last_known: { unit: "", ukUnit: "", enUnit: "", precision: null, min: null, max: null, step: null, pollGroup: null, freshnessBudgetS: null, labelUk: "Останній стан", labelEn: "Last known state", uiSection: null, uiOrder: null, uiGroup: null, editorKind: null, enumMap: null },
      charge_phase_last_known: { unit: "", ukUnit: "", enUnit: "", precision: null, min: null, max: null, step: null, pollGroup: null, freshnessBudgetS: null, labelUk: "Остання фаза заряду", labelEn: "Last known charge phase", uiSection: null, uiOrder: null, uiGroup: null, editorKind: null, enumMap: null },
      current_sample_age: { unit: "s", ukUnit: "с", enUnit: "s", precision: null, min: null, max: null, step: null, pollGroup: null, freshnessBudgetS: null, labelUk: "Давність семпла струму", labelEn: "Current sample age", uiSection: null, uiOrder: null, uiGroup: null, editorKind: null, enumMap: null },
      idle_current_noise_min: { unit: "A", ukUnit: "А", enUnit: "A", precision: null, min: null, max: null, step: null, pollGroup: null, freshnessBudgetS: null, labelUk: "Мін. шум струму", labelEn: "Idle current noise min", uiSection: null, uiOrder: null, uiGroup: null, editorKind: null, enumMap: null },
      idle_current_noise_max: { unit: "A", ukUnit: "А", enUnit: "A", precision: null, min: null, max: null, step: null, pollGroup: null, freshnessBudgetS: null, labelUk: "Макс. шум струму", labelEn: "Idle current noise max", uiSection: null, uiOrder: null, uiGroup: null, editorKind: null, enumMap: null },
      battery_state_time: { unit: "s", ukUnit: "с", enUnit: "s", precision: null, min: null, max: null, step: null, pollGroup: null, freshnessBudgetS: null, labelUk: "Тривалість стану", labelEn: "Battery state elapsed", uiSection: null, uiOrder: null, uiGroup: null, editorKind: null, enumMap: null },
      charge_phase_time: { unit: "s", ukUnit: "с", enUnit: "s", precision: null, min: null, max: null, step: null, pollGroup: null, freshnessBudgetS: null, labelUk: "Тривалість фази заряду", labelEn: "Charge phase elapsed", uiSection: null, uiOrder: null, uiGroup: null, editorKind: null, enumMap: null },
      charge_status_time: { unit: "s", ukUnit: "с", enUnit: "s", precision: null, min: null, max: null, step: null, pollGroup: null, freshnessBudgetS: null, labelUk: "Тривалість статусу заряду", labelEn: "Charge status time elapsed", uiSection: null, uiOrder: null, uiGroup: null, editorKind: null, enumMap: null },
      min_cell_voltage: { unit: "V", ukUnit: "В", enUnit: "V", precision: null, min: null, max: null, step: null, pollGroup: null, freshnessBudgetS: null, labelUk: "Мін. напруга комірки", labelEn: "Min cell voltage", uiSection: null, uiOrder: null, uiGroup: null, editorKind: null, enumMap: null },
      max_cell_voltage: { unit: "V", ukUnit: "В", enUnit: "V", precision: null, min: null, max: null, step: null, pollGroup: null, freshnessBudgetS: null, labelUk: "Макс. напруга комірки", labelEn: "Max cell voltage", uiSection: null, uiOrder: null, uiGroup: null, editorKind: null, enumMap: null },
      min_voltage_cell: { unit: "", ukUnit: "", enUnit: "", precision: null, min: null, max: null, step: null, pollGroup: null, freshnessBudgetS: null, labelUk: "Номер комірки з мін. напругою", labelEn: "Min voltage cell index", uiSection: null, uiOrder: null, uiGroup: null, editorKind: null, enumMap: null },
      max_voltage_cell: { unit: "", ukUnit: "", enUnit: "", precision: null, min: null, max: null, step: null, pollGroup: null, freshnessBudgetS: null, labelUk: "Номер комірки з макс. напругою", labelEn: "Max voltage cell index", uiSection: null, uiOrder: null, uiGroup: null, editorKind: null, enumMap: null },
      bms_last_update_age: { unit: "s", ukUnit: "с", enUnit: "s", precision: null, min: null, max: null, step: null, pollGroup: null, freshnessBudgetS: null, labelUk: "Вік останнього оновлення BMS", labelEn: "BMS last update age", uiSection: null, uiOrder: null, uiGroup: null, editorKind: null, enumMap: null },
      bms_health: { unit: "", ukUnit: "", enUnit: "", precision: null, min: null, max: null, step: null, pollGroup: null, freshnessBudgetS: null, labelUk: "Стан зв'язку з BMS", labelEn: "BMS link health", uiSection: null, uiOrder: null, uiGroup: null, editorKind: null, enumMap: null },
      runtime: { unit: "", ukUnit: "", enUnit: "", precision: null, min: null, max: null, step: null, pollGroup: null, freshnessBudgetS: null, labelUk: "Час роботи (форматовано)", labelEn: "Runtime (formatted)", uiSection: null, uiOrder: null, uiGroup: null, editorKind: null, enumMap: null },
      alarms: { unit: "", ukUnit: "", enUnit: "", precision: null, min: null, max: null, step: null, pollGroup: null, freshnessBudgetS: null, labelUk: "Тривоги", labelEn: "Alarms", uiSection: null, uiOrder: null, uiGroup: null, editorKind: null, enumMap: null },
      wifi_signal: { unit: "dBm", ukUnit: "дБм", enUnit: "dBm", precision: null, min: null, max: null, step: null, pollGroup: null, freshnessBudgetS: null, labelUk: "Рівень Wi-Fi", labelEn: "Wi-Fi signal", uiSection: null, uiOrder: null, uiGroup: null, editorKind: null, enumMap: null },
      system_uptime: { unit: "s", ukUnit: "с", enUnit: "s", precision: null, min: null, max: null, step: null, pollGroup: null, freshnessBudgetS: null, labelUk: "Час роботи ESP32", labelEn: "ESP32 uptime", uiSection: null, uiOrder: null, uiGroup: null, editorKind: null, enumMap: null },
      wifi_ip_address: { unit: "", ukUnit: "", enUnit: "", precision: null, min: null, max: null, step: null, pollGroup: null, freshnessBudgetS: null, labelUk: "IP-адреса", labelEn: "IP address", uiSection: null, uiOrder: null, uiGroup: null, editorKind: null, enumMap: null },
      firmware_version: { unit: "", ukUnit: "", enUnit: "", precision: null, min: null, max: null, step: null, pollGroup: null, freshnessBudgetS: null, labelUk: "Прошивка", labelEn: "Firmware version", uiSection: null, uiOrder: null, uiGroup: null, editorKind: null, enumMap: null },
      ui_version: { unit: "", ukUnit: "", enUnit: "", precision: null, min: null, max: null, step: null, pollGroup: null, freshnessBudgetS: null, labelUk: "Версія UI", labelEn: "UI version", uiSection: null, uiOrder: null, uiGroup: null, editorKind: null, enumMap: null },
      browser_connection: { unit: "", ukUnit: "", enUnit: "", precision: null, min: null, max: null, step: null, pollGroup: null, freshnessBudgetS: null, labelUk: "З'єднання браузера", labelEn: "Browser connection", uiSection: null, uiOrder: null, uiGroup: null, editorKind: null, enumMap: null },
      write_result_counters: { unit: "", ukUnit: "", enUnit: "", precision: null, min: null, max: null, step: null, pollGroup: null, freshnessBudgetS: null, labelUk: "Лічильники результатів запису", labelEn: "Write result counters", uiSection: null, uiOrder: null, uiGroup: null, editorKind: null, enumMap: null },
      device_name_override: { unit: "", ukUnit: "", enUnit: "", precision: null, min: null, max: null, step: null, pollGroup: null, freshnessBudgetS: null, labelUk: "Назва пристрою (локальна)", labelEn: "Device name override", uiSection: null, uiOrder: null, uiGroup: null, editorKind: null, enumMap: null },
      device_name: { unit: "", ukUnit: "", enUnit: "", precision: null, min: null, max: null, step: null, pollGroup: null, freshnessBudgetS: null, labelUk: "Назва BMS", labelEn: "BMS display name", uiSection: null, uiOrder: null, uiGroup: null, editorKind: null, enumMap: null },
    }),
    // Final-preparation-plan Stage 1 corrective pass: [key, domain, realWireObjectId, configuredName]
    // quadruples for every field whose real, compiled ESPHome object_id (ALWAYS
    // sanitize(snake_case(name)), never the YAML `id:`) differs from its own
    // canonical key. realWireObjectId is the sanitized object_id; configuredName
    // is the field's real live `name:` string (or null if not yet confirmed) --
    // the two are DIFFERENT wire-id variants ESPHome may use, never derived from
    // each other by string substitution. jk_bms.js registers both as wire-id
    // aliases alongside its own hand-typed registerEntity() calls (harmlessly
    // redundant for entries already covered there) so the field's real SSE
    // updates are recognized regardless of which variant this firmware/ESPHome
    // version actually emits. See buildWireObjectIdAliases()'s own comment for
    // the full reasoning and test/protocol_catalog/test_entity_id_collision.js /
    // test/protocol_catalog/test_wire_object_id_aliases.js for the coverage,
    // no-collision, and real-routing-function validators.
    wireObjectIdAliases: Object.freeze([
      ["charging", "binary_sensor", "charging_allowed", "charging allowed"],
      ["discharging", "binary_sensor", "discharging_allowed", "discharging allowed"],
      ["balancing", "binary_sensor", "balancing_allowed", "balancing allowed"],
      ["cell_connected_mask", "text_sensor", "cell_connected_mask_exact", "cell connected mask exact"],
      ["cell_resistance_1", "sensor", "cell_1_wire_resistance", "cell 1 wire resistance"],
      ["cell_resistance_2", "sensor", "cell_2_wire_resistance", "cell 2 wire resistance"],
      ["cell_resistance_3", "sensor", "cell_3_wire_resistance", "cell 3 wire resistance"],
      ["cell_resistance_4", "sensor", "cell_4_wire_resistance", "cell 4 wire resistance"],
      ["cell_resistance_5", "sensor", "cell_5_wire_resistance", "cell 5 wire resistance"],
      ["cell_resistance_6", "sensor", "cell_6_wire_resistance", "cell 6 wire resistance"],
      ["cell_resistance_7", "sensor", "cell_7_wire_resistance", "cell 7 wire resistance"],
      ["cell_resistance_8", "sensor", "cell_8_wire_resistance", "cell 8 wire resistance"],
      ["cell_resistance_9", "sensor", "cell_9_wire_resistance", "cell 9 wire resistance"],
      ["cell_resistance_10", "sensor", "cell_10_wire_resistance", "cell 10 wire resistance"],
      ["cell_resistance_11", "sensor", "cell_11_wire_resistance", "cell 11 wire resistance"],
      ["cell_resistance_12", "sensor", "cell_12_wire_resistance", "cell 12 wire resistance"],
      ["cell_resistance_13", "sensor", "cell_13_wire_resistance", "cell 13 wire resistance"],
      ["cell_resistance_14", "sensor", "cell_14_wire_resistance", "cell 14 wire resistance"],
      ["cell_resistance_15", "sensor", "cell_15_wire_resistance", "cell 15 wire resistance"],
      ["cell_resistance_16", "sensor", "cell_16_wire_resistance", "cell 16 wire resistance"],
      ["cell_resistance_17", "sensor", "cell_17_wire_resistance", "cell 17 wire resistance"],
      ["cell_resistance_18", "sensor", "cell_18_wire_resistance", "cell 18 wire resistance"],
      ["cell_resistance_19", "sensor", "cell_19_wire_resistance", "cell 19 wire resistance"],
      ["cell_resistance_20", "sensor", "cell_20_wire_resistance", "cell 20 wire resistance"],
      ["cell_resistance_21", "sensor", "cell_21_wire_resistance", "cell 21 wire resistance"],
      ["cell_resistance_22", "sensor", "cell_22_wire_resistance", "cell 22 wire resistance"],
      ["cell_resistance_23", "sensor", "cell_23_wire_resistance", "cell 23 wire resistance"],
      ["cell_resistance_24", "sensor", "cell_24_wire_resistance", "cell 24 wire resistance"],
      ["cell_resistance_25", "sensor", "cell_25_wire_resistance", "cell 25 wire resistance"],
      ["cell_resistance_26", "sensor", "cell_26_wire_resistance", "cell 26 wire resistance"],
      ["cell_resistance_27", "sensor", "cell_27_wire_resistance", "cell 27 wire resistance"],
      ["cell_resistance_28", "sensor", "cell_28_wire_resistance", "cell 28 wire resistance"],
      ["cell_resistance_29", "sensor", "cell_29_wire_resistance", "cell 29 wire resistance"],
      ["cell_resistance_30", "sensor", "cell_30_wire_resistance", "cell 30 wire resistance"],
      ["cell_resistance_31", "sensor", "cell_31_wire_resistance", "cell 31 wire resistance"],
      ["cell_resistance_32", "sensor", "cell_32_wire_resistance", "cell 32 wire resistance"],
      ["temperature_1", "sensor", "temperature_sensor_1", "temperature sensor 1"],
      ["temperature_2", "sensor", "temperature_sensor_2", "temperature sensor 2"],
      ["balancing_active", "binary_sensor", "balancing", "balancing"],
      ["cycle_capacity", "sensor", "total_charging_cycle_capacity", "total charging cycle capacity"],
      ["total_runtime", "text_sensor", "total_runtime_exact", "total runtime exact"],
      ["charging_active", "binary_sensor", "charging", "charging"],
      ["discharging_active", "binary_sensor", "discharging", "discharging"],
      ["bms_system_ticks", "text_sensor", "bms_system_ticks_exact", "bms system ticks exact"],
      ["temperature_4", "sensor", "temperature_sensor_4", "temperature sensor 4"],
      ["temperature_5", "sensor", "temperature_sensor_5", "temperature sensor 5"],
      ["rtc_ticks", "text_sensor", "rtc_ticks_exact", "rtc ticks exact"],
      ["device_model", "text_sensor", "manufacturer_device_id", "manufacturer device id"],
      ["odd_run_time", "text_sensor", "odd_run_time_exact", "odd run time exact"],
    ]),
    // Stage 3 precision-fix routing/duplication fix: [canonicalKey, domain,
    // legacyEntityId, configuredName] quadruples for every field whose exact,
    // canonical primary entity has a separate, pre-existing, approximate
    // "legacy companion" entity (Home Assistant compatibility only — see
    // buildLegacyCompanionEntities()'s own comment). jk_bms.js registers each
    // one against a suppression sentinel (never a second canonical row, never
    // overwriting the already-resolved exact value) via the same
    // registerEntity() mechanism wireObjectIdAliases uses above.
    legacyCompanionEntities: Object.freeze([
      ["cell_connected_mask", "sensor", "cell_connected_mask", "cell connected mask"],
      ["total_runtime", "sensor", "total_runtime_in_seconds", "total runtime in seconds"],
      ["bms_system_ticks", "sensor", "bms_system_ticks", "bms system ticks"],
      ["rtc_ticks", "sensor", "rtc_ticks", "rtc ticks"],
      ["odd_run_time", "sensor", "odd_run_time", "odd run time"],
    ]),
  });
  // <<< END GENERATED PROTOCOL CATALOG

  // >>> BEGIN GENERATED WRITE REGISTRY (Stage 4, production-integration gap fix, 2026-09-21) — DO NOT EDIT BY HAND.
  // Regenerate with: node tools/protocol/authoring/build_stage4_rw_inventory.js
  // Source of truth: protocol/generated/write_registry.json + protocol/generated/stage4_rw_inventory.json
  // `node tools/protocol/authoring/build_stage4_rw_inventory.js --check` fails if this block drifts from that source.
  // Generated by tools/protocol/authoring/build_stage4_rw_inventory.js from protocol/generated/bms_v1_1_manifest.json + protocol/registers.canonical.json + protocol/evidence/protocol_blockers.json + protocol/generated/write_registry.json. DO NOT EDIT BY HAND. Authoritative 97-row Stage 4 RW inventory -- see this file's own header comment for the full 97-vs-96 reconciliation and the exact Stage 4 state ladder.
  const WRITE_REGISTRY = Object.freeze({
    // submitPolicy "live": a real, immediate POST to /settings/register-write is allowed.
    live: Object.freeze([
      { key: "gps_heartbeat", address: 4372, minimum: 0, maximum: 1, step: 1, scale: 1, writeSafetyClass: "normal", submitPolicy: "live" },
      { key: "lcd_always_on", address: 4372, minimum: 0, maximum: 1, step: 1, scale: 1, writeSafetyClass: "normal", submitPolicy: "live" },
      { key: "smart_sleep_enabled", address: 4372, minimum: 0, maximum: 1, step: 1, scale: 1, writeSafetyClass: "normal", submitPolicy: "live" },
      { key: "timed_stored_data", address: 4372, minimum: 0, maximum: 1, step: 1, scale: 1, writeSafetyClass: "normal", submitPolicy: "live" },
      { key: "smart_sleep_timeout_hours", address: 4376, minimum: 0, maximum: 255, step: 1, scale: 1, writeSafetyClass: "normal", submitPolicy: "live" },
    ]),
    // submitPolicy "authorization_required": visible, editor disabled, submit blocked client-side
    // AND server-side (RegisterWriteHandler rejects it with 403 regardless of what the UI does).
    authorizationRequired: Object.freeze([
      { key: "cell_connection_wire_resistance_1", address: 4232, minimum: 0, maximum: 4294967295, step: 1, scale: 1, writeSafetyClass: "disruptive", submitPolicy: "authorization_required" },
      { key: "cell_connection_wire_resistance_2", address: 4236, minimum: 0, maximum: 4294967295, step: 1, scale: 1, writeSafetyClass: "disruptive", submitPolicy: "authorization_required" },
      { key: "cell_connection_wire_resistance_3", address: 4240, minimum: 0, maximum: 4294967295, step: 1, scale: 1, writeSafetyClass: "disruptive", submitPolicy: "authorization_required" },
      { key: "cell_connection_wire_resistance_4", address: 4244, minimum: 0, maximum: 4294967295, step: 1, scale: 1, writeSafetyClass: "disruptive", submitPolicy: "authorization_required" },
      { key: "cell_connection_wire_resistance_5", address: 4248, minimum: 0, maximum: 4294967295, step: 1, scale: 1, writeSafetyClass: "disruptive", submitPolicy: "authorization_required" },
      { key: "cell_connection_wire_resistance_6", address: 4252, minimum: 0, maximum: 4294967295, step: 1, scale: 1, writeSafetyClass: "disruptive", submitPolicy: "authorization_required" },
      { key: "cell_connection_wire_resistance_7", address: 4256, minimum: 0, maximum: 4294967295, step: 1, scale: 1, writeSafetyClass: "disruptive", submitPolicy: "authorization_required" },
      { key: "cell_connection_wire_resistance_8", address: 4260, minimum: 0, maximum: 4294967295, step: 1, scale: 1, writeSafetyClass: "disruptive", submitPolicy: "authorization_required" },
      { key: "cell_connection_wire_resistance_9", address: 4264, minimum: 0, maximum: 4294967295, step: 1, scale: 1, writeSafetyClass: "disruptive", submitPolicy: "authorization_required" },
      { key: "cell_connection_wire_resistance_10", address: 4268, minimum: 0, maximum: 4294967295, step: 1, scale: 1, writeSafetyClass: "disruptive", submitPolicy: "authorization_required" },
      { key: "cell_connection_wire_resistance_11", address: 4272, minimum: 0, maximum: 4294967295, step: 1, scale: 1, writeSafetyClass: "disruptive", submitPolicy: "authorization_required" },
      { key: "cell_connection_wire_resistance_12", address: 4276, minimum: 0, maximum: 4294967295, step: 1, scale: 1, writeSafetyClass: "disruptive", submitPolicy: "authorization_required" },
      { key: "cell_connection_wire_resistance_13", address: 4280, minimum: 0, maximum: 4294967295, step: 1, scale: 1, writeSafetyClass: "disruptive", submitPolicy: "authorization_required" },
      { key: "cell_connection_wire_resistance_14", address: 4284, minimum: 0, maximum: 4294967295, step: 1, scale: 1, writeSafetyClass: "disruptive", submitPolicy: "authorization_required" },
      { key: "cell_connection_wire_resistance_15", address: 4288, minimum: 0, maximum: 4294967295, step: 1, scale: 1, writeSafetyClass: "disruptive", submitPolicy: "authorization_required" },
      { key: "cell_connection_wire_resistance_16", address: 4292, minimum: 0, maximum: 4294967295, step: 1, scale: 1, writeSafetyClass: "disruptive", submitPolicy: "authorization_required" },
      { key: "cell_connection_wire_resistance_17", address: 4296, minimum: 0, maximum: 4294967295, step: 1, scale: 1, writeSafetyClass: "disruptive", submitPolicy: "authorization_required" },
      { key: "cell_connection_wire_resistance_18", address: 4300, minimum: 0, maximum: 4294967295, step: 1, scale: 1, writeSafetyClass: "disruptive", submitPolicy: "authorization_required" },
      { key: "cell_connection_wire_resistance_19", address: 4304, minimum: 0, maximum: 4294967295, step: 1, scale: 1, writeSafetyClass: "disruptive", submitPolicy: "authorization_required" },
      { key: "cell_connection_wire_resistance_20", address: 4308, minimum: 0, maximum: 4294967295, step: 1, scale: 1, writeSafetyClass: "disruptive", submitPolicy: "authorization_required" },
      { key: "cell_connection_wire_resistance_21", address: 4312, minimum: 0, maximum: 4294967295, step: 1, scale: 1, writeSafetyClass: "disruptive", submitPolicy: "authorization_required" },
      { key: "cell_connection_wire_resistance_22", address: 4316, minimum: 0, maximum: 4294967295, step: 1, scale: 1, writeSafetyClass: "disruptive", submitPolicy: "authorization_required" },
      { key: "cell_connection_wire_resistance_23", address: 4320, minimum: 0, maximum: 4294967295, step: 1, scale: 1, writeSafetyClass: "disruptive", submitPolicy: "authorization_required" },
      { key: "cell_connection_wire_resistance_24", address: 4324, minimum: 0, maximum: 4294967295, step: 1, scale: 1, writeSafetyClass: "disruptive", submitPolicy: "authorization_required" },
      { key: "cell_connection_wire_resistance_25", address: 4328, minimum: 0, maximum: 4294967295, step: 1, scale: 1, writeSafetyClass: "disruptive", submitPolicy: "authorization_required" },
      { key: "cell_connection_wire_resistance_26", address: 4332, minimum: 0, maximum: 4294967295, step: 1, scale: 1, writeSafetyClass: "disruptive", submitPolicy: "authorization_required" },
      { key: "cell_connection_wire_resistance_27", address: 4336, minimum: 0, maximum: 4294967295, step: 1, scale: 1, writeSafetyClass: "disruptive", submitPolicy: "authorization_required" },
      { key: "cell_connection_wire_resistance_28", address: 4340, minimum: 0, maximum: 4294967295, step: 1, scale: 1, writeSafetyClass: "disruptive", submitPolicy: "authorization_required" },
      { key: "cell_connection_wire_resistance_29", address: 4344, minimum: 0, maximum: 4294967295, step: 1, scale: 1, writeSafetyClass: "disruptive", submitPolicy: "authorization_required" },
      { key: "cell_connection_wire_resistance_30", address: 4348, minimum: 0, maximum: 4294967295, step: 1, scale: 1, writeSafetyClass: "disruptive", submitPolicy: "authorization_required" },
      { key: "cell_connection_wire_resistance_31", address: 4352, minimum: 0, maximum: 4294967295, step: 1, scale: 1, writeSafetyClass: "disruptive", submitPolicy: "authorization_required" },
      { key: "cell_connection_wire_resistance_32", address: 4356, minimum: 0, maximum: 4294967295, step: 1, scale: 1, writeSafetyClass: "disruptive", submitPolicy: "authorization_required" },
      { key: "disable_pcl_module", address: 4372, minimum: 0, maximum: 1, step: 1, scale: 1, writeSafetyClass: "disruptive", submitPolicy: "authorization_required" },
      { key: "disable_temp_sensor", address: 4372, minimum: 0, maximum: 1, step: 1, scale: 1, writeSafetyClass: "disruptive", submitPolicy: "authorization_required" },
      { key: "heat_en", address: 4372, minimum: 0, maximum: 1, step: 1, scale: 1, writeSafetyClass: "disruptive", submitPolicy: "authorization_required" },
      { key: "port_switch", address: 4372, minimum: 0, maximum: 1, step: 1, scale: 1, writeSafetyClass: "disruptive", submitPolicy: "authorization_required" },
      { key: "special_charger", address: 4372, minimum: 0, maximum: 1, step: 1, scale: 1, writeSafetyClass: "disruptive", submitPolicy: "authorization_required" },
    ]),
    // No write path exists at all -- no editor, a concrete reason shown (see stage4_rw_inventory.json
    // for the full authoritative classification these reasons are drawn from).
    blocked: Object.freeze([
      { key: "cell_count", address: 4204, writeSafetyClass: "topology", reason: "RANGE_NOT_ESTABLISHED", closureCriterion: "minimum/maximum/step are not established in canonical.json for this field -- a real write path requires a proven safe operating range, not a guessed one." },
      { key: "charging", address: 4208, writeSafetyClass: "disruptive", reason: "INSUFFICIENT_EVIDENCE", closureCriterion: "verification_status is not \"confirmed\" (2+ independent evidence groups) and no owner_write_override exists -- evidence-pending, not guessed." },
      { key: "discharging", address: 4212, writeSafetyClass: "disruptive", reason: "INSUFFICIENT_EVIDENCE", closureCriterion: "verification_status is not \"confirmed\" (2+ independent evidence groups) and no owner_write_override exists -- evidence-pending, not guessed." },
      { key: "charging_float_mode", address: 4372, writeSafetyClass: "n/a", reason: "MANIFEST_RW_CLAIM_CONTRADICTED_BY_CANONICAL_ACCESS", closureCriterion: "Canonical field \"charging_float_mode\" declares access=\"r\" (evidenced: syssi_implementation_family, workbook_unknown_provenance), contradicting the manifest's own RW classification for \"ChargingFloatMode\". Requires independent (e.g. PDF) evidence resolving the contradiction before any write path can be built." },
      { key: "balancing", address: 4216, writeSafetyClass: "disruptive", reason: "INSUFFICIENT_EVIDENCE", closureCriterion: "verification_status is not \"confirmed\" (2+ independent evidence groups) and no owner_write_override exists -- evidence-pending, not guessed." },
      { key: "cell_ovp", address: 4108, writeSafetyClass: "disruptive", reason: "INSUFFICIENT_EVIDENCE", closureCriterion: "verification_status is not \"confirmed\" (2+ independent evidence groups) and no owner_write_override exists -- evidence-pending, not guessed." },
      { key: "cell_uvp", address: 4100, writeSafetyClass: "disruptive", reason: "INSUFFICIENT_EVIDENCE", closureCriterion: "verification_status is not \"confirmed\" (2+ independent evidence groups) and no owner_write_override exists -- evidence-pending, not guessed." },
      { key: "system_power_off", address: 4136, writeSafetyClass: "disruptive", reason: "INSUFFICIENT_EVIDENCE", closureCriterion: "verification_status is not \"confirmed\" (2+ independent evidence groups) and no owner_write_override exists -- evidence-pending, not guessed." },
      { key: "rfv_time", address: 5380, writeSafetyClass: "normal", reason: "INSUFFICIENT_EVIDENCE", closureCriterion: "verification_status is not \"confirmed\" (2+ independent evidence groups) and no owner_write_override exists -- evidence-pending, not guessed." },
      { key: "rcv_time", address: 5380, writeSafetyClass: "normal", reason: "INSUFFICIENT_EVIDENCE", closureCriterion: "verification_status is not \"confirmed\" (2+ independent evidence groups) and no owner_write_override exists -- evidence-pending, not guessed." },
      { key: "continued_charge_current", address: 4140, writeSafetyClass: "disruptive", reason: "INSUFFICIENT_EVIDENCE", closureCriterion: "verification_status is not \"confirmed\" (2+ independent evidence groups) and no owner_write_override exists -- evidence-pending, not guessed." },
      { key: "charge_ocp_delay", address: 4144, writeSafetyClass: "disruptive", reason: "INSUFFICIENT_EVIDENCE", closureCriterion: "verification_status is not \"confirmed\" (2+ independent evidence groups) and no owner_write_override exists -- evidence-pending, not guessed." },
      { key: "continued_discharge_current", address: 4152, writeSafetyClass: "disruptive", reason: "INSUFFICIENT_EVIDENCE", closureCriterion: "verification_status is not \"confirmed\" (2+ independent evidence groups) and no owner_write_override exists -- evidence-pending, not guessed." },
      { key: "discharge_ocp_delay", address: 4156, writeSafetyClass: "disruptive", reason: "INSUFFICIENT_EVIDENCE", closureCriterion: "verification_status is not \"confirmed\" (2+ independent evidence groups) and no owner_write_override exists -- evidence-pending, not guessed." },
      { key: "scp_delay", address: 4224, writeSafetyClass: "disruptive", reason: "INSUFFICIENT_EVIDENCE", closureCriterion: "verification_status is not \"confirmed\" (2+ independent evidence groups) and no owner_write_override exists -- evidence-pending, not guessed." },
      { key: "tim_prodischarge", address: 4364, writeSafetyClass: "disruptive", reason: "RANGE_NOT_ESTABLISHED", closureCriterion: "minimum/maximum/step are not established in canonical.json for this field -- a real write path requires a proven safe operating range, not a guessed one." },
      { key: "discharge_otp", address: 4180, writeSafetyClass: "disruptive", reason: "INSUFFICIENT_EVIDENCE", closureCriterion: "verification_status is not \"confirmed\" (2+ independent evidence groups) and no owner_write_override exists -- evidence-pending, not guessed." },
      { key: "charge_otp", address: 4172, writeSafetyClass: "disruptive", reason: "INSUFFICIENT_EVIDENCE", closureCriterion: "verification_status is not \"confirmed\" (2+ independent evidence groups) and no owner_write_override exists -- evidence-pending, not guessed." },
      { key: "charge_utp", address: 4188, writeSafetyClass: "disruptive", reason: "INSUFFICIENT_EVIDENCE", closureCriterion: "verification_status is not \"confirmed\" (2+ independent evidence groups) and no owner_write_override exists -- evidence-pending, not guessed." },
      { key: "mos_otp", address: 4196, writeSafetyClass: "disruptive", reason: "INSUFFICIENT_EVIDENCE", closureCriterion: "verification_status is not \"confirmed\" (2+ independent evidence groups) and no owner_write_override exists -- evidence-pending, not guessed." },
      { key: "heating_activation_temperature", address: 4380, writeSafetyClass: "disruptive", reason: "OPEN_BLOCKER", closureCriterion: "Either a corroborating official-source citation is found, or a real-device read-only capture at 0x111C confirms the field, or the fields stay workbook-only-evidenced by explicit, permanent policy decision." },
      { key: "heating_deactivation_temperature", address: 4380, writeSafetyClass: "disruptive", reason: "OPEN_BLOCKER", closureCriterion: "Either a corroborating official-source citation is found, or a real-device read-only capture at 0x111C confirms the field, or the fields stay workbook-only-evidenced by explicit, permanent policy decision." },
      { key: "setup_passcode", address: 5232, writeSafetyClass: "credential", reason: "OPEN_BLOCKER", closureCriterion: "Same as 0x111C, resolved independently for this address." },
      { key: "data_stored_period", address: 5376, writeSafetyClass: "normal", reason: "RANGE_NOT_ESTABLISHED", closureCriterion: "minimum/maximum/step are not established in canonical.json for this field -- a real write path requires a proven safe operating range, not a guessed one." },
      { key: "dev_addr", address: 4360, writeSafetyClass: "disruptive", reason: "RANGE_NOT_ESTABLISHED", closureCriterion: "minimum/maximum/step are not established in canonical.json for this field -- a real write path requires a proven safe operating range, not a guessed one." },
      { key: "lcd_buzzer_trigger", address: 5348, writeSafetyClass: "unsupported", reason: "UNSUPPORTED_WRITE_SAFETY_CLASS", closureCriterion: "No known write mechanism exists in the protocol for this field's write_safety_class -- structurally blocked, not evidence-pending." },
      { key: "dry_contact_1_trigger_source", address: 5348, writeSafetyClass: "unsupported", reason: "UNSUPPORTED_WRITE_SAFETY_CLASS", closureCriterion: "No known write mechanism exists in the protocol for this field's write_safety_class -- structurally blocked, not evidence-pending." },
      { key: "dry_contact_2_trigger_source", address: 5350, writeSafetyClass: "unsupported", reason: "UNSUPPORTED_WRITE_SAFETY_CLASS", closureCriterion: "No known write mechanism exists in the protocol for this field's write_safety_class -- structurally blocked, not evidence-pending." },
      { key: "lcd_buzzer_trigger_val", address: 5352, writeSafetyClass: "normal", reason: "RANGE_NOT_ESTABLISHED", closureCriterion: "minimum/maximum/step are not established in canonical.json for this field -- a real write path requires a proven safe operating range, not a guessed one." },
      { key: "lcd_buzzer_release_val", address: 5356, writeSafetyClass: "normal", reason: "RANGE_NOT_ESTABLISHED", closureCriterion: "minimum/maximum/step are not established in canonical.json for this field -- a real write path requires a proven safe operating range, not a guessed one." },
      { key: "dry_contact_1_trigger_value", address: 5360, writeSafetyClass: "unsupported", reason: "UNSUPPORTED_WRITE_SAFETY_CLASS", closureCriterion: "No known write mechanism exists in the protocol for this field's write_safety_class -- structurally blocked, not evidence-pending." },
      { key: "dry_contact_1_recovery_value", address: 5364, writeSafetyClass: "unsupported", reason: "UNSUPPORTED_WRITE_SAFETY_CLASS", closureCriterion: "No known write mechanism exists in the protocol for this field's write_safety_class -- structurally blocked, not evidence-pending." },
      { key: "dry_contact_2_trigger_value", address: 5368, writeSafetyClass: "unsupported", reason: "UNSUPPORTED_WRITE_SAFETY_CLASS", closureCriterion: "No known write mechanism exists in the protocol for this field's write_safety_class -- structurally blocked, not evidence-pending." },
      { key: "dry_contact_2_recovery_value", address: 5372, writeSafetyClass: "unsupported", reason: "UNSUPPORTED_WRITE_SAFETY_CLASS", closureCriterion: "No known write mechanism exists in the protocol for this field's write_safety_class -- structurally blocked, not evidence-pending." },
      { key: "uart1_mprtol_nbr", address: 5298, writeSafetyClass: "disruptive", reason: "RANGE_NOT_ESTABLISHED", closureCriterion: "minimum/maximum/step are not established in canonical.json for this field -- a real write path requires a proven safe operating range, not a guessed one." },
      { key: "can_mprtol_nbr", address: 5298, writeSafetyClass: "disruptive", reason: "RANGE_NOT_ESTABLISHED", closureCriterion: "minimum/maximum/step are not established in canonical.json for this field -- a real write path requires a proven safe operating range, not a guessed one." },
      { key: "uart2_mprtol_nbr", address: 5332, writeSafetyClass: "disruptive", reason: "RANGE_NOT_ESTABLISHED", closureCriterion: "minimum/maximum/step are not established in canonical.json for this field -- a real write path requires a proven safe operating range, not a guessed one." },
    ]),
  });
  // <<< END GENERATED WRITE REGISTRY

  const GENERIC_TX_ADDRESS = PROTOCOL_CATALOG.genericTxAddress;

  // Readback comparator: an integer-stepped register (delays in s/µs,
  // cell_count) can only ever echo a whole number back, so "integer"
  // (±0.5 tolerance) is correct there; every fractional-stepped register
  // (voltage/current/temperature, all step 0.001 or 0.1) uses "decimal"
  // (±0.0005) so a real BMS re-quantizing to its own LSB still confirms,
  // without the ±0.5 slop being wide enough to hide an actually-wrong value.
  // Stage 5: min/max/step are sourced from PROTOCOL_CATALOG.fieldMeta
  // (generated from protocol/registers.canonical.json) rather than
  // retyped per call site — this is now the single source of truth for
  // these bounds; a canonical-source range change propagates here
  // automatically on the next `node tools/protocol/generate.js` run
  // instead of silently drifting out of sync with a hand-typed literal.
  // Final-preparation-plan Stage 1, commit boundary 1 (§3.8): the endpoint
  // string was always mechanically `/number/set_${key}/set` — verified
  // across every one of the 18 entries below, no exceptions — so it is now
  // synthesized here instead of being retyped at every call site. This is
  // NOT a relaxation of the allowlist: SETTING_KEYS (below) is still the
  // one thing that stays hand-curated, unchanged in content from before.
  function settingDef(key) {
    const meta = PROTOCOL_CATALOG.fieldMeta[key] || {};
    const min = meta.min ?? -Infinity;
    const max = meta.max ?? Infinity;
    const step = meta.step ?? NaN;
    const comparator = Number.isInteger(step) ? "integer" : "decimal";
    return { key, endpoint: `/number/set_${key}/set`, comparator, min, max, step, inputId: `reg_${key}`, messageId: "settingsMessage" };
  }
  // Reverted to fail-closed (2026-09-10, second critical audit) for every
  // disruptive/topology/credential/unresolved-dynamic/packed field: an
  // explicit owner_write_override is risk acceptance, not protocol
  // verification, and several of those fields also share a real
  // Modbus register with another field (packed siblings) — a hazard the
  // generic Write Transaction Manager's per-ADDRESS correlation cannot
  // yet disambiguate (see docs/adr/0001-protocol-catalog.md's sixth-pass
  // addendum). Only "normal" write_safety_class, non-packed, fully
  // dependency-resolved fields remain here. This is a deliberate,
  // hand-curated allowlist of WHICH keys are currently write-enabled
  // (a safety gate, not derived data) — only the bounds/endpoint for each
  // key are synthesized from the canonical source now, never the key
  // selection itself. `test_blocked_write_surface.js` independently proves
  // this list's key set is EXACTLY the canonical `access:"rw" &&
  // effective_access:"rw"` set, byte for byte, at every commit.
  const SETTING_KEYS = Object.freeze([
    "smart_sleep",
    "cell_uvpr",
    "cell_ovpr",
    "start_balance_trigger",
    "soc_100",
    "soc_0",
    "cell_rcv",
    "cell_rfv",
    "charge_ocpr_time",
    "discharge_ocpr_time",
    "scpr_time",
    "max_balance_current",
    "charge_otpr",
    "discharge_otpr",
    "charge_utpr",
    "mos_otpr",
    "battery_capacity",
    "start_balance",
  ]);
  const SETTING_DEFS = Object.freeze(SETTING_KEYS.map(settingDef));

  for (let i = 0; i < MAX_CELL_COUNT; i += 1) {
    const index = i + 1;
    cellVoltageKeys[i] = `cell_voltage_${index}`;
    cellResistanceKeys[i] = `cell_resistance_${index}`;
    cellVoltageBuffer[i] = NaN;
    cellResistanceBuffer[i] = NaN;
  }

  function registerEntity(key, domain, configuredName, legacyObjectId) {
    // ESPHome deployments may publish either a configured object ID or an
    // older human-readable legacy ID. Support both canonical wire forms.
    entityByWireId.set(`${domain}/${DEVICE_ID}/${legacyObjectId}`, key);
    entityByWireId.set(`${domain}/${DEVICE_ID}/${configuredName}`, key);
    entityByWireId.set(`${domain}/${configuredName}`, key);
    entityByWireId.set(`${domain}-${configuredName}`, key);
    entityByWireId.set(`${domain}-${legacyObjectId}`, key);
    entityByWireId.set(configuredName, key);
    entityByWireId.set(legacyObjectId, key);
  }

  registerEntity("charging_active", "binary_sensor", "charging", "charging");
  registerEntity("charging", "binary_sensor", "charging allowed", "charging_allowed");
  registerEntity("discharging_active", "binary_sensor", "discharging", "discharging");
  registerEntity("discharging", "binary_sensor", "discharging allowed", "discharging_allowed");
  // Actual balancer activity from JK register 0x12A6 (BalanStatus), not
  // the separate writable "balancing" enable/disable setting at 0x1078.
  registerEntity("balancing_active", "binary_sensor", "balancing", "balancing");
  registerEntity("balancing", "binary_sensor", "balancing allowed", "balancing_allowed");
  registerEntity("runtime", "text_sensor", "total runtime formatted", "total_runtime_formatted");
  registerEntity("device_name", "text_sensor", "bms display name", "bms_display_name");
  registerEntity("device_name_override", "text", "device name override", "device_name_override");
  registerEntity("device_model", "text_sensor", "manufacturer device id", "manufacturer_device_id");
  registerEntity("total_voltage", "sensor", "total voltage", "total_voltage");
  // SIGN CONVENTION (audited against batterylifepo4.yaml's own BatCurrent
  // decode + demo/mock-server.js's charging/discharging scenarios):
  // POSITIVE current/power = charging, NEGATIVE = discharging. This file
  // never re-derives charge/discharge state from that sign — it always
  // reads the separate `charging`/`discharging` booleans instead — so
  // there is nothing here that could silently drift out of sync with it.
  registerEntity("current", "sensor", "current", "current");
  registerEntity("power", "sensor", "power", "power");
  registerEntity("battery_capacity", "sensor", "battery capacity", "battery_capacity");
  registerEntity("full_charge_capacity", "sensor", "full charge capacity", "full_charge_capacity");
  registerEntity("capacity_remaining", "sensor", "capacity remaining", "capacity_remaining");
  registerEntity("state_of_charge", "sensor", "state of charge", "state_of_charge");
  registerEntity("charging_cycles", "sensor", "charging cycles", "charging_cycles");
  registerEntity("cycle_capacity", "sensor", "total charging cycle capacity", "total_charging_cycle_capacity");
  registerEntity("temperature_1", "sensor", "temperature sensor 1", "temperature_sensor_1");
  registerEntity("temperature_2", "sensor", "temperature sensor 2", "temperature_sensor_2");
  registerEntity("temperature_4", "sensor", "temperature sensor 4", "temperature_sensor_4");
  registerEntity("temperature_5", "sensor", "temperature sensor 5", "temperature_sensor_5");
  registerEntity("average_cell_voltage", "sensor", "average cell voltage", "average_cell_voltage");
  registerEntity("delta_cell_voltage", "sensor", "delta cell voltage", "delta_cell_voltage");
  registerEntity("balance_current", "sensor", "balance current", "balance_current");
  // JK protocol charge-voltage recommendations, expressed per cell. The
  // canonical frontend keys are cell_rcv/cell_rfv; each wire ID has exactly
  // one owner, so live updates cannot be lost through last-registration-wins.
  registerEntity("mosfet_temperature", "sensor", "mosfet temperature", "mosfet_temperature");
  registerEntity("state_of_health", "sensor", "state of health", "state_of_health");
  registerEntity("alarms", "text_sensor", "alarms", "alarms");
  registerEntity("alarms_bitmask", "sensor", "alarms bitmask", "alarms_bitmask");
  // charge_status returns battery_state (idle/charging/discharging/
  // absorption/float/offline/unknown) — "bulk" is never one of its
  // values (that's charge_phase's concept, below).
  registerEntity("charge_status", "text_sensor", "charge status", "charge_status");
  registerEntity("charge_status_time", "sensor", "charge status time elapsed", "charge_status_time_elapsed");
  // charge_phase (none/bulk/absorption/float) — the Charge Cycle graph's
  // own concept, distinct from battery_state. Thin presentation entity;
  // both this and charge_status read the SAME resolver's output.
  registerEntity("charge_phase", "text_sensor", "charge phase", "charge_phase");
  // Two SEPARATE clocks, per the battery_state/charge_phase split:
  // charge_phase_time resets on bulk<->absorption<->float transitions
  // (the Charge Cycle "Timer" stat); battery_state_time resets whenever
  // the MAIN status itself changes (the hero's "Elapsed" line) — they
  // coincide while actively charging and diverge once the pack leaves
  // the charging path (discharging/idle/offline all hold charge_phase
  // at "none", so only battery_state_time keeps moving there).
  registerEntity("charge_phase_time", "sensor", "charge phase elapsed", "charge_phase_elapsed");
  registerEntity("battery_state_time", "sensor", "battery state elapsed", "battery_state_elapsed");
  // V2.2 hardening pass — resolver diagnostics, Diagnostics-panel only.
  // Every one of these mirrors something charge_status's own resolver
  // already computed; nothing here re-derives state on the frontend.
  registerEntity("battery_state_direction", "text_sensor", "battery state current direction", "battery_state_direction");
  registerEntity("battery_state_candidate", "text_sensor", "battery state candidate direction", "battery_state_candidate");
  registerEntity("battery_state_candidate_samples", "sensor", "battery state candidate fresh samples", "battery_state_candidate_samples");
  registerEntity("battery_state_candidate_age", "sensor", "battery state candidate age", "battery_state_candidate_age");
  registerEntity("current_sample_age", "sensor", "current sample age", "current_sample_age");
  registerEntity("battery_state_unknown_reason", "text_sensor", "battery state unknown reason", "battery_state_unknown_reason");
  registerEntity("battery_state_last_known", "text_sensor", "battery state last known", "battery_state_last_known");
  registerEntity("charge_phase_last_known", "text_sensor", "charge phase last known", "charge_phase_last_known");
  registerEntity("idle_current_noise_min", "sensor", "idle current noise min", "idle_current_noise_min");
  registerEntity("idle_current_noise_max", "sensor", "idle current noise max", "idle_current_noise_max");
  registerEntity("charging_float_mode", "binary_sensor", "charging float mode", "charging_float_mode");
  registerEntity("bms_health", "text_sensor", "bms health", "bms_health");
  registerEntity("bms_last_update_age", "sensor", "bms last update age", "bms_last_update_age");
  registerEntity("wifi_signal", "sensor", "wifi signal", "wifi_signal");
  registerEntity("wifi_ip_address", "text_sensor", "wifi ip address", "wifi_ip_address");
  registerEntity("system_uptime", "sensor", "system uptime", "system_uptime");
  registerEntity("heating_activation_temperature", "number", "heating activation temperature", "heating_activation_temperature");
  registerEntity("heating_deactivation_temperature", "number", "heating deactivation temperature", "heating_deactivation_temperature");
  registerEntity("lcd_buzzer_trigger", "sensor", "lcd buzzer trigger", "lcd_buzzer_trigger");
  for (const name of [
    "smart_sleep", "cell_uvp", "cell_uvpr", "cell_ovp", "cell_ovpr", "start_balance_trigger", "soc_100", "soc_0",
    "cell_rcv", "cell_rfv", "system_power_off", "continued_charge_current", "charge_ocp_delay", "charge_ocpr_time",
    "continued_discharge_current", "discharge_ocp_delay", "discharge_ocpr_time", "scpr_time", "max_balance_current",
    "charge_otp", "charge_otpr", "discharge_otp", "discharge_otpr", "charge_utp", "charge_utpr", "mos_otp", "mos_otpr",
    "cell_count", "scp_delay", "start_balance", "rcv_time", "rfv_time"
  ]) registerEntity(name, "sensor", name.replaceAll("_", " "), name);
  // Topology Resolver outputs (batterylifepo4.yaml) — configured_cell_count
  // is just cell_count above (the same RW register), not duplicated here.
  // topology_state/topology_reason are stable English codes, exactly like
  // bms_health's LIVE/DELAYED/STALE/OFFLINE — this file owns bilingual
  // presentation (see topologyReasonText()), the device never publishes
  // translated text.
  //
  // cell_connected_mask's own hand-typed registerEntity() call (registering
  // wire-id "cell_connected_mask" straight to canonical key
  // "cell_connected_mask") was removed here (Stage 3 cell-channel batch,
  // 2026-09-17): that canonical key's PRIMARY entity is now the exact
  // "cell_connected_mask_exact" text_sensor (wireObjectIdAliases, above);
  // the legacy wire id "cell_connected_mask" is now registered against
  // LEGACY_COMPANION_SUPPRESSED by the generated legacyCompanionEntities
  // loop, below -- this hand-typed call would have been stale, redundant,
  // AND actively misleading dead code (harmless only because the generated
  // loop runs later and its registerEntity() call wins the last-write-wins
  // Map overwrite) had it been left in place.
  registerEntity("connected_cell_count", "sensor", "connected cell count", "connected_cell_count");
  registerEntity("measured_cell_count", "sensor", "measured cell count", "measured_cell_count");
  registerEntity("active_cells_voltage_sum", "sensor", "active cells voltage sum", "active_cells_voltage_sum");
  registerEntity("effective_cell_count", "sensor", "effective cell count", "effective_cell_count");
  registerEntity("display_cell_count", "sensor", "display cell count", "display_cell_count");
  registerEntity("last_confirmed_cell_count", "sensor", "last confirmed cell count", "last_confirmed_cell_count");
  registerEntity("topology_revision", "sensor", "topology revision", "topology_revision");
  registerEntity("topology_data_freshness", "sensor", "topology data freshness", "topology_data_freshness");
  registerEntity("cellcount_tx_id", "sensor", "cell count transaction id", "cellcount_tx_id");
  registerEntity("cellcount_tx_status_code", "sensor", "cell count transaction status code", "cellcount_tx_status_code");
  registerEntity("topology_state", "text_sensor", "topology state", "topology_state");
  registerEntity("topology_reason", "text_sensor", "topology reason", "topology_reason");
  registerEntity("write_tx_snapshot", "text_sensor", "write transaction snapshot", "write_tx_snapshot");
  // P1-05 (2026-09-10): unregistered until now, so diagnosticObjectId()
  // fell through to the raw wire-id regex fallback -- an English label
  // ("Control override reason") regardless of language. Not currently
  // published by batterylifepo4.yaml at all (demo/mock-server.js only,
  // used by testActiveAlarmOverrideReasonExplicit in test/topology/run.js);
  // registered here so the label is correct wherever this entity is
  // observed, without implying the real firmware feature is built yet.
  registerEntity("control_override_reason", "text_sensor", "control override reason", "control_override_reason");
  registerEntity("setup_passcode_tx_status_code", "sensor", "setup passcode transaction status code", "setup_passcode_tx_status_code");
  registerEntity("dry_contact_1_trigger_source", "sensor", "dry contact 1 trigger source", "dry_contact_1_trigger_source");
  registerEntity("dry_contact_2_trigger_source", "sensor", "dry contact 2 trigger source", "dry_contact_2_trigger_source");
  registerEntity("dry_contact_1_trigger_value", "sensor", "dry contact 1 trigger value", "dry_contact_1_trigger_value");
  registerEntity("dry_contact_1_recovery_value", "sensor", "dry contact 1 recovery value", "dry_contact_1_recovery_value");
  registerEntity("dry_contact_2_trigger_value", "sensor", "dry contact 2 trigger value", "dry_contact_2_trigger_value");
  registerEntity("dry_contact_2_recovery_value", "sensor", "dry contact 2 recovery value", "dry_contact_2_recovery_value");
  // Stage 3 bounded batch (2026-09-17): capability diagnostics for the two
  // newly-read blocks (jk_capability_core.h) -- registered explicitly here
  // rather than relying on PROTOCOL_CATALOG.wireObjectIdAliases (that
  // mechanism only covers fields whose real wire object_id differs from
  // their canonical key; these two match their key exactly, so without an
  // explicit call here they would never reach state[] and would fall back
  // to an unlocalized diagnostics-table label -- the exact P1-05 class of
  // gap this project has hit and fixed before).
  registerEntity("cell_wire_resistance_ext_capability", "text_sensor", "cell wire resistance extension capability", "cell_wire_resistance_ext_capability");
  registerEntity("cell_connection_wire_resistance_capability", "text_sensor", "cell connection wire resistance capability", "cell_connection_wire_resistance_capability");
  // Diagnostic instrumentation (2026-09-18, user-directed): per-attempt
  // trail for the CellConWireRes0-31 read -- same "explicit call needed"
  // reasoning as the two capability entities directly above.
  registerEntity("cell_connection_wire_resistance_last_outcome", "text_sensor", "cell connection wire resistance last outcome", "cell_connection_wire_resistance_last_outcome");
  registerEntity("cell_connection_wire_resistance_queued_count", "sensor", "cell connection wire resistance queued count", "cell_connection_wire_resistance_queued_count");
  registerEntity("cell_connection_wire_resistance_callback_count", "sensor", "cell connection wire resistance callback count", "cell_connection_wire_resistance_callback_count");
  registerEntity("cell_connection_wire_resistance_last_response_bytes", "sensor", "cell connection wire resistance last response bytes", "cell_connection_wire_resistance_last_response_bytes");
  registerEntity("cell_connection_wire_resistance_attempt_started_uptime_s", "sensor", "cell connection wire resistance attempt started uptime", "cell_connection_wire_resistance_attempt_started_uptime_s");
  registerEntity("cell_connection_wire_resistance_attempt_ended_uptime_s", "sensor", "cell connection wire resistance attempt ended uptime", "cell_connection_wire_resistance_attempt_ended_uptime_s");

  // Stage 3 bounded batch (2026-09-17): CellConWireRes0-31 calibration
  // constants -- same "explicit call needed" reasoning as the two
  // capability entities directly above (these 32 also match their own
  // canonical key exactly, by deliberate choice of this batch's YAML
  // `name:` strings, specifically so no wireObjectIdAliases entry/mismatch
  // bookkeeping is needed for them at all).
  for (let i = 0; i < 32; i += 1) {
    const n = i + 1;
    const key = `cell_connection_wire_resistance_${n}`;
    registerEntity(key, "sensor", `cell connection wire resistance ${n}`, key);
  }

  for (let i = 0; i < MAX_CELL_COUNT; i += 1) {
    const index = i + 1;
    registerEntity(cellVoltageKeys[i], "sensor", `cell voltage ${index}`, cellVoltageKeys[i]);
    // cell_resistance_N's own real wire object_id (cell_N_wire_resistance,
    // diverging from its canonical key -- ESPHome's object_id is ALWAYS
    // sanitize(snake_case(name)), never the YAML `id:`) is registered
    // below, generically, via PROTOCOL_CATALOG.wireObjectIdAliases --
    // not hand-typed here anymore (Final-preparation-plan Stage 1
    // corrective pass: this exact call used to duplicate that alias by
    // hand; kept in sync with canonical.json only by memory, the same
    // failure mode three OTHER hand-typed tables already hit once before
    // — see wireObjectIdAliases' own generation comment in generate.js).
  }

  // Generated wire-object-id aliases (Final-preparation-plan Stage 1
  // corrective pass): every field whose real, compiled ESPHome object_id
  // differs from its own canonical key gets registered here, mechanically,
  // from canonical.json via generate.js -- never hand-typed. Several of
  // these entries duplicate an ALREADY-correct hand-typed registerEntity()
  // call above (e.g. charging_active/temperature_1) -- calling
  // registerEntity() again with the exact same key/domain/id is a no-op
  // re-assignment of entityByWireId's Map entries, not a conflict; kept
  // that way deliberately rather than hunting down and removing every
  // now-redundant hand-typed call, which is out of this corrective pass's
  // own scope (only cell_resistance_1..16's own hand-typed call, directly
  // implicated, was removed above).
  //
  // Stage 1 hardware acceptance corrective pass (bug found on real
  // hardware): this loop used to pass `realId` (the sanitized object_id,
  // e.g. "cell_1_wire_resistance") as BOTH registerEntity()'s
  // configuredName AND legacyObjectId arguments. That registers only
  // object_id-derived wire-id variants -- it never registers the variant
  // this device's own /events stream actually uses for cell_resistance_N
  // (and, latently, every other entry here with no OTHER hand-typed
  // registerEntity() call covering it): the raw, space-separated
  // configured `name:` string, e.g. "sensor/cell 1 wire resistance"
  // (confirmed via a live SSE capture against the real device). configured
  // name is NOT recoverable from object_id by string substitution in
  // general (object_id is a one-way sanitization -- lowercased, punctuation
  // stripped -- see generate.js's own comment on this), so it is carried
  // separately as canonical.json's esphome_configured_name and threaded
  // through here as this tuple's 4th element instead of being derived.
  // Falls back to realId alone (old behavior) only for the few fields
  // where esphome_configured_name isn't populated yet.
  for (const [key, domain, realId, configuredName] of PROTOCOL_CATALOG.wireObjectIdAliases) {
    registerEntity(key, domain, configuredName || realId, realId);
  }

  // Routing/duplication fix (user-directed, 2026-09-17): register every
  // known legacy-companion entity's wire id against LEGACY_COMPANION_SUPPRESSED
  // (see its own comment above) instead of a real canonical key -- reuses
  // registerEntity()'s own variant-generation (dash/slash/dot/device-id
  // forms) exactly as wireObjectIdAliases does above, so this needs no
  // separate alias-building logic of its own.
  for (const [, domain, legacyEntityId, configuredName] of PROTOCOL_CATALOG.legacyCompanionEntities) {
    registerEntity(LEGACY_COMPANION_SUPPRESSED, domain, configuredName || legacyEntityId, legacyEntityId);
  }

  function getDom(id) {
    let node = domCache.get(id);
    if (node) return node;
    node = document.getElementById(id);
    if (node) domCache.set(id, node);
    return node;
  }

  function endpointUrl(path) {
    return new URL(String(path).replace(/^\/+/, ""), PAGE_BASE_URL).toString();
  }

  function populateDomCache() {
    domCache.clear();
    const nodes = document.querySelectorAll("[id]");
    for (let i = 0; i < nodes.length; i += 1) domCache.set(nodes[i].id, nodes[i]);
  }

  function scheduleRender(key) {
    dirty.add(key);
    if (frameRequest === 0) frameRequest = window.requestAnimationFrame(render);
  }

  // Bumped on every accepted (non-duplicate) write to state[key], keyed by
  // key. The Write Transaction Manager records this revision the instant a
  // command is sent and only accepts a readback whose revision is strictly
  // newer — a defense against a watcher somehow still being attached from a
  // stale/earlier registration confirming against old data (see writeTransaction).
  const stateRevision = Object.create(null);
  let globalRevision = 0;

  // Stage 5 ("Виправити фундамент читання"): per-key wall-clock time of the
  // last real SSE payload, kept in a map SEPARATE from `state[key]` itself
  // (rather than embedded as a field inside the state object) so it can be
  // bumped unconditionally on every incoming payload for a key, independent
  // of the `state` Proxy's own duplicate-value dedup (which — correctly,
  // for its own render-skipping purpose — leaves the previous object in
  // place, untouched, when a new payload repeats the same state/value; an
  // updatedAt field embedded in that object would then wrongly stop
  // advancing every time a register happens to hold a stable value, making
  // it look stale even while the firmware keeps confirming it as current).
  const stateUpdatedAt = Object.create(null);

  // A field is "stale" once more wall-clock time has passed since its last
  // observed payload than protocol/registers.canonical.json's own
  // freshness_budget_s for that register's poll_group allows. Fields with
  // no canonical fieldMeta entry (computed/derived, non-register entities)
  // or no freshnessBudgetS are never reported stale by this function — this
  // project has no per-key SLA for those today, and inventing one here
  // would be a guess, not a derivation from the manifest.
  function isFieldStale(key) {
    const meta = PROTOCOL_CATALOG.fieldMeta[key];
    if (!meta || meta.freshnessBudgetS == null) return false;
    const ts = stateUpdatedAt[key];
    if (!ts) return false;
    return Date.now() - ts > meta.freshnessBudgetS * 1000;
  }

  // Self-audit (2026-09-11): explains a stale marker instead of showing an
  // unexplained colored dot — mirrors the existing "read-only" badge
  // pattern (value.title = "Write blocked: <reason>"), which this
  // otherwise didn't match. Returns null when not stale so callers can
  // tell "explain nothing" apart from "explain: not stale" text.
  function staleTitle(key) {
    if (!isFieldStale(key)) return null;
    const meta = PROTOCOL_CATALOG.fieldMeta[key];
    const ageS = Math.round((Date.now() - stateUpdatedAt[key]) / 1000);
    return currentLang === "uk"
      ? `Немає оновлення ${ageS} с (очікувалось не рідше ніж раз на ${meta.freshnessBudgetS} с)`
      : `No update for ${ageS}s (expected at least every ${meta.freshnessBudgetS}s)`;
  }

  // Self-audit: tightened from 5000ms — the fastest canonical poll_group
  // (cell_block_1s) has a 3s freshness budget, so a 5s sweep could leave a
  // silently-stopped cell register showing "fresh" for up to ~2s past its
  // own budget between sweeps. 1000ms keeps sweep latency well under the
  // tightest budget across every tier.
  const STALE_SWEEP_INTERVAL_MS = 1000;

  // bindText()'s bindings, recorded so the periodic sweep can also refresh
  // Overview/Electrical/Health measurement displays — not just the
  // low-level Diagnostics register table. "UI бачить freshness кожного
  // значення" (Stage 5's own done-criterion) means every value, and the
  // measurement panels are the primary surface a user actually looks at;
  // an earlier version of this pass covered only the Diagnostics table.
  const MEASUREMENT_BINDINGS = [];

  // Every arriving SSE payload already clears its own row's stale marker
  // (recordDiagnosticReadout) or refreshes via the renderers/bind path
  // (setMeasurement). This periodic sweep is the other half: a register
  // that simply stops being pushed (no new payload at all) must still be
  // shown as stale once its freshness budget elapses, which no
  // event-driven code path can detect on its own — covers both the
  // Diagnostics register table (read-only value nodes; skips
  // HTMLInputElement/.register-toggle — an editable field's staleness
  // display is not addressed by this pass, it already shows its own dirty
  // state) and every bindText()-bound Overview/Electrical/Health element.
  function sweepDiagnosticStaleness() {
    for (const [wireId, entry] of diagnosticReadouts) {
      if (!entry.key) continue;
      const node = diagnosticReadoutRows.get(wireId);
      if (!node || !node.classList || node instanceof HTMLInputElement || node.classList.contains("register-toggle")) continue;
      const stale = isFieldStale(entry.key);
      node.classList.toggle("is-stale", stale);
      // Diagnostics rows also use .title to echo the raw value itself
      // (set at row creation) — restore that once a field is fresh again,
      // rather than leaving a stale explanation stuck after it recovers.
      node.title = stale ? staleTitle(entry.key) : diagnosticReadoutValue(entry);
    }
    for (const binding of MEASUREMENT_BINDINGS) {
      const node = getDom(binding.id);
      if (!node) continue;
      const stale = isFieldStale(binding.key);
      node.classList.toggle("is-stale", stale);
      const explain = staleTitle(binding.key);
      node.title = explain || "";
    }
  }

  // Data-arrival watchers — deliberately SEPARATE from the visual renderers
  // map and fired synchronously from the Proxy trap below, never through
  // requestAnimationFrame. The Write Transaction Manager's confirmation
  // detection is a data-correctness concern, not a paint-performance one:
  // rAF is throttled or fully paused while a tab is backgrounded/minimized,
  // and a real user can absolutely background the tab right after tapping
  // a control. If confirmation detection rode on the same rAF-gated path
  // as visual rendering, a backgrounded tab would falsely report TIMEOUT
  // for a write the BMS actually confirmed correctly, purely because the
  // browser hadn't painted a frame yet — not a real communication failure.
  const dataWatchers = new Map();
  function watchKey(key, callback) {
    let list = dataWatchers.get(key);
    if (!list) { list = []; dataWatchers.set(key, list); }
    list.push(callback);
    return () => { const i = list.indexOf(callback); if (i !== -1) list.splice(i, 1); };
  }

  // Visual-render dedup only — a repeated "still On" is not worth a
  // re-paint. This must NOT be the only signal the Write Transaction
  // Manager relies on (see ingestPayload below): a BMS re-confirming the
  // exact value it had before a write is itself meaningful — it means the
  // command didn't take effect — and that is a legitimate MISMATCH, not
  // silence. If confirmation detection lived here, an unchanged-value
  // mismatch would be silently swallowed by this dedup and misreported as
  // a TIMEOUT instead. This was a real bug, caught by testing a mismatch
  // against a control that was already in the "wrong" (echoed) state.
  const state = new Proxy(Object.create(null), {
    set(target, property, nextValue) {
      const previous = target[property];
      if (previous && nextValue && previous.state === nextValue.state && previous.value === nextValue.value) return true;
      if (Object.is(previous, nextValue)) return true;
      target[property] = nextValue;
      scheduleRender(String(property));
      return true;
    }
  });

  function ingestPayload(payload) {
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) return;
    const wireId = typeof payload.id === "string" ? payload.id : (typeof payload.object_id === "string" ? payload.object_id : "");
    const key = entityByWireId.get(wireId);
    // A known legacy-companion entity (see LEGACY_COMPANION_SUPPRESSED's
    // own comment): its real ESPHome/Home Assistant publication is left
    // completely untouched by returning here BEFORE recordDiagnosticReadout
    // -- it never gets a diagnostic row (no duplicate of its exact
    // sibling's own canonical row) and never reaches state[] (so it can
    // never downgrade the exact value already resolved for that field).
    if (key === LEGACY_COMPANION_SUPPRESSED) return;
    recordDiagnosticReadout(wireId, payload, key);
    if (!key) return;
    const rawState = payload.state !== undefined ? payload.state : payload.value;
    const rawValue = payload.value !== undefined ? payload.value : payload.state;
    state[key] = { state: rawState === undefined || rawState === null ? "" : String(rawState), value: rawValue };
    // Data-arrival signal — fires on every real incoming payload for a
    // registered key, changed-or-not, independent of the Proxy's own
    // render dedup above. This is what the Write Transaction Manager
    // actually waits on.
    stateRevision[key] = ++globalRevision;
    stateUpdatedAt[key] = Date.now();
    const watchers = dataWatchers.get(key);
    // Snapshot first — a watcher's own callback (writeTransaction's
    // finish()) calls unwatch() on itself synchronously here, which would
    // otherwise shift indices mid-loop.
    if (watchers && watchers.length) { const snap = watchers.slice(); for (let i = 0; i < snap.length; i += 1) snap[i](); }
  }

  function readOnlyDomain(wireId) {
    if (!wireId) return "";
    for (const domain of READABLE_DOMAINS) {
      if (wireId === domain || wireId.startsWith(`${domain}-`) || wireId.startsWith(`${domain}/`) || wireId.startsWith(`${domain}.`)) return domain;
    }
    return "";
  }

  // Case-insensitive, exhaustive Ukrainian unit translation -- covers
  // every unit_of_measurement value actually used in batterylifepo4.yaml
  // (verified against the real file: %, A, Ah, H, S, V, W, mV, s, uS,
  // °C, Ω), plus the derived overrides diagnosticUnit() assigns below
  // (mΩ, µs, h, s). Lookup is normalized to lowercase so a raw,
  // ESPHome-reported unit that reaches here in ANY casing (e.g. the
  // device's own "H"/"S"/"uS") still resolves to its Cyrillic label —
  // the old table only matched a few exact-case strings the explicit
  // branches happened to produce, so any register NOT covered by one of
  // those branches (a real risk given ~100+ registers exist and only a
  // curated subset is explicitly classified) could leak through
  // untranslated. English is unaffected — this table is only consulted
  // when currentLang === "uk".
  const UK_UNIT_MAP = {
    v: "В", a: "А", ah: "А·год", w: "Вт", s: "с", h: "год",
    "µs": "мкс", "μs": "мкс", us: "мкс", mv: "мВ", "mω": "мОм",
    kwh: "кВт·год", kw: "кВт", "°c": "°C", "%": "%", "ω": "Ω",
  };
  function ukUnitLabel(unit) {
    if (!unit) return unit;
    return UK_UNIT_MAP[unit.toLowerCase()] || unit;
  }

  function diagnosticUnit(entry) {
    const objectId = diagnosticObjectId(entry);
    // Stage 5 self-audit (2026-09-11): PROTOCOL_CATALOG.fieldMeta now
    // covers every register field AND every non-register/computed entity
    // (buildFieldMeta() in generate.js folds in both
    // protocol/registers.canonical.json and
    // protocol/non_register_entities.canonical.json) — verified by direct
    // cross-check that all ~47 objectIds this function's old hand-typed
    // fallback table used to special-case now resolve through fieldMeta,
    // including two (discharge_ocpr_left/discharge_scpr_left) the old
    // table never actually matched at all due to a "disacharge_"
    // transposition typo. That table is removed; only the truly generic
    // fallback remains, for a wire id with no canonical entry at all
    // (should not happen for a registered entity — kept for defense in
    // depth, not because any known key still needs it).
    const meta = PROTOCOL_CATALOG.fieldMeta[objectId];
    if (meta) {
      const canonicalUnit = currentLang === "uk" ? meta.ukUnit : meta.enUnit;
      return canonicalUnit || "";
    }
    const formatted = entry.state === undefined || entry.state === null ? "" : String(entry.state).trim();
    const match = formatted.match(/^\s*[+-]?(?:\d+(?:[.,]\d+)?|[.,]\d+)(?:e[+-]?\d+)?\s*(.*?)\s*$/i);
    const unit = match && match[1] ? match[1] : "";
    if (currentLang !== "uk") return unit;
    return ukUnitLabel(unit);
  }

  function diagnosticReadoutValue(entry) {
    const formatted = entry.state === undefined || entry.state === null ? "" : String(entry.state).trim();
    const raw = entry.value === undefined || entry.value === null ? "" : String(entry.value).trim();
    // ESPHome sends both a presentation `state` (rounded and suffixed with
    // its unit) and the unrounded entity `value`. Diagnostics must expose a
    // single value: preserve `value` byte-for-byte as received, borrowing
    // only the unit suffix from `state` for numeric measurements.
    const numericRaw = raw !== "" && typeof entry.value !== "boolean" && Number.isFinite(Number(raw));
    if (numericRaw) {
      const unit = diagnosticUnit(entry);
      return unit ? `${raw} ${unit}` : raw;
    }
    return localizeDiagnosticValue(formatted || raw || "—");
  }

  const DIAGNOSTIC_ENTITY_LABELS = {
    en: {
      balancing: "Balancing active", charging: "Charge MOS", charging_float_mode: "Float mode", discharging: "Discharge MOS",
      alarms: "Alarms", alarms_bitmask: "Alarm bitmask", average_cell_voltage: "Average cell voltage", balance_current: "Balance current",
      battery_capacity: "Rated capacity", battery_state_candidate: "State candidate", battery_state_candidate_samples: "Candidate samples",
      battery_state_direction: "Current direction", battery_state_time: "State duration", battery_state_last_known: "Last known state",
      battery_state_unknown_reason: "Unknown state reason", device_name: "BMS name", bms_health: "BMS communication",
      bms_last_update_age: "Last BMS update", capacity_remaining: "Remaining capacity", cell_rcv: "Cell charge target",
      cell_rfv: "Cell float target", charge_phase: "Charge phase", charge_phase_time: "Charge phase duration",
      charge_phase_last_known: "Last charge phase", charge_status: "Charge status", charge_status_time: "Charge status duration",
      charging_cycles: "Charge cycles", current: "Current", current_sample_age: "Current sample age", delta_cell_voltage: "Cell voltage delta",
      full_charge_capacity: "Learned capacity", idle_current_noise_max: "Idle noise maximum", idle_current_noise_min: "Idle noise minimum",
      device_model: "BMS model", mosfet_temperature: "MOSFET temperature", power: "Power", state_of_charge: "Charge level",
      state_of_health: "Battery health", cycle_capacity: "Total discharged capacity",
      runtime: "Runtime", total_voltage: "Battery voltage", wifi_signal: "Wi-Fi signal", wifi_ip_address: "IP address", system_uptime: "Uptime",
      cell_count: "Cell count", start_balance_trigger: "Balance trigger delta", start_balance: "Balance start voltage", max_balance_current: "Maximum balance current",
      cell_ovp: "Cell overvoltage protection", cell_ovpr: "Cell overvoltage recovery", cell_uvp: "Cell undervoltage protection", cell_uvpr: "Cell undervoltage recovery",
      soc_100: "100% SOC voltage", soc_0: "0% SOC voltage", system_power_off: "Power-off voltage", smart_sleep: "Smart-sleep voltage",
      continued_charge_current: "Continuous charge current", charge_ocp_delay: "Charge OCP delay", charge_ocpr_time: "Charge OCP recovery",
      continued_discharge_current: "Continuous discharge current", discharge_ocp_delay: "Discharge OCP delay", discharge_ocpr_time: "Discharge OCP recovery",
      discharge_otp: "Discharge overtemperature", discharge_otpr: "Discharge temperature recovery", charge_otp: "Charge overtemperature", charge_otpr: "Charge temperature recovery",
      charge_utp: "Charge undertemperature", charge_utpr: "Charge undertemperature recovery", mos_otp: "MOS overtemperature", mos_otpr: "MOS temperature recovery",
      scp_delay: "Short-circuit delay", scpr_time: "Short-circuit recovery",
      battery_state_candidate_age: "State candidate age", heating_activation_temperature: "Heating activation temperature",
      heating_deactivation_temperature: "Heating deactivation temperature", lcd_buzzer_trigger: "LCD buzzer trigger",
      cell_connected_mask: "Connected cell mask", dry_contact_1_trigger_source: "Dry contact 1 source",
      dry_contact_2_trigger_source: "Dry contact 2 source", dry_contact_1_trigger_value: "Dry contact 1 threshold",
      dry_contact_1_recovery_value: "Dry contact 1 recovery", dry_contact_2_trigger_value: "Dry contact 2 threshold",
      dry_contact_2_recovery_value: "Dry contact 2 recovery", rcv_time: "Charge target duration", rfv_time: "Float target duration",
      control_override_reason: "Control override reason",
      // P1-05 (2026-09-10): the three "X_active" live-status binary sensors
      // (distinct from the "charging"/"discharging"/"balancing" CONTROL
      // register readbacks, which have their own dict entries/special
      // cases above) and every topology/write-transaction bookkeeping
      // field Diagnostics shows (see NON_REGISTER_ENTITY_IDS) were simply
      // missing here — they fell through to the raw-key humanize fallback
      // regardless of language, and in Ukrainian mode that meant English
      // text ("Topology state", "Cellcount tx id") on an otherwise fully
      // localized page.
      charging_active: "Charging active", discharging_active: "Discharging active", balancing_active: "Balancing active",
      connected_cell_count: "Connected cell count", measured_cell_count: "Measured cell count",
      active_cells_voltage_sum: "Active cells voltage sum", effective_cell_count: "Effective cell count",
      display_cell_count: "Display cell count",
      last_confirmed_cell_count: "Last confirmed cell count", topology_revision: "Topology revision",
      topology_data_freshness: "Topology data freshness", topology_state: "Topology state", topology_reason: "Topology state reason",
      cellcount_tx_id: "Cell count transaction id", cellcount_tx_status_code: "Cell count transaction status code",
      setup_passcode_tx_status_code: "Passcode transaction status code", write_tx_snapshot: "Write transaction snapshot",
      device_name_override: "Device name override",
      cell_wire_resistance_ext_capability: "Cell wire resistance extension capability",
      cell_connection_wire_resistance_capability: "Cell connection wire resistance capability",
      cell_connection_wire_resistance_last_outcome: "Cell connection wire resistance last outcome",
      cell_connection_wire_resistance_queued_count: "Cell connection wire resistance queued count",
      cell_connection_wire_resistance_callback_count: "Cell connection wire resistance callback count",
      cell_connection_wire_resistance_last_response_bytes: "Cell connection wire resistance last response bytes",
      cell_connection_wire_resistance_attempt_started_uptime_s: "Cell connection wire resistance attempt started (uptime)",
      cell_connection_wire_resistance_attempt_ended_uptime_s: "Cell connection wire resistance attempt ended (uptime)"
    },
    uk: {
      balancing: "Балансування активне", charging: "MOS заряду", charging_float_mode: "Режим підтримки", discharging: "MOS розряду",
      alarms: "Тривоги", alarms_bitmask: "Маска тривог", average_cell_voltage: "Середня напруга комірки", balance_current: "Струм балансування",
      battery_capacity: "Номінальна ємність", battery_state_candidate: "Кандидат стану", battery_state_candidate_samples: "Семпли кандидата",
      battery_state_direction: "Напрямок струму", battery_state_time: "Тривалість стану", battery_state_last_known: "Останній стан",
      battery_state_unknown_reason: "Причина невідомого стану", device_name: "Назва BMS", bms_health: "Зв’язок із BMS",
      bms_last_update_age: "Давність оновлення BMS", capacity_remaining: "Залишкова ємність", cell_rcv: "Ціль заряду комірки",
      cell_rfv: "Ціль підтримки комірки", charge_phase: "Фаза заряду", charge_phase_time: "Тривалість фази",
      charge_phase_last_known: "Остання фаза заряду", charge_status: "Стан заряду", charge_status_time: "Тривалість стану заряду",
      charging_cycles: "Цикли заряду", current: "Струм", current_sample_age: "Давність семпла струму", delta_cell_voltage: "Різниця напруг комірок",
      full_charge_capacity: "Виміряна ємність", idle_current_noise_max: "Макс. шум струму", idle_current_noise_min: "Мін. шум струму",
      device_model: "Модель BMS", mosfet_temperature: "Температура MOSFET", power: "Потужність", state_of_charge: "Рівень заряду",
      state_of_health: "Стан здоров’я батареї", cycle_capacity: "Усього віддано", runtime: "Час роботи",
      total_voltage: "Напруга батареї", wifi_signal: "Рівень Wi‑Fi", wifi_ip_address: "IP-адреса", system_uptime: "Час роботи",
      // P1-05 (2026-09-10): see the matching comment in the en block above
      // — these were simply missing, and the three "X_active" keys are
      // distinct from the "charging"/"discharging"/"balancing" control-
      // register readbacks already covered above.
      charging_active: "Заряд активний", discharging_active: "Розряд активний", balancing_active: "Балансування активне",
      connected_cell_count: "Підключено комірок", measured_cell_count: "Виміряно комірок",
      active_cells_voltage_sum: "Сума напруг активних комірок", effective_cell_count: "Ефективна кількість комірок",
      display_cell_count: "Кількість комірок для відображення",
      last_confirmed_cell_count: "Останнє підтверджене число комірок", topology_revision: "Ревізія топології",
      topology_data_freshness: "Свіжість даних топології", topology_state: "Стан топології", topology_reason: "Причина стану топології",
      cellcount_tx_id: "ID транзакції кількості комірок", cellcount_tx_status_code: "Код статусу транзакції кількості комірок",
      setup_passcode_tx_status_code: "Код статусу транзакції пароля", write_tx_snapshot: "Знімок транзакції запису",
      device_name_override: "Назва пристрою (локальна)", control_override_reason: "Причина перевизначення контролю",
      cell_wire_resistance_ext_capability: "Підтримка розширення опору проводу комірки", cell_connection_wire_resistance_capability: "Підтримка калібрування опору з'єднувального проводу",
      cell_connection_wire_resistance_last_outcome: "Останній результат калібрування опору проводу", cell_connection_wire_resistance_queued_count: "Кількість поставлених у чергу спроб калібрування",
      cell_connection_wire_resistance_callback_count: "Кількість викликів callback калібрування", cell_connection_wire_resistance_last_response_bytes: "Довжина останньої відповіді калібрування (байт)",
      cell_connection_wire_resistance_attempt_started_uptime_s: "Початок останньої спроби калібрування (uptime)", cell_connection_wire_resistance_attempt_ended_uptime_s: "Завершення останньої спроби калібрування (uptime)",
      cell_count: "Кількість комірок", start_balance_trigger: "Дельта запуску балансування", start_balance: "Напруга запуску балансування", max_balance_current: "Макс. струм балансування",
      cell_ovp: "Захист комірки від перенапруги", cell_ovpr: "Відновлення після перенапруги", cell_uvp: "Захист комірки від низької напруги", cell_uvpr: "Відновлення після низької напруги",
      soc_100: "Напруга 100% заряду", soc_0: "Напруга 0% заряду", system_power_off: "Напруга вимкнення", smart_sleep: "Напруга розумного сну",
      continued_charge_current: "Тривалий струм заряду", charge_ocp_delay: "Затримка захисту струму заряду", charge_ocpr_time: "Відновлення захисту струму заряду",
      continued_discharge_current: "Тривалий струм розряду", discharge_ocp_delay: "Затримка захисту струму розряду", discharge_ocpr_time: "Відновлення захисту струму розряду",
      discharge_otp: "Перегрів під час розряду", discharge_otpr: "Відновлення температури розряду", charge_otp: "Перегрів під час заряду", charge_otpr: "Відновлення температури заряду",
      charge_utp: "Низька температура заряду", charge_utpr: "Відновлення температури заряду", mos_otp: "Перегрів MOSFET", mos_otpr: "Відновлення температури MOSFET",
      scp_delay: "Затримка короткого замикання", scpr_time: "Відновлення після короткого замикання",
      max_cell_voltage: "Максимальна напруга комірки", min_cell_voltage: "Мінімальна напруга комірки",
      max_voltage_cell: "Комірка з максимальною напругою", min_voltage_cell: "Комірка з мінімальною напругою",
      charging_power: "Потужність заряду", discharging_power: "Потужність розряду", charging_current: "Струм заряду", discharging_current: "Струм розряду",
      total_runtime_in_seconds: "Загальний час роботи", disacharge_ocpr_left: "До відновлення захисту розряду",
      disacharge_scpr_left: "До відновлення після замикання", charge_ocpr_left: "До відновлення захисту заряду",
      charge_scpr_left: "До відновлення замикання заряду", uvpr_left: "До відновлення низької напруги", ovpr_left: "До відновлення перенапруги",
      heating_current: "Струм підігріву", rcv_time: "Тривалість цілі заряду", rfv_time: "Тривалість цілі підтримки",
      battery_state_candidate_age: "Вік кандидата стану", heating_activation_temperature: "Температура ввімкнення підігріву",
      heating_deactivation_temperature: "Температура вимкнення підігріву", dry_contact_1_trigger_source: "Джерело сухого контакту 1",
      dry_contact_2_trigger_source: "Джерело сухого контакту 2", dry_contact_1_trigger_value: "Поріг сухого контакту 1",
      dry_contact_1_recovery_value: "Відновлення сухого контакту 1", dry_contact_2_trigger_value: "Поріг сухого контакту 2",
      dry_contact_2_recovery_value: "Відновлення сухого контакту 2", time_smart_sleep: "Тривалість розумного сну",
      smart_sleep_time: "Тривалість розумного сну", device_addr: "Адреса пристрою", device_address: "Адреса пристрою",
      data_stored_period: "Період збереження даних", data_storage_period: "Період збереження даних",
      emerg_time: "Аварійний таймер", emergency_time: "Аварійний таймер", user_private_data: "Приватні дані користувача",
      user_data_2: "Дані користувача 2", user_data2: "Дані користувача 2", uart1_protocol_no: "Протокол UART1",
      uart1_protocol_number: "Протокол UART1", uart2_protocol_no: "Протокол UART2", uart2_protocol_number: "Протокол UART2",
      can_protocol_no: "Протокол CAN", can_protocol_number: "Протокол CAN", lcd_buzzer_trigger: "Умова зумера LCD",
      lcd_buzzer_trigger_value: "Поріг зумера LCD", lcd_buzzer_release_value: "Відновлення зумера LCD",
      dry_1_trigger: "Умова сухого контакту 1", dry_1_trigger_value: "Поріг сухого контакту 1", dry_1_release_value: "Відновлення сухого контакту 1",
      dry_2_trigger: "Умова сухого контакту 2", dry_2_trigger_value: "Поріг сухого контакту 2", dry_2_release_value: "Відновлення сухого контакту 2",
      cell_connected_mask: "Маска підключених комірок", native_bms_power: "Потужність BMS (нативне значення)", precharge_status: "Стан попереднього заряду",
      uart_protocol_library_version: "Версія бібліотеки UART-протоколу", custom_alarm_1: "Користувацька тривога 1", custom_alarm_2: "Користувацька тривога 2",
      sensor_heating_mask: "Маска датчиків / стан підігріву", emergency_timer: "Аварійний таймер", battery_current_correction: "Корекція струму батареї",
      charge_current_measurement_voltage: "Напруга вимірювання струму заряду", discharge_current_measurement_voltage: "Напруга вимірювання струму розряду",
      battery_voltage_correction: "Корекція напруги батареї", alternate_battery_voltage: "Альтернативна напруга батареї", bms_system_ticks: "Системні тики BMS"
    }
  };

  // The three output-permission controls display under a distinct label
  // from their own DIAGNOSTIC_ENTITY_LABELS entry (which describes the
  // live MOS-active status, a different register) — see
  // diagnosticEntityLabel()'s own domain==="select" special case, which
  // this map backs too so the tx-log message (settingFieldLabel(), below)
  // says the same thing as the row itself.
  const PERMISSION_CONTROL_LABELS = {
    uk: { charging: "Заряд дозволено", discharging: "Розряд дозволено", balancing: "Балансування дозволено" },
    en: { charging: "Charge enabled", discharging: "Discharge enabled", balancing: "Balancing enabled" },
  };

  // Label for a SETTING_DEFS/CONTROL_DEFS key, used in write-transaction
  // log/status messages ("cell OVP → 3.65"). Final-preparation-plan Stage 1
  // (§3.8): PROTOCOL_CATALOG.fieldMeta's labelUk/labelEn — generated
  // straight from protocol/registers.canonical.json's own
  // frontend_label_uk/en, never hand-retyped — now wins whenever it has an
  // entry, so this key can never drift out of sync with canonical again.
  // DIAGNOSTIC_ENTITY_LABELS stays as a fallback for whatever isn't a real
  // canonical/non-register key (checked below is safe by construction:
  // fieldMeta is generated from the exact same two source files
  // registerEntity() itself is built from, so nothing reachable here can
  // have a real live value AND be absent from fieldMeta). Falls back to
  // the bare key if somehow nothing has it, rather than showing
  // "undefined".
  function settingFieldLabel(key) {
    const meta = PROTOCOL_CATALOG.fieldMeta[key];
    const catalogLabel = meta && (currentLang === "uk" ? meta.labelUk : meta.labelEn);
    return PERMISSION_CONTROL_LABELS[currentLang]?.[key]
      || catalogLabel
      || DIAGNOSTIC_ENTITY_LABELS[currentLang]?.[key]
      || key;
  }

  // Mirrors the sequence used by the JK mobile application's settings
  // screens. Each row is one logical parameter and may contain alternate
  // ESPHome object IDs used by different firmware/config generations.
  const DIAGNOSTIC_ENTITY_ORDER = [
    ["manufacturer_device_id"], ["total_runtime_formatted", "total_runtime_in_seconds"],
    ["charging"], ["discharging"], ["charging_float_mode"], ["alarms_bitmask"],
    ["cell_count"], ["battery_capacity"], ["capacity_remaining"], ["cycle_capacity"],
    ["charging_cycles"], ["state_of_health"], ["state_of_charge"], ["total_voltage"], ["current"],
    ["balancing"], ["start_balance_trigger"], ["start_balance"], ["max_balance_current"], ["balance_current"],
    ["cell_ovp"],
    ["cell_rcv", "cell_request_charge_voltage"],
    ["soc_100", "soc_100_voltage"],
    ["cell_ovpr"],
    ["smart_sleep", "smart_sleep_voltage"],
    ["cell_uvp"], ["cell_uvpr"], ["soc_0", "soc_0_voltage"], ["system_power_off", "power_off_voltage"],
    ["continued_charge_current", "continuous_charge_current"],
    ["charge_ocp_delay"],
    ["charge_ocpr_time"],
    ["continued_discharge_current", "continuous_discharge_current"],
    ["discharge_ocp_delay"],
    ["discharge_ocpr_time"],
    ["discharge_otp"],
    ["discharge_otpr"],
    ["charge_otp"],
    ["charge_otpr"],
    ["charge_utp"],
    ["charge_utpr"],
    ["heating_activation_temperature", "tmp_start_heating"],
    ["heating_deactivation_temperature", "tmp_stop_heating"],
    ["mos_otp"],
    ["mos_otpr"],
    ["scp_delay"],
    ["scpr_time"],
    ["dry_contact_1_trigger_source", "dry_1_trigger"],
    ["dry_contact_1_trigger_value", "dry_1_trigger_value"],
    ["dry_contact_1_recovery_value", "dry_1_release_value"],
    ["dry_contact_2_trigger_source", "dry_2_trigger"],
    ["dry_contact_2_trigger_value", "dry_2_trigger_value"],
    ["dry_contact_2_recovery_value", "dry_2_release_value"],
    ["average_cell_voltage"], ["delta_cell_voltage"],
    ...Array.from({ length: MAX_CELL_COUNT }, (_, index) => [`cell_voltage_${index + 1}`]),
    ...Array.from({ length: MAX_CELL_COUNT }, (_, index) => [`cell_resistance_${index + 1}`]),
    ["mosfet_temperature"], ["temperature_1"], ["temperature_2"], ["temperature_4"], ["temperature_5"],
    ["cell_rfv", "cell_request_float_voltage"], ["cell_connected_mask"], ["native_bms_power"], ["precharge_status"],
    ["full_charge_capacity"], ["disacharge_ocpr_left"], ["disacharge_scpr_left"], ["charge_ocpr_left"],
    ["charge_scpr_left"], ["uvpr_left"], ["ovpr_left"], ["rcv_time"], ["rfv_time"], ["lcd_buzzer_trigger"],
    ["uart_protocol_library_version"], ["custom_alarm_1"], ["custom_alarm_2"], ["sensor_heating_mask"],
    ["emergency_timer"], ["battery_current_correction"], ["charge_current_measurement_voltage"],
    ["discharge_current_measurement_voltage"], ["battery_voltage_correction"], ["alternate_battery_voltage"], ["bms_system_ticks"]
  ];
  const diagnosticEntityOrder = new Map();
  for (let index = 0; index < DIAGNOSTIC_ENTITY_ORDER.length; index += 1) {
    for (const id of DIAGNOSTIC_ENTITY_ORDER[index]) if (!diagnosticEntityOrder.has(id)) diagnosticEntityOrder.set(id, index);
  }

  function diagnosticObjectId(entry) {
    // entry.key is entityByWireId's own resolution for this entity (see
    // recordDiagnosticReadout's comment) -- authoritative and already
    // correct for both this project's demo wire format and real
    // ESPHome's actual "<domain>/<configured name, spaces intact>" one.
    // The regex fallback only matters for an entry that somehow reached
    // here unregistered; it now also folds spaces to underscores so it
    // degrades toward the same convention instead of a silently
    // different one.
    if (entry.key) return entry.key;
    return entry.id.replace(/^(binary_sensor|text_sensor|sensor|number|select)[\-\/.]/, "").toLowerCase().replace(/\s+/g, "_");
  }

  function diagnosticNumberedSeries(entry) {
    const objectId = diagnosticObjectId(entry);
    let match = objectId.match(/^cell_voltage_(\d+)$/);
    if (match) return { group: 0, index: Number(match[1]) };
    match = objectId.match(/^cell_resistance_(\d+)$/);
    if (match) return { group: 1, index: Number(match[1]) };
    match = objectId.match(/^temperature_(\d+)$/);
    if (match) return { group: 2, index: Number(match[1]) };
    return null;
  }

  function localizeDiagnosticValue(value) {
    if (currentLang !== "uk") return value;
    const translations = {
      on: "Увімк", off: "Вимк", true: "Так", false: "Ні", live: "Активний", delayed: "Із затримкою", stale: "Застарілий", offline: "Немає зв’язку",
      neutral: "Нейтрально", charging: "Заряд", charge: "Заряд", discharging: "Розряд", discharge: "Розряд", idle: "Спокій",
      bulk: "Основний заряд", absorption: "Абсорбція", float: "Підтримка", none: "Немає", unknown: "Невідомо", "n/a": "Н/Д",
      no_telemetry_since_boot: "Немає телеметрії після запуску", awaiting_fresh_sample_after_reconnect: "Очікування свіжого семпла"
    };
    return translations[String(value).trim().toLowerCase()] || value;
  }

  function diagnosticEntityLabel(entry) {
    const objectId = diagnosticObjectId(entry);
    if (entry.domain === "select" && ["charging", "discharging", "balancing"].includes(objectId)) {
      return PERMISSION_CONTROL_LABELS[currentLang][objectId];
    }
    if (entry.domain === "binary_sensor" && ["charging", "discharging"].includes(objectId)) {
      const labels = currentLang === "uk" ? { charging: "Заряд активний", discharging: "Розряд активний" } : { charging: "Charge active", discharging: "Discharge active" };
      return labels[objectId];
    }
    let match = objectId.match(/^cell_voltage_(\d+)$/);
    if (match) {
      const number = match[1].padStart(2, "0");
      return currentLang === "uk" ? `Напруга комірки ${number}` : `Cell voltage ${number}`;
    }
    match = objectId.match(/^cell_resistance_(\d+)$/);
    if (match) {
      const number = match[1].padStart(2, "0");
      return currentLang === "uk" ? `Опір проводу комірки ${number}` : `Cell wire resistance ${number}`;
    }
    match = objectId.match(/^temperature_(\d+)$/);
    if (match) return currentLang === "uk" ? `Температура ${match[1]}` : `Temperature ${match[1]}`;
    // Final-preparation-plan Stage 1 (§3.8): catalog-driven label wins
    // first — see settingFieldLabel()'s comment above for why this is
    // safe and drift-proof (fixes a real prior bug for free: the
    // misspelled disacharge_ocpr_left/disacharge_scpr_left entries in
    // DIAGNOSTIC_ENTITY_LABELS never matched the real key
    // discharge_ocpr_left/discharge_scpr_left; PROTOCOL_CATALOG.fieldMeta
    // has the correctly-spelled key with a real label, so those two rows
    // are now labeled correctly instead of falling through to the raw-key
    // humanize fallback).
    const meta = PROTOCOL_CATALOG.fieldMeta[objectId];
    const catalogLabel = meta && (currentLang === "uk" ? meta.labelUk : meta.labelEn);
    if (catalogLabel) return catalogLabel;
    const labels = DIAGNOSTIC_ENTITY_LABELS[currentLang] || DIAGNOSTIC_ENTITY_LABELS.en;
    if (labels[objectId]) return labels[objectId];
    const words = objectId.replace(/[_-]+/g, " ").trim();
    return words ? words.charAt(0).toUpperCase() + words.slice(1) : entry.id;
  }

  function updateDiagnosticReadoutCount() {
    const counter = getDom("configRegisterCount");
    if (counter) counter.textContent = t("diagnostics.readEntityCount", { received: diagnosticReadouts.size });
  }

  // Third critical audit follow-up (2026-09-10, P1-04): this used to be a
  // SEPARATE, hand-typed array that had drifted from reality — several of
  // its entries used stale/wrong logical keys (e.g. "charge_status_time_elapsed"
  // instead of the real registerEntity() key "charge_status_time",
  // "bms_display_name" instead of "device_name", "battery_state_elapsed"
  // instead of "battery_state_time") — diagnosticObjectId(entry) always
  // resolves to the registerEntity()-registered logical key, never the raw
  // wire name, so those misnamed entries silently matched NOTHING and the
  // real entities leaked straight into the Settings register list. This is
  // the exact defect HARDWARE_AUDIT_2026-09-09.md observed on real
  // hardware ("Battery state time", "Charge phase time", "Runtime" etc.
  // appearing as if they were BMS registers). PROTOCOL_CATALOG.nonRegisterKeys
  // (generated from protocol/non_register_entities.canonical.json, the
  // same pipeline blockedWriteKeys already comes from) is the single
  // source of truth now — deriving straight from it, instead of keeping a
  // second hand-maintained list, makes this exact class of drift
  // structurally impossible going forward.
  const NON_REGISTER_ENTITY_IDS = new Set(PROTOCOL_CATALOG.nonRegisterKeys);

  function isBmsRegisterEntry(entry) {
    const objectId = diagnosticObjectId(entry);
    // Template-number write mirrors are transport endpoints, not additional
    // protocol values. The authoritative sensor/select readback is rendered.
    return !objectId.startsWith("set_") && !NON_REGISTER_ENTITY_IDS.has(objectId);
  }

  // Settings/Diagnostics channel hiding (user-reported defect, fixed
  // 2026-09-17): the Cells tab has always hidden channels beyond
  // configured N (activeCellCount()), but the raw "Регістри BMS" list had
  // no such filter at all -- every one of the 32 protocol-capacity
  // cell_voltage_N/cell_resistance_N/cell_connection_wire_resistance_N
  // rows rendered unconditionally, so a 16S pack showed "Напруга комірки
  // 17..32 = NA" forever (resolve_topology blanks those sensors to NaN,
  // which ESPHome's own JSON encoding renders as the literal string "NA"
  // -- a real, repeatedly-republished value, not a missing one, so these
  // rows never qualified for the "never received" OPTIONAL_REGISTER_ROWS
  // placeholder path either).
  //
  // Channel index is read from objectId -- entry.key's already-resolved,
  // metadata-derived canonical field name (diagnosticObjectId(), same
  // source diagnosticNumberedSeries()/diagnosticEntityLabel() already
  // trust for these exact 3 families) -- never parsed from the localized
  // display label text, so this is immune to language/wording changes.
  // temperature_N is deliberately NOT part of this pattern set: physical
  // temperature sensor count is fixed (independent of cell channel
  // count), so it must never be cell-count-gated.
  function cellChannelRowIndex(objectId) {
    let match = objectId.match(/^cell_voltage_(\d+)$/);
    if (match) return Number(match[1]);
    match = objectId.match(/^cell_resistance_(\d+)$/);
    if (match) return Number(match[1]);
    match = objectId.match(/^cell_connection_wire_resistance_(\d+)$/);
    if (match) return Number(match[1]);
    return null;
  }

  function isHiddenCellChannelRow(entry) {
    const index = cellChannelRowIndex(diagnosticObjectId(entry));
    if (index === null) return false;
    // activeCellCount() is the SAME function the Cells tab itself uses
    // (display_cell_count-driven, 0 while no valid N is known yet -- see
    // its own comment) -- reusing it here means this list's channel
    // visibility can never disagree with the Cells tab's own hiding
    // boundary. Channels 1..N stay visible (with whatever real value or
    // "NA"/"--" placeholder they currently have -- an active channel
    // whose specific parameter hasn't arrived yet is a data-availability
    // concern, never a hiding one); only index > N is filtered out here.
    // Non-numbered entities (topology/capability/everything else) never
    // match cellChannelRowIndex() at all, so this filter cannot touch them.
    return index > activeCellCount();
  }

  function writableDefinitionForEntry(entry) {
    const objectId = diagnosticObjectId(entry);
    // Owner-authorized write re-enablement (2026-09-10): a field is only
    // ever editable here if it appears in SETTING_DEFS/CONTROL_DEFS —
    // both hand-maintained allowlists that must stay in sync with
    // registers.canonical.json's owner_write_override set (asserted by
    // test/protocol_catalog/test_blocked_write_surface.js). Any field NOT
    // in either table still falls through to blockedWriteReason()'s
    // read-only badge, exactly as every field did before this pass.
    //
    // Defense in depth (second critical audit, 2026-09-10): blockedWriteKeys
    // is GENERATED straight from registers.canonical.json's effective_access
    // — the single source of truth. It wins over SETTING_DEFS/CONTROL_DEFS
    // unconditionally, so a hand-maintained table left stale after a field
    // is reverted to fail-closed (or never updated in the first place)
    // can never expose a live editor for it. This check must stay FIRST.
    if (blockedWriteReason(entry)) return null;
    if (CONTROL_DEFS[objectId]) {
      return { key: objectId, kind: "select", inputId: `reg_${objectId}`, ...CONTROL_DEFS[objectId] };
    }
    const setting = SETTING_DEFS.find((item) => item.key === objectId);
    if (setting) return { ...setting, kind: "number" };
    return null;
  }

  function blockedWriteReason(entry) {
    return PROTOCOL_CATALOG.blockedWriteKeys[diagnosticObjectId(entry)] || null;
  }

  // Registers present in the verified workbook but not published as public
  // ESPHome entities by every firmware build. Keep their catalogue rows
  // visible instead of silently pretending that the register does not exist.
  const OPTIONAL_REGISTER_ROWS = Object.freeze([
    ["cell_connected_mask", "Маска підключених комірок", "0x1240"],
    ["native_bms_power", "Потужність BMS (нативне значення)", "0x1294"],
    ["precharge_status", "Стан попереднього заряду", "0x12B8, молодший байт"],
    ["discharge_ocpr_left", "Залишок відновлення OCP розряду", "0x12C4"],
    ["discharge_scpr_left", "Залишок відновлення SCP розряду", "0x12C6"],
    ["charge_ocpr_left", "Залишок відновлення OCP заряду", "0x12C8"],
    ["charge_scpr_left", "Залишок відновлення SCP заряду", "0x12CA"],
    ["uvpr_left", "Залишок відновлення після низької напруги", "0x12CC"],
    ["ovpr_left", "Залишок відновлення після перенапруги", "0x12CE"],
    ["uart_protocol_library_version", "Версія бібліотеки UART-протоколу", "0x14E6, молодший байт"],
    ["custom_alarm_1", "Користувацька тривога 1", "0x12BA"],
    ["custom_alarm_2", "Користувацька тривога 2", "0x12C2"],
    ["sensor_heating_mask", "Маска датчиків / стан підігріву", "0x12D0"],
    ["emergency_timer", "Аварійний таймер", "0x12D4"],
    ["battery_current_correction", "Корекція струму батареї", "0x12D6"],
    ["charge_current_measurement_voltage", "Напруга вимірювання струму заряду", "0x12D8"],
    ["discharge_current_measurement_voltage", "Напруга вимірювання струму розряду", "0x12DA"],
    ["battery_voltage_correction", "Корекція напруги батареї", "0x12DC"],
    ["alternate_battery_voltage", "Альтернативна напруга батареї", "0x12E4"],
    ["bms_system_ticks", "Системні тики BMS", "0x12F0"]
  ]);

  function renderDiagnosticReadouts() {
    diagnosticReadoutRebuild = 0;
    const list = getDom("configRegisterList");
    if (!list) return;
    // The register list is long (100+ rows) and the page uses plain
    // document/window scrolling (no inner overflow:auto container — see
    // html,body's own rule) — a full rebuild here (list.replaceChildren(),
    // below) discards and recreates every row, which resets the window's
    // scroll position to whatever the browser does for a mutated
    // subtree (observed: jumps to the top). This function reruns
    // automatically every time a genuinely NEW register entity's first
    // state arrives (recordDiagnosticReadout's requestAnimationFrame
    // path) — on real hardware, many registers only get their first
    // reading well after the Configuration tab is already open (slow
    // control-parameter poll cadence), so a user scrolling through the
    // list can have it yanked back to the top repeatedly while reading.
    // Capturing and restoring the scroll position around the rebuild
    // fixes exactly that, without needing to avoid the rebuild itself.
    const scroller = document.scrollingElement || document.documentElement;
    const preservedScrollTop = scroller.scrollTop;
    // New register data can arrive while an operator is entering a value.
    // replaceChildren() below removes that focused input, so the browser
    // necessarily drops its caret. Keep both the element ID and caret range
    // and restore them on the equivalent freshly-built input after rendering.
    // This snapshot deliberately does not depend on `dirty`: simply placing
    // the caret must remain stable even before the first character is typed.
    const activeField = document.activeElement;
    const preservedFocus = activeField instanceof HTMLInputElement && list.contains(activeField)
      ? {
        id: activeField.id,
        selectionStart: activeField.selectionStart,
        selectionEnd: activeField.selectionEnd,
      }
      : null;
    // A rebuild discards and recreates every row from scratch — including
    // one the user has an UNCONFIRMED edit sitting in (typed a new
    // threshold, or flipped a toggle) but hasn't pressed OK on yet. Since
    // this function can run at any moment a new register's first reading
    // arrives, that in-progress edit would otherwise silently revert to
    // the live value with no warning — undermining the whole point of
    // requiring an explicit OK to confirm. Snapshot every currently-dirty
    // field here and re-apply it to the freshly-built element with the
    // same wireId below, so a rebuild can never eat an unconfirmed edit.
    const preservedDirty = new Map();
    for (const [wireId, node] of diagnosticReadoutRows) {
      if (node && node.dataset && node.dataset.dirty === "true") {
        preservedDirty.set(wireId, {
          value: node.value,
          isOn: node.classList ? node.classList.contains("is-on") : undefined,
          invalid: node.classList ? node.classList.contains("invalid") : false,
        });
      }
    }
    diagnosticReadoutRows.clear();
    list.replaceChildren();
    const entries = Array.from(diagnosticReadouts.values()).filter(isBmsRegisterEntry).filter((e) => !isHiddenCellChannelRow(e)).sort((a, b) => {
      const ai = diagnosticEntityOrder.get(diagnosticObjectId(a));
      const bi = diagnosticEntityOrder.get(diagnosticObjectId(b));
      if (ai !== undefined || bi !== undefined) {
        const order = (ai ?? 10000) - (bi ?? 10000);
        if (order) return order;
        // For duplicate JK names, display the live R state before the RW
        // permission control, matching the workbook's two-row sequence.
        const rank = (entry) => entry.domain === "binary_sensor" ? 0 : entry.domain === "select" ? 1 : 2;
        return rank(a) - rank(b);
      }
      const as = diagnosticNumberedSeries(a);
      const bs = diagnosticNumberedSeries(b);
      if (as || bs) {
        if (!as) return 1;
        if (!bs) return -1;
        return as.group - bs.group || as.index - bs.index;
      }
      return diagnosticEntityLabel(a).localeCompare(diagnosticEntityLabel(b), currentLang);
    });
    const fragment = document.createDocumentFragment();
    for (const entry of entries) {
      const row = document.createElement("div");
      row.className = "diag-row diag-entity-row";
      row.setAttribute("role", "row");
      const id = document.createElement("span");
      id.textContent = diagnosticEntityLabel(entry);
      id.dataset.registerLabel = id.textContent;
      id.title = entry.id;
      // Programmatic accessible name for the writable control this row
      // may render below (switch or number input) — the visible label is
      // otherwise only adjacent in the DOM, not associated with it, so a
      // screen reader would announce a bare "switch"/"edit text" with no
      // name for every row in a long register list.
      id.id = `diag-label-${entry.id}`;
      const value = document.createElement("b");
      value.className = "num diag-entity-value";
      value.textContent = diagnosticReadoutValue(entry);
      value.title = value.textContent;
      if (entry.key) {
        const stale = isFieldStale(entry.key);
        value.classList.toggle("is-stale", stale);
        if (stale) value.title = staleTitle(entry.key);
      }
      const writable = writableDefinitionForEntry(entry);
      if (writable) {
        const editor = document.createElement("span");
        editor.className = "register-editor";
        // On/off registers use the same switch component as the rest of the
        // UI, but with an armed two-tap confirmation: the first tap previews
        // the requested state and asks for confirmation; the second performs
        // the write and waits for read-back. HTMLButtonElement.value is a
        // standard DOM property (reflects the value="" attribute), so the
        // existing setting transaction can read "On"/"Off" directly.
        const input = writable.kind === "select" ? document.createElement("button") : document.createElement("input");
        input.id = writable.inputId;
        if (writable.kind === "select") {
          input.type = "button";
          input.className = "switch register-toggle";
          input.setAttribute("role", "switch");
          input.setAttribute("aria-labelledby", id.id);
          input.dataset.registerToggle = writable.key;
          input.appendChild(document.createElement("i"));
          const isOn = booleanValue(writable.key) === true;
          const armed = armedRegisterToggle?.key === writable.key;
          const shown = armed ? armedRegisterToggle.next : isOn;
          input.value = shown ? "On" : "Off";
          input.classList.toggle("is-on", shown);
          input.classList.toggle("is-armed", armed);
          input.setAttribute("aria-checked", String(shown));
          if (armed) { id.textContent = t("common.confirmQuestion"); id.classList.add("register-confirm-label"); }
        } else {
          // `type=number` silently rejects a comma in Chromium, while the
          // Ukrainian UI displays and users naturally enter 3,450. Keep a
          // numeric mobile keyboard, but accept both decimal separators;
          // submitRegisterSetting() normalizes comma → dot before its real
          // range/step validation and before any write is sent to the BMS.
          input.type = "text";
          input.setAttribute("aria-labelledby", id.id);
          input.inputMode = "decimal";
          // Stage 1 hardware acceptance corrective pass: a bare, unescaped
          // trailing "-" inside a character class is valid under the plain
          // and "u" (unicode) regex flags this HTML5 pattern attribute used
          // to compile under, but WebKit/Safari has moved to compiling
          // pattern= against the newer, stricter "v" (unicodeSets) flag,
          // which rejects it outright -- confirmed directly: `new
          // RegExp("[0-9.,+-]*", "v")` throws "Invalid character in
          // character class" in this exact Node version, while the
          // hyphen-escaped form below is valid under both "u" and "v" and
          // matches the byte-for-byte identical set of characters (this is
          // a keystroke-level allow-list only -- real numeric-format/range
          // validation happens in submitRegisterSetting(), unchanged).
          input.pattern = "[0-9.,+\\-]*";
          input.spellcheck = false;
          input.autocomplete = "off";
          if (Number.isFinite(writable.min)) input.min = String(writable.min);
          if (Number.isFinite(writable.max)) input.max = String(writable.max);
          if (Number.isFinite(writable.step)) input.step = String(writable.step);
          input.value = String(entry.value ?? "");
        }
        const unit = writable.kind === "select" ? "" : diagnosticUnit(entry);
        if (writable.kind === "select") {
          // Binary permissions write directly from their toggle, but only
          // after a second, explicitly-confirming toggle press.
          editor.classList.add("toggle-editor");
          editor.append(input);
        } else {
          const ok = document.createElement("button");
          ok.type = "button";
          ok.className = "register-ok";
          ok.dataset.registerWrite = writable.key;
          ok.textContent = t("configuration.save");
          const writeVisual = registerWriteVisualStates.get(writable.key);
          if (writeVisual) setRegisterWriteButton(ok, writeVisual.state, false);
          if (unit) {
          editor.classList.add("has-unit");
          // No longer needs a "unit-long" size variant: the wrap is a
          // flex box that centers the value+unit pair as a group, so it
          // already accommodates a longer unit (e.g. "А·год") without a
          // separate reserved-padding class.
          const inputWrap = document.createElement("span");
          inputWrap.className = "register-input-wrap";
          const suffix = document.createElement("span");
          suffix.className = "register-unit";
          suffix.textContent = unit;
          inputWrap.append(input, suffix);
            editor.append(inputWrap, ok);
          } else editor.append(input, ok);
        }
        row.append(id, editor);
      } else {
        const blockedReason = blockedWriteReason(entry);
        if (blockedReason) {
          row.classList.add("register-write-blocked");
          value.title = (currentLang === "uk" ? "Запис заблоковано: " : "Write blocked: ") + blockedReason;
          const badge = document.createElement("i");
          badge.className = "register-blocked-badge";
          badge.textContent = currentLang === "uk" ? "лише читання" : "read-only";
          badge.title = value.title;
          row.append(id, value, badge);
        } else {
          row.append(id, value);
        }
      }
      fragment.appendChild(row);
      diagnosticReadoutRows.set(entry.id, writable ? row.querySelector("input, .register-toggle") : value);
    }
    const receivedObjectIds = new Set(entries.map(diagnosticObjectId));
    for (const [objectId, ukLabel, address] of OPTIONAL_REGISTER_ROWS) {
      if (receivedObjectIds.has(objectId)) continue;
      const row = document.createElement("div");
      row.className = "diag-row diag-entity-row register-unavailable";
      row.setAttribute("role", "row");
      const label = document.createElement("span");
      label.textContent = currentLang === "uk" ? ukLabel : objectId.replaceAll("_", " ");
      label.title = address;
      const value = document.createElement("b");
      value.className = "num diag-entity-value";
      value.textContent = "—";
      value.title = currentLang === "uk" ? `ESPHome не опублікував регістр ${address}` : `ESPHome did not publish register ${address}`;
      row.append(label, value);
      fragment.appendChild(row);
    }
    list.appendChild(fragment);
    updateDiagnosticReadoutCount();
    // Re-apply any edit that was still pending (not yet OK'd) before this
    // rebuild, onto the newly-created element for the same wireId — see
    // the snapshot comment above for why this exists. A register that
    // vanished from this render entirely (shouldn't normally happen) just
    // has nothing to re-apply to, which is a safe no-op.
    for (const [wireId, pending] of preservedDirty) {
      const node = diagnosticReadoutRows.get(wireId);
      if (!node) continue;
      node.value = pending.value;
      node.dataset.dirty = "true";
      if (node.classList) {
        node.classList.toggle("invalid", pending.invalid);
        if (pending.isOn !== undefined) {
          node.classList.toggle("is-on", pending.isOn);
          node.setAttribute("aria-checked", String(pending.isOn));
        }
      }
    }
    // Restore focus after pending values have been reapplied, otherwise the
    // selection range could be calculated against an outdated value. Query
    // the document rather than domCache: the latter may still point at the
    // detached input that replaceChildren() has just removed.
    if (preservedFocus?.id) {
      const restoredField = document.getElementById(preservedFocus.id);
      if (restoredField instanceof HTMLInputElement && !restoredField.disabled) {
        restoredField.focus({ preventScroll: true });
        const length = restoredField.value.length;
        const start = Math.max(0, Math.min(preservedFocus.selectionStart ?? length, length));
        const end = Math.max(start, Math.min(preservedFocus.selectionEnd ?? length, length));
        try {
          restoredField.setSelectionRange(start, end);
        } catch (_) {
          // A browser may decline a selection range for a non-text input;
          // focusing it is still the correct, usable fallback.
        }
      }
    }
    // Restored synchronously (not via rAF) so there's no visible flash of
    // the wrong scroll position between the rebuild and the restore.
    // Rows are close enough in height (register-unavailable placeholders
    // vs. real editable rows both sit around the same ~58px min-height)
    // that a plain pixel restore lands back at essentially the same
    // reading position, not just "somewhere closer to the top than 0".
    scroller.scrollTop = preservedScrollTop;
  }

  // Companion to renderDiagnosticReadouts(): the register/BMS-parameter
  // list on Налаштування deliberately EXCLUDES entries in
  // NON_REGISTER_ENTITY_IDS (computed/software state -- resolver
  // internals, connection health, derived power figures -- not a
  // physical Modbus register with its own address). Those entries still
  // need to be visible SOMEWHERE; they belong on Діагностика, read-only
  // (none of them are writable, so no editor/OK button is ever built
  // here, unlike renderDiagnosticReadouts). Was previously dead code
  // pointing at a ".diag-entity-list" selector that matched nothing.
  //
  // Scroll-reset defect (hardware retest, post-1926c1c): unlike its
  // sibling renderDiagnosticReadouts(), this function used to call
  // list.replaceChildren(fragment) unconditionally on EVERY invocation,
  // AND -- unlike the register list -- it never registered its own value
  // nodes into diagnosticReadoutRows, so recordDiagnosticReadout()'s
  // in-place fast path (below) could never find them: every single update
  // to ANY software-variable value (several tick at least once per
  // second -- current_sample_age, bms_last_update_age, etc.) fell through
  // to a full rAF-scheduled renderDiagnosticPanels() rebuild, wiping and
  // recreating this entire list on the DOM. On the Діагностика tab (where
  // this list is the visible one) that produced a full subtree
  // replacement roughly once a second, which is what was actually
  // yanking the page back to the top while scrolled -- not a one-off
  // "first reading" event the way the register list's own comment
  // describes. Fixed at the root, per the stable-DOM-update-first
  // preference: reuse each row's existing DOM nodes across renders
  // (only text content changes, never removed/recreated) AND register
  // each row's value node into diagnosticReadoutRows so future updates
  // to an already-rendered entry take recordDiagnosticReadout's in-place
  // path and never call this function again at all -- the common case no
  // longer performs ANY DOM removal, so there is nothing for a forced
  // scroll restore to compensate for. A brand-new entity's first-ever
  // reading (rare after the initial few seconds) still inserts one row;
  // scroll position is preserved around that too, defensively, matching
  // renderDiagnosticReadouts()'s own established pattern. No <input> or
  // other focusable control ever exists in this list (confirmed: rows
  // are a plain <span> label + <b> value, read-only) so there is no
  // focus/draft/selection state that could be lost here.
  function renderDiagnosticSoftwareVariables() {
    const list = getDom("diagSoftwareVarList");
    if (!list) return;
    const entries = Array.from(diagnosticReadouts.values())
      .filter((entry) => NON_REGISTER_ENTITY_IDS.has(diagnosticObjectId(entry)))
      .sort((a, b) => diagnosticEntityLabel(a).localeCompare(diagnosticEntityLabel(b), currentLang));

    const scroller = document.scrollingElement || document.documentElement;
    const preservedScrollTop = scroller.scrollTop;

    const seen = new Set();
    let previousRow = null;
    for (const entry of entries) {
      seen.add(entry.id);
      let cached = diagSoftwareVarRows.get(entry.id);
      if (!cached) {
        const row = document.createElement("div");
        row.className = "diag-row diag-entity-row";
        row.setAttribute("role", "row");
        const label = document.createElement("span");
        const value = document.createElement("b");
        value.className = "num diag-entity-value";
        row.append(label, value);
        cached = { row, label, value };
        diagSoftwareVarRows.set(entry.id, cached);
      }
      // Re-asserted on every render, not just at creation: renderDiagnosticReadouts()'s
      // own rebuild clears diagnosticReadoutRows wholesale for ITS entries -- this
      // re-registration is what lets recordDiagnosticReadout()'s in-place fast path
      // keep finding this row afterwards too, instead of only until the next
      // unrelated register-list rebuild silently drops it.
      diagnosticReadoutRows.set(entry.id, cached.value);
      const labelText = diagnosticEntityLabel(entry);
      if (cached.label.textContent !== labelText) cached.label.textContent = labelText;
      cached.label.title = entry.id;
      const valueText = diagnosticReadoutValue(entry);
      if (cached.value.textContent !== valueText) cached.value.textContent = valueText;
      cached.value.title = valueText;
      // Reposition only if this row isn't already right where it belongs --
      // inserting a node immediately before itself is a harmless no-op per
      // the DOM spec, but skipping the call entirely keeps the steady-state
      // path free of ANY list mutation, not just a cheap one.
      const desiredNext = previousRow ? previousRow.nextSibling : list.firstChild;
      if (cached.row !== desiredNext) list.insertBefore(cached.row, desiredNext);
      previousRow = cached.row;
    }
    // Entries don't normally disappear once first seen, but keep the list
    // (and its two row-lookup caches) honest if one ever does.
    for (const [wireId, cached] of diagSoftwareVarRows) {
      if (seen.has(wireId)) continue;
      cached.row.remove();
      diagSoftwareVarRows.delete(wireId);
      if (diagnosticReadoutRows.get(wireId) === cached.value) diagnosticReadoutRows.delete(wireId);
    }

    scroller.scrollTop = preservedScrollTop;
  }

  function renderDiagnosticPanels() {
    renderDiagnosticReadouts();
    renderDiagnosticSoftwareVariables();
  }

  function recordDiagnosticReadout(wireId, payload, key) {
    const domain = readOnlyDomain(wireId);
    if (!domain) return;
    const rawState = payload.state !== undefined ? payload.state : payload.value;
    const rawValue = payload.value !== undefined ? payload.value : payload.state;
    // `key` is entityByWireId's ALREADY-resolved lookup for this exact
    // wireId (computed once in ingestPayload, the same resolution the
    // rest of the app relies on for state[key]/writeTransaction/etc.) --
    // diagnosticObjectId() below uses it directly instead of re-deriving
    // a key from the raw wire id via its own regex. That regex assumed a
    // hyphen-and-underscore wire format ("sensor-cell_ovp"); real
    // ESPHome's web_server actually sends "<domain>/<configured name>"
    // WITH SPACES ("sensor/cell OVP"), which the regex silently mismatched
    // against every underscored SETTING_DEFS/NON_REGISTER_ENTITY_IDS key
    // that has more than one word -- breaking writability, "set_"
    // duplicate suppression, and the software-variable filter for nearly
    // every multi-word register on real hardware (single-word ones like
    // "charging" happened to still match, which is why this went
    // undetected against the demo mock, whose own wire format happens to
    // already be underscored).
    const entry = { id: wireId, key, domain, state: rawState, value: rawValue };
    diagnosticReadouts.set(wireId, entry);
    const valueNode = diagnosticReadoutRows.get(wireId);
    if (valueNode) {
      const next = diagnosticReadoutValue(entry);
      if (valueNode instanceof HTMLInputElement) {
        if (valueNode.dataset.dirty !== "true" && document.activeElement !== valueNode) valueNode.value = String(entry.value ?? "");
      } else if (valueNode.classList && valueNode.classList.contains("register-toggle")) {
        // No focus check (a button isn't a text field being typed into) —
        // only "has the user flipped this and not yet confirmed/reverted"
        // (dataset.dirty) gates whether a live update is allowed to move
        // the toggle out from under a pending edit.
        if (valueNode.dataset.dirty !== "true") {
          const isOn = booleanValue(diagnosticObjectId(entry)) === true;
          valueNode.value = isOn ? "On" : "Off";
          valueNode.classList.toggle("is-on", isOn);
          valueNode.setAttribute("aria-checked", String(isOn));
        }
      } else {
        // Read-only value node: a fresh payload just arrived for this key
        // (whether or not the displayed value itself changed), so it is
        // current as of now — clear any stale marker unconditionally,
        // outside the textContent-changed check, so a value that happens
        // to hold steady doesn't keep showing a stale badge from before
        // this update.
        if (valueNode.textContent !== next) valueNode.textContent = next;
        if (valueNode.classList) valueNode.classList.remove("is-stale");
        valueNode.title = next;
      }
      return;
    }
    // Do not replace the register list while its numeric editor owns the
    // focus. A newly discovered BMS entity may otherwise arrive in the tiny
    // interval between a tap and the first keystroke, removing the caret
    // before the value can be entered. The queued rebuild runs as soon as
    // the operator leaves the editor (see the configuration focusout hook).
    const list = getDom("configRegisterList");
    if (document.activeElement instanceof HTMLInputElement && list?.contains(document.activeElement)) {
      diagnosticReadoutRebuildDeferred = true;
      return;
    }
    if (!diagnosticReadoutRebuild) diagnosticReadoutRebuild = window.requestAnimationFrame(renderDiagnosticPanels);
  }

  function ingestEvent(event) {
    if (!event || typeof event.data !== "string" || event.data.length === 0 || event.data.length > 32768) return;
    try {
      const payload = JSON.parse(event.data);
      if (Array.isArray(payload)) {
        for (let i = 0; i < payload.length && i < 256; i += 1) ingestPayload(payload[i]);
      } else ingestPayload(payload);
    } catch (_) {
      // Malformed SSE chunks and keepalives are ignored without touching state.
    }
  }

  function numeric(key) {
    const current = state[key];
    if (!current) return null;
    // ESPHome's formatted state is authoritative because it already contains
    // the component filters/scaling; raw `value` is only a compatibility path.
    const displayed = Number.parseFloat(current.state);
    if (Number.isFinite(displayed)) return displayed;
    const raw = Number.parseFloat(current.value);
    return Number.isFinite(raw) ? raw : null;
  }

  /* ---------- topology resolver (consumer side) ----------
     batterylifepo4.yaml's resolve_topology script is the single source of
     truth: CellCount is BMS *configuration*, never proof of the pack's
     actual physical topology, so this file never re-derives topology
     itself — it only reads what the device already resolved and refuses
     to trust effective_cell_count for anything critical until the device
     says CONFIRMED. topology_state/topology_reason are stable English
     codes (like bms_health's LIVE/DELAYED/STALE/OFFLINE) — bilingual
     presentation lives entirely here, see topologyReasonText(). */
  const TOPOLOGY_STATES = Object.freeze([
    "LOADING", "PENDING", "CONFIRMED", "MISMATCH", "INVALID", "OFFLINE", "WRITE_UNCERTAIN"
  ]);
  function topologyState() {
    const raw = state.topology_state;
    const code = raw ? String(raw.state !== undefined ? raw.state : raw.value || "").trim().toUpperCase() : "";
    return TOPOLOGY_STATES.indexOf(code) !== -1 ? code : "LOADING";
  }

  function topologyReasonCode() {
    const raw = state.topology_reason;
    return raw ? String(raw.state !== undefined ? raw.state : raw.value || "").trim().toUpperCase() : "";
  }

  function topologyReasonText() {
    const code = topologyReasonCode();
    if (!code) return "";
    const known = lookupKey(I18N[currentLang], `topology.reason.${code}`) !== undefined
      || lookupKey(I18N.en, `topology.reason.${code}`) !== undefined;
    return known ? t(`topology.reason.${code}`) : code;
  }

  // Configured channel count and confirmed/trustworthy status are TWO
  // DIFFERENT CONCEPTS (user-directed rework, THIRD pass, 2026-09-17):
  // how many channels the UI renders (this function) is driven by
  // resolve_topology's own display_cell_count (batterylifepo4.yaml /
  // jk_topology_core.h) — a validly-read CellCount in EVERY state
  // (CONFIRMED, MISMATCH, OFFLINE with a cached last-read value), not
  // only when fully confirmed. CONFIRMED/MISMATCH/OFFLINE/etc. instead
  // drive VALUE trust (see renderTopologyBanner()) — never channel count.
  // This is ONE general mechanism driven entirely by whatever N the
  // device reports — never a fixed set of hardcoded topology sizes (4S/
  // 8S/16S/24S/32S are all the exact same code path here, differing only
  // in the numbers that flow through it).
  //
  // display_cell_count's own 0 covers BOTH "no valid N yet" cases
  // uniformly: LOADING (no snapshot since boot/reconnect -- never a
  // previous device's residual configuration) and INVALID/
  // COUNT_OUT_OF_RANGE (CellCount itself read as nonsensical -- an
  // explicit configuration error, never silently turned into the full
  // 32-channel pool). Both render nothing; topologyReasonText() is what
  // distinguishes "loading" from "config error" for the operator.
  //
  // effective_cell_count (the OLD field this function used to read) keeps
  // its own, narrower "trust this only once CONFIRMED" meaning — still
  // used elsewhere (the CellCount write-transaction driver) — but is no
  // longer what decides how many cards/rows/series/selectors render.
  function activeCellCount() {
    const reported = numeric("display_cell_count");
    if (!Number.isFinite(reported)) return 0;  // sensor never published yet == LOADING
    const count = Math.trunc(reported);
    return count >= 1 && count <= MAX_CELL_COUNT ? count : 0;
  }

  function booleanValue(key) {
    const current = state[key];
    if (!current) return null;
    const value = current.state.trim().toLowerCase();
    if (value === "on" || value === "true" || value === "1" || value === "active" || value === "enabled") return true;
    if (value === "off" || value === "false" || value === "0" || value === "inactive" || value === "disabled") return false;
    return null;
  }

  /* ---------- unit presentation layer ----------
     Canonical unit tokens (V/A/W/kW/kWh/Ah/mV/°C/Ω/%) are what every
     calculation, comparator and entity actually deals with — NEVER
     translated, never touched here. This table only controls what
     characters are shown to the reader; unitLabel() is the single place
     that decision is made, so no component hardcodes a translated unit
     string itself. */
  const UNIT_DISPLAY = {
    en: { V: "V", A: "A", W: "W", kW: "kW", kWh: "kWh", Ah: "Ah", mV: "mV", "°C": "°C", "Ω": "Ω", "mΩ": "mΩ", "%": "%" },
    uk: { V: "В", A: "А", W: "Вт", kW: "кВт", kWh: "кВт·год", Ah: "А·год", mV: "мВ", "°C": "°C", "Ω": "Ω", "mΩ": "мОм", "%": "%" }
  };
  function unitLabel(canonicalUnit) {
    const table = UNIT_DISPLAY[currentLang] || UNIT_DISPLAY.en;
    return Object.prototype.hasOwnProperty.call(table, canonicalUnit) ? table[canonicalUnit] : canonicalUnit;
  }

  // suffix is a CANONICAL unit token ("V", "°C", ...), resolved through
  // unitLabel() at format time — never a pre-translated literal — so a
  // language switch that replays every bound renderer (see
  // refreshAllDynamicText) picks up the new unit automatically.
  function formatNumber(key, digits, unit) {
    const value = numeric(key);
    if (value === null) return "--";
    if (!unit) return value.toFixed(digits);
    const sep = unit === "%" ? "" : " ";
    return `${value.toFixed(digits)}${sep}${unitLabel(unit)}`;
  }

  // Same numeric formatting as formatNumber(), but writes the unit into a
  // genuinely separate <small> child instead of baking it into one flat
  // text run — so CSS (.telemetry-value small etc.) can keep the unit
  // visually distinct (smaller, muted) the way it's styled to, rather
  // than that rule silently never matching anything. innerHTML is safe
  // here: value/unit are both internally computed, never user input.
  function setMeasurement(id, rawValue, digits, unit, key) {
    const node = getDom(id);
    if (!node) return;
    if (rawValue === null || rawValue === undefined || !Number.isFinite(rawValue)) { node.textContent = "--"; return; }
    node.innerHTML = `${rawValue.toFixed(digits)}<small>${unitLabel(unit)}</small>`;
    // A real payload just arrived for this key — apply the current
    // staleness verdict now rather than waiting up to
    // STALE_SWEEP_INTERVAL_MS for the periodic sweep to catch up (the
    // sweep's job is only to detect a register going quiet, not to be the
    // sole path that ever clears the marker).
    if (key) {
      node.classList.toggle("is-stale", isFieldStale(key));
      node.title = staleTitle(key) || "";
    }
  }

  function setText(id, value) {
    const node = getDom(id);
    if (node && node.textContent !== value) node.textContent = value;
  }

  function escapeHtml(value) {
    return String(value).replace(/[&<>"']/g, (character) => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;"
    }[character]));
  }

  // Compact style in both languages ("1h 12m 17s" / "1г 12хв 17с") — one
  // consistent format per language, not a mix of English unit letters
  // inside Ukrainian text.
  function formatDuration(totalSeconds) {
    const seconds = Math.max(0, Math.trunc(totalSeconds));
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = seconds % 60;
    const hu = t("common.durationHour"), mu = t("common.durationMinute"), su = t("common.durationSecond");
    // A real space between number and unit in every segment ("32 хв 40 с",
    // not "32хв 40с") — consistent in both languages, not just between
    // segments.
    if (h > 0) return `${h} ${hu} ${m} ${mu} ${s} ${su}`;
    if (m > 0) return `${m} ${mu} ${s} ${su}`;
    return `${s} ${su}`;
  }

  function alarmReason() {
    const current = state.alarms;
    if (current && current.state) {
      const raw = current.state.trim();
      const normalized = raw.toLowerCase();
      if (raw && normalized !== "none" && normalized !== "no alarms" && normalized !== "no active alarms" && normalized !== "ok" && normalized !== "unknown") return raw;
    }
    const bitmask = numeric("alarms_bitmask");
    return bitmask !== null && bitmask > 0 ? `Alarm bitmask 0x${Math.trunc(bitmask).toString(16).toUpperCase()}` : "";
  }

  // `charge_status` (batterylifepo4.yaml) is the single canonical battery-
  // state resolver — communication staleness, the real Float protocol
  // bit, and hysteresis-confirmed current direction all get decided
  // exactly once, server-side. This function does NOT re-derive state
  // from current/charging-enabled flags itself (that was the old,
  // buggy design: it could never actually reach "discharging" and
  // conflated Idle with active discharge) — it only maps the backend's
  // already-canonical lowercase key to a translated label. See the
  // resolver's own comment in the YAML for the full priority order and
  // the deadband/dwell reasoning.
  function chargeStage() {
    const reason = alarmReason();
    if (reason) return { key: "lockout", label: t("stage.lockout"), reason };
    const current = state.charge_status;
    const raw = current && current.state ? current.state.trim() : "";
    const normalized = raw.toLowerCase();
    switch (normalized) {
      case "absorption": return { key: "absorption", label: t("stage.absorption"), reason: "" };
      case "float": return { key: "float", label: t("stage.float"), reason: "" };
      // "charging" is the public battery_state for plain constant-current
      // charging — the backend never returns "bulk" here (that's
      // charge_phase's own concept; see ccStageName()/charge_phase for it).
      case "charging": return { key: "charging", label: t("stage.charging"), reason: "" };
      case "discharging": return { key: "discharging", label: t("stage.discharging"), reason: "" };
      case "idle": return { key: "idle", label: t("stage.idle"), reason: "" };
      case "offline": return { key: "offline", label: t("stage.offline"), reason: "" };
      case "": return { key: "idle", label: t("stage.idle"), reason: "" }; // no charge_status payload has arrived yet (e.g. still booting)
      default:
        // A real, unrecognized raw value — surface it rather than
        // silently treating it as Idle, so a protocol/firmware change
        // that adds a new state is noticed instead of hidden.
        if (window.console && console.warn) console.warn(`[battery-state] unknown charge_status value: "${raw}"`);
        return { key: "unknown", label: t("stage.unknown"), reason: "" };
    }
  }

  function renderChargeAndAlarms() {
    const stage = chargeStage();
    const stageEl = getDom("stageLabel");
    if (stageEl) {
      stageEl.dataset.stage = stage.key;
      const textNode = stageEl.lastChild;
      if (textNode && textNode.nodeType === Node.TEXT_NODE) textNode.textContent = stage.label;
      else stageEl.appendChild(document.createTextNode(stage.label));
    }
    // The hero's own duration is battery_state's clock (how long has the
    // pack been Charging/Discharging/Float/Idle/Absorption), not
    // charge_phase's — those two only coincide while actively charging.
    const seconds = numeric("battery_state_time");
    setText("stageSub", seconds === null ? `${t("common.elapsed")} --` : `${t("common.elapsed")} ${formatDuration(seconds)}`);

    const systemLine = getDom("systemLine");
    const chipText = getDom("statusChipText");
    if (systemLine) systemLine.classList.toggle("alert", Boolean(stage.reason));
    if (chipText) chipText.textContent = stage.reason || t("common.allSystemsNormal");
    const railDot = getDom("railDot");
    if (railDot) railDot.classList.toggle("show", Boolean(stage.reason));
    renderAlarmList(stage.reason);
    setText("synthProtectionValue", stage.reason ? t("health.alert") : t("common.normal"));
    setText("synthProtectionCaption", stage.reason || t("health.noActiveAlarms"));
  }

  function renderTempSummary() {
    const probes = [numeric("mosfet_temperature"), numeric("temperature_1"), numeric("temperature_2"), numeric("temperature_4"), numeric("temperature_5")].filter((v) => v !== null);
    if (!probes.length) {
      setText("tempMaxValue", "--"); setText("tempMinValue", "--");
      setText("synthThermalValue", "--"); setText("synthThermalCaption", t("health.noProbeData"));
      return;
    }
    const max = Math.max.apply(null, probes), min = Math.min.apply(null, probes);
    setText("tempMaxValue", `${max.toFixed(1)} ${unitLabel("°C")}`);
    setText("tempMinValue", `${min.toFixed(1)} ${unitLabel("°C")}`);
    setText("synthThermalValue", `${max.toFixed(1)}${unitLabel("°C")}`);
    setText("synthThermalCaption", tp("health.probe", probes.length));
  }

  function renderAlarmList(reason) {
    const list = getDom("alarmBody");
    if (!list) return;
    const markupKey = reason || "__clear__";
    if (markupKey === lastAlarmMarkupKey) return;
    lastAlarmMarkupKey = markupKey;
    if (!reason) {
      list.innerHTML = `<div class="alarm-empty"><span class="ring"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 13l4 4L15 7"/></svg></span><strong>${escapeHtml(t("health.noActiveAlarms"))}</strong><small>${escapeHtml(t("thermal.allMonitoredNormal"))}</small></div>`;
      return;
    }
    const lockoutLabel = escapeHtml(t("thermal.emergencyLockout"));
    const reasons = reason.split(/[,;|\n]+/);
    let html = "";
    for (let i = 0; i < reasons.length; i += 1) {
      const text = reasons[i].trim();
      if (text) html += `<div class="alarm-item"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 4 3 20h18z"/><line x1="12" y1="10.5" x2="12" y2="14.5"/><circle cx="12" cy="17.3" r=".3"/></svg><div><strong>${lockoutLabel}</strong><small>${escapeHtml(text)}</small></div></div>`;
    }
    list.innerHTML = html || `<div class="alarm-item"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 4 3 20h18z"/><line x1="12" y1="10.5" x2="12" y2="14.5"/><circle cx="12" cy="17.3" r=".3"/></svg><div><strong>${lockoutLabel}</strong><small>${escapeHtml(reason)}</small></div></div>`;
  }

  /* ---------- SOC readout: one real threshold, not a gradient ----------
     A mid-range amber "caution" zone wouldn't correspond to anything the
     BMS actually does. The only state that matters is "close enough to
     the low-voltage cutoff to look at it" — so a single threshold at 25%
     flips the number and bar to danger, and nothing changes above it. */
  const CRITICAL_SOC = 25;
  let socShown = 0;
  let socAnimated = false;

  function reducedMotion() { return window.matchMedia("(prefers-reduced-motion: reduce)").matches; }

  /* ---------- Min/Max level-flow: two adjacent halves, one shared scale ----------
     A dedicated component (NOT the per-cell bar chart, which stays a plain
     analytics view with no particle) — left half MIN, right half MAX,
     each with its own real fill height on the SAME domainLow/domainHigh
     the bar chart itself uses, connected by one smooth boundary curve
     (never two independent flat rectangles, never a hard 90° step). The
     particle travels along that EXACT boundary path (sampled via
     SVGPathElement.getPointAtLength — not a fixed line, not a guess) from
     the MAX side to the MIN side. Illustrates the pack's voltage spread,
     not a claim about physical balancer current routing (this BMS
     protocol exposes no per-cell current-routing telemetry to justify
     that claim either way). */
  const MINMAX_VIEW_W = 200, MINMAX_VIEW_H = 100, MINMAX_CURVE_HALF = 22;
  function minmaxBoundaryD(minLevelPct, maxLevelPct) {
    const minY = MINMAX_VIEW_H - minLevelPct, maxY = MINMAX_VIEW_H - maxLevelPct;
    const cx = MINMAX_VIEW_W / 2;
    const leftFlatX = cx - MINMAX_CURVE_HALF, rightFlatX = cx + MINMAX_CURVE_HALF;
    return `M0,${minY.toFixed(2)} L${leftFlatX},${minY.toFixed(2)} C${cx - 8},${minY.toFixed(2)} ${cx + 8},${maxY.toFixed(2)} ${rightFlatX},${maxY.toFixed(2)} L${MINMAX_VIEW_W},${maxY.toFixed(2)}`;
  }
  /* ---------- particle velocity profile: position-dependent, not a single easing ----------
     Slow launch -> accelerate through the MAX region -> peak speed at the
     MAX/MIN transition -> decelerate through MIN -> calm arrival. This is
     a piecewise time->distance mapping (Catmull-Rom through 9 tuned
     anchor points), NOT one CSS easing function — a single cubic-bezier
     can't reproduce an asymmetric accelerate-peak-decelerate shape whose
     peak is pinned to the geometric transition rather than t=0.5.
     Distance is fractional progress along the ACTUAL curved boundary
     (arc-length via getPointAtLength), so speed is perceived correctly
     even though the path bends — not a naive X-coordinate interpolation. */
  // Tuned empirically (measured directly from the generated keyframes'
  // own finite-difference velocity, not eyeballed): peak/launch ratio
  // ~3.4x, peak lands at t≈0.44 inside the MAX/MIN transition zone,
  // arrival speed ≈ launch speed, path strictly monotonic (no backward
  // motion).
  const MINMAX_TIME_ANCHORS = [0, 0.16, 0.28, 0.39, 0.49, 0.59, 0.72, 0.86, 1.00];
  const MINMAX_DIST_ANCHORS = [0, 0.095, 0.19, 0.33, 0.52, 0.67, 0.83, 0.93, 1.00];
  function catmullRom(p0, p1, p2, p3, t) {
    const t2 = t * t, t3 = t2 * t;
    return 0.5 * ((2 * p1) + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 + (-p0 + 3 * p1 - 3 * p2 + p3) * t3);
  }
  function minmaxDistanceAtTime(timeFrac) {
    const n = MINMAX_TIME_ANCHORS.length;
    let i = 0;
    while (i < n - 2 && timeFrac > MINMAX_TIME_ANCHORS[i + 1]) i += 1;
    const t0 = MINMAX_TIME_ANCHORS[i], t1 = MINMAX_TIME_ANCHORS[i + 1];
    const localT = t1 > t0 ? (timeFrac - t0) / (t1 - t0) : 0;
    const p0 = MINMAX_DIST_ANCHORS[Math.max(0, i - 1)];
    const p1 = MINMAX_DIST_ANCHORS[i];
    const p2 = MINMAX_DIST_ANCHORS[Math.min(n - 1, i + 1)];
    const p3 = MINMAX_DIST_ANCHORS[Math.min(n - 1, i + 2)];
    return Math.max(0, Math.min(1, catmullRom(p0, p1, p2, p3, localT)));
  }

  const MINMAX_MOVE_MS = 2800; // one MAX->MIN traversal
  const MINMAX_PAUSE_MS = 2000; // real idle pause, a setTimeout — no rAF/animation runs during it
  const MINMAX_SAMPLES = 72; // dense enough that the piecewise curve reads as smooth, not segmented
  const MINMAX_FADE_FRAC = 0.025; // ~70ms fade in/out at MOVE_MS=2800 — quick, keeps the calm-arrival zone visible almost to the end

  // Root cause of the light-theme white particle: --extreme-particle-
  // tint-pct was 0% in light theme, and `color-mix(in srgb, LINE 0%,
  // white)` means "0% LINE, 100% white" — i.e. pure white, backwards
  // from the intended "0% whitening". Fixed below by no longer mixing
  // light-theme's particle toward white AT ALL — it gets a proper hue-
  // preserving HSL brighten instead (lightness/saturation boost, same
  // hue), computed from the SAME locally-interpolated line color the
  // path itself uses, not a second independent palette.
  function hexToRgb(hex) {
    const s = String(hex).trim().replace("#", "");
    const full = s.length === 3 ? s.split("").map((c) => c + c).join("") : s;
    const n = parseInt(full, 16) || 0;
    return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
  }
  function mixRgb(a, b, pctA) {
    const t = pctA / 100;
    return { r: a.r * t + b.r * (1 - t), g: a.g * t + b.g * (1 - t), b: a.b * t + b.b * (1 - t) };
  }
  function rgbToHsl(r, g, b) {
    r /= 255; g /= 255; b /= 255;
    const max = Math.max(r, g, b), min = Math.min(r, g, b);
    let h = 0, s = 0; const l = (max + min) / 2;
    const d = max - min;
    if (d !== 0) {
      s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
      if (max === r) h = (g - b) / d + (g < b ? 6 : 0);
      else if (max === g) h = (b - r) / d + 2;
      else h = (r - g) / d + 4;
      h /= 6;
    }
    return { h: h * 360, s: s * 100, l: l * 100 };
  }
  function isLightThemeActive() {
    const explicit = themeChoice();
    if (explicit === "light") return true;
    if (explicit === "dark") return false;
    return !!(window.matchMedia && window.matchMedia("(prefers-color-scheme: light)").matches);
  }

  // Builds ONE cycle's keyframes from a snapshot of the boundary path's
  // CURRENT geometry — sampled once here, then fixed for this cycle's
  // whole flight even if telemetry (and the displayed curve) changes
  // mid-flight. The next cycle re-samples fresh geometry at its own
  // start, which is what makes an in-progress traversal never snap.
  function buildMinMaxKeyframes(boundaryEl, totalLen) {
    const light = isLightThemeActive();
    // Dark theme (left exactly as-is, per explicit instruction not to
    // touch it): brighten each endpoint toward white first, then
    // interpolate the two already-brightened endpoints — unchanged CSS-
    // string construction, zero risk of visual drift.
    const highBright = "color-mix(in srgb, var(--extreme-max-line) 78%, white)";
    const dangerBright = "color-mix(in srgb, var(--extreme-min-line) 78%, white)";
    // Light theme: interpolate the RAW (un-brightened) endpoint colors in
    // sRGB first — the same order the path/line's own SVG gradient uses
    // — to get the actual local line color at this position, THEN apply
    // a hue-preserving HSL brighten to that single result (lightness
    // +12pp, saturation +8pp, hue unchanged) rather than mixing toward
    // white, which is what produced the washed-out/white appearance.
    const rootStyle = light ? getComputedStyle(document.documentElement) : null;
    const minRgb = light ? hexToRgb(rootStyle.getPropertyValue("--extreme-min-line")) : null;
    const maxRgb = light ? hexToRgb(rootStyle.getPropertyValue("--extreme-max-line")) : null;
    const keyframes = [];
    for (let i = 0; i <= MINMAX_SAMPLES; i += 1) {
      const timeFrac = i / MINMAX_SAMPLES;
      const distFrac = minmaxDistanceAtTime(timeFrac); // 0=MAX .. 1=MIN, position-dependent, not linear in time
      const len = (1 - distFrac) * totalLen; // path is authored MIN(0)->MAX(end); particle runs the reverse
      const pt = boundaryEl.getPointAtLength(len);
      // Color follows PATH-DISTANCE progress, not elapsed time — with a
      // non-linear speed profile, a time-based color would turn the
      // particle red too early (or keep it blue too long) through the
      // fast middle section.
      const mixPct = Math.round((1 - distFrac) * 100);
      let color;
      if (light) {
        const localRgb = mixRgb(maxRgb, minRgb, mixPct); // same local-line-color math the SVG gradient itself performs
        const hsl = rgbToHsl(localRgb.r, localRgb.g, localRgb.b);
        const boostedS = Math.min(100, hsl.s + 8);
        const boostedL = Math.min(100, hsl.l + 12);
        color = `hsl(${hsl.h.toFixed(1)}deg ${boostedS.toFixed(1)}% ${boostedL.toFixed(1)}%)`;
      } else {
        color = `color-mix(in srgb, ${highBright} ${mixPct}%, ${dangerBright})`;
      }
      let opacity = 1;
      if (timeFrac < MINMAX_FADE_FRAC) opacity = timeFrac / MINMAX_FADE_FRAC;
      else if (timeFrac > 1 - MINMAX_FADE_FRAC) opacity = (1 - timeFrac) / MINMAX_FADE_FRAC;
      keyframes.push({
        offset: timeFrac,
        left: `${(pt.x / MINMAX_VIEW_W * 100).toFixed(3)}%`,
        top: `${pt.y.toFixed(3)}%`,
        backgroundColor: color, color,
        opacity
      });
    }
    return keyframes;
  }

  // One-shot animations chained via .finished, not one Infinity-iteration
  // animation — this is what lets each new cycle re-sample fresh
  // geometry (§14/§15: finish the in-flight traversal on its old
  // snapshot, apply newest telemetry only at the next cycle boundary)
  // and lets the pause be a genuine setTimeout with nothing running.
  // minmaxCycleGeneration invalidates any pending .finished callback or
  // setTimeout the instant something needs a hard stop (mode switch,
  // stale, reduced-motion, rebuild) — the classic stale-closure guard.
  let minmaxCycleGeneration = 0;
  let minmaxCycleActive = false;
  let minmaxCycleTimer = 0;
  let minmaxCycleAnim = null;
  function stopMinMaxCycle() {
    minmaxCycleGeneration += 1;
    minmaxCycleActive = false;
    if (minmaxCycleTimer) { window.clearTimeout(minmaxCycleTimer); minmaxCycleTimer = 0; }
    if (minmaxCycleAnim) { minmaxCycleAnim.cancel(); minmaxCycleAnim = null; }
  }
  function runMinMaxCycle(generation) {
    if (generation !== minmaxCycleGeneration) return; // superseded
    const particle = getDom("cellsMinMaxParticle");
    const boundaryEl = getDom("minmaxBoundaryPath");
    if (!particle || !boundaryEl) return;
    const totalLen = boundaryEl.getTotalLength();
    if (!(totalLen > 0)) return; // no valid geometry yet — nothing to animate
    particle.hidden = false;
    const keyframes = buildMinMaxKeyframes(boundaryEl, totalLen);
    const anim = particle.animate(keyframes, { duration: MINMAX_MOVE_MS, iterations: 1, easing: "linear", fill: "forwards" });
    minmaxCycleAnim = anim;
    anim.finished.then(() => {
      if (generation !== minmaxCycleGeneration) return;
      minmaxCycleAnim = null;
      minmaxCycleTimer = window.setTimeout(() => {
        if (generation !== minmaxCycleGeneration) return;
        runMinMaxCycle(generation);
      }, MINMAX_PAUSE_MS);
    }).catch(() => { /* .cancel() rejects `finished` — expected on stop, not a real error */ });
  }
  function startMinMaxCycleIfNeeded() {
    if (minmaxCycleActive) return; // already looping — let the in-flight/pending cycle continue undisturbed
    minmaxCycleActive = true;
    runMinMaxCycle(minmaxCycleGeneration);
  }

  // showSvg is the Voltage/Wire R mode switch — Resistance gets a plain
  // two-column MIN/MAX (just the two values + the existing static
  // .minmax-divider), genuinely nothing painted into the SVG layer and
  // no animation instance at all, not the curve/particle hidden behind
  // opacity:0. `enabled` (only meaningful when showSvg is true) is the
  // separate stale/offline/reduced-motion/meaningful-delta gate that
  // still shows the static curve but withholds the particle.
  function updateMinMaxFlow(showSvg, enabled, minLevelPct, maxLevelPct) {
    const flowHost = getDom("cellsMinMaxFlow");
    const boundaryEl = getDom("minmaxBoundaryPath");
    const particle = getDom("cellsMinMaxParticle");
    const fillEl = getDom("minmaxFillPath"), depthEl = getDom("minmaxFillDepth");
    if (!boundaryEl || !particle) return;
    if (flowHost) flowHost.dataset.flowMode = showSvg ? "flow" : "plain";

    if (!showSvg) {
      boundaryEl.setAttribute("d", "");
      if (fillEl) fillEl.setAttribute("d", "");
      if (depthEl) depthEl.setAttribute("d", "");
      particle.hidden = true;
      stopMinMaxCycle();
      return;
    }

    // The displayed curve/fill always reflect the LATEST telemetry — only
    // the in-flight particle's own cycle keeps its older snapshot (taken
    // fresh inside runMinMaxCycle at that cycle's own start).
    const boundaryD = minmaxBoundaryD(minLevelPct, maxLevelPct);
    boundaryEl.setAttribute("d", boundaryD);
    const closedD = `${boundaryD} L${MINMAX_VIEW_W},${MINMAX_VIEW_H} L0,${MINMAX_VIEW_H} Z`;
    if (fillEl) fillEl.setAttribute("d", closedD);
    if (depthEl) depthEl.setAttribute("d", closedD); // same shape, subtle top->bottom opacity gradient over it for tonal depth (§7)

    if (!enabled) {
      // Stale/offline/reduced-motion/no-meaningful-delta — hard stop, no
      // "energy flow" implied over data that isn't live or isn't moving.
      particle.hidden = true;
      stopMinMaxCycle();
      return;
    }
    startMinMaxCycleIfNeeded();
  }

  // Tier boundaries per spec: <25 red, 25-50 (inclusive) amber, >50 blue —
  // so 25 and 50 themselves land in the tier below the strict ">" cutoff.
  function socTier(value) {
    if (value < 25) return "low";
    if (value <= 50) return "mid";
    return "high";
  }

  function paintSoc(value) {
    const isCritical = value < CRITICAL_SOC;
    const socEl = getDom("socNum");
    const fill = getDom("gaugeFill");
    const marker = getDom("gaugeMarker");
    if (socEl) { socEl.textContent = String(Math.round(value)); socEl.classList.toggle("critical", isCritical); }
    if (fill) { fill.style.width = `${value}%`; fill.dataset.tier = socTier(value); }
    if (marker) marker.style.left = `${value}%`;
  }

  function renderSoc() {
    const value = numeric("state_of_charge");
    if (value === null) return;
    const target = Math.max(0, Math.min(100, value));
    if (!socAnimated || reducedMotion()) { socAnimated = true; socShown = target; paintSoc(target); return; }
    const from = socShown;
    const start0 = performance.now();
    const dur = 700;
    function step(ts) {
      const p = Math.min(1, (ts - start0) / dur);
      const eased = 1 - Math.pow(1 - p, 3);
      paintSoc(from + (target - from) * eased);
      if (p < 1) requestAnimationFrame(step); else socShown = target;
    }
    requestAnimationFrame(step);
  }

  function renderDeviceName() {
    const override = state.device_name_override;
    const overrideName = override && override.state ? override.state.trim() : "";
    if (overrideName) { setText("deviceNameEl", overrideName); document.title = overrideName; return; }
    const current = state.device_name;
    if (!current) return;
    const name = current.state.replace(/[\x00-\x1f\x7f]/g, "").trim();
    if (!name || name === "--" || name.toLowerCase() === "unknown") return;
    setText("deviceNameEl", name);
    document.title = name;
  }

  /* ============================================================
     FRESHNESS — two independent links, never conflated:
       A. browser <-> ESP32   (this EventSource connection)
       B. ESP32   <-> JK BMS  (Modbus/RS485 — bms_health, backend-computed)
     A green dot and an "online" label mean nothing on their own: the
     EventSource can be open while the BMS itself has gone silent, and the
     UI must not describe that as live. combinedFreshness() is the single
     place that reconciles the two into one of five states, and every
     visual treatment (banner, status chip, dimmed telemetry) reads from it
     — nothing downstream re-derives freshness on its own.
     ============================================================ */
  let browserLink = "connecting"; // "connecting" | "connected" | "reconnecting" | "disconnected"
  let everConnected = false;

  function setBrowserLink(next) {
    if (browserLink === next) return;
    browserLink = next;
    renderFreshness();
  }

  function bmsHealthState() {
    const raw = state.bms_health && state.bms_health.state ? state.bms_health.state.trim().toUpperCase() : "";
    if (raw === "LIVE" || raw === "DELAYED" || raw === "STALE" || raw === "OFFLINE") return raw;
    // No entity yet (pre-V2 firmware, or not booted far enough) — absence
    // of evidence is not evidence of a live BMS, so this never defaults to LIVE.
    return "OFFLINE";
  }

  // LIVE / DELAYED / STALE / OFFLINE / RECONNECTING — RECONNECTING only
  // ever describes the browser link; a lost BMS link surfaces as its own
  // STALE/OFFLINE regardless of what the browser link is doing.
  function combinedFreshness() {
    if (browserLink === "disconnected") return "offline";
    const bms = bmsHealthState();
    if (bms === "OFFLINE") return "offline";
    if (bms === "STALE") return "stale";
    if (browserLink === "reconnecting" || browserLink === "connecting") return "reconnecting";
    if (bms === "DELAYED") return "delayed";
    return "live";
  }

  function renderFreshness() {
    const tier = combinedFreshness();
    const cluster = getDom("cluster");
    if (cluster) cluster.dataset.freshness = tier;
    const dot = getDom("connDot");
    if (dot) dot.classList.toggle("offline", tier !== "live" && tier !== "delayed");
    const systemLine = getDom("systemLine");
    if (systemLine) systemLine.dataset.tier = tier;
    const age = numeric("bms_last_update_age");
    const ageRounded = age === null ? 0 : Math.round(age);
    const agoSuffix = age === null || tier === "live" ? "" : t("freshness.agoSuffix", { age: ageRounded });
    setText("bmsHealthText", `${t(`freshness.${tier}`)}${tier === "live" || tier === "reconnecting" ? "" : agoSuffix}`);

    // Diagnostics panel — the two links spelled out separately, exactly
    // the distinction this whole module exists to preserve.
    setText("diagBmsHealth", bmsHealthState());
    setText("diagBmsAge", age === null ? "--" : t("freshness.agoSuffix", { age: ageRounded }).replace(/^ · /, ""));
    setText("diagBrowserLink", t(`freshness.${browserLink}`));

    const banner = getDom("freshnessBanner");
    if (!banner) return;
    if (tier === "live" || tier === "delayed") { banner.hidden = true; return; }
    banner.hidden = false;
    banner.className = `freshness-banner tier-${tier}`;
    const ago = age === null ? "" : t("freshness.agoSuffix", { age: ageRounded });
    if (tier === "offline" && browserLink === "disconnected") banner.textContent = t("freshness.browserDisconnected");
    else if (tier === "reconnecting") banner.textContent = t("freshness.reconnectingMsg");
    else if (tier === "offline") banner.textContent = t("freshness.bmsOfflineAgo", { ago });
    else banner.textContent = t("freshness.bmsStaleAgo", { ago });
  }

  function txOutcomeLabel(outcome) {
    if (outcome === "sent_unverified") return t("diagnostics.sentUnverified");
    const key = `diagnostics.${outcome}`;
    return lookupKey(I18N[currentLang], key) !== undefined || lookupKey(I18N.en, key) !== undefined ? t(key) : outcome;
  }

  function renderDiagnosticsLog() {
    setText("diagLastCommand", lastCommandLabel);
    const outcomeEl = getDom("diagLastOutcome");
    if (outcomeEl) {
      outcomeEl.textContent = txOutcomeLabel(lastCommandOutcome);
      outcomeEl.dataset.kind = lastCommandOutcome;
    }
    setText("diagLastCommandAt", lastCommandAt ? new Date(lastCommandAt).toLocaleTimeString() : "—");
    setText("diagCountConfirmed", String(txCounters.confirmed));
    setText("diagCountMismatch", String(txCounters.mismatch));
    setText("diagCountTimeout", String(txCounters.timeout));
    setText("diagCountError", String(txCounters.error));
  }

  // V2.2 hardening pass — pure presentation of the resolver's own
  // diagnostic mirrors (batterylifepo4.yaml); no classification logic
  // lives here, matching the same rule the main battery_state/
  // charge_phase display already follows.
  const RESOLVER_DIR_KEY = { neutral: "dirNeutral", charge: "dirCharge", discharge: "dirDischarge" };
  function resolverDirLabel(raw) {
    const key = raw && RESOLVER_DIR_KEY[raw.toLowerCase()] ? RESOLVER_DIR_KEY[raw.toLowerCase()] : "dirNeutral";
    return t(`diagnostics.resolver.${key}`);
  }
  function renderResolverDiagnostics() {
    const floatBit = booleanValue("charging_float_mode");
    setText("diagFloatBit", floatBit === null ? "--" : floatBit ? t("common.on") : t("common.off"));
    const chargeMos = booleanValue("charging");
    setText("diagChargeMos", chargeMos === null ? "--" : chargeMos ? t("common.on") : t("common.off"));
    const dischargeMos = booleanValue("discharging");
    setText("diagDischargeMos", dischargeMos === null ? "--" : dischargeMos ? t("common.on") : t("common.off"));

    const dirEntry = state.battery_state_direction;
    setText("diagDirection", resolverDirLabel(dirEntry && dirEntry.state));
    const candEntry = state.battery_state_candidate;
    setText("diagCandidate", resolverDirLabel(candEntry && candEntry.state));
    setText("diagCandidateSamples", formatNumber("battery_state_candidate_samples", 0));
    setText("diagSampleAge", formatNumber("current_sample_age", 0, "s"));

    const reasonRaw = state.battery_state_unknown_reason;
    const reasonNorm = reasonRaw && reasonRaw.state ? reasonRaw.state.trim() : "n/a";
    const reasonKey = reasonNorm === "no_telemetry_since_boot" ? "reasonNoTelemetry"
      : reasonNorm === "post_reconnect_awaiting_sample" ? "reasonPostReconnect" : "reasonNA";
    setText("diagUnknownReason", t(`diagnostics.resolver.${reasonKey}`));

    // Last-known state/phase reuse the same stage.* / phase i18n as the
    // live displays — deliberately shown only as Diagnostics context,
    // never substituted for the live battery_state/charge_phase (which
    // correctly show offline/none during an outage).
    const lastStateRaw = state.battery_state_last_known;
    const lastStateNorm = lastStateRaw && lastStateRaw.state ? lastStateRaw.state.trim().toLowerCase() : "unknown";
    setText("diagLastKnownState", ["idle", "charging", "discharging", "absorption", "float"].indexOf(lastStateNorm) !== -1
      ? t(`stage.${lastStateNorm}`) : t("stage.unknown"));
    const lastPhaseRaw = state.charge_phase_last_known;
    const lastPhaseNorm = lastPhaseRaw && lastPhaseRaw.state ? lastPhaseRaw.state.trim().toLowerCase() : "none";
    setText("diagLastKnownPhase", ["bulk", "absorption", "float"].indexOf(lastPhaseNorm) !== -1
      ? t(`stage.${lastPhaseNorm}`) : t("stage.idle"));

    setText("diagIdleNoiseMin", formatNumber("idle_current_noise_min", 3, "A"));
    setText("diagIdleNoiseMax", formatNumber("idle_current_noise_max", 3, "A"));
  }

  // Battery Health audit trail — state_of_health (register 0x12B8) is a
  // genuine native JK-PB protocol field (documented "StateOfHealth %"),
  // not a locally derived value, so there is nothing to compute here.
  // This just surfaces the source + the BMS's own capacity numbers
  // side by side so the displayed percentage is auditable, not blind.
  function renderSohDiagnostics() {
    const sohValue = numeric("state_of_health");
    setText("diagSohSource", sohValue === null ? t("diagnostics.soh.sourceUnavailable") : t("diagnostics.soh.sourceProtocol"));
    setText("diagSohRated", formatNumber("battery_capacity", 0, "Ah"));
    setText("diagSohLearned", formatNumber("full_charge_capacity", 1, "Ah"));
    setText("diagSohCycles", formatNumber("charging_cycles", 0));
  }

  function renderControl(key) {
    const confirmed = booleanValue(key);
    // Overview is a read-only echo. Configuration contains the only
    // writable toggle, preventing duplicate optimistic states and commands.
    const ovDot = getDom(`ovDot-${key}`);
    // JK exposes two distinct facts for balancing: 0x1078 says whether the
    // feature is enabled, while BalanStatus at 0x12A6 says whether energy is
    // actually being transferred now. Keep the text tied to the setting,
    // but drive the balancing lamp from the real activity state.
    const lampState = key === "balancing" ? booleanValue("balancing_active") : confirmed;
    if (ovDot) {
      ovDot.classList.toggle("on", lampState === true);
      ovDot.classList.remove("pending");
      ovDot.classList.toggle("unknown", lampState === null);
    }
    setText(`ovState-${key}`, confirmed === null ? t("common.unknown") : confirmed ? t("common.on") : t("common.off"));
  }

  function renderSettingInput(key, inputId) {
    const input = getDom(inputId);
    const value = numeric(key);
    if (!input || value === null || input.dataset.dirty === "true" || document.activeElement === input) return;
    const next = String(value);
    if (input.value !== next) input.value = next;
  }

  /* ---------- explicit axis domain, shared by every bar/line chart ----------
     Lower bound = pack minimum minus 5% (of that value), upper bound =
     pack maximum plus 5% — enough headroom that a tight cluster (Wire R
     on a real pack runs ~0.57–0.71Ω) doesn't have nearly every bar
     brushing the chart's top or bottom edge. */
  const DOMAIN_PAD = 0.05;
  // Voltage uses an absolute 3 mV margin around the live pack extremes.
  // Resistance keeps the relative padding above because it is a different
  // unit and has a materially different numeric range.
  const CELL_VOLTAGE_DOMAIN_PAD_V = 0.003;
  // A cell 15mV+ from the pack average is worth a quiet visual note — not a
  // safety threshold (this BMS exposes none), just a balance/data-quality
  // signal. Picked as "clearly outside normal jitter" for a healthy
  // LiFePO4 pack, not derived from any protocol constant.
  const CELL_DEVIATION_WARN_MV = 15;

  function stats(arr) {
    const min = Math.min.apply(null, arr), max = Math.max.apply(null, arr);
    const sum = arr.reduce((a, b) => a + b, 0), avg = sum / arr.length;
    // Two or more cells can genuinely tie at the pack's min or max — every
    // tied cell gets marked, not just the first match found.
    const minIs = [], maxIs = [];
    arr.forEach((v, i) => { if (v === min) minIs.push(i); if (v === max) maxIs.push(i); });
    return { min, max, avg, delta: max - min, minIs, maxIs };
  }

  // Non-aggressive by design (spec: "помітний, але не агресивний") — an
  // inline banner at the top of the Cells panel, not a modal or a red
  // full-screen takeover. Shows the real diagnostic numbers behind
  // whatever isn't confirmed yet, in both languages, every time, rather
  // than a bare "not confirmed" that leaves the operator guessing why.
  const TOPOLOGY_TITLE_KEYS = Object.freeze({
    LOADING: "titleLoading", PENDING: "titlePending", MISMATCH: "titleMismatch",
    INVALID: "titleInvalid", OFFLINE: "titleOffline", WRITE_UNCERTAIN: "titleWriteUncertain"
  });
  function renderTopologyBanner() {
    const tier = topologyState();
    const banner = getDom("topologyBanner");
    if (banner) {
      banner.hidden = tier === "CONFIRMED";
      if (tier !== "CONFIRMED") {
        banner.className = `topology-banner tier-${tier.toLowerCase().replace(/_/g, "-")}`;
        setText("topologyBannerTitle", t(`topology.${TOPOLOGY_TITLE_KEYS[tier] || "titleLoading"}`));
        setText("topologyBannerReason", topologyReasonText());
      }
    }
    const configured = numeric("cell_count");
    setText("topoConfigured", configured === null ? "--" : tp("topology.cells", Math.trunc(configured)));
    const connected = numeric("connected_cell_count");
    setText("topoConnected", connected === null ? "--" : tp("topology.cells", Math.trunc(connected)));
    const measured = numeric("measured_cell_count");
    setText("topoMeasured", measured === null ? "--" : tp("topology.cells", Math.trunc(measured)));
    const rawV = numeric("total_voltage");
    setText("topoRawVoltage", rawV === null ? "--" : `${rawV.toFixed(2)} ${unitLabel("V")}`);
    const sumV = numeric("active_cells_voltage_sum");
    setText("topoActiveSum", sumV === null ? "--" : `${sumV.toFixed(2)} ${unitLabel("V")}`);
  }

  function renderCells() {
    const count = activeCellCount();
    setText("cellsSubtitle", t("cells.subtitle", { count }));
    let minVoltage = Infinity, maxVoltage = -Infinity, minVoltageIndex = -1, maxVoltageIndex = -1;
    let voltageSum = 0, voltageCount = 0;
    let minResistance = Infinity, maxResistance = -Infinity, minResistanceIndex = -1, maxResistanceIndex = -1;
    let resistanceSum = 0, resistanceCount = 0;

    for (let i = 0; i < count; i += 1) {
      const voltage = numeric(cellVoltageKeys[i]);
      const resistance = numeric(cellResistanceKeys[i]);
      const storedVoltage = voltage === null ? NaN : voltage;
      const storedResistance = resistance === null ? NaN : resistance;
      cellVoltageBuffer[i] = storedVoltage;
      cellResistanceBuffer[i] = storedResistance;
      // Track min/max from the buffer's OWN post-quantization value, not the
      // float64 storedVoltage — cellVoltageBuffer is a Float32Array, so a
      // float64 min/max tracked separately would almost never satisfy the
      // strict `cellVoltageBuffer[i] === minVoltage` tie-check below (two
      // different-precision representations of "the same" number rarely
      // compare equal). This was a real, silent bug: min/max highlighting
      // never actually fired on realistic (non-round) voltage readings.
      const v32 = cellVoltageBuffer[i], r32 = cellResistanceBuffer[i];
      if (!Number.isNaN(storedVoltage) && storedVoltage > 0) {
        voltageSum += storedVoltage; voltageCount += 1;
        if (v32 < minVoltage) { minVoltage = v32; minVoltageIndex = i; }
        if (v32 > maxVoltage) { maxVoltage = v32; maxVoltageIndex = i; }
      }
      if (!Number.isNaN(storedResistance) && storedResistance >= 0) {
        resistanceSum += storedResistance; resistanceCount += 1;
        if (r32 < minResistance) { minResistance = r32; minResistanceIndex = i; }
        if (r32 > maxResistance) { maxResistance = r32; maxResistanceIndex = i; }
      }
    }

    // Exactly one min, one max — a tie is broken by lowest cell index. The
    // forward loop above already does this for free: strict `<`/`>`
    // comparisons only ever replace the tracked index on a value that beats
    // (not merely matches) the current extreme, so the first cell to reach
    // an eventually-tied value keeps the title. These single-element arrays
    // exist only so the render loop below (which does `.indexOf(i) !== -1`)
    // doesn't need two separate code paths for the plural/singular case.
    const voltageMinIs = minVoltageIndex === -1 ? [] : [minVoltageIndex];
    const voltageMaxIs = maxVoltageIndex === -1 ? [] : [maxVoltageIndex];
    const resistanceMinIs = minResistanceIndex === -1 ? [] : [minResistanceIndex];
    const resistanceMaxIs = maxResistanceIndex === -1 ? [] : [maxResistanceIndex];

    const voltageAverage = voltageCount ? voltageSum / voltageCount : NaN;
    const voltageDelta = voltageCount ? maxVoltage - minVoltage : NaN;
    const resistanceAverage = resistanceCount ? resistanceSum / resistanceCount : NaN;
    const resistanceDelta = resistanceCount ? maxResistance - minResistance : NaN;

    // Matrix extreme tint follows whichever mode is currently selected —
    // Voltage toggle -> voltage extremes, Wire R toggle -> resistance
    // extremes. A static identification cue only (no level/height/fill):
    // "identify the extreme cell, not visualize its level inside the
    // matrix" — that visualization now lives solely in the dedicated
    // Voltage MIN/MAX flow component below, not here.
    const cellModeIsVoltage = cellMode === "v";
    const matrixMinIs = cellModeIsVoltage ? voltageMinIs : resistanceMinIs;
    const matrixMaxIs = cellModeIsVoltage ? voltageMaxIs : resistanceMaxIs;

    // Risk tiers, deliberately NOT "min/max = danger": this BMS's Modbus map
    // exposes no configurable OVP/UVP or per-cell protection threshold (see
    // batterylifepo4.yaml / the V2 audit), so there is no real safety margin
    // to color against. What IS real is how far a cell sits from the pack's
    // own average — a data-quality/balance signal, not a protection state,
    // and it's labeled that way in the UI (deviation, never "danger").
    for (let i = 0; i < MAX_CELL_COUNT; i += 1) {
      const button = getDom(`cellBtn${i}`);
      if (!button) continue;
      const isActiveCell = i < count;
      button.hidden = !isActiveCell;
      button.disabled = !isActiveCell;
      if (!isActiveCell) continue;
      const voltage = cellVoltageBuffer[i], resistance = cellResistanceBuffer[i];
      const voltageText = Number.isNaN(voltage) ? "--" : voltage.toFixed(3);
      // Channels 17-32 (index >= 16): cell_resistance_17..32 are now read
      // via a capability-gated extension block (Stage 3 bounded batch,
      // 2026-09-17 — see batterylifepo4.yaml's own CellWireRes16-31
      // interval and jk_capability_core.h), never unconditionally. Real
      // hardware evidence is the SAME signal already used everywhere else
      // in this app for "has this key ever published a value" — no new
      // capability-state plumbing needed in the frontend at all: while
      // the backend capability is UNKNOWN or UNSUPPORTED (not yet
      // attempted, mid-bounded-probe, or gave up this boot session), or
      // simply not attempted because configured N ≤ 16, resistance stays
      // NaN forever and this shows the explicit "not read" state — never
      // the generic "--" a not-yet-fresh channel 1-16 would show, and
      // never hiding the channel itself (its voltage is real and shown
      // normally). The instant a real value arrives (capability confirmed
      // SUPPORTED), resistance stops being NaN and this flips to the
      // normal numeric display on its own, no separate signal to plumb.
      const resistanceUnsupported = i >= 16 && Number.isNaN(resistance);
      const resistanceText = resistanceUnsupported ? t("cells.resistanceUnsupported")
        : (Number.isNaN(resistance) ? "--" : resistance.toFixed(3));
      const voltageHtml = `${voltageText}<i>${unitLabel("V")}</i>`;
      // UNIT FIX (Stage 1, protocol/registers.canonical.json): the raw
      // cell_resistance_N sensor value is milliohms, not ohms — the
      // Settings/Diagnostics register list labels it "mΩ" via
      // diagnosticUnit()'s /^cell_resistance_\d+$/ branch above (that
      // regex itself was fixed 2026-09-10, P1-05 — it previously read
      // /^cell_\d+_wire_resistance$/, which never matched the real key
      // and silently left every cell-resistance row with no unit and no
      // Ukrainian label at all); this Cells-tab card previously showed
      // the SAME number as "Ω", which read as ~1000x too large a
      // resistance. See STAGE_1_IMPLEMENTATION_AUDIT.md for the evidence.
      const resistanceHtml = resistanceUnsupported ? resistanceText : `${resistanceText}<i>${unitLabel("mΩ")}</i>`;
      // ROW 1 (.cell-primary, the <strong>) and ROW 3 (.cell-tertiary, the
      // <small>) are VISUAL ROW roles, styled purely by their position —
      // WHICH metric's value+unit lands in which row is the only thing
      // that changes with cellMode. Never swap which element gets which
      // CSS treatment; only swap which formatted string is written into
      // the (mode-invariant) primary/tertiary element.
      const primaryEl = getDom(`cellPrimary${i}`), tertiaryEl = getDom(`cellTertiary${i}`);
      if (primaryEl) primaryEl.innerHTML = cellModeIsVoltage ? voltageHtml : resistanceHtml;
      if (tertiaryEl) tertiaryEl.innerHTML = cellModeIsVoltage ? resistanceHtml : voltageHtml;
      const isMin = matrixMinIs.indexOf(i) !== -1, isMax = matrixMaxIs.indexOf(i) !== -1;
      button.classList.toggle("min", isMin);
      button.classList.toggle("max", isMax);
      const devEl = getDom(`cellDev${i}`);
      if (devEl) {
        if (Number.isNaN(voltage) || !Number.isFinite(voltageAverage)) {
          devEl.textContent = "--";
          button.classList.remove("dev-warn");
        } else {
          const devMv = Math.round((voltage - voltageAverage) * 1000);
          devEl.textContent = `${devMv > 0 ? "+" : ""}${devMv} ${unitLabel("mV")}`;
          button.classList.toggle("dev-warn", Math.abs(devMv) >= CELL_DEVIATION_WARN_MV);
        }
      }
    }

    const isVoltage = cellMode === "v";
    const values = isVoltage ? cellVoltageBuffer : cellResistanceBuffer;
    const unit = isVoltage ? "V" : "Ω";
    const digits = 3;
    const chartMin = isVoltage ? minVoltage : minResistance;
    const chartMax = isVoltage ? maxVoltage : maxResistance;
    const chartMinIs = isVoltage ? voltageMinIs : resistanceMinIs;
    const chartMaxIs = isVoltage ? voltageMaxIs : resistanceMaxIs;
    const chartAvg = isVoltage ? voltageAverage : resistanceAverage;
    const chartDelta = isVoltage ? voltageDelta : resistanceDelta;
    const domainLow = Number.isFinite(chartMin)
      ? chartMin - (isVoltage ? CELL_VOLTAGE_DOMAIN_PAD_V : chartMin * DOMAIN_PAD)
      : 0;
    const domainHigh = Number.isFinite(chartMax)
      ? chartMax + (isVoltage ? CELL_VOLTAGE_DOMAIN_PAD_V : chartMax * DOMAIN_PAD)
      : 1;
    const span = (domainHigh - domainLow) || 1;

    const colsHost = getDom("barColsCells"), labelsHost = getDom("barLabelsCells");
    if (colsHost && labelsHost) {
      // Grid tracks follow the CONFIRMED series count, not MAX_CELL_COUNT —
      // an 8S pack gets 8 full-width bars, not 8 narrow ones inside a grid
      // still reserving 16 (see #barColsCells/#barLabelsCells in jk_bms.css).
      colsHost.style.setProperty("--cell-count", String(count));
      labelsHost.style.setProperty("--cell-count", String(count));
      colsHost.innerHTML = ""; labelsHost.innerHTML = "";
      for (let i = 0; i < count; i += 1) {
        const v = values[i];
        const isMin = chartMinIs.indexOf(i) !== -1, isMax = chartMaxIs.indexOf(i) !== -1;
        const heightPct = Number.isNaN(v) ? 2 : Math.max(2, Math.min(100, ((v - domainLow) / span) * 100));
        const col = document.createElement("div");
        col.className = "bar-col" + (isMin ? " min" : "") + (isMax ? " max" : "");
        col.innerHTML = `<div class="bar" style="height:${heightPct.toFixed(1)}%"></div>`;
        colsHost.appendChild(col);
        const label = document.createElement("span");
        label.className = isMin ? "min" : (isMax ? "max" : "");
        label.textContent = String(i + 1).padStart(2, "0");
        labelsHost.appendChild(label);
      }
    }

    // Reference line tracks the real average; the axis label at the
    // vertical center is the true geometric midpoint (evenly spaced with
    // top/bottom), never the average value mislabeled as a tick position.
    const avgPct = Number.isFinite(chartAvg) ? Math.max(0, Math.min(100, ((chartAvg - domainLow) / span) * 100)) : 50;
    const avgLine = getDom("barAvgLineCells");
    if (avgLine) avgLine.style.top = `${100 - avgPct}%`;
    setText("axisTopCells", domainHigh.toFixed(digits));
    const midEl = getDom("axisMidCells");
    if (midEl) { midEl.textContent = ((domainHigh + domainLow) / 2).toFixed(digits); midEl.style.top = "50%"; }
    setText("axisBottomCells", domainLow.toFixed(digits));
    const unitDisplay = unitLabel(unit);
    setText("statAvgCells", Number.isFinite(chartAvg) ? `${chartAvg.toFixed(digits)} ${unitDisplay}` : "--");
    setText("statDeltaCells", Number.isFinite(chartDelta) ? (isVoltage ? `${Math.round(chartDelta * 1000)} ${unitLabel("mV")}` : `${chartDelta.toFixed(digits)} ${unitDisplay}`) : "--");
    setText("statMinCells", Number.isFinite(chartMin) ? `${chartMin.toFixed(digits)} ${unitDisplay}` : "--");
    setText("statMaxCells", Number.isFinite(chartMax) ? `${chartMax.toFixed(digits)} ${unitDisplay}` : "--");

    // Min/Max component — Voltage mode gets the full level-flow (curve +
    // particle); Resistance mode is a plain two-column MIN/MAX with
    // nothing painted into the SVG layer at all (see showSvg in
    // updateMinMaxFlow — this is a real mode switch, not the flow hidden
    // behind opacity while still animating). Voltage's particle is
    // runs only while the BMS reports real balancer activity through
    // BalanStatus (balancing_active). A voltage spread alone is not proof
    // that energy is currently being transferred. It also remains disabled
    // for stale/offline/reduced-motion states and when MIN equals MAX.
    {
      const meaningful = Number.isFinite(chartDelta) && chartDelta > 0;
      const balancerActive = booleanValue("balancing_active") === true;
      const tier = combinedFreshness();
      const enabled = balancerActive && meaningful && (tier === "live" || tier === "delayed") && !reducedMotion() && Number.isFinite(chartMin) && Number.isFinite(chartMax);
      const minLevelPct = Number.isFinite(chartMin) ? Math.max(0, Math.min(100, ((chartMin - domainLow) / span) * 100)) : 50;
      const maxLevelPct = Number.isFinite(chartMax) ? Math.max(0, Math.min(100, ((chartMax - domainLow) / span) * 100)) : 50;
      updateMinMaxFlow(isVoltage, enabled, minLevelPct, maxLevelPct);
    }

    // Overview's "Cells" synthesis tile — always the real voltage spread
    // (never resistance, regardless of which chart mode the Cells tab is
    // showing), since that's the number that actually matters at a glance.
    setText("synthCellsValue", Number.isFinite(voltageDelta) ? `${Math.round(voltageDelta * 1000)} ${unitLabel("mV")}` : "--");
    setText("synthCellsCaption", voltageCount ? tp("health.cell", voltageCount) : t("health.noCellData"));
  }

  function bind(key, callback) {
    let callbacks = renderers.get(key);
    if (!callbacks) { callbacks = []; renderers.set(key, callbacks); }
    callbacks.push(callback);
  }

  function bindText(key, id, digits, unit) {
    MEASUREMENT_BINDINGS.push({ key, id });
    bind(key, () => setMeasurement(id, numeric(key), digits, unit, key));
  }

  function installBindings() {
    bind("device_name", renderDeviceName);
    bind("device_name_override", renderDeviceName);
    bind("state_of_charge", renderSoc);
    bind("charging", () => { renderControl("charging"); renderChargeAndAlarms(); drawTimeline(); });
    bind("charging_active", () => { renderChargeAndAlarms(); drawTimeline(); });
    bind("discharging", () => renderControl("discharging"));
    bind("balancing", () => renderControl("balancing"));
    // Keep the enable word and the physical-activity lamp independent.
    bind("balancing_active", () => { renderControl("balancing"); renderCells(); });
    bind("charge_status", () => { renderChargeAndAlarms(); drawTimeline(); });
    bind("charge_phase", () => { renderChargeAndAlarms(); drawTimeline(); });
    bind("cell_rcv", drawTimeline);
    bind("cell_rfv", drawTimeline);
    // CellCount changes the visible pack topology and every per-cell
    // aggregate, plus the pack-level charge target (per-cell target × N).
    // Every topology-resolver output re-runs the same pair: the banner
    // reads the diagnostic numbers directly, and renderCells()/drawTimeline()
    // re-derive from activeCellCount(), which itself reads display_cell_count
    // (user-directed rework, THIRD pass, 2026-09-17 -- was effective_cell_count/
    // topology_state before; display_cell_count is the one that must trigger
    // a re-render now, since it's the field activeCellCount() actually reads).
    for (const key of ["cell_count", "topology_state", "topology_reason", "connected_cell_count",
      "measured_cell_count", "active_cells_voltage_sum", "effective_cell_count", "display_cell_count"]) {
      bind(key, () => { renderTopologyBanner(); renderCells(); drawTimeline(); closeStaleCellHistorySelection(); });
    }
    // Settings/Diagnostics channel hiding (user-reported defect, fixed
    // 2026-09-17): display_cell_count is the ONLY key that changes
    // activeCellCount()'s output (see that function's own comment) --
    // re-rendering the register list on every one of the 8 keys above
    // would be wasteful (most never change N), so this is its own narrow
    // bind. Without it, a channel that shrinks out of range (e.g. a
    // 16->8 transition) would keep its already-rendered row updating in
    // place forever via recordDiagnosticReadout()'s fast path -- that
    // path never re-checks visibility, only renderDiagnosticReadouts()'s
    // own filter does, so an explicit rebuild trigger is required here.
    bind("display_cell_count", renderDiagnosticReadouts);
    bind("charge_status_time", () => { renderChargeAndAlarms(); drawTimeline(); });
    bind("charge_phase_time", () => { renderChargeAndAlarms(); drawTimeline(); });
    bind("battery_state_time", () => { renderChargeAndAlarms(); drawTimeline(); });
    // V2.2 hardening pass — Diagnostics-only resolver mirrors, cheap
    // enough to just re-render the whole subsection on any of them.
    for (const key of ["charging_float_mode", "battery_state_direction", "battery_state_candidate",
      "battery_state_candidate_samples", "current_sample_age", "battery_state_unknown_reason",
      "battery_state_last_known", "charge_phase_last_known", "idle_current_noise_min", "idle_current_noise_max"]) {
      bind(key, renderResolverDiagnostics);
    }
    bind("alarms", renderChargeAndAlarms);
    bind("alarms_bitmask", renderChargeAndAlarms);
    bind("bms_health", renderFreshness);
    bind("bms_last_update_age", renderFreshness);
    bind("wifi_signal", () => setText("diagWifiSignal", formatNumber("wifi_signal", 0, "dBm")));
    bind("wifi_ip_address", () => setText("diagIpAddress", state.wifi_ip_address?.state || "--"));
    bind("system_uptime", () => {
      const seconds = numeric("system_uptime");
      setText("diagUptime", seconds === null ? "--" : formatDuration(seconds));
    });
    bindText("total_voltage", "metricVoltage", 2, "V");
    bindText("current", "metricCurrent", 2, "A");
    bindText("power", "metricPower", 0, "W");
    bindText("balance_current", "metricBalance", 2, "A");
    bindText("mosfet_temperature", "metricMosfet", 1, "°C");
    bindText("temperature_1", "metricT1", 1, "°C");
    bindText("temperature_2", "metricT2", 1, "°C");
    bindText("temperature_4", "metricT4", 1, "°C");
    bindText("temperature_5", "metricT5", 1, "°C");
    // Overview's electrical trio — same real entities, separate DOM ids
    // (ovVoltage/ovCurrent/ovPower) so they can live on Overview and
    // Electrical simultaneously without one id being written twice.
    bindText("total_voltage", "ovVoltage", 2, "V");
    bindText("current", "ovCurrent", 2, "A");
    bindText("power", "ovPower", 0, "W");
    // The old standalone "Pack balance current" line below the grid is
    // gone (redundant with the Balancing summary column) — this is the
    // one remaining DOM target for the same real balance_current entity,
    // not a derived/fake value.
    bindText("balance_current", "statBalancingCells", 2, "A");
    bind("mosfet_temperature", renderTempSummary);
    bind("temperature_1", renderTempSummary);
    bind("temperature_2", renderTempSummary);
    bind("temperature_4", renderTempSummary);
    bind("temperature_5", renderTempSummary);
    bind("capacity_remaining", renderRemaining);
    bind("battery_capacity", renderRemaining);
    bind("total_voltage", renderRemaining);
    bind("total_voltage", renderTopologyBanner);
    bind("cycle_capacity", renderLifetime);
    bind("charging_cycles", renderLifetime);
    // register 0x12B8 is a single UINT8 (0-100, no fractional resolution) —
    // .toFixed(1) would fabricate a decimal digit the BMS never reported.
    bind("state_of_health", () => setText("sysHealth", formatNumber("state_of_health", 0, "%")));
    bind("state_of_health", renderSohDiagnostics);
    bind("battery_capacity", renderSohDiagnostics);
    bind("full_charge_capacity", renderSohDiagnostics);
    bind("charging_cycles", renderSohDiagnostics);
    for (let i = 0; i < SETTING_DEFS.length; i += 1) {
      const definition = SETTING_DEFS[i];
      bind(definition.key, () => renderSettingInput(definition.key, definition.inputId));
    }
    bind("total_voltage", refreshTimelineNow);
    bind("power", refreshTimelineNow);
    bind("current", refreshTimelineNow);
    bind("balance_current", refreshTimelineNow);
  }

  function refreshTimelineNow() {
    // Cheap — drawTimeline() re-reads live state each call, this just makes
    // sure "Now"/related figures track it without waiting for the next
    // demo/stage-change trigger.
    if (getDom("panel-electrical") && getDom("panel-electrical").classList.contains("active")) drawTimeline();
  }

  function renderRemaining() {
    // Raw numeric() reads, not display strings — numeric() already parses
    // ESPHome's formatted sensor state directly (not a further-rounded UI
    // string), so this calculation is never built on top of already-
    // rounded output. Energy = Ah x V / 1000 (Wh -> kWh); computed from
    // raw values and formatted only after the calc — genuinely unavailable
    // (NaN -> "--") if either input is unavailable, never a fake 0.00.
    const remain = numeric("capacity_remaining");
    const nominal = numeric("battery_capacity");
    const voltage = numeric("total_voltage");
    setText("figRemainValue", remain === null ? "--" : remain.toFixed(1));
    const energyKwh = (remain === null || voltage === null) ? NaN : (remain * voltage) / 1000;
    setText("figRemainEnergyValue", Number.isFinite(energyKwh) ? energyKwh.toFixed(2) : "--");
    setText("figRemainCaption", t("hero.ofCapacity", { nominal: nominal === null ? "--" : nominal.toFixed(0), unit: unitLabel("Ah") }));
  }

  function renderLifetime() {
    const cycleAh = numeric("cycle_capacity");
    const cycles = numeric("charging_cycles");
    setText("figLifetimeValue", cycleAh === null ? "--" : cycleAh.toLocaleString("en-US", { minimumFractionDigits: 1, maximumFractionDigits: 1 }));
    setText("figLifetimeCaption", cycles === null ? tp("hero.cycle", 0, { count: "--" }) : tp("hero.cycle", Math.round(cycles)));
  }

  function render() {
    frameRequest = 0;
    let cellsDirty = false;
    for (const key of dirty) {
      if (key.startsWith("cell_voltage_") || key.startsWith("cell_resistance_")) cellsDirty = true;
      const callbacks = renderers.get(key);
      // Snapshot before iterating — defensive against any bound callback
      // that adds/removes bindings on this same key while running (mirrors
      // the same precaution taken for dataWatchers in the state Proxy above).
      if (callbacks) { const snapshot = callbacks.slice(); for (let i = 0; i < snapshot.length; i += 1) snapshot[i](); }
    }
    dirty.clear();
    if (cellsDirty) renderCells();
  }

  /* ============================================================
     BUILD — the DOM structure. Everything above this is real data
     plumbing (EventSource, entity registration, POST commands,
     render scheduling) carried over unchanged from the previous UI;
     everything below is the redesigned visual layer.
     ============================================================ */
  const ICON_TEMP = '<path d="M10.5 4a1.5 1.5 0 0 1 3 0v9.3a4.5 4.5 0 1 1-3 0z"/>';
  const ICON_CELLS = '<rect x="3" y="3" width="7" height="7" rx="1.4"/><rect x="14" y="3" width="7" height="7" rx="1.4"/><rect x="3" y="14" width="7" height="7" rx="1.4"/><rect x="14" y="14" width="7" height="7" rx="1.4"/>';
  const ICON_ALARM = '<path d="M6.5 16.5h11L16 14.2V10.5a4 4 0 0 0-8 0v3.7l-1.5 2.3z"/><path d="M10.3 19.3a1.8 1.8 0 0 0 3.4 0"/>';
  const ICON_VOLTAGE = '<path d="M13 3 6.5 13.5H11L10 21l7-10.5h-4.5z"/>';
  const ICON_CURRENT = '<path d="M2 13.5h5.2l2.3-8.2 4.6 16 2.3-7.8h5.6"/>';
  const ICON_POWER = '<path d="M4.5 17.5a7.5 7.5 0 1 1 15 0"/><path d="M12 17.5 16 10"/><circle cx="12" cy="17.5" r="1.1"/>';
  const ICON_OVERVIEW = '<path d="M4 11.5 12 4l8 7.5"/><path d="M6.5 10.2v9.3a.5.5 0 0 0 .5.5h3v-6h4v6h3a.5.5 0 0 0 .5-.5v-9.3"/>';
  const ICON_CONFIG = '<path d="M10.3 2.5h3.4l.5 2.5a7.6 7.6 0 0 1 2 1.15l2.4-.9 1.7 2.9-1.9 1.65a7.6 7.6 0 0 1 0 2.4l1.9 1.65-1.7 2.9-2.4-.9a7.6 7.6 0 0 1-2 1.15l-.5 2.5h-3.4l-.5-2.5a7.6 7.6 0 0 1-2-1.15l-2.4.9-1.7-2.9 1.9-1.65a7.6 7.6 0 0 1 0-2.4L3.7 8.15l1.7-2.9 2.4.9a7.6 7.6 0 0 1 2-1.15z"/><circle cx="12" cy="11" r="3"/>';
  const ICON_DIAG = '<circle cx="12" cy="12" r="8.5"/><path d="M8.5 12.5 10.5 14.5 15.5 9.5"/>';

  // The power-path group (Charge/Discharge/Balance) is ONE semantic unit —
  // a fixed 3-column grid, never flex-wrap, no pill/badge chrome. A quiet
  // state dot + label + value, sharing one baseline. This is a read-only
  // echo. It deep-links to Configuration, the single place where these
  // permissions can be changed.
  function overviewControlPill(key, labelKey) {
    return `<button class="power-item" type="button" data-panel-link="configuration" data-setting-link="${key}">
      <i class="state-dot" id="ovDot-${key}"></i><span class="power-label" data-i18n="${labelKey}">${t(labelKey)}</span><b class="num" id="ovState-${key}">--</b>
    </button>`;
  }

  // A telemetry item is typography, not a card: LABEL above, a big tabular
  // NUMBER + quiet UNIT below, no border/fill/icon box. Still a real button
  // (tap opens the trend) — the tap affordance comes from a hover
  // underline, not a container.
  // Power keeps identical typography to Voltage/Current/Balance — it's
  // computed (V x A), not independently measured, but that's an internal
  // fact for Diagnostics, not something the primary readout should look
  // visually demoted for. The distinction survives as a native tooltip
  // (title attribute) instead of a permanently visible "derived" label.
  // labelKey is an i18n key for translated labels (Voltage/Current/Power/
  // Balance); rawLabel:true prints labelKey literally instead (MOSFET/T1/
  // T2/T4/T5 — technical probe identifiers, exempt from translation per
  // the glossary policy, same as SOC/BMS/OVP stay untranslated).
  // `unit` is unused here — the real unit is baked into the readout text
  // itself by formatNumber()/unitLabel() at render time (see bindText call
  // sites), so a stray static <small> here would just be dead markup
  // instantly overwritten by the first bind() pass. Kept as a parameter
  // anyway so call sites document which canonical unit each tile carries.
  function metricTile(metricKey, labelKey, valueId, unit, derived, rawLabel) {
    const label = rawLabel ? `<label>${labelKey}</label>` : `<label data-i18n="${labelKey}">${t(labelKey)}</label>`;
    return `<button class="telemetry-item" type="button" data-metric="${metricKey}"${derived ? ` title="${t("telemetry.derivedTooltip")}"` : ""}>
      ${label}
      <span class="telemetry-value num" id="${valueId}">--</span>
    </button>`;
  }

  // Overview's health-line — one inline subsystem summary (Cells / Thermal
  // / Protection), not three separate cards. Each segment deep-links to
  // the tab with the full picture. Never a fabricated risk score: no
  // protection thresholds are exposed by this BMS to grade against, so
  // these describe spread/extremes, not "danger".
  function synthTile(panelName, labelKey, valueId, captionId) {
    return `<button class="health-item" type="button" data-panel-link="${panelName}">
      <label data-i18n="${labelKey}">${t(labelKey)}</label>
      <b class="num" id="${valueId}">--</b>
      <em id="${captionId}">--</em>
    </button>`;
  }

  // A precision measurement matrix, not 16 mini cards: a hairline grid
  // (border lives on .cell-grid, not on each .cell) with tabular alignment.
  // Number / deviation / resistance form one typographic column per cell.
  // Row identity is VISUAL/POSITIONAL (cell-primary / cell-dev /
  // cell-tertiary), not metric-specific — the id/class names deliberately
  // don't say "voltage" or "resistance" anywhere. Which metric's value
  // actually lands in cell-primary vs cell-tertiary depends on the
  // selected chart mode (see renderCells()); the <strong>/<small> tags
  // (and their existing CSS) supply the row's styling either way, so a
  // mode swap never has to move style along with the value.
  function cellCard(i) {
    const number = String(i + 1).padStart(2, "0");
    return `<button type="button" class="cell" id="cellBtn${i}" data-cell-index="${i}" data-i18n-aria="cells.cellHistoryAria" data-i18n-aria-param="${i + 1}" aria-label="${t("cells.cellHistoryAria", { n: i + 1 })}">
      <span class="cell-num">${number}</span>
      <strong class="num cell-primary" id="cellPrimary${i}">--<i>${unitLabel("V")}</i></strong>
      <span class="cell-dev num" id="cellDev${i}">--</span>
      <small class="num cell-tertiary" id="cellTertiary${i}">--<i>${unitLabel("Ω")}</i></small>
    </button>`;
  }

  // Pure analytics view — one bar per active cell (N of them, whatever N
  // the confirmed topology currently is), no particle/flow animation here.
  // The Min/Max level-flow is a separate, dedicated
  // component (see updateMinMaxFlow) that does not live inside this chart.
  function barChart(ids) {
    return `<div class="bar-chart">
      <div class="bar-axis"><span id="${ids.top}">&mdash;</span><span id="${ids.mid}">&mdash;</span><span id="${ids.bottom}">&mdash;</span></div>
      <div class="bar-field">
        <div class="bar-avgline" id="${ids.avgLine}"></div>
        <div class="bar-cols" id="${ids.cols}"></div>
      </div>
      <div class="bar-labels" id="${ids.labels}"></div>
    </div>`;
  }

  // Real 60-hour rolling buffer, viewed 6 hours at a time — replaces the
  // old fixed synthetic reference curve entirely. No Previous/Next
  // buttons (removed per spec): navigation is continuous drag/swipe/
  // keyboard/wheel, wired up in installChargeCycleTimeline(). The top
  // strip is a true chronological state timeline (segments proportional
  // to real duration, built from the buffer's own per-sample stage
  // bytes — see buildStateSegments()), not equal-width chips and not a
  // "current stage" indicator; the live current-stage stats live in the
  // trace-stats row below and are explicitly labeled as live/current so
  // they're never confused with whatever historical window is on screen.
  function timelineChart() {
    return `<div class="cc-meta-row">
      <span id="ccPeriod" class="cc-period">&mdash;</span>
      <div class="cc-toolbar">
        <div class="cc-zoom-group">
          <button type="button" id="ccZoomOut" class="cc-zoom-btn" data-i18n-aria="electrical.cc.zoomOut" aria-label="${t("electrical.cc.zoomOut")}">&minus;</button>
          <span class="cc-zoom-label" id="ccZoomLabel">${tp("electrical.cc.hoursShort", 6)}</span>
          <button type="button" id="ccZoomIn" class="cc-zoom-btn" data-i18n-aria="electrical.cc.zoomIn" aria-label="${t("electrical.cc.zoomIn")}">&plus;</button>
        </div>
        <button type="button" id="ccNowBtn" class="cc-now-btn" hidden>${t("electrical.cc.now")}</button>
      </div>
    </div>
    <div class="cc-timeline">
      <div class="cc-y-axis" id="ccYAxis"><span id="tlTop">&mdash;</span><span id="tlMid">&mdash;</span><span id="tlBottom">&mdash;</span></div>
      <div class="cc-drag-area" id="ccDragArea" tabindex="0" role="img" data-i18n-aria="electrical.chartAria" aria-label="${t("electrical.chartAria")}">
        <div class="cc-state-strip" id="ccStateStrip">
          <svg class="cc-state-field" id="ccStateField" viewBox="0 0 100 34" preserveAspectRatio="none" aria-hidden="true">
            <defs>
              <linearGradient id="ccStateFillGradient" x1="0" y1="0" x2="100" y2="0" gradientUnits="userSpaceOnUse"></linearGradient>
              <linearGradient id="ccStateContourGradient" x1="0" y1="0" x2="100" y2="0" gradientUnits="userSpaceOnUse"></linearGradient>
              <linearGradient id="ccStateDepthGradient" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" class="cc-state-depth-stop-near"></stop>
                <stop offset="100%" class="cc-state-depth-stop-far"></stop>
              </linearGradient>
            </defs>
            <path class="cc-state-fill-path" id="ccStateFillPath" d=""></path>
            <path class="cc-state-depth-path" id="ccStateDepthPath" fill="url(#ccStateDepthGradient)" d=""></path>
            <path class="cc-state-contour-path" id="ccStateContourPath" d=""></path>
          </svg>
          <div id="ccSegHost"></div>
          <div class="cc-strip-transitions" id="ccStripTransitions"></div>
        </div>
        <div class="cc-plot" id="ccPlotField">
          <svg class="cc-plot-svg" id="ccPlotSvg" viewBox="0 0 600 100" preserveAspectRatio="none" aria-hidden="true">
            <defs><linearGradient id="tlGrad" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="var(--high)" stop-opacity="var(--cc-area-opacity)"/><stop offset="100%" stop-color="var(--high)" stop-opacity="0"/></linearGradient></defs>
            <g id="ccGapGroup"></g>
            <path class="cc-voltage-area" id="tlArea" d="" fill="url(#tlGrad)"/>
            <path class="cc-voltage-line" id="tlLine" d=""/>
          </svg>
          <div class="cc-transitions" id="ccTransitions"></div>
          <div class="cc-crosshair" id="ccCrosshair" hidden></div>
          <i class="cc-crosshair-dot" id="ccCrosshairDot" hidden></i>
          <div class="cc-tooltip" id="ccTooltip" hidden></div>
        </div>
        <div class="cc-x-axis" id="ccXAxis"></div>
      </div>
    </div>
    <div class="cc-overview" id="ccOverview" aria-hidden="true">
      <span class="cc-overview-endpoint" id="ccOverviewOldest">&mdash;</span>
      <div class="cc-overview-rail" id="ccOverviewRail"><div class="cc-overview-window" id="ccOverviewWindow"></div></div>
      <span class="cc-overview-endpoint" data-i18n="electrical.cc.now">${t("electrical.cc.now")}</span>
    </div>
    <p class="cc-empty" id="ccEmpty" hidden data-i18n="electrical.noSamplesWindow">${t("electrical.noSamplesWindow")}</p>
    <p class="cc-meta" id="ccMeta" data-i18n="electrical.chargeCycleMeta">${t("electrical.chargeCycleMeta")}</p>`;
  }

  function build() {
    let viewport = document.querySelector('meta[name="viewport"]');
    if (!viewport) { viewport = document.createElement("meta"); viewport.name = "viewport"; document.head.appendChild(viewport); }
    viewport.content = "width=device-width,initial-scale=1,viewport-fit=cover";
    document.title = "LiFePO4 BMS";

    let cellCards = "";
    for (let i = 0; i < MAX_CELL_COUNT; i += 1) cellCards += cellCard(i);

    document.body.innerHTML = `
      <div class="stage">
        <div class="cluster" id="cluster">
          <div class="topbar">
            <div class="identity">
              <h1 id="deviceNameEl">LiFePO4 BMS</h1>
              <div class="identity-sub" id="systemLine" data-tier="offline">
                <span class="dot" id="connDot" aria-hidden="true"></span>
                <span id="bmsHealthText">Offline</span>
                <span class="identity-sep">&middot;</span>
                <span id="statusChipText" data-i18n="common.allSystemsNormal">${t("common.allSystemsNormal")}</span>
              </div>
            </div>
            <button class="icon-btn" id="settingsBtn" type="button" data-i18n-title="settings.title" title="${t("settings.title")}" data-i18n-aria="settings.title" aria-label="${t("settings.title")}" aria-haspopup="dialog">
              <svg viewBox="0 0 24 24" aria-hidden="true">${ICON_CONFIG}</svg>
            </button>
          </div>

          <div class="freshness-banner" id="freshnessBanner" role="status" aria-live="polite" hidden></div>

          <nav class="rail" aria-label="Sections">
            <div class="rail-group">
              <button class="active" data-panel="overview" type="button"><svg viewBox="0 0 24 24" aria-hidden="true">${ICON_OVERVIEW}</svg><span data-i18n="nav.overview">${t("nav.overview")}</span></button>
              <button data-panel="cells" type="button"><svg viewBox="0 0 24 24" aria-hidden="true">${ICON_CELLS}</svg><span data-i18n="nav.cells">${t("nav.cells")}</span></button>
              <button data-panel="electrical" type="button"><svg viewBox="0 0 24 24" aria-hidden="true">${ICON_VOLTAGE}</svg><span data-i18n="nav.electrical">${t("nav.electrical")}</span></button>
              <button data-panel="health" type="button"><span class="nav-icon-wrap"><svg viewBox="0 0 24 24" aria-hidden="true">${ICON_ALARM}</svg><em class="rail-dot" id="railDot"></em></span><span data-i18n="nav.health">${t("nav.health")}</span></button>
            </div>
            <div class="rail-group rail-group-system">
              <button data-panel="configuration" type="button"><svg viewBox="0 0 24 24" aria-hidden="true">${ICON_CONFIG}</svg><span data-i18n="nav.configuration">${t("nav.configuration")}</span></button>
              <button data-panel="diagnostics" type="button"><svg viewBox="0 0 24 24" aria-hidden="true">${ICON_DIAG}</svg><span data-i18n="nav.diagnostics">${t("nav.diagnostics")}</span></button>
            </div>
          </nav>

          <div class="deck">
            <div class="col-left">
              <div class="hero">
                <div class="soc-block">
                  <div class="soc-num num"><span id="socNum">0</span><sup>%</sup></div>
                  <div class="soc-meta">
                    <div class="charge-stage num" data-stage="idle" id="stageLabel"><i></i>--</div>
                    <small id="stageSub">${t("common.elapsed")} --</small>
                  </div>
                </div>
                <div class="gauge" role="img" aria-label="${t("soc.label")}">
                  <div class="gauge-track">
                    <div class="gauge-fill" id="gaugeFill" data-tier="low"></div>
                    <div class="gauge-marker" id="gaugeMarker"></div>
                  </div>
                  <div class="gauge-ticks" aria-hidden="true">
                    <span>0</span>
                    <span class="tick-mid" data-quarter="1">25</span>
                    <span class="tick-mid">50</span>
                    <span class="tick-mid" data-quarter="1">75</span>
                    <span>100</span>
                  </div>
                </div>
                <div class="hero-figures">
                  <div class="fig"><label data-i18n="hero.remaining">${t("hero.remaining")}</label><strong class="num fig-primary-row"><span id="figRemainValue">--</span><small data-unit="Ah">${unitLabel("Ah")}</small><span class="fig-sep" aria-hidden="true">/</span><span id="figRemainEnergyValue">--</span><small data-unit="kWh">${unitLabel("kWh")}</small></strong><em id="figRemainCaption">${t("hero.ofCapacity", { nominal: "--", unit: unitLabel("Ah") })}</em></div>
                  <div class="hero-figures-sep" aria-hidden="true"></div>
                  <div class="fig fig-wide"><label data-i18n="hero.lifetimeDelivered">${t("hero.lifetimeDelivered")}</label><strong class="num"><span id="figLifetimeValue">--</span><small data-unit="Ah">${unitLabel("Ah")}</small></strong><em id="figLifetimeCaption">${tp("hero.cycle", 0, { count: "--" })}</em></div>
                </div>
              </div>
            </div>

            <div class="col-right">
              <div class="panel active" id="panel-overview">
                <div class="power-path" id="overviewControlsReadout">
                  ${overviewControlPill("charging", "power.charge")}
                  ${overviewControlPill("discharging", "power.discharge")}
                  ${overviewControlPill("balancing", "power.balance")}
                </div>

                <div class="telemetry-row telemetry-row-3" id="ovMetrics">
                  ${metricTile("voltage", "telemetry.voltage", "ovVoltage", "V")}
                  ${metricTile("current", "telemetry.current", "ovCurrent", "A")}
                  ${metricTile("power", "telemetry.power", "ovPower", "W", true)}
                </div>

                <div class="health-line">
                  ${synthTile("cells", "cells.title", "synthCellsValue", "synthCellsCaption")}
                  ${synthTile("health", "thermal.title", "synthThermalValue", "synthThermalCaption")}
                  ${synthTile("health", "health.protection", "synthProtectionValue", "synthProtectionCaption")}
                </div>
              </div>

              <div class="panel" id="panel-cells">
                <div class="section-head"><h2 data-i18n="cells.title">${t("cells.title")}</h2><span class="value" id="cellsSubtitle">${t("cells.subtitle", { count: 0 })}</span></div>
                <div class="topology-banner" id="topologyBanner" role="status" aria-live="polite" hidden>
                  <div class="topology-banner-head">
                    <strong id="topologyBannerTitle"></strong>
                    <span id="topologyBannerReason"></span>
                  </div>
                  <div class="topology-banner-grid">
                    <div><label data-i18n="topology.configured">${t("topology.configured")}</label><b id="topoConfigured">--</b></div>
                    <div><label data-i18n="topology.connected">${t("topology.connected")}</label><b id="topoConnected">--</b></div>
                    <div><label data-i18n="topology.measured">${t("topology.measured")}</label><b id="topoMeasured">--</b></div>
                    <div><label data-i18n="topology.rawVoltage">${t("topology.rawVoltage")}</label><b id="topoRawVoltage">--</b></div>
                    <div><label data-i18n="topology.activeSum">${t("topology.activeSum")}</label><b id="topoActiveSum">--</b></div>
                  </div>
                </div>
                <div class="trace-wrap">
                  <div class="section-head">
                    <h2 data-i18n="cells.trend">${t("cells.trend")}</h2>
                    <div class="segment" id="cellSegment">
                      <button class="active" data-mode="v" type="button" data-i18n="cells.voltage">${t("cells.voltage")}</button>
                      <button data-mode="r" type="button" data-i18n="cells.wireR">${t("cells.wireR")}</button>
                    </div>
                  </div>
                  <div class="trace-box">
                    ${barChart({ top: "axisTopCells", mid: "axisMidCells", bottom: "axisBottomCells", avgLine: "barAvgLineCells", cols: "barColsCells", labels: "barLabelsCells" })}
                    <div class="trace-stats" id="cellsTraceStats">
                      <button type="button" data-stat="avg"><label data-i18n="cells.average">${t("cells.average")}</label><b class="num" id="statAvgCells">&mdash;</b></button>
                      <div><label data-i18n="cells.balancing">${t("cells.balancing")}</label><b class="num" id="statBalancingCells">&mdash;</b></div>
                      <button type="button" data-stat="delta"><label data-i18n="cells.delta">${t("cells.delta")}</label><b class="num" id="statDeltaCells">&mdash;</b></button>
                    </div>
                    <div class="minmax-flow" id="cellsMinMaxFlow" data-flow-mode="flow">
                      <svg class="minmax-flow-svg" id="cellsMinMaxSvg" viewBox="0 0 200 100" preserveAspectRatio="none" aria-hidden="true">
                        <defs>
                          <linearGradient id="minmaxFillGrad" x1="0" y1="0" x2="1" y2="0">
                            <stop offset="0%" class="minmax-stop-min"/>
                            <stop offset="100%" class="minmax-stop-max"/>
                          </linearGradient>
                          <linearGradient id="minmaxDepthGrad" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="0%" class="minmax-depth-stop-near"/>
                            <stop offset="100%" class="minmax-depth-stop-far"/>
                          </linearGradient>
                        </defs>
                        <path id="minmaxFillPath" class="minmax-fill-path" fill="url(#minmaxFillGrad)" d=""/>
                        <path id="minmaxFillDepth" fill="url(#minmaxDepthGrad)" d=""/>
                        <path id="minmaxBoundaryPath" class="minmax-boundary-path" fill="none" stroke="url(#minmaxFillGrad)" stroke-width="1.5" vector-effect="non-scaling-stroke" d=""/>
                      </svg>
                      <div class="minmax-half minmax-min">
                        <label data-i18n="cells.min">${t("cells.min")}</label>
                        <b class="num" id="statMinCells">&mdash;</b>
                      </div>
                      <div class="minmax-divider" aria-hidden="true"></div>
                      <div class="minmax-half minmax-max">
                        <label data-i18n="cells.max">${t("cells.max")}</label>
                        <b class="num" id="statMaxCells">&mdash;</b>
                      </div>
                      <i class="minmax-particle" id="cellsMinMaxParticle" hidden aria-hidden="true"></i>
                    </div>
                  </div>
                </div>
                <div class="cell-grid" id="cellGrid">${cellCards}</div>
              </div>

              <div class="panel" id="panel-electrical">
                <div class="section-head"><h2 data-i18n="electrical.title">${t("electrical.title")}</h2><span class="value" data-i18n="common.tapForTrend">${t("common.tapForTrend")}</span></div>
                <div class="telemetry-row telemetry-row-4" id="packMetrics">
                  ${metricTile("voltage", "telemetry.voltage", "metricVoltage", "V")}
                  ${metricTile("current", "telemetry.current", "metricCurrent", "A")}
                  ${metricTile("power", "telemetry.power", "metricPower", "W", true)}
                  ${metricTile("balance", "telemetry.balance", "metricBalance", "A")}
                </div>
                <div class="sysline sysline-1">
                  <div><label data-i18n="electrical.stateOfHealth">${t("electrical.stateOfHealth")}</label><b class="num" id="sysHealth">--</b></div>
                </div>

                <div class="trace-wrap cc-trace-wrap">
                  <div class="section-head"><h2 data-i18n="electrical.chargeCycle">${t("electrical.chargeCycle")}</h2><span class="value" id="ccWindowLabel" data-i18n="electrical.chargeCycleCaption">${t("electrical.chargeCycleCaption")}</span></div>
                  <div class="trace-box">
                    ${timelineChart()}
                    <div class="cc-live-caption" data-i18n="electrical.cc.liveStatus">${t("electrical.cc.liveStatus")}</div>
                    <div class="trace-stats" id="timelineStats">
                      <div><label data-i18n="electrical.stage">${t("electrical.stage")}</label><b class="num" id="tlStageNow">&mdash;</b></div>
                      <div><label data-i18n="electrical.now">${t("electrical.now")}</label><b class="num" id="tlVoltageNow">&mdash;</b></div>
                      <div><label data-i18n="electrical.target">${t("electrical.target")}</label><b class="num" id="tlVoltageTarget">&mdash;</b></div>
                      <div><label data-i18n="electrical.timer">${t("electrical.timer")}</label><b class="num" id="tlTimer">&mdash;</b></div>
                    </div>
                  </div>
                </div>
              </div>

              <div class="panel" id="panel-health">
                <div class="section-head"><h2 data-i18n="thermal.title">${t("thermal.title")}</h2><span class="value" data-i18n="common.tapForTrend">${t("common.tapForTrend")}</span></div>
                <div class="telemetry-row telemetry-row-5" id="tempMetrics">
                  ${metricTile("mosfet", "MOSFET", "metricMosfet", "°C", false, true)}
                  ${metricTile("t1", "T1", "metricT1", "°C", false, true)}
                  ${metricTile("t2", "T2", "metricT2", "°C", false, true)}
                  ${metricTile("t4", "T4", "metricT4", "°C", false, true)}
                  ${metricTile("t5", "T5", "metricT5", "°C", false, true)}
                </div>
                <div class="sysline">
                  <div><label data-i18n="thermal.maxProbe">${t("thermal.maxProbe")}</label><b class="num" id="tempMaxValue">--</b></div>
                  <div><label data-i18n="thermal.minProbe">${t("thermal.minProbe")}</label><b class="num" id="tempMinValue">--</b></div>
                </div>
                <p class="chart-footnote" data-i18n="thermal.footnote">${t("thermal.footnote")}</p>

                <div class="section-head" style="margin-top:32px"><h2 data-i18n="thermal.protectionTitle">${t("thermal.protectionTitle")}</h2></div>
                <div id="alarmBody"></div>
              </div>

              <div class="panel" id="panel-configuration">
                <div class="section-head"><h2 data-i18n="configuration.title">${t("configuration.title")}</h2><span class="value" data-i18n="configuration.caption">${t("configuration.caption")}</span></div>
                <div class="diag-list register-list" id="configRegisterList" role="table" aria-label="${t("configuration.registers")}"></div>
                <p class="request-message" id="settingsMessage" role="status" aria-live="polite"></p>

                <div class="section-head" style="margin-top:32px"><h2 data-i18n="writeRegistry.title">${t("writeRegistry.title")}</h2><span class="value" data-i18n="writeRegistry.caption">${t("writeRegistry.caption")}</span></div>
                <div class="diag-list register-list" id="writeRegistryList" role="table" aria-label="${t("writeRegistry.title")}"></div>
                <p class="request-message" id="writeRegistryMessage" role="status" aria-live="polite"></p>
              </div>

              <div class="panel" id="panel-diagnostics">
                <div class="section-head"><h2 data-i18n="diagnostics.title">${t("diagnostics.title")}</h2></div>
                <div class="diag-list">
                  <div class="diag-row"><span data-i18n="diagnostics.bmsCommunication">${t("diagnostics.bmsCommunication")}</span><b class="num" id="diagBmsHealth">--</b></div>
                  <div class="diag-row"><span data-i18n="diagnostics.lastBmsUpdate">${t("diagnostics.lastBmsUpdate")}</span><b class="num" id="diagBmsAge">--</b></div>
                  <div class="diag-row"><span data-i18n="diagnostics.browserConnection">${t("diagnostics.browserConnection")}</span><b class="num" id="diagBrowserLink">--</b></div>
                  <div class="diag-row"><span data-i18n="diagnostics.firmware">${t("diagnostics.firmware")}</span><b class="num" id="sysFirmware">--</b></div>
                  <div class="diag-row"><span data-i18n="diagnostics.uiBuild">${t("diagnostics.uiBuild")}</span><b class="num">${UI_VERSION}</b></div>
                  <div class="diag-row"><span data-i18n="diagnostics.wifiSignal">${t("diagnostics.wifiSignal")}</span><b class="num" id="diagWifiSignal">--</b></div>
                  <div class="diag-row"><span data-i18n="diagnostics.ipAddress">${t("diagnostics.ipAddress")}</span><b class="num" id="diagIpAddress">--</b></div>
                  <div class="diag-row"><span data-i18n="diagnostics.uptime">${t("diagnostics.uptime")}</span><b class="num" id="diagUptime">--</b></div>
                </div>

                <div class="section-head" style="margin-top:22px"><h2 data-i18n="diagnostics.lastCommand">${t("diagnostics.lastCommand")}</h2></div>
                <div class="diag-list">
                  <div class="diag-row"><span data-i18n="diagnostics.command">${t("diagnostics.command")}</span><b class="num" id="diagLastCommand">--</b></div>
                  <div class="diag-row"><span data-i18n="diagnostics.outcome">${t("diagnostics.outcome")}</span><b class="num" id="diagLastOutcome">--</b></div>
                  <div class="diag-row"><span data-i18n="diagnostics.at">${t("diagnostics.at")}</span><b class="num" id="diagLastCommandAt">--</b></div>
                </div>

                <div class="section-head" style="margin-top:22px"><h2 data-i18n="diagnostics.writeOutcomes">${t("diagnostics.writeOutcomes")}</h2></div>
                <div class="trace-stats diag-counters">
                  <div><label data-i18n="diagnostics.confirmed">${t("diagnostics.confirmed")}</label><b class="num" id="diagCountConfirmed">0</b></div>
                  <div><label data-i18n="diagnostics.mismatch">${t("diagnostics.mismatch")}</label><b class="num" id="diagCountMismatch">0</b></div>
                  <div><label data-i18n="diagnostics.timeout">${t("diagnostics.timeout")}</label><b class="num" id="diagCountTimeout">0</b></div>
                  <div><label data-i18n="diagnostics.error">${t("diagnostics.error")}</label><b class="num" id="diagCountError">0</b></div>
                </div>

                <div class="section-head" style="margin-top:22px"><h2 data-i18n="diagnostics.readEntities">${t("diagnostics.readEntities")}</h2><span class="value" data-i18n="diagnostics.readEntitiesCaption">${t("diagnostics.readEntitiesCaption")}</span></div>
                <div class="diag-list register-list" id="diagSoftwareVarList" role="table" aria-label="${t("diagnostics.readEntities")}"></div>

              </div>
            </div>
          </div>
        </div>

        <div class="modal-overlay" id="settingsOverlay" hidden>
          <div class="modal" role="dialog" aria-modal="true" aria-labelledby="settingsTitle">
            <div class="modal-head">
              <h2 id="settingsTitle" data-i18n="settings.title">${t("settings.title")}</h2>
              <button class="icon-btn" id="settingsClose" type="button" data-i18n-aria="common.close" aria-label="${t("common.close")}">
                <svg viewBox="0 0 24 24" aria-hidden="true"><line x1="6" y1="6" x2="18" y2="18"/><line x1="18" y1="6" x2="6" y2="18"/></svg>
              </button>
            </div>
            <div class="modal-body">
              <label class="setting-label" data-i18n="settings.deviceName">${t("settings.deviceName")}</label>
              <div class="password-form">
                <div class="field-input"><input id="deviceNameInput" type="text" maxlength="32" data-i18n-placeholder="settings.deviceNamePlaceholder" placeholder="${t("settings.deviceNamePlaceholder")}" autocomplete="off"></div>
                <button class="save-btn" id="deviceNameSaveBtn" type="button" data-i18n="settings.saveName">${t("settings.saveName")}</button>
                <p class="pw-message" id="deviceNameMessage" role="status"></p>
              </div>

              <!-- setup_passcode editor deliberately removed (third critical
                   audit, 2026-09-10): while this credential-class write
                   stays fail-closed, no input/endpoint for it may exist in
                   the UI at all — not even a disabled one. Re-add only
                   alongside a real, reviewed body-based write endpoint
                   with CSRF/rate-limit/exact-tx_id semantics (see
                   OPEN_ISSUES.md P0-06 and the ADR's audit addenda). -->

              <label class="setting-label" style="margin-top:20px" data-i18n="settings.appearance">${t("settings.appearance")}</label>
              <div class="theme-options" id="themeOptions">
                <button class="theme-opt" data-theme-choice="light" type="button">
                  <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="4.2"/><line x1="12" y1="2.5" x2="12" y2="5"/><line x1="12" y1="19" x2="12" y2="21.5"/><line x1="2.5" y1="12" x2="5" y2="12"/><line x1="19" y1="12" x2="21.5" y2="12"/><line x1="5.3" y1="5.3" x2="7" y2="7"/><line x1="17" y1="17" x2="18.7" y2="18.7"/><line x1="5.3" y1="18.7" x2="7" y2="17"/><line x1="17" y1="7" x2="18.7" y2="5.3"/></svg>
                  <span data-i18n="settings.light">${t("settings.light")}</span>
                </button>
                <button class="theme-opt" data-theme-choice="dark" type="button">
                  <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20 14.2A8.3 8.3 0 1 1 9.8 4a7 7 0 0 0 10.2 10.2z"/></svg>
                  <span data-i18n="settings.dark">${t("settings.dark")}</span>
                </button>
                <button class="theme-opt" data-theme-choice="auto" type="button">
                  <svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="4" width="18" height="12" rx="1.5"/><line x1="8" y1="20" x2="16" y2="20"/><line x1="12" y1="16" x2="12" y2="20"/></svg>
                  <span data-i18n="settings.auto">${t("settings.auto")}</span>
                </button>
              </div>

              <label class="setting-label" style="margin-top:20px" data-i18n="settings.language">${t("settings.language")}</label>
              <div class="theme-options" id="languageOptions">
                <button class="theme-opt" data-lang-choice="en" type="button">
                  <span class="lang-code">EN</span>
                  <span>English</span>
                </button>
                <button class="theme-opt" data-lang-choice="uk" type="button">
                  <span class="lang-code">UK</span>
                  <span>Українська</span>
                </button>
              </div>
            </div>
          </div>
        </div>

        <div class="modal-overlay" id="cellOverlay" hidden>
          <div class="modal cell-modal" role="dialog" aria-modal="true" aria-labelledby="cellModalTitle">
            <div class="modal-head">
              <h2 id="cellModalTitle">Cell 01</h2>
              <button class="icon-btn" id="cellModalClose" type="button" data-i18n-aria="common.close" aria-label="${t("common.close")}">
                <svg viewBox="0 0 24 24" aria-hidden="true"><line x1="6" y1="6" x2="18" y2="18"/><line x1="18" y1="6" x2="6" y2="18"/></svg>
              </button>
            </div>
            <div class="modal-body">
              <div class="cell-modal-head">
                <div class="cell-modal-value"><strong id="cellModalValue" class="num">--</strong><small id="cellModalUnit">V</small></div>
                <div class="segment" id="cellModalSegment">
                  <button class="active" data-mode="v" type="button" data-i18n="cells.voltage">${t("cells.voltage")}</button>
                  <button data-mode="r" type="button" data-i18n="cells.wireR">${t("cells.wireR")}</button>
                </div>
              </div>
              <label class="setting-label" id="cellModalWindow">&nbsp;</label>
              <span class="illustrative-tag" id="cellModalIllustrative" hidden data-i18n="trendModal.illustrative">${t("trendModal.illustrative")}</span>
              <div class="bar-chart cell-hist-chart">
                <div class="bar-axis"><span id="histTop">&mdash;</span><span id="histMid">&mdash;</span><span id="histBottom">&mdash;</span></div>
                <div class="bar-field">
                  <div class="bar-avgline" id="histAvgLine"></div>
                  <svg class="cell-hist-svg" id="histSvg" viewBox="0 0 600 100" preserveAspectRatio="none">
                    <defs><linearGradient id="histGrad" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="var(--accent)" stop-opacity=".24"/><stop offset="100%" stop-color="var(--accent)" stop-opacity="0"/></linearGradient></defs>
                    <path class="cell-hist-area" id="histArea" fill="url(#histGrad)" d=""/>
                    <path class="cell-hist-line" id="histLine" d=""/>
                  </svg>
                  <div class="cell-hist-end" id="histEnd"></div>
                </div>
              </div>
              <div class="cell-hist-time" id="histTimeAxis"></div>
              <div class="trace-stats" id="histStats">
                <div><label data-i18n="trendModal.min">${t("trendModal.min")}</label><b class="num min" id="histMin">&mdash;</b></div>
                <div><label data-i18n="trendModal.avg">${t("trendModal.avg")}</label><b class="num" id="histAvg">&mdash;</b></div>
                <div><label data-i18n="trendModal.max">${t("trendModal.max")}</label><b class="num max" id="histMax">&mdash;</b></div>
              </div>
            </div>
          </div>
        </div>
      </div>`;

    document.documentElement.lang = currentLang;
    populateDomCache();
    // The endpoint's own fill needs to be var(--accent), the line stroke
    // too — cell-hist-line was reused for the area path above with an
    // inline fill override, so it doesn't need its own duplicate CSS rule.
    installBindings();
    installInteractions();
    for (const key of renderers.keys()) scheduleRender(key);
    renderCells();
    renderChargeAndAlarms();
    renderFreshness();
    renderDiagnosticsLog();
    renderResolverDiagnostics();
    renderSohDiagnostics();
    renderDiagnosticReadouts();
    renderDiagnosticSoftwareVariables();
    renderWriteRegistry();
    setText("sysFirmware", "v3.0.0");
    initTheme();
    initLanguage();
    initDeviceNameField();
    drawTimeline();
    renderChargeCycleTimeline();
    // Matches the buffer's own 1-sample/min cadence — no point re-fetching
    // faster than a new sample could actually appear in it. Only advances
    // the viewport if isFollowingNow; a panned-into-history view is never
    // yanked back (spec §30).
    ccChartTimer = window.setInterval(ccTick, 60000);
    fetchHistory();
    historyTimer = window.setInterval(fetchHistory, HISTORY_REFRESH_MS);
  }

  /* ---------- tabs ---------- */
  const PANEL_NAMES = ["overview", "cells", "electrical", "health", "configuration", "diagnostics"];

  function activateTab(name) {
    for (let i = 0; i < PANEL_NAMES.length; i += 1) {
      const active = PANEL_NAMES[i] === name;
      const panel = getDom(`panel-${PANEL_NAMES[i]}`);
      const button = document.querySelector(`.rail [data-panel="${PANEL_NAMES[i]}"]`);
      if (panel) panel.classList.toggle("active", active);
      if (button) button.classList.toggle("active", active);
    }
    const colLeft = document.querySelector(".col-left");
    if (colLeft) colLeft.classList.toggle("mobile-hide", name !== "overview");
    if (name === "electrical") { drawTimeline(); ccJumpToNow(); }
    window.scrollTo(0, 0);
  }

  function setCellMode(nextMode) {
    if (nextMode !== "v" && nextMode !== "r") return;
    cellMode = nextMode;
    document.querySelectorAll("#cellSegment button, #cellModalSegment button").forEach((b) => {
      if (b.closest("#cellSegment")) b.classList.toggle("active", b.dataset.mode === nextMode);
    });
    renderCells();
  }

  /* ---------- controls: real POST with optimistic update + rollback ---------- */
  async function postCommand(url) {
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
      const response = await fetch(endpointUrl(url), { method: "POST", cache: "no-store", credentials: "same-origin", signal: controller.signal, headers: { Accept: "application/json" } });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
    } finally { window.clearTimeout(timeout); }
  }

  function setRequestMessage(id, message, kind) {
    const node = getDom(id);
    if (!node) return;
    node.textContent = message;
    node.dataset.kind = kind || "";
  }

  /* ============================================================
     WRITE TRANSACTION MANAGER
     ============================================================
     Every BMS write goes through this — nothing calls a write "done"
     from an HTTP 200 alone. HTTP 200 only proves the ESP32 accepted the
     request; CONFIRMED requires the target entity's *next real state*,
     arriving over the same SSE stream everything else already renders
     from, to actually match what was requested. `state[key]` is never
     touched optimistically by this file — only ingestEvent() ever writes
     it — specifically so a transaction's own optimistic echo can't be
     mistaken for the BMS's real readback.
     States: IDLE → ARMED (critical writes only) → SENDING →
     PENDING_READBACK → CONFIRMED | MISMATCH | TIMEOUT | ERROR
     ============================================================ */
  const TX_STATE = Object.freeze({
    IDLE: "idle", ARMED: "armed", SENDING: "sending",
    PENDING_READBACK: "pending_readback", CONFIRMED: "confirmed",
    MISMATCH: "mismatch", TIMEOUT: "timeout", ERROR: "error",
    // The field has no possible readback (setup_passcode always reports a
    // masked placeholder) — HTTP 200 is all that can ever be known. Kept
    // visually and semantically distinct from CONFIRMED everywhere it's used.
    SENT_UNVERIFIED: "sent_unverified",
    // Second critical audit (2026-09-10): the backend explicitly refused to
    // even QUEUE a Modbus command (single-flight collision — a transaction
    // for this same address was already in flight — or every transaction
    // slot busy), surfaced as write_tx_snapshot status 9. This is NOT a
    // TIMEOUT: nothing was ever attempted, the backend knows that
    // immediately, and the frontend now learns it immediately too instead
    // of waiting out its own client-side timeout for a write that never
    // started.
    REJECTED: "rejected",
    // Third critical audit (2026-09-10, item 7): the backend reclassified
    // an ACK/readback timeout into WRITE_UNCERTAIN and is running an
    // independent recovery probe (re-reading the register) — this is
    // NOT yet a terminal outcome. Treated the same as PENDING_READBACK by
    // every onState() handler (control stays disabled, no green/red
    // shown) so there is never a premature success OR failure indication
    // while the real answer is still being determined.
    UNCERTAIN: "uncertain",
  });

  // Reusable per-field comparators — one generic epsilon across every
  // writable entity was hiding real differences in representation (a
  // boolean select and a step:1 integer number don't fail the same way).
  const COMPARATORS = Object.freeze({
    exact: (requested, actual) => actual !== null && String(actual) === String(requested),
    decimal: (requested, actual) => actual !== null && Math.abs(actual - Number(requested)) < 0.0005,
    // All four writable numbers in batterylifepo4.yaml (heating on/off,
    // dry contact 1/2 source) are declared step: 1 — a real BMS echo can
    // still legitimately round/re-quantize, so 0.5 is "nearest integer",
    // not an arbitrary fudge factor.
    integer: (requested, actual) => actual !== null && Math.abs(actual - Number(requested)) < 0.5
  });

  // One live transaction per entity key at a time — enforced here so every
  // caller in Configuration gets it for free rather than re-implementing
  // its own guard. A second write for the same key while one is in flight is
  // REJECTED (not superseded): silently swapping which command is "the one
  // being confirmed" is exactly the kind of undefined behavior a BMS control
  // surface can't afford, and controls are disabled while a write is active,
  // so this remains a defense-in-depth guard.
  const activeTransactionKeys = new Set();

  // Diagnostics-panel bookkeeping — every transaction's outcome lands here,
  // independent of which control/setting caused it, so Diagnostics can show
  // one real "what happened last" line plus outcome counters without each
  // caller having to report in separately.
  const txCounters = { confirmed: 0, mismatch: 0, timeout: 0, error: 0, sent_unverified: 0, rejected: 0 };
  let lastCommandLabel = "—";
  let lastCommandOutcome = "—";
  let lastCommandAt = 0;

  // write_tx_snapshot (registered above) carries the firmware's/mock's
  // generic Write Transaction Manager state as a JSON array of
  // {addr, tx_id, status, req, rb} — status 4=CONFIRMED, 5=MISMATCH,
  // 6=WRITE_UNCERTAIN, 9=REJECTED, 10=RECOVERED_CONFIRMED,
  // 11=RECOVERED_MISMATCH (see jk_write_tx_core.h). Parsed fresh on every
  // read rather than cached: it changes only when the backend actually
  // pushes a new SSE update for this key, at which point
  // `state.write_tx_snapshot` itself has already been replaced.
  //
  // Third critical audit (2026-09-10, item 7): 7 (ACK_TIMEOUT) and 8
  // (READBACK_TIMEOUT) are deliberately NOT terminal here any more — the
  // backend itself immediately reclassifies a slot that just hit either
  // one into WRITE_UNCERTAIN(6) and launches a recovery probe (see
  // batterylifepo4.yaml's 250ms servicer / demo/mock-server.js's
  // finishUncertain); the frontend must wait for that probe's own real
  // terminal verdict (10/11) rather than declaring TIMEOUT on what is
  // now only ever a momentary, superseded intermediate status.
  const WTX_TERMINAL_STATUS = new Set([4, 5, 9, 10, 11]);
  function parseWriteTxSnapshot() {
    const raw = state.write_tx_snapshot;
    if (!raw || typeof raw.state !== "string") return [];
    try {
      const parsed = JSON.parse(raw.state);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }
  function findWriteTxEntry(address) {
    if (address == null) return null;
    return parseWriteTxSnapshot().find((entry) => entry && entry.addr === address) || null;
  }

  function writeTransaction(cfg) {
    // cfg: { key, endpoint, matches(entry)->bool, describe(entry)->string,
    //        readbackTimeoutMs, onState(txState, detail), address }
    // `address` (from GENERIC_TX_ADDRESS) is optional: when present, this
    // transaction ALSO races a write_tx_snapshot-based confirmation (the
    // firmware's own forced-readback verdict) alongside the existing
    // entity-state-based one below — whichever settles first wins
    // (finish() is idempotent), and a register with no known address
    // behaves EXACTLY as before. The snapshot path is trusted directly
    // (status 4 -> CONFIRMED, 5/7/8 -> failure) rather than re-checked
    // against cfg.matches(): the firmware already compared requested vs.
    // readback raw register words itself, which is more authoritative
    // than the frontend re-deriving the same comparison from a possibly
    // not-yet-repolled display sensor.
    const timeoutMs = cfg.readbackTimeoutMs || 6000;
    let unwatch = null;
    let unwatchSnapshot = null;
    let timer = 0;
    let settled = false;
    function finish(next, detail) {
      if (settled) return; // terminal states only ever fire once per transaction
      settled = true;
      if (timer) { window.clearTimeout(timer); timer = 0; }
      if (unwatch) { unwatch(); unwatch = null; }
      if (unwatchSnapshot) { unwatchSnapshot(); unwatchSnapshot = null; }
      activeTransactionKeys.delete(cfg.key);
      if (Object.prototype.hasOwnProperty.call(txCounters, next)) txCounters[next] += 1;
      lastCommandLabel = cfg.label || cfg.key;
      lastCommandOutcome = next;
      lastCommandAt = Date.now();
      renderDiagnosticsLog();
      if (cfg.onState) cfg.onState(next, detail);
    }
    function set(next, detail) { if (cfg.onState) cfg.onState(next, detail); }
    return {
      async send() {
        if (activeTransactionKeys.has(cfg.key)) {
          set(TX_STATE.ERROR, t("tx.anotherInProgress"));
          return;
        }
        activeTransactionKeys.add(cfg.key);
        // Captured before the request even goes out — see COMPARATORS/
        // stateRevision above. Any real SSE update to this key from this
        // point on counts as newer; one that arrived and was already
        // processed before this line never can, however it got here.
        const startRevision = stateRevision[cfg.key] || 0;
        const startTxId = cfg.address != null ? ((findWriteTxEntry(cfg.address) || {}).tx_id || 0) : null;
        function armTimer(ms) {
          if (timer) window.clearTimeout(timer);
          timer = window.setTimeout(() => finish(TX_STATE.TIMEOUT, t("tx.noConfirmation")), ms);
        }
        function checkSnapshotTerminal() {
          if (cfg.address == null) return false;
          const entry = findWriteTxEntry(cfg.address);
          if (!entry || !(entry.tx_id > startTxId)) return false;
          if (entry.status === 6) {
            // Third critical audit (2026-09-10, item 7): WRITE_UNCERTAIN —
            // the backend's own recovery probe is running. Not terminal:
            // show the honest "still verifying" state and give the probe
            // real time to finish instead of racing it with the ordinary
            // (much shorter) client-side write timeout.
            set(TX_STATE.UNCERTAIN, t("tx.uncertainRecovering"));
            armTimer(cfg.uncertainRecoveryTimeoutMs || 10000);
            return false;
          }
          if (!WTX_TERMINAL_STATUS.has(entry.status)) return false;
          if (entry.status === 4) finish(TX_STATE.CONFIRMED, cfg.describe ? cfg.describe(state[cfg.key]) : "");
          else if (entry.status === 5) finish(TX_STATE.MISMATCH, cfg.describe ? cfg.describe(state[cfg.key]) : "BMS reports a different state");
          else if (entry.status === 9) finish(TX_STATE.REJECTED, t("tx.rejectedBusy"));
          else if (entry.status === 10) finish(TX_STATE.CONFIRMED, `${cfg.describe ? cfg.describe(state[cfg.key]) : ""} ${t("tx.recoveredAfterUncertainty")}`.trim());
          else if (entry.status === 11) finish(TX_STATE.MISMATCH, t("tx.recoveredMismatchAfterUncertainty"));
          else finish(TX_STATE.TIMEOUT, t("tx.noConfirmation"));
          return true;
        }
        set(TX_STATE.SENDING);
        try {
          await postCommand(cfg.endpoint);
        } catch (error) {
          finish(TX_STATE.ERROR, error.name === "AbortError" ? t("tx.requestTimedOut") : t("tx.requestFailed"));
          return;
        }
        if (cfg.unverifiable) {
          // setup_passcode: the entity itself can never echo the real value
          // back (always masked), so there is nothing to wait for — HTTP 200
          // is the entire signal, and it must not be dressed up as CONFIRMED.
          finish(TX_STATE.SENT_UNVERIFIED, t("configuration.sentUnverified"));
          return;
        }
        set(TX_STATE.PENDING_READBACK);
        // Third critical audit (2026-09-10, item 5): a plain entity SSE
        // update is NEVER allowed to resolve CONFIRMED/MISMATCH on its own
        // when an authoritative backend transaction (write_tx_snapshot,
        // keyed by exact tx_id/address) is available — the entity can
        // legitimately re-publish from its own unrelated poll cycle at any
        // time, including one that happens to already equal the requested
        // value while the real write's ACK was silently lost (the exact
        // false-green scenario test_write_transaction_entity_sse_cannot_
        // confirm_without_ack in test/topology/run.js now proves). The
        // renderer pipeline (scheduleRender via the state Proxy,
        // independent of this transaction) already keeps the DISPLAYED
        // value current regardless; this watcher used to ALSO treat that
        // same update as authoritative, which is exactly what item 5
        // forbids. checkSnapshotTerminal() (the write_tx_snapshot path)
        // is now the ONLY way this transaction can reach a terminal
        // verdict whenever cfg.address is known — which is every current
        // caller (SETTING_DEFS/CONTROL_DEFS only ever populate defs whose
        // key has a GENERIC_TX_ADDRESS entry).
        const hasAuthoritativeAddress = cfg.address != null;
        if (hasAuthoritativeAddress) {
          // The snapshot event can legitimately arrive while this POST's
          // own fetch() was still in flight — check synchronously once,
          // immediately, before ever arming a watcher for a future event.
          if (checkSnapshotTerminal()) return;
        } else {
          // No known address for this key — cannot correlate against
          // write_tx_snapshot at all. Falls back to the entity-state
          // comparison as the only available signal (no current caller
          // hits this path; kept for defensive correctness only).
          if ((stateRevision[cfg.key] || 0) > startRevision) {
            const already = state[cfg.key];
            if (cfg.matches(already)) { finish(TX_STATE.CONFIRMED, cfg.describe ? cfg.describe(already) : ""); return; }
            finish(TX_STATE.MISMATCH, cfg.describe ? cfg.describe(already) : "BMS reports a different state");
            return;
          }
        }
        // checkSnapshotTerminal() may already have armed an extended
        // recovery-probe timer (WRITE_UNCERTAIN, above) — only fall back
        // to the normal write-timeout budget if it didn't.
        if (!timer) armTimer(timeoutMs);
        if (hasAuthoritativeAddress) {
          unwatchSnapshot = watchKey("write_tx_snapshot", checkSnapshotTerminal);
        } else {
          unwatch = watchKey(cfg.key, () => {
            if ((stateRevision[cfg.key] || 0) <= startRevision) return; // stale — keep listening for a newer one
            const entry = state[cfg.key];
            if (cfg.matches(entry)) finish(TX_STATE.CONFIRMED, cfg.describe ? cfg.describe(entry) : "");
            else finish(TX_STATE.MISMATCH, cfg.describe ? cfg.describe(entry) : "BMS reports a different state");
          });
        }
      }
    };
  }

  /* Register-list interactions ------------------------------------------------
     Numeric fields retain an explicit OK action. The button itself carries the
     write lifecycle so the user can see exactly whether the BMS confirmed the
     requested value: >> while sending, ✓ on matching read-back, × otherwise. */
  function resetRegisterWriteButton(button) {
    if (!button) return;
    const key = button.dataset.registerWrite;
    if (key) registerWriteVisualStates.delete(key);
    button.disabled = false;
    button.classList.remove("is-sending", "is-success", "is-error");
    button.textContent = t("configuration.save");
  }

  function setRegisterWriteButton(button, state, remember = true) {
    if (!button) return;
    const key = button.dataset.registerWrite;
    // A second tap must never start another transaction or dismiss the
    // result early. Only the normal blue “OK” state is interactive.
    button.disabled = state !== "idle";
    if (remember && key && state !== "idle") registerWriteVisualStates.set(key, { state });
    button.classList.remove("is-sending", "is-success", "is-error");
    if (state === "sending") {
      button.classList.add("is-sending");
      button.textContent = ">>";
    } else if (state === "success") {
      button.classList.add("is-success");
      button.textContent = "✓";
    } else if (state === "error") {
      button.classList.add("is-error");
      button.textContent = "×";
    } else resetRegisterWriteButton(button);
  }

  function flashRegisterWriteButton(button, state) {
    setRegisterWriteButton(button, state);
    const key = button?.dataset.registerWrite;
    const visual = key ? registerWriteVisualStates.get(key) : null;
    window.setTimeout(() => {
      // Do not reset a newer write to the same register if one starts during
      // this one-second feedback window. Find the current button because a
      // telemetry-driven rebuild may have replaced the original DOM node.
      if (!key || registerWriteVisualStates.get(key) !== visual) return;
      const currentButton = document.querySelector(`button[data-register-write="${key}"]`);
      if (currentButton instanceof HTMLButtonElement) resetRegisterWriteButton(currentButton);
      else registerWriteVisualStates.delete(key);
    }, 1000);
  }

  function restoreRegisterReadback(input, key) {
    // The long register list may have been rebuilt while awaiting BMS
    // read-back. In that case `input` is the detached old node; always
    // target the current visible field before restoring the real value.
    const currentInput = input?.id ? document.getElementById(input.id) : input;
    if (!(currentInput instanceof HTMLInputElement)) return;
    const readback = state[key];
    if (!readback) return;
    const raw = readback.value !== undefined && readback.value !== null ? readback.value : readback.state;
    if (raw !== undefined && raw !== null) currentInput.value = String(raw);
    currentInput.dataset.dirty = "false";
    currentInput.classList.remove("invalid");
  }

  // CellCount is not just another writable register: it changes which
  // physical channels the whole app trusts (see activeCellCount()/
  // topologyState()). While the device hasn't confirmed a topology yet
  // (LOADING) a write is refused outright — there's no consistent picture
  // to even judge against. While it disagrees with itself (MISMATCH/
  // INVALID) a second, explicit tap is required before the write goes out,
  // exactly like the Charge/Discharge disable confirm-arm above.
  let cellCountRewriteArmed = false;
  let cellCountRewriteArmTimer = 0;

  function resetCellCountRewriteArm() {
    if (cellCountRewriteArmTimer) { window.clearTimeout(cellCountRewriteArmTimer); cellCountRewriteArmTimer = 0; }
    cellCountRewriteArmed = false;
  }

  // Store only data, never a DOM node: live BMS telemetry can rebuild the
  // long register list while the four-second confirmation window is open.
  let armedRegisterToggle = null;
  let registerToggleArmTimer = 0;

  function resetRegisterToggleArm() {
    if (registerToggleArmTimer) { window.clearTimeout(registerToggleArmTimer); registerToggleArmTimer = 0; }
    const armed = armedRegisterToggle;
    armedRegisterToggle = null;
    if (!armed) return;
    const input = getDom(`reg_${armed.key}`);
    if (!input) return;
    const actual = booleanValue(armed.key);
    input.value = actual === true ? "On" : "Off";
    input.classList.toggle("is-on", actual === true);
    input.classList.remove("is-armed");
    input.setAttribute("aria-checked", String(actual === true));
    input.disabled = false;
    const label = input.closest(".diag-row")?.firstElementChild;
    if (label) { label.textContent = label.dataset.registerLabel || label.textContent; label.classList.remove("register-confirm-label"); }
  }

  function sendRegisterToggle(input, key, next) {
    const definition = CONTROL_DEFS[key];
    if (!definition) return;
    input.disabled = true;
    input.classList.remove("is-armed");
    const label = input.closest(".diag-row")?.firstElementChild;
    if (label) { label.textContent = t("common.sending"); label.classList.remove("register-confirm-label"); }
    const tx = writeTransaction({
      key,
      address: GENERIC_TX_ADDRESS[key],
      label: `${settingFieldLabel(key)} → ${next ? t("common.on") : t("common.off")}`,
      endpoint: `${definition.endpoint}?option=${next ? "On" : "Off"}`,
      matches: () => COMPARATORS.exact(next, booleanValue(key)),
      describe: () => t("tx.describeReports", { value: booleanValue(key) === true ? t("common.on") : booleanValue(key) === false ? t("common.off") : t("common.unknown") }),
      onState(txState, detail) {
        if (txState === TX_STATE.SENDING || txState === TX_STATE.PENDING_READBACK || txState === TX_STATE.UNCERTAIN) return;
        const actual = booleanValue(key);
        input.disabled = false;
        input.value = actual === true ? "On" : "Off";
        input.classList.toggle("is-on", actual === true);
        input.setAttribute("aria-checked", String(actual === true));
        const rowLabel = input.closest(".diag-row")?.firstElementChild;
        if (rowLabel) rowLabel.textContent = rowLabel.dataset.registerLabel || rowLabel.textContent;
        if (txState === TX_STATE.CONFIRMED) {
          input.dataset.dirty = "false";
          setRequestMessage("settingsMessage", t("tx.saved"), "success");
        } else {
          input.classList.add("invalid");
          setRequestMessage("settingsMessage", txState === TX_STATE.MISMATCH ? t("tx.notConfirmed", { value: next ? t("common.on") : t("common.off"), detail }) : detail, "error");
        }
      }
    });
    tx.send();
  }

  function toggleRegisterPermission(input) {
    const key = input.dataset.registerToggle;
    if (!key || input.disabled) return;
    const next = input.value !== "On";
    if (armedRegisterToggle?.key === key) {
      const requested = armedRegisterToggle.next;
      if (registerToggleArmTimer) { window.clearTimeout(registerToggleArmTimer); registerToggleArmTimer = 0; }
      armedRegisterToggle = null;
      sendRegisterToggle(input, key, requested);
      return;
    }
    resetRegisterToggleArm();
    armedRegisterToggle = { key, next };
    input.value = next ? "On" : "Off";
    input.classList.toggle("is-on", next);
    input.classList.add("is-armed");
    input.setAttribute("aria-checked", String(next));
    const label = input.closest(".diag-row")?.firstElementChild;
    if (label) { label.textContent = t("common.confirmQuestion"); label.classList.add("register-confirm-label"); }
    registerToggleArmTimer = window.setTimeout(resetRegisterToggleArm, 4000);
  }

  /* ---------- settings: heating thresholds, dry contacts ----------
     Same transaction model as controls — no arm step (these aren't
     disruptive in the way cutting charge/discharge is), but still a real
     readback wait, not an HTTP-200-is-success shortcut. Numeric readback
     is compared with a small epsilon since the BMS may echo a filtered/
     rounded value. */
  function submitSettings() {
    const submit = getDom("settingsSubmit");
    if (submit && submit.disabled) return;
    let pendingCount = 0;
    for (let i = 0; i < SETTING_DEFS.length; i += 1) {
      const definition = SETTING_DEFS[i];
      const input = getDom(definition.inputId);
      if (!input || input.dataset.dirty !== "true" || input.value === "") continue;
      const value = Number(input.value);
      if (!Number.isFinite(value)) { input.classList.add("invalid"); continue; }
      pendingCount += 1;
      if (submit) submit.disabled = true;
      setRequestMessage(definition.messageId, t("tx.saving"), "busy");
      const compare = COMPARATORS[definition.comparator] || COMPARATORS.integer;
      const fieldLabel = settingFieldLabel(definition.key);
      const tx = writeTransaction({
        key: definition.key,
        address: GENERIC_TX_ADDRESS[definition.key],
        label: `${fieldLabel} → ${value}`,
        endpoint: `${definition.endpoint}?value=${encodeURIComponent(String(value))}`,
        matches: () => compare(value, numeric(definition.key)),
        describe: () => { const n = numeric(definition.key); return n === null ? t("tx.describeNoValue") : t("tx.describeReports", { value: n }); },
        onState: (txState, detail) => {
          pendingCount -= 1;
          if (submit && pendingCount <= 0) submit.disabled = false;
          if (txState === TX_STATE.CONFIRMED) {
            input.dataset.dirty = "false"; input.classList.remove("invalid");
            setRequestMessage(definition.messageId, t("tx.saved"), "success");
          } else if (txState === TX_STATE.MISMATCH) {
            input.classList.add("invalid");
            setRequestMessage(definition.messageId, t("tx.notConfirmed", { value, detail }), "error");
          } else {
            input.classList.add("invalid");
            setRequestMessage(definition.messageId, detail, "error");
          }
        }
      });
      tx.send();
    }
    if (pendingCount === 0) {
      setRequestMessage("settingsMessage", t("common.noChangedValues"), "");
    }
  }

  // Stage 4 production-integration gap fix (2026-09-21, user-directed):
  // catalog-driven UI for the write registry (WRITE_REGISTRY, generated
  // above by build_stage4_rw_inventory.js) — never hand-duplicates a
  // key/address/range, only renders what the catalog already says. Three
  // groups, per the plan's own acceptance matrix: live (real preflight →
  // confirm → POST flow via /settings/register-write, the SAME
  // writeTransaction()/write_tx_snapshot correlation every other register
  // write here already uses), authorizationRequired (visible, disabled,
  // reason shown — the server independently re-enforces this with a 403
  // regardless of what this UI does, see RegisterWriteHandler), blocked
  // (no editor at all, the real reason from stage4_rw_inventory.json).
  async function fetchRegisterWritePreflight(key, value) {
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
      const response = await fetch(
        endpointUrl(`/settings/register-write/preflight?key=${encodeURIComponent(key)}&value=${encodeURIComponent(String(value))}`),
        { method: "GET", cache: "no-store", credentials: "same-origin", signal: controller.signal, headers: { Accept: "application/json" } }
      );
      const body = await response.json().catch(() => null);
      return { status: response.status, body };
    } finally { window.clearTimeout(timeout); }
  }

  function writeRegistryFieldLabel(key) { return settingFieldLabel(key); }

  // Real DOM construction (createElement/textContent), never innerHTML —
  // matches this file's own established pattern for dynamic register-list
  // rows (see renderDiagnosticReadouts' own row-building code above).
  function renderWriteRegistryRow(entry, group) {
    const row = document.createElement("div");
    row.className = "diag-row write-registry-row";
    row.setAttribute("role", "row");
    row.dataset.writeRegistryKey = entry.key;
    row.dataset.writeRegistryGroup = group;

    const labelSpan = document.createElement("span");
    labelSpan.className = "write-registry-label";
    labelSpan.textContent = writeRegistryFieldLabel(entry.key);
    row.appendChild(labelSpan);

    if (group === "live") {
      const input = document.createElement("input");
      input.type = "number";
      input.id = `wr_${entry.key}`;
      input.min = String(entry.minimum);
      input.max = String(entry.maximum);
      input.step = String(entry.step);
      input.className = "num-input write-registry-input";
      row.appendChild(input);

      const button = document.createElement("button");
      button.type = "button";
      button.className = "btn small write-registry-button";
      button.dataset.wrAction = "preflight-write";
      button.dataset.wrKey = entry.key;
      button.textContent = t("writeRegistry.write");
      row.appendChild(button);

      const message = document.createElement("p");
      message.className = "request-message write-registry-status";
      message.id = `wrMsg_${entry.key}`;
      message.setAttribute("role", "status");
      message.setAttribute("aria-live", "polite");
      row.appendChild(message);
    } else if (group === "authorizationRequired") {
      const input = document.createElement("input");
      input.type = "number";
      input.disabled = true;
      input.setAttribute("aria-disabled", "true");
      row.appendChild(input);

      const note = document.createElement("span");
      note.className = "write-registry-note";
      note.textContent = t("writeRegistry.authorizationRequiredNote", { cls: entry.writeSafetyClass });
      row.appendChild(note);
    } else {
      const note = document.createElement("span");
      note.className = "write-registry-note";
      note.textContent = t("writeRegistry.blockedNote", { reason: entry.reason });
      row.appendChild(note);
    }
    return row;
  }

  function renderWriteRegistryGroupHeader(labelKey) {
    const header = document.createElement("div");
    header.className = "write-registry-group-header";
    header.dataset.i18nKey = labelKey;
    header.textContent = t(labelKey);
    return header;
  }

  function renderWriteRegistry() {
    const list = getDom("writeRegistryList");
    if (!list) return;
    // Draft/focus survival (spec requirement): never blow away a row the
    // user is actively editing/mid-transaction — a static catalog render
    // is safe to redo (WRITE_REGISTRY never changes at runtime), but skip
    // entirely once already rendered so an in-progress input/tx is never
    // disturbed by a later, redundant call (e.g. a tab re-activation).
    if (list.dataset.rendered === "true") return;
    list.innerHTML = "";
    list.appendChild(renderWriteRegistryGroupHeader("writeRegistry.live"));
    for (const entry of WRITE_REGISTRY.live) list.appendChild(renderWriteRegistryRow(entry, "live"));
    list.appendChild(renderWriteRegistryGroupHeader("writeRegistry.authorizationRequired"));
    for (const entry of WRITE_REGISTRY.authorizationRequired) list.appendChild(renderWriteRegistryRow(entry, "authorizationRequired"));
    list.appendChild(renderWriteRegistryGroupHeader("writeRegistry.blocked"));
    for (const entry of WRITE_REGISTRY.blocked) list.appendChild(renderWriteRegistryRow(entry, "blocked"));
    list.dataset.rendered = "true";

    list.addEventListener("click", (event) => {
      const button = event.target.closest("[data-wr-action='preflight-write']");
      if (!button) return;
      const key = button.dataset.wrKey;
      const entry = WRITE_REGISTRY.live.find((e) => e.key === key);
      const input = getDom(`wr_${key}`);
      if (!entry || !input) return;
      submitRegisterWrite(entry, input, button);
    });
  }

  // Language-switch fix (deployment-gate audit, this round): re-localizes
  // every piece of text renderWriteRegistry() generated dynamically (group
  // headers, field labels via writeRegistryFieldLabel(), the live "Write"
  // button, authorization-required/blocked notes) WITHOUT rebuilding a
  // single row/input node. This is the deliberate alternative to
  // list.replaceChildren()-and-rerender: a full rebuild would tear down
  // and recreate every <input>, which discards whatever the browser
  // itself is tracking for that node (value, focus, selectionStart/End) —
  // there is no API to snapshot/restore focus+caret across a node
  // replacement that is simpler than just not replacing the node. Every
  // live input, its id, its value, and any in-flight transaction's
  // button.disabled/message state are left completely untouched here —
  // only text CONTENT of label/header/button/note nodes changes. Called
  // from refreshAllDynamicText() below; a no-op if the panel hasn't been
  // rendered yet (nothing to re-localize).
  function relocalizeWriteRegistry() {
    const list = getDom("writeRegistryList");
    if (!list || list.dataset.rendered !== "true") return;
    for (const header of list.querySelectorAll(".write-registry-group-header")) {
      if (header.dataset.i18nKey) header.textContent = t(header.dataset.i18nKey);
    }
    for (const row of list.querySelectorAll(".write-registry-row")) {
      const key = row.dataset.writeRegistryKey;
      const group = row.dataset.writeRegistryGroup;
      const entry = (WRITE_REGISTRY[group] || []).find((e) => e.key === key);
      if (!entry) continue;
      const label = row.querySelector(".write-registry-label");
      if (label) label.textContent = writeRegistryFieldLabel(key);
      if (group === "live") {
        const button = row.querySelector(".write-registry-button");
        // Never touched while a transaction owns this button (it reads
        // e.g. "sending"/disabled during a real write) — button TEXT here
        // is always the static "Write" label regardless of tx state (see
        // submitRegisterWrite: it never rewrites button.textContent, only
        // button.disabled and the separate status paragraph), so this is
        // always safe to relocalize, pending write or not.
        if (button) button.textContent = t("writeRegistry.write");
        // The live status paragraph (wrMsg_<key>) is deliberately NOT
        // touched here: if a transaction is mid-flight, it is showing a
        // real, current status ("checking…"/"saving…"/an error) in the
        // OLD language — overwriting it with a freshly localized but
        // blank/generic string would erase real information a user may
        // still need mid-transaction. It naturally re-localizes on the
        // NEXT status change this same transaction produces.
      } else if (group === "authorizationRequired") {
        const note = row.querySelector(".write-registry-note");
        if (note) note.textContent = t("writeRegistry.authorizationRequiredNote", { cls: entry.writeSafetyClass });
      } else {
        const note = row.querySelector(".write-registry-note");
        if (note) note.textContent = t("writeRegistry.blockedNote", { reason: entry.reason });
      }
    }
  }

  async function submitRegisterWrite(entry, input, button) {
    const messageId = `wrMsg_${entry.key}`;
    const rawValue = input.value;
    if (rawValue === "" || !Number.isFinite(Number(rawValue))) {
      setRequestMessage(messageId, t("writeRegistry.notReady"), "error");
      return;
    }
    const value = Number(rawValue);
    if (activeTransactionKeys.has(entry.key)) {
      setRequestMessage(messageId, t("tx.anotherInProgress"), "error");
      return;
    }
    button.disabled = true;
    setRequestMessage(messageId, t("writeRegistry.checking"), "busy");
    const { status, body } = await fetchRegisterWritePreflight(entry.key, value).catch(() => ({ status: 0, body: null }));
    if (status !== 200 || !body || body.ready !== true) {
      button.disabled = false;
      const reason = (body && body.reject_reason) || `HTTP ${status}`;
      setRequestMessage(messageId, t("writeRegistry.preflightFailed", { reason }), "error");
      return;
    }
    const confirmed = window.confirm(t("writeRegistry.confirmPrompt", {
      key: writeRegistryFieldLabel(entry.key),
      currentRaw: body.current_raw,
      value,
      mergedRaw: body.merged_raw,
      siblingBits: body.sibling_bits_before,
    }));
    if (!confirmed) { button.disabled = false; setRequestMessage(messageId, "", ""); return; }

    setRequestMessage(messageId, t("tx.saving"), "busy");
    const tx = writeTransaction({
      key: entry.key,
      address: entry.address,
      label: `${writeRegistryFieldLabel(entry.key)} → ${value}`,
      endpoint: `/settings/register-write?key=${encodeURIComponent(entry.key)}&value=${encodeURIComponent(String(value))}&submit_policy=live`,
      matches: () => true, // authoritative correlation is write_tx_snapshot (cfg.address is always known here)
      describe: () => t("tx.describeReports", { value }),
      onState: (txState, detail) => {
        // writeTransaction()'s own set() calls cfg.onState for every
        // intermediate status too (SENDING, PENDING_READBACK, UNCERTAIN —
        // see its own module comment), not only the eventual terminal one
        // from finish() -- re-enabling the button unconditionally here
        // would let it go clickable again mid-transaction. Only a real
        // terminal state (everything finish() can report) re-enables it;
        // "submit повторно активується лише в terminal state" (deployment-
        // gate audit requirement F) — see
        // test_write_registry_ui.js's own F section for the exercised
        // proof (checking/pending/uncertain all keep it disabled).
        if (txState !== TX_STATE.SENDING && txState !== TX_STATE.PENDING_READBACK && txState !== TX_STATE.UNCERTAIN) {
          button.disabled = false;
        }
        if (txState === TX_STATE.CONFIRMED) {
          input.dataset.dirty = "false"; input.classList.remove("invalid");
          setRequestMessage(messageId, t("tx.saved"), "success");
        } else if (txState === TX_STATE.MISMATCH) {
          input.classList.add("invalid");
          setRequestMessage(messageId, t("tx.notConfirmed", { value, detail }), "error");
        } else {
          input.classList.add("invalid");
          setRequestMessage(messageId, detail, "error");
        }
      },
    });
    tx.send();
  }

  // CellCount does not go through the generic writeTransaction(): success
  // there means only "the watched register's own value changed to match"
  // — for CellCount that is NOT sufficient (spec §3/§17: "Cell Count не
  // дає хибного зеленого успіху"). This watches cellcount_tx_status_code
  // instead (a single explicit terminal signal published by the SAME
  // ESPHome code path AFTER resolve_topology has already run — see the
  // 250ms transaction interval in batterylifepo4.yaml), and only ever
  // reports success once ALL THREE required conditions hold at once:
  // readback_raw_value == requested, topology_state == CONFIRMED, AND
  // effective_cell_count == requested. Every intermediate status
  // (sending/ack_wait/readback_wait) is explicitly "still pending", not
  // silently treated as failure the way a binary matches() would.
  const CELLCOUNT_TX_STATUS = Object.freeze({
    IDLE: 0, SENDING: 1, ACK_WAIT: 2, READBACK_WAIT: 3,
    CONFIRMED: 4, MISMATCH: 5, WRITE_UNCERTAIN: 6, ACK_TIMEOUT: 7, READBACK_TIMEOUT: 8
  });
  function sendCellCountWrite(value, button, input) {
    if (activeTransactionKeys.has("cell_count")) {
      setRequestMessage("settingsMessage", t("tx.anotherInProgress"), "error");
      resetRegisterWriteButton(button);
      return;
    }
    activeTransactionKeys.add("cell_count");
    const startRevision = stateRevision.cellcount_tx_status_code || 0;
    setRegisterWriteButton(button, "sending");
    setRequestMessage("settingsMessage", t("tx.saving"), "busy");
    // Backend worst case before a terminal status: 3s ACK wait + 4s
    // forced-readback wait (sequential — readback only starts once ACK
    // lands) = 7s, plus scheduling/network slack. 9s gives a controlled
    // ~2s margin without the UI looking stuck for a real timeout.
    const timeoutMs = 9000;
    let settled = false;
    let timer = 0;
    let unwatch = null;

    function finish(success, detail) {
      if (settled) return;
      settled = true;
      if (timer) { window.clearTimeout(timer); timer = 0; }
      if (unwatch) { unwatch(); unwatch = null; }
      activeTransactionKeys.delete("cell_count");
      const outcome = success ? "confirmed" : "mismatch";
      if (Object.prototype.hasOwnProperty.call(txCounters, outcome)) txCounters[outcome] += 1;
      lastCommandLabel = `${settingFieldLabel("cell_count")} → ${value}`;
      lastCommandOutcome = outcome;
      lastCommandAt = Date.now();
      renderDiagnosticsLog();
      const currentInput = document.getElementById("reg_cell_count");
      if (success) {
        if (currentInput instanceof HTMLInputElement) { currentInput.dataset.dirty = "false"; currentInput.classList.remove("invalid"); }
        setRequestMessage("settingsMessage", t("tx.saved"), "success");
        flashRegisterWriteButton(button, "success");
      } else {
        if (currentInput instanceof HTMLInputElement) currentInput.classList.add("invalid");
        restoreRegisterReadback(currentInput || input, "cell_count");
        setRequestMessage("settingsMessage", detail, "error");
        flashRegisterWriteButton(button, "error");
      }
    }

    function evaluateTerminal() {
      const statusCode = numeric("cellcount_tx_status_code");
      if (statusCode === CELLCOUNT_TX_STATUS.CONFIRMED) {
        // Defense in depth: re-verify all three conditions client-side
        // too, rather than trusting the status code label alone.
        const readback = numeric("cell_count");
        const effective = numeric("effective_cell_count");
        const tier = topologyState();
        if (readback === value && tier === "CONFIRMED" && effective === value) {
          finish(true, "");
        } else {
          finish(false, t("tx.notConfirmed", { value, detail: t("tx.describeReports", { value: readback === null ? t("tx.describeNoValue") : readback }) }));
        }
        return true;
      }
      if (statusCode === CELLCOUNT_TX_STATUS.MISMATCH) {
        finish(false, t("tx.notConfirmed", { value, detail: topologyReasonText() || t("tx.describeNoValue") }));
        return true;
      }
      if (statusCode === CELLCOUNT_TX_STATUS.ACK_TIMEOUT || statusCode === CELLCOUNT_TX_STATUS.READBACK_TIMEOUT) {
        finish(false, t("topology.reason.WRITE_UNCERTAIN"));
        return true;
      }
      return false; // sending/ack_wait/readback_wait — still pending
    }

    (async () => {
      try {
        await postCommand(`/number/set_cell_count/set?value=${encodeURIComponent(String(value))}`);
      } catch (error) {
        finish(false, error.name === "AbortError" ? t("tx.requestTimedOut") : t("tx.requestFailed"));
        return;
      }
      // Same race fix as writeTransaction(): the terminal status can
      // already have landed while this POST's own fetch() was in flight.
      if ((stateRevision.cellcount_tx_status_code || 0) > startRevision && evaluateTerminal()) return;
      timer = window.setTimeout(() => finish(false, t("tx.noConfirmation")), timeoutMs);
      unwatch = watchKey("cellcount_tx_status_code", () => {
        if ((stateRevision.cellcount_tx_status_code || 0) <= startRevision) return;
        evaluateTerminal();
      });
    })();
  }

  function submitRegisterSetting(key, button) {
    const definition = SETTING_DEFS.find((item) => item.key === key) || (CONTROL_DEFS[key] ? { key, kind: "select", inputId: `reg_${key}`, ...CONTROL_DEFS[key] } : null);
    if (!definition || !button || button.disabled) return;
    const input = getDom(definition.inputId);
    if (!input || input.value.trim() === "") return;
    if (definition.kind === "select") return;
    const value = Number(input.value.replace(",", "."));
    if (!Number.isFinite(value)) { input.classList.add("invalid"); return; }
    input.classList.remove("invalid");
    setRegisterWriteButton(button, "sending");
    if ((Number.isFinite(definition.min) && value < definition.min) || (Number.isFinite(definition.max) && value > definition.max)) {
      input.classList.add("invalid"); resetRegisterWriteButton(button); return;
    }
    if (Number.isFinite(definition.step) && definition.step > 0 && Number.isFinite(definition.min)) {
      const steps = (value - definition.min) / definition.step;
      if (Math.abs(steps - Math.round(steps)) > 1e-7) {
        input.classList.add("invalid"); resetRegisterWriteButton(button); return;
      }
    }
    if (key === "cell_count") {
      const tier = topologyState();
      if (tier === "LOADING") {
        resetRegisterWriteButton(button);
        setRequestMessage("settingsMessage", t("topology.blockedRewrite"), "error");
        return;
      }
      if (tier !== "CONFIRMED" && !cellCountRewriteArmed) {
        resetRegisterWriteButton(button);
        cellCountRewriteArmed = true;
        if (cellCountRewriteArmTimer) window.clearTimeout(cellCountRewriteArmTimer);
        cellCountRewriteArmTimer = window.setTimeout(resetCellCountRewriteArm, 4000);
        setRequestMessage("settingsMessage", t("topology.confirmRewrite"), "error");
        return;
      }
      resetCellCountRewriteArm();
      sendCellCountWrite(value, button, input);
      return;
    }
    const compare = COMPARATORS[definition.comparator] || COMPARATORS.integer;
    const fieldLabel = settingFieldLabel(definition.key);
    const tx = writeTransaction({
      key: definition.key,
      address: GENERIC_TX_ADDRESS[definition.key],
      label: `${fieldLabel} → ${value}`,
      endpoint: `${definition.endpoint}?value=${encodeURIComponent(String(value))}`,
      matches: () => compare(value, numeric(definition.key)),
      describe: () => { const n = numeric(definition.key); return n === null ? t("tx.describeNoValue") : t("tx.describeReports", { value: n }); },
      onState: (txState, detail) => {
        if (txState === TX_STATE.SENDING || txState === TX_STATE.PENDING_READBACK || txState === TX_STATE.UNCERTAIN) return;
        // Use the live field, not the DOM node captured when the button was
        // clicked: telemetry may have recreated the row in the meantime.
        const currentInput = document.getElementById(definition.inputId);
        if (txState === TX_STATE.CONFIRMED) {
          if (currentInput instanceof HTMLInputElement) {
            currentInput.dataset.dirty = "false";
            currentInput.classList.remove("invalid");
          }
          setRequestMessage("settingsMessage", t("tx.saved"), "success");
          flashRegisterWriteButton(button, "success");
        } else {
          if (currentInput instanceof HTMLInputElement) currentInput.classList.add("invalid");
          restoreRegisterReadback(currentInput || input, definition.key);
          setRequestMessage("settingsMessage", txState === TX_STATE.MISMATCH ? t("tx.notConfirmed", { value, detail }) : detail, "error");
          flashRegisterWriteButton(button, "error");
        }
      }
    });
    tx.send();
  }

  /* ---------- device name (Settings) ----------
     Saves to the real `device_name_override` text entity (ESPHome
     `optimistic: true` + `restore_value: true` — it persists the value in
     flash itself). Empty clears the override and falls back to
     bms_display_name, the compile-time name. */
  function initDeviceNameField() {
    const input = getDom("deviceNameInput");
    const saveBtn = getDom("deviceNameSaveBtn");
    if (!input || !saveBtn) return;
    saveBtn.addEventListener("click", async () => {
      const name = input.value.trim();
      if (name.length > 32) { setDeviceNameMessage(t("deviceName.tooLong"), "error"); return; }
      saveBtn.disabled = true;
      setDeviceNameMessage(t("tx.saving"), "busy");
      try {
        await postCommand(`${DEVICE_NAME_ENDPOINT}?value=${encodeURIComponent(name)}`);
        state.device_name_override = { state: name, value: name };
        setDeviceNameMessage(name ? t("deviceName.saved") : t("deviceName.reverted"), "success");
      } catch (error) {
        setDeviceNameMessage(error.name === "AbortError" ? t("deviceName.timedOut") : t("deviceName.saveFailed"), "error");
      } finally {
        saveBtn.disabled = false;
      }
    });
  }
  function setDeviceNameMessage(text, kind) {
    const node = getDom("deviceNameMessage");
    if (!node) return;
    node.textContent = text;
    node.className = "pw-message" + (kind ? ` ${kind}` : "");
  }

  /* ---------- theme: Light / Dark / Auto ----------
     "Auto" isn't a third stored value — it's the absence of data-theme,
     which lets the CSS's own @media(prefers-color-scheme) block (the
     actual "follow the system" logic) take over. */
  const THEME_KEY = "jkbms-theme";
  function themeChoice() {
    try { return localStorage.getItem(THEME_KEY) || "auto"; } catch (_) { return "auto"; }
  }
  function applyThemeChoice(choice) {
    const root = document.documentElement;
    if (choice === "auto") root.removeAttribute("data-theme"); else root.setAttribute("data-theme", choice);
    try { if (choice === "auto") localStorage.removeItem(THEME_KEY); else localStorage.setItem(THEME_KEY, choice); } catch (_) {}
    syncThemeOptions();
  }
  function syncThemeOptions() {
    const choice = themeChoice();
    // Scoped to #themeOptions specifically — .theme-opt is a shared visual
    // class (the language selector below reuses it deliberately, per
    // V2.2's "visually consistent control style" requirement), so an
    // unscoped selector here would toggle "active" off on the language
    // buttons too every time the theme syncs. Real bug, caught by actually
    // clicking through Settings in a browser, not by reading the code.
    document.querySelectorAll("#themeOptions .theme-opt").forEach((btn) => btn.classList.toggle("active", btn.dataset.themeChoice === choice));
  }
  function initTheme() {
    const saved = themeChoice();
    if (saved !== "auto") document.documentElement.setAttribute("data-theme", saved);
    syncThemeOptions();
    document.querySelectorAll("#themeOptions .theme-opt").forEach((btn) => btn.addEventListener("click", () => applyThemeChoice(btn.dataset.themeChoice)));
  }

  /* ---------- language: English / Українська ----------
     Presentation-only, mirrors the theme pattern above exactly (own
     localStorage key, own sync/apply pair). Deliberately NOT touched:
     device_name/device_name_override (real BMS entity), any Modbus
     entity key, any wire id — those stay language-neutral forever so a
     future refactor can never be tempted to use a translated string as
     an internal lookup key. */
  function syncLanguageOptions() {
    document.querySelectorAll("#languageOptions .theme-opt").forEach((btn) => btn.classList.toggle("active", btn.dataset.langChoice === currentLang));
  }

  // Everything that isn't picked up by applyI18nToRoot's data-i18n walk —
  // dynamic render functions that build their own text from live state.
  // Called once on language switch so an already-open screen/modal
  // updates immediately, per the "no reload" requirement; none of these
  // touch state[]/history/SSE, so telemetry is never disturbed.
  function refreshAllDynamicText() {
    applyI18nToRoot(document);
    renderDiagnosticReadouts();
    renderDiagnosticSoftwareVariables();
    relocalizeWriteRegistry();
    const readoutTable = getDom("diagSoftwareVarList");
    if (readoutTable) readoutTable.setAttribute("aria-label", t("diagnostics.readEntities"));
    lastAlarmMarkupKey = null; // force renderAlarmList to rebuild its cached innerHTML in the new language
    // Every bindText()-driven readout (Voltage/Current/Power/Balance/
    // temperatures, in both Overview and Electrical/Health) bakes its unit
    // into formatNumber()'s output at render time — replaying every bound
    // key here is what makes those units re-localize live, without a
    // second copy of the unit table living in the DOM.
    for (const key of renderers.keys()) scheduleRender(key);
    renderChargeAndAlarms();
    renderTempSummary();
    renderFreshness();
    renderDiagnosticsLog();
    renderRemaining();
    renderLifetime();
    renderCells();
    drawTimeline();
    renderChargeCycleTimeline(); // re-localizes state-segment labels, tooltip text and the clock-range caption; no-ops if Electrical isn't the active panel
    if (!getDom("cellOverlay").hidden) {
      // The trend modal's title is set once, on open, from historyContext —
      // drawHistory() alone re-renders the chart/axis text but not this,
      // so an open modal's title would otherwise stay frozen in the old
      // language (real bug, caught by actually leaving a modal open across
      // a language switch rather than only checking it on open).
      const cellModalTitleEl = getDom("cellModalTitle");
      if (cellModalTitleEl) {
        cellModalTitleEl.textContent = historyContext.kind === "cell"
          ? t("cells.cellLabel", { n: String(historyContext.cellIndex + 1).padStart(2, "0") })
          : metricLabel(historyContext.key)[0] || historyContext.key;
      }
      drawHistory();
    }
    syncThemeOptions();
    syncLanguageOptions();
  }

  function setLanguage(next) {
    if (SUPPORTED_LANGS.indexOf(next) === -1 || next === currentLang) return;
    currentLang = next;
    try { localStorage.setItem(LANGUAGE_KEY, next); } catch (_) { /* language choice just won't survive reload */ }
    document.documentElement.lang = currentLang;
    refreshAllDynamicText();
  }

  // currentLang is already resolved (see the module-scope call to
  // detectInitialLanguage() right after its own definition) — this only
  // wires the Settings-modal buttons, called once from build().
  function initLanguage() {
    syncLanguageOptions();
    document.querySelectorAll("#languageOptions .theme-opt").forEach((btn) => btn.addEventListener("click", () => setLanguage(btn.dataset.langChoice)));
  }

  /* ---------- settings modal ---------- */
  function openSettings() {
    getDom("settingsOverlay").hidden = false;
    syncThemeOptions();
    syncLanguageOptions();
    const override = state.device_name_override;
    getDom("deviceNameInput").value = override && override.state ? override.state : "";
    setDeviceNameMessage("");
  }
  function closeSettings() { getDom("settingsOverlay").hidden = true; }

  /* ---------- per-reading history modal (cells, pack metrics, temps) ----------
     Real series (Voltage/Current/Power/Balance/the four temperatures) come
     from the on-device ring buffer (/history.json, batterylifepo4.yaml) —
     fetched every 30s to match its own sample rate. Individual cell
     voltage/resistance and the Average/Delta-of-cells stats have no
     on-device buffer (that would be 32 more series just for cells) — those
     fall back to a synthetic walk seeded to end exactly on the live
     reading, same as before, clearly a placeholder rather than logged data. */
  const REAL_HISTORY_KEYS = { voltage: "voltage", current: "current", power: "power", balance: "balance", mosfet: "mosfet_temp", t1: "temp1", t2: "temp2", t4: "temp4", t5: "temp5" };
  // Units/digits are static; the label is a live t() lookup (not a
  // pre-baked object) so a language switch reflects here without needing
  // its own separate cache-invalidation path.
  const METRIC_META = {
    voltage: ["V", 2], current: ["A", 2], power: ["W", 0], balance: ["A", 2],
    mosfet: ["°C", 1], t1: ["°C", 1], t2: ["°C", 1], t4: ["°C", 1], t5: ["°C", 1],
    avgVoltage: ["V", 3], deltaVoltage: ["V", 3], avgResistance: ["Ω", 3], deltaResistance: ["Ω", 3]
  };
  function metricLabel(key) {
    const meta = METRIC_META[key];
    if (!meta) return ["", "", 2];
    return [t(`trendModal.metrics.${key}`), meta[0], meta[1]];
  }

  function seededRandom(seed) {
    let s = seed % 2147483647; if (s <= 0) s += 2147483646;
    return () => { s = (s * 16807) % 2147483647; return (s - 1) / 2147483646; };
  }
  function syntheticWalk(endValue, seed, stepPct, points) {
    const rand = seededRandom(seed);
    const pts = new Array(points);
    pts[points - 1] = endValue;
    let v = endValue;
    for (let i = points - 2; i >= 0; i -= 1) { v += (rand() - 0.5) * 2 * (endValue * stepPct); pts[i] = v; }
    return pts;
  }
  const syntheticCache = {};
  function syntheticHistoryFor(key, endValue, seed, stepPct) {
    const cacheKey = `${key}:${endValue}`;
    if (!syntheticCache[cacheKey]) syntheticCache[cacheKey] = syntheticWalk(endValue, seed, stepPct, 21);
    return syntheticCache[cacheKey];
  }

  async function fetchHistory() {
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
      const response = await fetch(endpointUrl("history.json"), { cache: "no-store", credentials: "same-origin", signal: controller.signal });
      if (!response.ok) return;
      historyData = await response.json();
      if (!cellOverlay.hidden && historyContext.kind === "metric" && REAL_HISTORY_KEYS[historyContext.key]) drawHistory();
    } catch (_) {
      // Offline or not yet reachable — callers fall back to a synthetic
      // series ending at the live value, so this fails silently.
    } finally { window.clearTimeout(timeout); }
  }

  let cellOverlay, cellModalTitle, cellModalValue, cellModalUnit, cellModalSegment;
  let historyContext = { kind: "cell", cellIndex: 0, mode: "v" };

  function historyPointsFor() {
    if (historyContext.kind === "cell") {
      const endValue = historyContext.mode === "v" ? cellVoltageBuffer[historyContext.cellIndex] : cellResistanceBuffer[historyContext.cellIndex];
      const seed = historyContext.cellIndex * 97 + (historyContext.mode === "v" ? 1 : 2);
      const stepPct = historyContext.mode === "v" ? 0.0009 : 0.01;
      const safeEnd = Number.isNaN(endValue) ? 0 : endValue;
      return { pts: syntheticHistoryFor(`cell${historyContext.cellIndex}${historyContext.mode}`, safeEnd, seed, stepPct), unit: historyContext.mode === "v" ? "V" : "Ω", digits: 3, real: false };
    }
    const key = historyContext.key;
    const [label, unit, digits] = metricLabel(key);
    const realKey = REAL_HISTORY_KEYS[key];
    if (realKey && historyData && Array.isArray(historyData[realKey])) {
      const pts = historyData[realKey].filter((v) => v !== null && v !== undefined && Number.isFinite(v));
      // interval_s comes straight off the live payload, never assumed —
      // if the backend's ring-buffer sample rate ever changes, the "Last
      // N minutes" label and the real per-sample clock times both follow
      // it automatically instead of drifting out of sync with a
      // hardcoded window claim (see the V2.1 fix for exactly that drift:
      // this buffer used to hold 20 real minutes while the UI said 20,
      // then the buffer grew to 30 real minutes and the label didn't).
      const intervalS = Number.isFinite(historyData.interval_s) ? historyData.interval_s : null;
      if (pts.length >= 2) return { pts, unit, digits, real: true, intervalS };
    }
    // Not yet enough real samples (freshly booted device) or a derived
    // stat with no buffer of its own — synthetic walk ending at the live
    // computed value, same convention as the cell-level fallback above.
    let endValue = 0;
    if (key === "avgVoltage") endValue = stats(Array.from(cellVoltageBuffer).filter((v) => !Number.isNaN(v)) || [0]).avg;
    else if (key === "deltaVoltage") endValue = stats(Array.from(cellVoltageBuffer).filter((v) => !Number.isNaN(v)) || [0]).delta;
    else if (key === "avgResistance") endValue = stats(Array.from(cellResistanceBuffer).filter((v) => !Number.isNaN(v)) || [0]).avg;
    else if (key === "deltaResistance") endValue = stats(Array.from(cellResistanceBuffer).filter((v) => !Number.isNaN(v)) || [0]).delta;
    else endValue = numeric(REAL_HISTORY_KEYS[key] ? historyMetricSensorKey(key) : key) || 0;
    return { pts: syntheticHistoryFor(key, endValue, key.length * 37 + 11, 0.05), unit, digits, real: false };
  }
  function historyMetricSensorKey(key) {
    const map = { voltage: "total_voltage", current: "current", power: "power", balance: "balance_current", mosfet: "mosfet_temperature", t1: "temperature_1", t2: "temperature_2", t4: "temperature_4", t5: "temperature_5" };
    return map[key] || key;
  }

  // Adaptive marker count for the X-axis time strip — desktop gets more
  // room to be precise, mobile gets fewer, wider-spaced labels rather
  // than crowding/clipping them.
  function timeAxisMarkerCount() {
    const w = window.innerWidth || 1024;
    if (w >= 860) return 5;
    if (w >= 520) return 4;
    return 3;
  }

  function renderTimeAxis(pts, real, intervalS) {
    const host = getDom("histTimeAxis");
    if (!host) return;
    host.innerHTML = "";
    const n = timeAxisMarkerCount();
    if (real && intervalS) {
      // Real per-sample clock times, derived from now() and the actual
      // reported sample interval — never fabricated. The last sample is
      // always "now" exactly (age 0), earlier ones step back by
      // intervalS each, matching the ring buffer's real cadence.
      const nowMs = Date.now();
      for (let m = 0; m < n; m += 1) {
        const frac = n === 1 ? 1 : m / (n - 1);
        const sampleIdx = Math.round(frac * (pts.length - 1));
        const ageS = (pts.length - 1 - sampleIdx) * intervalS;
        const label = document.createElement("span");
        label.textContent = ageS <= 0
          ? t("trendModal.now")
          : new Date(nowMs - ageS * 1000).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
        host.appendChild(label);
      }
    } else {
      // Synthetic series carry no real sample timestamps — showing clock
      // times for them would fabricate a precision that doesn't exist.
      // Relative, unitless position markers only, "now" anchored at the
      // real end since that one point IS the live reading.
      for (let m = 0; m < n; m += 1) {
        const label = document.createElement("span");
        label.textContent = m === n - 1 ? t("trendModal.now") : "";
        host.appendChild(label);
      }
    }
  }

  function drawHistory() {
    const { pts, unit, digits, real, intervalS } = historyPointsFor();
    const illustrativeTag = getDom("cellModalIllustrative");
    if (illustrativeTag) illustrativeTag.hidden = Boolean(real);
    const windowLabel = getDom("cellModalWindow");
    if (windowLabel) {
      if (real && intervalS) {
        const minutes = Math.round((intervalS * pts.length) / 60);
        windowLabel.textContent = tp("trendModal.lastMinutes", minutes);
      } else {
        windowLabel.textContent = t("trendModal.illustrativeTrend");
      }
    }
    if (!pts || pts.length === 0) {
      getDom("histLine").setAttribute("d", "");
      getDom("histArea").setAttribute("d", "");
      cellModalValue.textContent = "--";
      return;
    }
    const min = Math.min.apply(null, pts), max = Math.max.apply(null, pts);
    const avg = pts.reduce((a, b) => a + b, 0) / pts.length;
    // Voltage gets a flat +/-0.01V pad, not a percentage of the absolute
    // value — a 52V pack's meaningful swing is a few tenths of a volt, so
    // a 5%-of-52V pad (2.6V) would nearly flatten the real variation out
    // of the chart. Every other unit (A/W/deg C/ohm) keeps the existing
    // percentage pad, which behaves sensibly across their much smaller
    // absolute-value ranges. Equal-samples edge case still gets a real,
    // non-zero span either way.
    const isVoltageUnit = unit === "V";
    const domainLow = isVoltageUnit ? min - 0.01 : min - min * DOMAIN_PAD;
    const domainHigh = isVoltageUnit ? max + 0.01 : max + max * DOMAIN_PAD;
    const span = (domainHigh - domainLow) || (domainHigh * DOMAIN_PAD * 2) || 1;
    const W = 600, H = 100;
    const x = (i) => (i / (pts.length - 1 || 1)) * W;
    const y = (v) => H - ((v - domainLow) / span) * H;
    const linePts = pts.map((v, i) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`);
    getDom("histLine").setAttribute("d", `M${linePts.join(" L")}`);
    getDom("histArea").setAttribute("d", `M${linePts.join(" L")} L${W},${H} L0,${H} Z`);

    const endPct = Math.max(0, Math.min(100, ((pts[pts.length - 1] - domainLow) / span) * 100));
    getDom("histEnd").style.top = `${100 - endPct}%`;
    const avgPct = Math.max(0, Math.min(100, ((avg - domainLow) / span) * 100));
    getDom("histAvgLine").style.top = `${100 - avgPct}%`;
    getDom("histTop").textContent = domainHigh.toFixed(digits);
    // Evenly-spaced geometric midpoint, not the average value — see the
    // matching fix in ccDraw()/renderCells() for why.
    const midEl = getDom("histMid");
    midEl.textContent = ((domainHigh + domainLow) / 2).toFixed(digits);
    midEl.style.top = "50%";
    getDom("histBottom").textContent = domainLow.toFixed(digits);
    const unitDisplay = unitLabel(unit);
    getDom("histMin").textContent = `${min.toFixed(digits)} ${unitDisplay}`;
    getDom("histAvg").textContent = `${avg.toFixed(digits)} ${unitDisplay}`;
    getDom("histMax").textContent = `${max.toFixed(digits)} ${unitDisplay}`;
    cellModalValue.textContent = pts[pts.length - 1].toFixed(digits);
    cellModalUnit.textContent = unitDisplay;
    renderTimeAxis(pts, real, intervalS);
  }

  function openCellHistory(index) {
    historyContext = { kind: "cell", cellIndex: index, mode: "v" };
    cellModalSegment.hidden = false;
    document.querySelectorAll("#cellModalSegment button").forEach((b) => b.classList.toggle("active", b.dataset.mode === "v"));
    cellModalTitle.textContent = t("cells.cellLabel", { n: String(index + 1).padStart(2, "0") });
    drawHistory();
    cellOverlay.hidden = false;
  }
  async function openMetricHistory(key) {
    historyContext = { kind: "metric", key };
    cellModalSegment.hidden = true;
    cellModalTitle.textContent = metricLabel(key)[0] || key;
    cellOverlay.hidden = false;
    // Draw immediately with whatever's cached (instant open, no blank
    // modal) — but for a real-history metric, await a fresh fetch before
    // the FINAL draw, so opening the modal doesn't race drawHistory()
    // against fetchHistory() and settle on the synthetic fallback purely
    // because the network response hadn't landed yet (it previously did,
    // even once /history.json had genuinely already loaded the real
    // series moments earlier).
    drawHistory();
    if (REAL_HISTORY_KEYS[key]) {
      await fetchHistory();
      if (!cellOverlay.hidden && historyContext.kind === "metric" && historyContext.key === key) drawHistory();
    }
  }
  function closeCellHistory() { cellOverlay.hidden = true; }

  // User-directed rework (2026-09-17): when the confirmed channel count N
  // changes (a real CellCount reconfiguration, e.g. 16 -> 8), a cell-history
  // modal already open on a now-out-of-range index (cellIndex >= the NEW
  // active count) would otherwise keep showing a chart/selection that
  // "belongs" to the previous configuration — a stale value exactly of the
  // kind this rework is meant to eliminate. Closing it (rather than trying
  // to re-target it to a different cell) is the safe choice: silently
  // jumping the open modal to a different channel would be its own kind of
  // surprising, unrequested substitution. Only ever acts on kind:"cell"
  // modals — a metric-history modal (kind:"metric") isn't tied to a
  // per-cell index and is unaffected by a topology change.
  function closeStaleCellHistorySelection() {
    if (cellOverlay.hidden) return;
    if (historyContext.kind !== "cell") return;
    if (historyContext.cellIndex >= activeCellCount()) closeCellHistory();
  }

  /* ---------- charge-cycle: live stats ----------
     Stage/Now/Timer/Target are always the LIVE BMS state, updated on
     every relevant SSE tick — cheap, no fetch — deliberately independent
     of whatever historical 6h window is currently panned into view below
     (spec §35/§36: this row must never look like it describes a panned
     moment 40h in the past). The actual timeline (real 60-hour logged
     history) is a separate, less-frequent refresh; see
     renderChargeCycleTimeline() below. */
  function drawTimeline() {
    const stage = chargeStage();
    setText("tlStageNow", stage.label || "—");
    // Title fallback: at the narrowest supported widths the longest real
    // stage string ("Немає зв'язку") can still exceed the column even at
    // the tuned font floor — the full text stays reachable via native
    // tooltip/long-press rather than silently disappearing.
    const stageEl = getDom("tlStageNow");
    if (stageEl) stageEl.title = stage.label || "";
    const voltageNow = numeric("total_voltage");
    setText("tlVoltageNow", voltageNow === null ? "--" : `${voltageNow.toFixed(2)} ${unitLabel("V")}`);
    // Real protocol values: VolCellRCV (recommended charge voltage) for
    // Bulk/Absorption and VolCellRFV (requested float voltage) for Float.
    // Both are per-cell settings, converted to the CONFIRMED series count —
    // never a guess while topology_state isn't CONFIRMED (activeCellCount()
    // enforces that; see topologyState()). Idle, discharge, offline and
    // unavailable/invalid registers have no target either way.
    const phaseEntity = state.charge_phase;
    const phase = phaseEntity
      ? String(phaseEntity.state !== undefined ? phaseEntity.state : phaseEntity.value || "").trim().toLowerCase()
      : "";
    const targetPerCell = phase === "float"
      ? numeric("cell_rfv")
      : (phase === "bulk" || phase === "absorption")
        ? numeric("cell_rcv")
        : null;
    const targetPackVoltage = targetPerCell !== null && targetPerCell > 0 && topologyState() === "CONFIRMED"
      ? targetPerCell * activeCellCount()
      : null;
    setText("tlVoltageTarget", targetPackVoltage === null ? "—" : `${targetPackVoltage.toFixed(2)} ${unitLabel("V")}`);
    const elapsedSeconds = numeric("charge_phase_time");
    setText("tlTimer", elapsedSeconds === null ? "--" : formatDuration(elapsedSeconds));
  }

  /* ---------- charge-cycle: continuous zoomable timeline ----------
     Data source: the same real, memory-budgeted on-device ring buffer as
     before (cc_hist_* in batterylifepo4.yaml, 1 sample/min x up to 3600
     samples = 60h), still served as fixed 6h blocks via
     /charge_history.json/<offset> (offset 0 = newest block) — the ESP32
     HTTP handler was NOT changed, since it already has everything a
     continuous viewport needs. What changed is entirely client-side:
     every fetched block is decoded into ccSamples, a Map keyed by a
     RECONSTRUCTED sample time (not by offset or sample index — and not
     called "real wall-clock time," since it is not literally the stored
     value), so the frontend can stitch adjacent blocks into one
     continuous timeline and let the visible viewport sit at ANY point
     along it, at ANY of several zoom durations — never snapped to the
     block boundaries the backend happens to fetch in.

     TIMESTAMP HONESTY (spec §49-51): the buffer stores no per-sample
     timestamp at all — adding one would cost +4B x 3600 = +14.4KB for a
     sampler whose cadence is already fixed by the ESPHome `interval: 60s`
     block that writes it. So every sample's time is RECONSTRUCTED as
     `ccAnchor.nowAtAnchorMs - (samplesFromNewest) * CC_INTERVAL_MS`,
     where ccAnchor is refreshed every time offset 0 is fetched (on load,
     on every live-follow tick, and after a manual return-to-Now). This
     keeps the whole cache internally consistent (no drift between
     blocks fetched at different times) and self-corrects on each
     refresh — but it is still a reconstruction, not a stored fact:
     accuracy is on the order of one sampling interval (60s) and assumes
     the on-device sampler never stalls for a prolonged period without
     also being reflected in a stale bms_health reading. This caveat is
     intentionally NOT surfaced in the normal UI (spec §50) — the
     reconstruction is accurate enough for a 1h-60h engineering timeline,
     and stating it prominently would just be diagnostic noise for a
     product surface. Transition timestamps carry the same one-interval
     resolution, which is why every place that displays one
     (formatClockShort) shows minute precision only, never seconds. */
  const CC_INTERVAL_MS = 60000;
  const CC_MAX_HISTORY_MS = 60 * 3600 * 1000;
  const CC_WINDOW_SAMPLES = 360;           // matches the backend's kWindow
  const CC_MAX_OFFSET = 9;                 // matches the backend's kMaxOffset
  // Discrete viewport-duration presets (spec §23) — deliberately discrete
  // steps, not arbitrary fractional zoom, matching the backend's own
  // fixed-block granularity and keeping the +/- control's state simple
  // (a plain index) and easy to reason about at every call site.
  const CC_ZOOM_LEVELS_H = [1, 3, 6, 12, 24, 60];
  const CC_DEFAULT_ZOOM_INDEX = 2; // 6h — unchanged default (spec §23)
  let ccZoomIndex = CC_DEFAULT_ZOOM_INDEX;
  function ccTargetDurationMs() { return CC_ZOOM_LEVELS_H[ccZoomIndex] * 3600000; }
  // Minimum Y display span for a 16S LiFePO4 pack (nominal ~51.2V) — not
  // the sketch's 48-57V (that was explicitly conceptual, spec §16), and
  // not zero: a genuinely flat float/idle period with a few tens of mV
  // of real ripple would otherwise fill the entire plot height and read
  // as violent movement. 1.0V is ~2% of nominal — small enough that a
  // real 0.3-0.5V absorption taper still reads clearly, large enough
  // that idle noise can't dominate the frame.
  const CC_MIN_SPAN_V = 1.0;
  // Theme-aware CSS custom-property NAMES (not resolved colors, and not
  // hardcoded hex) — see the --state-*/--state-*-surface block in
  // jk_bms.css for the actual values, each already a clean OKLCH-mixed
  // pastel (mixed toward --panel, not the recessed --panel-2, so low
  // percentages stay clean instead of desaturating toward gray). Idle
  // and Offline share one dedicated neutral surface token — gray is the
  // semantically correct choice for exactly those two, not a fallback.
  const CC_STAGE_SURFACE_VAR = { 0: "--state-idle-surface", 1: "--state-charge-surface", 2: "--state-absorption-surface", 3: "--state-float-surface", 4: "--state-discharge-surface", 5: "--state-idle-surface" };
  // Raw/vivid tokens — unmixed with the panel — for the MIN/MAX-style
  // top contour and (via currentColor) the segment label and the
  // strip-internal transition mark. Idle/Offline intentionally use
  // neutral ink tokens here too, not a hue — gray is the semantically
  // correct "contour" for a state that has no color to begin with.
  const CC_STAGE_VIVID_VAR = { 0: "--ink-dim", 1: "--state-charge", 2: "--state-absorption", 3: "--state-float", 4: "--state-discharge", 5: "--ink-faint" };
  // Product-facing battery_state wording (spec §47/§48) — code 1 in this
  // buffer is charge_phase="bulk" internally, but the main historical
  // timeline must read like battery_state ("Заряд"/"Charging"), never
  // the internal phase name ("Основний"/"Bulk"). Bulk stays a legitimate
  // charge_phase concept elsewhere (Diagnostics); it just isn't shown
  // here. Same reasoning for offline: a dedicated product-facing string
  // ("Немає зв'язку"/"No connection"), not a reuse of the generic
  // Diagnostics-oriented stage.offline wording.
  const CC_STAGE_I18N_KEY = { 0: "stage.idle", 1: "stage.charging", 2: "stage.absorption", 3: "stage.float", 4: "stage.discharging", 5: "electrical.cc.fullOffline" };
  const CC_STAGE_SHORT_KEY = { 0: "electrical.cc.shortIdle", 1: "electrical.cc.shortCharge", 2: "electrical.cc.shortAbs", 3: "electrical.cc.shortFloat", 4: "electrical.cc.shortDischarge", 5: "electrical.cc.shortOffline" };
  function ccStageName(code) { return t(CC_STAGE_I18N_KEY[code] || "stage.idle"); }
  function ccStageShortName(code) { return t(CC_STAGE_SHORT_KEY[code] || "electrical.cc.shortIdle"); }
  function ccLocale() { return currentLang === "uk" ? "uk-UA" : "en-US"; }

  // Real text measurement (spec §7: "never clip text") — a per-character
  // px estimate looked fine for English but silently underestimated
  // uppercase Cyrillic ("Абсорб." rendered wider than predicted), which
  // let the label overflow into .cc-seg-label's overflow:hidden and get
  // clipped to "АБС" instead of being hidden. Canvas measureText() reads
  // the browser's own actual glyph metrics for whatever text/language is
  // showing, so this is correct regardless of alphabet.
  const ccMeasureCtx = document.createElement("canvas").getContext("2d");
  function ccLabelWidthPx(text) {
    // Matches .cc-seg-label's own font-size step at the same 480px
    // breakpoint (jk_bms.css) — measuring at the wrong size would just
    // bias the hide/show decision, not cause a real clip (text-overflow:
    // ellipsis is the actual safety net for that), but there is no
    // reason to leave it wrong when the breakpoint is a known constant.
    const size = window.innerWidth <= 480 ? "9.5px" : "10.5px";
    ccMeasureCtx.font = `600 ${size} -apple-system, BlinkMacSystemFont, 'SF Pro Display', 'Segoe UI', sans-serif`;
    return ccMeasureCtx.measureText(text.toUpperCase()).width;
  }

  let ccAnchor = null;              // { countAtAnchor, nowAtAnchorMs } — see doc comment above
  const ccSamples = new Map();      // roundedTimeMs -> { v: number|null, stage: number }
  const ccCachedOffsets = new Set();
  const ccFetchInFlight = new Map(); // offset -> Promise
  let ccViewportEndMs = null;       // null = "follow now" (compute live each render)
  let ccIsFollowingNow = true;
  let ccWindowDurationMs = CC_ZOOM_LEVELS_H[CC_DEFAULT_ZOOM_INDEX] * 3600000; // tracks the selected zoom level; shrinks further only for a genuinely partial buffer (spec §24)
  let ccChartTimer = 0;
  let ccGesture = null;
  let ccJustDragged = false;
  let ccFrozenYDomain = null;       // {low, high} — held fixed during an active drag, spec §17
  let ccRenderScheduled = false;
  let ccLastPlotRect = null;        // cached measurement, refreshed at gesture start
  let ccLastDrawBounds = null;      // {startMs, endMs, samples} — for tooltip hit-testing

  async function fetchChargeHistory(offset) {
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
      const response = await fetch(endpointUrl(`charge_history.json/${offset}`), { cache: "no-store", credentials: "same-origin", signal: controller.signal });
      if (!response.ok) return null;
      return await response.json();
    } catch (_) {
      return null;
    } finally { window.clearTimeout(timeout); }
  }

  // Human date-range formatting (spec §32/§33) — a bare "(+1d)" suffix
  // reads as developer/diagnostic notation, not a product surface. When
  // the range crosses a real calendar day, both ends get a short
  // localized date prefix instead ("3 вер 18:55 – 4 вер 00:55" /
  // "Sep 3, 18:55 – Sep 4, 00:55").
  function formatShortDate(ms) { return new Date(ms).toLocaleDateString(ccLocale(), { day: "numeric", month: "short" }); }
  function formatClockRange(startMs, endMs) {
    const opts = { hour: "2-digit", minute: "2-digit" };
    const sameDay = new Date(startMs).toDateString() === new Date(endMs).toDateString();
    const startText = new Date(startMs).toLocaleTimeString([], opts);
    const endText = new Date(endMs).toLocaleTimeString([], opts);
    if (sameDay) return `${startText} – ${endText}`;
    return `${formatShortDate(startMs)} ${startText} – ${formatShortDate(endMs)} ${endText}`;
  }
  function formatClockShort(ms) { return new Date(ms).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }); }
  function ccRound(ms) { return Math.round(ms / CC_INTERVAL_MS) * CC_INTERVAL_MS; }

  // Decode one /charge_history.json/<offset> response into the shared
  // ccSamples cache, keyed by real wall-clock time (see doc comment
  // above) rather than by offset — offset 0 also (re-)anchors the whole
  // cache's time reference, since it is always the freshest read of
  // "what is the newest sample right now."
  function ccMergeResponse(offset, data) {
    if (!data || !Array.isArray(data.voltage)) return false;
    const count = data.total_samples || 0;
    const windowSamples = data.window_samples || CC_WINDOW_SAMPLES;
    if (offset === 0) ccAnchor = { countAtAnchor: count, nowAtAnchorMs: Date.now() };
    if (!ccAnchor) return false; // offset>0 fetched before any offset=0 anchor exists — caller retries
    const windowEndP = count - 1 - offset * windowSamples;
    const n = data.voltage.length;
    for (let i = 0; i < n; i += 1) {
      const p = windowEndP - (n - 1 - i); // chronological position, 0 = oldest ever stored
      if (p < 0) continue;
      const tMs = ccRound(ccAnchor.nowAtAnchorMs - (ccAnchor.countAtAnchor - 1 - p) * CC_INTERVAL_MS);
      const v = data.voltage[i];
      const st = Array.isArray(data.stage) ? data.stage[i] : 0;
      ccSamples.set(tMs, { v: (v === null || !Number.isFinite(v)) ? null : v, stage: Number.isFinite(st) ? st : 0 });
    }
    ccCachedOffsets.add(offset);
    // Bound cache growth: drop anything older than the max retained
    // history (plus a small margin) so re-anchoring across a long
    // session can't grow this Map without limit.
    const floor = ccAnchor.nowAtAnchorMs - CC_MAX_HISTORY_MS - CC_INTERVAL_MS * 2;
    for (const key of ccSamples.keys()) if (key < floor) ccSamples.delete(key);
    return true;
  }

  function ccOffsetForTimeMs(timeMs) {
    if (!ccAnchor) return 0;
    const p = (ccAnchor.countAtAnchor - 1) - Math.round((ccAnchor.nowAtAnchorMs - timeMs) / CC_INTERVAL_MS);
    const offset = Math.floor(((ccAnchor.countAtAnchor - 1) - p) / CC_WINDOW_SAMPLES);
    return Math.max(0, Math.min(CC_MAX_OFFSET, offset));
  }

  async function ccFetchOffset(offset) {
    if (ccCachedOffsets.has(offset)) return true;
    if (ccFetchInFlight.has(offset)) return ccFetchInFlight.get(offset);
    const promise = fetchChargeHistory(offset).then((data) => ccMergeResponse(offset, data)).finally(() => ccFetchInFlight.delete(offset));
    ccFetchInFlight.set(offset, promise);
    return promise;
  }

  // Ensures the cache covers [startMs, endMs] — fetches offset 0 first
  // (bootstraps/refreshes ccAnchor) if it isn't cached yet, then any
  // other offsets the requested range actually touches. Never fetches
  // per pointermove (spec §27) — callers debounce/gate this themselves.
  async function ccEnsureRangeCached(startMs, endMs) {
    if (!ccAnchor || !ccCachedOffsets.has(0)) await ccFetchOffset(0);
    if (!ccAnchor) return false;
    const offsets = new Set([ccOffsetForTimeMs(startMs), ccOffsetForTimeMs(endMs)]);
    await Promise.all(Array.from(offsets).map((o) => ccFetchOffset(o)));
    return true;
  }

  function ccAvailableHistoryMs() {
    if (!ccAnchor) return 0;
    return Math.min(CC_MAX_HISTORY_MS, ccAnchor.countAtAnchor * CC_INTERVAL_MS);
  }
  function ccOldestAvailableMs() {
    if (!ccAnchor) return Date.now();
    return ccAnchor.nowAtAnchorMs - ccAvailableHistoryMs();
  }

  // Clamp + resolve the actual viewport bounds for this render: "follow
  // now" recomputes live every call; a manually-panned position clamps
  // to the available history so it can never show fake future or
  // fabricated pre-history (spec §4, §23, §24).
  function ccResolveViewport() {
    const nowMs = Date.now();
    const available = ccAvailableHistoryMs();
    ccWindowDurationMs = Math.min(ccTargetDurationMs(), Math.max(available, CC_INTERVAL_MS));
    let endMs = ccIsFollowingNow || ccViewportEndMs === null ? nowMs : ccViewportEndMs;
    const oldest = ccOldestAvailableMs();
    const minEnd = oldest + ccWindowDurationMs;
    if (endMs > nowMs) endMs = nowMs;
    if (endMs < minEnd) endMs = Math.min(minEnd, nowMs);
    return { startMs: endMs - ccWindowDurationMs, endMs };
  }

  function ccGetVisibleSamples(startMs, endMs) {
    const out = [];
    for (const [tMs, s] of ccSamples) if (tMs >= startMs - CC_INTERVAL_MS && tMs <= endMs + CC_INTERVAL_MS) out.push({ t: tMs, v: s.v, stage: s.stage });
    out.sort((a, b) => a.t - b.t);
    return out;
  }

  // Builds chronological, duration-proportional segments from the
  // buffer's own per-sample stage bytes (spec §46) — merges runs of the
  // identical code, clips to the viewport (spec §48), and (when the
  // window is following Now) extends the newest segment to the live
  // right edge rather than stopping at a sample that may be up to
  // CC_INTERVAL_MS stale (spec §10). Transition convention: the boundary
  // between two segments sits at the FIRST sample of the new state
  // (spec §47) — segments tile with zero gap, so the divider drawn at
  // that timestamp aligns exactly with both the strip and the graph.
  function buildStateSegments(samples, startMs, endMs, extendToMs) {
    const segments = [];
    for (const s of samples) {
      if (s.t < startMs || s.t > endMs) continue;
      if (segments.length && segments[segments.length - 1].stage === s.stage) {
        segments[segments.length - 1].endMs = s.t;
      } else {
        segments.push({ stage: s.stage, startMs: s.t, endMs: s.t });
      }
    }
    if (!segments.length) return segments;
    // Tile: each segment's rendered end reaches the next one's start.
    for (let i = 0; i < segments.length - 1; i += 1) segments[i].endMs = segments[i + 1].startMs;
    segments[0].startMs = Math.max(segments[0].startMs, startMs);
    const last = segments[segments.length - 1];
    last.endMs = extendToMs !== null ? Math.max(last.endMs, extendToMs) : Math.min(last.endMs + CC_INTERVAL_MS, endMs);
    last.endMs = Math.min(last.endMs, endMs);
    return segments;
  }

  function ccJumpToNow() {
    ccIsFollowingNow = true;
    ccViewportEndMs = null;
    ccFrozenYDomain = null;
    scheduleChargeCycleRender();
  }

  /* ---------- charge cycle: time-scale zoom (+/-) ----------
     Discrete presets only (spec §23): CC_ZOOM_LEVELS_H. Anchor behavior
     (spec §27) is the whole point of this being a dedicated function
     rather than just poking ccZoomIndex directly: following Now keeps
     the right edge pinned to Now (so the viewport just gets shorter/
     longer at the live edge, no jump); browsing history re-centers on
     the CURRENT viewport's own center, so zooming never snaps back to
     Now or to some other unrelated point. */
  function ccMaxZoomOutIndex() {
    const availH = ccAvailableHistoryMs() / 3600000;
    for (let i = 0; i < CC_ZOOM_LEVELS_H.length; i += 1) if (CC_ZOOM_LEVELS_H[i] >= availH) return i;
    return CC_ZOOM_LEVELS_H.length - 1;
  }
  function ccSetZoomIndex(nextIndex) {
    nextIndex = Math.max(0, Math.min(CC_ZOOM_LEVELS_H.length - 1, nextIndex));
    if (nextIndex === ccZoomIndex) { updateCcZoomControls(); return; }
    const before = ccResolveViewport();
    const wasFollowing = ccIsFollowingNow;
    ccZoomIndex = nextIndex;
    if (wasFollowing) {
      ccViewportEndMs = null; // stays following Now; ccResolveViewport recomputes width from the new target duration
    } else {
      const centerMs = (before.startMs + before.endMs) / 2;
      const newDuration = ccTargetDurationMs();
      const nowMs = Date.now();
      const minEnd = ccOldestAvailableMs() + Math.min(newDuration, ccAvailableHistoryMs());
      let nextEnd = Math.min(nowMs, Math.max(minEnd, centerMs + newDuration / 2));
      ccViewportEndMs = nextEnd;
      ccIsFollowingNow = nextEnd >= nowMs - CC_INTERVAL_MS;
    }
    ccFrozenYDomain = null;
    updateCcZoomControls();
    scheduleChargeCycleRender();
    const after = ccResolveViewport();
    ccEnsureRangeCached(after.startMs, after.endMs).then(() => scheduleChargeCycleRender());
  }
  function ccZoomIn() { ccSetZoomIndex(ccZoomIndex - 1); }
  function ccZoomOut() { ccSetZoomIndex(ccZoomIndex + 1); }
  function updateCcZoomControls() {
    const label = getDom("ccZoomLabel");
    if (label) label.textContent = tp("electrical.cc.hoursShort", CC_ZOOM_LEVELS_H[ccZoomIndex]);
    const inBtn = getDom("ccZoomIn"), outBtn = getDom("ccZoomOut");
    if (inBtn) inBtn.disabled = ccZoomIndex <= 0;
    if (outBtn) outBtn.disabled = ccZoomIndex >= ccMaxZoomOutIndex();
  }

  function scheduleChargeCycleRender() {
    if (ccRenderScheduled) return;
    ccRenderScheduled = true;
    window.requestAnimationFrame(() => { ccRenderScheduled = false; renderChargeCycleTimeline(); });
  }

  // Periodic tick (every CC_INTERVAL_MS, matching the sampler's own
  // cadence): force a fresh offset-0 read so ccAnchor and the newest
  // samples stay current, then re-render — renderChargeCycleTimeline()
  // itself decides whether the viewport actually moves (only if
  // isFollowingNow; a panned-into-history view holds still, spec §30).
  async function ccTick() {
    const panel = getDom("panel-electrical");
    if (!panel || !panel.classList.contains("active")) return;
    ccCachedOffsets.delete(0);
    await ccFetchOffset(0);
    scheduleChargeCycleRender();
  }

  // Main render: resolves the viewport, makes sure the cache covers it
  // (kicking off any missing fetch in the background — never blocking a
  // drag-frame render on a network round trip), then draws from
  // whatever IS cached right now. A frame drawn before a background
  // fetch resolves just shows a shorter/partial line at that edge; the
  // fetch's own completion re-schedules a render once it lands.
  async function renderChargeCycleTimeline() {
    const panel = getDom("panel-electrical");
    if (!panel || !panel.classList.contains("active")) return;
    if (!ccAnchor) { await ccEnsureRangeCached(Date.now() - ccTargetDurationMs(), Date.now()); scheduleChargeCycleRender(); return; }

    const { startMs, endMs } = ccResolveViewport();
    const needed = new Set([ccOffsetForTimeMs(startMs), ccOffsetForTimeMs(endMs)]);
    let mustRefetch = false;
    for (const o of needed) if (!ccCachedOffsets.has(o)) mustRefetch = true;
    if (mustRefetch) ccEnsureRangeCached(startMs, endMs).then(() => scheduleChargeCycleRender());

    const samples = ccGetVisibleSamples(startMs, endMs);
    ccDraw(startMs, endMs, samples);
  }

  function ccBuildYDomain(samples) {
    const vals = samples.map((s) => s.v).filter((v) => v !== null && Number.isFinite(v));
    if (!vals.length) return null;
    let min = Math.min.apply(null, vals), max = Math.max.apply(null, vals);
    let low = min - 0.01, high = max + 0.01;
    if (high - low < CC_MIN_SPAN_V) {
      const mid = (high + low) / 2;
      low = mid - CC_MIN_SPAN_V / 2; high = mid + CC_MIN_SPAN_V / 2;
    }
    return { low, high };
  }

  // Tick count adapts to both available width (mobile stays sparse) and
  // zoom duration (spec §31) — a wide zoomed-out 24h/60h view gets one
  // extra major tick so per-tick spacing stays in a readable range
  // rather than growing unboundedly with N fixed at 5.
  function ccPickXTicks(startMs, endMs) {
    const hours = (endMs - startMs) / 3600000;
    const count = window.innerWidth < 600 ? 3 : (hours >= 24 ? 6 : 5);
    const ticks = [];
    for (let i = 0; i < count; i += 1) ticks.push(startMs + (endMs - startMs) * (i / (count - 1)));
    return ticks;
  }

  // The one shared time->pixel mapping every horizontal element in this
  // feature is built from (spec §32): state strip, transitions, voltage
  // path, gap shading, x-axis ticks, tooltip hit-testing, overview rail.
  function ccXScale(startMs, endMs) {
    const span = (endMs - startMs) || 1;
    return (ms) => Math.max(0, Math.min(100, ((ms - startMs) / span) * 100));
  }

  /* ---------- charge cycle: visual-only smoothing/downsampling ----------
     ABSOLUTE RULE (spec §13): these functions never touch ccSamples, the
     backend, or anything read by the tooltip/diagnostics/Y-domain — they
     take an array, return a NEW array, and the only thing that ever
     reads their output is the SVG path string. Everywhere else in this
     file (ccGetVisibleSamples, ccBuildYDomain, ccShowTooltipAt,
     buildStateSegments) keeps reading raw `samples` untouched. */

  // Triangular weighted moving average (spec §15/§16) — weights taper
  // linearly from the center (e.g. windowSize=5 -> 1,2,3,2,1), which
  // removes single-sample jitter while tracking a real slope far more
  // faithfully than a flat/box average would. Window shrinks near the
  // ends of a run instead of reaching past it (spec §19: no fabricated
  // samples, no NaN, no time shift — every output point keeps its own
  // input timestamp).
  function ccTriangularSmooth(run, windowSize) {
    if (windowSize <= 1 || run.length < 3) return run;
    const half = Math.floor(windowSize / 2);
    const out = new Array(run.length);
    for (let i = 0; i < run.length; i += 1) {
      let sum = 0, wsum = 0;
      for (let k = -half; k <= half; k += 1) {
        const j = i + k;
        if (j < 0 || j >= run.length) continue;
        const w = half + 1 - Math.abs(k);
        sum += run[j].v * w; wsum += w;
      }
      out[i] = { t: run[i].t, v: sum / wsum };
    }
    return out;
  }

  // Min/max envelope downsampling (spec §17/§52/§53) — only engaged at
  // wide zoom levels (24h/60h) where rendering all ~1440-3600 raw points
  // would be wasteful. Buckets by time and keeps BOTH the min and max of
  // each bucket (in chronological order), so a real spike or dip that
  // falls inside a bucket still shows up as a real peak in the envelope
  // instead of being averaged into a flat line (spec: "do not simply
  // discard spikes blindly").
  function ccDownsampleEnvelope(run, bucketCount) {
    if (run.length <= bucketCount * 2) return run;
    const startT = run[0].t, span = (run[run.length - 1].t - run[0].t) || 1;
    const buckets = new Array(bucketCount);
    for (const s of run) {
      let idx = Math.floor(((s.t - startT) / span) * bucketCount);
      if (idx >= bucketCount) idx = bucketCount - 1; else if (idx < 0) idx = 0;
      const b = buckets[idx];
      if (!b) buckets[idx] = { min: s, max: s };
      else { if (s.v < b.min.v) b.min = s; if (s.v > b.max.v) b.max = s; }
    }
    const out = [];
    for (let i = 0; i < bucketCount; i += 1) {
      const b = buckets[i];
      if (!b) continue;
      const first = b.min.t <= b.max.t ? b.min : b.max, second = b.min.t <= b.max.t ? b.max : b.min;
      out.push(first);
      if (second !== first) out.push(second);
    }
    return out;
  }

  // Zoom -> smoothing-window mapping (spec §17). 24h/60h get downsampled
  // FIRST (so the smoothing pass runs on a few hundred envelope points,
  // not thousands of raw ones) then a light 3-point pass to soften the
  // envelope's own bucket-to-bucket jaggedness — not a big window on raw
  // data, which would blur real spikes the envelope just preserved.
  function ccSmoothingWindowFor(zoomHours) {
    if (zoomHours <= 3) return 3;
    if (zoomHours <= 6) return 5;
    if (zoomHours <= 12) return 7;
    return 3;
  }
  function ccNeedsDownsample(zoomHours) { return zoomHours >= 24; }

  // Local boundary-gradient background for one state segment (soft-
  // transition refinement pass). Each segment paints its OWN edges: at
  // a real boundary between two different, non-offline states, the
  // outer stop is the OKLCH midpoint of this segment's surface color
  // and the neighbor's — since both sides compute that same midpoint,
  // adjacent segments' gradients meet with an identical color exactly
  // at the shared boundary, giving one continuous blend rather than two
  // gradients guessing at each other. No neighbor (viewport edge) or a
  // neighbor that's Offline/Unknown (spec §16/§17 — never imply a smooth
  // transition across a real communication gap) falls back to a hard
  // edge: the stop is just this segment's own color, zero-width blend.
  // Blend width in real CSS px: targets a ~24-40px total transition
  // Shared MIN/MAX-style field geometry. Every coordinate is derived from
  // the current xScale output, so zoom, pan and responsive width changes
  // rebuild both the gradient and the contour from the visible durations.
  // Unlike MIN/MAX, operating states have no quantitative vertical level,
  // so their contour remains perfectly flat. Offline is still a hard gap.
  const CC_STATE_FIELD_Y = 1.5;
  function ccStateTransitionHalfPct(leftSeg, rightSeg, plotPxWidth) {
    const leftPx = (leftSeg._widthPct / 100) * plotPxWidth;
    const rightPx = (rightSeg._widthPct / 100) * plotPxWidth;
    // Make the color transition visually intentional rather than a thin
    // seam. It remains duration/viewport-aware and cannot consume more
    // than 38% of either neighboring segment on its side of the boundary.
    const totalPx = Math.max(18, Math.min(80, Math.min(leftPx, rightPx) * 0.7));
    return Math.min(leftSeg._widthPct * 0.38, rightSeg._widthPct * 0.38, (totalPx / plotPxWidth) * 50);
  }
  function ccStateGradientStops(segments, plotPxWidth, tokenMap) {
    const stops = [];
    const add = (pct, stage) => stops.push(`<stop offset="${Math.max(0, Math.min(100, pct)).toFixed(3)}%" stop-color="var(${tokenMap[stage]})"/>`);
    for (let i = 0; i < segments.length; i += 1) {
      const seg = segments[i];
      if (seg.stage === 5) continue;
      const prev = i > 0 ? segments[i - 1] : null;
      const next = i + 1 < segments.length ? segments[i + 1] : null;
      const start = seg._leftPct;
      const end = start + seg._widthPct;
      if (!prev || prev.stage === 5) add(start, seg.stage);
      if (next && next.stage !== 5) {
        const half = ccStateTransitionHalfPct(seg, next, plotPxWidth);
        add(end - half, seg.stage);
        add(end + half, next.stage);
      } else {
        add(end, seg.stage);
      }
    }
    return stops.join("");
  }
  function ccStateFieldPaths(segments, plotPxWidth) {
    let fill = "", contour = "";
    let i = 0;
    while (i < segments.length) {
      while (i < segments.length && segments[i].stage === 5) i += 1;
      if (i >= segments.length) break;
      const runStart = i;
      while (i + 1 < segments.length && segments[i + 1].stage !== 5) i += 1;
      const runEnd = i;
      const first = segments[runStart];
      const x0 = first._leftPct;
      const y0 = CC_STATE_FIELD_Y;
      let line = `M${x0.toFixed(3)},${y0.toFixed(2)}`;
      for (let j = runStart; j < runEnd; j += 1) {
        const left = segments[j], right = segments[j + 1];
        const boundary = left._leftPct + left._widthPct;
        const half = ccStateTransitionHalfPct(left, right, plotPxWidth);
        const leftY = CC_STATE_FIELD_Y;
        const rightY = CC_STATE_FIELD_Y;
        const xa = boundary - half, xb = boundary + half;
        line += ` L${xa.toFixed(3)},${leftY.toFixed(2)} C${boundary.toFixed(3)},${leftY.toFixed(2)} ${boundary.toFixed(3)},${rightY.toFixed(2)} ${xb.toFixed(3)},${rightY.toFixed(2)}`;
      }
      const last = segments[runEnd];
      const x1 = last._leftPct + last._widthPct;
      const y1 = CC_STATE_FIELD_Y;
      line += ` L${x1.toFixed(3)},${y1.toFixed(2)}`;
      contour += `${line} `;
      fill += `${line} L${x1.toFixed(3)},34 L${x0.toFixed(3)},34 Z `;
      i += 1;
    }
    return { fill: fill.trim(), contour: contour.trim() };
  }
  // Transition timestamps are structural guides, not state-colored data.
  // Every divider therefore uses the same neutral token as MIN/MAX.
  function ccStripTransitionColor() { return "var(--hair-strong)"; }

  function ccDraw(startMs, endMs, samples) {
    const emptyMsg = getDom("ccEmpty");
    const tlLine = getDom("tlLine"), tlArea = getDom("tlArea");
    const stripHost = getDom("ccSegHost"), transHost = getDom("ccTransitions"), stripTransHost = getDom("ccStripTransitions");
    const stateFillPath = getDom("ccStateFillPath"), stateDepthPath = getDom("ccStateDepthPath"), stateContourPath = getDom("ccStateContourPath");
    const stateFillGradient = getDom("ccStateFillGradient"), stateContourGradient = getDom("ccStateContourGradient");
    const gapGroup = getDom("ccGapGroup");
    setText("ccPeriod", formatClockRange(startMs, endMs));
    // Real, fresh measurement every render — not just cached at drag-start
    // (spec §7's "never clip text" depends on this being right the very
    // first time the chart paints, before any drag has ever happened).
    const plotField = getDom("ccPlotField");
    if (plotField) ccLastPlotRect = plotField.getBoundingClientRect();

    const validPts = samples.filter((s) => s.v !== null);
    if (validPts.length < 2) {
      if (tlLine) tlLine.setAttribute("d", "");
      if (tlArea) tlArea.setAttribute("d", "");
      if (gapGroup) gapGroup.innerHTML = "";
      if (transHost) transHost.innerHTML = "";
      if (stripHost) stripHost.innerHTML = "";
      if (stripTransHost) stripTransHost.innerHTML = "";
      if (stateFillPath) stateFillPath.setAttribute("d", "");
      if (stateDepthPath) stateDepthPath.setAttribute("d", "");
      if (stateContourPath) stateContourPath.setAttribute("d", "");
      if (emptyMsg) emptyMsg.hidden = false;
      setText("tlTop", "—"); setText("tlBottom", "—");
      const midElEmpty = getDom("tlMid"); if (midElEmpty) midElEmpty.textContent = "—";
      updateCcMeta(startMs, endMs);
      updateCcOverview(startMs, endMs);
      updateCcZoomControls();
      ccLastDrawBounds = { startMs, endMs, samples };
      return;
    }
    if (emptyMsg) emptyMsg.hidden = true;

    // Y-domain hysteresis (spec §17): frozen while a drag is actively in
    // progress so small pixel-level moves can't flicker the axis; a
    // fresh domain is computed on every non-drag render (load, live
    // tick, drag-release, keyboard/wheel step).
    const dragging = !!(ccGesture && ccGesture.decided && ccGesture.horizontal);
    let domain = dragging && ccFrozenYDomain ? ccFrozenYDomain : ccBuildYDomain(samples);
    if (!domain) domain = { low: 0, high: 1 };
    if (!dragging) ccFrozenYDomain = domain;

    const W = 600, H = 100;
    const xScale = ccXScale(startMs, endMs);
    const x = (ms) => (xScale(ms) / 100) * W;
    const y = (v) => H - ((v - domain.low) / ((domain.high - domain.low) || 1)) * H;

    // Split into contiguous non-null runs first — smoothing/downsampling
    // below is applied independently PER RUN and never crosses a gap
    // (spec §20) or fabricates a point between two runs. gapRects still
    // comes from the RAW samples array, not the processed runs.
    const runs = [];
    let currentRun = null;
    const gapRects = [];
    let gapStartMs = null;
    for (let i = 0; i < samples.length; i += 1) {
      const s = samples[i];
      if (s.v === null || !Number.isFinite(s.v)) {
        currentRun = null;
        if (gapStartMs === null) gapStartMs = i > 0 ? samples[i - 1].t : s.t;
        continue;
      }
      if (gapStartMs !== null) { gapRects.push([gapStartMs, s.t]); gapStartMs = null; }
      if (!currentRun) { currentRun = []; runs.push(currentRun); }
      currentRun.push(s);
    }
    if (gapStartMs !== null) gapRects.push([gapStartMs, samples[samples.length - 1].t]);

    const zoomHours = CC_ZOOM_LEVELS_H[ccZoomIndex];
    const smoothWindow = ccSmoothingWindowFor(zoomHours);
    const doDownsample = ccNeedsDownsample(zoomHours);
    const bucketBudget = Math.min(400, Math.max(120, Math.round(ccLastPlotRect ? ccLastPlotRect.width : 600)));

    let d = "";
    let firstX = null, lastX = null;
    for (const run of runs) {
      let processed = doDownsample ? ccDownsampleEnvelope(run, bucketBudget) : run;
      processed = ccTriangularSmooth(processed, smoothWindow);
      for (let i = 0; i < processed.length; i += 1) {
        const px = x(processed[i].t), py = y(processed[i].v);
        d += `${i === 0 ? "M" : "L"}${px.toFixed(1)},${py.toFixed(1)} `;
        if (firstX === null) firstX = px;
        lastX = px;
      }
    }
    if (tlLine) tlLine.setAttribute("d", d.trim());
    if (tlArea) tlArea.setAttribute("d", d ? `${d}L${lastX.toFixed(1)},${H} L${firstX.toFixed(1)},${H} Z` : "");

    // Visual data gap (spec §25) — a real communication outage shows as
    // an actual shaded void, not a line silently reconnecting across it.
    if (gapGroup) {
      let html = "";
      for (const [gs, ge] of gapRects) {
        if (ge - gs < CC_INTERVAL_MS * 1.5) continue; // a single missed sample isn't worth shading
        html += `<rect class="cc-gap-rect" x="${x(gs).toFixed(1)}" y="0" width="${Math.max(0, x(ge) - x(gs)).toFixed(1)}" height="${H}"/>`;
      }
      gapGroup.innerHTML = html;
    }

    setText("tlTop", domain.high.toFixed(2));
    const midEl = getDom("tlMid");
    if (midEl) midEl.textContent = ((domain.high + domain.low) / 2).toFixed(2);
    setText("tlBottom", domain.low.toFixed(2));

    // Extend the newest segment to the live edge only while genuinely
    // following Now — a manually-panned historical window must not
    // pretend a stale sample is still "ongoing."
    const extendTo = ccIsFollowingNow && endMs >= Date.now() - CC_INTERVAL_MS ? endMs : null;
    const segments = buildStateSegments(samples, startMs, endMs, extendTo);
    if (stripHost) {
      // Pass 1: resolve every segment's own left%/width% first — pass 2's
      // gradient needs to look at BOTH neighbors' widths, so all of them
      // must already be known before any single segment's background is
      // built (spec §7's per-segment px-width clamp reads real, final
      // widths, not values computed mid-loop for only one side).
      for (let i = 0; i < segments.length; i += 1) {
        const seg = segments[i];
        seg._leftPct = xScale(seg.startMs);
        seg._widthPct = Math.max(0, xScale(seg.endMs) - seg._leftPct);
      }
      const plotPxWidth = ccLastPlotRect ? ccLastPlotRect.width : 600;
      const statePaths = ccStateFieldPaths(segments, plotPxWidth);
      if (stateFillGradient) stateFillGradient.innerHTML = ccStateGradientStops(segments, plotPxWidth, CC_STAGE_SURFACE_VAR);
      if (stateContourGradient) stateContourGradient.innerHTML = ccStateGradientStops(segments, plotPxWidth, CC_STAGE_VIVID_VAR);
      if (stateFillPath) stateFillPath.setAttribute("d", statePaths.fill);
      // Same shape as the fill, not a separate geometry (matches
      // updateMinMaxFlow's depthEl) — a subtle top->bottom black-opacity
      // gradient over it for tonal depth, so Offline gaps, zoom and pan
      // automatically stay pixel-identical between fill and depth with
      // zero extra geometry logic.
      if (stateDepthPath) stateDepthPath.setAttribute("d", statePaths.fill);
      if (stateContourPath) stateContourPath.setAttribute("d", statePaths.contour);
      let html = "";
      for (let i = 0; i < segments.length; i += 1) {
        const seg = segments[i];
        const isCurrent = extendTo !== null && seg === segments[segments.length - 1];
        const label = ccStageShortName(seg.stage);
        // Hide the label rather than clip it (spec §7) — real canvas text
        // measurement (ccLabelWidthPx), not a per-character guess; a
        // narrow segment shows color only, full name still in the tooltip.
        const pxWidth = (seg._widthPct / 100) * plotPxWidth;
        const showLabel = pxWidth > ccLabelWidthPx(label) + 12;
        html += `<div class="cc-seg${isCurrent ? " current" : ""}" data-stage="${seg.stage}" data-seg-index="${i}" style="left:${seg._leftPct.toFixed(2)}%;width:${seg._widthPct.toFixed(2)}%">${showLabel ? `<span class="cc-seg-label">${escapeHtml(label)}</span>` : ""}</div>`;
      }
      stripHost.innerHTML = html;
    }
    // Transition dividers — only for boundaries that actually fall
    // inside the current viewport (spec §13); stale lines never persist
    // across a pan since this whole block is rebuilt from scratch.
    // Two hosts share the same boundary positions/colors (spec §32's
    // single-source-of-truth xScale still applies): the strip-internal
    // mark (stronger, richer local hue) and the existing guide line that
    // continues into the voltage plot (kept deliberately more
    // restrained — spec §15's hierarchy).
    if (transHost) {
      let html = "";
      for (let i = 1; i < segments.length; i += 1) {
        const at = xScale(segments[i].startMs);
        const color = ccStripTransitionColor(segments[i - 1].stage, segments[i].stage);
        html += `<div class="cc-transition-line" style="left:${at.toFixed(2)}%;border-left-color:${color}"></div>`;
      }
      transHost.innerHTML = html;
    }
    if (stripTransHost) {
      let html = "";
      for (let i = 1; i < segments.length; i += 1) {
        const at = xScale(segments[i].startMs);
        const color = ccStripTransitionColor(segments[i - 1].stage, segments[i].stage);
        html += `<div class="cc-strip-transition-line" style="left:${at.toFixed(2)}%;border-left-color:${color}"></div>`;
      }
      stripTransHost.innerHTML = html;
    }

    renderCcXAxis(startMs, endMs);
    updateCcMeta(startMs, endMs);
    updateCcOverview(startMs, endMs);
    updateCcZoomControls(); // available history grows as data loads/partial buffer fills — bounds must stay live, not just be set once at install time
    ccLastDrawBounds = { startMs, endMs, samples, segments, domain };
  }

  // Date context is attached to whichever tick actually crosses into a
  // new calendar day (not just the first one) — a wide 24h/60h zoom can
  // cross midnight more than once, and each crossing deserves its own
  // date, stacked under the time rather than a diagnostic "(+1d)" tag
  // (spec §32/§33).
  function renderCcXAxis(startMs, endMs) {
    const host = getDom("ccXAxis");
    if (!host) return;
    const xScale = ccXScale(startMs, endMs);
    const ticks = ccPickXTicks(startMs, endMs);
    let html = "";
    let lastDateStr = null;
    for (let i = 0; i < ticks.length; i += 1) {
      const ms = ticks[i];
      const dateStr = new Date(ms).toDateString();
      const showDate = dateStr !== lastDateStr;
      lastDateStr = dateStr;
      const timeLabel = formatClockShort(ms);
      const label = showDate ? `${timeLabel}<small>${formatShortDate(ms)}</small>` : timeLabel;
      const pct = xScale(ms);
      const align = i === 0 ? "left" : i === ticks.length - 1 ? "right" : "center";
      html += `<span class="cc-x-tick" data-align="${align}" style="left:${pct.toFixed(2)}%">${label}</span>`;
    }
    host.innerHTML = html;
  }

  // History honesty (spec §22-24, §44): states the REAL retained extent
  // (never a fake 60h before the buffer has actually filled that far)
  // together with the CURRENTLY SELECTED zoom duration — recomputed on
  // every render, so a +/- press updates this label immediately, not
  // just the chart geometry.
  function updateCcMeta(startMs, endMs) {
    const host = getDom("ccMeta");
    if (!host) return;
    const availableH = Math.round(ccAvailableHistoryMs() / 3600000);
    const totalH = ccAvailableHistoryMs() / 3600000 < 59.5 ? Math.max(1, availableH) : 60;
    const windowH = CC_ZOOM_LEVELS_H[ccZoomIndex];
    host.textContent = tp("electrical.cc.metaWindow", totalH, { window: windowH });
    const nowBtn = getDom("ccNowBtn");
    if (nowBtn) nowBtn.hidden = ccIsFollowingNow;
  }

  // Overview rail endpoint labels (spec §42) — honest about how far back
  // real data actually goes, same rule as updateCcMeta: never claims 60h
  // before the buffer has filled that far.
  function updateCcOverview(startMs, endMs) {
    const windowEl = getDom("ccOverviewWindow");
    if (!windowEl) return;
    const totalMs = Math.max(ccAvailableHistoryMs(), ccWindowDurationMs);
    const oldest = ccOldestAvailableMs();
    const left = Math.max(0, Math.min(100, ((startMs - oldest) / totalMs) * 100));
    const width = Math.max(2, Math.min(100 - left, ((endMs - startMs) / totalMs) * 100));
    windowEl.style.left = `${left.toFixed(2)}%`;
    windowEl.style.width = `${width.toFixed(2)}%`;
    const oldestLabel = getDom("ccOverviewOldest");
    if (oldestLabel) oldestLabel.textContent = tp("electrical.cc.agoShort", Math.max(1, Math.round(totalMs / 3600000)));
  }

  /* ---------- charge cycle: crosshair + tooltip (spec §2-11, §33, §34) ----------
     Crosshair, point marker, tooltip and the (optional) hover-segment
     emphasis are all driven from the SAME resolved sample/segment index
     (spec §4/§9) — there is exactly one lookup per pointer move, and
     every visual reads off its result, so none of these can ever show a
     different moment than the others. The marker sits at the RAW
     sample's own Y position (never the smoothed line's), since the
     tooltip next to it always reads the raw value too (spec §18). */
  function ccHideTooltip() {
    const tip = getDom("ccTooltip"); if (tip) tip.hidden = true;
    const line = getDom("ccCrosshair"); if (line) line.hidden = true;
    const dot = getDom("ccCrosshairDot"); if (dot) dot.hidden = true;
    ccSetHoverSegment(null);
  }
  function ccSetHoverSegment(segIndex) {
    const strip = getDom("ccStateStrip");
    if (!strip) return;
    strip.querySelectorAll(".cc-seg.hover").forEach((el) => el.classList.remove("hover"));
    if (segIndex === null) return;
    const el = strip.querySelector(`.cc-seg[data-seg-index="${segIndex}"]`);
    if (el) el.classList.add("hover");
  }
  function ccShowTooltipAt(clientX, plotRect) {
    const tip = getDom("ccTooltip");
    if (!tip || !ccLastDrawBounds) return;
    const { startMs, endMs, samples, segments, domain } = ccLastDrawBounds;
    const frac = Math.max(0, Math.min(1, (clientX - plotRect.left) / plotRect.width));
    const atMs = startMs + frac * (endMs - startMs);
    // Near a transition (within ~1.2% of plot width) — show the
    // transition tooltip instead of a point reading (spec §34).
    if (segments && segments.length > 1) {
      for (let i = 1; i < segments.length; i += 1) {
        const tPct = ccXScale(startMs, endMs)(segments[i].startMs);
        if (Math.abs(tPct - frac * 100) < 1.2) {
          tip.innerHTML = `<b>${formatClockShort(segments[i].startMs)}</b><span>${escapeHtml(ccStageShortName(segments[i - 1].stage))} → ${escapeHtml(ccStageShortName(segments[i].stage))}</span>`;
          positionCrosshair(tPct, null);
          positionTooltip(tip, tPct / 100, plotRect, null);
          ccSetHoverSegment(i);
          return;
        }
      }
    }
    // Otherwise: nearest RAW sample — snap the crosshair to it (spec §4),
    // never to the raw pointer X, so tooltip/crosshair/marker/state can
    // never drift apart from each other.
    let nearest = null, nearestDelta = Infinity;
    for (const s of samples) { const delta = Math.abs(s.t - atMs); if (delta < nearestDelta) { nearestDelta = delta; nearest = s; } }
    if (!nearest || nearest.v === null) { ccHideTooltip(); return; }
    const snappedPct = ccXScale(startMs, endMs)(nearest.t);
    const span = domain ? (domain.high - domain.low) || 1 : 1;
    const yPct = domain ? Math.max(0, Math.min(100, 100 - ((nearest.v - domain.low) / span) * 100)) : 50;
    tip.innerHTML = `<b>${formatClockShort(nearest.t)} · ${nearest.v.toFixed(2)} ${unitLabel("V")}</b><span class="cc-tooltip-state">${escapeHtml(ccStageName(nearest.stage))}</span>`;
    positionCrosshair(snappedPct, yPct);
    positionTooltip(tip, snappedPct / 100, plotRect, yPct);
    let segIndex = null;
    if (segments) for (let i = 0; i < segments.length; i += 1) if (nearest.t >= segments[i].startMs && nearest.t <= segments[i].endMs) { segIndex = i; break; }
    ccSetHoverSegment(segIndex);
  }
  function positionCrosshair(xPct, yPct) {
    const line = getDom("ccCrosshair");
    if (line) { line.hidden = false; line.style.left = `${xPct.toFixed(2)}%`; }
    const dot = getDom("ccCrosshairDot");
    if (dot) {
      if (yPct === null) { dot.hidden = true; }
      else { dot.hidden = false; dot.style.left = `${xPct.toFixed(2)}%`; dot.style.top = `${yPct.toFixed(2)}%`; }
    }
  }
  // Compact (spec §45) + edge-aware (spec §10): flips horizontally past
  // the plot's own left/right edges, and flips vertically to whichever
  // side of the marker has room, so it never clips the viewport or
  // sits directly on top of the trace it's describing.
  function positionTooltip(tip, frac, plotRect, yPct) {
    tip.hidden = false;
    const clampedFrac = Math.max(0.04, Math.min(0.96, frac));
    tip.style.left = `${(clampedFrac * 100).toFixed(2)}%`;
    tip.style.transform = clampedFrac > 0.5 ? "translateX(-100%)" : "translateX(0)";
    const pointIsHigh = yPct !== null && yPct < 50;
    tip.classList.toggle("pos-bottom", pointIsHigh);
    tip.classList.toggle("pos-top", !pointIsHigh);
  }

  /* ---------- charge cycle: continuous pan (drag / swipe / wheel / keyboard) ----------
     Buttons are gone entirely (spec). One pointer-event path covers both
     mouse-drag and touch-swipe (setPointerCapture works for both). Every
     move re-renders directly from the already-cached samples — no
     network request per pointermove (spec §27, §55); rAF-throttled via
     scheduleChargeCycleRender() so a burst of pointermove events collapses
     to at most one render per frame. The viewport end lands at whatever
     arbitrary timestamp the drag stops at (spec §29 — no snapping to 6h
     blocks); isFollowingNow is set false the moment the user pans away
     from the live edge and only returns true at the live edge or via
     ccJumpToNow() (spec §30, §31). */
  function installChargeCycleTimeline() {
    const area = getDom("ccDragArea");
    if (!area) return;
    const DECIDE_PX = 10;
    function onDown(event) {
      if (event.pointerType === "mouse" && event.button !== 0) return;
      const rect = getDom("ccPlotField").getBoundingClientRect();
      ccLastPlotRect = rect;
      const bounds = ccResolveViewport();
      ccGesture = {
        startX: event.clientX, startY: event.clientY, dx: 0, decided: false, horizontal: false,
        pointerId: event.pointerId, pointerType: event.pointerType, startViewportEndMs: bounds.endMs, plotWidth: rect.width || 1
      };
    }
    function applyDx(dx) {
      if (!ccGesture) return;
      const pxPerMs = ccGesture.plotWidth / ccWindowDurationMs;
      const deltaMs = -dx / pxPerMs; // drag right = reveal older content (spec convention)
      let nextEnd = ccGesture.startViewportEndMs + deltaMs;
      const nowMs = Date.now();
      const minEnd = ccOldestAvailableMs() + ccWindowDurationMs;
      if (nextEnd > nowMs) nextEnd = nowMs + (nextEnd - nowMs) * 0.25; // light rubber-band, spec §4/§27 boundary feel
      if (nextEnd < minEnd) nextEnd = minEnd - (minEnd - nextEnd) * 0.25;
      ccViewportEndMs = nextEnd;
      ccIsFollowingNow = nextEnd >= nowMs - CC_INTERVAL_MS;
      scheduleChargeCycleRender();
    }
    function onMove(event) {
      if (!ccGesture || event.pointerId !== ccGesture.pointerId) return;
      const dx = event.clientX - ccGesture.startX, dy = event.clientY - ccGesture.startY;
      ccGesture.dx = dx;
      if (!ccGesture.decided) {
        if (Math.abs(dx) < DECIDE_PX && Math.abs(dy) < DECIDE_PX) return;
        ccGesture.decided = true;
        ccGesture.horizontal = Math.abs(dx) > Math.abs(dy);
        if (ccGesture.horizontal) { try { area.setPointerCapture(event.pointerId); } catch (_) { /* already released */ } area.classList.add("dragging"); ccHideTooltip(); }
      }
      if (!ccGesture.horizontal) return;
      event.preventDefault();
      applyDx(dx);
    }
    function endGesture(commit, event) {
      if (!ccGesture) return;
      const wasHorizontal = ccGesture.decided && ccGesture.horizontal;
      const wasUndecided = !ccGesture.decided;
      const dx = ccGesture.dx;
      const pointerType = ccGesture.pointerType;
      area.classList.remove("dragging");
      // Settle out of the rubber-band zone and re-enable Y hysteresis to
      // recompute fresh — a real "settle" pass rather than a snap.
      if (wasHorizontal) {
        const bounds = ccResolveViewport();
        ccViewportEndMs = bounds.endMs;
        ccIsFollowingNow = bounds.endMs >= Date.now() - CC_INTERVAL_MS;
      }
      ccGesture = null;
      ccFrozenYDomain = null;
      if (commit && wasHorizontal && Math.abs(dx) >= 3) {
        // A completed drag fires a native click right after pointerup —
        // swallow it so a pan can never be mistaken for a tap-through.
        ccJustDragged = true;
        window.setTimeout(() => { ccJustDragged = false; }, 80);
      }
      // Touch has no hover — a genuine stationary tap (never crossed the
      // pan-intent threshold) is the touch equivalent of desktop hover,
      // so show the crosshair/tooltip right where the finger lifted
      // (spec §11). A real drag never reaches here since wasUndecided
      // would be false by the time enough movement occurred to pan.
      if (commit && wasUndecided && pointerType === "touch" && event) {
        const rect = getDom("ccPlotField").getBoundingClientRect();
        ccShowTooltipAt(event.clientX, rect);
      }
      scheduleChargeCycleRender();
    }
    area.addEventListener("pointerdown", onDown);
    area.addEventListener("pointermove", onMove);
    area.addEventListener("pointerup", (event) => endGesture(true, event));
    area.addEventListener("pointercancel", () => endGesture(false));
    // Trackpad horizontal scroll (spec §3, optional) — only when the
    // horizontal component clearly dominates, so normal vertical page
    // scroll over the chart is untouched.
    area.addEventListener("wheel", (event) => {
      if (Math.abs(event.deltaX) <= Math.abs(event.deltaY)) return;
      event.preventDefault();
      const rect = getDom("ccPlotField").getBoundingClientRect();
      const pxPerMs = rect.width / ccWindowDurationMs;
      const bounds = ccResolveViewport();
      let nextEnd = bounds.endMs + event.deltaX / pxPerMs;
      const nowMs = Date.now();
      nextEnd = Math.min(nowMs, Math.max(ccOldestAvailableMs() + ccWindowDurationMs, nextEnd));
      ccViewportEndMs = nextEnd;
      ccIsFollowingNow = nextEnd >= nowMs - CC_INTERVAL_MS;
      scheduleChargeCycleRender();
    }, { passive: false });
    // Keyboard: continuous stepping, not block pagination (spec §3) —
    // 30 minutes per press is a documented, chosen step size, not a jump
    // to the next fixed 6h boundary.
    const KEY_STEP_MS = 30 * 60 * 1000;
    area.addEventListener("keydown", (event) => {
      if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
      event.preventDefault();
      const bounds = ccResolveViewport();
      const nowMs = Date.now();
      let nextEnd = bounds.endMs + (event.key === "ArrowRight" ? KEY_STEP_MS : -KEY_STEP_MS);
      nextEnd = Math.min(nowMs, Math.max(ccOldestAvailableMs() + ccWindowDurationMs, nextEnd));
      ccViewportEndMs = nextEnd;
      ccIsFollowingNow = nextEnd >= nowMs - CC_INTERVAL_MS;
      ccFrozenYDomain = null;
      scheduleChargeCycleRender();
    });
    // Hover/tap inspection (spec §33) — suppressed while a horizontal
    // drag is in progress so the tooltip doesn't fight the pan.
    area.addEventListener("pointermove", (event) => {
      if (ccGesture && ccGesture.decided && ccGesture.horizontal) return;
      const rect = getDom("ccPlotField").getBoundingClientRect();
      ccShowTooltipAt(event.clientX, rect);
    });
    area.addEventListener("pointerleave", ccHideTooltip);
    area.addEventListener("click", (event) => { if (ccJustDragged) event.stopPropagation(); });

    const nowBtn = getDom("ccNowBtn");
    if (nowBtn) nowBtn.addEventListener("click", ccJumpToNow);

    const zoomInBtn = getDom("ccZoomIn"), zoomOutBtn = getDom("ccZoomOut");
    if (zoomInBtn) zoomInBtn.addEventListener("click", ccZoomIn);
    if (zoomOutBtn) zoomOutBtn.addEventListener("click", ccZoomOut);
    updateCcZoomControls();

    // Overview rail: optional lightweight click-to-jump (spec §21) — the
    // small window indicator itself isn't independently draggable, only
    // clickable, to keep this cheap; the mandatory interaction is the
    // main chart drag above.
    const rail = getDom("ccOverviewRail");
    if (rail) {
      rail.addEventListener("click", (event) => {
        const rect = rail.getBoundingClientRect();
        const frac = Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width));
        const totalMs = Math.max(ccAvailableHistoryMs(), ccWindowDurationMs);
        const atMs = ccOldestAvailableMs() + frac * totalMs;
        const nowMs = Date.now();
        let nextEnd = Math.min(nowMs, Math.max(ccOldestAvailableMs() + ccWindowDurationMs, atMs + ccWindowDurationMs / 2));
        ccViewportEndMs = nextEnd;
        ccIsFollowingNow = nextEnd >= nowMs - CC_INTERVAL_MS;
        ccFrozenYDomain = null;
        scheduleChargeCycleRender();
      });
    }
  }

  /* ---------- wire up all the click/tap interactions ---------- */
  function installInteractions() {
    document.querySelectorAll(".rail [data-panel]").forEach((b) => b.addEventListener("click", () => activateTab(b.dataset.panel)));

    document.body.addEventListener("click", (event) => {
      // A completed Charge Cycle drag/swipe fires a native click right
      // after pointerup — swallow it so a drag can never be mistaken for
      // a tap-through interaction on whatever sits under the chart.
      if (ccJustDragged && event.target.closest("#ccDragArea")) return;
      const registerBtn = event.target.closest("button[data-register-write]");
      if (registerBtn) { submitRegisterSetting(registerBtn.dataset.registerWrite, registerBtn); return; }
      // Register permissions use an armed two-tap toggle. First tap shows
      // “Confirm?” in amber; second tap performs the write + read-back.
      const registerToggle = event.target.closest("button[data-register-toggle]");
      if (registerToggle) { toggleRegisterPermission(registerToggle); return; }
      // Overview's read-only status pills and health-synthesis tiles are
      // deep links, not controls. Output permissions open Configuration,
      // the single place where those registers can be changed.
      const linkBtn = event.target.closest("[data-panel-link]");
      if (linkBtn) {
        activateTab(linkBtn.dataset.panelLink);
        const settingKey = linkBtn.dataset.settingLink;
        if (settingKey) {
          window.requestAnimationFrame(() => {
            const setting = document.getElementById(`reg_${settingKey}`);
            if (!setting) return;
            setting.scrollIntoView({ block: "center", inline: "nearest" });
            setting.focus({ preventScroll: true });
          });
        }
        return;
      }
      // Every element that advertises "tap for its trend" — cells, pack
      // metrics, temperature tiles — opens through this ONE delegated
      // handler keyed off data-metric/data-cell, not a per-tile listener
      // bound once at build time (fragile: a class rename elsewhere in
      // the file silently detaches every one of these with no error,
      // which is exactly what happened here before this fix — the
      // handler was still querying the old ".metric" class after the
      // tiles were renamed to ".telemetry-item").
      const metricBtn = event.target.closest("[data-metric]");
      if (metricBtn) { openMetricHistory(metricBtn.dataset.metric); return; }
      const cellBtn = event.target.closest("[data-cell-index]");
      if (cellBtn) { openCellHistory(Number(cellBtn.dataset.cellIndex)); return; }
    });

    document.querySelectorAll("#cellSegment button").forEach((b) => b.addEventListener("click", () => setCellMode(b.dataset.mode)));

    document.getElementById("panel-configuration").addEventListener("input", (event) => {
      const input = event.target;
      if (input instanceof HTMLInputElement || input instanceof HTMLSelectElement) { input.dataset.dirty = "true"; input.classList.remove("invalid"); }
    });
    document.getElementById("panel-configuration").addEventListener("focusout", () => {
      // Let a click on the row's OK button complete before checking whether
      // focus truly left an editor. This safely applies any telemetry update
      // held back during text entry without interrupting a save action.
      window.setTimeout(() => {
        if (!diagnosticReadoutRebuildDeferred) return;
        const list = getDom("configRegisterList");
        if (document.activeElement instanceof HTMLInputElement && list?.contains(document.activeElement)) return;
        diagnosticReadoutRebuildDeferred = false;
        if (!diagnosticReadoutRebuild) diagnosticReadoutRebuild = window.requestAnimationFrame(renderDiagnosticPanels);
      }, 0);
    });

    document.getElementById("settingsBtn").addEventListener("click", openSettings);
    document.getElementById("settingsClose").addEventListener("click", closeSettings);
    document.getElementById("settingsOverlay").addEventListener("click", (e) => { if (e.target.id === "settingsOverlay") closeSettings(); });

    cellOverlay = document.getElementById("cellOverlay");
    cellModalTitle = document.getElementById("cellModalTitle");
    cellModalValue = document.getElementById("cellModalValue");
    cellModalUnit = document.getElementById("cellModalUnit");
    cellModalSegment = document.getElementById("cellModalSegment");

    document.querySelectorAll(".trace-stats [data-stat]").forEach((btn) => btn.addEventListener("click", () => {
      const suffix = cellMode === "v" ? "Voltage" : "Resistance";
      openMetricHistory(btn.dataset.stat + suffix);
    }));
    document.getElementById("cellModalClose").addEventListener("click", closeCellHistory);
    installChargeCycleTimeline();
    cellOverlay.addEventListener("click", (e) => { if (e.target === cellOverlay) closeCellHistory(); });
    document.querySelectorAll("#cellModalSegment button").forEach((b) => b.addEventListener("click", () => {
      document.querySelectorAll("#cellModalSegment button").forEach((x) => x.classList.remove("active"));
      b.classList.add("active");
      historyContext.mode = b.dataset.mode;
      drawHistory();
    }));

    document.addEventListener("keydown", (e) => {
      if (e.key !== "Escape") return;
      if (!getDom("cellOverlay").hidden) closeCellHistory();
      else if (!getDom("settingsOverlay").hidden) closeSettings();
    });

    let timelineResizeTimer;
    window.addEventListener("resize", () => {
      clearTimeout(timelineResizeTimer);
      timelineResizeTimer = setTimeout(() => {
        const electricalPanel = getDom("panel-electrical");
        if (electricalPanel && electricalPanel.classList.contains("active")) { drawTimeline(); ccLastPlotRect = null; renderChargeCycleTimeline(); }
      }, 100);
    });
  }

  // Native EventSource auto-retries forever and never reports a terminal
  // "gave up" state — a single error is usually just a blip, so the banner
  // only escalates wording from "reconnecting" to "disconnected" once the
  // link has stayed down long enough to actually mean something to a
  // person looking at the screen.
  const DISCONNECTED_ESCALATION_MS = 8000;
  let disconnectEscalateTimer = 0;

  function connect() {
    if (!staleSweepTimer) staleSweepTimer = window.setInterval(sweepDiagnosticStaleness, STALE_SWEEP_INTERVAL_MS);
    eventSource = new EventSource(endpointUrl("events"));
    eventSource.onopen = () => {
      if (disconnectEscalateTimer) { window.clearTimeout(disconnectEscalateTimer); disconnectEscalateTimer = 0; }
      everConnected = true;
      setBrowserLink("connected");
    };
    eventSource.onerror = () => {
      setBrowserLink(everConnected ? "reconnecting" : "connecting");
      if (!disconnectEscalateTimer) {
        disconnectEscalateTimer = window.setTimeout(() => {
          disconnectEscalateTimer = 0;
          if (browserLink === "reconnecting" || browserLink === "connecting") setBrowserLink("disconnected");
        }, DISCONNECTED_ESCALATION_MS);
      }
    };
    eventSource.onmessage = ingestEvent;
    eventSource.addEventListener("state", ingestEvent);
    eventSource.addEventListener("sensor", ingestEvent);
    eventSource.addEventListener("binary_sensor", ingestEvent);
    eventSource.addEventListener("text_sensor", ingestEvent);
    eventSource.addEventListener("text", ingestEvent);
    eventSource.addEventListener("select", ingestEvent);
    eventSource.addEventListener("number", ingestEvent);
  }

  function shutdown() {
    if (eventSource) { eventSource.close(); eventSource = null; }
    if (frameRequest) { window.cancelAnimationFrame(frameRequest); frameRequest = 0; }
    if (historyTimer) { window.clearInterval(historyTimer); historyTimer = 0; }
    if (ccChartTimer) { window.clearInterval(ccChartTimer); ccChartTimer = 0; }
    if (staleSweepTimer) { window.clearInterval(staleSweepTimer); staleSweepTimer = 0; }
  }

  function start() {
    try { build(); connect(); }
    catch (error) {
      const message = error && error.message ? error.message : String(error);
      document.body.innerHTML = `<pre class="fatal-error">JK BMS UI ${UI_VERSION}\n${escapeHtml(message)}</pre>`;
    }
  }

  // Stage 1 hardware acceptance corrective pass: a narrow, opt-in escape
  // hatch so a Node test can exercise the REAL entity-routing closures
  // (registerEntity/entityByWireId/ingestPayload/numeric) end to end --
  // exactly what renderCells() itself calls -- instead of a separate
  // reimplementation of the same resolution algorithm (see
  // test/protocol_catalog/test_wire_object_id_aliases.js, written against
  // this hook after the cell_resistance_1..16 alias bug it found). Inert
  // in every real browser: window.__JK_BMS_TEST_HOOKS__ is never set
  // there, so this branch never runs and build()/connect() always fire
  // exactly as before. Only the closures below are exposed; no DOM
  // rendering or network I/O is invoked in this path.
  if (window.__JK_BMS_TEST_HOOKS__) {
    Object.assign(window.__JK_BMS_TEST_HOOKS__, {
      registerEntity, entityByWireId, ingestPayload, numeric,
      cellResistanceKeys, cellVoltageKeys, PROTOCOL_CATALOG,
      // Stage 1 hardware acceptance retest (scroll-reset defect fix):
      // exposed read-only for test/protocol_catalog/test_diagnostic_software_variables_scroll.js
      // to verify the real render path's DOM-node-reuse/scroll-preservation
      // behavior -- not a reimplementation, the same closures build() itself calls.
      renderDiagnosticSoftwareVariables, diagSoftwareVarRows, diagnosticReadoutRows,
      getDom,
      // Settings/Diagnostics channel-hiding fix (user-reported defect,
      // 2026-09-17): exposed read-only for
      // test/protocol_catalog/test_diagnostic_cell_channel_hiding.js to
      // verify the REAL renderDiagnosticReadouts() render path -- the
      // same closure recordDiagnosticReadout()'s own rAF path and the
      // display_cell_count bind() both call -- not a reimplementation.
      renderDiagnosticReadouts,
      // Routing/duplication fix (2026-09-17) retest: exposed read-only for
      // test/protocol_catalog/test_exact_decimal_companion_routing.js to
      // verify the real ingestPayload()/registerEntity() closures against
      // both wire-id resolution (state[]) and diagnostic-row creation
      // (diagnosticReadouts) -- not a reimplementation.
      state, diagnosticReadouts, LEGACY_COMPANION_SUPPRESSED,
      // Cell-channel batch, user-directed rework (2026-09-17): exposed
      // read-only for test/protocol_catalog/test_cell_channel_frontend.js
      // to verify the real activeCellCount()/topologyState() closures --
      // the exact functions renderCells() itself calls to decide how many
      // card slots are shown vs hidden -- not a reimplementation.
      activeCellCount, topologyState, MAX_CELL_COUNT,
      // Stage 4 production-integration gap fix (2026-09-21): exposed
      // read-only for test/protocol_catalog/test_write_registry_ui.js to
      // verify the REAL renderWriteRegistry()/submitRegisterWrite()/
      // relocalizeWriteRegistry()/setLanguage() render path and catalog
      // contents against WRITE_REGISTRY (generated by
      // build_stage4_rw_inventory.js) -- not a reimplementation.
      renderWriteRegistry, submitRegisterWrite, WRITE_REGISTRY,
      relocalizeWriteRegistry, setLanguage, activeTransactionKeys,
    });
    return;
  }

  window.addEventListener("pagehide", shutdown, { once: true });
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start, { once: true });
  else start();
})();
