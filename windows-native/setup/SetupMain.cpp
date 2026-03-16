#include <windows.h>
#include <objbase.h>
#include <shellapi.h>
#include <shlobj.h>
#include <shobjidl.h>
#include <shlwapi.h>
#include <urlmon.h>

#include <filesystem>
#include <optional>
#include <string>

#include "NeuralV/Config.h"

#pragma comment(lib, "urlmon.lib")
#pragma comment(lib, "shell32.lib")
#pragma comment(lib, "shlwapi.lib")

namespace {

constexpr wchar_t kAppName[] = L"NeuralV";
constexpr wchar_t kExecutableName[] = L"NeuralV.exe";
constexpr wchar_t kShortcutName[] = L"NeuralV.lnk";

class ComScope {
public:
    ComScope() : result_(CoInitializeEx(nullptr, COINIT_APARTMENTTHREADED)) {}
    ~ComScope() {
        if (SUCCEEDED(result_)) {
            CoUninitialize();
        }
    }

    bool Ready() const {
        return SUCCEEDED(result_) || result_ == RPC_E_CHANGED_MODE;
    }

private:
    HRESULT result_;
};

std::wstring TempPathFor(const std::wstring& name) {
    wchar_t path[MAX_PATH]{};
    GetTempPathW(MAX_PATH, path);
    return std::wstring(path) + name;
}

std::wstring KnownFolderPath(REFKNOWNFOLDERID folderId) {
    PWSTR raw = nullptr;
    if (SHGetKnownFolderPath(folderId, KF_FLAG_CREATE, nullptr, &raw) != S_OK || raw == nullptr) {
        return L"";
    }
    std::wstring path(raw);
    CoTaskMemFree(raw);
    return path;
}

std::wstring LocalInstallDir() {
    const auto base = KnownFolderPath(FOLDERID_LocalAppData);
    if (base.empty()) {
        return L".\\NeuralV";
    }
    return (std::filesystem::path(base) / L"Programs" / L"NeuralV").wstring();
}

std::wstring EscapePowerShellSingleQuoted(const std::wstring& value) {
    std::wstring escaped;
    escaped.reserve(value.size());
    for (const auto ch : value) {
        escaped.push_back(ch);
        if (ch == L'\'') {
            escaped.push_back(L'\'');
        }
    }
    return escaped;
}

bool RunHidden(const std::wstring& commandLine) {
    STARTUPINFOW startup{};
    startup.cb = sizeof(startup);
    PROCESS_INFORMATION info{};
    std::wstring mutableCommand = commandLine;
    const BOOL ok = CreateProcessW(nullptr, mutableCommand.data(), nullptr, nullptr, FALSE, CREATE_NO_WINDOW, nullptr, nullptr, &startup, &info);
    if (!ok) {
        return false;
    }
    WaitForSingleObject(info.hProcess, INFINITE);
    DWORD exitCode = 1;
    GetExitCodeProcess(info.hProcess, &exitCode);
    CloseHandle(info.hThread);
    CloseHandle(info.hProcess);
    return exitCode == 0;
}

bool ExtractZip(const std::wstring& zipPath, const std::wstring& destination) {
    std::error_code error;
    std::filesystem::remove_all(destination, error);
    error.clear();
    std::filesystem::create_directories(destination, error);
    if (error) {
        return false;
    }
    const std::wstring command =
        L"powershell -NoProfile -ExecutionPolicy Bypass -Command \"Expand-Archive -Force -LiteralPath '" +
        EscapePowerShellSingleQuoted(zipPath) + L"' -DestinationPath '" + EscapePowerShellSingleQuoted(destination) + L"'\"";
    return RunHidden(command);
}

std::optional<std::filesystem::path> FindPayloadRoot(const std::filesystem::path& extractedDir) {
    std::error_code error;
    std::filesystem::recursive_directory_iterator iter(
        extractedDir,
        std::filesystem::directory_options::skip_permission_denied,
        error
    );
    const auto end = std::filesystem::recursive_directory_iterator();
    for (; iter != end; iter.increment(error)) {
        if (error) {
            error.clear();
            continue;
        }
        if (!iter->is_regular_file(error)) {
            if (error) {
                error.clear();
            }
            continue;
        }
        if (iter->path().filename() == kExecutableName) {
            return iter->path().parent_path();
        }
    }
    return std::nullopt;
}

bool CopyDirectoryContents(const std::filesystem::path& sourceDir, const std::filesystem::path& targetDir) {
    std::error_code error;
    for (const auto& entry : std::filesystem::directory_iterator(sourceDir, error)) {
        if (error) {
            return false;
        }
        std::filesystem::copy(
            entry.path(),
            targetDir / entry.path().filename(),
            std::filesystem::copy_options::recursive | std::filesystem::copy_options::overwrite_existing,
            error
        );
        if (error) {
            return false;
        }
    }
    return true;
}

bool CopyPortablePayload(const std::wstring& extractedDir, const std::wstring& installDir) {
    const auto payloadRoot = FindPayloadRoot(extractedDir);
    if (!payloadRoot) {
        return false;
    }

    std::error_code error;
    std::filesystem::remove_all(installDir, error);
    error.clear();
    std::filesystem::create_directories(installDir, error);
    if (error) {
        return false;
    }
    if (!CopyDirectoryContents(*payloadRoot, installDir)) {
        return false;
    }
    return std::filesystem::exists(std::filesystem::path(installDir) / kExecutableName);
}

bool CreateShortcut(const std::wstring& shortcutPath, const std::wstring& targetPath, const std::wstring& workingDir) {
    std::error_code error;
    std::filesystem::create_directories(std::filesystem::path(shortcutPath).parent_path(), error);
    if (error) {
        return false;
    }

    IShellLinkW* shellLink = nullptr;
    HRESULT result = CoCreateInstance(CLSID_ShellLink, nullptr, CLSCTX_INPROC_SERVER, IID_PPV_ARGS(&shellLink));
    if (FAILED(result) || shellLink == nullptr) {
        return false;
    }

    result = shellLink->SetPath(targetPath.c_str());
    if (SUCCEEDED(result)) {
        result = shellLink->SetWorkingDirectory(workingDir.c_str());
    }
    if (SUCCEEDED(result)) {
        result = shellLink->SetDescription(kAppName);
    }
    if (SUCCEEDED(result)) {
        result = shellLink->SetIconLocation(targetPath.c_str(), 0);
    }

    bool ok = false;
    if (SUCCEEDED(result)) {
        IPersistFile* persistFile = nullptr;
        result = shellLink->QueryInterface(IID_PPV_ARGS(&persistFile));
        if (SUCCEEDED(result) && persistFile != nullptr) {
            ok = SUCCEEDED(persistFile->Save(shortcutPath.c_str(), TRUE));
            persistFile->Release();
        }
    }

    shellLink->Release();
    return ok;
}

bool CreateInstallerShortcuts(const std::wstring& installDir) {
    const auto exePath = (std::filesystem::path(installDir) / kExecutableName).wstring();
    const auto startMenuDir = KnownFolderPath(FOLDERID_Programs);
    const auto desktopDir = KnownFolderPath(FOLDERID_Desktop);
    if (startMenuDir.empty() || desktopDir.empty()) {
        return false;
    }

    return CreateShortcut((std::filesystem::path(startMenuDir) / kShortcutName).wstring(), exePath, installDir) &&
           CreateShortcut((std::filesystem::path(desktopDir) / kShortcutName).wstring(), exePath, installDir);
}

} // namespace

