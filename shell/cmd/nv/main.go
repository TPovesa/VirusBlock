package main

import (
	"archive/tar"
	"compress/gzip"
	"errors"
	"fmt"
	"io"
	"net/http"
	"os"
	"path"
	"path/filepath"
	"regexp"
	"strings"
	"time"

	"github.com/perdonus/neuralv-shell/internal/api"
)

const (
	defaultBaseURL   = "https://sosiskibot.ru/basedata"
	defaultBinaryDir = ".local/bin"
)

var (
	nvVersion     = "dev"
	semverPattern = regexp.MustCompile(`^\d+\.\d+\.\d+$`)
)

func main() {
	client := api.NewClient(resolveBaseURL())
	if err := handle(os.Args[1:], client); err != nil {
		fmt.Fprintln(os.Stderr, "nv error:", err)
		os.Exit(1)
	}
}

func resolveBaseURL() string {
	baseURL := strings.TrimSpace(os.Getenv("NEURALV_BASE_URL"))
	if baseURL == "" {
		return defaultBaseURL
	}
	return baseURL
}

func handle(args []string, client *api.Client) error {
	if len(args) == 0 {
		printHelp()
		return nil
	}

	switch args[0] {
	case "-v", "--version", "version":
		fmt.Printf("nv %s\n", nvVersion)
		return nil
	case "help", "-h", "--help":
		printHelp()
		return nil
	case "install":
		if len(args) < 2 {
			return errors.New("не хватает package spec: используй nv install neuralv@latest")
		}
		return installPackage(client, args[1])
	case "uninstall":
		if len(args) < 2 {
			return errors.New("не хватает имени пакета: используй nv uninstall neuralv")
		}
		return uninstallPackage(args[1])
	default:
		printHelp()
		return fmt.Errorf("неизвестная команда: %s", args[0])
	}
}

func printHelp() {
	fmt.Println(`nv

Небольшой установщик для Linux-линейки NeuralV.

Команды:
  nv install neuralv@latest
  nv install neuralv@1.3.1
  nv uninstall neuralv
  nv -v | --version
  nv help

Что делает install:
  1. Читает live release info из /basedata
  2. Скачивает neuralv-shell и neuralvd
  3. Кладёт launchers в ~/.local/bin

После установки:
  neuralv        открыть TUI
  neuralv -v     показать версию CLI`)
}

func installPackage(client *api.Client, spec string) error {
	name, version, err := parsePackageSpec(spec)
	if err != nil {
		return err
	}
	if name != "neuralv" {
		return fmt.Errorf("неподдерживаемый пакет: %s", name)
	}

	step(1, 4, "читаем manifest релизов")
	manifest, err := client.ReleaseManifest()
	if err != nil {
		return fmt.Errorf("manifest недоступен: %w", err)
	}

	artifact := manifest.Artifact("shell", "linux_shell")
	if artifact == nil || strings.TrimSpace(artifact.DownloadURL) == "" {
		return errors.New("артефакт neuralv shell пока не опубликован")
	}
	if version != "latest" && artifact.Version != "" && artifact.Version != version {
		return fmt.Errorf("запрошен neuralv@%s, но сейчас опубликована версия %s", version, artifact.Version)
	}

	installRoot, err := defaultInstallRoot()
	if err != nil {
		return err
	}
	if err := os.MkdirAll(installRoot, 0o755); err != nil {
		return err
	}

	tmpDir, err := os.MkdirTemp("", "nv-install-*")
	if err != nil {
		return err
	}
	defer os.RemoveAll(tmpDir)

	shellTarget := filepath.Join(installRoot, "neuralv-shell")
	step(2, 4, "скачиваем neuralv-shell")
	if err := downloadArtifactBinary(artifact.DownloadURL, tmpDir, shellTarget, "neuralv-shell"); err != nil {
		return err
	}

	hasDaemon := false
	if daemonURL, ok := metadataString(artifact.Metadata, "daemonUrl"); ok && strings.TrimSpace(daemonURL) != "" {
		hasDaemon = true
		step(3, 4, "скачиваем neuralvd")
		daemonTarget := filepath.Join(installRoot, "neuralvd")
		if err := downloadArtifactBinary(daemonURL, tmpDir, daemonTarget, "neuralvd"); err != nil {
			return err
		}
	}
	if !hasDaemon {
		step(3, 4, "daemon ещё не опубликован, пропускаем")
	}

	step(4, 4, "создаём launchers")
	wrapper := filepath.Join(installRoot, "neuralv")
	wrapperBody := fmt.Sprintf("#!/usr/bin/env sh\nexec %q \"$@\"\n", shellTarget)
	if err := os.WriteFile(wrapper, []byte(wrapperBody), 0o755); err != nil {
		return err
	}

	shownVersion := artifact.Version
	if shownVersion == "" {
		shownVersion = version
	}
	printInstallSummary(shownVersion, installRoot, hasDaemon)
	return nil
}

