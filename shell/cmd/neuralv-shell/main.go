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
	cliVersion     = "0.1.0"
	defaultBaseURL = "https://sosiskibot.ru/basedata"
)

func main() {
	if handled := handleCLI(os.Args[1:]); handled {
		return
	}

	store, err := session.NewStore()
	if err != nil {
		log.Fatal(err)
	}
	client := api.NewClient(resolveBaseURL())
	program := tea.NewProgram(app.NewModel(client, store), tea.WithAltScreen())
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

func handleCLI(args []string) bool {
	if len(args) == 0 {
		return false
	}

	switch args[0] {
	case "-v", "--version", "version":
		fmt.Printf("neuralv %s\n", cliVersion)
		return true
	case "help", "-h", "--help":
		fmt.Println("neuralv\n\nCommands:\n  neuralv\n  neuralv -v | --version")
		return true
	default:
		return false
	}
}
