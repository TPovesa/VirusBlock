package main

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log"
	"net"
	"net/http"
	"os"
	"strings"
	"time"

	"github.com/charmbracelet/bubbles/textinput"
	tea "github.com/charmbracelet/bubbletea"
	"github.com/charmbracelet/lipgloss"
	"github.com/perdonus/neuralv-shell/internal/api"
	"github.com/perdonus/neuralv-shell/internal/app"
	"github.com/perdonus/neuralv-shell/internal/session"
)

const (
	defaultBaseURL = "https://sosiskibot.ru/basedata"
)

var cliVersion = "1.3.1"

var authHTTPClient = &http.Client{Timeout: 150 * time.Second}

type authMode int

type authStep int

type authTone int

const (
	authModeLogin authMode = iota + 1
	authModeRegister
)

const (
	authStepChoice authStep = iota
	authStepLoginEmail
	authStepLoginPassword
	authStepLoginCode
	authStepRegisterEmail
	authStepRegisterPassword
	authStepRegisterRepeatPassword
	authStepRegisterCode
	authStepSuccess
)

const (
	authToneInfo authTone = iota
	authToneSuccess
	authToneError
)

type authChallengeResponse struct {
	Success     bool   `json:"success"`
	ChallengeID string `json:"challenge_id"`
	ExpiresAt   int64  `json:"expires_at"`
	Error       string `json:"error"`
}

