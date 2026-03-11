const ALLOWED_INSTALLERS = new Set([
    'com.android.vending',
    'com.google.android.packageinstaller',
    'com.android.packageinstaller',
    'com.google.android.feedback',
    'com.sec.android.app.samsungapps',
    'com.samsung.android.packageinstaller',
    'com.huawei.appmarket',
    'com.xiaomi.market',
    'com.miui.packageinstaller',
    'com.amazon.venezia',
    'com.oppo.market',
    'com.heytap.market'
]);

const PERMISSION_RULES = {
    'android.permission.BIND_ACCESSIBILITY_SERVICE': { score: 30, severity: 'high', title: 'Accessibility service access', detail: 'Apps can abuse accessibility privileges to read screen content and automate taps.' },
    'android.permission.SYSTEM_ALERT_WINDOW': { score: 18, severity: 'medium', title: 'Overlay permission', detail: 'Screen overlays are often used for phishing and clickjacking.' },
    'android.permission.REQUEST_INSTALL_PACKAGES': { score: 20, severity: 'high', title: 'Can install other packages', detail: 'The app can trigger installation flows for other APKs.' },
    'android.permission.QUERY_ALL_PACKAGES': { score: 14, severity: 'medium', title: 'Queries all installed packages', detail: 'Broad package visibility can be used for profiling and targeting other apps.' },
    'android.permission.MANAGE_EXTERNAL_STORAGE': { score: 14, severity: 'medium', title: 'Full storage access', detail: 'This grants broad access to files on the device.' },
    'android.permission.READ_SMS': { score: 18, severity: 'high', title: 'Reads SMS messages', detail: 'SMS access can expose one-time codes and private messages.' },
    'android.permission.RECEIVE_SMS': { score: 15, severity: 'medium', title: 'Receives SMS messages', detail: 'Receiving SMS is sensitive when combined with other message or overlay privileges.' },
    'android.permission.SEND_SMS': { score: 18, severity: 'high', title: 'Sends SMS messages', detail: 'This can be abused for premium SMS fraud.' },
    'android.permission.READ_CALL_LOG': { score: 14, severity: 'medium', title: 'Reads call log', detail: 'Call history is sensitive personal data.' },
    'android.permission.WRITE_CALL_LOG': { score: 16, severity: 'high', title: 'Writes call log', detail: 'Changing call history is unusual for most apps.' },
    'android.permission.READ_CONTACTS': { score: 10, severity: 'medium', title: 'Reads contacts', detail: 'Contacts data is often harvested for spam or social engineering.' },
    'android.permission.READ_PHONE_STATE': { score: 8, severity: 'low', title: 'Reads phone state', detail: 'Phone state can be used for device fingerprinting.' },
    'android.permission.RECORD_AUDIO': { score: 10, severity: 'medium', title: 'Microphone access', detail: 'Microphone access is sensitive when not clearly needed by the app.' },
    'android.permission.CAMERA': { score: 8, severity: 'low', title: 'Camera access', detail: 'Camera access should match the app purpose.' },
    'android.permission.PACKAGE_USAGE_STATS': { score: 12, severity: 'medium', title: 'Usage stats access', detail: 'Usage stats can reveal what other apps the user runs.' },
    'android.permission.REQUEST_DELETE_PACKAGES': { score: 10, severity: 'medium', title: 'Can request deleting packages', detail: 'This can be used to interfere with other installed apps.' },
    'android.permission.KILL_BACKGROUND_PROCESSES': { score: 8, severity: 'low', title: 'Kills background processes', detail: 'Stopping other apps is uncommon for normal consumer apps.' },
    'android.permission.BIND_DEVICE_ADMIN': { score: 22, severity: 'high', title: 'Device admin binding', detail: 'Device admin capabilities can make removal harder.' }
};

function normalizeString(value, maxLength = 255) {
    if (value === null || value === undefined) {
        return null;
    }
    const normalized = String(value).trim();
    return normalized ? normalized.slice(0, maxLength) : null;
}

function normalizeBoolean(value) {
    if (typeof value === 'boolean') return value;
    if (typeof value === 'string') {
        const normalized = value.trim().toLowerCase();
        if (normalized === 'true') return true;
        if (normalized === 'false') return false;
    }
    return null;
}

function normalizeNumber(value) {
    if (value === null || value === undefined || value === '') return null;
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
}

