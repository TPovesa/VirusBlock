package app

import (
	"fmt"
	"os"
	"os/exec"
	"runtime"
	"strings"
	"time"

	"github.com/charmbracelet/bubbles/textinput"
	tea "github.com/charmbracelet/bubbletea"
	"github.com/charmbracelet/lipgloss"
	"github.com/perdonus/neuralv-shell/internal/api"
	"github.com/perdonus/neuralv-shell/internal/session"
)

type screen int

type statusTone int

type authStage int

const (
	screenWelcome screen = iota
	screenAuth
	screenHome
	screenScan
	screenHistory
	screenSettings
)

const (
	statusInfo statusTone = iota
	statusSuccess
	statusWarning
	statusError
)

const (
	authCredentials authStage = iota
	authCode
)

type Options struct {
	LowMotion bool
}

type Model struct {
	client  *api.Client
	store   *session.Store
	session *session.Session

	screen screen
	width  int
	height int

	manifest *api.ManifestResponse

	status     string
	statusTone statusTone
	lowMotion  bool
	frame      int

	emailInput    textinput.Model
	passwordInput textinput.Model
	codeInput     textinput.Model
	authStage     authStage
	authFocus     int
	authBusy      bool
	challenge     *api.ChallengeResponse

	scanCursor  int
	currentScan *api.DesktopScan
	lastScan    *api.DesktopScan
	scanBusy    bool

	settingsCursor int
}

type tickMsg time.Time

type authStartedMsg struct {
	challenge *api.ChallengeResponse
	err       error
}

type authVerifiedMsg struct {
	session *session.Session
	err     error
}

type manifestLoadedMsg struct {
	manifest *api.ManifestResponse
	err      error
}

type scanStartedMsg struct {
	scan *api.DesktopScan
	err  error
}

type scanPolledMsg struct {
	scan *api.DesktopScan
	err  error
}

type scanCancelledMsg struct {
	err error
}

func NewModel(client *api.Client, store *session.Store, opts Options) Model {
	saved, _ := store.Load()

	emailInput := newInput("Email", "name@example.com", false)
	passwordInput := newInput("Пароль", "Пароль", true)
	codeInput := newInput("Код", "6 цифр из письма", false)

	model := Model{
		client:         client,
		store:          store,
		session:        saved,
		lowMotion:      opts.LowMotion,
		screen:         screenWelcome,
		status:         "Готово к работе",
		statusTone:     statusInfo,
		emailInput:     emailInput,
		passwordInput:  passwordInput,
		codeInput:      codeInput,
		authStage:      authCredentials,
		authFocus:      0,
		scanCursor:     0,
		settingsCursor: 0,
	}
	if saved != nil {
		model.screen = screenHome
		model.status = "Сессия восстановлена"
		model.statusTone = statusSuccess
		model.emailInput.SetValue(saved.Email)
	}
	model.syncAuthFocus()
	return model
}

func (m Model) Init() tea.Cmd {
	return tea.Batch(m.loadManifestCmd(), tickCmd(m.lowMotion), textinput.Blink)
}

func (m Model) Update(msg tea.Msg) (tea.Model, tea.Cmd) {
	switch msg := msg.(type) {
	case tea.WindowSizeMsg:
		m.width, m.height = msg.Width, msg.Height
		return m, nil
	case tickMsg:
		m.frame++
		return m, tickCmd(m.lowMotion)
	case manifestLoadedMsg:
		if msg.err != nil {
			m.setStatus("Не удалось получить список релизов", statusWarning)
			return m, nil
		}
		m.manifest = msg.manifest
		if msg.manifest != nil {
			m.setStatus(fmt.Sprintf("Готово: доступно %d артефактов", len(msg.manifest.Artifacts)), statusSuccess)
		}
		return m, nil
	case authStartedMsg:
		m.authBusy = false
		if msg.err != nil {
			m.setStatus(cleanError(msg.err), statusError)
			return m, nil
		}
		m.challenge = msg.challenge
		m.authStage = authCode
		m.authFocus = 0
		m.codeInput.SetValue("")
		m.syncAuthFocus()
		m.setStatus("Код отправлен. Введи его и нажми Enter.", statusSuccess)
		return m, nil
	case authVerifiedMsg:
		m.authBusy = false
		if msg.err != nil {
			m.setStatus(cleanError(msg.err), statusError)
			return m, nil
		}
		m.session = msg.session
		m.challenge = nil
		m.authStage = authCredentials
		m.authFocus = 0
		m.screen = screenHome
		m.syncAuthFocus()
		m.setStatus("Вход выполнен", statusSuccess)
		return m, nil
	case scanStartedMsg:
		m.scanBusy = false
		if msg.err != nil {
			m.setStatus(cleanError(msg.err), statusError)
			return m, nil
		}
		m.currentScan = msg.scan
		if msg.scan != nil {
			m.lastScan = msg.scan
			m.setStatus(defaultScanMessage(msg.scan), statusInfo)
			if !isTerminalScanStatus(msg.scan.Status) {
				return m, pollScanCmd(m.client, m.sessionToken(), msg.scan.ID)
			}
			m.currentScan = nil
			m.setStatus(defaultScanMessage(msg.scan), toneForVerdict(msg.scan.Verdict))
		}
		return m, nil
	case scanPolledMsg:
		if msg.err != nil {
			m.setStatus(cleanError(msg.err), statusError)
			return m, nil
		}
		m.currentScan = msg.scan
		if msg.scan != nil {
			m.lastScan = msg.scan
			if isTerminalScanStatus(msg.scan.Status) {
				m.currentScan = nil
				m.setStatus(defaultScanMessage(msg.scan), toneForVerdict(msg.scan.Verdict))
				return m, nil
			}
			m.setStatus(defaultScanMessage(msg.scan), statusInfo)
			return m, pollScanCmd(m.client, m.sessionToken(), msg.scan.ID)
		}
		return m, nil
	case scanCancelledMsg:
		m.scanBusy = false
		if msg.err != nil {
			m.setStatus(cleanError(msg.err), statusError)
			return m, nil
		}
		if m.currentScan != nil {
			m.currentScan.Status = "CANCELLED"
			m.currentScan.Message = "Проверка остановлена"
			m.lastScan = m.currentScan
			m.currentScan = nil
		}
		m.setStatus("Проверка остановлена", statusWarning)
		return m, nil
	case tea.KeyMsg:
		return m.handleKey(msg)
	}

	return m, nil
}

