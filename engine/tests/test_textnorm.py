import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from pns_engine.textnorm import chunk_for_tts, normalize, read_number, split_sentences  # noqa: E402


def test_numbers():
    cases = {0: "không", 15: "mười lăm", 21: "hai mươi mốt", 24: "hai mươi tư", 105: "một trăm linh năm",
             612: "sáu trăm mười hai", 1005: "một nghìn không trăm linh năm", 2015: "hai nghìn không trăm mười lăm",
             1_500_000: "một triệu năm trăm nghìn", 2_000_000_000: "hai tỷ"}
    for n, w in cases.items():
        assert read_number(n) == w


def test_acceptance_phrase():
    # Câu thử giọng trong ACCEPTANCE.md viết bằng chữ; bản viết số phải đọc giống hệt
    src = "Theo Điều 612 BLDS 2015, di sản bao gồm tài sản riêng của người chết."
    assert normalize(src) == ("Theo Điều sáu trăm mười hai Bộ luật Dân sự hai nghìn không trăm mười lăm, "
                              "di sản bao gồm tài sản riêng của người chết.")


def test_legal_forms():
    assert normalize("Ngày 01/01/2017") == "Ngày một tháng một năm hai nghìn không trăm mười bảy"
    assert "số chín mươi mốt năm hai nghìn không trăm mười lăm Quốc hội khóa mười ba" in normalize("Luật 91/2015/QH13")
    assert normalize("điểm đ khoản 2") == "điểm đ khoản hai"          # không biến 'đ' thành 'đồng'
    assert normalize("2,5%") == "hai phẩy năm phần trăm"
    assert normalize("BLTTDS") == "Bộ luật Tố tụng dân sự"            # mục dài ưu tiên
    custom = [{"written": "PNS", "spoken": "Phúc Nguyên Studio"}]
    assert normalize("PNS", custom) == "Phúc Nguyên Studio"


def test_split_and_chunk():
    t = "Câu một. Câu hai! " + "Rất dài, " * 30 + "hết."
    parts = split_sentences(t)
    assert parts[0] == "Câu một." and all(len(p) <= 110 for p in parts)
    assert all(len(c) <= 400 for c in chunk_for_tts(t * 5))
