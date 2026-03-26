# meta developer: @OrangeFaHTA
# scope: hikka_only
# scope: hikka_min 1.3.0
# version: 2.0
# neuralv-module = neuralv-module

import io
import logging
import re
import time
from .. import loader, utils

logger = logging.getLogger(__name__)

CACHE_TTL = 3600
MAX_FINDINGS = 6
MAX_FRAGMENTS = 4
MAX_RECOMMENDATIONS = 5

VERDICT_ICONS = {
    "Безопасно": "✅",
    "Осторожно": "⚠️",
    "Опасно": "🚫",
}
SEVERITY_RANK = {"Низко": 0, "Средне": 1, "Высоко": 2, "Критично": 3}

TYPE_SIGNATURES = {
    "extera": {
        "label": "плагин ExteraGram",
        "patterns": [
            r"from\s+base_plugin\s+import\s+BasePlugin",
            r"class\s+\w+\(BasePlugin\)",
            r"\bHookResult\b",
            r"\bHookStrategy\b",
            r"__min_version__\s*=",
            r"def\s+on_send_message_hook\s*\(",
            r"from\s+ui\.settings\s+import",
        ],
    },
    "hikka": {
        "label": "модуль Hikka/Heroku",
        "patterns": [
            r"from\s+\.\.\s+import\s+loader\s*,\s*utils",
            r"@loader\.tds",
            r"class\s+\w+\(loader\.Module\)",
            r"loader\.ModuleConfig",
            r"loader\.ConfigValue",
            r"@loader\.command",
            r"utils\.answer\(",
        ],
    },
}

