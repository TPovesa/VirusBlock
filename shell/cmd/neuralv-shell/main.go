package main

import (
	"fmt"
	"log"
	"os"
	"strings"

	tea "github.com/charmbracelet/bubbletea"
	"github.com/perdonus/neuralv-shell/internal/api"
	"github.com/perdonus/neuralv-shell/internal/app"
	"github.com/perdonus/neuralv-shell/internal/session"
)

const (
	defaultBaseURL = "https://sosiskibot.ru/basedata"
)

var cliVersion = "dev"

func main() {
	cliArgs, opts, handled := handleCLI(os.Args[1:])
	if handled {
		return
	}

	store, err := session.NewStore()
	if err != nil {
		log.Fatal(err)
	}
	client := api.NewClient(resolveBaseURL())
	program := tea.NewProgram(app.NewModel(client, store, opts), tea.WithAltScreen())
	if _, err := program.Run(); err != nil {
		log.Fatal(err)
	}
	_ = cliArgs
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

Открыть Linux TUI:
  neuralv
  neuralv --low-motion
  neuralv --motion

Дополнительно:
  neuralv -v | --version
  neuralv help`)
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