func (m Model) handleKey(msg tea.KeyMsg) (tea.Model, tea.Cmd) {
	switch msg.String() {
	case "ctrl+c", "q":
		return m, tea.Quit
	case "left", "h":
		m.prevScreen()
		return m, nil
	case "right", "l":
		m.nextScreen()
		return m, nil
	case "1":
		m.screen = screenWelcome
		return m, nil
	case "2":
		m.screen = screenAuth
		m.syncAuthFocus()
		return m, nil
	case "3":
		m.screen = screenHome
		return m, nil
	case "4":
		m.screen = screenScan
		return m, nil
	case "5":
		m.screen = screenHistory
		return m, nil
	case "6":
		m.screen = screenSettings
		return m, nil
	}

	switch m.screen {
	case screenAuth:
		return m.handleAuthKeys(msg)
	case screenScan:
		return m.handleScanKeys(msg)
	case screenSettings:
		return m.handleSettingsKeys(msg)
	case screenWelcome:
		if msg.String() == "enter" {
			if m.session != nil {
				m.screen = screenHome
			} else {
				m.screen = screenAuth
				m.syncAuthFocus()
			}
		}
	}

	return m, nil
}

func (m Model) handleAuthKeys(msg tea.KeyMsg) (tea.Model, tea.Cmd) {
	if m.authBusy {
		return m, nil
	}

	visibleFields := m.authFieldCount()
	switch msg.String() {
	case "tab", "down", "j":
		m.authFocus = (m.authFocus + 1) % (visibleFields + 1)
		m.syncAuthFocus()
		return m, nil
	case "shift+tab", "up", "k":
		m.authFocus--
		if m.authFocus < 0 {
			m.authFocus = visibleFields
		}
		m.syncAuthFocus()
		return m, nil
	case "esc":
		if m.challenge != nil {
			m.challenge = nil
			m.authStage = authCredentials
			m.authFocus = 0
			m.syncAuthFocus()
			m.setStatus("Возврат к вводу логина", statusInfo)
		}
		return m, nil
	case "enter":
		if m.authFocus == visibleFields {
			return m.submitAuth()
		}
		m.authFocus = (m.authFocus + 1) % (visibleFields + 1)
		m.syncAuthFocus()
		return m, nil
	}

	var cmds []tea.Cmd
	m.emailInput, _ = m.emailInput.Update(msg)
	m.passwordInput, _ = m.passwordInput.Update(msg)
	m.codeInput, _ = m.codeInput.Update(msg)
	if visibleFields > 0 {
		cmds = append(cmds, textinput.Blink)
	}
	return m, tea.Batch(cmds...)
}