RULES = [
    {
        "id": "reverse_shell",
        "severity": "Критично",
        "score": 8,
        "title": "Есть признаки обратной командной оболочки",
        "summary": "код готовит соединение наружу и рядом с ним использует оболочку или subprocess",
        "advice": "убрать контур командной оболочки и любые вызовы системных команд",
        "patterns": [r"socket\.socket", r"subprocess\.(Popen|run|call)", r"/bin/sh", r"cmd\.exe", r"powershell"],
        "min_hits": 2,
    },
    {
        "id": "runtime_exec",
        "severity": "Высоко",
        "score": 4,
        "title": "Обнаружено динамическое выполнение кода",
        "summary": "в файле используется exec, eval или compile, то есть логика может собираться на лету",
        "advice": "заменить динамическое выполнение на обычные функции и явные ветки логики",
        "patterns": [r"\bexec\s*\(", r"\beval\s*\(", r"\bcompile\s*\(", r"\b__import__\s*\("],
    },
    {
        "id": "shell_exec",
        "severity": "Высоко",
        "score": 4,
        "title": "Есть прямой запуск системных команд",
        "summary": "код вызывает subprocess или os.system и может запускать внешние команды",
        "advice": "убрать прямые вызовы командной оболочки или жёстко ограничить допустимые команды",
        "patterns": [
            r"os\.system\s*\(",
            r"subprocess\.(Popen|run|call|check_output|check_call)\s*\(",
            r"popen\s*\(",
            r"shell\s*=\s*True",
            r"asyncio\.create_subprocess",
        ],
    },
    {
        "id": "obfuscation",
        "severity": "Средне",
        "score": 3,
        "title": "Есть признаки обфускации",
        "summary": "код использует base64, marshal, zlib или похожие приёмы маскировки полезной нагрузки",
        "advice": "проверить, зачем здесь кодирование или упаковка, и убрать её из рабочей логики",
        "patterns": [
            r"base64\.(b64decode|urlsafe_b64decode|b85decode)",
            r"marshal\.(loads|dumps)",
            r"zlib\.(decompress|compress)",
            r"bytes\.fromhex\s*\(",
            r"codecs\.decode\s*\(",
        ],
    },
    {
        "id": "network",
        "severity": "Низко",
        "score": 1,
        "title": "Файл общается с сетью",
        "summary": "в коде есть сетевой слой через requests, httpx, urllib или socket",
        "advice": "сверить список адресов и убедиться, что наружу не уходят чувствительные данные",
        "patterns": [
            r"requests\.(get|post|request|Session)",
            r"httpx\.(Client|AsyncClient|get|post|request)",
            r"urllib\.request",
            r"aiohttp\.",
            r"socket\.",
            r"websockets?\.",
        ],
    },
    {
        "id": "remote_download",
        "severity": "Средне",
        "score": 2,
        "title": "Есть загрузка данных извне",
        "summary": "код скачивает удалённый контент или подхватывает внешние файлы во время работы",
        "advice": "разрешать только доверенные источники и не выполнять скачанное без проверки",
        "patterns": [
            r"download_media\s*\(",
            r"requests\.(get|post)\s*\(",
            r"httpx\.(get|post|request)\s*\(",
            r"urllib\.request\.urlopen",
        ],
    },
    {
        "id": "secret_access",
        "severity": "Средне",
        "score": 2,
        "title": "Код обращается к секретам или токенам",
        "summary": "есть чтение токенов, сессий, ключей или переменных окружения с чувствительными данными",
        "advice": "проверить, не утекают ли эти значения дальше по сети или в логи",
        "patterns": [
            r"os\.getenv\s*\(",
            r"os\.environ",
            r"session(_string)?",
            r"api[_-]?key",
            r"Authorization",
            r"bot[_-]?token",
            r"access[_-]?token",
        ],
    },
    {
        "id": "sensitive_send",
        "severity": "Высоко",
        "score": 3,
        "title": "Есть отправка чувствительных данных",
        "summary": "код формирует исходящую отправку логов, файлов, сессий или содержимого буфера",
        "advice": "убрать отправку чувствительных данных во внешние чаты и сервисы",
        "patterns": [
            r"send_file\s*\(",
            r"send_document\s*\(",
            r"send_message\s*\(",
            r"client\.send_file\s*\(",
            r"requests\.post\s*\(",
            r"httpx\.post\s*\(",
        ],
    },
    {
        "id": "destructive_fs",
        "severity": "Высоко",
        "score": 4,
        "title": "Есть опасные действия с файловой системой",
        "summary": "код умеет удалять, перезаписывать или массово обходить файлы и каталоги",
        "advice": "убрать destructive file operations или ограничить их безопасной директорией",
        "patterns": [
            r"os\.remove\s*\(",
            r"os\.unlink\s*\(",
            r"shutil\.rmtree\s*\(",
            r"Path\([^\n]+\)\.unlink\s*\(",
            r"os\.walk\s*\(",
            r"glob\.glob\s*\(",
            r"chmod\s*\(",
        ],
    },
    {
        "id": "persistence",
        "severity": "Высоко",
        "score": 4,
        "title": "Есть признаки закрепления в системе",
        "summary": "в файле встречаются реестр, startup, cron или другие механики автозапуска",
        "advice": "убрать любые автозагрузки и фоновые закрепления, если это не заявленная функция",
        "patterns": [
            r"winreg\.",
            r"CurrentVersion\\Run",
            r"startup",
            r"schtasks",
            r"crontab",
            r"systemd",
            r"autorun",
        ],
    },
    {
        "id": "surveillance",
        "severity": "Высоко",
        "score": 4,
        "title": "Есть признаки сбора пользовательских данных",
        "summary": "код работает со скриншотами, клавиатурой, мышью, буфером обмена или похожими источниками",
        "advice": "убрать функции слежения, если модуль не позиционируется как явный админ-инструмент",
        "patterns": [
            r"pyautogui\.",
            r"ImageGrab\.",
            r"pynput\.",
            r"keyboard\.",
            r"mouse\.",
            r"clipboard",
            r"pyperclip\.",
            r"screenshot",
        ],
    },
    {
        "id": "elevation",
        "severity": "Высоко",
        "score": 5,
        "title": "Есть попытки повышения привилегий",
        "summary": "в коде видны UAC, runas, ctypes shell calls или прямые проверки админ-прав",
        "advice": "убрать privilege escalation и shell elevation из пользовательского модуля",
        "patterns": [
            r"ShellExecuteW",
            r"runas",
            r"IsUserAnAdmin",
            r"ctypes\.windll",
            r"sudo\s",
            r"pkexec",
        ],
    },
    {
        "id": "crypto",
        "severity": "Средне",
        "score": 2,
        "title": "Есть активное шифрование или работа с ключами",
        "summary": "файл использует криптографические примитивы не только для хэшей, но и для шифрования данных",
        "advice": "проверить, не шифрует ли модуль пользовательские файлы или конфиг без явной причины",
        "patterns": [
            r"Fernet",
            r"Crypto\.Cipher",
            r"AES\.new",
            r"RSA\.import_key",
            r"PBKDF2",
        ],
    },
    {
        "id": "dynamic_loader",
        "severity": "Средне",
        "score": 2,
        "title": "Есть динамическая загрузка модулей",
        "summary": "код собирает import'ы на лету и может подмешивать внешние модули во время работы",
        "advice": "перевести динамические import'ы в явные зависимости, чтобы код было проще ревизовать",
        "patterns": [
            r"importlib\.",
            r"spec_from_loader",
            r"module_from_spec",
            r"exec_module\s*\(",
        ],
    },
]

