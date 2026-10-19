import ctypes
from ctypes import wintypes

user32 = ctypes.windll.user32

def enum_windows():
    windows = []
    
    @ctypes.WINFUNCTYPE(ctypes.c_bool, wintypes.HWND, wintypes.LPARAM)
    def enum_windows_proc(hwnd, lparam):
        pid = wintypes.DWORD()
        user32.GetWindowThreadProcessId(hwnd, ctypes.byref(pid))
        length = user32.GetWindowTextLengthW(hwnd)
        title = ""
        if length > 0:
            buff = ctypes.create_unicode_buffer(length + 1)
            user32.GetWindowTextW(hwnd, buff, length + 1)
            title = buff.value
        
        class_name = ctypes.create_unicode_buffer(256)
        user32.GetClassNameW(hwnd, class_name, 256)
        
        is_visible = user32.IsWindowVisible(hwnd)
        windows.append((hwnd, pid.value, class_name.value, title, is_visible))
        return True

    user32.EnumWindows(enum_windows_proc, 0)
    return windows

all_wins = enum_windows()
mt5_wins = [w for w in all_wins if "terminal" in str(w).lower() or any(x in w[3].lower() for x in ["metatrader", "mt5", "open an account", "puprime", "xmglobal"])]
print("Found matching windows:")
for w in mt5_wins:
    print(w)

# Also check for PID 9720 directly
p9720_wins = [w for w in all_wins if w[1] == 9720]
print("Windows for PID 9720:")
for w in p9720_wins:
    print(w)
