# One-off: reorder hamburger nav (run from repo root: python _tools/update_nav_order.py).
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent

BLOCK_RE = re.compile(
    r'(?P<indent>\s*)<div class="nav-section-title">Navigation</div>\s*'
    r'(?P<links>(?:\s*<a class="nav-link(?: active)?"[^>]+>[^<]+</a>\s*)+)',
    re.MULTILINE,
)


def build_link(indent: str, href: str, label: str, active: bool) -> str:
    cls = "nav-link active" if active else "nav-link"
    return f'{indent}<a class="{cls}" href="{href}">{label}</a>'


def nav_href(path: Path, key: str) -> str:
    rel = path.relative_to(ROOT)
    parts = rel.parts
    name = parts[-1]
    subdirs = len(parts) - 2
    if subdirs < 0:
        subdirs = 0
    prefix = "../" * subdirs

    in_dm = len(parts) >= 3 and parts[1] == "data-management"
    in_curr = len(parts) >= 3 and parts[1] == "curriculums"

    if key == "dashboard":
        return f"{prefix}home-dashboard.html"
    if key == "data":
        if in_dm:
            return "college-departments.html"
        return f"{prefix}data-management/college-departments.html"
    if key == "create":
        return f"{prefix}create-schedule.html"
    if key == "room":
        return f"{prefix}room-management.html"
    if key == "curr":
        if in_curr:
            return "curriculum-filters.html"
        return f"{prefix}curriculums/curriculum-filters.html"
    if key == "reports":
        p = str(path).replace("\\", "/")
        if "report-schedule" in p or name == "report-schedules.html":
            return f"{prefix}report-schedules.html"
        return f"{prefix}final-report.html"
    if key == "requests":
        return f"{prefix}requests.html"
    if key == "account":
        return f"{prefix}account-management.html"
    if key == "logs":
        return f"{prefix}logs.html"
    raise ValueError(key)


def active_key_for_file(path: Path) -> str | None:
    p = str(path).replace("\\", "/")
    name = path.name
    if name == "home-dashboard.html":
        return "dashboard"
    if name == "create-schedule.html":
        return "create"
    if name == "room-management.html":
        return "room"
    if name in ("curriculum-filters.html", "curriculums.html") and "curriculums" in p:
        return "curr"
    if name == "final-report.html":
        return "reports"
    if name in ("report-schedules.html", "report-schedule-room.html"):
        return "reports"
    if name == "account-management.html":
        return "account"
    if name == "requests.html":
        return "requests"
    if name == "logs.html":
        return "logs"
    if "data-management" in p:
        return "data"
    return None


ORDER = [
    ("dashboard", "Dashboard"),
    ("data", "Data Management"),
    ("create", "Create Schedule"),
    ("room", "Room Management"),
    ("curr", "Curriculums"),
    ("reports", "Reports"),
    ("requests", "Requests"),
    ("account", "Account Management"),
    ("logs", "Transaction Log"),
]


def process_file(path: Path) -> bool:
    text = path.read_text(encoding="utf-8")
    m = BLOCK_RE.search(text)
    if not m:
        return False

    active = active_key_for_file(path)
    indent = "        "
    new_lines = [f'{m.group("indent")}<div class="nav-section-title">Navigation</div>']
    for k, label in ORDER:
        href = nav_href(path, k)
        new_lines.append(build_link(indent, href, label, active == k))

    new_block = "\n".join(new_lines)
    new_text = text[: m.start()] + new_block + text[m.end() :]
    if new_text != text:
        path.write_text(new_text, encoding="utf-8")
        return True
    return False


def main():
    updated = 0
    for folder in ("super-admin", "admin"):
        base = ROOT / folder
        if not base.is_dir():
            continue
        for f in base.rglob("*.html"):
            try:
                if process_file(f):
                    print("updated:", f.relative_to(ROOT))
                    updated += 1
            except Exception as e:
                print("ERR", f.relative_to(ROOT), e)
    print("done,", updated, "files")


if __name__ == "__main__":
    main()