COMBOS = [
    {
        "id": "obfuscated_exec",
        "requires": ["runtime_exec", "obfuscation"],
        "severity": "Критично",
        "score": 6,
        "title": "Исполнение скрытой полезной нагрузки",
        "summary": "обфускация сочетается с exec/eval, что похоже на загрузчик или скрытый рантайм-код",
        "advice": "разбирать полезную нагрузку вручную и запрещать такой способ доставки логики",
    },
    {
        "id": "network_exec",
        "requires": ["runtime_exec", "network"],
        "severity": "Критично",
        "score": 6,
        "title": "Удалённый код может исполняться после сетевого получения",
        "summary": "сетевой слой сочетается с динамическим выполнением кода, что уже похоже на цепочку загрузки и исполнения",
        "advice": "разорвать связку сеть -> выполнение и оставлять только статически известную логику",
    },
    {
        "id": "exfiltration_chain",
        "requires": ["network", "secret_access", "sensitive_send"],
        "severity": "Высоко",
        "score": 5,
        "title": "Есть признаки эксфильтрации данных",
        "summary": "код читает секреты и рядом с этим умеет отправлять данные наружу",
        "advice": "убрать передачу токенов, сессий и содержимого локального окружения",
    },
    {
        "id": "spy_chain",
        "requires": ["surveillance", "network"],
        "severity": "Высоко",
        "score": 4,
        "title": "Есть связка наблюдения и сети",
        "summary": "сбор пользовательских данных сочетается с исходящими каналами, что уже опасно само по себе",
        "advice": "запретить отправку скриншотов, клавиатурных событий и буфера обмена во внешние каналы",
    },
    {
        "id": "autostart_payload",
        "requires": ["persistence", "shell_exec"],
        "severity": "Высоко",
        "score": 4,
        "title": "Есть попытка закрепить исполняемый сценарий",
        "summary": "автозапуск сочетается с системными командами, что похоже на механизм закрепления полезной нагрузки",
        "advice": "убрать persistence и оставить запуск только по явному действию пользователя",
    },
    {
        "id": "file_damage",
        "requires": ["destructive_fs", "crypto"],
        "severity": "Высоко",
        "score": 5,
        "title": "Есть риск порчи пользовательских файлов",
        "summary": "шифрование соседствует с destructive file operations, поэтому файл требует отдельной ревизии",
        "advice": "запретить операции над пользовательскими файлами без прозрачного и узкого сценария",
    },
]


def _escape_html(text: str) -> str:
    return utils.escape_html(text)


def _safe_snippet(line: str, limit: int = 110) -> str:
    line = re.sub(r"\s+", " ", (line or "").strip())
    if len(line) <= limit:
        return line
    return line[: limit - 1].rstrip() + "…"


