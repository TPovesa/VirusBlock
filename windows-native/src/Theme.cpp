#include "NeuralV/Theme.h"

#include <algorithm>
#include <filesystem>
#include <vector>
#include <dwmapi.h>
#include <wincodec.h>
#include <winreg.h>

namespace neuralv {

namespace {

struct ComScope {
    HRESULT hr = CoInitializeEx(nullptr, COINIT_APARTMENTTHREADED);
    ~ComScope() {
        if (SUCCEEDED(hr)) {
            CoUninitialize();
        }
    }

    bool ok() const {
        return SUCCEEDED(hr) || hr == RPC_E_CHANGED_MODE;
    }
};

std::wstring ReadWallpaperPath() {
    wchar_t buffer[MAX_PATH]{};
    if (SystemParametersInfoW(SPI_GETDESKWALLPAPER, MAX_PATH, buffer, 0) && buffer[0] != L'\0') {
        return buffer;
    }
    return {};
}

COLORREF AverageWallpaperColor(const std::wstring& wallpaperPath) {
    if (wallpaperPath.empty() || !std::filesystem::exists(wallpaperPath)) {
        return CLR_INVALID;
    }

    ComScope com;
    if (!com.ok()) {
        return CLR_INVALID;
    }

    IWICImagingFactory* factory = nullptr;
    HRESULT hr = CoCreateInstance(
        CLSID_WICImagingFactory,
        nullptr,
        CLSCTX_INPROC_SERVER,
        IID_PPV_ARGS(&factory)
    );
    if (FAILED(hr) || !factory) {
        return CLR_INVALID;
    }

    IWICBitmapDecoder* decoder = nullptr;
    hr = factory->CreateDecoderFromFilename(wallpaperPath.c_str(), nullptr, GENERIC_READ, WICDecodeMetadataCacheOnDemand, &decoder);
    if (FAILED(hr) || !decoder) {
        factory->Release();
        return CLR_INVALID;
    }

    IWICBitmapFrameDecode* frame = nullptr;
    hr = decoder->GetFrame(0, &frame);
    if (FAILED(hr) || !frame) {
        decoder->Release();
        factory->Release();
        return CLR_INVALID;
    }

    IWICFormatConverter* converter = nullptr;
    hr = factory->CreateFormatConverter(&converter);
    if (FAILED(hr) || !converter) {
        frame->Release();
        decoder->Release();
        factory->Release();
        return CLR_INVALID;
    }

    hr = converter->Initialize(
        frame,
        GUID_WICPixelFormat32bppBGRA,
        WICBitmapDitherTypeNone,
        nullptr,
        0.0,
        WICBitmapPaletteTypeCustom
    );
    if (FAILED(hr)) {
        converter->Release();
        frame->Release();
        decoder->Release();
        factory->Release();
        return CLR_INVALID;
    }

    UINT width = 0;
    UINT height = 0;
    hr = converter->GetSize(&width, &height);
    if (FAILED(hr) || width == 0 || height == 0) {
        converter->Release();
        frame->Release();
        decoder->Release();
        factory->Release();
        return CLR_INVALID;
    }

    const UINT sampleWidth = std::min<UINT>(width, 96);
    const UINT sampleHeight = std::min<UINT>(height, 96);
    const UINT stride = sampleWidth * 4;
    std::vector<BYTE> pixels(stride * sampleHeight);

    hr = converter->CopyPixels(nullptr, stride, static_cast<UINT>(pixels.size()), pixels.data());
    if (FAILED(hr)) {
        converter->Release();
        frame->Release();
        decoder->Release();
        factory->Release();
        return CLR_INVALID;
    }

    unsigned long long sumR = 0;
    unsigned long long sumG = 0;
    unsigned long long sumB = 0;
    unsigned long long count = 0;
    const UINT stepX = std::max<UINT>(1, sampleWidth / 24);
    const UINT stepY = std::max<UINT>(1, sampleHeight / 24);

    for (UINT y = 0; y < sampleHeight; y += stepY) {
        for (UINT x = 0; x < sampleWidth; x += stepX) {
            const size_t offset = static_cast<size_t>(y) * stride + static_cast<size_t>(x) * 4;
            const BYTE b = pixels[offset + 0];
            const BYTE g = pixels[offset + 1];
            const BYTE r = pixels[offset + 2];
            const int brightness = static_cast<int>(r) + static_cast<int>(g) + static_cast<int>(b);
            if (brightness < 36 || brightness > 735) {
                continue;
            }
            sumR += r;
            sumG += g;
            sumB += b;
            ++count;
        }
    }

    converter->Release();
    frame->Release();
    decoder->Release();
    factory->Release();

    if (count == 0) {
        return CLR_INVALID;
    }

    return RGB(
        static_cast<BYTE>(sumR / count),
        static_cast<BYTE>(sumG / count),
        static_cast<BYTE>(sumB / count)
    );
}

COLORREF ReadAccentColor() {
    DWORD value = 0;
    DWORD size = sizeof(value);
    if (RegGetValueW(HKEY_CURRENT_USER, L"Software\\Microsoft\\Windows\\DWM", L"ColorizationColor", RRF_RT_REG_DWORD, nullptr, &value, &size) == ERROR_SUCCESS) {
        const BYTE a = static_cast<BYTE>((value >> 24) & 0xFF);
        const BYTE r = static_cast<BYTE>((value >> 16) & 0xFF);
        const BYTE g = static_cast<BYTE>((value >> 8) & 0xFF);
        const BYTE b = static_cast<BYTE>(value & 0xFF);
        if (a > 0) {
            return RGB(r, g, b);
        }
    }
    return RGB(82, 102, 255);
}

bool IsDarkMode() {
    DWORD value = 1;
    DWORD size = sizeof(value);
    if (RegGetValueW(HKEY_CURRENT_USER, L"Software\\Microsoft\\Windows\\CurrentVersion\\Themes\\Personalize", L"AppsUseLightTheme", RRF_RT_REG_DWORD, nullptr, &value, &size) == ERROR_SUCCESS) {
        return value == 0;
    }
    return false;
}

} // namespace

COLORREF BlendColor(COLORREF from, COLORREF to, double ratio) {
    ratio = std::clamp(ratio, 0.0, 1.0);
    const auto blend = [ratio](BYTE a, BYTE b) -> BYTE {
        return static_cast<BYTE>(a + (b - a) * ratio);
    };
    return RGB(
        blend(GetRValue(from), GetRValue(to)),
        blend(GetGValue(from), GetGValue(to)),
        blend(GetBValue(from), GetBValue(to))
    );
}

ThemePalette LoadThemePalette() {
    ThemePalette palette;
    palette.dark = IsDarkMode();
    const COLORREF wallpaperAccent = AverageWallpaperColor(ReadWallpaperPath());
    palette.accent = wallpaperAccent == CLR_INVALID ? ReadAccentColor() : wallpaperAccent;

    if (palette.dark) {
        palette.background = RGB(18, 19, 24);
        palette.surface = RGB(28, 30, 38);
        palette.surfaceRaised = RGB(35, 37, 48);
        palette.text = RGB(241, 242, 247);
        palette.textMuted = RGB(168, 172, 189);
        palette.outline = RGB(75, 80, 98);
    }

    palette.accentSoft = BlendColor(palette.accent, palette.surface, palette.dark ? 0.72 : 0.82);
    return palette;
}

} // namespace neuralv
