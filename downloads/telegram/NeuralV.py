# meta developer: @OrangeFaHTA
# scope: hikka_only
# scope: hikka_min 1.3.0
# version: 3.0
# neuralv-module = neuralv-module

import asyncio
import hashlib
import io
import json
import logging
import os
import re
import time
from typing import Dict, List

import requests
from .. import loader, utils

logger = logging.getLogger(__name__)

CACHE_TTL = 3600
MAX_FINDINGS = 6
MAX_FRAGMENTS = 4
MAX_BATCH_RESULTS = 18
AI_REVIEW_URL = "https://neuralvv.org/basedata/api/ai/plugin-review/summary"
AI_TIMEOUT = 45

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
        "title": "Есть признаки обратной оболочки",
        "summary": "сеть сочетается с запуском командной оболочки или subprocess",
        "patterns": [r"socket\.socket", r"subprocess\.(Popen|run|call)", r"/bin/sh", r"cmd\.exe", r"powershell"],
        "min_hits": 2,
    },
    {
        "id": "runtime_exec",
        "severity": "Высоко",
        "score": 4,
        "title": "Есть динамическое выполнение кода",
        "summary": "файл использует exec, eval, compile или динамический import",
        "patterns": [r"\bexec\s*\(", r"\beval\s*\(", r"\bcompile\s*\(", r"\b__import__\s*\("],
    },
    {
        "id": "shell_exec",
        "severity": "Высоко",
        "score": 4,
        "title": "Есть запуск системных команд",
        "summary": "код вызывает subprocess или os.system",
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
        "summary": "внутри есть base64, marshal, zlib или похожая маскировка",
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
        "title": "Есть сетевой слой",
        "summary": "код делает HTTP-запросы или работает с сокетами",
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
        "summary": "код скачивает внешний контент во время работы",
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
        "title": "Есть доступ к токенам или секретам",
        "summary": "файл читает токены, сессии, ключи или чувствительные переменные",
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
        "summary": "код умеет отправлять файлы, сообщения или логи наружу",
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
        "title": "Есть опасные действия с файлами",
        "summary": "файл умеет удалять, обходить или массово менять содержимое файловой системы",
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
        "title": "Есть признаки закрепления",
        "summary": "в коде встречаются автозагрузка, cron, startup или похожие механики",
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
        "title": "Есть признаки слежения",
        "summary": "код работает со скриншотами, клавиатурой, мышью или буфером обмена",
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
        "summary": "код использует runas, ctypes shell calls или проверки админ-прав",
        "patterns": [r"ShellExecuteW", r"runas", r"IsUserAnAdmin", r"ctypes\.windll", r"sudo\s", r"pkexec"],
    },
]

COMBOS = [
    {
        "id": "obfuscated_exec",
        "requires": ["runtime_exec", "obfuscation"],
        "severity": "Критично",
        "score": 6,
        "title": "Есть скрытая исполняемая нагрузка",
        "summary": "обфускация сочетается с exec/eval",
    },
    {
        "id": "network_exec",
        "requires": ["runtime_exec", "network"],
        "severity": "Критично",
        "score": 6,
        "title": "Сеть связана с исполнением кода",
        "summary": "после сетевого получения код может исполняться на лету",
    },
    {
        "id": "exfiltration_chain",
        "requires": ["network", "secret_access", "sensitive_send"],
        "severity": "Высоко",
        "score": 5,
        "title": "Есть признаки выноса данных",
        "summary": "секреты читаются и рядом же могут отправляться наружу",
    },
]


def _escape_html(text: str) -> str:
    return utils.escape_html(text)


def _safe_snippet(line: str, limit: int = 120) -> str:
    compact = re.sub(r"\s+", " ", (line or "").strip())
    if len(compact) <= limit:
        return compact
    return compact[: limit - 1].rstrip() + "…"


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
    return not decoded.strip() and bool(raw.strip(b"\r\n\t "))


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

    return {
        "filename": filename,
        "detected_family": detected,
        "detected_label": family_info["label"],
        "declared_family": declared,
        "mismatch": mismatch,
        "findings": findings,
        "fragments": fragments,
        "verdict": verdict,
        "icon": VERDICT_ICONS[verdict],
        "score": score,
    }