def _is_probably_binary(raw: bytes) -> bool:
    if not raw:
        return False
    sample = raw[:4096]
    if b"\x00" in sample:
        return True
    bad_controls = 0
    for byte in sample:
        if byte in (9, 10, 13):
            continue
        if byte < 32:
            bad_controls += 1
    if sample and bad_controls / float(len(sample)) > 0.08:
        return True
    decoded = raw.decode("utf-8", errors="ignore")
    if not decoded.strip() and raw.strip(b"\r\n\t "):
        return True
    return False


def _decode_text(raw: bytes) -> str:
    return raw.decode("utf-8", errors="ignore").replace("\r\n", "\n").replace("\r", "\n")


def _declared_family(filename: str) -> str:
    lower = (filename or "").lower()
    if lower.endswith(".plugin"):
        return "extera"
    if lower.endswith(".py"):
        return "python"
    return "unknown"


def _detect_family(code: str) -> dict:
    scores = {}
    reasons = {}
    for family, config in TYPE_SIGNATURES.items():
        score = 0
        matched = []
        for pattern in config["patterns"]:
            if re.search(pattern, code, re.IGNORECASE | re.MULTILINE):
                score += 1
                matched.append(pattern)
        scores[family] = score
        reasons[family] = matched

    extera_score = scores.get("extera", 0)
    hikka_score = scores.get("hikka", 0)
    if extera_score == 0 and hikka_score == 0:
        return {"family": "generic", "label": "обычный Python-скрипт", "reasons": []}
    if extera_score >= hikka_score:
        return {"family": "extera", "label": TYPE_SIGNATURES["extera"]["label"], "reasons": reasons["extera"]}
    return {"family": "hikka", "label": TYPE_SIGNATURES["hikka"]["label"], "reasons": reasons["hikka"]}


def _collect_hits(lines, patterns, min_hits=1):
    hits = []
    seen = set()
    for idx, raw_line in enumerate(lines, 1):
        for pattern in patterns:
            if re.search(pattern, raw_line, re.IGNORECASE):
                key = (idx, pattern)
                if key in seen:
                    continue
                seen.add(key)
                snippet = _safe_snippet(raw_line)
                if not snippet:
                    continue
                hits.append({"line": idx, "snippet": snippet})
                break
        if len(hits) >= max(min_hits, 3):
            break
    return hits


def _sorted_findings(findings):
    return sorted(findings, key=lambda item: (item["score"], SEVERITY_RANK[item["severity"]]), reverse=True)


def _purpose_text(family: str, findings, mismatch: bool) -> str:
    if family == "extera":
        base = "По структуре это плагин для ExteraGram: код строится вокруг BasePlugin, хуков отправки сообщений и встроенных настроек клиента."
    elif family == "hikka":
        base = "По структуре это модуль для Hikka или Heroku: видны loader.Module, декораторы команд и модульный конфиг."
    else:
        base = "По структуре это обычный Python-скрипт без явной привязки к ExteraGram или Hikka."

    top_ids = {item["id"] for item in findings[:3]}
    if "reverse_shell" in top_ids or "network_exec" in top_ids or "obfuscated_exec" in top_ids:
        tail = "При этом внутри есть цепочка, похожая не на обычную прикладную логику, а на загрузчик или скрытый исполнитель полезной нагрузки."
    elif top_ids & {"surveillance", "exfiltration_chain", "sensitive_send"}:
        tail = "Основной риск здесь связан не с оформлением модуля, а с возможным сбором и выносом пользовательских данных."
    elif findings:
        tail = "В рабочую логику подмешаны спорные приёмы, поэтому файл нельзя считать нейтральным без ручной проверки."
    else:
        tail = "По найденным признакам это больше похоже на обычный служебный модуль без скрытого сетевого или системного контура."

    if mismatch:
        tail += " Дополнительно настораживает то, что имя файла не совпадает с реальной структурой содержимого."
    return base + " " + tail


