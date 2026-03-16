#include <windows.h>
#include <commctrl.h>
#include <uxtheme.h>
#include <shellapi.h>
#include <urlmon.h>

#include <atomic>
#include <cmath>
#include <filesystem>
#include <string>
#include <thread>
#include <vector>

#include "NeuralV/ApiClient.h"
#include "NeuralV/Config.h"
#include "NeuralV/SessionStore.h"
#include "NeuralV/Theme.h"

#pragma comment(lib, "urlmon.lib")

namespace {

enum class Screen {
    Splash,
    Welcome,
    Login,
    Register,
    Code,
    Scan,
    Home,
    History,
    Settings
};

enum ControlId : int {
    IdName = 1001,
    IdEmail,
    IdPassword,
    IdPasswordRepeat,
    IdCode,
    IdPrimary,
    IdSecondary,
    IdTertiary,
    IdScan,
    IdHistory,
    IdSettings,
    IdLogout
};

struct AppContext {
    HINSTANCE instance = nullptr;
    HWND hwnd = nullptr;
    neuralv::ThemePalette palette{};
    neuralv::ApiClient api{};
    Screen screen = Screen::Splash;
    DWORD splashStartedAt = 0;
    std::wstring deviceId;
    std::wstring status;
    neuralv::ChallengeTicket challenge{};
    neuralv::SessionData session{};
    std::wstring activeScanId;
    std::wstring scanStatus;
    std::wstring scanVerdict;
    std::vector<std::wstring> scanTimeline;
    int scanProgress = 0;
    bool scanRunning = false;
    bool scanFinished = false;
    std::atomic_bool scanCancelRequested = false;
    HFONT titleFont = nullptr;
    HFONT bodyFont = nullptr;
    HFONT smallFont = nullptr;
};

struct ScanUpdatePayload {
    std::wstring scanId;
    std::wstring status;
    std::wstring verdict;
    std::wstring message;
    std::vector<std::wstring> timeline;
    int progress = 0;
    bool finished = false;
};

AppContext g_app;

HWND g_name = nullptr;
HWND g_email = nullptr;
HWND g_password = nullptr;
HWND g_passwordRepeat = nullptr;
HWND g_code = nullptr;
HWND g_primary = nullptr;
HWND g_secondary = nullptr;
HWND g_tertiary = nullptr;
HWND g_scan = nullptr;
HWND g_history = nullptr;
HWND g_settings = nullptr;
HWND g_logout = nullptr;

constexpr wchar_t kWindowClass[] = L"NeuralVNativeWindow";
constexpr UINT_PTR kSplashTimer = 1;
constexpr UINT_PTR kInputSubclassId = 100;
constexpr UINT WM_NEURALV_SCAN_UPDATE = WM_APP + 10;
constexpr UINT WM_NEURALV_SCAN_FINISH = WM_APP + 11;

RECT GetClientArea(HWND hwnd) {
    RECT rect{};
    GetClientRect(hwnd, &rect);
    return rect;
}

std::wstring ReadControlText(HWND control) {
    const int size = GetWindowTextLengthW(control);
    std::wstring value(size + 1, L'\0');
    GetWindowTextW(control, value.data(), size + 1);
    value.resize(size);
    return value;
}

void ShowControl(HWND hwnd, bool visible) {
    ShowWindow(hwnd, visible ? SW_SHOW : SW_HIDE);
    EnableWindow(hwnd, visible);
}

void ApplyModernControlTheme(HWND hwnd) {
    SetWindowTheme(hwnd, L"Explorer", nullptr);
    SendMessageW(hwnd, WM_SETFONT, reinterpret_cast<WPARAM>(g_app.bodyFont), TRUE);
}

void SetCue(HWND hwnd, const wchar_t* text) {
    SendMessageW(hwnd, EM_SETCUEBANNER, TRUE, reinterpret_cast<LPARAM>(text));
}

void ClearInputs() {
    SetWindowTextW(g_name, L"");
    SetWindowTextW(g_email, L"");
    SetWindowTextW(g_password, L"");
    SetWindowTextW(g_passwordRepeat, L"");
    SetWindowTextW(g_code, L"");
}

bool DownloadFile(const std::wstring& url, const std::wstring& destination) {
    return URLDownloadToFileW(nullptr, url.c_str(), destination.c_str(), 0, nullptr) == S_OK;
}

std::wstring TempFilePath(const std::wstring& fileName) {
    wchar_t buffer[MAX_PATH]{};
    GetTempPathW(MAX_PATH, buffer);
    return std::wstring(buffer) + fileName;
}

std::wstring ReadEnvVar(const wchar_t* key) {
    const DWORD needed = GetEnvironmentVariableW(key, nullptr, 0);
    if (needed == 0) {
        return {};
    }
    std::wstring value(needed, L'\0');
    GetEnvironmentVariableW(key, value.data(), needed);
    if (!value.empty() && value.back() == L'\0') {
        value.pop_back();
    }
    return value;
}

std::vector<std::wstring> DetectWindowsRoots() {
    std::vector<std::wstring> roots;
    const auto add = [&roots](const std::wstring& value) {
        if (value.empty()) {
            return;
        }
        for (const auto& existing : roots) {
            if (_wcsicmp(existing.c_str(), value.c_str()) == 0) {
                return;
            }
        }
        roots.push_back(value);
    };
    add(ReadEnvVar(L"ProgramFiles"));
    add(ReadEnvVar(L"ProgramFiles(x86)"));
    add(ReadEnvVar(L"ProgramData"));
    const auto localAppData = ReadEnvVar(L"LOCALAPPDATA");
    add(localAppData);
    if (!localAppData.empty()) {
        add(localAppData + L"\\Programs");
    }
    add(ReadEnvVar(L"APPDATA"));
    const auto userProfile = ReadEnvVar(L"USERPROFILE");
    if (!userProfile.empty()) {
        add(userProfile + L"\\Desktop");
        add(userProfile + L"\\Downloads");
    }
    return roots;
}

int ProgressForStatus(const std::wstring& status, bool finished) {
    if (finished) return 100;
    if (_wcsicmp(status.c_str(), L"RUNNING") == 0) return 72;
    if (_wcsicmp(status.c_str(), L"QUEUED") == 0) return 28;
    if (_wcsicmp(status.c_str(), L"AWAITING_UPLOAD") == 0) return 16;
    return 8;
}

void PostScanPayload(UINT message, ScanUpdatePayload* payload) {
    if (!g_app.hwnd) {
        delete payload;
        return;
    }
    PostMessageW(g_app.hwnd, message, 0, reinterpret_cast<LPARAM>(payload));
}

void MaybeRunAutoUpdate() {
    const auto update = g_app.api.CheckForUpdate(NEURALV_VERSION_W);
    if (!update.available || update.setupUrl.empty()) {
        return;
    }
    const std::wstring setupPath = TempFilePath(L"NeuralVSetup-latest.exe");
    g_app.status = L"Обновляем NeuralV...";
    InvalidateRect(g_app.hwnd, nullptr, TRUE);
    if (!DownloadFile(update.setupUrl, setupPath)) {
        g_app.status = L"Автообновление недоступно.";
        return;
    }
    ShellExecuteW(g_app.hwnd, L"open", setupPath.c_str(), L"--self-update --no-launch", nullptr, SW_SHOWNORMAL);
    PostQuitMessage(0);
}

void StartDesktopScanAsync() {
    if (!g_app.session.IsValid() || g_app.scanRunning) {
        return;
    }

    g_app.activeScanId.clear();
    g_app.scanStatus = L"Подготавливаем системные каталоги...";
    g_app.scanVerdict.clear();
    g_app.scanTimeline = { L"Определяем каталоги Windows" };
    g_app.scanProgress = 10;
    g_app.scanRunning = true;
    g_app.scanFinished = false;
    g_app.scanCancelRequested = false;
    g_app.status.clear();

    const auto session = g_app.session;
    std::thread([session]() {
        auto initial = new ScanUpdatePayload();
        initial->status = L"Подключаем backend";
        initial->message = L"NeuralV запускает серверную desktop-проверку Windows.";
        initial->timeline = { L"Подготовка", L"Старт задачи" };
        initial->progress = 18;
        PostScanPayload(WM_NEURALV_SCAN_UPDATE, initial);

        const auto roots = DetectWindowsRoots();
        std::wstring error;
        auto scan = g_app.api.StartDesktopScan(
            session,
            L"WINDOWS",
            L"FULL",
            L"EXECUTABLE",
            L"Windows host",
            !roots.empty() ? roots.front() : L"C:\\",
            roots,
            roots,
            error
        );
        if (!scan) {
            auto failure = new ScanUpdatePayload();
            failure->status = L"Ошибка запуска проверки";
            failure->message = error.empty() ? L"Не удалось создать desktop-задачу" : error;
            failure->timeline = { L"Старт desktop-задачи" };
            failure->progress = 0;
            failure->finished = true;
            PostScanPayload(WM_NEURALV_SCAN_FINISH, failure);
            return;
        }

        while (true) {
            auto update = new ScanUpdatePayload();
            update->scanId = scan->id;
            update->status = scan->status.empty() ? L"RUNNING" : scan->status;
            update->verdict = scan->verdict;
            update->message = scan->message;
            update->timeline = scan->timeline;
            update->finished =
                _wcsicmp(update->status.c_str(), L"COMPLETED") == 0 ||
                _wcsicmp(update->status.c_str(), L"FAILED") == 0 ||
                _wcsicmp(update->status.c_str(), L"CANCELLED") == 0;
            update->progress = ProgressForStatus(update->status, update->finished);
            PostScanPayload(update->finished ? WM_NEURALV_SCAN_FINISH : WM_NEURALV_SCAN_UPDATE, update);

            if (update->finished || g_app.scanCancelRequested.load()) {
                return;
            }

            Sleep(2200);
            scan = g_app.api.GetDesktopScan(session, scan->id, error);
            if (!scan) {
                auto failure = new ScanUpdatePayload();
                failure->status = L"Ошибка чтения проверки";
                failure->message = error.empty() ? L"Не удалось получить статус desktop-задачи" : error;
                failure->timeline = { L"Polling desktop-задачи" };
                failure->progress = 0;
                failure->finished = true;
                PostScanPayload(WM_NEURALV_SCAN_FINISH, failure);
                return;
            }
        }
    }).detach();
}

void LayoutControls() {
    RECT rect = GetClientArea(g_app.hwnd);
    const int left = 104;
    const int top = 228;
    const int width = 460;
    const int height = 42;
    const int gap = 18;

    MoveWindow(g_name, left, top, width, height, TRUE);
    MoveWindow(g_email, left, top + (height + gap), width, height, TRUE);
    MoveWindow(g_password, left, top + 2 * (height + gap), width, height, TRUE);
    MoveWindow(g_passwordRepeat, left, top + 3 * (height + gap), width, height, TRUE);
    MoveWindow(g_code, left, top + height + gap, width, height, TRUE);

    MoveWindow(g_primary, left, rect.bottom - 176, 220, 46, TRUE);
    MoveWindow(g_secondary, left + 238, rect.bottom - 176, 220, 46, TRUE);
    MoveWindow(g_tertiary, left, rect.bottom - 118, 458, 40, TRUE);

    const int cardTop = 310;
    MoveWindow(g_scan, left, cardTop, 200, 132, TRUE);
    MoveWindow(g_history, left + 220, cardTop, 200, 132, TRUE);
    MoveWindow(g_settings, left + 440, cardTop, 200, 132, TRUE);
    MoveWindow(g_logout, left, rect.bottom - 176, 220, 46, TRUE);
}

void SetScreen(Screen screen) {
    g_app.screen = screen;

    ShowControl(g_name, screen == Screen::Register);
    ShowControl(g_email, screen == Screen::Login || screen == Screen::Register);
    ShowControl(g_password, screen == Screen::Login || screen == Screen::Register);
    ShowControl(g_passwordRepeat, screen == Screen::Register);
    ShowControl(g_code, screen == Screen::Code);

    ShowControl(g_primary, screen == Screen::Welcome || screen == Screen::Login || screen == Screen::Register || screen == Screen::Code || screen == Screen::Scan || screen == Screen::History || screen == Screen::Settings);
    ShowControl(g_secondary, screen == Screen::Welcome || screen == Screen::Login || screen == Screen::Register || screen == Screen::Code || screen == Screen::Scan || screen == Screen::History || screen == Screen::Settings);
    ShowControl(g_tertiary, screen == Screen::Code);

    ShowControl(g_scan, screen == Screen::Home);
    ShowControl(g_history, screen == Screen::Home);
    ShowControl(g_settings, screen == Screen::Home);
    ShowControl(g_logout, screen == Screen::Settings);

    switch (screen) {
    case Screen::Welcome:
        SetWindowTextW(g_primary, L"Войти");
        SetWindowTextW(g_secondary, L"Регистрация");
        break;
    case Screen::Login:
    case Screen::Register:
        SetWindowTextW(g_primary, L"Продолжить");
        SetWindowTextW(g_secondary, L"Назад");
        break;
    case Screen::Code:
        SetWindowTextW(g_primary, L"Подтвердить");
        SetWindowTextW(g_secondary, L"Назад");
        SetWindowTextW(g_tertiary, L"Код отправлен");
        break;
    case Screen::Scan:
        SetWindowTextW(g_primary, L"Назад");
        SetWindowTextW(g_secondary, g_app.scanRunning && !g_app.scanFinished ? L"Отменить" : L"Готово");
        break;
    case Screen::History:
    case Screen::Settings:
        SetWindowTextW(g_primary, L"Назад");
        SetWindowTextW(g_secondary, screen == Screen::Settings ? L"Обновить" : L"Скоро");
        break;
    default:
        break;
    }

    InvalidateRect(g_app.hwnd, nullptr, TRUE);
}

void BootstrapAfterSplash() {
    MaybeRunAutoUpdate();
    const auto session = neuralv::LoadSession();
    if (!session) {
        g_app.status = L"Войди в аккаунт, чтобы открыть Windows-клиент.";
        SetScreen(Screen::Welcome);
        return;
    }

    std::wstring error;
    if (const auto refreshed = g_app.api.RefreshSession(*session, error)) {
        g_app.session = *refreshed;
        neuralv::SaveSession(g_app.session);
        g_app.status = L"Сессия восстановлена.";
        SetScreen(Screen::Home);
        return;
    }

    neuralv::ClearSession();
    g_app.status = error.empty() ? std::wstring(L"Сессия устарела. Войди снова.") : error;
    SetScreen(Screen::Welcome);
}

void SubmitAuth() {
    if (g_app.screen == Screen::Login) {
        g_app.challenge = g_app.api.StartLogin(ReadControlText(g_email), ReadControlText(g_password), g_app.deviceId);
    } else if (g_app.screen == Screen::Register) {
        if (ReadControlText(g_password) != ReadControlText(g_passwordRepeat)) {
            g_app.status = L"Пароли не совпадают.";
            InvalidateRect(g_app.hwnd, nullptr, TRUE);
            return;
        }
        g_app.challenge = g_app.api.StartRegister(ReadControlText(g_name), ReadControlText(g_email), ReadControlText(g_password), g_app.deviceId);
    }

    if (!g_app.challenge.ok()) {
        g_app.status = g_app.challenge.error.empty() ? std::wstring(L"Не удалось начать авторизацию.") : g_app.challenge.error;
        InvalidateRect(g_app.hwnd, nullptr, TRUE);
        return;
    }

    g_app.status = L"Код отправлен на почту.";
    SetScreen(Screen::Code);
}

void VerifyCode() {
    std::wstring error;
    const auto session = g_app.api.VerifyChallenge(g_app.challenge.mode, g_app.challenge.challengeId, g_app.challenge.email, ReadControlText(g_code), g_app.deviceId, error);
    if (!session) {
        g_app.status = error.empty() ? std::wstring(L"Код не принят.") : error;
        InvalidateRect(g_app.hwnd, nullptr, TRUE);
        return;
    }

    g_app.session = *session;
    neuralv::SaveSession(g_app.session);
    g_app.status = L"Вход выполнен.";
    ClearInputs();
    SetScreen(Screen::Home);
}

void Logout() {
    g_app.api.Logout(g_app.session);
    neuralv::ClearSession();
    g_app.session = {};
    g_app.status = L"Сессия закрыта.";
    ClearInputs();
    SetScreen(Screen::Welcome);
}

void DrawCard(HDC hdc, const RECT& rect) {
    HBRUSH brush = CreateSolidBrush(g_app.palette.surface);
    HBRUSH outlineBrush = CreateSolidBrush(g_app.palette.outline);
    FrameRect(hdc, &rect, outlineBrush);
    RECT inner = rect;
    InflateRect(&inner, -1, -1);
    FillRect(hdc, &inner, brush);
    DeleteObject(brush);
    DeleteObject(outlineBrush);
}

void PaintSplash(HDC hdc, const RECT& rect) {
    const double t = (GetTickCount() - g_app.splashStartedAt) / 1000.0;
    const int cx = (rect.right - rect.left) / 2;
    const int cy = (rect.bottom - rect.top) / 2 - 18;
    const int outer = 122 + static_cast<int>(std::sin(t * 4.0) * 12.0);
    const int inner = 76 + static_cast<int>(std::sin(t * 5.7) * 8.0);

    HBRUSH outerBrush = CreateSolidBrush(neuralv::BlendColor(g_app.palette.accent, g_app.palette.background, 0.52));
    HBRUSH innerBrush = CreateSolidBrush(g_app.palette.accent);
    SelectObject(hdc, outerBrush);
    Ellipse(hdc, cx - outer, cy - outer, cx + outer, cy + outer);
    SelectObject(hdc, innerBrush);
    Ellipse(hdc, cx - inner, cy - inner, cx + inner, cy + inner);
    DeleteObject(outerBrush);
    DeleteObject(innerBrush);

    RECT title{ rect.left, cy + 126, rect.right, cy + 180 };
    SelectObject(hdc, g_app.titleFont);
    SetTextColor(hdc, g_app.palette.text);
    SetBkMode(hdc, TRANSPARENT);
    DrawTextW(hdc, L"NeuralV", -1, &title, DT_CENTER | DT_SINGLELINE);
}

void PaintWindow(HWND hwnd) {
    PAINTSTRUCT ps{};
    HDC hdc = BeginPaint(hwnd, &ps);
    RECT rect = GetClientArea(hwnd);

    HBRUSH background = CreateSolidBrush(g_app.palette.background);
    FillRect(hdc, &rect, background);
    DeleteObject(background);

    SetBkMode(hdc, TRANSPARENT);
    if (g_app.screen == Screen::Splash) {
        PaintSplash(hdc, rect);
        EndPaint(hwnd, &ps);
        return;
    }

    RECT card{ 72, 72, rect.right - 72, rect.bottom - 72 };
    DrawCard(hdc, card);

    RECT title{ 104, 104, rect.right - 104, 152 };
    SelectObject(hdc, g_app.titleFont);
    SetTextColor(hdc, g_app.palette.text);
    DrawTextW(hdc, L"NeuralV", -1, &title, DT_LEFT | DT_SINGLELINE);

    RECT subtitle{ 104, 156, rect.right - 104, 196 };
    SelectObject(hdc, g_app.bodyFont);
    SetTextColor(hdc, g_app.palette.textMuted);
    std::wstring subtitleText;
    switch (g_app.screen) {
    case Screen::Welcome: subtitleText = L"Windows Native Client"; break;
    case Screen::Login: subtitleText = L"Вход"; break;
    case Screen::Register: subtitleText = L"Регистрация"; break;
    case Screen::Code: subtitleText = L"Код из почты"; break;
    case Screen::Scan: subtitleText = L"Проверка"; break;
    case Screen::Home: subtitleText = g_app.session.user.name.empty() ? std::wstring(L"Главный экран") : g_app.session.user.name; break;
    case Screen::History: subtitleText = L"История"; break;
    case Screen::Settings: subtitleText = L"Настройки"; break;
    default: break;
    }
    DrawTextW(hdc, subtitleText.c_str(), -1, &subtitle, DT_LEFT | DT_SINGLELINE);

    RECT copy{ 104, 210, rect.right - 104, 288 };
    std::wstring text;
    switch (g_app.screen) {
    case Screen::Welcome:
        text = L"Выбери вход или регистрацию. Этот клиент уже работает без JVM и тянет тему из Windows.";
        break;
    case Screen::Login:
        text = L"Введи почту и пароль. После этого придёт код на почту.";
        break;
    case Screen::Register:
        text = L"Создай аккаунт: имя, почта и пароль. После этого подтверди код из письма.";
        break;
    case Screen::Code:
        text = L"Введи код из письма и нажми Enter.";
        break;
    case Screen::Scan:
        text = g_app.scanRunning
            ? L"NeuralV держит проверку на сервере и показывает текущий этап прямо в окне."
            : L"Проверка завершена. Можно вернуться назад или запустить новый проход.";
        break;
    case Screen::Home:
        text = L"Авторизация и автообновление уже работают нативно. Проверка Windows стартует отсюда и уходит в server-side анализ.";
        break;
    case Screen::History:
        text = L"Экран истории уже выделен под native-клиент. Подтянем отчёты после перевода desktop scan flow.";
        break;
    case Screen::Settings:
        text = L"Тема берётся из Windows автоматически. Отсюда уже работает выход, а следующим шагом зайдут обновления и resident-поведение.";
        break;
    default:
        break;
    }
    DrawTextW(hdc, text.c_str(), -1, &copy, DT_LEFT | DT_WORDBREAK);

    if (!g_app.status.empty()) {
        RECT status{ 104, rect.bottom - 248, rect.right - 104, rect.bottom - 212 };
        SelectObject(hdc, g_app.smallFont);
        SetTextColor(hdc, g_app.palette.textMuted);
        DrawTextW(hdc, g_app.status.c_str(), -1, &status, DT_LEFT | DT_WORDBREAK);
    }

    if (g_app.screen == Screen::Scan) {
        RECT progressRect{ 104, 310, rect.right - 104, 350 };
        SelectObject(hdc, g_app.bodyFont);
        SetTextColor(hdc, g_app.palette.text);
        const std::wstring progress = std::to_wstring(g_app.scanProgress) + L"%";
        DrawTextW(hdc, progress.c_str(), -1, &progressRect, DT_LEFT | DT_SINGLELINE);

        RECT statusRect{ 104, 356, rect.right - 104, 426 };
        SelectObject(hdc, g_app.smallFont);
        SetTextColor(hdc, g_app.palette.textMuted);
        const std::wstring statusText = g_app.scanStatus.empty() ? L"Ожидание ответа от desktop scan..." : g_app.scanStatus;
        DrawTextW(hdc, statusText.c_str(), -1, &statusRect, DT_LEFT | DT_WORDBREAK);

        RECT timelineRect{ 104, 440, rect.right - 104, rect.bottom - 212 };
        std::wstring timelineText;
        for (size_t i = 0; i < g_app.scanTimeline.size(); ++i) {
            if (i > 0) {
                timelineText += L"\r\n";
            }
            timelineText += L"• ";
            timelineText += g_app.scanTimeline[i];
        }
        DrawTextW(hdc, timelineText.c_str(), -1, &timelineRect, DT_LEFT | DT_WORDBREAK);
    }

    EndPaint(hwnd, &ps);
}

LRESULT CALLBACK InputSubclassProc(HWND hwnd, UINT message, WPARAM wParam, LPARAM lParam, UINT_PTR, DWORD_PTR) {
    if (message == WM_KEYDOWN) {
        if (wParam == VK_RETURN) {
            switch (g_app.screen) {
            case Screen::Login:
            case Screen::Register:
                SubmitAuth();
                return 0;
            case Screen::Code:
                VerifyCode();
                return 0;
            default:
                break;
            }
        }

        if (wParam == VK_ESCAPE) {
            switch (g_app.screen) {
            case Screen::Login:
            case Screen::Register:
            case Screen::Code:
                SetScreen(Screen::Welcome);
                return 0;
            case Screen::Scan:
            case Screen::History:
            case Screen::Settings:
                SetScreen(Screen::Home);
                return 0;
            default:
                break;
            }
        }
    }

    return DefSubclassProc(hwnd, message, wParam, lParam);
}

LRESULT CALLBACK WindowProc(HWND hwnd, UINT message, WPARAM wParam, LPARAM lParam) {
    switch (message) {
    case WM_CREATE: {
        g_app.hwnd = hwnd;
        g_app.palette = neuralv::LoadThemePalette();
        g_app.deviceId = neuralv::EnsureDeviceId();
        g_app.splashStartedAt = GetTickCount();
        INITCOMMONCONTROLSEX common{};
        common.dwSize = sizeof(common);
        common.dwICC = ICC_STANDARD_CLASSES;
        InitCommonControlsEx(&common);

        g_app.titleFont = CreateFontW(38, 0, 0, 0, FW_SEMIBOLD, FALSE, FALSE, FALSE, DEFAULT_CHARSET, OUT_DEFAULT_PRECIS, CLIP_DEFAULT_PRECIS, CLEARTYPE_QUALITY, DEFAULT_PITCH, L"Segoe UI");
        g_app.bodyFont = CreateFontW(20, 0, 0, 0, FW_MEDIUM, FALSE, FALSE, FALSE, DEFAULT_CHARSET, OUT_DEFAULT_PRECIS, CLIP_DEFAULT_PRECIS, CLEARTYPE_QUALITY, DEFAULT_PITCH, L"Segoe UI");
        g_app.smallFont = CreateFontW(15, 0, 0, 0, FW_NORMAL, FALSE, FALSE, FALSE, DEFAULT_CHARSET, OUT_DEFAULT_PRECIS, CLIP_DEFAULT_PRECIS, CLEARTYPE_QUALITY, DEFAULT_PITCH, L"Segoe UI");

        g_name = CreateWindowExW(WS_EX_CLIENTEDGE, L"EDIT", nullptr, WS_CHILD | WS_TABSTOP | ES_AUTOHSCROLL, 0, 0, 0, 0, hwnd, reinterpret_cast<HMENU>(IdName), g_app.instance, nullptr);
        g_email = CreateWindowExW(WS_EX_CLIENTEDGE, L"EDIT", nullptr, WS_CHILD | WS_TABSTOP | ES_AUTOHSCROLL, 0, 0, 0, 0, hwnd, reinterpret_cast<HMENU>(IdEmail), g_app.instance, nullptr);
        g_password = CreateWindowExW(WS_EX_CLIENTEDGE, L"EDIT", nullptr, WS_CHILD | WS_TABSTOP | ES_AUTOHSCROLL | ES_PASSWORD, 0, 0, 0, 0, hwnd, reinterpret_cast<HMENU>(IdPassword), g_app.instance, nullptr);
        g_passwordRepeat = CreateWindowExW(WS_EX_CLIENTEDGE, L"EDIT", nullptr, WS_CHILD | WS_TABSTOP | ES_AUTOHSCROLL | ES_PASSWORD, 0, 0, 0, 0, hwnd, reinterpret_cast<HMENU>(IdPasswordRepeat), g_app.instance, nullptr);
        g_code = CreateWindowExW(WS_EX_CLIENTEDGE, L"EDIT", nullptr, WS_CHILD | WS_TABSTOP | ES_AUTOHSCROLL, 0, 0, 0, 0, hwnd, reinterpret_cast<HMENU>(IdCode), g_app.instance, nullptr);

        g_primary = CreateWindowExW(0, L"BUTTON", L"", WS_CHILD | WS_TABSTOP | BS_PUSHBUTTON, 0, 0, 0, 0, hwnd, reinterpret_cast<HMENU>(IdPrimary), g_app.instance, nullptr);
        g_secondary = CreateWindowExW(0, L"BUTTON", L"", WS_CHILD | WS_TABSTOP | BS_PUSHBUTTON, 0, 0, 0, 0, hwnd, reinterpret_cast<HMENU>(IdSecondary), g_app.instance, nullptr);
        g_tertiary = CreateWindowExW(0, L"BUTTON", L"", WS_CHILD | WS_TABSTOP | BS_PUSHBUTTON, 0, 0, 0, 0, hwnd, reinterpret_cast<HMENU>(IdTertiary), g_app.instance, nullptr);
        g_scan = CreateWindowExW(0, L"BUTTON", L"Проверка", WS_CHILD | WS_TABSTOP | BS_PUSHBUTTON, 0, 0, 0, 0, hwnd, reinterpret_cast<HMENU>(IdScan), g_app.instance, nullptr);
        g_history = CreateWindowExW(0, L"BUTTON", L"История", WS_CHILD | WS_TABSTOP | BS_PUSHBUTTON, 0, 0, 0, 0, hwnd, reinterpret_cast<HMENU>(IdHistory), g_app.instance, nullptr);
        g_settings = CreateWindowExW(0, L"BUTTON", L"Настройки", WS_CHILD | WS_TABSTOP | BS_PUSHBUTTON, 0, 0, 0, 0, hwnd, reinterpret_cast<HMENU>(IdSettings), g_app.instance, nullptr);
        g_logout = CreateWindowExW(0, L"BUTTON", L"Выйти", WS_CHILD | WS_TABSTOP | BS_PUSHBUTTON, 0, 0, 0, 0, hwnd, reinterpret_cast<HMENU>(IdLogout), g_app.instance, nullptr);

        for (HWND control : { g_name, g_email, g_password, g_passwordRepeat, g_code, g_primary, g_secondary, g_tertiary, g_scan, g_history, g_settings, g_logout }) {
            ApplyModernControlTheme(control);
        }
        for (HWND control : { g_name, g_email, g_password, g_passwordRepeat, g_code, g_primary, g_secondary, g_tertiary, g_scan, g_history, g_settings, g_logout }) {
            SetWindowSubclass(control, InputSubclassProc, kInputSubclassId, 0);
        }
        SetCue(g_name, L"Имя");
        SetCue(g_email, L"Email");
        SetCue(g_password, L"Пароль");
        SetCue(g_passwordRepeat, L"Повтори пароль");
        SetCue(g_code, L"Код из письма");

        LayoutControls();
        SetScreen(Screen::Splash);
        SetTimer(hwnd, kSplashTimer, 16, nullptr);
        return 0;
    }
    case WM_SIZE:
        LayoutControls();
        return 0;
    case WM_TIMER:
        if (wParam == kSplashTimer) {
            InvalidateRect(hwnd, nullptr, TRUE);
            if (GetTickCount() - g_app.splashStartedAt >= 1100) {
                KillTimer(hwnd, kSplashTimer);
                BootstrapAfterSplash();
            }
        }
        return 0;
    case WM_KEYDOWN:
        if (wParam == VK_ESCAPE) {
            if (g_app.screen == Screen::Login || g_app.screen == Screen::Register || g_app.screen == Screen::Code) {
                SetScreen(Screen::Welcome);
                return 0;
            }
            if (g_app.screen == Screen::Scan || g_app.screen == Screen::History || g_app.screen == Screen::Settings) {
                SetScreen(Screen::Home);
                return 0;
            }
        }
        if (wParam == VK_RETURN) {
            if (g_app.screen == Screen::Login || g_app.screen == Screen::Register) {
                SubmitAuth();
                return 0;
            }
            if (g_app.screen == Screen::Code) {
                VerifyCode();
                return 0;
            }
        }
        break;
    case WM_COMMAND:
        switch (LOWORD(wParam)) {
        case IdPrimary:
            if (g_app.screen == Screen::Welcome) SetScreen(Screen::Login);
            else if (g_app.screen == Screen::Login || g_app.screen == Screen::Register) SubmitAuth();
            else if (g_app.screen == Screen::Code) VerifyCode();
            else if (g_app.screen == Screen::Scan || g_app.screen == Screen::History || g_app.screen == Screen::Settings) SetScreen(Screen::Home);
            return 0;
        case IdSecondary:
            if (g_app.screen == Screen::Welcome) SetScreen(Screen::Register);
            else if (g_app.screen == Screen::Login || g_app.screen == Screen::Register || g_app.screen == Screen::Code) SetScreen(Screen::Welcome);
            else if (g_app.screen == Screen::Scan) {
                if (g_app.scanRunning && !g_app.scanFinished) {
                    g_app.scanCancelRequested = true;
                    std::wstring error;
                    if (g_app.api.CancelDesktopScan(g_app.session, error)) {
                        g_app.scanStatus = L"Запрос на отмену отправлен";
                        g_app.scanTimeline.push_back(L"Отправили cancel-active на backend");
                    } else {
                        g_app.scanStatus = error.empty() ? L"Не удалось отменить проверку" : error;
                    }
                    InvalidateRect(hwnd, nullptr, TRUE);
                } else {
                    SetScreen(Screen::Home);
                }
            }
            else if (g_app.screen == Screen::Settings) MaybeRunAutoUpdate();
            return 0;
        case IdScan:
            SetScreen(Screen::Scan);
            StartDesktopScanAsync();
            return 0;
        case IdHistory:
            SetScreen(Screen::History);
            return 0;
        case IdSettings:
            SetScreen(Screen::Settings);
            return 0;
        case IdLogout:
            Logout();
            return 0;
        default:
            break;
        }
        break;
    case WM_NEURALV_SCAN_UPDATE: {
        const auto payload = reinterpret_cast<ScanUpdatePayload*>(lParam);
        if (payload) {
            g_app.activeScanId = payload->scanId;
            g_app.scanStatus = payload->message.empty() ? payload->status : payload->message;
            g_app.scanVerdict = payload->verdict;
            g_app.scanTimeline = payload->timeline;
            g_app.scanProgress = payload->progress;
            g_app.scanRunning = !payload->finished;
            g_app.scanFinished = payload->finished;
            delete payload;
            SetScreen(Screen::Scan);
        }
        return 0;
    }
    case WM_NEURALV_SCAN_FINISH: {
        const auto payload = reinterpret_cast<ScanUpdatePayload*>(lParam);
        if (payload) {
            g_app.activeScanId = payload->scanId;
            g_app.scanStatus = payload->message.empty() ? payload->status : payload->message;
            g_app.scanVerdict = payload->verdict;
            g_app.scanTimeline = payload->timeline;
            g_app.scanProgress = payload->progress;
            g_app.scanRunning = false;
            g_app.scanFinished = true;
            delete payload;
            SetScreen(Screen::Scan);
        }
        return 0;
    }
    case WM_CTLCOLOREDIT:
    case WM_CTLCOLORSTATIC: {
        HDC hdc = reinterpret_cast<HDC>(wParam);
        SetBkColor(hdc, g_app.palette.surface);
        SetTextColor(hdc, g_app.palette.text);
        static HBRUSH brush = CreateSolidBrush(g_app.palette.surface);
        return reinterpret_cast<LRESULT>(brush);
    }
    case WM_PAINT:
        PaintWindow(hwnd);
        return 0;
    case WM_DESTROY:
        for (HWND control : { g_name, g_email, g_password, g_passwordRepeat, g_code, g_primary, g_secondary, g_tertiary, g_scan, g_history, g_settings, g_logout }) {
            if (control) {
                RemoveWindowSubclass(control, InputSubclassProc, kInputSubclassId);
            }
        }
        DeleteObject(g_app.titleFont);
        DeleteObject(g_app.bodyFont);
        DeleteObject(g_app.smallFont);
        PostQuitMessage(0);
        return 0;
    default:
        break;
    }

    return DefWindowProcW(hwnd, message, wParam, lParam);
}

} // namespace

int WINAPI wWinMain(HINSTANCE instance, HINSTANCE, PWSTR, int showCommand) {
    g_app.instance = instance;

    WNDCLASSW windowClass{};
    windowClass.lpfnWndProc = WindowProc;
    windowClass.hInstance = instance;
    windowClass.lpszClassName = kWindowClass;
    windowClass.hCursor = LoadCursorW(nullptr, IDC_ARROW);
    RegisterClassW(&windowClass);

    HWND hwnd = CreateWindowExW(
        0,
        kWindowClass,
        L"NeuralV",
        WS_OVERLAPPEDWINDOW | WS_VISIBLE,
        CW_USEDEFAULT,
        CW_USEDEFAULT,
        1120,
        780,
        nullptr,
        nullptr,
        instance,
        nullptr
    );

    if (!hwnd) {
        return 1;
    }

    ShowWindow(hwnd, showCommand);
    UpdateWindow(hwnd);

    MSG message{};
    while (GetMessageW(&message, nullptr, 0, 0)) {
        TranslateMessage(&message);
        DispatchMessageW(&message);
    }

    return static_cast<int>(message.wParam);
}
