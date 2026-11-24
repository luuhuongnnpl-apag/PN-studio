"""Tải trọng số và chạy thử VieNeu-TTS một lần (gọi từ INSTALL_VOICE_AI.bat) để lần dùng đầu trong PNS không phải chờ.

Dùng giọng mẫu có sẵn của VieNeu (không cần mẫu giọng cá nhân). In thời gian nạp, thời gian sinh, RTF và RAM.
"""
import sys
import time


def main() -> int:
    mode = sys.argv[1] if len(sys.argv) > 1 else "v3turbo"
    try:
        from vieneu import Vieneu
    except Exception as e:  # noqa: BLE001
        print(f"[LOI] Chua cai VieNeu-TTS: {e}")
        return 1
    t0 = time.time()
    try:
        kw = {"backend": "onnx", "precision": "fp32"} if mode == "v3turbo" else {}
        tts = Vieneu(mode=mode, **kw)
    except Exception as e:  # noqa: BLE001
        print(f"[LOI] Khong tai/nap duoc model (can Internet lan dau, truy cap huggingface.co): {type(e).__name__}: {e}")
        return 2
    t1 = time.time()
    text = "Xin chào các em. Hôm nay chúng ta học về chế định thừa kế theo pháp luật."
    try:
        audio = tts.infer(text)
    except Exception as e:  # noqa: BLE001
        print(f"[LOI] Model da tai nhung sinh thu that bai: {type(e).__name__}: {e}")
        return 3
    t2 = time.time()
    secs = len(audio) / float(getattr(tts, "sample_rate", 48000) or 48000)
    rss = ""
    try:
        import psutil
        rss = f", RAM {psutil.Process().memory_info().rss / 2 ** 20:.0f} MB"
    except Exception:  # noqa: BLE001
        pass
    print(f"OK: nap model {t1 - t0:.1f}s; sinh {secs:.1f}s am thanh trong {t2 - t1:.1f}s (RTF {(t2 - t1) / max(secs, 0.01):.2f}){rss}")
    if (t2 - t1) / max(secs, 0.01) > 1.5:
        print("Goi y: may cham - vao PNS > Cai dat > Giong AI chon 'v3 Nano'.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