def _build_local_summary(analysis: dict) -> str:
    parts = [
        f"Тип: {analysis['detected_label']}",
        f"Локальный вердикт: {analysis['verdict']}",
        f"Счёт риска: {analysis['score']}",
    ]
    if analysis["mismatch"]:
        parts.append("Есть несовпадение между именем файла и реальной структурой")
    if analysis["findings"]:
        titles = "; ".join(item["title"] for item in analysis["findings"][:4])
        parts.append(f"Главные сигналы: {titles}")
    else:
        parts.append("Явных опасных сигнатур нет")
    return ". ".join(parts) + "."


def _build_ai_analysis_text(filename: str, code: str, analysis: dict) -> str:
    lines = [
        f"Файл: {filename}",
        f"Тип: {analysis['detected_label']}",
        f"Локальный вердикт: {analysis['verdict']}",
        f"Счёт риска: {analysis['score']}",
        f"Несовпадение формата: {'да' if analysis['mismatch'] else 'нет'}",
        "",
        "Локальные сигналы:",
    ]
    if analysis["findings"]:
        for finding in analysis["findings"][:MAX_FINDINGS]:
            line_info = ""
            if finding.get("hits"):
                line_info = f" (строка {finding['hits'][0]['line']})"
            lines.append(f"- [{finding['severity']}] {finding['title']}: {finding['summary']}{line_info}")
    else:
        lines.append("- Явных красных флагов локальный слой не нашёл.")
    if analysis["fragments"]:
        lines.extend(["", "Фрагменты:"])
        for fragment in analysis["fragments"][:MAX_FRAGMENTS]:
            lines.append(f"- строка {fragment['line']}: {fragment['snippet']}")
    lines.extend(["", "Код:", code[:12000]])
    return "\n".join(lines)


def _to_api_finding(finding: dict) -> dict:
    return {
        "severity": finding["severity"],
        "title": finding["title"],
        "summary": finding["summary"],
        "line": finding["hits"][0]["line"] if finding.get("hits") else None,
        "snippets": [item["snippet"] for item in finding.get("hits", [])[:2]],
    }


def _merge_verdicts(local_verdict: str, ai_suggestion: str) -> str:
    order = {"Безопасно": 0, "Осторожно": 1, "Опасно": 2}
    ai_map = {
        "clean": "Безопасно",
        "review": "Осторожно",
        "block": "Опасно",
    }
    ai_verdict = ai_map.get(str(ai_suggestion or "").strip().lower(), local_verdict)
    return local_verdict if order[local_verdict] >= order[ai_verdict] else ai_verdict


def _hash_content(filename: str, content: str) -> str:
    return hashlib.sha256(f"{filename}\n{content}".encode("utf-8", "ignore")).hexdigest()