func (m Model) handleScanKeys(msg tea.KeyMsg) (tea.Model, tea.Cmd) {
	if m.scanBusy {
		return m, nil
	}
	options := m.scanOptionCount()
	switch msg.String() {
	case "up", "k":
		if m.scanCursor > 0 {
			m.scanCursor--
		}
		return m, nil
	case "down", "j", "tab":
		m.scanCursor = (m.scanCursor + 1) % options
		return m, nil
	case "enter":
		if m.scanCursor == 0 {
			if m.currentScan != nil && !isTerminalScanStatus(m.currentScan.Status) {
				return m, nil
			}
			if m.session == nil {
				m.screen = screenAuth
				m.syncAuthFocus()
				m.setStatus("Сначала войди в аккаунт", statusWarning)
				return m, nil
			}
			m.scanBusy = true
			m.setStatus("Отправляем профиль хоста на сервер", statusInfo)
			return m, startHostScanCmd(m.client, m.sessionToken())
		}
		if m.currentScan != nil && !isTerminalScanStatus(m.currentScan.Status) {
			m.scanBusy = true
			m.setStatus("Останавливаем проверку", statusWarning)
			return m, cancelScanCmd(m.client, m.sessionToken())
		}
	}
	return m, nil
}

func (m Model) handleSettingsKeys(msg tea.KeyMsg) (tea.Model, tea.Cmd) {
	optionCount := 3
	switch msg.String() {
	case "up", "k":
		if m.settingsCursor > 0 {
			m.settingsCursor--
		}
		return m, nil
	case "down", "j", "tab":
		m.settingsCursor = (m.settingsCursor + 1) % optionCount
		return m, nil
	case "enter":
		switch m.settingsCursor {
		case 0:
			m.lowMotion = !m.lowMotion
			if m.lowMotion {
				m.setStatus("Low-motion включён", statusSuccess)
			} else {
				m.setStatus("Low-motion выключён", statusSuccess)
			}
			return m, nil
		case 1:
			return m, m.loadManifestCmd()
		case 2:
			m.session = nil
			m.challenge = nil
			m.authStage = authCredentials
			m.authFocus = 0
			m.syncAuthFocus()
			_ = m.store.Clear()
			m.screen = screenWelcome
			m.setStatus("Сессия удалена", statusWarning)
			return m, nil
		}
	}
	return m, nil
}

func (m *Model) submitAuth() (tea.Model, tea.Cmd) {
	if m.authStage == authCredentials {
		email := strings.TrimSpace(m.emailInput.Value())
		password := strings.TrimSpace(m.passwordInput.Value())
		if email == "" || password == "" {
			m.setStatus("Заполни email и пароль", statusWarning)
			return m, nil
		}
		m.authBusy = true
		m.setStatus("Отправляем запрос на вход", statusInfo)
		return m, m.startLoginCmd()
	}

	code := strings.TrimSpace(m.codeInput.Value())
	if code == "" {
		m.setStatus("Введи код из письма", statusWarning)
		return m, nil
	}
	m.authBusy = true
	m.setStatus("Проверяем код", statusInfo)
	return m, m.verifyLoginCmd()
}

func (m *Model) syncAuthFocus() {
	m.emailInput.Blur()
	m.passwordInput.Blur()
	m.codeInput.Blur()

	if m.authStage == authCredentials {
		switch m.authFocus {
		case 0:
			m.emailInput.Focus()
		case 1:
			m.passwordInput.Focus()
		}
		return
	}

	if m.authFocus == 0 {
		m.codeInput.Focus()
	}
}

func (m Model) authFieldCount() int {
	if m.authStage == authCode {
		return 1
	}
	return 2
}

func (m Model) View() string {
	if m.width == 0 {
		m.width = 100
	}

	contentWidth := clamp(m.width-6, 56, 112)
	sections := []string{
		m.renderHeader(contentWidth),
		m.renderTabs(contentWidth),
		m.renderBody(contentWidth),
		m.renderFooter(contentWidth),
	}

	return lipgloss.NewStyle().Padding(1, 2).Render(strings.Join(sections, "\n\n"))
}

func (m Model) renderHeader(width int) string {
	brand := lipgloss.NewStyle().Bold(true).Foreground(colorAccent()).Render("NeuralV shell")
	tagline := lipgloss.NewStyle().Foreground(colorMuted()).Render("Linux CLI / TUI")
	meta := []string{
		renderPill("Сессия", func() string {
			if m.session != nil {
				return "активна"
			}
			return "гость"
		}(), func() lipgloss.Color {
			if m.session != nil {
				return colorGood()
			}
			return colorMuted()
		}()),
		renderPill("Motion", func() string {
			if m.lowMotion {
				return "low"
			}
			return "smooth"
		}(), colorAccent()),
		renderPill("Manifest", manifestStateLabel(m.manifest), colorSurfaceStrong()),
	}

	ambient := renderAmbient(width, m.frame, m.lowMotion)
	line := lipgloss.JoinHorizontal(lipgloss.Center, brand, lipgloss.NewStyle().Foreground(colorMuted()).Render("  •  "), tagline)
	status := lipgloss.NewStyle().Foreground(colorMuted()).Render("Статус: ") + renderStatusPill(m.status, m.statusTone)

	return cardStyle(width).Render(strings.Join([]string{
		line,
		ambient,
		strings.Join(meta, "  "),
		status,
	}, "\n"))
}