def _format_format_check(filename: str, declared: str, detected: str) -> str:
    if declared == "unknown":
        return "Имя файла не даёт полезной подсказки по формату, поэтому вывод строился только по реальной структуре кода."
    if declared == "python" and detected == "generic":
        return "Расширение .py выглядит естественно: внутри обычный Python-код без маркеров плагина ExteraGram или модуля Hikka."
    if declared == "python" and detected == "hikka":
        return "Расширение .py совпадает с содержимым: внутри действительно модульный код для Hikka/Heroku."
    if declared == "extera" and detected == "extera":
        return "Расширение .plugin совпадает с содержимым: внутри действительно ExteraGram-плагин."
    if declared == "python" and detected == "extera":
        return "Файл назван как обычный .py, но по структуре это именно ExteraGram-плагин. Простое переименование уже может запутать пользователя при установке."
    if declared == "extera" and detected != "extera":
        return "Файл назван как .plugin, но его структура не похожа на ExteraGram-плагин. Такое переименование часто используют, чтобы выдать один тип модуля за другой."
    return "Формат имени и фактическая структура кода расходятся, поэтому доверять одному только расширению здесь нельзя."


def _recommendations(findings, mismatch: bool):
    items = []
    seen = set()
    if mismatch:
        items.append("Не ставьте файл только по названию: сначала сверяйте реальный тип модуля и платформу, под которую он написан.")
        seen.add(items[-1])
    for finding in findings:
        advice = finding["advice"].capitalize().rstrip(".") + "."
        if advice not in seen:
            items.append(advice)
            seen.add(advice)
        if len(items) >= MAX_RECOMMENDATIONS:
            break
    if not items:
        items.append("Перед установкой всё равно проверьте источник файла и историю автора, даже если явных красных флагов не видно.")
    return items[:MAX_RECOMMENDATIONS]


def _build_report(filename: str, analysis: dict) -> str:
    lines = []
    lines.append(f"Тип файла: {analysis['detected_label']}.")
    lines.append("")
    lines.append("Назначение:")
    lines.append(analysis["purpose"])
    lines.append("")
    lines.append("Проверка формата:")
    lines.append(analysis["format_text"])
    lines.append("")
    lines.append("Что нашлось:")
    if analysis["findings"]:
        for finding in analysis["findings"][:MAX_FINDINGS]:
            top_hit = finding["hits"][0] if finding["hits"] else None
            if top_hit:
                lines.append(f"- {finding['severity']}: {finding['summary']} (строка {top_hit['line']}).")
            else:
                lines.append(f"- {finding['severity']}: {finding['summary']}.")
    else:
        lines.append("- Явных признаков скрытой загрузки кода, стилер-логики или системного закрепления не видно.")
    lines.append("")
    lines.append("Подозрительные фрагменты:")
    if analysis["fragments"]:
        for fragment in analysis["fragments"][:MAX_FRAGMENTS]:
            lines.append(f"- строка {fragment['line']}: {fragment['snippet']}")
    else:
        lines.append("- Нечего выносить отдельным красным флагом: подозрительные фрагменты в глаза не бросаются.")
    lines.append("")
    lines.append("Рекомендации:")
    for item in analysis["recommendations"]:
        lines.append(f"- {item}")
    lines.append("")
    lines.append(f"Итог: {analysis['verdict']}")
    return "\n".join(lines).strip()