@loader.tds
class NeuralVMod(loader.Module):
    """NeuralV: ответьте .nv на файл или используйте .nv all."""

    strings = {
        "name": "NeuralV",
        "processing": "<emoji document_id=5386367538735104399>⌛️</emoji> <b>NeuralV проверяет файл…</b>",
        "processing_batch": "<emoji document_id=5386367538735104399>⌛️</emoji> <b>NeuralV проверяет установленные модули…</b>",
        "usage": "<b>NeuralV:</b> ответь <code>.nv</code> на файл или текст. Для пакетной проверки используй <code>.nv all</code>.",
        "non_text": "<b>NeuralV:</b> нужен текстовый файл или текстовое сообщение.",
        "file_too_big": "<b>NeuralV:</b> файл слишком большой (&gt;{} MB).",
        "read_failed": "<b>NeuralV:</b> не удалось прочитать файл. Отправь его ещё раз.",
        "history_empty": "<b>NeuralV:</b> для пакетной проверки не нашлось файлов модулей.",
    }

    def __init__(self):
        self.config = loader.ModuleConfig(
            loader.ConfigValue(
                "max_file_mb",
                10,
                lambda: "Максимальный размер файла для проверки (MB).",
                validator=loader.validators.Integer(minimum=1, maximum=25),
            )
        )
        self.analysis_cache = {}

    def _max_bytes(self) -> int:
        max_file_mb = max(1, min(25, int(self.config.get("max_file_mb") or 10)))
        return max_file_mb * 1024 * 1024

    async def _request_ai_review(self, filename: str, code: str, analysis: dict) -> dict:
        payload = {
            "summary": _build_local_summary(analysis),
            "analysis": _build_ai_analysis_text(filename, code, analysis),
            "findings": [_to_api_finding(item) for item in analysis["findings"][:MAX_FINDINGS]],
            "file": {
                "filename": filename,
                "declared_type": analysis["declared_family"],
                "detected_type": analysis["detected_family"],
            },
            "meta": {
                "plugin_surface": "hikka",
                "local_verdict": analysis["verdict"],
                "local_score": analysis["score"],
                "mismatch": analysis["mismatch"],
            },
        }

        def _call():
            response = requests.post(AI_REVIEW_URL, json=payload, timeout=AI_TIMEOUT)
            if not response.ok:
                raise RuntimeError(f"HTTP {response.status_code}")
            data = response.json()
            if not data.get("success"):
                raise RuntimeError(data.get("error") or "AI review failed")
            return data

        loop = asyncio.get_running_loop()
        try:
            return await loop.run_in_executor(None, _call)
        except Exception as error:
            logger.warning("NeuralV AI review failed for %s: %s", filename, error)
            return {
                "success": False,
                "summary": "Серверный разбор сейчас недоступен. Показан только локальный результат.",
                "bullets": [],
                "verdict_suggestion": "review",
            }

    def _compose_report(self, filename: str, analysis: dict, ai_result: dict) -> dict:
        ai_summary = str(ai_result.get("summary") or "").strip()
        ai_bullets = [str(item).strip() for item in (ai_result.get("bullets") or []) if str(item).strip()]
        final_verdict = _merge_verdicts(analysis["verdict"], ai_result.get("verdict_suggestion"))
        final_icon = VERDICT_ICONS[final_verdict]

        lines = [
            f"Файл: {filename}",
            f"Тип: {analysis['detected_label']}",
            f"Локально: {analysis['icon']} {analysis['verdict']}",
            f"Итог: {final_icon} {final_verdict}",
        ]
        if analysis["mismatch"]:
            lines.append("Формат: имя файла не совпадает с реальной структурой")
        lines.append("")
        lines.append("Кратко:")
        lines.append(ai_summary or "Серверный разбор не дал краткой сводки.")
        lines.append("")
        lines.append("Сигналы:")
        if analysis["findings"]:
            for finding in analysis["findings"][:MAX_FINDINGS]:
                line_info = f" • строка {finding['hits'][0]['line']}" if finding.get('hits') else ""
                lines.append(f"- [{finding['severity']}] {finding['title']}{line_info}")
        else:
            lines.append("- Явных красных флагов локальный слой не нашёл.")
        if ai_bullets:
            lines.append("")
            lines.append("AI отметил:")
            for item in ai_bullets:
                lines.append(f"- {item}")
        return {
            "verdict": final_verdict,
            "icon": final_icon,
            "report": "\n".join(lines).strip(),
        }

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

    async def _analyze_single(self, filename: str, code_content: str) -> dict:
        content_hash = _hash_content(filename, code_content)
        cached = self.analysis_cache.get(content_hash)
        if cached and (time.time() - cached.get("ts", 0)) < CACHE_TTL:
            return cached["result"]

        analysis = analyze_code(filename, code_content)
        ai_result = await self._request_ai_review(filename, code_content, analysis)
        result = self._compose_report(filename, analysis, ai_result)
        self.analysis_cache[content_hash] = {"ts": time.time(), "result": result}
        return result

    async def _send_report(self, message, filename: str, result: dict, m_status=None):
        report = result["report"]
        header = f"🛡 <b>NeuralV:</b> <code>{_escape_html(filename)}</code>\n\n"
        if len(report) > 3500:
            file = io.BytesIO(report.encode("utf-8"))
            file.name = f"NeuralV_{filename}.txt"
            if m_status:
                await m_status.delete()
            return await self.client.send_file(
                message.peer_id,
                file,
                caption=header + f"<b>Итог: {result['icon']} {result['verdict']}</b>",
            )

        text = header + f"<blockquote expandable>{_escape_html(report)}</blockquote>\n<b>Итог: {result['icon']} {result['verdict']}</b>"
        return await utils.answer(m_status or message, text)

    def _iter_installed_module_files(self) -> List[str]:
        modules_dir = os.path.normpath(os.path.join(utils.get_base_dir(), "..", "modules"))
        if not os.path.isdir(modules_dir):
            return []
        result = []
        for name in sorted(os.listdir(modules_dir)):
            if name.startswith('.'):
                continue
            if not name.endswith((".py", ".plugin")):
                continue
            full_path = os.path.join(modules_dir, name)
            if os.path.isfile(full_path):
                result.append(full_path)
        return result

    async def _scan_installed_modules(self, message, m_status):
        max_bytes = self._max_bytes()
        files = self._iter_installed_module_files()
        if not files:
            return await utils.answer(m_status, self.strings["history_empty"])

        results = []
        for path in files[:MAX_BATCH_RESULTS]:
            try:
                with open(path, "rb") as handle:
                    raw = handle.read(max_bytes + 1)
                if len(raw) > max_bytes or _is_probably_binary(raw):
                    continue
                code = _decode_text(raw)
                if not code.strip():
                    continue
                local = analyze_code(os.path.basename(path), code)
                if local["verdict"] == "Безопасно" and local["score"] < 4:
                    final = {"verdict": local["verdict"], "icon": local["icon"], "report": "Явных спорных сигналов нет."}
                else:
                    final = await self._analyze_single(os.path.basename(path), code)
                results.append({
                    "name": os.path.basename(path),
                    "verdict": final["verdict"],
                    "icon": final["icon"],
                })
            except Exception as error:
                logger.warning("NeuralV batch scan failed for %s: %s", path, error)

        if not results:
            return await utils.answer(m_status, self.strings["history_empty"])

        order = {"Безопасно": 0, "Осторожно": 1, "Опасно": 2}
        results.sort(key=lambda item: order[item["verdict"]], reverse=True)
        lines = ["<b>NeuralV: установленные модули</b>", ""]
        for item in results:
            lines.append(f"{item['icon']} <code>{_escape_html(item['name'])}</code> — <b>{item['verdict']}</b>")
        await utils.answer(m_status, "\n".join(lines))

    @loader.command()
    async def nv(self, message):
        """[reply|all] — ответьте на файл для проверки или используйте all."""
        args = (utils.get_args_raw(message) or "").strip().lower()
        if args == "all":
            m_status = await utils.answer(message, self.strings["processing_batch"])
            return await self._scan_installed_modules(message, m_status)

        reply = await message.get_reply_message()
        if not reply:
            return await utils.answer(message, self.strings["usage"])

        m_status = await utils.answer(message, self.strings["processing"])
        max_bytes = self._max_bytes()
        max_file_mb = max(1, min(25, int(self.config.get("max_file_mb") or 10)))

        try:
            filename, code_content, error = await self._extract_code(reply, max_bytes)
        except Exception as error:
            logger.exception("NeuralV read error: %s", error)
            return await utils.answer(m_status, self.strings["read_failed"])

        if error == "too_big":
            return await utils.answer(m_status, self.strings["file_too_big"].format(max_file_mb))
        if error:
            return await utils.answer(m_status, self.strings["non_text"])

        result = await self._analyze_single(filename, code_content)
        return await self._send_report(message, filename, result, m_status)