function normalizeSha256(value) {
    const normalized = normalizeString(value, 64);
    if (!normalized) return null;
    return /^[a-fA-F0-9]{64}$/.test(normalized) ? normalized.toLowerCase() : null;
}

function normalizePackageName(value) {
    const normalized = normalizeString(value, 255);
    if (!normalized) return null;
    return /^[a-zA-Z0-9_]+(?:\.[a-zA-Z0-9_]+)+$/.test(normalized) ? normalized : null;
}

function extractPermissionName(entry) {
    if (!entry) return null;
    if (typeof entry === 'string') return normalizeString(entry, 120);
    if (typeof entry === 'object') {
        return normalizeString(entry.name || entry.permission || entry.id, 120);
    }
    return null;
}

function normalizePermissions(rawPermissions) {
    if (!Array.isArray(rawPermissions)) {
        return [];
    }
    return Array.from(new Set(rawPermissions
        .map(extractPermissionName)
        .filter(Boolean)
        .slice(0, 256)));
}

function makeFinding(type, severity, title, detail, evidence = {}) {
    return {
        type,
        severity,
        title,
        detail,
        evidence
    };
}

function classifyVerdict(score, vtStats = null) {
    const malicious = vtStats?.malicious || 0;
    if (malicious >= 5 || score >= 85) return 'malicious';
    if (malicious >= 1 || score >= 45) return 'suspicious';
    if (score >= 20) return 'low_risk';
    return 'clean';
}

function buildRecommendations(findings, normalized) {
    const recommendations = [];
    const hasSideload = findings.some((finding) => finding.type === 'install_source');
    const hasOverlay = normalized.permissions.includes('android.permission.SYSTEM_ALERT_WINDOW');
    const hasAccessibility = normalized.permissions.includes('android.permission.BIND_ACCESSIBILITY_SERVICE');
    const hasOldTargetSdk = findings.some((finding) => finding.type === 'platform_age');

    if (hasSideload) {
        recommendations.push('Проверьте источник установки и сверяйте APK только с доверенным магазином или официальным сайтом разработчика.');
    }
    if (hasOverlay || hasAccessibility) {
        recommendations.push('Перед выдачей специальных разрешений перепроверьте, зачем приложению нужны overlay или accessibility-возможности.');
    }
    if (normalized.permissions.includes('android.permission.REQUEST_INSTALL_PACKAGES')) {
        recommendations.push('Не разрешайте приложению устанавливать другие пакеты без явной необходимости.');
    }
    if (normalized.permissions.includes('android.permission.SEND_SMS') || normalized.permissions.includes('android.permission.READ_SMS')) {
        recommendations.push('Для приложений с SMS-доступом стоит проверить репутацию разработчика и мониторить аномальные списания.');
    }
    if (hasOldTargetSdk) {
        recommendations.push('Для приложений со старым targetSdk важно дополнительно проверять разработчика, разрешения и источник установки.');
    }
    if (recommendations.length === 0) {
        recommendations.push('Существенных серверных индикаторов угрозы не найдено, но итог стоит сверить с локальным сканером и подписью APK.');
    }
    return recommendations.slice(0, 4);
}

function normalizeDeepScanPayload(payload = {}) {
    return {
        appName: normalizeString(payload.app_name || payload.appName, 255),
        packageName: normalizePackageName(payload.package_name || payload.packageName),
        sha256: normalizeSha256(payload.sha256),
        installerPackage: normalizeString(payload.installer_package || payload.installerPackage || payload.install_source || payload.installSource, 255),
        permissions: normalizePermissions(payload.permissions || payload.requested_permissions || payload.requestedPermissions),
        targetSdk: normalizeNumber(payload.target_sdk ?? payload.targetSdk),
        minSdk: normalizeNumber(payload.min_sdk ?? payload.minSdk),
        versionCode: normalizeNumber(payload.version_code ?? payload.versionCode),
        versionName: normalizeString(payload.version_name || payload.versionName, 120),
        signatureSha256: normalizeSha256(payload.signature_sha256 || payload.signatureSha256),
        certificateSubject: normalizeString(payload.certificate_subject || payload.certificateSubject, 255),
        firstInstallTime: normalizeNumber(payload.first_install_time ?? payload.firstInstallTime),
        lastUpdateTime: normalizeNumber(payload.last_update_time ?? payload.lastUpdateTime),
        sizeBytes: normalizeNumber(payload.size_bytes ?? payload.sizeBytes),
        isDebuggable: normalizeBoolean(payload.is_debuggable ?? payload.isDebuggable),
        usesCleartextTraffic: normalizeBoolean(payload.uses_cleartext_traffic ?? payload.usesCleartextTraffic)
    };
}

