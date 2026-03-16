#pragma once

#include <optional>
#include <regex>
#include <string>
#include <vector>

namespace neuralv {

inline std::optional<std::string> FindJsonString(const std::string& body, const std::string& key) {
    const std::regex pattern("\\\"" + key + "\\\"\\s*:\\s*\\\"([^\\\"]*)\\\"");
    std::smatch match;
    if (std::regex_search(body, match, pattern) && match.size() > 1) {
        return match[1].str();
    }
    return std::nullopt;
}

inline std::optional<long long> FindJsonInt64(const std::string& body, const std::string& key) {
    const std::regex pattern("\\\"" + key + "\\\"\\s*:\\s*([0-9]+)");
    std::smatch match;
    if (std::regex_search(body, match, pattern) && match.size() > 1) {
        return std::stoll(match[1].str());
    }
    return std::nullopt;
}

inline std::optional<bool> FindJsonBool(const std::string& body, const std::string& key) {
    const std::regex pattern("\\\"" + key + "\\\"\\s*:\\s*(true|false)");
    std::smatch match;
    if (std::regex_search(body, match, pattern) && match.size() > 1) {
        return match[1].str() == "true";
    }
    return std::nullopt;
}

inline std::optional<std::string> ExtractJsonObject(const std::string& body, const std::string& key) {
    const std::string needle = "\"" + key + "\"";
    const size_t keyPos = body.find(needle);
    if (keyPos == std::string::npos) {
        return std::nullopt;
    }
    const size_t colonPos = body.find(':', keyPos + needle.size());
    if (colonPos == std::string::npos) {
        return std::nullopt;
    }
    const size_t startPos = body.find('{', colonPos + 1);
    if (startPos == std::string::npos) {
        return std::nullopt;
    }

    int depth = 0;
    bool inString = false;
    bool escaped = false;
    for (size_t i = startPos; i < body.size(); ++i) {
        const char ch = body[i];
        if (escaped) {
            escaped = false;
            continue;
        }
        if (ch == '\\') {
            escaped = true;
            continue;
        }
        if (ch == '"') {
            inString = !inString;
            continue;
        }
        if (inString) {
            continue;
        }
        if (ch == '{') {
            ++depth;
        } else if (ch == '}') {
            --depth;
            if (depth == 0) {
                return body.substr(startPos, i - startPos + 1);
            }
        }
    }
    return std::nullopt;
}

inline std::vector<std::string> FindJsonStringArray(const std::string& body, const std::string& key) {
    std::vector<std::string> values;
    const std::regex pattern("\\\"" + key + "\\\"\\s*:\\s*\\[(.*?)\\]");
    std::smatch match;
    if (!std::regex_search(body, match, pattern) || match.size() <= 1) {
        return values;
    }
    const std::string arrayBody = match[1].str();
    const std::regex itemPattern("\\\"([^\\\"]*)\\\"");
    auto begin = std::sregex_iterator(arrayBody.begin(), arrayBody.end(), itemPattern);
    auto end = std::sregex_iterator();
    for (auto it = begin; it != end; ++it) {
        if (it->size() > 1) {
            values.push_back((*it)[1].str());
        }
    }
    return values;
}

inline std::string EscapeJson(const std::string& value) {
    std::string out;
    out.reserve(value.size() + 8);
    for (const char ch : value) {
        switch (ch) {
        case '\\': out += "\\\\"; break;
        case '"': out += "\\\""; break;
        case '\n': out += "\\n"; break;
        case '\r': out += "\\r"; break;
        case '\t': out += "\\t"; break;
        default: out.push_back(ch); break;
        }
    }
    return out;
}

} // namespace neuralv
