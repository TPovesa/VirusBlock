#include "NeuralV/ApiClient.h"

#include <windows.h>
#include <winhttp.h>

#include <sstream>

#include "NeuralV/Config.h"
#include "NeuralV/JsonLite.h"

#pragma comment(lib, "winhttp.lib")

namespace neuralv {

namespace {

std::wstring BuildPath(const std::wstring& relative) {
    return std::wstring(NEURALV_API_BASE_PATH) + relative;
}

std::wstring JsonError(const std::string& body, int statusCode) {
    if (const auto apiError = FindJsonString(body, "error")) {
        return Utf8ToWide(*apiError);
    }
    std::wstringstream stream;
    stream << L"HTTP " << statusCode;
    return stream.str();
}

std::string BuildJson(std::initializer_list<std::pair<std::string, std::string>> fields) {
    std::string body = "{";
    bool first = true;
    for (const auto& [key, value] : fields) {
        if (!first) {
            body += ",";
        }
        first = false;
        body += "\"" + key + "\":\"" + EscapeJson(value) + "\"";
    }
    body += "}";
    return body;
}

} // namespace

ApiClient::HttpResult ApiClient::JsonRequest(const std::wstring& method, const std::wstring& path, const std::string& bodyUtf8, const std::vector<std::pair<std::wstring, std::wstring>>& headers) const {
    HttpResult result;
    HINTERNET session = WinHttpOpen(L"NeuralVNative/1.0", WINHTTP_ACCESS_TYPE_AUTOMATIC_PROXY, WINHTTP_NO_PROXY_NAME, WINHTTP_NO_PROXY_BYPASS, 0);
    if (!session) {
        result.error = L"Не удалось открыть WinHTTP session";
        return result;
    }

    HINTERNET connection = WinHttpConnect(session, NEURALV_API_HOST, INTERNET_DEFAULT_HTTPS_PORT, 0);
    if (!connection) {
        result.error = L"Не удалось подключиться к backend";
        WinHttpCloseHandle(session);
        return result;
    }

    HINTERNET request = WinHttpOpenRequest(
        connection,
        method.c_str(),
        BuildPath(path).c_str(),
        nullptr,
        WINHTTP_NO_REFERER,
        WINHTTP_DEFAULT_ACCEPT_TYPES,
        WINHTTP_FLAG_SECURE
    );
    if (!request) {
        result.error = L"Не удалось открыть HTTP request";
        WinHttpCloseHandle(connection);
        WinHttpCloseHandle(session);
        return result;
    }

    DWORD timeoutMs = 30000;
    WinHttpSetTimeouts(request, timeoutMs, timeoutMs, timeoutMs, timeoutMs);

    std::wstring headerBlock = L"Content-Type: application/json; charset=utf-8\r\nAccept: application/json\r\n";
    for (const auto& [name, value] : headers) {
        headerBlock += name + L": " + value + L"\r\n";
    }

    const BOOL sendOk = WinHttpSendRequest(
        request,
        headerBlock.c_str(),
        static_cast<DWORD>(headerBlock.size()),
        bodyUtf8.empty() ? WINHTTP_NO_REQUEST_DATA : const_cast<char*>(bodyUtf8.data()),
        static_cast<DWORD>(bodyUtf8.size()),
        static_cast<DWORD>(bodyUtf8.size()),
        0
    );

    if (!sendOk || !WinHttpReceiveResponse(request, nullptr)) {
        result.error = L"Сетевой запрос не выполнен";
        WinHttpCloseHandle(request);
        WinHttpCloseHandle(connection);
        WinHttpCloseHandle(session);
        return result;
    }

    DWORD statusCode = 0;
    DWORD size = sizeof(statusCode);
    WinHttpQueryHeaders(request, WINHTTP_QUERY_STATUS_CODE | WINHTTP_QUERY_FLAG_NUMBER, WINHTTP_HEADER_NAME_BY_INDEX, &statusCode, &size, WINHTTP_NO_HEADER_INDEX);
    result.statusCode = static_cast<int>(statusCode);

    std::string body;
    while (true) {
        DWORD available = 0;
        if (!WinHttpQueryDataAvailable(request, &available) || available == 0) {
            break;
        }
        std::string chunk(available, '\0');
        DWORD downloaded = 0;
        if (!WinHttpReadData(request, chunk.data(), available, &downloaded)) {
            result.error = L"Не удалось прочитать ответ сервера";
            break;
        }
        chunk.resize(downloaded);
        body += chunk;
    }
    result.body = body;

    WinHttpCloseHandle(request);
    WinHttpCloseHandle(connection);
    WinHttpCloseHandle(session);
    return result;
}

ChallengeTicket ApiClient::StartLogin(const std::wstring& email, const std::wstring& password, const std::wstring& deviceId) const {
    ChallengeTicket ticket;
    ticket.mode = ChallengeMode::Login;
    ticket.email = email;
    const auto response = JsonRequest(L"POST", L"/api/auth/login/start", BuildJson({
        {"email", WideToUtf8(email)},
        {"password", WideToUtf8(password)},
        {"device_id", WideToUtf8(deviceId)}
    }));
    if (!response.ok()) {
        ticket.error = response.error;
        return ticket;
    }
    if (response.statusCode < 200 || response.statusCode >= 300) {
        ticket.error = JsonError(response.body, response.statusCode);
        return ticket;
    }
    ticket.challengeId = Utf8ToWide(FindJsonString(response.body, "challenge_id").value_or(""));
    ticket.expiresAt = FindJsonInt64(response.body, "expires_at").value_or(0);
    return ticket;
}

ChallengeTicket ApiClient::StartRegister(const std::wstring& name, const std::wstring& email, const std::wstring& password, const std::wstring& deviceId) const {
    ChallengeTicket ticket;
    ticket.mode = ChallengeMode::Register;
    ticket.email = email;
    const auto response = JsonRequest(L"POST", L"/api/auth/register/start", BuildJson({
        {"name", WideToUtf8(name)},
        {"email", WideToUtf8(email)},
        {"password", WideToUtf8(password)},
        {"device_id", WideToUtf8(deviceId)}
    }));
    if (!response.ok()) {
        ticket.error = response.error;
        return ticket;
    }
    if (response.statusCode < 200 || response.statusCode >= 300) {
        ticket.error = JsonError(response.body, response.statusCode);
        return ticket;
    }
    ticket.challengeId = Utf8ToWide(FindJsonString(response.body, "challenge_id").value_or(""));
    ticket.expiresAt = FindJsonInt64(response.body, "expires_at").value_or(0);
    return ticket;
}

std::optional<SessionData> ApiClient::ParseSession(const std::string& body, const std::wstring& deviceId, std::wstring& error) const {
    SessionData session;
    session.accessToken = Utf8ToWide(FindJsonString(body, "token").value_or(""));
    session.refreshToken = Utf8ToWide(FindJsonString(body, "refresh_token").value_or(""));
    session.sessionId = Utf8ToWide(FindJsonString(body, "session_id").value_or(""));
    session.accessTokenExpiresAt = FindJsonInt64(body, "access_token_expires_at").value_or(0);
    session.refreshTokenExpiresAt = FindJsonInt64(body, "refresh_token_expires_at").value_or(0);
    session.deviceId = deviceId;
    session.user.id = Utf8ToWide(FindJsonString(body, "id").value_or(""));
    session.user.name = Utf8ToWide(FindJsonString(body, "name").value_or(""));
    session.user.email = Utf8ToWide(FindJsonString(body, "email").value_or(""));
    session.user.isPremium = FindJsonString(body, "is_premium").value_or("false") == "true";
    session.user.isDeveloper = FindJsonString(body, "is_developer_mode").value_or("false") == "true";
    if (!session.IsValid()) {
        error = L"Сервер вернул неполную сессию";
        return std::nullopt;
    }
    return session;
}

std::optional<SessionData> ApiClient::VerifyChallenge(ChallengeMode mode, const std::wstring& challengeId, const std::wstring& email, const std::wstring& code, const std::wstring& deviceId, std::wstring& error) const {
    const auto path = mode == ChallengeMode::Register ? L"/api/auth/register/verify" : L"/api/auth/login/verify";
    const auto response = JsonRequest(L"POST", path, BuildJson({
        {"challenge_id", WideToUtf8(challengeId)},
        {"email", WideToUtf8(email)},
        {"code", WideToUtf8(code)},
        {"device_id", WideToUtf8(deviceId)}
    }));
    if (!response.ok()) {
        error = response.error;
        return std::nullopt;
    }
    if (response.statusCode < 200 || response.statusCode >= 300) {
        error = JsonError(response.body, response.statusCode);
        return std::nullopt;
    }
    return ParseSession(response.body, deviceId, error);
}

std::optional<SessionData> ApiClient::RefreshSession(const SessionData& current, std::wstring& error) const {
    const auto response = JsonRequest(L"POST", L"/api/auth/refresh", BuildJson({
        {"refresh_token", WideToUtf8(current.refreshToken)},
        {"session_id", WideToUtf8(current.sessionId)},
        {"device_id", WideToUtf8(current.deviceId)}
    }));
    if (!response.ok()) {
        error = response.error;
        return std::nullopt;
    }
    if (response.statusCode < 200 || response.statusCode >= 300) {
        error = JsonError(response.body, response.statusCode);
        return std::nullopt;
    }
    return ParseSession(response.body, current.deviceId, error);
}

bool ApiClient::Logout(const SessionData& current) const {
    const auto response = JsonRequest(L"POST", L"/api/auth/logout", "{}", {
        {L"Authorization", L"Bearer " + current.accessToken}
    });
    return response.ok() && response.statusCode >= 200 && response.statusCode < 300;
}

UpdateInfo ApiClient::CheckForUpdate(const std::wstring& currentVersion) const {
    UpdateInfo info;
    const auto response = JsonRequest(L"GET", L"/api/releases/manifest?platform=windows", "");
    if (!response.ok()) {
        info.error = response.error;
        return info;
    }
    if (response.statusCode < 200 || response.statusCode >= 300) {
        info.error = JsonError(response.body, response.statusCode);
        return info;
    }
    const auto latest = Utf8ToWide(FindJsonString(response.body, "version").value_or(""));
    if (latest.empty()) {
        return info;
    }
    info.latestVersion = latest;
    info.setupUrl = Utf8ToWide(FindJsonString(response.body, "setupUrl").value_or(""));
    if (info.setupUrl.empty()) {
        info.setupUrl = NEURALV_WINDOWS_SETUP_URL;
    }
    info.available = latest != currentVersion;
    return info;
}

} // namespace neuralv