func (m Model) renderTabs(width int) string {
	labels := []string{"1 Обзор", "2 Вход", "3 Дом", "4 Проверка", "5 История", "6 Настройки"}
	items := make([]string, 0, len(labels))
	for idx, label := range labels {
		style := lipgloss.NewStyle().Padding(0, 1).Foreground(colorMuted())
		if m.screen == screen(idx) {
			style = style.Bold(true).Foreground(colorAccent())
		}
		items = append(items, style.Render(label))
	}
	return lipgloss.NewStyle().Width(width).Render(strings.Join(items, "  "))
}

func (m Model) renderBody(width int) string {
	switch m.screen {
	case screenWelcome:
		return m.renderWelcome(width)
	case screenAuth:
		return m.renderAuth(width)
	case screenHome:
		return m.renderHome(width)
	case screenScan:
		return m.renderScan(width)
	case screenHistory:
		return m.renderHistory(width)
	case screenSettings:
		return m.renderSettings(width)
	default:
		return ""
	}
}

func (m Model) renderWelcome(width int) string {
	left := cardStyle(columnWidth(width)).Render(strings.Join([]string{
		sectionTitle("Что это"),
		"NeuralV shell — лёгкий полноэкранный клиент для Linux. Он не пытается быть тяжёлым desktop-приложением, но даёт быстрый вход, запуск серверной проверки и понятный статус прямо в терминале.",
		"",
		sectionTitle("Как начать"),
		"1. Установи nv",
		"2. Выполни nv install neuralv@latest",
		"3. Открой neuralv и войди в аккаунт",
	}, "\n"))

	right := cardStyle(columnWidth(width)).Render(strings.Join([]string{
		sectionTitle("Почему это не лагает"),
		"• low-motion включается автоматически на слабых и удалённых терминалах",
		"• нет тяжёлых фоновых перерисовок",
		"• анимация только подчёркивает состояние, а не грузит CPU",
		"",
		sectionTitle("Навигация"),
		"Left / Right или 1-6 — экраны",
		"Tab / j / k — фокус и списки",
		"Enter — действие",
		"q — выход",
	}, "\n"))

	return joinColumns(width, left, right)
}

func (m Model) renderAuth(width int) string {
	buttonLabel := "Отправить код"
	if m.authStage == authCode {
		buttonLabel = "Подтвердить вход"
	}

	fields := []string{
		labeledField("Email", m.emailInput.View(), m.authFocus == 0 && m.authStage == authCredentials),
		labeledField("Пароль", m.passwordInput.View(), m.authFocus == 1 && m.authStage == authCredentials),
	}
	if m.authStage == authCode {
		fields = []string{labeledField("Код из письма", m.codeInput.View(), m.authFocus == 0)}
	}

	left := cardStyle(columnWidth(width)).Render(strings.Join([]string{
		sectionTitle("Вход"),
		strings.Join(fields, "\n\n"),
		"",
		renderActionButton(buttonLabel, m.authFocus == m.authFieldCount(), !m.authBusy),
	}, "\n"))

	rightLines := []string{sectionTitle("Подсказка")}
	if m.authStage == authCredentials {
		rightLines = append(rightLines,
			"После email и пароля сервер отправит код подтверждения на почту.",
			"",
			"Esc ничего не ломает: если уже открыт шаг с кодом, он вернёт тебя к логину.",
		)
	} else {
		rightLines = append(rightLines,
			"Код живёт недолго, поэтому шаг проверки вынесен отдельно и не прячет остальные экраны.",
			"",
			"Если письмо не пришло, нажми Esc и запусти вход заново.",
		)
	}

	right := cardStyle(columnWidth(width)).Render(strings.Join(rightLines, "\n"))
	return joinColumns(width, left, right)
}

func (m Model) renderHome(width int) string {
	sessionLabel := "Не авторизован"
	if m.session != nil {
		sessionLabel = m.session.Email
	}

	left := cardStyle(columnWidth(width)).Render(strings.Join([]string{
		sectionTitle("Состояние"),
		fmt.Sprintf("Профиль: %s", sessionLabel),
		fmt.Sprintf("Устройство: %s", m.client.DeviceID()),
		fmt.Sprintf("Платформа: %s / %s", runtime.GOOS, runtime.GOARCH),
		fmt.Sprintf("Менеджер пакетов: %s", detectPackageManager()),
	}, "\n"))

	right := cardStyle(columnWidth(width)).Render(strings.Join([]string{
		sectionTitle("Что дальше"),
		"• вкладка 'Проверка' запускает серверный разбор профиля хоста",
		"• вкладка 'История' показывает последний результат и таймлайн",
		"• в 'Настройках' можно переключить motion и очистить сессию",
	}, "\n"))
	return joinColumns(width, left, right)
}