type authResponse struct {
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

type authErrorResponse struct {
	Error string `json:"error"`
}

type authStartedMsg struct {
	challenge *authChallengeResponse
	err       error
}

type authCompletedMsg struct {
	session *session.Session
	mode    authMode
	err     error
}

type authAdvanceMsg struct{}

type authModel struct {
	client    *api.Client
	store     *session.Store
	lowMotion bool

	width  int
	height int

	step       authStep
	mode       authMode
	busy       bool
	challenge  *authChallengeResponse
	session    *session.Session
	status     string
	statusTone authTone

	emailInput    textinput.Model
	passwordInput textinput.Model
	repeatInput   textinput.Model
	codeInput     textinput.Model
}

func main() {
	_, opts, handled := handleCLI(os.Args[1:])
	if handled {
		return
	}

	store, err := session.NewStore()
	if err != nil {
		log.Fatal(err)
	}
	client := api.NewClient(resolveBaseURL())

	saved, err := store.Load()
	if err != nil {
		log.Fatal(err)
	}
	if saved == nil {
		authProgram := tea.NewProgram(newAuthModel(client, store, opts), tea.WithAltScreen())
		finalModel, err := authProgram.Run()
		if err != nil {
			log.Fatal(err)
		}
		authResult, ok := finalModel.(*authModel)
		if !ok || authResult.session == nil {
			return
		}
	}

	program := tea.NewProgram(app.NewModel(client, store, opts), tea.WithAltScreen())
	if _, err := program.Run(); err != nil {
		log.Fatal(err)
	}
}

func resolveBaseURL() string {
	baseURL := strings.TrimSpace(os.Getenv("NEURALV_BASE_URL"))
	if baseURL == "" {
		return defaultBaseURL
	}
	return baseURL
}

func handleCLI(args []string) ([]string, app.Options, bool) {
	opts := app.Options{LowMotion: defaultLowMotion()}
	passthrough := make([]string, 0, len(args))

	for _, arg := range args {
		switch arg {
		case "--low-motion":
			opts.LowMotion = true
		case "--motion", "--rich-motion":
			opts.LowMotion = false
		case "doctor":
			printDoctor(opts)
			return nil, opts, true
		case "-v", "--version", "version":
			fmt.Printf("neuralv %s\n", cliVersion)
			return nil, opts, true
		case "help", "-h", "--help":
			printHelp()
			return nil, opts, true
		default:
			passthrough = append(passthrough, arg)
		}
	}

	if len(passthrough) > 0 {
		printHelp()
		fmt.Fprintf(os.Stderr, "\nНеизвестная команда: %s\n", strings.Join(passthrough, " "))
		return passthrough, opts, true
	}

	return nil, opts, false
}

func printHelp() {
	fmt.Println(`neuralv

Использование:
  neuralv [--low-motion|--motion]
  neuralv doctor
  neuralv --version`)
}

func defaultLowMotion() bool {
	if value := strings.TrimSpace(os.Getenv("NEURALV_LOW_MOTION")); value != "" {
		value = strings.ToLower(value)
		return value == "1" || value == "true" || value == "yes" || value == "on"
	}
	if strings.TrimSpace(os.Getenv("SSH_CONNECTION")) != "" || strings.TrimSpace(os.Getenv("SSH_TTY")) != "" {
		return true
	}
	if strings.TrimSpace(os.Getenv("COLORTERM")) == "" {
		return true
	}
	term := strings.ToLower(strings.TrimSpace(os.Getenv("TERM")))
	if term == "" || term == "dumb" || term == "linux" {
		return true
	}
	return false
}

func printDoctor(opts app.Options) {
	client := api.NewClient(resolveBaseURL())

	fmt.Printf("neuralv %s\n\n", cliVersion)
	fmt.Println("Окружение")
	fmt.Printf("  Base URL:        %s\n", client.BaseURL())
	fmt.Printf("  Device ID:       %s\n", client.DeviceID())
	fmt.Printf("  Motion profile:  %s\n", map[bool]string{true: "low-motion", false: "smooth"}[opts.LowMotion])
	fmt.Printf("  Package manager: %s\n", app.DetectPackageManager())
	fmt.Printf("  Desktop session: %s\n", app.DetectDesktopSession())
	fmt.Printf("  SSH session:     %s\n", yesNo(strings.TrimSpace(os.Getenv("SSH_CONNECTION")) != ""))
	fmt.Printf("  Terminal:        %s\n", terminalName())
}

func yesNo(value bool) string {
	if value {
		return "yes"
	}
	return "no"
}

func terminalName() string {
	if value := strings.TrimSpace(os.Getenv("TERM")); value != "" {
		return value
	}
	return "unknown"
}

func newAuthModel(client *api.Client, store *session.Store, opts app.Options) *authModel {
	emailInput := newAuthInput("name@example.com", false)
	passwordInput := newAuthInput("Пароль", true)
	repeatInput := newAuthInput("Повтори пароль", true)
	codeInput := newAuthInput("6 цифр", false)

	m := &authModel{
		client:         client,
		store:          store,
		lowMotion:      opts.LowMotion,
		step:           authStepChoice,
		status:         "",
		statusTone:     authToneInfo,
		emailInput:     emailInput,
		passwordInput:  passwordInput,
		repeatInput:    repeatInput,
		codeInput:      codeInput,
	}
	m.syncFocus()
	return m
}

func (m *authModel) Init() tea.Cmd {
	return textinput.Blink
}

func (m *authModel) Update(msg tea.Msg) (tea.Model, tea.Cmd) {
	switch msg := msg.(type) {
	case tea.WindowSizeMsg:
		m.width, m.height = msg.Width, msg.Height
		return m, nil
	case authStartedMsg:
		m.busy = false
		if msg.err != nil {
			m.setStatus(msg.err.Error(), authToneError)
			return m, nil
		}
		if msg.challenge == nil || strings.TrimSpace(msg.challenge.ChallengeID) == "" {
			m.setStatus("сервер не вернул код подтверждения", authToneError)
			return m, nil
		}
		m.challenge = msg.challenge
		m.codeInput.SetValue("")
		if m.mode == authModeRegister {
			m.step = authStepRegisterCode
		} else {
			m.step = authStepLoginCode
		}
		m.syncFocus()
		m.setStatus("Код отправлен", authToneSuccess)
		return m, nil
	case authCompletedMsg:
		m.busy = false
		if msg.err != nil {
			m.setStatus(msg.err.Error(), authToneError)
			return m, nil
		}
		m.session = msg.session
		m.step = authStepSuccess
		m.syncFocus()
		if msg.mode == authModeRegister {
			m.setStatus("Регистрация завершена", authToneSuccess)
		} else {
			m.setStatus("Вход выполнен", authToneSuccess)
		}
		return m, authAdvanceCmd(m.lowMotion)
	case authAdvanceMsg:
		return m, tea.Quit
	case tea.KeyMsg:
		return m.handleKey(msg)
	}

	return m, nil
}

func (m *authModel) handleKey(msg tea.KeyMsg) (tea.Model, tea.Cmd) {
	switch msg.String() {
	case "ctrl+c":
		return m, tea.Quit
	}

	if m.busy {
		return m, nil
	}

	if m.step == authStepChoice {
		return m.handleChoice(msg)
	}
	if m.step == authStepSuccess {
		return m, nil
	}
	return m.handleFlow(msg)
}

func (m *authModel) handleChoice(msg tea.KeyMsg) (tea.Model, tea.Cmd) {
	switch msg.String() {
	case "1", "enter":
		m.mode = authModeLogin
		m.step = authStepLoginEmail
		m.challenge = nil
		m.setStatus("", authToneInfo)
		m.syncFocus()
	case "2":
		m.mode = authModeRegister
		m.step = authStepRegisterEmail
		m.challenge = nil
		m.setStatus("", authToneInfo)
		m.syncFocus()
	}
	return m, nil
}

func (m *authModel) handleFlow(msg tea.KeyMsg) (tea.Model, tea.Cmd) {
	switch msg.String() {
	case "esc":
		m.goBack()
		return m, nil
	case "enter":
		return m.submitCurrentStep()
	}

	switch m.step {
	case authStepLoginEmail, authStepRegisterEmail:
		m.emailInput, _ = m.emailInput.Update(msg)
	case authStepLoginPassword, authStepRegisterPassword:
		m.passwordInput, _ = m.passwordInput.Update(msg)
	case authStepRegisterRepeatPassword:
		m.repeatInput, _ = m.repeatInput.Update(msg)
	case authStepLoginCode, authStepRegisterCode:
		m.codeInput, _ = m.codeInput.Update(msg)
	}

	return m, textinput.Blink
}

func (m *authModel) submitCurrentStep() (tea.Model, tea.Cmd) {
	switch m.step {
	case authStepLoginEmail:
		email := normalizeAuthEmail(m.emailInput.Value())
		if !looksLikeEmail(email) {
			m.setStatus("Введите корректный email", authToneError)
			return m, nil
		}
		m.emailInput.SetValue(email)
		m.step = authStepLoginPassword
		m.syncFocus()
		m.setStatus("", authToneInfo)
		return m, nil
	case authStepLoginPassword:
		if m.passwordInput.Value() == "" {
			m.setStatus("Введите пароль", authToneError)
			return m, nil
		}
		m.busy = true
		m.setStatus("Отправляем код", authToneInfo)
		return m, startLoginCmd(m.client, m.emailInput.Value(), m.passwordInput.Value())
	case authStepLoginCode:
		code := strings.TrimSpace(m.codeInput.Value())
		if code == "" {
			m.setStatus("Введите код", authToneError)
			return m, nil
		}
		m.busy = true
		m.setStatus("Проверяем код", authToneInfo)
		return m, verifyLoginCmd(m.client, m.store, m.challenge, m.emailInput.Value(), code)
	case authStepRegisterEmail:
		email := normalizeAuthEmail(m.emailInput.Value())
		if !looksLikeEmail(email) {
			m.setStatus("Введите корректный email", authToneError)
			return m, nil
		}
		m.emailInput.SetValue(email)
		m.step = authStepRegisterPassword
		m.syncFocus()
		m.setStatus("", authToneInfo)
		return m, nil
	case authStepRegisterPassword:
		password := m.passwordInput.Value()
		if len(password) < 6 {
			m.setStatus("Пароль минимум 6 символов", authToneError)
			return m, nil
		}
		m.step = authStepRegisterRepeatPassword
		m.syncFocus()
		m.setStatus("", authToneInfo)
		return m, nil
	case authStepRegisterRepeatPassword:
		password := m.passwordInput.Value()
		repeat := m.repeatInput.Value()
		if repeat == "" {
			m.setStatus("Повторите пароль", authToneError)
			return m, nil
		}
		if password != repeat {
			m.setStatus("Пароли не совпадают", authToneError)
			return m, nil
		}
		m.busy = true
		m.setStatus("Отправляем код", authToneInfo)
		return m, startRegisterCmd(m.client, m.emailInput.Value(), password)
	case authStepRegisterCode:
		code := strings.TrimSpace(m.codeInput.Value())
		if code == "" {
			m.setStatus("Введите код", authToneError)
			return m, nil
		}
		m.busy = true
		m.setStatus("Проверяем код", authToneInfo)
		return m, verifyRegisterCmd(m.client, m.store, m.challenge, code)
	default:
		return m, nil
	}
}

func (m *authModel) goBack() {
	m.challenge = nil
	m.codeInput.SetValue("")
	m.setStatus("", authToneInfo)

	switch m.step {
	case authStepLoginEmail, authStepRegisterEmail:
		m.step = authStepChoice
		m.mode = 0
	case authStepLoginPassword:
		m.step = authStepLoginEmail
	case authStepLoginCode:
		m.step = authStepLoginPassword
	case authStepRegisterPassword:
		m.step = authStepRegisterEmail
	case authStepRegisterRepeatPassword:
		m.step = authStepRegisterPassword
	case authStepRegisterCode:
		m.step = authStepRegisterRepeatPassword
	}
	m.syncFocus()
}

func (m *authModel) syncFocus() {
	m.emailInput.Blur()
	m.passwordInput.Blur()
	m.repeatInput.Blur()
	m.codeInput.Blur()

	switch m.step {
	case authStepLoginEmail, authStepRegisterEmail:
		m.emailInput.Focus()
	case authStepLoginPassword, authStepRegisterPassword:
		m.passwordInput.Focus()
	case authStepRegisterRepeatPassword:
		m.repeatInput.Focus()
	case authStepLoginCode, authStepRegisterCode:
		m.codeInput.Focus()
	}
}

func (m *authModel) setStatus(text string, tone authTone) {
	m.status = strings.TrimSpace(text)
	m.statusTone = tone
}

func (m *authModel) View() string {
	width := m.width
	if width == 0 {
		width = 80
	}
	bodyWidth := width - 8
	if bodyWidth < 42 {
		bodyWidth = 42
	}
	if bodyWidth > 72 {
		bodyWidth = 72
	}

	card := lipgloss.NewStyle().Width(bodyWidth).Border(lipgloss.NormalBorder()).BorderForeground(authBorderColor()).Padding(1, 2)
	titleStyle := lipgloss.NewStyle().Bold(true).Foreground(authAccentColor())
	dimStyle := lipgloss.NewStyle().Foreground(authMutedColor())

	var lines []string
	switch m.step {
	case authStepChoice:
		lines = []string{
			titleStyle.Render("NeuralV"),
			"",
			"1. Вход",
			"2. Регистрация",
		}
	case authStepLoginEmail:
		lines = m.renderFieldScreen(titleStyle, dimStyle, "Вход", "Email", m.emailInput.View())
	case authStepLoginPassword:
		lines = m.renderFieldScreen(titleStyle, dimStyle, "Вход", "Пароль", m.passwordInput.View())
	case authStepLoginCode:
		lines = m.renderFieldScreen(titleStyle, dimStyle, "Вход", "Код", m.codeInput.View())
	case authStepRegisterEmail:
		lines = m.renderFieldScreen(titleStyle, dimStyle, "Регистрация", "Email", m.emailInput.View())
	case authStepRegisterPassword:
		lines = m.renderFieldScreen(titleStyle, dimStyle, "Регистрация", "Пароль", m.passwordInput.View())
	case authStepRegisterRepeatPassword:
		lines = m.renderFieldScreen(titleStyle, dimStyle, "Регистрация", "Повтори пароль", m.repeatInput.View())
	case authStepRegisterCode:
		lines = m.renderFieldScreen(titleStyle, dimStyle, "Регистрация", "Код", m.codeInput.View())
	case authStepSuccess:
		lines = []string{
			titleStyle.Render("NeuralV"),
			"",
			lipgloss.NewStyle().Bold(true).Foreground(authSuccessColor()).Render(m.status),
		}
	}

	if m.step != authStepSuccess && m.status != "" {
		lines = append(lines, "", authStatusStyle(m.statusTone).Render(m.status))
	}
	if m.busy {
		lines = append(lines, "", dimStyle.Render("Подождите..."))
	}

	content := card.Render(strings.Join(lines, "\n"))
	return lipgloss.Place(width, max(10, m.height), lipgloss.Center, lipgloss.Center, content)
}

func (m *authModel) renderFieldScreen(titleStyle, dimStyle lipgloss.Style, title, label, value string) []string {
	lines := []string{
		titleStyle.Render("NeuralV"),
		"",
		dimStyle.Render(title),
		label,
		value,
	}
	if m.step != authStepLoginEmail && m.step != authStepRegisterEmail {
		lines = append(lines, "", dimStyle.Render("Esc назад"))
	}
	return lines
}

func newAuthInput(placeholder string, secret bool) textinput.Model {
	input := textinput.New()
	input.Prompt = ""
	input.Placeholder = placeholder
	input.CharLimit = 256
	input.Width = 42
	input.TextStyle = lipgloss.NewStyle().Foreground(lipgloss.Color("255"))
	input.PlaceholderStyle = lipgloss.NewStyle().Foreground(authMutedColor())
	if secret {
		input.EchoMode = textinput.EchoPassword
		input.EchoCharacter = '*'
	}
	return input
}

func startLoginCmd(client *api.Client, email, password string) tea.Cmd {
	email = normalizeAuthEmail(email)
	return func() tea.Msg {
		challenge, err := authRequest[authChallengeResponse](client, "/api/auth/login/start", map[string]any{
			"email":     email,
			"password":  password,
			"device_id": client.DeviceID(),
		})
		return authStartedMsg{challenge: challenge, err: err}
	}
}

func verifyLoginCmd(client *api.Client, store *session.Store, challenge *authChallengeResponse, email, code string) tea.Cmd {
	email = normalizeAuthEmail(email)
	code = strings.TrimSpace(code)
	return func() tea.Msg {
		if challenge == nil || strings.TrimSpace(challenge.ChallengeID) == "" {
			return authCompletedMsg{err: fmt.Errorf("сначала запросите код")}
		}
		response, err := authRequest[authResponse](client, "/api/auth/login/verify", map[string]any{
			"challenge_id": challenge.ChallengeID,
			"email":        email,
			"code":         code,
			"device_id":    client.DeviceID(),
		})
		if err != nil {
			return authCompletedMsg{err: err}
		}
		saved := &session.Session{
			Token:        response.Token,
			RefreshToken: response.RefreshToken,
			SessionID:    response.SessionID,
			DeviceID:     client.DeviceID(),
			Email:        response.User.Email,
			Name:         response.User.Name,
		}
		if err := store.Save(saved); err != nil {
			return authCompletedMsg{err: err}
		}
		return authCompletedMsg{session: saved, mode: authModeLogin}
	}
}

func startRegisterCmd(client *api.Client, email, password string) tea.Cmd {
	email = normalizeAuthEmail(email)
	return func() tea.Msg {
		challenge, err := authRequest[authChallengeResponse](client, "/api/auth/register/start", map[string]any{
			"name":      deriveDisplayName(email),
			"email":     email,
			"password":  password,
			"device_id": client.DeviceID(),
		})
		return authStartedMsg{challenge: challenge, err: err}
	}
}

func verifyRegisterCmd(client *api.Client, store *session.Store, challenge *authChallengeResponse, code string) tea.Cmd {
	code = strings.TrimSpace(code)
	return func() tea.Msg {
		if challenge == nil || strings.TrimSpace(challenge.ChallengeID) == "" {
			return authCompletedMsg{err: fmt.Errorf("сначала запросите код")}
		}
		response, err := authRequest[authResponse](client, "/api/auth/register/verify", map[string]any{
			"challenge_id": challenge.ChallengeID,
			"code":         code,
			"device_id":    client.DeviceID(),
		})
		if err != nil {
			return authCompletedMsg{err: err}
		}
		saved := &session.Session{
			Token:        response.Token,
			RefreshToken: response.RefreshToken,
			SessionID:    response.SessionID,
			DeviceID:     client.DeviceID(),
			Email:        response.User.Email,
			Name:         response.User.Name,
		}
		if err := store.Save(saved); err != nil {
			return authCompletedMsg{err: err}
		}
		return authCompletedMsg{session: saved, mode: authModeRegister}
	}
}

func authRequest[T any](client *api.Client, route string, payload any) (*T, error) {
	raw, err := json.Marshal(payload)
	if err != nil {
		return nil, err
	}

	req, err := http.NewRequest(http.MethodPost, client.BaseURL()+route, bytes.NewReader(raw))
	if err != nil {
		return nil, err
	}
	req.Header.Set("Content-Type", "application/json")

	resp, err := authHTTPClient.Do(req)
	if err != nil {
		var netErr net.Error
		if errors.As(err, &netErr) && netErr.Timeout() {
			return nil, fmt.Errorf("сервер отвечает слишком долго")
		}
		return nil, fmt.Errorf("не удалось подключиться к серверу")
	}
	defer resp.Body.Close()

	data, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, err
	}
	if resp.StatusCode >= 400 {
		return nil, fmt.Errorf("%s", authHTTPErrorText(resp.StatusCode, localizeAuthError(extractAPIError(data))))
	}

	var parsed T
	if err := json.Unmarshal(data, &parsed); err != nil {
		return nil, err
	}
	return &parsed, nil
}