def analyze_code(filename: str, code: str) -> dict:
    code = (code or "").replace("\r\n", "\n").replace("\r", "\n")
    lines = code.split("\n")
    family_info = _detect_family(code)
    declared = _declared_family(filename)
    detected = family_info["family"]
    mismatch = (declared == "extera" and detected != "extera") or (declared == "python" and detected == "extera")

    findings = []
    triggered_ids = set()
    for rule in RULES:
        hits = _collect_hits(lines, rule["patterns"], rule.get("min_hits", 1))
        if len(hits) >= rule.get("min_hits", 1):
            triggered_ids.add(rule["id"])
            findings.append({
                "id": rule["id"],
                "title": rule["title"],
                "severity": rule["severity"],
                "score": rule["score"],
                "summary": rule["summary"],
                "advice": rule["advice"],
                "hits": hits,
            })

    for combo in COMBOS:
        if all(req in triggered_ids for req in combo["requires"]):
            findings.append({
                "id": combo["id"],
                "title": combo["title"],
                "severity": combo["severity"],
                "score": combo["score"],
                "summary": combo["summary"],
                "advice": combo["advice"],
                "hits": [],
            })

    findings = _sorted_findings(findings)
    score = sum(item["score"] for item in findings)
    if mismatch:
        score += 2

    if score >= 13:
        verdict = "Опасно"
    elif score >= 5:
        verdict = "Осторожно"
    else:
        verdict = "Безопасно"

    fragments = []
    seen_fragments = set()
    for finding in findings:
        for hit in finding.get("hits", []):
            key = (hit["line"], hit["snippet"])
            if key in seen_fragments:
                continue
            seen_fragments.add(key)
            fragments.append(hit)
            if len(fragments) >= MAX_FRAGMENTS:
                break
        if len(fragments) >= MAX_FRAGMENTS:
            break

    purpose = _purpose_text(detected, findings, mismatch)
    format_text = _format_format_check(filename, declared, detected)
    recommendations = _recommendations(findings, mismatch)

    return {
        "filename": filename,
        "detected_family": detected,
        "detected_label": family_info["label"],
        "mismatch": mismatch,
        "purpose": purpose,
        "format_text": format_text,
        "findings": findings,
        "fragments": fragments,
        "recommendations": recommendations,
        "verdict": verdict,
        "icon": VERDICT_ICONS[verdict],
        "score": score,
        "report": _build_report(filename, {
            "detected_label": family_info["label"],
            "purpose": purpose,
            "format_text": format_text,
            "findings": findings,
            "fragments": fragments,
            "recommendations": recommendations,
            "verdict": verdict,
        }),
    }


