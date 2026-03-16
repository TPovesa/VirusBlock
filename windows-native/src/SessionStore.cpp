#include "NeuralV/SessionStore.h"

#include <filesystem>
#include <fstream>
#include <objbase.h>
#include <shlobj.h>
#include <sstream>
#include <unordered_map>
#include <locale>

namespace neuralv {

namespace {

std::wstring ReadKnownFolder(REFKNOWNFOLDERID folderId) {
    PWSTR raw = nullptr;
    if (SHGetKnownFolderPath(folderId, KF_FLAG_CREATE, nullptr, &raw) != S_OK || raw == nullptr) {
        return L".";
    }
    std::wstring path(raw);
    CoTaskMemFree(raw);
    return path;
}

std::wstring AppDirectory() {
    const std::filesystem::path dir = std::filesystem::path(ReadKnownFolder(FOLDERID_RoamingAppData)) / L"NeuralV";
    std::filesystem::create_directories(dir);
    return dir.wstring();
}

std::wstring GenerateGuidString() {
    GUID guid{};
    CoCreateGuid(&guid);
    wchar_t buffer[64]{};
    StringFromGUID2(guid, buffer, static_cast<int>(sizeof(buffer) / sizeof(buffer[0])));
    return buffer;
}

std::unordered_map<std::wstring, std::wstring> ReadKeyValueFile(const std::wstring& path) {
    std::unordered_map<std::wstring, std::wstring> map;
    std::wifstream input(path);
    input.imbue(std::locale(""));
    if (!input.is_open()) {
        return map;
    }
    std::wstring line;
    while (std::getline(input, line)) {
        const auto pos = line.find(L'=');
        if (pos == std::wstring::npos) {
            continue;
        }
        map[line.substr(0, pos)] = line.substr(pos + 1);
    }
    return map;
}

bool WriteKeyValueFile(const std::wstring& path, const std::unordered_map<std::wstring, std::wstring>& values) {
    std::wofstream output(path, std::ios::trunc);
    output.imbue(std::locale(""));
    if (!output.is_open()) {
        return false;
    }
    for (const auto& [key, value] : values) {
        output << key << L'=' << value << L'\n';
    }
    return true;
}

bool ParseBool(const std::wstring& value) {
    return value == L"1" || value == L"true" || value == L"yes";
}

long long ParseInt64(const std::wstring& value) {
    if (value.empty()) {
        return 0;
    }
    return _wtoll(value.c_str());
}

} // namespace

std::wstring Utf8ToWide(const std::string& value) {
    if (value.empty()) {
        return L"";
    }
    const int size = MultiByteToWideChar(CP_UTF8, 0, value.c_str(), static_cast<int>(value.size()), nullptr, 0);
    std::wstring result(size, L'\0');
    MultiByteToWideChar(CP_UTF8, 0, value.c_str(), static_cast<int>(value.size()), result.data(), size);
    return result;
}

std::string WideToUtf8(const std::wstring& value) {
    if (value.empty()) {
        return "";
    }
    const int size = WideCharToMultiByte(CP_UTF8, 0, value.c_str(), static_cast<int>(value.size()), nullptr, 0, nullptr, nullptr);
    std::string result(size, '\0');
    WideCharToMultiByte(CP_UTF8, 0, value.c_str(), static_cast<int>(value.size()), result.data(), size, nullptr, nullptr);
    return result;
}

std::wstring GetAppDataDirectory() {
    return AppDirectory();
}

std::wstring GetSessionFilePath() {
    return (std::filesystem::path(AppDirectory()) / L"session.dat").wstring();
}

std::wstring EnsureDeviceId() {
    const auto path = (std::filesystem::path(AppDirectory()) / L"device.id").wstring();
    std::wifstream input(path);
    if (input.is_open()) {
        std::wstring existing;
        std::getline(input, existing);
        if (!existing.empty()) {
            return existing;
        }
    }
    const auto generated = GenerateGuidString();
    std::wofstream output(path, std::ios::trunc);
    output << generated;
    return generated;
}

bool SaveSession(const SessionData& session) {
    std::unordered_map<std::wstring, std::wstring> values = {
        {L"access_token", session.accessToken},
        {L"refresh_token", session.refreshToken},
        {L"session_id", session.sessionId},
        {L"access_expires_at", std::to_wstring(session.accessTokenExpiresAt)},
        {L"refresh_expires_at", std::to_wstring(session.refreshTokenExpiresAt)},
        {L"device_id", session.deviceId},
        {L"user_id", session.user.id},
        {L"user_name", session.user.name},
        {L"user_email", session.user.email},
        {L"is_premium", session.user.isPremium ? L"1" : L"0"},
        {L"is_developer", session.user.isDeveloper ? L"1" : L"0"}
    };
    return WriteKeyValueFile(GetSessionFilePath(), values);
}

std::optional<SessionData> LoadSession() {
    const auto values = ReadKeyValueFile(GetSessionFilePath());
    if (values.empty()) {
        return std::nullopt;
    }

    SessionData session;
    session.accessToken = values.contains(L"access_token") ? values.at(L"access_token") : L"";
    session.refreshToken = values.contains(L"refresh_token") ? values.at(L"refresh_token") : L"";
    session.sessionId = values.contains(L"session_id") ? values.at(L"session_id") : L"";
    session.accessTokenExpiresAt = values.contains(L"access_expires_at") ? ParseInt64(values.at(L"access_expires_at")) : 0;
    session.refreshTokenExpiresAt = values.contains(L"refresh_expires_at") ? ParseInt64(values.at(L"refresh_expires_at")) : 0;
    session.deviceId = values.contains(L"device_id") ? values.at(L"device_id") : L"";
    session.user.id = values.contains(L"user_id") ? values.at(L"user_id") : L"";
    session.user.name = values.contains(L"user_name") ? values.at(L"user_name") : L"";
    session.user.email = values.contains(L"user_email") ? values.at(L"user_email") : L"";
    session.user.isPremium = values.contains(L"is_premium") ? ParseBool(values.at(L"is_premium")) : false;
    session.user.isDeveloper = values.contains(L"is_developer") ? ParseBool(values.at(L"is_developer")) : false;
    if (!session.IsValid()) {
        return std::nullopt;
    }
    return session;
}

void ClearSession() {
    std::error_code error;
    std::filesystem::remove(GetSessionFilePath(), error);
}

} // namespace neuralv
