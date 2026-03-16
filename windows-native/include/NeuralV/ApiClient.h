#pragma once

#include <optional>
#include <string>
#include <vector>

#include "NeuralV/SessionStore.h"

namespace neuralv {

enum class ChallengeMode {
    Login,
    Register
};

struct ChallengeTicket {
    ChallengeMode mode = ChallengeMode::Login;
    std::wstring challengeId;
    std::wstring email;
    long long expiresAt = 0;
    std::wstring error;

    bool ok() const { return error.empty() && !challengeId.empty(); }
};

struct UpdateInfo {
    bool available = false;
    std::wstring latestVersion;
    std::wstring setupUrl;
    std::wstring error;
};

struct DesktopScanFinding {
    std::wstring id;
    std::wstring title;
    std::wstring verdict;
    std::wstring summary;
    std::vector<std::wstring> engines;
};

struct DesktopScanState {
    std::wstring id;
    std::wstring platform;
    std::wstring mode;
    std::wstring status;
    std::wstring verdict;
    std::wstring message;
    int riskScore = 0;
    int surfacedFindings = 0;
    int hiddenFindings = 0;
    long long startedAt = 0;
    long long completedAt = 0;
    std::vector<std::wstring> timeline;
    std::vector<DesktopScanFinding> findings;

    bool ok() const { return !id.empty(); }
};

class ApiClient {
public:
    ChallengeTicket StartLogin(const std::wstring& email, const std::wstring& password, const std::wstring& deviceId) const;
    ChallengeTicket StartRegister(const std::wstring& name, const std::wstring& email, const std::wstring& password, const std::wstring& deviceId) const;
    std::optional<SessionData> VerifyChallenge(ChallengeMode mode, const std::wstring& challengeId, const std::wstring& email, const std::wstring& code, const std::wstring& deviceId, std::wstring& error) const;
    std::optional<SessionData> RefreshSession(const SessionData& current, std::wstring& error) const;
    bool Logout(const SessionData& current) const;
    UpdateInfo CheckForUpdate(const std::wstring& currentVersion) const;
    std::optional<DesktopScanState> StartDesktopScan(
        const SessionData& current,
        const std::wstring& platform,
        const std::wstring& mode,
        const std::wstring& artifactKind,
        const std::wstring& targetName,
        const std::wstring& targetPath,
        const std::vector<std::wstring>& scanRoots,
        const std::vector<std::wstring>& installRoots,
        std::wstring& error
    ) const;
    std::optional<DesktopScanState> GetDesktopScan(const SessionData& current, const std::wstring& scanId, std::wstring& error) const;
    bool CancelDesktopScan(const SessionData& current, std::wstring& error) const;

private:
    struct HttpResult {
        int statusCode = 0;
        std::string body;
        std::wstring error;
        bool ok() const { return error.empty(); }
    };

    HttpResult JsonRequest(const std::wstring& method, const std::wstring& path, const std::string& bodyUtf8, const std::vector<std::pair<std::wstring, std::wstring>>& headers = {}) const;
    std::optional<SessionData> ParseSession(const std::string& body, const std::wstring& deviceId, std::wstring& error) const;
    std::optional<DesktopScanState> ParseDesktopScan(const std::string& body, std::wstring& error) const;
};

} // namespace neuralv
