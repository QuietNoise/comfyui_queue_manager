import re
import json

WINDOWS_BAD = r'<>:"/\\|?*'
CONTROL_CHARS = "".join(map(chr, range(32)))

_illegal = re.compile(f"[{re.escape(WINDOWS_BAD + CONTROL_CHARS)}]")


def sanitize_filename(name: str, replacement: str = "_") -> str:
    """
    Strip or replace characters that are illegal in Windows/POSIX filenames,
    and collapse runs of the replacement char.
    """
    name = _illegal.sub(replacement, name)
    name = re.sub(rf"{re.escape(replacement)}+", replacement, name).strip(replacement)
    # Windows reserved names
    if name.upper() in {"CON", "PRN", "AUX", "NUL", *(f"{d}{n}" for d in ("COM", "LPT") for n in "123456789")}:
        name = f"_{name}"
    return name or "_"


async def requestJson(request):
    """
    Safely parse JSON from an async request object and return an empty dict on parse error.
    """
    try:
        json_data = await request.json()
    except json.JSONDecodeError:
        json_data = {}
    return json_data
