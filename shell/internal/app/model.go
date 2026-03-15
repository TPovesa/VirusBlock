package app

import (
	"fmt"
	"runtime"
	"strings"

	tea "github.com/charmbracelet/bubbletea"
	"github.com/charmbracelet/lipgloss"
	"github.com/perdonus/neuralv-shell/internal/api"
	"github.com/perdonus/neuralv-shell/internal/session"
)

type screen int

const (
	screenWelcome screen = iota
	screenAuth
	screenHome
	screenScan
	screenHistory
	screenSettings
)

type Model struct {
	client    *api.Client
	store     *session.Store
	session   *session.Session
	screen    screen
	cursor    int
	challenge *api.ChallengeResponse
	email     string
	password  string
	code      string
	status    string
	lowMotion bool
	width     int
	height    int
}

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

func NewModel(client *api.Client, store *session.Store) Model {
	saved, _ := store.Load()
	return Model{
		client:    client,
		store:     store,
		session:   saved,
		lowMotion: true,
		screen: func() screen {
			if saved != nil {
				return screenHome
			}
			return screenWelcome
		}(),
		status: "Готово",
	}
}

func (m Model) Init() tea.Cmd {
	return func() tea.Msg {
		manifest, err := m.client.ReleaseManifest()
		return manifestLoadedMsg{manifest: manifest, err: err}
	}
}

func (m Model) Update(msg tea.Msg) (tea.Model, tea.Cmd) {
	switch msg := msg.(type) {
	case tea.WindowSizeMsg:
		m.width, m.height = msg.Width, msg.Height
	case tea.KeyMsg:
		switch msg.String() {
		case "ctrl+c", "q":
			return m, tea.Quit
		case "tab", "down", "j":
			m.cursor++
		case "shift+tab", "up", "k":
			if m.cursor > 0 {
				m.cursor--
			}
		case "1":
			m.screen = screenWelcome
		case "2":
			m.screen = screenAuth
		case "3":
			m.screen = screenHome
		case "4":
			m.screen = screenScan
		case "5":
			m.screen = screenHistory
		case "6":
			m.screen = screenSettings
		case "l":
			m.screen = screenAuth
		case "enter":
			if m.screen == screenAuth {
				if m.challenge == nil {
					return m, m.startLoginCmd()
				}
				return m, m.verifyLoginCmd()
			}
		}
	case authStartedMsg:
		if msg.err != nil {
			m.status = msg.err.Error()
			break
		}
		m.challenge = msg.challenge
		m.status = "Код отправлен на почту"
	case authVerifiedMsg:
		if msg.err != nil {
			m.status = msg.err.Error()
			break
		}
		m.session = msg.session
		m.challenge = nil
		m.screen = screenHome
		m.status = "Сессия сохранена"
	case manifestLoadedMsg:
		if msg.err != nil {
			m.status = "Manifest недоступен, используется fallback логика"
		} else if msg.manifest != nil {
			m.status = fmt.Sprintf("Manifest: %d artifact(s)", len(msg.manifest.Artifacts))
		}
	}
	return m, nil
}

func (m Model) View() string {
	base := lipgloss.NewStyle().Padding(1, 2)
	headline := lipgloss.NewStyle().Bold(true).Foreground(lipgloss.Color("86"))
	subtle := lipgloss.NewStyle().Foreground(lipgloss.Color("244"))
	card := lipgloss.NewStyle().Border(lipgloss.RoundedBorder()).BorderForeground(lipgloss.Color("63")).Padding(1, 2).Width(max(48, m.width-8))

	sections := []string{
		headline.Render("NeuralV shell"),
		subtle.Render("Полноэкранный Linux TUI. Low-motion режим включён по умолчанию."),
		"",
		menuView(m.screen),
		"",
	}

	switch m.screen {
	case screenWelcome:
		sections = append(sections, card.Render(strings.Join([]string{
			"Добро пожаловать в NeuralV shell.",
			"Платформа: " + runtime.GOOS,
			"Bootstrap: nv install neuralv@latest",
			"Навигация: 1-6, j/k, q.",
		}, "\n")))
	case screenAuth:
		prompt := "Введите email/password в коде файла или доработайте text input flow"
		if m.challenge != nil {
			prompt = "Код отправлен. Нажмите Enter ещё раз после ввода code в конфиг/переменные состояния."
		}
		sections = append(sections, card.Render(strings.Join([]string{
			"Unified auth через /basedata",
			"Email: " + blankFallback(m.email, "<unset>"),
			"Пароль: " + mask(blankFallback(m.password, "<unset>")),
			"Code: " + blankFallback(m.code, "<unset>"),
			prompt,
		}, "\n")))
	case screenHome:
		sections = append(sections, card.Render(strings.Join([]string{
			"Сессия: " + blankFallback(func() string { if m.session != nil { return m.session.Email }; return "" }(), "не авторизован"),
			"Установка и удаление идут через nv.",
			"GUI, shell и daemon используют один backend.",
		}, "\n")))
	case screenScan:
		sections = append(sections, card.Render(strings.Join([]string{
			"Режимы: on-demand / selective / artifact / resident-event",
			"CLI-клиент ходит в /api/scans/desktop/*",
			"Тяжёлые анимации выключены по умолчанию.",
		}, "\n")))
	case screenHistory:
		sections = append(sections, card.Render("История desktop scan будет подгружаться из backend после расширения read API."))
	case screenSettings:
		sections = append(sections, card.Render(strings.Join([]string{
			"Low motion: on",
			"Base URL: https://sosiskibot.ru/basedata",
			"Session store: ~/.config/neuralv-shell/session.json",
		}, "\n")))
	}

	sections = append(sections, "", subtle.Render("Status: "+m.status))
	return base.Render(strings.Join(sections, "\n"))
}

func menuView(current screen) string {
	items := []string{"1 Welcome", "2 Auth", "3 Home", "4 Scan", "5 History", "6 Settings"}
	if int(current) >= 0 && int(current) < len(items) {
		items[current] = "> " + items[current]
	}
	return strings.Join(items, "   ")
}

func (m Model) startLoginCmd() tea.Cmd {
	return func() tea.Msg {
		challenge, err := m.client.StartLogin(m.email, m.password)
		return authStartedMsg{challenge: challenge, err: err}
	}
}

func (m Model) verifyLoginCmd() tea.Cmd {
	return func() tea.Msg {
		if m.challenge == nil {
			return authVerifiedMsg{err: fmt.Errorf("challenge not started")}
		}
		response, err := m.client.VerifyLogin(m.challenge.ChallengeID, m.email, m.code)
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

func blankFallback(value, fallback string) string {
	if strings.TrimSpace(value) == "" {
		return fallback
	}
	return value
}

func mask(value string) string {
	if value == "<unset>" {
		return value
	}
	return strings.Repeat("*", len(value))
}

func max(a, b int) int {
	if a > b {
		return a
	}
	return b
}
