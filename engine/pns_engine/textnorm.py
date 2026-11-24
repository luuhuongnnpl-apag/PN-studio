"""Chuẩn hóa văn bản đọc tiếng Việt: từ điển viết tắt, số, điều/khoản, ngày tháng, tiền.

Văn bản gốc (scriptOriginal) luôn giữ nguyên để làm phụ đề; văn bản phát âm (scriptSpoken)
được sinh từ đây và người dùng có thể sửa tay.
"""
from __future__ import annotations

import re

DIGITS = ["không", "một", "hai", "ba", "bốn", "năm", "sáu", "bảy", "tám", "chín"]
SCALES = ["", "nghìn", "triệu", "tỷ"]

DEFAULT_DICTIONARY = [
    {"written": "BLDS", "spoken": "Bộ luật Dân sự"},
    {"written": "BLHS", "spoken": "Bộ luật Hình sự"},
    {"written": "BLTTDS", "spoken": "Bộ luật Tố tụng dân sự"},
    {"written": "BLTTHS", "spoken": "Bộ luật Tố tụng hình sự"},
    {"written": "BLLĐ", "spoken": "Bộ luật Lao động"},
    {"written": "HN&GĐ", "spoken": "hôn nhân và gia đình"},
    {"written": "TAND", "spoken": "Tòa án nhân dân"},
    {"written": "VKSND", "spoken": "Viện kiểm sát nhân dân"},
    {"written": "UBND", "spoken": "Ủy ban nhân dân"},
    {"written": "HĐND", "spoken": "Hội đồng nhân dân"},
    {"written": "QSDĐ", "spoken": "quyền sử dụng đất"},
    {"written": "GCN", "spoken": "giấy chứng nhận"},
    {"written": "NĐ-CP", "spoken": "Nghị định Chính phủ"},
    {"written": "TT-BTP", "spoken": "Thông tư Bộ Tư pháp"},
    {"written": "NQ-HĐTP", "spoken": "Nghị quyết Hội đồng Thẩm phán"},
    {"written": "QH", "spoken": "Quốc hội"},
    {"written": "VNĐ", "spoken": "đồng"},
    {"written": "tr.đ", "spoken": "triệu đồng"},
]


def _read_triple(n: int, full: bool) -> str:
    """Đọc số 0..999. full=True: đọc cả 'không trăm', 'linh' (nhóm không đứng đầu)."""
    h, t, u = n // 100, (n // 10) % 10, n % 10
    words: list[str] = []
    if h or full:
        words += [DIGITS[h], "trăm"]
    if t == 0:
        if u and (h or full):
            words.append("linh")
        if u:
            words.append(DIGITS[u])
    elif t == 1:
        words.append("mười")
        if u == 5:
            words.append("lăm")
        elif u:
            words.append(DIGITS[u])
    else:
        words += [DIGITS[t], "mươi"]
        if u == 1:
            words.append("mốt")
        elif u == 4:
            words.append("tư")
        elif u == 5:
            words.append("lăm")
        elif u:
            words.append(DIGITS[u])
    return " ".join(words)


def read_number(n: int) -> str:
    if n == 0:
        return "không"
    if n < 0:
        return "âm " + read_number(-n)
    if n >= 10 ** 12:
        return " ".join(DIGITS[int(c)] for c in str(n))
    groups = []
    while n:
        groups.append(n % 1000)
        n //= 1000
    parts = []
    top = len(groups) - 1
    for i in range(top, -1, -1):
        g = groups[i]
        if g == 0:
            continue
        parts.append(_read_triple(g, full=i != top))
        if SCALES[i]:
            parts.append(SCALES[i])
    return " ".join(parts)


def read_digits(s: str) -> str:
    return " ".join(DIGITS[int(c)] for c in s)


def _num_token(tok: str) -> str:
    """'1.000.000' -> một triệu; '2,5' -> hai phẩy năm; '012' -> không một hai."""
    if re.fullmatch(r"\d{1,3}(\.\d{3})+", tok):
        return read_number(int(tok.replace(".", "")))
    m = re.fullmatch(r"(\d+),(\d+)", tok)
    if m:
        frac = m.group(2)
        frac_read = read_number(int(frac)) if not frac.startswith("0") else read_digits(frac)
        return f"{read_number(int(m.group(1)))} phẩy {frac_read}"
    if re.fullmatch(r"0\d+", tok):
        return read_digits(tok)
    return read_number(int(tok))


