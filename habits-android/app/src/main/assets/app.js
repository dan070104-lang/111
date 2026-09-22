(function () {
  "use strict";

  var STORAGE_KEY = "habitsTrackerV1";
  var DOW_LABELS = ["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"];
  var ALL_DOW = [0, 1, 2, 3, 4, 5, 6];

  // ---------- date helpers ----------

  function pad2(n) { return n < 10 ? "0" + n : "" + n; }

  function toDateStr(d) {
    return d.getFullYear() + "-" + pad2(d.getMonth() + 1) + "-" + pad2(d.getDate());
  }

  function todayStr() { return toDateStr(new Date()); }

  function parseDateStr(s) { return new Date(s + "T00:00:00"); }

  function dowMon0(dateStr) {
    var js = parseDateStr(dateStr).getDay(); // 0=Sun..6=Sat
    return js === 0 ? 6 : js - 1; // 0=Mon..6=Sun
  }

  function daysInMonth(year, monthIndex0) {
    return new Date(year, monthIndex0 + 1, 0).getDate();
  }

  function monthLabel(year, monthIndex0) {
    var names = ["январь", "февраль", "март", "апрель", "май", "июнь",
      "июль", "август", "сентябрь", "октябрь", "ноябрь", "декабрь"];
    return names[monthIndex0] + " " + year;
  }

  // ---------- state ----------

  function uid() {
    return "h" + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  }

  function defaultState() {
    var today = todayStr();
    function habit(name, category, perDayCount, slotLabels) {
      return {
        id: uid(),
        name: name,
        category: category || "",
        notes: "",
        archivedAt: null,
        periods: [{
          id: uid(),
          from: today,
          to: null,
          perDayCount: perDayCount,
          slotLabels: slotLabels || null,
          daysOfWeek: ALL_DOW.slice()
        }]
      };
    }
    return {
      habits: [
        habit("Упражнения для глаз", "Здоровье", 3, null),
        habit("Медитация (утро, большая)", "Ментальное здоровье", 1, ["Утро"]),
        habit("Медитация (вечер, маленькая)", "Ментальное здоровье", 1, ["Вечер"]),
        habit("Медитация перед сном", "Ментальное здоровье", 1, ["Ночь"]),
        habit("Физупражнения", "Здоровье", 1, null),
        habit("Здоровое питание", "Питание", 1, null)
      ],
      completions: {}
    };
  }

  var state = load();
  var storageBroken = false;

  function load() {
    try {
      var raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return defaultState();
      var parsed = JSON.parse(raw);
      if (!parsed || !parsed.habits) return defaultState();
      if (!parsed.completions) parsed.completions = {};
      return parsed;
    } catch (e) {
      return defaultState();
    }
  }

  // localStorage can throw (Safari blocks it for file:// pages, private-mode
  // quotas, etc). Never let that abort an in-progress action: catch it, warn
  // once, and keep going with in-memory state so clicks still take effect.
  function save() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch (e) {
      if (!storageBroken) {
        storageBroken = true;
        showStorageWarning();
      }
    }
  }

  function showStorageWarning() {
    var el = document.getElementById("storage-warning");
    if (el) el.hidden = false;
  }

  (function checkStorageAvailable() {
    try {
      var testKey = STORAGE_KEY + "_test";
      localStorage.setItem(testKey, "1");
      localStorage.removeItem(testKey);
    } catch (e) {
      storageBroken = true;
      showStorageWarning();
    }
  })();

  // ---------- habit schedule logic ----------

  function getActivePeriod(habit, dateStr) {
    var best = null;
    for (var i = 0; i < habit.periods.length; i++) {
      var p = habit.periods[i];
      if (p.from <= dateStr && (!p.to || dateStr <= p.to)) {
        if (!best || p.from > best.from) best = p;
      }
    }
    return best;
  }

  function getExpectedCount(habit, dateStr) {
    if (habit.archivedAt && dateStr > habit.archivedAt) return 0;
    var period = getActivePeriod(habit, dateStr);
    if (!period) return 0;
    var dow = period.daysOfWeek && period.daysOfWeek.length ? period.daysOfWeek : ALL_DOW;
    if (dow.indexOf(dowMon0(dateStr)) === -1) return 0;
    return period.perDayCount;
  }

  function getCompletedSlots(habitId, dateStr) {
    var byHabit = state.completions[habitId];
    if (!byHabit) return [];
    return byHabit[dateStr] || [];
  }

  function toggleSlot(habitId, dateStr, slotIndex) {
    if (!state.completions[habitId]) state.completions[habitId] = {};
    var arr = state.completions[habitId][dateStr] || [];
    var idx = arr.indexOf(slotIndex);
    if (idx === -1) arr.push(slotIndex); else arr.splice(idx, 1);
    state.completions[habitId][dateStr] = arr;
    save();
  }

  function periodSummary(period) {
    var freq = period.slotLabels && period.slotLabels.length
      ? period.slotLabels.join(", ")
      : period.perDayCount + "×/день";
    var dow = period.daysOfWeek && period.daysOfWeek.length && period.daysOfWeek.length < 7
      ? " · " + period.daysOfWeek.slice().sort().map(function (d) { return DOW_LABELS[d]; }).join(",")
      : " · все дни";
    var range = " · с " + period.from + (period.to ? " по " + period.to : "");
    return freq + dow + range;
  }

  // ---------- rendering: tabs ----------

  var views = ["today", "habits", "stats"];

  document.querySelectorAll(".tab-btn").forEach(function (btn) {
    btn.addEventListener("click", function () {
      var v = btn.getAttribute("data-view");
      document.querySelectorAll(".tab-btn").forEach(function (b) { b.classList.toggle("active", b === btn); });
      views.forEach(function (name) {
        document.getElementById("view-" + name).classList.toggle("active", name === v);
      });
      if (v === "today") renderToday();
      if (v === "habits") renderHabits();
      if (v === "stats") renderStats();
    });
  });

  // ---------- Today view ----------

  function renderToday() {
    var date = todayStr();
    var list = document.getElementById("today-list");
    var summaryEl = document.getElementById("today-summary");
    var emptyEl = document.getElementById("today-empty");
    list.innerHTML = "";

    var active = state.habits.filter(function (h) {
      return !h.archivedAt && getExpectedCount(h, date) > 0;
    });

    emptyEl.hidden = active.length > 0;

    var totalExpected = 0, totalDone = 0;

    active.forEach(function (h) {
      var expected = getExpectedCount(h, date);
      var period = getActivePeriod(h, date);
      var doneSlots = getCompletedSlots(h.id, date);
      var doneCount = doneSlots.length;
      totalExpected += expected;
      totalDone += Math.min(doneCount, expected);

      var card = document.createElement("div");
      card.className = "habit-card";

      var top = document.createElement("div");
      top.className = "habit-card-top";
      top.innerHTML =
        '<div><div class="name"></div><div class="category"></div></div>' +
        '<div class="progress"></div>';
      top.querySelector(".name").textContent = h.name;
      top.querySelector(".category").textContent = h.category || "";
      top.querySelector(".progress").textContent = doneCount + " / " + expected;
      card.appendChild(top);

      var slots = document.createElement("div");
      slots.className = "slots";
      for (var i = 0; i < expected; i++) {
        var btn = document.createElement("button");
        btn.className = "slot-btn" + (doneSlots.indexOf(i) !== -1 ? " done" : "");
        var label = period.slotLabels && period.slotLabels[i] ? period.slotLabels[i] : String(i + 1);
        btn.textContent = label;
        (function (idx) {
          btn.addEventListener("click", function () {
            toggleSlot(h.id, date, idx);
            renderToday();
          });
        })(i);
        slots.appendChild(btn);
      }
      card.appendChild(slots);
      list.appendChild(card);
    });

    var pct = totalExpected > 0 ? Math.round((totalDone / totalExpected) * 100) : null;
    summaryEl.innerHTML = pct === null
      ? "На сегодня привычек не запланировано."
      : '<span class="big-pct">' + pct + '%</span> выполнено сегодня (' + totalDone + ' из ' + totalExpected + ')';
  }

  // ---------- Habits management view ----------

  function renderHabits() {
    var list = document.getElementById("habits-list");
    list.innerHTML = "";

    if (state.habits.length === 0) {
      list.innerHTML = '<p class="empty-hint">Пока нет привычек. Нажмите «+ Новая привычка».</p>';
      return;
    }

    state.habits.forEach(function (h) {
      var card = document.createElement("div");
      card.className = "habit-manage-card";

      var nameRow = document.createElement("div");
      nameRow.className = "name-row";
      var nameEl = document.createElement("div");
      nameEl.className = "name" + (h.archivedAt ? " archived" : "");
      nameEl.textContent = h.name;
      nameRow.appendChild(nameEl);
      card.appendChild(nameRow);

      if (h.category) {
        var meta = document.createElement("div");
        meta.className = "meta";
        meta.textContent = h.category;
        card.appendChild(meta);
      }

      var periodsEl = document.createElement("div");
      periodsEl.className = "periods";
      var sorted = h.periods.slice().sort(function (a, b) { return a.from < b.from ? -1 : 1; });
      sorted.forEach(function (p) {
        var row = document.createElement("div");
        row.textContent = periodSummary(p);
        periodsEl.appendChild(row);
      });
      card.appendChild(periodsEl);

      var actions = document.createElement("div");
      actions.className = "actions";

      var editBtn = document.createElement("button");
      editBtn.textContent = "Редактировать";
      editBtn.addEventListener("click", function () { openEditHabitModal(h.id); });
      actions.appendChild(editBtn);

      var planBtn = document.createElement("button");
      planBtn.textContent = "Новый период частоты";
      planBtn.addEventListener("click", function () { openAddPeriodModal(h.id); });
      actions.appendChild(planBtn);

      var archiveBtn = document.createElement("button");
      archiveBtn.textContent = h.archivedAt ? "Восстановить" : "Архивировать";
      archiveBtn.addEventListener("click", function () {
        h.archivedAt = h.archivedAt ? null : todayStr();
        save();
        renderHabits();
      });
      actions.appendChild(archiveBtn);

      var delBtn = document.createElement("button");
      delBtn.className = "btn-danger";
      delBtn.textContent = "Удалить";
      delBtn.addEventListener("click", function () {
        if (confirm('Удалить привычку "' + h.name + '" вместе со всей историей? Это необратимо.')) {
          state.habits = state.habits.filter(function (x) { return x.id !== h.id; });
          delete state.completions[h.id];
          save();
          renderHabits();
        }
      });
      actions.appendChild(delBtn);

      card.appendChild(actions);
      list.appendChild(card);
    });
  }

  // ---------- modal helpers ----------

  var backdrop = document.getElementById("modal-backdrop");
  var modal = document.getElementById("modal");

  function closeModal() {
    backdrop.hidden = true;
    modal.innerHTML = "";
  }

  backdrop.addEventListener("click", function (e) {
    if (e.target === backdrop) closeModal();
  });

  function openModal(html) {
    modal.innerHTML = html;
    backdrop.hidden = false;
  }

  function dowCheckboxes(name, selected) {
    var sel = selected || ALL_DOW;
    return '<div class="dow-picker">' + DOW_LABELS.map(function (label, idx) {
      var checked = sel.indexOf(idx) !== -1 ? "checked" : "";
      return '<label><input type="checkbox" name="' + name + '" value="' + idx + '" ' + checked + '>' + label + '</label>';
    }).join("") + '</div>';
  }

  function readDow(form, name) {
    var boxes = form.querySelectorAll('input[name="' + name + '"]:checked');
    var vals = [];
    boxes.forEach(function (b) { vals.push(parseInt(b.value, 10)); });
    return vals;
  }

  // ---------- add habit modal ----------

  document.getElementById("btn-add-habit").addEventListener("click", openAddHabitModal);

  function openAddHabitModal() {
    openModal(
      '<h3>Новая привычка</h3>' +
      '<form id="add-habit-form">' +
      '<div class="field"><label>Название</label><input type="text" name="name" required></div>' +
      '<div class="field"><label>Категория (необязательно)</label><input type="text" name="category" placeholder="Здоровье, питание..."></div>' +
      '<div class="field"><label>Сколько раз в день</label><input type="number" name="count" min="1" value="1" required></div>' +
      '<div class="field"><label>Метки для повторений (необязательно, через запятую)</label>' +
      '<input type="text" name="slots" placeholder="Утро, Вечер, Ночь">' +
      '<div class="hint">Если указано, количество меток определяет число раз в день.</div></div>' +
      '<div class="field"><label>По каким дням недели</label>' + dowCheckboxes("dow") + '</div>' +
      '<div class="field"><label>Начиная с даты</label><input type="date" name="from" value="' + todayStr() + '" required></div>' +
      '<div class="modal-actions">' +
      '<button type="button" class="btn-secondary" id="cancel-add-habit">Отмена</button>' +
      '<button type="submit" class="btn-primary">Создать</button>' +
      '</div></form>'
    );
    document.getElementById("cancel-add-habit").addEventListener("click", closeModal);
    var form = document.getElementById("add-habit-form");
    form.addEventListener("submit", function (e) {
      e.preventDefault();
      var name = form.name.value.trim();
      if (!name) return;
      var slotsRaw = form.slots.value.trim();
      var slotLabels = slotsRaw ? slotsRaw.split(",").map(function (s) { return s.trim(); }).filter(Boolean) : null;
      var count = slotLabels ? slotLabels.length : Math.max(1, parseInt(form.count.value, 10) || 1);
      var dow = readDow(form, "dow");
      var newHabit = {
        id: uid(),
        name: name,
        category: form.category.value.trim(),
        notes: "",
        archivedAt: null,
        periods: [{
          id: uid(),
          from: form.from.value,
          to: null,
          perDayCount: count,
          slotLabels: slotLabels,
          daysOfWeek: dow.length ? dow : ALL_DOW.slice()
        }]
      };
      state.habits.push(newHabit);
      save();
      closeModal();
      renderHabits();
    });
  }

  // ---------- edit habit modal ----------

  function openEditHabitModal(habitId) {
    var h = state.habits.find(function (x) { return x.id === habitId; });
    if (!h) return;
    openModal(
      '<h3>Редактировать привычку</h3>' +
      '<form id="edit-habit-form">' +
      '<div class="field"><label>Название</label><input type="text" name="name" value="' + escapeAttr(h.name) + '" required></div>' +
      '<div class="field"><label>Категория</label><input type="text" name="category" value="' + escapeAttr(h.category || "") + '"></div>' +
      '<div class="field"><label>Заметки</label><textarea name="notes" rows="3">' + escapeHtml(h.notes || "") + '</textarea></div>' +
      '<div class="modal-actions">' +
      '<button type="button" class="btn-secondary" id="cancel-edit-habit">Отмена</button>' +
      '<button type="submit" class="btn-primary">Сохранить</button>' +
      '</div></form>'
    );
    document.getElementById("cancel-edit-habit").addEventListener("click", closeModal);
    var form = document.getElementById("edit-habit-form");
    form.addEventListener("submit", function (e) {
      e.preventDefault();
      h.name = form.name.value.trim() || h.name;
      h.category = form.category.value.trim();
      h.notes = form.notes.value.trim();
      save();
      closeModal();
      renderHabits();
    });
  }

  // ---------- add period modal (plan frequency for a period) ----------

  function openAddPeriodModal(habitId) {
    var h = state.habits.find(function (x) { return x.id === habitId; });
    if (!h) return;
    openModal(
      '<h3>Новый период частоты — "' + escapeHtml(h.name) + '"</h3>' +
      '<p class="hint">Текущий открытый период будет автоматически закрыт днём раньше даты начала нового.</p>' +
      '<form id="add-period-form">' +
      '<div class="field"><label>Сколько раз в день</label><input type="number" name="count" min="1" value="1" required></div>' +
      '<div class="field"><label>Метки для повторений (необязательно, через запятую)</label>' +
      '<input type="text" name="slots" placeholder="Утро, Вечер, Ночь"></div>' +
      '<div class="field"><label>По каким дням недели</label>' + dowCheckboxes("dow") + '</div>' +
      '<div class="field"><label>Действует с</label><input type="date" name="from" value="' + todayStr() + '" required></div>' +
      '<div class="field"><label>Действует по (необязательно, оставьте пустым для "пока не изменю")</label><input type="date" name="to"></div>' +
      '<div class="modal-actions">' +
      '<button type="button" class="btn-secondary" id="cancel-add-period">Отмена</button>' +
      '<button type="submit" class="btn-primary">Сохранить план</button>' +
      '</div></form>'
    );
    document.getElementById("cancel-add-period").addEventListener("click", closeModal);
    var form = document.getElementById("add-period-form");
    form.addEventListener("submit", function (e) {
      e.preventDefault();
      var fromDate = form.from.value;
      var toDate = form.to.value || null;
      var slotsRaw = form.slots.value.trim();
      var slotLabels = slotsRaw ? slotsRaw.split(",").map(function (s) { return s.trim(); }).filter(Boolean) : null;
      var count = slotLabels ? slotLabels.length : Math.max(1, parseInt(form.count.value, 10) || 1);
      var dow = readDow(form, "dow");

      // close any currently open period that would overlap the new one's start
      var dayBefore = toDateStr(new Date(parseDateStr(fromDate).getTime() - 86400000));
      h.periods.forEach(function (p) {
        if (!p.to && p.from < fromDate) p.to = dayBefore;
      });

      h.periods.push({
        id: uid(),
        from: fromDate,
        to: toDate,
        perDayCount: count,
        slotLabels: slotLabels,
        daysOfWeek: dow.length ? dow : ALL_DOW.slice()
      });
      save();
      closeModal();
      renderHabits();
    });
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>]/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]; });
  }
  function escapeAttr(s) { return escapeHtml(s).replace(/"/g, "&quot;"); }

  // ---------- Stats view ----------

  var statsCursor = new Date();
  statsCursor.setDate(1);

  document.getElementById("stats-prev").addEventListener("click", function () {
    statsCursor.setMonth(statsCursor.getMonth() - 1);
    renderStats();
  });
  document.getElementById("stats-next").addEventListener("click", function () {
    statsCursor.setMonth(statsCursor.getMonth() + 1);
    renderStats();
  });

  function renderStats() {
    var year = statsCursor.getFullYear();
    var monthIndex0 = statsCursor.getMonth();
    document.getElementById("stats-month-label").textContent = monthLabel(year, monthIndex0);

    var nDays = daysInMonth(year, monthIndex0);
    var today = todayStr();

    var perHabit = {}; // id -> {expected, done, name}
    state.habits.forEach(function (h) { perHabit[h.id] = { expected: 0, done: 0, name: h.name }; });

    var dayPct = []; // per day: {expected, done}

    for (var d = 1; d <= nDays; d++) {
      var dateStr = year + "-" + pad2(monthIndex0 + 1) + "-" + pad2(d);
      if (dateStr > today) { dayPct.push(null); continue; }
      var dayExpected = 0, dayDone = 0;
      state.habits.forEach(function (h) {
        var expected = getExpectedCount(h, dateStr);
        if (expected === 0) return;
        var done = Math.min(getCompletedSlots(h.id, dateStr).length, expected);
        perHabit[h.id].expected += expected;
        perHabit[h.id].done += done;
        dayExpected += expected;
        dayDone += done;
      });
      dayPct.push(dayExpected > 0 ? Math.round((dayDone / dayExpected) * 100) : null);
    }

    var totalExpected = 0, totalDone = 0;
    Object.keys(perHabit).forEach(function (id) {
      totalExpected += perHabit[id].expected;
      totalDone += perHabit[id].done;
    });
    var totalPct = totalExpected > 0 ? Math.round((totalDone / totalExpected) * 100) : null;

    document.getElementById("stats-total").innerHTML = totalPct === null
      ? "Нет данных за этот месяц."
      : '<span class="big-pct">' + totalPct + '%</span> выполнено за ' + monthLabel(year, monthIndex0) +
        ' (' + totalDone + ' из ' + totalExpected + ')';

    var daysEl = document.getElementById("stats-days");
    daysEl.innerHTML = "";
    dayPct.forEach(function (pct, idx) {
      var cell = document.createElement("div");
      cell.className = "stats-day-cell";
      cell.title = (idx + 1) + "." + pad2(monthIndex0 + 1) + (pct !== null ? " — " + pct + "%" : "");
      cell.textContent = String(idx + 1);
      if (pct !== null) {
        var alpha = 0.15 + (pct / 100) * 0.75;
        cell.style.background = "rgba(47,158,91," + alpha.toFixed(2) + ")";
        cell.style.color = pct > 50 ? "#fff" : "#1f2937";
      }
      daysEl.appendChild(cell);
    });

    var tbody = document.getElementById("stats-table-body");
    tbody.innerHTML = "";
    state.habits.forEach(function (h) {
      var row = perHabit[h.id];
      if (row.expected === 0) return;
      var pct = Math.round((row.done / row.expected) * 100);
      var tr = document.createElement("tr");
      tr.innerHTML = "<td>" + escapeHtml(h.name) + "</td><td>" + row.done + "</td><td>" + row.expected + "</td><td>" + pct + "%</td>";
      tbody.appendChild(tr);
    });
    var totalTr = document.createElement("tr");
    totalTr.className = "total-row";
    totalTr.innerHTML = "<td>Итого</td><td>" + totalDone + "</td><td>" + totalExpected + "</td><td>" + (totalPct === null ? "—" : totalPct + "%") + "</td>";
    tbody.appendChild(totalTr);
  }

  // ---------- export / import ----------
  //
  // In a browser this uses a Blob download and a hidden <input type="file">.
  // Inside the Android WebView wrapper neither works well (no download
  // manager, no native file picker wired up), so MainActivity injects a
  // `window.AndroidBridge` object with the same two operations backed by
  // the Storage Access Framework; we call into it when present instead.

  function hasAndroidBridge() {
    return typeof window.AndroidBridge !== "undefined" && window.AndroidBridge !== null;
  }

  function applyImportedJson(raw) {
    try {
      var parsed = JSON.parse(raw);
      if (!parsed || !parsed.habits) throw new Error("bad format");
      if (!confirm("Импорт заменит все текущие данные. Продолжить?")) return;
      state = parsed;
      if (!state.completions) state.completions = {};
      save();
      renderToday();
      renderHabits();
      renderStats();
      alert("Импорт завершён.");
    } catch (err) {
      alert("Не удалось прочитать файл. Убедитесь, что это резервная копия, созданная этим приложением.");
    }
  }

  // Called by MainActivity.AndroidBridge once the user finishes (or cancels)
  // the system file picker. A null json with no error means "cancelled".
  window.__androidImportResult = function (json, error) {
    if (json) applyImportedJson(json);
    else if (error) alert("Не удалось прочитать файл: " + error);
  };

  document.getElementById("btn-export").addEventListener("click", function () {
    var json = JSON.stringify(state, null, 2);
    if (hasAndroidBridge() && window.AndroidBridge.exportBackup) {
      window.AndroidBridge.exportBackup(json);
      return;
    }
    var blob = new Blob([json], { type: "application/json" });
    var url = URL.createObjectURL(blob);
    var a = document.createElement("a");
    a.href = url;
    a.download = "habits-backup-" + todayStr() + ".json";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  });

  if (hasAndroidBridge() && window.AndroidBridge.requestImport) {
    document.querySelector(".file-label").addEventListener("click", function (e) {
      e.preventDefault();
      window.AndroidBridge.requestImport();
    });
  } else {
    document.getElementById("input-import").addEventListener("change", function (e) {
      var file = e.target.files[0];
      if (!file) return;
      var reader = new FileReader();
      reader.onload = function () { applyImportedJson(reader.result); };
      reader.readAsText(file);
      e.target.value = "";
    });
  }

  // ---------- init ----------

  renderToday();
})();
