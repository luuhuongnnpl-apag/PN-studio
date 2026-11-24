// Trình học liệu điện tử PNS — chạy độc lập (mở index.html, đăng PNL/GitHub Pages) hoặc trong LMS qua SCORM 1.2.
// Tiến độ: localStorage (khi chạy độc lập) hoặc cmi.suspend_data (khi chạy trong LMS). Không gửi dữ liệu đi nơi khác.
(function () {
  "use strict";
  var C = JSON.parse(document.getElementById("pns-course").textContent);
  var $ = function (id) { return document.getElementById(id); };
  var view = $("view"), nav = $("nav"), main = $("main");
  var BUCKET = 10; // giây — đơn vị ghi nhận đã xem

  function el(tag, attrs) {
    var e = document.createElement(tag);
    for (var k in attrs || {}) {
      var v = attrs[k];
      if (v == null || v === false) continue;
      if (k === "text") e.textContent = v;
      else if (k.slice(0, 2) === "on") e.addEventListener(k.slice(2), v);
      else e.setAttribute(k, v === true ? "" : v);
    }
    for (var i = 2; i < arguments.length; i++) add(e, arguments[i]);
    return e;
  }
  function add(e, c) {
    if (c == null || c === false) return;
    if (Array.isArray(c)) { c.forEach(function (x) { add(e, x); }); return; }
    e.appendChild(typeof c === "object" ? c : document.createTextNode(String(c)));
  }
  function fmt(ms) { var s = Math.floor(ms / 1000); return Math.floor(s / 60) + ":" + ("0" + s % 60).slice(-2); }

  // ---------------- SCORM 1.2 ----------------
  var api = null;
  (function find() {
    var w = window, n = 0;
    while (w && n++ < 10) { try { if (w.API && w.API.LMSInitialize) { api = w.API; return; } } catch (e) { break; } if (w.parent === w) break; w = w.parent; }
    try { if (!api && window.opener && window.opener.API) api = window.opener.API; } catch (e) {}
  })();
  if (api && String(api.LMSInitialize("")) !== "true") api = null;
  function lms(k, v) { if (!api) return ""; if (v === undefined) return api.LMSGetValue(k); api.LMSSetValue(k, String(v)); }

  // ---------------- tiến độ ----------------
  var KEY = "pns.course." + C.id;
  var P = { l: {}, q: null, at: "" };
  try {
    var raw = api ? lms("cmi.suspend_data") : localStorage.getItem(KEY);
    if (raw) P = Object.assign(P, JSON.parse(raw));
  } catch (e) {}
  function lp(id) { return P.l[id] || (P.l[id] = { w: "", a: {}, d: 0 }); }
  // bitmap các ô 10 giây đã xem, lưu dạng hex gọn để vừa giới hạn 4096 ký tự của SCORM 1.2
  function bits(hex, n) { var out = []; for (var i = 0; i < n; i++) { var c = parseInt(hex.charAt(i >> 2) || "0", 16); out.push((c >> (i & 3)) & 1); } return out; }
  function hexOf(b) { var s = ""; for (var i = 0; i < b.length; i += 4) s += ((b[i] | 0) | (b[i + 1] | 0) << 1 | (b[i + 2] | 0) << 2 | (b[i + 3] | 0) << 3).toString(16); return s; }
  function watchedPct(L) { var n = Math.max(1, Math.ceil(L.durationMs / 1000 / BUCKET)), b = bits(lp(L.id).w, n), c = 0; b.forEach(function (x) { c += x; }); return Math.round(c / n * 100); }
  function lessonDone(L) {
    var s = lp(L.id);
    if (s.d) return true;
    var qs = L.questions || [], all = qs.every(function (q) { return s.a[q.id] !== undefined; });
    if (watchedPct(L) >= C.completion.minWatch && all) { s.d = 1; return true; }
    return false;
  }
  function overall() {
    var done = C.lessons.filter(lessonDone).length, total = C.lessons.length + (C.quiz ? 1 : 0);
    var passed = C.quiz && P.q && P.q.p;
    return { done: done, pct: Math.round((done + (passed ? 1 : 0)) / Math.max(1, total) * 100), allLessons: done === C.lessons.length, passed: passed };
  }
  var saveT = null;
  function save(now) {
    clearTimeout(saveT);
    var go = function () {
      var o = overall(), data = JSON.stringify(P);
      if (api) {
        lms("cmi.suspend_data", data.length <= 4096 ? data : JSON.stringify({ l: {}, q: P.q, at: P.at }));
        lms("cmi.core.lesson_location", P.at || "");
        var status = !o.allLessons ? "incomplete" : !C.quiz ? "completed" : !P.q ? "incomplete" : P.q.p ? "passed" : "failed";
        lms("cmi.core.lesson_status", status);
        if (P.q) { lms("cmi.core.score.min", 0); lms("cmi.core.score.max", 100); lms("cmi.core.score.raw", P.q.s); }
        api.LMSCommit("");
      } else { try { localStorage.setItem(KEY, data); } catch (e) {} }
      $("bar").style.width = o.pct + "%"; $("pct").textContent = o.pct + "%";
    };
    if (now) go(); else saveT = setTimeout(go, 800);
  }
  window.addEventListener("pagehide", function () { save(true); if (api) { api.LMSFinish(""); api = null; } });

  // ---------------- điều hướng ----------------
  var cur = "home", video = null;
  function stIcon(L) {
    if (lessonDone(L)) return el("span", { class: "st done", "aria-label": "Đã hoàn thành" }, "✓");
    var w = watchedPct(L);
    return el("span", { class: "st" + (w > 0 ? " part" : ""), "aria-label": w > 0 ? "Đang học" : "Chưa học" });
  }
  function drawNav() {
    nav.textContent = "";
    add(nav, el("button", { "aria-current": cur === "home" ? "page" : null, onclick: function () { go("home"); } }, el("span", { class: "st" }, "i"), el("span", {}, "Giới thiệu học liệu")));
    add(nav, el("h2", { text: "Bài học" }));
    C.lessons.forEach(function (L, i) {
      add(nav, el("button", { "aria-current": cur === L.id ? "page" : null, onclick: function () { go(L.id); } }, stIcon(L),
        el("span", {}, (i + 1) + ". " + L.title, el("small", { text: fmt(L.durationMs) + (lp(L.id).w ? " · đã xem " + watchedPct(L) + "%" : "") }))));
    });
    if (C.quiz) {
      add(nav, el("h2", { text: "Đánh giá" }));
      add(nav, el("button", { "aria-current": cur === "quiz" ? "page" : null, onclick: function () { go("quiz"); } },
        el("span", { class: "st" + (P.q && P.q.p ? " done" : P.q ? " part" : "") }, P.q && P.q.p ? "✓" : ""),
        el("span", {}, C.quiz.title, el("small", { text: C.quiz.questions.length + " câu · đạt từ " + C.quiz.passScore + "%" + (P.q ? " · điểm cao nhất " + P.q.s + "%" : "") }))));
    }
  }
  function go(id) {
    if (video) { video.pause(); video = null; }
    cur = id; P.at = id; save();
    nav.classList.remove("open");
    view.textContent = "";
    if (id === "quiz") drawQuiz();
    else { var L = C.lessons.filter(function (x) { return x.id === id; })[0]; if (L) drawLesson(L); else { cur = "home"; drawHome(); } }
    drawNav(); main.scrollTop = 0; main.focus({ preventScroll: true });
  }
  $("menu").onclick = function () { nav.classList.toggle("open"); };

  // ---------------- trang giới thiệu ----------------
  function drawHome() {
    var o = overall();
    add(view, [
      C.cover && el("img", { class: "cover", src: C.cover, alt: "" }),
      el("h1", { text: C.title }),
      el("p", { class: "meta", text: [C.course, C.author, C.org].filter(Boolean).join(" · ") }),
      C.description && el("div", { class: "card" }, el("p", { style: "margin:0;white-space:pre-wrap", text: C.description })),
      C.objectives.length && el("div", { class: "card" }, el("h2", { style: "margin-top:0", text: "Mục tiêu học tập" }),
        el("ul", {}, C.objectives.map(function (x) { return el("li", { text: x }); }))),
      el("div", { class: "card" }, el("h2", { style: "margin-top:0", text: "Nội dung" }),
        el("ol", {}, C.lessons.map(function (L) { return el("li", {}, L.title, " ", el("span", { class: "note", text: "(" + fmt(L.durationMs) + ")" })); })),
        C.quiz && el("p", { text: "Kết thúc bằng " + C.quiz.title.toLowerCase() + " (" + C.quiz.questions.length + " câu, đạt từ " + C.quiz.passScore + "%)." }),
        el("p", { class: "note", text: "Hoàn thành một bài: xem tối thiểu " + C.completion.minWatch + "% video và trả lời các câu hỏi trong video." }),
        el("p", {}, el("button", { class: "btn gold", onclick: function () { var n = C.lessons.filter(function (L) { return !lessonDone(L); })[0]; go(n ? n.id : C.quiz ? "quiz" : C.lessons[0].id); } },
          o.done ? "Học tiếp" : "Bắt đầu học"), " ", el("span", { class: "note", text: "Tiến độ: " + o.pct + "%" }))),
      C.aiNotice && el("p", { class: "note" }, el("span", { class: "ai", text: "AI" }), " Một số bài có lời thuyết minh tạo bằng giọng AI từ giọng của giảng viên."),
      el("p", { class: "note", text: (api ? "Đang chạy trong hệ thống quản lý học tập (SCORM 1.2). " : "Tiến độ lưu trên trình duyệt này. ") + "Tạo bằng " + C.generator + "." })
    ]);
  }

  // ---------------- bài học ----------------
  function drawLesson(L) {
    var idx = C.lessons.indexOf(L), s = lp(L.id);
    var n = Math.max(1, Math.ceil(L.durationMs / 1000 / BUCKET)), b = bits(s.w, n);
    var qs = (L.questions || []).slice().sort(function (a, c) { return a.atMs - c.atMs; });
    var ov = el("div", { class: "ov", hidden: true, role: "dialog", "aria-modal": "true" }), box = el("div", { class: "q" });
    ov.appendChild(box);
    var v = el("video", { controls: true, preload: "metadata", playsinline: true, src: L.video },
      L.vtt && el("track", { kind: "subtitles", srclang: "vi", label: "Tiếng Việt", src: L.vtt, default: true }));
    video = v;
    var status = el("p", { class: "note" });
    var chips = el("div", { class: "chips", "aria-label": "Chương mục" });
    var open = null;
    function upd() {
      var w = watchedPct(L), ans = qs.filter(function (q) { return s.a[q.id] !== undefined; }).length;
      status.textContent = lessonDone(L) ? "✓ Đã hoàn thành bài này." : "Đã xem " + w + "% (cần " + C.completion.minWatch + "%)" + (qs.length ? " · đã trả lời " + ans + "/" + qs.length + " câu hỏi" : "") + ".";
    }
    function ask(q) {
      open = q; v.pause();
      if (document.fullscreenElement) document.exitFullscreen().catch(function () {});
      box.textContent = "";
      var fb = el("div", { class: "fb", hidden: true }), cont = el("button", { class: "btn", hidden: true, onclick: function () { ov.hidden = true; open = null; v.play(); } }, "Tiếp tục xem");
      add(box, el("h2", { style: "margin-top:0", text: q.text }));
      q.options.forEach(function (o, i) {
        add(box, el("button", { class: "opt", type: "button", onclick: function (e) {
          var ok = i === q.correct; e.currentTarget.classList.add(ok ? "ok" : "bad");
          if (s.a[q.id] === undefined) s.a[q.id] = ok ? 1 : 0;
          box.querySelectorAll(".opt").forEach(function (x, j) { x.disabled = true; if (j === q.correct) x.classList.add("ok"); });
          fb.hidden = false; fb.textContent = (ok ? "Chính xác. " : "Chưa đúng. ") + (q.explain || "");
          cont.hidden = false; cont.focus(); save(); upd(); drawNav();
        } }, String.fromCharCode(65 + i) + ". " + o));
      });
      add(box, [fb, cont]); ov.hidden = false; box.querySelector(".opt").focus();
    }
    v.addEventListener("timeupdate", function () {
      var k = Math.min(n - 1, Math.floor(v.currentTime / BUCKET));
      if (!v.seeking && !v.paused && !b[k]) { b[k] = 1; s.w = hexOf(b); save(); upd(); if (lessonDone(L)) drawNav(); }
      if (open) return;
      for (var i = 0; i < qs.length; i++) if (s.a[qs[i].id] === undefined && v.currentTime * 1000 >= qs[i].atMs && v.currentTime * 1000 < qs[i].atMs + 1500) { ask(qs[i]); break; }
      var t = v.currentTime * 1000;
      chips.querySelectorAll(".chip").forEach(function (c, i) { var ch = L.chapters[i], nx = L.chapters[i + 1]; c.classList.toggle("on", t >= ch.startMs && (!nx || t < nx.startMs)); });
    });
    v.addEventListener("play", function () { if (open) v.pause(); });
    v.addEventListener("ended", function () { var k; for (k = 0; k < qs.length; k++) if (s.a[qs[k].id] === undefined) { ask(qs[k]); return; } upd(); drawNav(); });
    (L.chapters || []).forEach(function (ch) { add(chips, el("button", { class: "chip", onclick: function () { v.currentTime = ch.startMs / 1000; v.play(); } }, fmt(ch.startMs) + " " + ch.title)); });

    var panes = [];
    if (L.transcript) panes.push(["Lời giảng", L.transcript.map(function (t) { return [el("h3", { text: t.title }), el("p", { text: t.text })]; })]);
    if (L.sources && L.sources.length) panes.push(["Căn cứ pháp lý", [el("p", { class: "note", text: "Căn cứ được trích theo thời điểm biên soạn; người học cần đối chiếu văn bản còn hiệu lực." }),
      L.sources.map(function (t) { return [el("h3", { text: t.title }), el("p", { text: t.notes })]; })]]);
    if (L.attachments && L.attachments.length) panes.push(["Tài liệu", el("ul", { class: "files" }, L.attachments.map(function (f) {
      return el("li", {}, el("a", { href: f.href, download: f.name, target: "_blank", rel: "noopener" }, f.name), " ", el("span", { class: "note", text: f.size ? "(" + Math.max(1, Math.round(f.size / 1024)) + " KB)" : "" }));
    }))]);
    var tabs = el("div", { class: "tabs", role: "tablist" }), pane = el("div", { class: "pane", role: "tabpanel" });
    panes.forEach(function (p, i) {
      add(tabs, el("button", { class: "tab", role: "tab", "aria-selected": i === 0 ? "true" : "false", onclick: function (e) {
        tabs.querySelectorAll(".tab").forEach(function (t) { t.setAttribute("aria-selected", "false"); }); e.currentTarget.setAttribute("aria-selected", "true");
        pane.textContent = ""; add(pane, p[1]);
      } }, p[0]));
    });
    if (panes.length) add(pane, panes[0][1]);
    var next = C.lessons[idx + 1];
    add(view, [
      el("p", { class: "note", text: "Bài " + (idx + 1) + "/" + C.lessons.length + (C.course ? " · " + C.course : "") }),
      el("h1", { text: L.title }), L.aiNarration && el("p", {}, el("span", { class: "ai", text: "Lời thuyết minh tạo bằng AI" })),
      L.intro && el("p", { style: "white-space:pre-wrap", text: L.intro }),
      el("div", { class: "stage" }, v, ov), chips, status,
      panes.length && tabs, panes.length && pane,
      el("p", { style: "margin-top:18px" },
        idx > 0 && el("button", { class: "btn ghost", onclick: function () { go(C.lessons[idx - 1].id); } }, "← Bài trước"), " ",
        next ? el("button", { class: "btn", onclick: function () { go(next.id); } }, "Bài tiếp theo →")
          : C.quiz && el("button", { class: "btn gold", onclick: function () { go("quiz"); } }, "Làm bài kiểm tra →"))
    ]);
    upd();
  }

  // ---------------- kiểm tra cuối ----------------
  function drawQuiz() {
    var Q = C.quiz, o = overall(), form = el("form", {}), res = el("div");
    add(view, [el("h1", { text: Q.title }), el("p", { class: "meta", text: Q.questions.length + " câu · đạt từ " + Q.passScore + "%" + (P.q ? " · điểm cao nhất " + P.q.s + "%" : "") }),
      !o.allLessons && el("p", { class: "note", text: "Nên hoàn thành các bài học trước khi làm bài kiểm tra." })]);
    Q.questions.forEach(function (q, i) {
      add(form, el("fieldset", { class: "qz", style: "border:0;padding:0" }, el("legend", { style: "font-weight:600;margin-bottom:6px" }, "Câu " + (i + 1) + ". " + q.text),
        q.options.map(function (opt, j) { return el("label", {}, el("input", { type: "radio", name: q.id, value: j }), el("span", {}, String.fromCharCode(65 + j) + ". " + opt)); }),
        el("div", { class: "fb", hidden: true })));
    });
    add(form, el("button", { class: "btn gold", type: "submit" }, "Nộp bài"));
    form.addEventListener("submit", function (e) {
      e.preventDefault();
      var right = 0, miss = 0;
      Q.questions.forEach(function (q, i) {
        var fs = form.querySelectorAll("fieldset")[i], pick = fs.querySelector("input:checked"), fb = fs.querySelector(".fb");
        if (!pick) miss++;
        var ok = pick && +pick.value === q.correct; if (ok) right++;
        fs.querySelectorAll("label").forEach(function (lb, j) { lb.classList.toggle("ok", j === q.correct); lb.classList.toggle("bad", !!pick && +pick.value === j && !ok); });
        fb.hidden = false; fb.textContent = (ok ? "Đúng. " : pick ? "Sai. " : "Chưa trả lời. ") + (q.explain || "");
      });
      var score = Math.round(right / Q.questions.length * 100), pass = score >= Q.passScore;
      P.q = { s: Math.max(score, P.q ? P.q.s : 0), p: (P.q && P.q.p) || pass, n: ((P.q && P.q.n) || 0) + 1 };
      save(true); drawNav();
      res.textContent = "";
      add(res, el("div", { class: "card", role: "status" }, el("p", { class: "result " + (pass ? "ok" : "err"), text: "Kết quả: " + right + "/" + Q.questions.length + " câu đúng (" + score + "%) — " + (pass ? "ĐẠT" : "CHƯA ĐẠT") }),
        miss ? el("p", { class: "note", text: miss + " câu chưa trả lời." }) : null,
        el("button", { class: "btn ghost", type: "button", onclick: function () { go("quiz"); } }, "Làm lại")));
      res.scrollIntoView({ behavior: "smooth" });
    });
    add(view, [form, res]);
  }

  $("ttl").textContent = C.title;
  document.title = C.title;
  save(true);
  go(P.at && (P.at === "quiz" || C.lessons.some(function (L) { return L.id === P.at; })) ? P.at : "home");
})();