func (m Model) renderScan(width int) string {
	leftLines := []string{
		sectionTitle("Действия"),
		renderChoice(m.scanCursor == 0, "Проверить этот Linux-хост", "Отправляет метаданные системы на сервер и ждёт итоговый вердикт."),
	}
	if m.currentScan != nil && !isTerminalScanStatus(m.currentScan.Status) {
		leftLines = append(leftLines, "", renderChoice(m.scanCursor == 1, "Отменить активную проверку", "Останавливает текущий серверный job без выхода из интерфейса."))
	}
	left := cardStyle(columnWidth(width)).Render(strings.Join(leftLines, "\n"))

	scan := m.currentScan
	if scan == nil {
		scan = m.lastScan
	}
	rightLines := []string{sectionTitle("Состояние проверки")}
	if scan == nil {
		rightLines = append(rightLines,
			"Здесь появится живой статус, таймлайн этапов и итог после первой проверки.",
			"",
			renderActivityLine(m.frame, m.lowMotion, false),
		)
	} else {
		rightLines = append(rightLines,
			fmt.Sprintf("Статус: %s", normalizeScanStatus(scan.Status)),
			fmt.Sprintf("Вердикт: %s", normalizeVerdict(scan.Verdict)),
			fmt.Sprintf("Сигналы: %d видимых / %d скрытых", scan.SurfacedFindings, scan.HiddenFindings),
			fmt.Sprintf("Оценка: %d/100", scan.RiskScore),
			"",
			renderActivityLine(m.frame, m.lowMotion, m.currentScan != nil && !isTerminalScanStatus(m.currentScan.Status)),
		)
		if scan.Message != "" {
			rightLines = append(rightLines, "", scan.Message)
		}
		if len(scan.Timeline) > 0 {
			rightLines = append(rightLines, "", sectionTitle("Этапы"))
			for _, stage := range scan.Timeline {
				rightLines = append(rightLines, "• "+stage)
			}
		}
	}
	return joinColumns(width, left, cardStyle(columnWidth(width)).Render(strings.Join(rightLines, "\n")))
}

func (m Model) renderHistory(width int) string {
	if m.lastScan == nil {
		return cardStyle(width).Render(strings.Join([]string{
			sectionTitle("История"),
			"Пока пусто. После первой проверки здесь останется последний итог с коротким таймлайном.",
		}, "\n"))
	}

	lines := []string{
		sectionTitle("Последний результат"),
		fmt.Sprintf("Проверка: %s", normalizeScanStatus(m.lastScan.Status)),
		fmt.Sprintf("Вердикт: %s", normalizeVerdict(m.lastScan.Verdict)),
		fmt.Sprintf("Риск: %d/100", m.lastScan.RiskScore),
		fmt.Sprintf("Видимые сигналы: %d", m.lastScan.SurfacedFindings),
	}
	if m.lastScan.Message != "" {
		lines = append(lines, "", m.lastScan.Message)
	}
	if len(m.lastScan.Findings) > 0 {
		lines = append(lines, "", sectionTitle("Что заметили"))
		for _, finding := range m.lastScan.Findings {
			lines = append(lines, fmt.Sprintf("• %s — %s", finding.Title, normalizeVerdict(finding.Verdict)))
		}
	}
	if len(m.lastScan.Timeline) > 0 {
		lines = append(lines, "", sectionTitle("Таймлайн"))
		for _, stage := range m.lastScan.Timeline {
			lines = append(lines, "• "+stage)
		}
	}
	return cardStyle(width).Render(strings.Join(lines, "\n"))
}

func (m Model) renderSettings(width int) string {
	choices := []string{
		renderChoice(m.settingsCursor == 0, "Low-motion", boolLabel(m.lowMotion, "включён", "выключен")),
		renderChoice(m.settingsCursor == 1, "Обновить manifest", "Забирает актуальные артефакты и install-команды."),
		renderChoice(m.settingsCursor == 2, "Очистить сессию", "Удаляет сохранённый токен и возвращает на стартовый экран."),
	}
	return cardStyle(width).Render(strings.Join([]string{
		sectionTitle("Настройки"),
		strings.Join(choices, "\n\n"),
		"",
		fmt.Sprintf("Хранилище сессии: %s", sessionPathHint()),
	}, "\n"))
}

func (m Model) renderFooter(width int) string {
	hints := []string{"1-6 экраны", "Tab / j / k фокус", "Enter действие", "q выход"}
	if m.currentScan != nil && !isTerminalScanStatus(m.currentScan.Status) {
		hints = append(hints, "Enter на 'Отменить' останавливает job")
	}
	return lipgloss.NewStyle().Width(width).Foreground(colorMuted()).Render(strings.Join(hints, "  •  "))
}

func (m *Model) setStatus(text string, tone statusTone) {
	m.status = strings.TrimSpace(text)
	if m.status == "" {
		m.status = "Готово"
	}
	m.statusTone = tone
}

