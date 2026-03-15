package api

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"strings"
	"time"
)

type Client struct {
	baseURL string
	http    *http.Client
}

type ChallengeResponse struct {
	Success     bool   `json:"success"`
	ChallengeID string `json:"challenge_id"`
	ExpiresAt   int64  `json:"expires_at"`
	Error       string `json:"error"`
}

type AuthResponse struct {
	Success      bool   `json:"success"`
	Token        string `json:"token"`
	RefreshToken string `json:"refresh_token"`
	SessionID    string `json:"session_id"`
	Error        string `json:"error"`
	User         struct {
		Name  string `json:"name"`
		Email string `json:"email"`
	} `json:"user"`
}

type ScanEnvelope struct {
	Success bool            `json:"success"`
	Scan    json.RawMessage `json:"scan"`
	Error   string          `json:"error"`
}

type ManifestResponse struct {
	Success   bool               `json:"success"`
	Artifacts []ManifestArtifact `json:"artifacts"`
	Error     string             `json:"error"`
}

type ManifestArtifact struct {
	Platform       string         `json:"platform"`
	Channel        string         `json:"channel"`
	Version        string         `json:"version"`
	DownloadURL    string         `json:"download_url"`
	InstallCommand string         `json:"install_command"`
	FileName       string         `json:"file_name"`
	Notes          []string       `json:"notes"`
	Metadata       map[string]any `json:"metadata"`
}

func NewClient(baseURL string) *Client {
	if strings.TrimSpace(baseURL) == "" {
		baseURL = "https://sosiskibot.ru/basedata"
	}

	return &Client{
		baseURL: strings.TrimRight(baseURL, "/"),
		http:    &http.Client{Timeout: 120 * time.Second},
	}
}

func (c *Client) DeviceID() string {
	host, _ := os.Hostname()
	if host == "" {
		host = "shell-host"
	}
	return fmt.Sprintf("linux-shell-%s", host)
}

func (c *Client) StartLogin(email, password string) (*ChallengeResponse, error) {
	return postJSON[ChallengeResponse](c, "/api/auth/login/start", map[string]any{
		"email":    email,
		"password": password,
		"device_id": c.DeviceID(),
	})
}

func (c *Client) VerifyLogin(challengeID, email, code string) (*AuthResponse, error) {
	return postJSON[AuthResponse](c, "/api/auth/login/verify", map[string]any{
		"challenge_id": challengeID,
		"email":        email,
		"code":         code,
		"device_id":    c.DeviceID(),
	})
}

func (c *Client) StartDesktopScan(token string, platform, mode string, artifact map[string]any) (*ScanEnvelope, error) {
	return authorizedJSON[ScanEnvelope](c, "POST", "/api/scans/desktop/start", token, map[string]any{
		"platform":          platform,
		"mode":              mode,
		"artifact_kind":     artifact["artifact_kind"],
		"artifact_metadata": artifact,
	})
}

func (c *Client) CancelDesktopScan(token string) (*ScanEnvelope, error) {
	return authorizedJSON[ScanEnvelope](c, "POST", "/api/scans/desktop/cancel-active", token, map[string]any{})
}

func (c *Client) ReleaseManifest() (*ManifestResponse, error) {
	return getJSON[ManifestResponse](c, "/api/releases/manifest")
}

func (m *ManifestResponse) Artifact(platforms ...string) *ManifestArtifact {
	for _, platform := range platforms {
		wanted := normalizePlatform(platform)
		for i := range m.Artifacts {
			if normalizePlatform(m.Artifacts[i].Platform) == wanted {
				return &m.Artifacts[i]
			}
		}
	}
	return nil
}

func normalizePlatform(platform string) string {
	normalized := strings.ToLower(strings.TrimSpace(platform))
	if normalized == "linux_shell" {
		return "shell"
	}
	return normalized
}

func postJSON[T any](c *Client, route string, payload any) (*T, error) {
	return doJSON[T](c, http.MethodPost, route, "", payload)
}

func getJSON[T any](c *Client, route string) (*T, error) {
	return doJSON[T](c, http.MethodGet, route, "", nil)
}

func authorizedJSON[T any](c *Client, method, route, token string, payload any) (*T, error) {
	return doJSON[T](c, method, route, token, payload)
}

func doJSON[T any](c *Client, method, route, token string, payload any) (*T, error) {
	var body io.Reader
	if payload != nil {
		raw, err := json.Marshal(payload)
		if err != nil {
			return nil, err
		}
		body = bytes.NewReader(raw)
	}

	req, err := http.NewRequest(method, c.baseURL+route, body)
	if err != nil {
		return nil, err
	}
	if payload != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	if token != "" {
		req.Header.Set("Authorization", "Bearer "+token)
	}

	resp, err := c.http.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	data, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, err
	}
	if resp.StatusCode >= 400 {
		return nil, fmt.Errorf("http %d: %s", resp.StatusCode, string(data))
	}
	var parsed T
	if err := json.Unmarshal(data, &parsed); err != nil {
		return nil, err
	}
	return &parsed, nil
}