int WINAPI wWinMain(HINSTANCE, HINSTANCE, PWSTR commandLine, int) {
    const ComScope com;
    const bool noLaunch = commandLine && std::wstring(commandLine).find(L"--no-launch") != std::wstring::npos;
    MessageBoxW(nullptr, L"NeuralV Setup скачает и установит последнюю Windows-сборку в LocalAppData.", L"NeuralV Setup", MB_OK | MB_ICONINFORMATION);

    const std::wstring zipPath = TempPathFor(L"neuralv-windows.zip");
    const std::wstring extractDir = TempPathFor(L"neuralv-extract");
    const std::wstring installDir = LocalInstallDir();
    const auto cleanupTempFiles = [&]() {
        std::error_code error;
        std::filesystem::remove(zipPath, error);
        std::filesystem::remove_all(extractDir, error);
    };

    if (URLDownloadToFileW(nullptr, NEURALV_WINDOWS_PORTABLE_URL, zipPath.c_str(), 0, nullptr) != S_OK) {
        cleanupTempFiles();
        MessageBoxW(nullptr, L"Не удалось скачать portable-архив NeuralV.", L"NeuralV Setup", MB_OK | MB_ICONERROR);
        return 1;
    }
    if (!ExtractZip(zipPath, extractDir)) {
        cleanupTempFiles();
        MessageBoxW(nullptr, L"Не удалось распаковать NeuralV.", L"NeuralV Setup", MB_OK | MB_ICONERROR);
        return 1;
    }
    if (!CopyPortablePayload(extractDir, installDir)) {
        cleanupTempFiles();
        MessageBoxW(nullptr, L"Не удалось разложить файлы NeuralV.", L"NeuralV Setup", MB_OK | MB_ICONERROR);
        return 1;
    }
    if (!com.Ready() || !CreateInstallerShortcuts(installDir)) {
        cleanupTempFiles();
        MessageBoxW(nullptr, L"NeuralV установлен, но не удалось создать ярлыки в Пуске и на рабочем столе.", L"NeuralV Setup", MB_OK | MB_ICONERROR);
        return 1;
    }

    const std::wstring exePath = (std::filesystem::path(installDir) / L"NeuralV.exe").wstring();
    if (!noLaunch) {
        ShellExecuteW(nullptr, L"open", exePath.c_str(), nullptr, installDir.c_str(), SW_SHOWNORMAL);
    }

    cleanupTempFiles();
    MessageBoxW(nullptr, L"NeuralV установлен.", L"NeuralV Setup", MB_OK | MB_ICONINFORMATION);
    return 0;
}