func (m *Model) prevScreen() {
	if m.screen == screenWelcome {
		m.screen = screenSettings
	} else {
		m.screen--
	}
	if m.screen == screenAuth {
		m.syncAuthFocus()
	}
}

func (m *Model) nextScreen() {
	if m.screen == screenSettings {
		m.screen = screenWelcome
	} else {
		m.screen++
	}
	if m.screen == screenAuth {
		m.syncAuthFocus()
	}
}

func (m Model) sessionToken() string {
	if m.session == nil {
		return ""
	}
	return strings.TrimSpace(m.session.Token)
}

func (m Model) startLoginCmd() tea.Cmd {
	email := strings.TrimSpace(m.emailInput.Value())
	password := strings.TrimSpace(m.passwordInput.Value())
	return func() tea.Msg {
		challenge, err := m.client.StartLogin(email, password)
		return authStartedMsg{challenge: challenge, err: err}
	}
}

func (m Model) verifyLoginCmd() tea.Cmd {
	challenge := m.challenge
	email := strings.TrimSpace(m.emailInput.Value())
	code := strings.TrimSpace(m.codeInput.Value())
	return func() tea.Msg {
		if challenge == nil {
			return authVerifiedMsg{err: fmt.Errorf("вход не инициализирован")}
		}
		response, err := m.client.VerifyLogin(challenge.ChallengeID, email, code)
		if err != nil {
			return authVerifiedMsg{err: err}
		}
		saved := &session.Session{
			Token:        response.Token,
			RefreshToken: response.RefreshToken,
			SessionID:    response.SessionID,
			DeviceID:     m.client.DeviceID(),
			Email:        response.User.Email,
			Name:         response.User.Name,
		}
		if err := m.store.Save(saved); err != nil {
			return authVerifiedMsg{err: err}
		}
		return authVerifiedMsg{session: saved}
	}
}

func (m Model) loadManifestCmd() tea.Cmd {
	return func() tea.Msg {
		manifest, err := m.client.ReleaseManifest()
		return manifestLoadedMsg{manifest: manifest, err: err}
	}
}

func tickCmd(lowMotion bool) tea.Cmd {
	interval := 180 * time.Millisecond
	if lowMotion {
		interval = 850 * time.Millisecond
	}
	return tea.Tick(interval, func(t time.Time) tea.Msg {
		return tickMsg(t)
	})
}

func startHostScanCmd(client *api.Client, token string) tea.Cmd {
	artifact := buildLinuxHostArtifact()
	return func() tea.Msg {
		response, err := client.StartDesktopScan(token, "LINUX", "FULL", artifact)
		if err != nil {
			return scanStartedMsg{err: err}
		}
		if response == nil || response.Scan == nil {
			return scanStartedMsg{err: fmt.Errorf("сервер вернул пустой scan-ответ")}
		}
		return scanStartedMsg{scan: response.Scan}
	}
}

func pollScanCmd(client *api.Client, token string, id int64) tea.Cmd {
	return tea.Tick(2500*time.Millisecond, func(time.Time) tea.Msg {
		response, err := client.GetDesktopScan(token, id)
		if err != nil {
			return scanPolledMsg{err: err}
		}
		if response == nil || response.Scan == nil {
			return scanPolledMsg{err: fmt.Errorf("сервер не вернул scan-статус")}
		}
		return scanPolledMsg{scan: response.Scan}
	})
}

func cancelScanCmd(client *api.Client, token string) tea.Cmd {
	return func() tea.Msg {
		_, err := client.CancelDesktopScan(token)
		return scanCancelledMsg{err: err}
	}
}

func buildLinuxHostArtifact() map[string]any {
	host, _ := os.Hostname()
	if host == "" {
		host = "linux-host"
	}

	packageManager := detectPackageManager()
	desktop := detectDesktopSession()
	packageSources := []string{}
	if packageManager != "не найден" {
		packageSources = append(packageSources, packageManager)
	}
	desktopEntries := []string{}
	if desktop != "неизвестно" {
		desktopEntries = append(desktopEntries, desktop)
	}

	return map[string]any{
		"artifact_kind":     "EXECUTABLE",
		"target_name":       host,
		"target_path":       fmt.Sprintf("linux://%s/%s", runtime.GOARCH, host),
		"package_manager":   packageManager,
		"package_sources":   packageSources,
		"desktop_entries":   desktopEntries,
		"capabilities":      detectCapabilities(),
		"runs_as_root":      os.Geteuid() == 0,
		"executable":        true,
		"upload_required":   false,
		"notes":             "host profile sent from neuralv shell",
		"publisher":         "local machine",
		"file_name":         host,
		"origin_path":       os.Getenv("HOME"),
		"writable_launcher": false,
	}
}

