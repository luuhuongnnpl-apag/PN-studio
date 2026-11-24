// Trình phát video tương tác PNS — dùng chung cho xem thử (Engine/trình duyệt) và gói xuất bản.
(function () {
  "use strict";
  var D = JSON.parse(document.getElementById("pns-data").textContent);
  var v = document.getElementById("v"), ov = document.getElementById("ov"), box = document.getElementById("qbox");
  var chips = document.getElementById("chips"), scoreEl = document.getElementById("score");
  var qs = (D.questions || []).slice().sort(function (a, b) { return a.atMs - b.atMs; });
  var state = {};            // id -> {answered, correct}
  var open = null;
  document.getElementById("title").textContent = D.title || "";
  if (D.aiNarration) document.getElementById("ai").textContent = "Lời thuyết minh tạo bằng AI";
  if (D.preview) document.title = "[Xem thử] " + document.title;

  function el(tag, cls, text) { var e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; }
  function fmt(ms) { var s = Math.floor(ms / 1000); return Math.floor(s / 60) + ":" + ("0" + s % 60).slice(-2); }
  function nextOpen() { for (var i = 0; i < qs.length; i++) if (!state[qs[i].id] || !state[qs[i].id].answered) return qs[i]; return null; }

  function drawChips() {
    chips.textContent = "";
    qs.forEach(function (q, i) {
      var st = state[q.id], c = el("span", "chip" + (st && st.answered ? (st.correct ? " ok" : " bad") : ""), "Câu " + (i + 1) + " · " + fmt(q.atMs));
      chips.appendChild(c);
    });
    var done = qs.filter(function (q) { return state[q.id] && state[q.id].answered; }).length;
    var right = qs.filter(function (q) { return state[q.id] && state[q.id].correct; }).length;
    scoreEl.textContent = qs.length ? ("Đã trả lời " + done + "/" + qs.length + " · đúng " + right + (done === qs.length ? " — hoàn thành" : "")) : "";
  }

  function show(q) {
    open = q; v.pause();
    if (document.fullscreenElement) document.exitFullscreen().catch(function () {});
    box.textContent = "";
    var h = el("h2", null, q.text); h.id = "qt"; box.appendChild(h);
    var fb = el("div", "fb"); fb.hidden = true;
    var cont = el("button", "btn", "Tiếp tục xem"); cont.hidden = true;
    cont.onclick = function () { ov.hidden = true; open = null; v.play(); };
    q.options.forEach(function (o, i) {
      var b = el("button", "opt", String.fromCharCode(65 + i) + ". " + o); b.type = "button";
      b.onclick = function () {
        var ok = i === q.correct;
        b.classList.add(ok ? "ok" : "bad");
        if (ok || !D.requireCorrect) {
          if (!state[q.id] || !state[q.id].answered) state[q.id] = { answered: true, correct: ok };
          box.querySelectorAll(".opt").forEach(function (x, j) { x.disabled = true; if (j === q.correct) x.classList.add("ok"); });
          fb.hidden = false;
          fb.textContent = (ok ? "Chính xác. " : "Chưa đúng. ") + (D.showExplain && q.explain ? q.explain : "");
          cont.hidden = false; cont.focus(); drawChips();
        } else {
          state[q.id] = { answered: false, correct: false, tried: true };
          fb.hidden = false; fb.textContent = "Chưa đúng, hãy chọn lại.";
        }
      };
      box.appendChild(b);
    });
    box.appendChild(fb); box.appendChild(cont);
    ov.hidden = false;
    box.querySelector(".opt").focus();
  }

  v.addEventListener("timeupdate", function () {
    if (open) return;
    var q = nextOpen();
    if (q && v.currentTime * 1000 >= q.atMs) show(q);
  });
  v.addEventListener("seeking", function () {
    var q = nextOpen();
    if (D.requireCorrect && q && v.currentTime * 1000 > q.atMs + 400) v.currentTime = q.atMs / 1000;
  });
  v.addEventListener("play", function () { if (open) v.pause(); });
  v.addEventListener("ended", drawChips);
  drawChips();
})();