func extractAPIError(data []byte) string {
	var parsed authErrorResponse
	if err := json.Unmarshal(data, &parsed); err == nil && strings.TrimSpace(parsed.Error) != "" {
		return strings.TrimSpace(parsed.Error)
	}
	return strings.TrimSpace(string(data))
}

func authHTTPErrorText(statusCode int, body string) string {
	if body != "" {
		return body
	}
	switch statusCode {
	case http.StatusTooManyRequests:
		return "слишком много попыток, попробуйте позже"
	case http.StatusBadGateway, http.StatusServiceUnavailable, http.StatusGatewayTimeout:
		return "сервер сейчас недоступен"
	default:
		return fmt.Sprintf("ошибка сервера (%d)", statusCode)
	}
}

func localizeAuthError(text string) string {
	switch strings.ToLower(strings.TrimSpace(text)) {
	case "all fields are required":
		return "заполните все поля"
	case "email and password required":
		return "введите email и пароль"
	case "invalid email address":
		return "введите корректный email"
	case "password must be at least 6 characters":
		return "пароль минимум 6 символов"
	case "email already registered":
		return "email уже зарегистрирован"
	case "challenge not found", "challenge already used":
		return "код больше недействителен"
	case "code expired":
		return "код истёк"
	case "invalid code":
		return "неверный код"
	case "invalid email or password":
		return "неверный email или пароль"
	case "too many login attempts. try again later.":
		return "слишком много попыток, попробуйте позже"
	case "mail service is not configured":
		return "почтовый сервис недоступен"
	case "server error":
		return "ошибка сервера"
	default:
		return strings.TrimSpace(text)
	}
}