func detectPackageManager() string {
	for _, candidate := range []string{"apt", "dnf", "yum", "pacman", "zypper", "xbps-install", "apk"} {
		if _, err := exec.LookPath(candidate); err == nil {
			return candidate
		}
	}
	return "не найден"
}

func detectDesktopSession() string {
	for _, key := range []string{"XDG_CURRENT_DESKTOP", "DESKTOP_SESSION", "GDMSESSION"} {
		value := strings.TrimSpace(os.Getenv(key))
		if value != "" {
			return value
		}
	}
	return "неизвестно"
}

func detectCapabilities() []string {
	capabilities := []string{"terminal_ui"}
	if strings.TrimSpace(os.Getenv("SSH_CONNECTION")) != "" {
		capabilities = append(capabilities, "ssh")
	}
	if strings.TrimSpace(os.Getenv("WAYLAND_DISPLAY")) != "" {
		capabilities = append(capabilities, "wayland")
	}
	if strings.TrimSpace(os.Getenv("DISPLAY")) != "" {
		capabilities = append(capabilities, "x11")
	}
	return capabilities
}

func isTerminalScanStatus(status string) bool {
	switch strings.ToUpper(strings.TrimSpace(status)) {
	case "COMPLETED", "FAILED", "CANCELLED":
		return true
	default:
		return false
	}
}

func toneForVerdict(verdict string) statusTone {
	switch strings.ToUpper(strings.TrimSpace(verdict)) {
	case "CLEAN":
		return statusSuccess
	case "LOW_RISK":
		return statusWarning
	case "SUSPICIOUS", "MALICIOUS":
		return statusError
	default:
		return statusInfo
	}
}

func defaultScanMessage(scan *api.DesktopScan) string {
	if scan == nil {
		return "Проверка не запущена"
	}
	if strings.TrimSpace(scan.Message) != "" {
		return scan.Message
	}
	return fmt.Sprintf("Проверка %s", normalizeScanStatus(scan.Status))
}

func cleanError(err error) string {
	if err == nil {
		return ""
	}
	text := strings.TrimSpace(err.Error())
	text = strings.TrimPrefix(text, "http 500: ")
	text = strings.TrimPrefix(text, "http 400: ")
	text = strings.TrimPrefix(text, "http 401: ")
	text = strings.TrimPrefix(text, "http 403: ")
	text = strings.TrimPrefix(text, "http 404: ")
	if text == "" {
		return "Неизвестная ошибка"
	}
	return text
}

func normalizeVerdict(verdict string) string {
	switch strings.ToUpper(strings.TrimSpace(verdict)) {
	case "CLEAN":
		return "чисто"
	case "LOW_RISK":
		return "низкий риск"
	case "SUSPICIOUS":
		return "подозрительно"
	case "MALICIOUS":
		return "опасно"
	default:
		return "ожидание"
	}
}

func normalizeScanStatus(status string) string {
	switch strings.ToUpper(strings.TrimSpace(status)) {
	case "QUEUED":
		return "в очереди"
	case "RUNNING":
		return "идёт"
	case "FAILED":
		return "с ошибкой"
	case "CANCELLED":
		return "отменена"
	case "COMPLETED":
		return "завершена"
	case "AWAITING_UPLOAD":
		return "ждёт артефакт"
	default:
		return strings.ToLower(strings.TrimSpace(status))
	}
}

func manifestStateLabel(manifest *api.ManifestResponse) string {
	if manifest == nil {
		return "нет данных"
	}
	if len(manifest.Artifacts) == 0 {
		return "пусто"
	}
	return fmt.Sprintf("%d pkg", len(manifest.Artifacts))
}

func renderAmbient(width, frame int, lowMotion bool) string {
	frames := []string{
		"..::....::....::....::....::....::..",
		".::....::....::....::....::....::...",
		"::....::....::....::....::....::....",
		"....::....::....::....::....::....::",
	}
	if !lowMotion {
		frames = []string{
			"__--==~~==--__..__--==~~==--__..__--",
			"_-==~~==--__..__--==~~==--__..__--=",
			"==~~==--__..__--==~~==--__..__--==~",
			"~~==--__..__--==~~==--__..__--==~~=",
		}
	}
	line := frames[frame%len(frames)]
	if width < 20 {
		return line
	}
	return lipgloss.NewStyle().Foreground(colorAccentSoft()).Width(width - 4).Render(repeatToWidth(line, width-4))
}

func renderActivityLine(frame int, lowMotion, active bool) string {
	if !active {
		return lipgloss.NewStyle().Foreground(colorMuted()).Render("Проверка сейчас не запущена.")
	}
	frames := []string{"[=     ]", "[==    ]", "[ ===  ]", "[  === ]", "[   == ]", "[    = ]"}
	if !lowMotion {
		frames = []string{"[>     ]", "[>>    ]", "[ >>>  ]", "[  >>> ]", "[   >> ]", "[    > ]"}
	}
	return lipgloss.NewStyle().Foreground(colorAccent()).Bold(true).Render(frames[frame%len(frames)] + "  Сервер обрабатывает задачу")
}

