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

type DesktopScanEnvelope struct {
	Success bool         `json:"success"`
	Scan    *DesktopScan `json:"scan"`
	Error   string       `json:"error"`
}

type CancelResponse struct {
	Success     bool   `json:"success"`
	CancelledAt int64  `json:"cancelled_at"`
	Error       string `json:"error"`
}

type DesktopScan struct {
	ID               int64            `json:"id"`
	Platform         string           `json:"platform"`
	Mode             string           `json:"mode"`
	Status           string           `json:"status"`
	Verdict          string           `json:"verdict"`
	RiskScore        int              `json:"risk_score"`
	SurfacedFindings int              `json:"surfaced_findings"`
	HiddenFindings   int              `json:"hidden_findings"`
	StartedAt        int64            `json:"started_at"`
	CompletedAt      int64            `json:"completed_at"`
	Message          string           `json:"message"`
	Timeline         []string         `json:"timeline"`
	Findings         []DesktopFinding `json:"findings"`
}

type DesktopFinding struct {
	ID      string   `json:"id"`
	Title   string   `json:"title"`
	Verdict string   `json:"verdict"`
	Summary string   `json:"summary"`
	Engines []string `json:"engines"`
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
	response, err := postJSON[ChallengeResponse](c, "/api/auth/login/start", map[string]any{
		"email":     email,
		"password":  password,
		"device_id": c.DeviceID(),
	})
	if err != nil {
		return nil, err
	}
	if response != nil && !response.Success && strings.TrimSpace(response.Error) != "" {
		return nil, fmt.Errorf(response.Error)
	}
	return response, nil
}

func (c *Client) VerifyLogin(challengeID, email, code string) (*AuthResponse, error) {
	response, err := postJSON[AuthResponse](c, "/api/auth/login/verify", map[string]any{
		"challenge_id": challengeID,
		"email":        email,
		"code":         code,
		"device_id":    c.DeviceID(),
	})
	if err != nil {
		return nil, err
	}
	if response != nil && !response.Success && strings.TrimSpace(response.Error) != "" {
		return nil, fmt.Errorf(response.Error)
	}
	return response, nil
}

func (c *Client) StartDesktopScan(token string, platform, mode string, artifact map[string]any) (*DesktopScanEnvelope, error) {
	response, err := authorizedJSON[DesktopScanEnvelope](c, http.MethodPost, "/api/scans/desktop/start", token, map[string]any{
		"platform":          platform,
		"mode":              mode,
		"artifact_kind":     artifact["artifact_kind"],
		"artifact_metadata": artifact,
	})
	if err != nil {
		return nil, err
	}
	if response != nil && !response.Success && strings.TrimSpace(response.Error) != "" {
		return nil, fmt.Errorf(response.Error)
	}
	return response, nil
}

func (c *Client) GetDesktopScan(token string, id int64) (*DesktopScanEnvelope, error) {
	response, err := authorizedJSON[DesktopScanEnvelope](c, http.MethodGet, fmt.Sprintf("/api/scans/desktop/%d", id), token, nil)
	if err != nil {
		return nil, err
	}
	if response != nil && !response.Success && strings.TrimSpace(response.Error) != "" {
		return nil, fmt.Errorf(response.Error)
	}
	return response, nil
}

func (c *Client) CancelDesktopScan(token string) (*CancelResponse, error) {
	response, err := authorizedJSON[CancelResponse](c, http.MethodPost, "/api/scans/desktop/cancel-active", token, map[string]any{})
	if err != nil {
		return nil, err
	}
	if response != nil && !response.Success && strings.TrimSpace(response.Error) != "" {
		return nil, fmt.Errorf(response.Error)
	}
	return response, nil
}

func (c *Client) ReleaseManifest() (*ManifestResponse, error) {
	response, err := getJSON[ManifestResponse](c, "/api/releases/manifest")
	if err != nil {
		return nil, err
	}
	if response != nil && !response.Success && strings.TrimSpace(response.Error) != "" {
		return nil, fmt.Errorf(response.Error)
	}
	return response, nil
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
		return nil, fmt.Errorf("http %d: %s", resp.StatusCode, strings.TrimSpace(string(data)))
	}
	var parsed T
	if err := json.Unmarshal(data, &parsed); err != nil {
		return nil, err
	}
	return &parsed, nil
}