@loader.tds
class NeuralVMod(loader.Module):
    """🧠 NeuralV — локальный статический анализатор кода."""

    strings = {
        "name": "NeuralV",
        "processing": "<emoji document_id=5386367538735104399>⌛️</emoji> <b>Проверяю файл локально...</b>",
        "no_file": "<b>⚠️ NeuralV:</b> Ответь на файл или текст.",
        "non_text": "<b>❗️ NeuralV:</b> Похоже, это не текстовый файл. Локальный анализатор принимает только код и обычный текст.",
        "file_too_big": "<b>❗️ NeuralV:</b> Файл слишком большой для локального анализа (&gt;{} MB).",
        "read_failed": "<b>❗️ NeuralV:</b> Не удалось прочитать файл. Отправь его ещё раз.",
        "not_in_cache": "<b>❗️ NeuralV:</b> Файл <code>{}</code> не найден в истории.",
        "cache_expired": "<b>⏳ NeuralV:</b> Запись для <code>{}</code> устарела (&gt;{} мин). Перепроверь файл.",
        "history_empty": "📂 История пуста.",
        "history_header": "<b>📊 История анализа NeuralV:</b>\n\n",
        "result_header": "🛡 <b>Локальный отчёт:</b> <code>{}</code>\n\n",
        "cleared": "🧹 История очищена.",
    }

    def __init__(self):
        self.config = loader.ModuleConfig(
            loader.ConfigValue(
                "max_file_mb",
                10,
                lambda: "Максимальный размер файла для локального анализа (MB).",
                validator=loader.validators.Integer(minimum=1, maximum=50),
            ),
        )
        self.v_cache = {}

    def _max_bytes(self) -> int:
        max_file_mb = max(1, min(50, int(self.config.get("max_file_mb") or 10)))
        return max_file_mb * 1024 * 1024

    async def _send_report(self, message, filename: str, analysis: dict, m_status=None):
        verdict = analysis["verdict"]
        icon = analysis["icon"]
        report = analysis["report"]

        self.v_cache[filename] = {
            "report": report,
            "icon": icon,
            "word": verdict,
            "ts": time.time(),
        }

        header = self.strings["result_header"].format(filename)
        if len(report) > 3500:
            file = io.BytesIO(report.encode("utf-8"))
            file.name = f"Report_{filename}.txt"
            if m_status:
                await m_status.delete()
            return await self.client.send_file(
                message.peer_id,
                file,
                caption=header + f"<b>Итоговая оценка: {icon} {verdict}</b>",
            )

        res = header
        res += f"<blockquote expandable>{_escape_html(report)}</blockquote>\n"
        res += f"<b>Итоговая оценка: {icon} {verdict}</b>"
        return await utils.answer(m_status or message, res)

    async def _extract_code(self, reply, max_bytes: int):
        filename = ""
        try:
            filename = reply.file.name if reply.file else ""
        except Exception:
            filename = ""

        if reply.file:
            file_obj = getattr(reply, "file", None)
            file_size = getattr(file_obj, "size", None) if file_obj else None
            if file_size and isinstance(file_size, int) and file_size > max_bytes:
                return None, None, "too_big"
            raw = await self.client.download_media(reply, bytes)
            if not raw:
                return None, None, "non_text"
            if len(raw) > max_bytes:
                return None, None, "too_big"
            if _is_probably_binary(raw):
                return None, None, "non_text"
            code_content = _decode_text(raw)
        else:
            code_content = (reply.text or "").replace("\r\n", "\n").replace("\r", "\n")

        if not code_content.strip():
            return None, None, "non_text"
        if not filename:
            filename = f"snippet_{reply.id}.txt"
        return filename, code_content, None

    @loader.command()
    async def vcheck(self, message):
        """[reply] — Локальный анализ кода/файла."""
        reply = await message.get_reply_message()
        if not reply:
            return await utils.answer(message, self.strings["no_file"])

        m_status = await utils.answer(message, self.strings["processing"])
        max_bytes = self._max_bytes()
        max_file_mb = max(1, min(50, int(self.config.get("max_file_mb") or 10)))

        try:
            filename, code_content, error = await self._extract_code(reply, max_bytes)
        except Exception as e:
            logger.exception("Ошибка чтения файла: %s", e)
            return await utils.answer(m_status, self.strings["read_failed"])

        if error == "too_big":
            return await utils.answer(m_status, self.strings["file_too_big"].format(max_file_mb))
        if error:
            return await utils.answer(m_status, self.strings["non_text"])

        analysis = analyze_code(filename, code_content)
        await self._send_report(message, filename, analysis, m_status)

    @loader.command()
    async def vlist(self, message):
        """— История последних проверок."""
        if not self.v_cache:
            return await utils.answer(message, self.strings["history_empty"])

        now = time.time()
        res = self.strings["history_header"]
        for name, entry in self.v_cache.items():
            age_min = int((now - entry["ts"]) / 60)
            age_str = f"{age_min} мин. назад" if age_min < 60 else f"{age_min // 60} ч. назад"
            res += f"{entry['icon']} <code>{_escape_html(name)}</code> — <b>{entry['word']}</b> <i>({age_str})</i>\n"
        await utils.answer(message, res)

    @loader.command()
    async def vinfo(self, message):
        """[имя файла] — Показать полный отчёт из кэша."""
        args = utils.get_args_raw(message).strip()
        if not args:
            return await utils.answer(message, "⚠️ Укажи имя файла. Пример: <code>.vinfo bot.py</code>")

        entry = self.v_cache.get(args)
        if not entry:
            return await utils.answer(message, self.strings["not_in_cache"].format(_escape_html(args)))

        age_min = int((time.time() - entry["ts"]) / 60)
        if age_min > CACHE_TTL // 60:
            return await utils.answer(message, self.strings["cache_expired"].format(_escape_html(args), CACHE_TTL // 60))

        report = entry["report"]
        header = self.strings["result_header"].format(_escape_html(args))
        if len(report) > 3500:
            file = io.BytesIO(report.encode("utf-8"))
            file.name = f"Report_{args}.txt"
            return await self.client.send_file(
                message.peer_id,
                file,
                caption=header + f"<b>Итоговая оценка: {entry['icon']} {entry['word']}</b>",
            )

        res = header
        res += f"<blockquote expandable>{_escape_html(report)}</blockquote>\n"
        res += f"<b>Итоговая оценка: {entry['icon']} {entry['word']}</b>"
        await utils.answer(message, res)

    @loader.command()
    async def vclear(self, message):
        """— Очистить историю."""
        self.v_cache = {}
        await utils.answer(message, self.strings["cleared"])