func renderPill(label, value string, color lipgloss.Color) string {
	style := lipgloss.NewStyle().Foreground(lipgloss.Color("255")).Background(color).Padding(0, 1)
	return style.Render(label+": "+value)
}

func renderStatusPill(text string, tone statusTone) string {
	color := colorSurfaceStrong()
	switch tone {
	case statusSuccess:
		color = colorGood()
	case statusWarning:
		color = colorWarn()
	case statusError:
		color = colorBad()
	}
	return lipgloss.NewStyle().Foreground(lipgloss.Color("255")).Background(color).Padding(0, 1).Render(text)
}

func renderActionButton(label string, active, enabled bool) string {
	style := lipgloss.NewStyle().Padding(0, 2).Foreground(lipgloss.Color("255")).Background(colorAccent())
	if !enabled {
		style = style.Background(colorSurfaceStrong()).Foreground(colorMuted())
	} else if active {
		style = style.Bold(true).Background(colorAccentStrong())
	}
	return style.Render(label)
}

func renderChoice(active bool, title, text string) string {
	bullet := "  "
	if active {
		bullet = lipgloss.NewStyle().Foreground(colorAccent()).Bold(true).Render("> ")
	}
	return bullet + lipgloss.NewStyle().Bold(true).Render(title) + "\n" + lipgloss.NewStyle().Foreground(colorMuted()).Render(text)
}

func labeledField(label, input string, focused bool) string {
	title := lipgloss.NewStyle().Bold(true).Render(label)
	if focused {
		title = lipgloss.NewStyle().Bold(true).Foreground(colorAccent()).Render(label)
	}
	return title + "\n" + input
}

func sectionTitle(text string) string {
	return lipgloss.NewStyle().Bold(true).Foreground(colorAccent()).Render(text)
}

func joinColumns(width int, left, right string) string {
	if width < 92 {
		return strings.Join([]string{left, right}, "\n\n")
	}
	return lipgloss.JoinHorizontal(lipgloss.Top, left, "  ", right)
}

func cardStyle(width int) lipgloss.Style {
	return lipgloss.NewStyle().Border(lipgloss.RoundedBorder()).BorderForeground(colorBorder()).Padding(1, 2).Width(width)
}

func columnWidth(total int) int {
	if total < 92 {
		return total
	}
	return (total - 2) / 2
}

func boolLabel(v bool, yes, no string) string {
	if v {
		return yes
	}
	return no
}

func sessionPathHint() string {
	configRoot, err := os.UserConfigDir()
	if err != nil {
		return "~/.config/neuralv-shell/session.json"
	}
	return configRoot + "/neuralv-shell/session.json"
}

func newInput(prompt, placeholder string, secret bool) textinput.Model {
	input := textinput.New()
	input.Prompt = ""
	input.Placeholder = placeholder
	input.CharLimit = 256
	input.Width = 42
	input.EchoMode = textinput.EchoNormal
	if secret {
		input.EchoMode = textinput.EchoPassword
		input.EchoCharacter = '*'
	}
	input.PromptStyle = lipgloss.NewStyle().Foreground(colorAccent())
	input.TextStyle = lipgloss.NewStyle().Foreground(lipgloss.Color("255"))
	input.PlaceholderStyle = lipgloss.NewStyle().Foreground(colorMuted())
	_ = prompt
	return input
}

func colorAccent() lipgloss.Color      { return lipgloss.Color("75") }
func colorAccentStrong() lipgloss.Color { return lipgloss.Color("69") }
func colorAccentSoft() lipgloss.Color   { return lipgloss.Color("110") }
func colorBorder() lipgloss.Color       { return lipgloss.Color("62") }
func colorMuted() lipgloss.Color        { return lipgloss.Color("245") }
func colorSurfaceStrong() lipgloss.Color { return lipgloss.Color("240") }
func colorGood() lipgloss.Color         { return lipgloss.Color("35") }
func colorWarn() lipgloss.Color         { return lipgloss.Color("214") }
func colorBad() lipgloss.Color          { return lipgloss.Color("160") }

func repeatToWidth(pattern string, width int) string {
	if width <= 0 || pattern == "" {
		return ""
	}
	var builder strings.Builder
	for builder.Len() < width {
		builder.WriteString(pattern)
	}
	result := builder.String()
	if len(result) > width {
		return result[:width]
	}
	return result
}

func clamp(value, low, high int) int {
	if value < low {
		return low
	}
	if value > high {
		return high
	}
	return value
}

func (m Model) scanOptionCount() int {
	if m.currentScan != nil && !isTerminalScanStatus(m.currentScan.Status) {
		return 2
	}
	return 1
}