_NUM = r"\d{1,3}(?:\.\d{3})+|\d+,\d+|\d+"


def _apply_dictionary(text: str, entries: list[dict]) -> str:
    # Mục dài trước để "BLTTDS" không bị "BLDS" ăn mất.
    for e in sorted(entries, key=lambda e: -len(e.get("written", ""))):
        w, s = e.get("written", "").strip(), e.get("spoken", "").strip()
        if not w or not s:
            continue
        pat = r"(?<![\wÀ-ỹ])" + re.escape(w) + r"(?![\wÀ-ỹ])"
        flags = 0 if e.get("caseSensitive", True) else re.IGNORECASE
        text = re.sub(pat, s, text, flags=flags)
    return text


def normalize(text: str, dictionary: list[dict] | None = None) -> str:
    entries = DEFAULT_DICTIONARY if dictionary is None else dictionary
    t = text.replace("\r\n", "\n")
    # Ngày dd/mm/yyyy
    t = re.sub(r"(?:\b([Nn]gày)\s+)?\b(\d{1,2})/(\d{1,2})/(\d{4})\b",
               lambda m: f"{m.group(1) or 'ngày'} {read_number(int(m.group(2)))} tháng "
                         f"{read_number(int(m.group(3)))} năm {read_number(int(m.group(4)))}", t)
    # Số hiệu văn bản: 91/2015/QH13 -> số chín mươi mốt năm hai nghìn ... Quốc hội khóa mười ba
    t = re.sub(r"\b(\d+)/(\d{4})/QH(\d+)\b",
               lambda m: f"số {read_number(int(m.group(1)))} năm {read_number(int(m.group(2)))} "
                         f"Quốc hội khóa {read_number(int(m.group(3)))}", t)
    t = re.sub(r"\b(\d+)/(\d{4})/([A-ZĐ][A-ZĐ\-]*)",
               lambda m: f"số {read_number(int(m.group(1)))} năm {read_number(int(m.group(2)))} {m.group(3)}", t)
    t = _apply_dictionary(t, entries)
    # Phần trăm
    t = re.sub(rf"({_NUM})\s?%", lambda m: _num_token(m.group(1)) + " phần trăm", t)
    # Điều 612, khoản 1, Chương 2 ...: số đọc thành chữ (giữ nguyên chữ "Điều")
    t = re.sub(r"\b(Điều|điều|khoản|Khoản|Chương|chương|Mục|mục|Phần|phần)\s+(\d+)",
               lambda m: f"{m.group(1)} {read_number(int(m.group(2)))}", t)
    # điểm a, b khoản ... giữ nguyên chữ cái
    t = re.sub(_NUM, lambda m: _num_token(m.group(0)), t)
    t = re.sub(r"[ \t]+", " ", t)
    return t.strip()


_SENT = re.compile(r"(?<=[\.\!\?…;:])\s+|\n+")


def split_sentences(text: str) -> list[str]:
    parts = [p.strip() for p in _SENT.split(text) if p and p.strip()]
    out: list[str] = []
    for p in parts:
        # Câu dài > 110 ký tự: tách tiếp theo dấu phẩy để phụ đề dễ đọc.
        while len(p) > 110:
            cut = p.rfind(", ", 40, 110)
            if cut == -1:
                cut = p.rfind(" ", 40, 110)
            if cut == -1:
                break
            out.append(p[:cut + 1].strip())
            p = p[cut + 1:].strip()
        if p:
            out.append(p)
    return out


def chunk_for_tts(text: str, limit: int = 400) -> list[str]:
    """Gộp câu thành đoạn <= limit ký tự để TTS ổn định và cache theo đoạn."""
    chunks, cur = [], ""
    for s in split_sentences(text):
        if cur and len(cur) + 1 + len(s) > limit:
            chunks.append(cur)
            cur = s
        else:
            cur = f"{cur} {s}".strip()
    if cur:
        chunks.append(cur)
    return chunks


def word_count(text: str) -> int:
    return len(re.findall(r"[\wÀ-ỹ]+", text))