function validateDeepScanPayload(normalized) {
    if (!normalized.packageName && !normalized.sha256) {
        return 'package_name or sha256 is required';
    }
    return null;
}

function analyzeHeuristics(normalized, vtStats = null) {
    const findings = [];
    let riskScore = 0;

    if (!normalized.sha256) {
        findings.push(makeFinding(
            'metadata_gap',
            'low',
            'SHA-256 not provided',
            'The server could not run a VirusTotal hash lookup because the file hash is missing.'
        ));
        riskScore += 5;
    }

    if (!normalized.installerPackage || !ALLOWED_INSTALLERS.has(normalized.installerPackage)) {
        findings.push(makeFinding(
            'install_source',
            'medium',
            'Untrusted or unknown install source',
            'The installer package is missing or not in the allowlist of common trusted Android stores.',
            { installer_package: normalized.installerPackage || 'unknown' }
        ));
        riskScore += normalized.installerPackage ? 12 : 16;
    }

    if (normalized.targetSdk !== null && normalized.targetSdk <= 28) {
        findings.push(makeFinding(
            'platform_age',
            normalized.targetSdk <= 26 ? 'medium' : 'low',
            'Outdated target SDK level',
            'The app targets an older Android SDK level, which can indicate weaker platform restrictions and deserves extra review.',
            { target_sdk: normalized.targetSdk }
        ));
        riskScore += normalized.targetSdk <= 26 ? 10 : 5;
    }

    if (!normalized.signatureSha256) {
        findings.push(makeFinding(
            'signature_gap',
            'low',
            'Signing fingerprint unavailable',
            'The device did not provide a signing certificate fingerprint for this package.'
        ));
        riskScore += 4;
    }

    if (!normalized.certificateSubject) {
        findings.push(makeFinding(
            'certificate_gap',
            'low',
            'Certificate subject unavailable',
            'The signing certificate subject could not be resolved from package metadata.'
        ));
        riskScore += 3;
    }

    for (const permission of normalized.permissions) {
        const rule = PERMISSION_RULES[permission];
        if (!rule) continue;
        findings.push(makeFinding(
            'permission',
            rule.severity,
            rule.title,
            rule.detail,
            { permission }
        ));
        riskScore += rule.score;
    }

    const hasAccessibility = normalized.permissions.includes('android.permission.BIND_ACCESSIBILITY_SERVICE');
    const hasOverlay = normalized.permissions.includes('android.permission.SYSTEM_ALERT_WINDOW');
    const hasInstaller = normalized.permissions.includes('android.permission.REQUEST_INSTALL_PACKAGES');
    const hasQueryAll = normalized.permissions.includes('android.permission.QUERY_ALL_PACKAGES');
    const hasSms = normalized.permissions.includes('android.permission.READ_SMS') || normalized.permissions.includes('android.permission.SEND_SMS') || normalized.permissions.includes('android.permission.RECEIVE_SMS');
    const hasContacts = normalized.permissions.includes('android.permission.READ_CONTACTS');

    if (hasAccessibility && hasOverlay) {
        findings.push(makeFinding(
            'permission_combo',
            'high',
            'Overlay + accessibility combination',
            'This combination is commonly abused by banking trojans and credential-stealing malware.'
        ));
        riskScore += 35;
    }

    if (hasInstaller && hasQueryAll) {
        findings.push(makeFinding(
            'permission_combo',
            'high',
            'Package installation + full package visibility',
            'The app can inspect other apps and initiate installation flows, which increases abuse potential.'
        ));
        riskScore += 20;
    }

    if (hasSms && hasContacts) {
        findings.push(makeFinding(
            'permission_combo',
            'medium',
            'Messaging + contacts combination',
            'This permission set is often used for spam, phishing propagation, or OTP interception.'
        ));
        riskScore += 18;
    }

    if (normalized.permissions.length >= 25) {
        findings.push(makeFinding(
            'permission_volume',
            'medium',
            'Large permission surface',
            'The app requests an unusually broad set of permissions for a consumer Android app.',
            { permission_count: normalized.permissions.length }
        ));
        riskScore += normalized.permissions.length >= 40 ? 18 : 10;
    }

    const recentInstallWindowMs = 48 * 60 * 60 * 1000;
    if (
        normalized.firstInstallTime &&
        Date.now() - normalized.firstInstallTime <= recentInstallWindowMs &&
        (!normalized.installerPackage || !ALLOWED_INSTALLERS.has(normalized.installerPackage))
    ) {
        findings.push(makeFinding(
            'recent_sideload',
            'medium',
            'Recently installed from an unknown source',
            'A recent sideload deserves closer scrutiny because the reputation window is still short.',
            { first_install_time: normalized.firstInstallTime }
        ));
        riskScore += 10;
    }

    if (
        normalized.sizeBytes !== null &&
        normalized.sizeBytes > 0 &&
        normalized.sizeBytes < 180 * 1024 &&
        (hasOverlay || hasAccessibility || hasSms)
    ) {
        findings.push(makeFinding(
            'size_profile',
            'medium',
            'Unusually small package with sensitive capabilities',
            'A very small APK requesting sensitive permissions can be a sign of loader-style or dropper-style behavior.',
            { size_bytes: normalized.sizeBytes }
        ));
        riskScore += 12;
    }

    if (normalized.isDebuggable === true) {
        findings.push(makeFinding(
            'build_flag',
            'low',
            'Debuggable build flag present',
            'Debuggable builds are weaker from a security perspective and should not normally ship to end users.'
        ));
        riskScore += 8;
    }

    if (normalized.usesCleartextTraffic === true) {
        findings.push(makeFinding(
            'network_flag',
            'medium',
            'Cleartext traffic allowed',
            'Allowing cleartext traffic weakens transport security and can expose sensitive traffic.'
        ));
        riskScore += 12;
    }

    if (vtStats?.status === 'found') {
        if ((vtStats.malicious || 0) > 0) {
            findings.push(makeFinding(
                'virustotal',
                vtStats.malicious >= 5 ? 'high' : 'medium',
                'VirusTotal detections present',
                'One or more external engines flagged this hash as malicious or suspicious.',
                {
                    malicious: vtStats.malicious,
                    suspicious: vtStats.suspicious,
                    harmless: vtStats.harmless,
                    undetected: vtStats.undetected
                }
            ));
            riskScore += vtStats.malicious >= 5 ? 50 : 25;
        } else if ((vtStats.suspicious || 0) > 0) {
            findings.push(makeFinding(
                'virustotal',
                'medium',
                'VirusTotal suspicious verdicts present',
                'No strong malicious detections were found, but some engines marked the sample as suspicious.',
                {
                    suspicious: vtStats.suspicious,
                    harmless: vtStats.harmless,
                    undetected: vtStats.undetected
                }
            ));
            riskScore += 15;
        }
    } else if (vtStats?.status === 'error') {
        findings.push(makeFinding(
            'virustotal_lookup',
            'low',
            'VirusTotal lookup failed',
            'The external hash reputation check did not complete successfully.'
        ));
    }

    riskScore = Math.max(0, Math.min(100, riskScore));
    const verdict = classifyVerdict(riskScore, vtStats);
    const recommendations = buildRecommendations(findings, normalized);

    return {
        verdict,
        riskScore,
        findings,
        recommendations,
        metadata: {
            package_name: normalized.packageName,
            app_name: normalized.appName,
            sha256: normalized.sha256,
            installer_package: normalized.installerPackage,
            permission_count: normalized.permissions.length,
            permissions: normalized.permissions,
            target_sdk: normalized.targetSdk,
            min_sdk: normalized.minSdk,
            version_code: normalized.versionCode,
            version_name: normalized.versionName,
            signature_sha256: normalized.signatureSha256,
            certificate_subject: normalized.certificateSubject,
            first_install_time: normalized.firstInstallTime,
            last_update_time: normalized.lastUpdateTime,
            size_bytes: normalized.sizeBytes,
            is_debuggable: normalized.isDebuggable,
            uses_cleartext_traffic: normalized.usesCleartextTraffic
        }
    };
}

module.exports = {
    normalizeDeepScanPayload,
    validateDeepScanPayload,
    analyzeHeuristics
};
