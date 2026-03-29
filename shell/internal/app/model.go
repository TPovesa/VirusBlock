package app

import (
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"sort"
	"strings"
	"time"

	"github.com/charmbracelet/bubbles/textinput"
	tea "github.com/charmbracelet/bubbletea"
	"github.com/charmbracelet/lipgloss"
	"github.com/TPovesa/VirusBlock/shell/internal/api"
	"github.com/TPovesa/VirusBlock/shell/internal/logging"
	"github.com/TPovesa/VirusBlock/shell/internal/session"
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
	scanLogOffset int
	historyOffset int

	settingsCursor int
	restartAuth    bool
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
		screen:         screenHome,
		status:         "Готово к проверке",
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
		model.status = "Сессия восстановлена"
		model.statusTone = statusSuccess
		model.emailInput.SetValue(saved.Email)
	}
	model.syncAuthFocus()
	model.syncInputWidths()
	return model
}

func (m Model) Init() tea.Cmd {
	return tea.Batch(tickCmd(m.lowMotion), textinput.Blink, tea.EnableMouseCellMotion, m.loadManifestCmd())
}

func (m Model) Update(msg tea.Msg) (tea.Model, tea.Cmd) {
	switch msg := msg.(type) {
	case tea.WindowSizeMsg:
		if msg.Width != m.width || msg.Height != m.height {
			logging.Event("resize", "main viewport=%dx%d screen=%d", msg.Width, msg.Height, m.screen)
		}
		m.width, m.height = msg.Width, msg.Height
		m.syncInputWidths()
		m.clampScrollOffsets()
		return m, nil
	case tickMsg:
		m.frame++
		return m, tickCmd(m.lowMotion)
	case manifestLoadedMsg:
		if msg.err != nil {
			logging.Error("manifest load failed: %v", msg.err)
			m.setStatus("Не удалось обновить список загрузок", statusWarning)
			return m, nil
		}
		m.manifest = msg.manifest
		if msg.manifest != nil {
			logging.Event("startup", "manifest loaded artifacts=%d", len(msg.manifest.Artifacts))
			m.setStatus("Список загрузок обновлён", statusSuccess)
		}
		return m, nil
	case authStartedMsg:
		m.authBusy = false
		if msg.err != nil {
			logging.Error("auth start failed in main app: %v", msg.err)
			m.setStatus(cleanError(msg.err), statusError)
			return m, nil
		}
		m.challenge = msg.challenge
		m.authStage = authCode
		m.authFocus = 0
		m.codeInput.SetValue("")
		m.syncAuthFocus()
		if msg.challenge != nil {
			logging.Event("auth", "challenge created in main app challenge=%s", msg.challenge.ChallengeID)
		}
		m.setStatus("Код отправлен. Введи его и нажми Enter.", statusSuccess)
		return m, nil
	case authVerifiedMsg:
		m.authBusy = false
		if msg.err != nil {
			logging.Error("auth verify failed in main app: %v", msg.err)
			m.setStatus(cleanError(msg.err), statusError)
			return m, nil
		}
		m.session = msg.session
		m.challenge = nil
		m.authStage = authCredentials
		m.authFocus = 0
		m.screen = screenScan
		m.syncAuthFocus()
		if msg.session != nil {
			logging.Event("auth", "session saved in main app email=%s", msg.session.Email)
		}
		m.setStatus("Вход выполнен", statusSuccess)
		return m, nil
	case scanStartedMsg:
		m.scanBusy = false
		if msg.err != nil {
			logging.Error("scan start failed: %v", msg.err)
			m.setStatus(cleanError(msg.err), statusError)
			return m, nil
		}
		m.currentScan = msg.scan
		if msg.scan != nil {
			m.lastScan = msg.scan
			m.pinScanLogToLatest(msg.scan)
			logging.Event("scan", "started id=%s status=%s mode=%s", msg.scan.ID, msg.scan.Status, msg.scan.Mode)
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
			logging.Error("scan poll failed: %v", msg.err)
			m.setStatus(cleanError(msg.err), statusError)
			return m, nil
		}
		m.currentScan = msg.scan
		if msg.scan != nil {
			m.lastScan = msg.scan
			m.pinScanLogToLatest(msg.scan)
			logging.Event("scan", "poll id=%s status=%s verdict=%s surfaced=%d", msg.scan.ID, msg.scan.Status, msg.scan.Verdict, msg.scan.SurfacedFindings)
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
			logging.Error("scan cancel failed: %v", msg.err)
			m.setStatus(cleanError(msg.err), statusError)
			return m, nil
		}
		if m.currentScan != nil {
			m.currentScan.Status = "CANCELLED"
			m.currentScan.Message = "Проверка остановлена"
			m.lastScan = m.currentScan
			m.pinScanLogToLatest(m.lastScan)
			m.currentScan = nil
		}
		logging.Event("cancel", "active scan cancelled")
		m.setStatus("Проверка остановлена", statusWarning)
		return m, nil
	case tea.MouseMsg:
		return m.handleMouse(msg)
	case tea.KeyMsg:
		return m.handleKey(msg)
	}

	return m, nil
}

func (m Model) handleKey(msg tea.KeyMsg) (tea.Model, tea.Cmd) {
	switch m.screen {
	case screenAuth:
		return m.handleAuthKeys(msg)
	case screenScan:
		return m.handleScanKeys(msg)
	}

	switch msg.String() {
	case "ctrl+c":
		logging.Event("startup", "main tui interrupted by ctrl+c")
		return m, tea.Quit
	case "left", "h":
		m.prevScreen()
		return m, nil
	case "right", "l":
		m.nextScreen()
		return m, nil
	case "1":
		m.screen = screenHome
		return m, nil
	case "2":
		m.screen = screenHistory
		return m, nil
	case "3":
		m.screen = screenSettings
		return m, nil
	case "esc":
		m.screen = screenHome
		return m, nil
	}

	switch m.screen {
	case screenHome:
		return m.handleHomeKeys(msg)
	case screenHistory:
		return m.handleHistoryKeys(msg)
	case screenSettings:
		return m.handleSettingsKeys(msg)
	}

	return m, nil
}