func normalizeAuthEmail(value string) string {
	return strings.ToLower(strings.TrimSpace(value))
}

func looksLikeEmail(value string) bool {
	if value == "" || strings.Contains(value, " ") {
		return false
	}
	at := strings.Index(value, "@")
	dot := strings.LastIndex(value, ".")
	return at > 0 && dot > at+1 && dot < len(value)-1
}

func deriveDisplayName(email string) string {
	name := email
	if idx := strings.Index(name, "@"); idx > 0 {
		name = name[:idx]
	}
	replacer := strings.NewReplacer(".", " ", "_", " ", "-", " ")
	name = strings.TrimSpace(replacer.Replace(name))
	if name == "" {
		return "NeuralV User"
	}
	return name
}

func authAdvanceCmd(lowMotion bool) tea.Cmd {
	delay := 900 * time.Millisecond
	if lowMotion {
		delay = 1200 * time.Millisecond
	}
	return tea.Tick(delay, func(time.Time) tea.Msg {
		return authAdvanceMsg{}
	})
}

func authAccentColor() lipgloss.Color {
	return lipgloss.Color("75")
}

func authBorderColor() lipgloss.Color {
	return lipgloss.Color("62")
}

func authMutedColor() lipgloss.Color {
	return lipgloss.Color("245")
}

func authSuccessColor() lipgloss.Color {
	return lipgloss.Color("35")
}

func authErrorColor() lipgloss.Color {
	return lipgloss.Color("160")
}

func authStatusStyle(tone authTone) lipgloss.Style {
	style := lipgloss.NewStyle().Foreground(authMutedColor())
	switch tone {
	case authToneSuccess:
		return style.Foreground(authSuccessColor())
	case authToneError:
		return style.Foreground(authErrorColor())
	default:
		return style
	}
}

func max(a, b int) int {
	if a > b {
		return a
	}
	return b
}
