import subprocess
import time
from watchdog.observers import Observer
from watchdog.events import FileSystemEventHandler

# --- НАСТРОЙКИ ---
LOCAL_PLUGIN_PATH = "/all/code/ai/comfy/comfyui_queue_manager"
REMOTE_USER = "will"
REMOTE_HOST = "aithor.local"
REMOTE_PLUGIN_PATH = "/home/will/comfy/ComfyUI/custom_nodes/comfyui_queue_manager"
RESTART_SCRIPT_REMOTE = "/home/will/restart_comfy.sh"  # Скрипт на сервере (см. ниже)


# -----------------

class RemoteSyncHandler(FileSystemEventHandler):
    def __init__(self):
        self.debounce_timer = None

    def on_modified(self, event):
        # Фильтруем только нужные файлы и игнорируем временные файлы редакторов
        if event.is_directory:
            return
        if not event.src_path.endswith(('.py', '.js', '.json')):
            return
        if any(ignore in event.src_path for ignore in ['.git', '__pycache__', '.swp', '~']):
            return

        # Debounce: чтобы не спамить сервер при массовом сохранении (Ctrl+S всех файлов)
        if self.debounce_timer:
            self.debounce_timer.cancel()
        self.debounce_timer = time.Timer(1.0, self.sync_and_restart)
        self.debounce_timer.start()

    def sync_and_restart(self):
        print(f"\n[!] Изменение обнаружено. Синхронизация с {REMOTE_HOST}...")

        # 1. Rsync (эффективная синхронизация)
        rsync_cmd = [
            "rsync", "-avz", "--delete",
            "--exclude", ".git/",
            "--exclude", "__pycache__/",
            "--exclude", ".venv/",
            f"{LOCAL_PLUGIN_PATH}/",
            f"{REMOTE_USER}@{REMOTE_HOST}:{REMOTE_PLUGIN_PATH}/"
        ]

        try:
            subprocess.run(rsync_cmd, check=True, stdout=subprocess.DEVNULL)
            print("[*] Файлы синхронизированы.")

            # 2. Перезапуск ComfyUI на сервере
            print("[*] Отправка команды перезапуска...")
            # ssh_cmd = ["ssh", f"{REMOTE_USER}@{REMOTE_HOST}", f"bash {RESTART_SCRIPT_REMOTE}"]
            # subprocess.run(ssh_cmd, check=True)
            print("[+] ComfyUI на сервере перезагружен. Можно тестировать!")

        except subprocess.CalledProcessError as e:
            print(f"[!] Ошибка при синхронизации или перезапуске: {e}")


if __name__ == "__init__":
    pass  # Для корректной работы в некоторых окружениях

if __name__ == "__main__":
    handler = RemoteSyncHandler()
    observer = Observer()
    observer.schedule(handler, LOCAL_PLUGIN_PATH, recursive=True)
    observer.start()
    print(f"[*] Слежение за {LOCAL_PLUGIN_PATH} запущено. Изменения будут отправляться на {REMOTE_HOST}")
    print("[*] Нажмите Ctrl+C для остановки.")

    try:
        while True:
            time.sleep(1)
    except KeyboardInterrupt:
        observer.stop()
    observer.join()