func (m Model) handleHomeKeys(msg tea.KeyMsg) (tea.Model, tea.Cmd) {
	switch msg.String() {
	case "enter":
		if m.currentScan != nil && !isTerminalScanStatus(m.currentScan.Status) {
			m.screen = screenScan
			return m, nil
		}
		if m.scanBusy {
			return m, nil
		}
		if m.session == nil {
			m.restartAuth = true
			logging.Event("logout", "session missing on home; returning to auth flow")
			return m, tea.Quit
		}
		m.screen = screenScan
		m.scanBusy = true
		m.scanLogOffset = 0
		logging.Event("scan", "start requested token_present=%t", strings.TrimSpace(m.sessionToken()) != "")
		m.setStatus("Отправляем профиль хоста на сервер", statusInfo)
		return m, startHostScanCmd(m.client, m.sessionToken())
	}

	return m, nil
}

func (m Model) handleMouse(msg tea.MouseMsg) (tea.Model, tea.Cmd) {
	switch msg.Type {
	case tea.MouseWheelUp:
		if m.screen == screenScan {
			m.scrollScanLog(-1)
		}
		if m.screen == screenHistory {
			m.scrollHistory(-1)
		}
	case tea.MouseWheelDown:
		if m.screen == screenScan {
			m.scrollScanLog(1)
		}
		if m.screen == screenHistory {
			m.scrollHistory(1)
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
	switch msg.String() {
	case "esc":
		m.screen = screenHome
		return m, nil
	case "up", "k":
		m.scrollScanLog(-1)
		return m, nil
	case "down", "j":
		m.scrollScanLog(1)
		return m, nil
	case "pgup":
		m.scrollScanLog(-m.scanLogViewportHeight())
		return m, nil
	case "pgdown", "tab":
		m.scrollScanLog(m.scanLogViewportHeight())
		return m, nil
	case "home":
		m.scanLogOffset = 0
		return m, nil
	case "end":
		entries := m.scanLogEntries(m.scanForDisplay())
		maxOffset := len(entries) - m.scanLogViewportHeight()
		if maxOffset < 0 {
			maxOffset = 0
		}
		m.scanLogOffset = maxOffset
		return m, nil
	}

	if m.scanBusy {
		return m, nil
	}

	if msg.String() == "enter" {
		if m.currentScan != nil && !isTerminalScanStatus(m.currentScan.Status) {
			m.scanBusy = true
			logging.Event("cancel", "cancel requested id=%s", m.currentScan.ID)
			m.setStatus("Останавливаем проверку", statusWarning)
			return m, cancelScanCmd(m.client, m.sessionToken())
		}
		if m.session == nil {
			m.screen = screenAuth
			m.syncAuthFocus()
			m.setStatus("Сначала войди в аккаунт", statusWarning)
			return m, nil
		}
		m.scanBusy = true
		m.scanLogOffset = 0
		logging.Event("scan", "start requested token_present=%t", strings.TrimSpace(m.sessionToken()) != "")
		m.setStatus("Отправляем профиль хоста на сервер", statusInfo)
		return m, startHostScanCmd(m.client, m.sessionToken())
	}
	return m, nil
}

func (m Model) handleHistoryKeys(msg tea.KeyMsg) (tea.Model, tea.Cmd) {
	switch msg.String() {
	case "up", "k":
		m.scrollHistory(-1)
	case "down", "j":
		m.scrollHistory(1)
	case "pgup":
		m.scrollHistory(-m.historyViewportHeight())
	case "pgdown", "tab":
		m.scrollHistory(m.historyViewportHeight())
	case "home":
		m.historyOffset = 0
	case "end":
		entries := m.historyEntries()
		maxOffset := len(entries) - m.historyViewportHeight()
		if maxOffset < 0 {
			maxOffset = 0
		}
		m.historyOffset = maxOffset
	}
	return m, nil
}

func (m Model) handleSettingsKeys(msg tea.KeyMsg) (tea.Model, tea.Cmd) {
	switch msg.String() {
	case "enter":
		var clearedEmail string
		if m.session != nil {
			clearedEmail = m.session.Email
		}
		if err := m.store.Clear(); err != nil {
			logging.Error("logout store clear failed: %v", err)
		}
		logging.Event("logout", "session cleared email=%s", clearedEmail)
		m.restartAuth = true
		return m, tea.Quit
	case "esc":
		m.screen = screenHome
		return m, nil
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
		logging.Event("auth", "requesting login challenge in main app for %s", strings.ToLower(strings.TrimSpace(email)))
		m.setStatus("Отправляем запрос на вход", statusInfo)
		return m, m.startLoginCmd()
	}

	code := strings.TrimSpace(m.codeInput.Value())
	if code == "" {
		m.setStatus("Введи код из письма", statusWarning)
		return m, nil
	}
	m.authBusy = true
	logging.Event("auth", "verifying login code in main app for %s", strings.ToLower(strings.TrimSpace(m.emailInput.Value())))
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

	horizontalPadding := shellHorizontalPadding(m.width)
	contentWidth := shellContentWidth(m.width)
	sections := []string{m.renderHeader(contentWidth)}
	if m.screen != screenAuth && m.screen != screenScan {
		sections = append(sections, m.renderTabs(contentWidth))
	}
	sections = append(sections, m.renderBody(contentWidth))
	if footer := m.renderFooter(contentWidth); footer != "" {
		sections = append(sections, footer)
	}

	return lipgloss.NewStyle().Padding(1, horizontalPadding).Render(strings.Join(sections, "\n\n"))
}

func (m Model) renderHeader(width int) string {
	ambient := renderAmbient(width, m.frame, m.lowMotion)
	brand := lipgloss.NewStyle().Bold(true).Foreground(colorAccent()).Render("NeuralV")
	return strings.Join([]string{
		lipgloss.NewStyle().Width(width).Align(lipgloss.Center).Render(ambient),
		lipgloss.NewStyle().Width(width).Align(lipgloss.Center).Render(brand),
	}, "\n")
}

func (m Model) renderTabs(width int) string {
	active := m.activeNavScreen()
	items := make([]string, 0, 3)
	for _, item := range []struct {
		screen screen
		label  string
	}{
		{screen: screenHome, label: "1 Меню"},
		{screen: screenHistory, label: "2 История"},
		{screen: screenSettings, label: "3 Настройки"},
	} {
		style := lipgloss.NewStyle().Padding(0, 1).Foreground(colorMuted())
		if active == item.screen {
			style = style.Bold(true).Foreground(colorAccent())
		}
		items = append(items, style.Render(item.label))
	}
	separator := "  "
	if width < 42 {
		separator = "\n"
	}
	return lipgloss.NewStyle().Width(width).Render(strings.Join(items, separator))
}

func (m Model) renderBody(width int) string {
	switch m.screen {
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
		return m.renderHome(width)
	}
}

func (m Model) renderWelcome(width int) string {
	left := cardStyle(columnWidth(width)).Render(strings.Join([]string{
		sectionTitle("Быстрый старт"),
		"Лёгкий полноэкранный клиент для Linux: вход, запуск проверки и итог прямо в терминале.",
		"",
		"1. Установи nv",
		"2. Выполни nv install neuralv@latest",
		"3. Открой neuralv",
	}, "\n"))

	right := cardStyle(columnWidth(width)).Render(strings.Join([]string{
		sectionTitle("Управление"),
		"1-3 или Left / Right — экраны",
		"Tab / j / k — фокус и списки",
		"Enter — действие",
		"Ctrl+C — выход",
		"",
		sectionTitle("Режим анимации"),
		"На SSH и слабых машинах мягкий режим включается сам.",
	}, "\n"))

	return joinColumns(width, left, right)
}

func (m Model) renderAuth(width int) string {
	buttonLabel := "Отправить код"
	if m.authStage == authCode {
		buttonLabel = "Войти"
	}

	fields := []string{
		labeledField("Email", m.emailInput.View(), m.authFocus == 0 && m.authStage == authCredentials),
		labeledField("Пароль", m.passwordInput.View(), m.authFocus == 1 && m.authStage == authCredentials),
	}
	if m.authStage == authCode {
		fields = []string{labeledField("Код из письма", m.codeInput.View(), m.authFocus == 0)}
	}

	leftLines := []string{
		sectionTitle("Вход"),
		strings.Join(fields, "\n\n"),
		"",
		renderActionButton(buttonLabel, m.authFocus == m.authFieldCount(), !m.authBusy),
	}
	if status := maybeRenderStatus(m.status, m.statusTone); status != "" {
		leftLines = append(leftLines, "", status)
	}
	left := cardStyle(columnWidth(width)).Render(strings.Join(leftLines, "\n"))

	rightLines := []string{sectionTitle("Подсказка")}
	if m.authStage == authCredentials {
		rightLines = append(rightLines,
			"После email и пароля на почту придёт код подтверждения.",
			"",
			"После входа откроется экран проверок с прогрессом и живым логом.",
		)
	} else {
		rightLines = append(rightLines,
			"Код живёт недолго, поэтому шаг подтверждения вынесен отдельно.",
			"",
			"Esc возвращает к первому шагу, если код нужно запросить заново.",
		)
	}

	right := cardStyle(columnWidth(width)).Render(strings.Join(rightLines, "\n"))
	return joinColumns(width, left, right)
}

func (m Model) renderHome(width int) string {
	leftLines := []string{
		sectionTitle("Меню"),
		"",
		renderActionButton(m.homeActionLabel(), true, !m.scanBusy),
	}
	if hint := strings.TrimSpace(m.homeActionHint()); hint != "" {
		leftLines = append(leftLines, "", lipgloss.NewStyle().Foreground(colorMuted()).Render(hint))
	}

	rightLines := []string{
		sectionTitle("Разделы"),
		"",
		"2 История",
		"3 Настройки",
	}
	if m.session != nil {
		rightLines = append(rightLines, "", lipgloss.NewStyle().Foreground(colorMuted()).Render(shortText(m.session.Email, 36)))
	}
	if m.lastScan != nil {
		rightLines = append(
			rightLines,
			"",
			lipgloss.NewStyle().Foreground(colorMuted()).Render("Последний результат"),
			shortText(defaultScanMessage(m.lastScan), 48),
		)
	}

	left := cardStyle(columnWidth(width)).Render(strings.Join(leftLines, "\n"))
	right := cardStyle(columnWidth(width)).Render(strings.Join(rightLines, "\n"))
	return joinColumns(width, left, right)
}

func (m Model) renderScan(width int) string {
	scan := m.scanForDisplay()
	stacked := shouldStackColumns(width)
	panelHeight := m.scanPanelHeight()
	leftWidth, rightWidth := m.scanPanelWidths(width)

	progressLines := []string{
		sectionTitle("Проверка"),
		"",
		renderStatusPill(m.scanWindowStatus(scan), m.scanWindowTone(scan)),
		"",
		lipgloss.NewStyle().Bold(true).Foreground(colorAccent()).Render(
			renderScanPulse(m.frame, m.lowMotion, m.scanActive(scan)) + "  " + m.scanStageName(scan),
		),
		"",
		lipgloss.NewStyle().Bold(true).Foreground(lipgloss.Color("255")).Render(fmt.Sprintf("%d%%", m.scanPercent(scan))),
		renderProgressBar(leftWidth-8, m.scanPercent(scan)),
		lipgloss.NewStyle().Foreground(colorMuted()).Render(
			fmt.Sprintf("Проверено: %d из %d", m.scanChecked(scan), m.scanTotal(scan)),
		),
	}

	if scan != nil {
		progressLines = append(progressLines,
			"",
			fmt.Sprintf("Вердикт: %s", normalizeVerdict(scan.Verdict)),
			fmt.Sprintf("Риск: %d/100", scan.RiskScore),
		)
	} else if m.session == nil {
		progressLines = append(progressLines,
			"",
			lipgloss.NewStyle().Foreground(colorMuted()).Render("Войди в аккаунт, чтобы запустить новую проверку."),
		)
	}

	progressLines = append(progressLines,
		"",
		renderActionButton(m.scanActionLabel(), true, !m.scanBusy),
		lipgloss.NewStyle().Foreground(colorMuted()).Render("Enter запускает или останавливает проверку."),
	)

	logLines := []string{sectionTitle("Живой лог")}
	entries := m.scanLogEntries(scan)
	start, end := m.scanLogBounds(entries)
	logSummary := "Строки 0-0 из 0  •  Up/Down и колесо мыши прокручивают лог"
	if len(entries) > 0 {
		logSummary = fmt.Sprintf("Строки %d-%d из %d  •  Up/Down и колесо мыши прокручивают лог", start+1, end, len(entries))
	}
	logLines = append(logLines, "")
	for _, entry := range entries[start:end] {
		logLines = append(logLines, renderLogEntry(entry, rightWidth-8))
	}
	if len(entries) == 0 {
		logLines = append(logLines, lipgloss.NewStyle().Foreground(colorMuted()).Render("Журнал появится после первого события."))
	}
	logLines = append(logLines,
		"",
		lipgloss.NewStyle().Foreground(colorMuted()).Render(logSummary),
	)

	leftCard := cardStyle(leftWidth)
	rightCard := cardStyle(rightWidth)
	if !stacked {
		leftCard = leftCard.Height(panelHeight)
		rightCard = rightCard.Height(panelHeight)
	}
	left := leftCard.Render(strings.Join(progressLines, "\n"))
	right := rightCard.Render(strings.Join(logLines, "\n"))
	if stacked {
		return strings.Join([]string{left, right}, "\n\n")
	}
	return lipgloss.JoinHorizontal(lipgloss.Top, left, "  ", right)
}

func (m Model) renderHistory(width int) string {
	entries := m.historyEntries()
	start, end := m.historyBounds(entries)
	lines := entries[start:end]
	if len(lines) == 0 {
		lines = []string{
			sectionTitle("История"),
			"Пока пусто. После первой проверки здесь останется её итог.",
		}
	}
	if len(entries) > m.historyViewportHeight() {
		summary := fmt.Sprintf("Строки %d-%d из %d  •  Up/Down и PgUp/PgDown прокручивают историю", start+1, end, len(entries))
		lines = append(lines, "", lipgloss.NewStyle().Foreground(colorMuted()).Render(summary))
	}
	return cardStyle(width).Render(strings.Join(lines, "\n"))
}

func (m Model) renderSettings(width int) string {
	lines := []string{
		sectionTitle("Настройки"),
		"Здесь пока только выход.",
		"",
		renderActionButton("Выйти", true, true),
		lipgloss.NewStyle().Foreground(colorMuted()).Render("Enter возвращает к экрану входа."),
	}
	return cardStyle(width).Render(strings.Join(lines, "\n"))
}

func (m Model) renderFooter(width int) string {
	hints := []string{"Enter проверка", "2 история", "3 настройки", "Ctrl+C выход"}
	switch m.screen {
	case screenAuth:
		hints = nil
	case screenHome:
		hints = []string{"Enter проверка", "2 история", "3 настройки", "Ctrl+C выход"}
	case screenScan:
		hints = []string{"Enter старт/стоп", "Esc меню", "Up / Down лог", "Колесо мыши лог", "Ctrl+C выход"}
	case screenHistory:
		hints = []string{"Esc меню", "Up / Down история", "PgUp / PgDown", "Ctrl+C выход"}
	case screenSettings:
		hints = []string{"Enter выйти", "Esc меню", "Ctrl+C выход"}
	}
	if len(hints) == 0 {
		return ""
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

func (m *Model) resetToAuthScreen() {
	m.session = nil
	m.challenge = nil
	m.authBusy = false
	m.scanBusy = false
	m.currentScan = nil
	m.lastScan = nil
	m.scanLogOffset = 0
	m.authStage = authCredentials
	m.authFocus = 0
	m.screen = screenAuth
	m.emailInput.SetValue("")
	m.passwordInput.SetValue("")
	m.codeInput.SetValue("")
	m.syncAuthFocus()
}

func (m *Model) prevScreen() {
	switch m.activeNavScreen() {
	case screenHistory:
		m.screen = screenHome
	case screenSettings:
		m.screen = screenHistory
	default:
		m.screen = screenSettings
	}
}

func (m *Model) nextScreen() {
	switch m.activeNavScreen() {
	case screenHistory:
		m.screen = screenSettings
	case screenSettings:
		m.screen = screenHome
	default:
		m.screen = screenHistory
	}
}

func (m Model) activeNavScreen() screen {
	switch m.screen {
	case screenHome, screenHistory, screenSettings:
		return m.screen
	default:
		return screenHome
	}
}

func (m Model) homeActionLabel() string {
	if m.currentScan != nil && !isTerminalScanStatus(m.currentScan.Status) {
		return "Открыть проверку"
	}
	return "Запустить проверку"
}

func (m Model) homeActionHint() string {
	if m.currentScan != nil && !isTerminalScanStatus(m.currentScan.Status) {
		return "Проверка уже идёт. Открой окно и смотри прогресс вживую."
	}
	if m.lastScan != nil {
		return "История хранит прошлый отчёт. Новый запуск откроет отдельное окно проверки."
	}
	return "После запуска откроется отдельное окно с прогрессом и живым логом."
}

func (m Model) scanForDisplay() *api.DesktopScan {
	if m.currentScan != nil {
		return m.currentScan
	}
	return m.lastScan
}

func (m *Model) scrollScanLog(delta int) {
	entries := m.scanLogEntries(m.scanForDisplay())
	maxOffset := len(entries) - m.scanLogViewportHeight()
	if maxOffset < 0 {
		maxOffset = 0
	}
	m.scanLogOffset = clamp(m.scanLogOffset+delta, 0, maxOffset)
}

func (m *Model) pinScanLogToLatest(scan *api.DesktopScan) {
	entries := m.scanLogEntries(scan)
	maxOffset := len(entries) - m.scanLogViewportHeight()
	if maxOffset < 0 {
		maxOffset = 0
	}
	m.scanLogOffset = maxOffset
}

func (m *Model) scrollHistory(delta int) {
	entries := m.historyEntries()
	maxOffset := len(entries) - m.historyViewportHeight()
	if maxOffset < 0 {
		maxOffset = 0
	}
	m.historyOffset = clamp(m.historyOffset+delta, 0, maxOffset)
}

func (m *Model) clampScrollOffsets() {
	logEntries := m.scanLogEntries(m.scanForDisplay())
	maxScanOffset := len(logEntries) - m.scanLogViewportHeight()
	if maxScanOffset < 0 {
		maxScanOffset = 0
	}
	m.scanLogOffset = clamp(m.scanLogOffset, 0, maxScanOffset)

	historyEntries := m.historyEntries()
	maxHistoryOffset := len(historyEntries) - m.historyViewportHeight()
	if maxHistoryOffset < 0 {
		maxHistoryOffset = 0
	}
	m.historyOffset = clamp(m.historyOffset, 0, maxHistoryOffset)
}

func (m Model) scanPanelHeight() int {
	if m.height == 0 {
		return 18
	}
	return clamp(m.height-12, 8, 24)
}

func (m Model) scanPanelWidths(width int) (int, int) {
	if shouldStackColumns(width) {
		return width, width
	}
	left := clamp(width/3, 32, 40)
	return left, width - left - 2
}

func (m Model) scanLogViewportHeight() int {
	height := m.scanPanelHeight() - 7
	if height < 3 {
		return 3
	}
	return height
}

func (m Model) scanLogBounds(entries []string) (int, int) {
	if len(entries) == 0 {
		return 0, 0
	}
	maxOffset := len(entries) - m.scanLogViewportHeight()
	if maxOffset < 0 {
		maxOffset = 0
	}
	offset := clamp(m.scanLogOffset, 0, maxOffset)
	end := offset + m.scanLogViewportHeight()
	if end > len(entries) {
		end = len(entries)
	}
	return offset, end
}

func (m Model) scanActive(scan *api.DesktopScan) bool {
	return scan != nil && !isTerminalScanStatus(scan.Status)
}

func (m Model) scanActionLabel() string {
	if m.currentScan != nil && !isTerminalScanStatus(m.currentScan.Status) {
		return "Остановить проверку"
	}
	if m.session == nil {
		return "Войти и запустить"
	}
	return "Запустить проверку"
}

func (m Model) scanWindowStatus(scan *api.DesktopScan) string {
	if scan == nil {
		if strings.TrimSpace(m.status) != "" {
			return m.status
		}
		return "Проверка не запущена"
	}
	return normalizeScanStatus(scan.Status)
}

func (m Model) scanWindowTone(scan *api.DesktopScan) statusTone {
	if scan == nil {
		return m.statusTone
	}
	switch strings.ToUpper(strings.TrimSpace(scan.Status)) {
	case "FAILED":
		return statusError
	case "CANCELLED":
		return statusWarning
	case "COMPLETED":
		return toneForVerdict(scan.Verdict)
	default:
		return statusInfo
	}
}

func (m Model) scanStageName(scan *api.DesktopScan) string {
	if scan == nil {
		if m.session == nil {
			return "Нужен вход"
		}
		if m.scanBusy {
			return "Подготовка запроса"
		}
		return "Готово к запуску"
	}
	if msg := strings.TrimSpace(scan.Message); msg != "" {
		return shortText(msg, 42)
	}
	if len(scan.Timeline) > 0 {
		return shortText(scan.Timeline[len(scan.Timeline)-1], 42)
	}
	switch strings.ToUpper(strings.TrimSpace(scan.Status)) {
	case "COMPLETED":
		return "Результат готов"
	case "FAILED":
		return "Проверка завершилась ошибкой"
	case "CANCELLED":
		return "Проверка остановлена"
	case "QUEUED":
		return "Ожидает запуск"
	default:
		return "Проверка хоста"
	}
}

func (m Model) scanPercent(scan *api.DesktopScan) int {
	if scan == nil {
		if m.scanBusy {
			return 8
		}
		return 0
	}
	switch strings.ToUpper(strings.TrimSpace(scan.Status)) {
	case "COMPLETED", "FAILED", "CANCELLED":
		return 100
	case "QUEUED":
		return 8
	}
	checked := m.scanChecked(scan)
	total := m.scanTotal(scan)
	if total == 0 {
		return 0
	}
	percent := checked * 100 / total
	if percent < 14 {
		percent = 14
	}
	if percent > 92 {
		percent = 92
	}
	return percent
}

func (m Model) scanChecked(scan *api.DesktopScan) int {
	if scan == nil {
		return 0
	}
	if isTerminalScanStatus(scan.Status) {
		return m.scanTotal(scan)
	}
	count := len(scan.Timeline)
	if count == 0 {
		if strings.EqualFold(strings.TrimSpace(scan.Status), "QUEUED") {
			return 0
		}
		return 1
	}
	return count
}

func (m Model) scanTotal(scan *api.DesktopScan) int {
	if scan == nil {
		return 4
	}
	total := len(scan.Timeline) + 1
	if isTerminalScanStatus(scan.Status) {
		total = len(scan.Timeline)
		if total < 1 {
			total = 1
		}
		return total
	}
	if total < 4 {
		total = 4
	}
	return total
}

func (m Model) scanLogEntries(scan *api.DesktopScan) []string {
	if scan == nil {
		lines := []string{}
		if strings.TrimSpace(m.status) != "" {
			lines = append(lines, m.status)
		}
		if m.session == nil {
			lines = append(lines, "Вход нужен только для запуска новой проверки.")
		} else {
			lines = append(lines, "Enter отправит профиль этого хоста на проверку.")
		}
		return lines
	}

	lines := []string{
		fmt.Sprintf("Статус: %s", normalizeScanStatus(scan.Status)),
		fmt.Sprintf("Этап: %s", m.scanStageName(scan)),
	}
	if msg := strings.TrimSpace(scan.Message); msg != "" && shortText(msg, 42) != m.scanStageName(scan) {
		lines = append(lines, msg)
	}
	for _, stage := range scan.Timeline {
		lines = append(lines, strings.TrimSpace(stage))
	}
	if isTerminalScanStatus(scan.Status) {
		lines = append(lines,
			fmt.Sprintf("Вердикт: %s", normalizeVerdict(scan.Verdict)),
			fmt.Sprintf("Риск: %d/100", scan.RiskScore),
			fmt.Sprintf("Найдено: %d", scan.SurfacedFindings),
		)
	}
	for _, finding := range scan.Findings {
		line := fmt.Sprintf("%s — %s", finding.Title, normalizeVerdict(finding.Verdict))
		if summary := strings.TrimSpace(finding.Summary); summary != "" {
			line += ": " + summary
		}
		lines = append(lines, line)
	}
	return lines
}

func (m Model) historyEntries() []string {
	lines := []string{sectionTitle("История")}
	if m.lastScan == nil {
		lines = append(lines, "Пока пусто. После первой проверки здесь останется её итог.")
		if status := maybeRenderStatus(m.status, m.statusTone); status != "" {
			lines = append(lines, "", status)
		}
		return lines
	}

	lines = append(lines,
		fmt.Sprintf("Проверка: %s", normalizeScanStatus(m.lastScan.Status)),
		fmt.Sprintf("Вердикт: %s", normalizeVerdict(m.lastScan.Verdict)),
		fmt.Sprintf("Риск: %d/100", m.lastScan.RiskScore),
		fmt.Sprintf("Найдено: %d", m.lastScan.SurfacedFindings),
	)
	if m.lastScan.Message != "" {
		lines = append(lines, "", shortText(m.lastScan.Message, maxHistoryTextWidth(m.width)))
	}
	if len(m.lastScan.Findings) > 0 {
		lines = append(lines, "", sectionTitle("Что нашли"))
		for _, finding := range m.lastScan.Findings {
			line := fmt.Sprintf("• %s — %s", finding.Title, normalizeVerdict(finding.Verdict))
			if summary := strings.TrimSpace(finding.Summary); summary != "" {
				line += ": " + shortText(summary, maxHistoryTextWidth(m.width)-20)
			}
			lines = append(lines, line)
		}
	}
	if len(m.lastScan.Timeline) > 0 {
		lines = append(lines, "", sectionTitle("Таймлайн"))
		for _, stage := range m.lastScan.Timeline {
			lines = append(lines, "• "+shortText(stage, maxHistoryTextWidth(m.width)))
		}
	}
	if status := maybeRenderStatus(m.status, m.statusTone); status != "" {
		lines = append(lines, "", status)
	}
	return lines
}

func (m Model) historyViewportHeight() int {
	if m.height == 0 {
		return 14
	}
	return clamp(m.height-10, 6, 22)
}

func (m Model) historyBounds(entries []string) (int, int) {
	if len(entries) == 0 {
		return 0, 0
	}
	maxOffset := len(entries) - m.historyViewportHeight()
	if maxOffset < 0 {
		maxOffset = 0
	}
	offset := clamp(m.historyOffset, 0, maxOffset)
	end := offset + m.historyViewportHeight()
	if end > len(entries) {
		end = len(entries)
	}
	return offset, end
}

func (m Model) sessionToken() string {
	if m.session == nil {
		return ""
	}
	return strings.TrimSpace(m.session.Token)
}

func (m Model) ShouldRestartAuth() bool {
	return m.restartAuth
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
		logging.Event(
			"scan",
			"start payload package_manager=%s roots=%d installs=%d candidates=%d packages=%d",
			stringValue(artifact["package_manager"]),
			len(asStringSlice(artifact["scan_roots"])),
			len(asStringSlice(artifact["install_roots"])),
			len(asStringSlice(artifact["candidate_paths"])),
			len(asStringSlice(artifact["package_inventory"])),
		)
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

func pollScanCmd(client *api.Client, token string, id string) tea.Cmd {
	return tea.Tick(2500*time.Millisecond, func(time.Time) tea.Msg {
		logging.Event("scan", "poll requested id=%s", id)
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
		logging.Event("cancel", "cancel active requested")
		_, err := client.CancelDesktopScan(token)
		return scanCancelledMsg{err: err}
	}
}

func buildLinuxHostArtifact() map[string]any {
	host, _ := os.Hostname()
	if host == "" {
		host = "linux-host"
	}

	packageManager := DetectPackageManager()
	desktop := DetectDesktopSession()
	installRoots := detectLinuxInstallRoots()
	scanRoots := detectLinuxScanRoots(installRoots)
	packageInventory := detectLinuxPackageInventory(packageManager, 72)
	candidatePaths := detectLinuxCandidatePaths(scanRoots, 72)
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
		"install_roots":     installRoots,
		"scan_roots":        scanRoots,
		"candidate_paths":   candidatePaths,
		"candidate_count":   len(candidatePaths),
		"package_inventory": packageInventory,
		"package_count":     len(packageInventory),
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

func detectLinuxInstallRoots() []string {
	home := strings.TrimSpace(os.Getenv("HOME"))
	candidates := []string{
		"/usr/bin",
		"/usr/local/bin",
		"/bin",
		"/opt",
		"/usr/share/applications",
		"/var/lib/flatpak/exports/bin",
		"/snap/bin",
	}
	if home != "" {
		candidates = append(candidates,
			filepath.Join(home, ".local", "bin"),
			filepath.Join(home, ".local", "share", "applications"),
		)
	}
	return filterExistingPaths(candidates)
}

func detectLinuxScanRoots(installRoots []string) []string {
	home := strings.TrimSpace(os.Getenv("HOME"))
	candidates := append([]string{}, installRoots...)
	candidates = append(candidates,
		"/usr/sbin",
		"/usr/local/sbin",
		"/sbin",
		"/etc/systemd/system",
		"/usr/lib/systemd/system",
		"/etc/xdg/autostart",
	)
	if home != "" {
		candidates = append(candidates,
			filepath.Join(home, ".config", "autostart"),
			filepath.Join(home, ".config", "systemd", "user"),
		)
	}
	return filterExistingPaths(candidates)
}

func filterExistingPaths(paths []string) []string {
	seen := make(map[string]struct{}, len(paths))
	filtered := make([]string, 0, len(paths))
	for _, candidate := range paths {
		candidate = strings.TrimSpace(candidate)
		if candidate == "" {
			continue
		}
		if _, ok := seen[candidate]; ok {
			continue
		}
		info, err := os.Stat(candidate)
		if err != nil || !info.IsDir() {
			continue
		}
		seen[candidate] = struct{}{}
		filtered = append(filtered, candidate)
	}
	sort.Strings(filtered)
	return filtered
}

func detectLinuxPackageInventory(packageManager string, limit int) []string {
	type inventoryCommand struct {
		name string
		args []string
	}

	commands := []inventoryCommand{}
	switch packageManager {
	case "apt":
		commands = append(commands, inventoryCommand{name: "dpkg-query", args: []string{"-W", "-f=${Package}\n"}})
	case "dnf", "yum", "zypper":
		commands = append(commands, inventoryCommand{name: "rpm", args: []string{"-qa"}})
	case "pacman":
		commands = append(commands, inventoryCommand{name: "pacman", args: []string{"-Qq"}})
	case "apk":
		commands = append(commands, inventoryCommand{name: "apk", args: []string{"info"}})
	}
	commands = append(commands,
		inventoryCommand{name: "flatpak", args: []string{"list", "--columns=application"}},
		inventoryCommand{name: "snap", args: []string{"list"}},
	)

	seen := map[string]struct{}{}
	packages := make([]string, 0, limit)
	for _, command := range commands {
		if limit > 0 && len(packages) >= limit {
			break
		}
		if _, err := exec.LookPath(command.name); err != nil {
			continue
		}
		output, err := exec.Command(command.name, command.args...).Output()
		if err != nil {
			continue
		}
		lines := strings.Split(string(output), "\n")
		for _, raw := range lines {
			name := normalizePackageLine(command.name, raw)
			if name == "" {
				continue
			}
			if _, ok := seen[name]; ok {
				continue
			}
			seen[name] = struct{}{}
			packages = append(packages, name)
			if limit > 0 && len(packages) >= limit {
				break
			}
		}
	}
	sort.Strings(packages)
	return packages
}

func normalizePackageLine(commandName, raw string) string {
	line := strings.TrimSpace(raw)
	if line == "" {
		return ""
	}
	if commandName == "snap" {
		fields := strings.Fields(line)
		if len(fields) == 0 || strings.EqualFold(fields[0], "Name") {
			return ""
		}
		return fields[0]
	}
	return line
}

func detectLinuxCandidatePaths(roots []string, limit int) []string {
	if limit <= 0 {
		return nil
	}
	candidates := make([]string, 0, limit)
	seen := make(map[string]struct{}, limit)
	for _, root := range roots {
		entries, err := os.ReadDir(root)
		if err != nil {
			continue
		}
		for _, entry := range entries {
			if len(candidates) >= limit {
				sort.Strings(candidates)
				return candidates
			}
			fullPath := filepath.Join(root, entry.Name())
			if _, ok := seen[fullPath]; ok {
				continue
			}
			if includeLinuxCandidate(root, entry) {
				seen[fullPath] = struct{}{}
				candidates = append(candidates, fullPath)
			}
		}
	}
	sort.Strings(candidates)
	return candidates
}

func includeLinuxCandidate(root string, entry os.DirEntry) bool {
	name := entry.Name()
	if strings.HasPrefix(name, ".") {
		return false
	}
	if entry.Type().IsRegular() {
		if strings.HasSuffix(name, ".desktop") || strings.HasSuffix(name, ".service") || strings.HasSuffix(name, ".AppImage") {
			return true
		}
		info, err := entry.Info()
		if err != nil {
			return false
		}
		return info.Mode()&0o111 != 0
	}
	if !entry.IsDir() {
		return false
	}
	base := filepath.Base(root)
	return base == "opt" || strings.HasSuffix(root, "/applications")
}

func DetectPackageManager() string {
	for _, candidate := range []string{"apt", "dnf", "yum", "pacman", "zypper", "xbps-install", "apk"} {
		if _, err := exec.LookPath(candidate); err == nil {
			return candidate
		}
	}
	return "не найден"
}

func DetectDesktopSession() string {
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
		"···  •••  ···  •••  ···  •••  ···",
		"··  •••  ···  •••  ···  •••  ··· ",
		"·  •••  ···  •••  ···  •••  ···  •",
		"  •••  ···  •••  ···  •••  ···  ••",
	}
	if !lowMotion {
		frames = []string{
			"·  ○  ·  •  ·  ○  ·  •  ·  ○  ·  •",
			"○  ·  •  ·  ○  ·  •  ·  ○  ·  •  ·",
			"·  •  ·  ○  ·  •  ·  ○  ·  •  ·  ○",
			"•  ·  ○  ·  •  ·  ○  ·  •  ·  ○  ·",
		}
	}
	line := frames[frame%len(frames)]
	if width <= 0 {
		return ""
	}
	innerWidth := width
	if width > 4 {
		innerWidth = width - 4
	}
	return lipgloss.NewStyle().Foreground(colorAccentSoft()).Width(innerWidth).Render(repeatToWidth(line, innerWidth))
}

func renderActivityLine(frame int, lowMotion, active bool) string {
	if !active {
		return lipgloss.NewStyle().Foreground(colorMuted()).Render("Проверка сейчас не запущена.")
	}
	frames := []string{"●", "●", "●"}
	if !lowMotion {
		frames = []string{"◜", "◠", "◝", "◞", "◡", "◟"}
	}
	return lipgloss.NewStyle().Foreground(colorAccent()).Bold(true).Render(frames[frame%len(frames)] + "  сервер проверяет хост")
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

func maybeRenderStatus(text string, tone statusTone) string {
	value := strings.TrimSpace(text)
	switch value {
	case "", "Готово", "Готово к проверке":
		return ""
	}
	return renderStatusPill(value, tone)
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

func renderScanPulse(frame int, lowMotion, active bool) string {
	if !active {
		return lipgloss.NewStyle().Foreground(colorMuted()).Render("•")
	}
	frames := []string{"●", "○"}
	if !lowMotion {
		frames = []string{"◜", "◠", "◝", "◞", "◡", "◟"}
	}
	return lipgloss.NewStyle().Foreground(colorAccent()).Bold(true).Render(frames[frame%len(frames)])
}

func renderProgressBar(width, percent int) string {
	segments := clamp(width, 6, 40)
	filled := percent * segments / 100
	if filled < 0 {
		filled = 0
	}
	if filled > segments {
		filled = segments
	}
	return lipgloss.JoinHorizontal(
		lipgloss.Top,
		lipgloss.NewStyle().Foreground(colorAccentStrong()).Render(strings.Repeat("█", filled)),
		lipgloss.NewStyle().Foreground(colorSurfaceStrong()).Render(strings.Repeat("░", segments-filled)),
	)
}

func renderLogEntry(text string, width int) string {
	content := shortText(strings.TrimSpace(text), clamp(width, 8, 120))
	return lipgloss.NewStyle().Foreground(colorMuted()).Render("• " + content)
}

func renderChoice(active bool, title, text string) string {
	bullet := "  "
	if active {
		bullet = lipgloss.NewStyle().Foreground(colorAccent()).Bold(true).Render("▸ ")
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
	if shouldStackColumns(width) {
		return strings.Join([]string{left, right}, "\n\n")
	}
	return lipgloss.JoinHorizontal(lipgloss.Top, left, "  ", right)
}

func cardStyle(width int) lipgloss.Style {
	return lipgloss.NewStyle().Border(lipgloss.RoundedBorder()).BorderForeground(colorBorder()).Padding(1, 2).Width(width)
}

func columnWidth(total int) int {
	if shouldStackColumns(total) {
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
	input.Width = 32
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

func (m *Model) syncInputWidths() {
	width := 32
	if m.width > 0 {
		contentWidth := shellContentWidth(m.width)
		width = contentWidth - 8
		if !shouldStackColumns(contentWidth) {
			width = columnWidth(contentWidth) - 8
		}
		if width < 8 {
			width = contentWidth - 4
		}
	}
	width = clamp(width, 6, 56)
	m.emailInput.Width = width
	m.passwordInput.Width = width
	m.codeInput.Width = width
}

func shellHorizontalPadding(total int) int {
	switch {
	case total < 52:
		return 0
	case total < 80:
		return 1
	default:
		return 2
	}
}

func shellContentWidth(total int) int {
	if total <= 0 {
		return 72
	}
	width := total - shellHorizontalPadding(total)*2
	if width > 112 {
		width = 112
	}
	if width < 12 {
		width = total
		if width < 10 {
			width = 10
		}
	}
	return width
}

func shouldStackColumns(width int) bool {
	return width < 104
}

func maxHistoryTextWidth(totalWidth int) int {
	if totalWidth <= 0 {
		return 88
	}
	content := shellContentWidth(totalWidth)
	if content < 32 {
		return 28
	}
	return content - 8
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

func stringValue(value any) string {
	if value == nil {
		return ""
	}
	return strings.TrimSpace(fmt.Sprint(value))
}

func asStringSlice(value any) []string {
	switch typed := value.(type) {
	case []string:
		return typed
	case []any:
		result := make([]string, 0, len(typed))
		for _, item := range typed {
			text := stringValue(item)
			if text != "" {
				result = append(result, text)
			}
		}
		return result
	default:
		return nil
	}
}

func shortText(text string, max int) string {
	value := strings.TrimSpace(text)
	runes := []rune(value)
	if max <= 0 || len(runes) <= max {
		return value
	}
	if max <= 3 {
		return string(runes[:max])
	}
	return string(runes[:max-3]) + "..."
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

func max(a, b int) int {
	if a > b {
		return a
	}
	return b
}

func (m Model) scanOptionCount() int {
	if m.currentScan != nil && !isTerminalScanStatus(m.currentScan.Status) {
		return 2
	}
	return 1
}