func uninstallPackage(name string) error {
	if strings.TrimSpace(name) != "neuralv" {
		return fmt.Errorf("неподдерживаемый пакет: %s", name)
	}

	installRoot, err := defaultInstallRoot()
	if err != nil {
		return err
	}

	step(1, 2, "удаляем launchers")
	for _, target := range []string{"neuralv", "neuralv-shell", "neuralvd"} {
		path := filepath.Join(installRoot, target)
		if err := os.Remove(path); err != nil && !errors.Is(err, os.ErrNotExist) {
			return err
		}
	}

	step(2, 2, "готово")
	fmt.Printf("NeuralV удалён из %s\n", installRoot)
	return nil
}

func parsePackageSpec(spec string) (string, string, error) {
	raw := strings.TrimSpace(spec)
	if raw == "" {
		return "", "", errors.New("empty package spec")
	}
	parts := strings.SplitN(raw, "@", 2)
	name := strings.TrimSpace(parts[0])
	version := "latest"
	if len(parts) == 2 && strings.TrimSpace(parts[1]) != "" {
		version = strings.TrimSpace(parts[1])
	}
	if version != "latest" && !semverPattern.MatchString(version) {
		return "", "", fmt.Errorf("некорректная версия %q: используй latest или semver вроде 1.3.1", version)
	}
	return name, version, nil
}

func defaultInstallRoot() (string, error) {
	home, err := os.UserHomeDir()
	if err != nil {
		return "", err
	}
	return filepath.Join(home, defaultBinaryDir), nil
}

func metadataString(metadata map[string]any, key string) (string, bool) {
	if metadata == nil {
		return "", false
	}
	value, ok := metadata[key]
	if !ok {
		return "", false
	}
	text, ok := value.(string)
	return text, ok
}

func downloadArtifactBinary(url, tmpDir, target, expectedName string) error {
	request, err := http.NewRequest(http.MethodGet, url, nil)
	if err != nil {
		return err
	}

	client := &http.Client{Timeout: 5 * time.Minute}
	response, err := client.Do(request)
	if err != nil {
		return err
	}
	defer response.Body.Close()

	if response.StatusCode >= 400 {
		body, _ := io.ReadAll(response.Body)
		return fmt.Errorf("ошибка скачивания артефакта: http %d: %s", response.StatusCode, strings.TrimSpace(string(body)))
	}

	lowerURL := strings.ToLower(url)
	if strings.HasSuffix(lowerURL, ".tar.gz") || strings.HasSuffix(lowerURL, ".tgz") {
		return extractTarball(response.Body, tmpDir, target, expectedName)
	}

	file, err := os.OpenFile(target, os.O_CREATE|os.O_WRONLY|os.O_TRUNC, 0o755)
	if err != nil {
		return err
	}
	defer file.Close()

	_, err = io.Copy(file, response.Body)
	return err
}

func extractTarball(reader io.Reader, tmpDir, target, expectedName string) error {
	gzipReader, err := gzip.NewReader(reader)
	if err != nil {
		return err
	}
	defer gzipReader.Close()

	tarReader := tar.NewReader(gzipReader)
	for {
		header, err := tarReader.Next()
		if errors.Is(err, io.EOF) {
			break
		}
		if err != nil {
			return err
		}
		if header.Typeflag != tar.TypeReg {
			continue
		}
		name := path.Base(header.Name)
		if name != expectedName {
			continue
		}
		file, err := os.OpenFile(target, os.O_CREATE|os.O_WRONLY|os.O_TRUNC, 0o755)
		if err != nil {
			return err
		}
		if _, err := io.Copy(file, tarReader); err != nil {
			file.Close()
			return err
		}
		if err := file.Close(); err != nil {
			return err
		}
		return nil
	}
	return fmt.Errorf("%s не найден внутри скачанного архива", expectedName)
}

func step(index, total int, text string) {
	fmt.Printf("[%d/%d] %s\n", index, total, text)
}

func printInstallSummary(version, installRoot string, hasDaemon bool) {
	fmt.Printf("\nУстановлен NeuralV %s\n", version)
	fmt.Printf("Путь: %s\n", installRoot)
	fmt.Println("Открыть TUI: neuralv")
	fmt.Println("Проверка версии: neuralv -v")
	if hasDaemon {
		fmt.Println("Бинарь daemon: ~/.local/bin/neuralvd")
	}
	if pathEnv := os.Getenv("PATH"); !strings.Contains(pathEnv, installRoot) {
		fmt.Printf("\nPATH: добавь %s в PATH, если neuralv не находится сразу.\n", installRoot)
	}
}
