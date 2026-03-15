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
	"strings"
	"time"

	"github.com/perdonus/neuralv-shell/internal/api"
)

const (
	nvVersion        = "0.1.0"
	defaultBaseURL   = "https://sosiskibot.ru/basedata"
	defaultBinaryDir = ".local/bin"
)

func main() {
	client := api.NewClient(resolveBaseURL())
	if err := handle(os.Args[1:], client); err != nil {
		fmt.Fprintln(os.Stderr, err)
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
			return errors.New("missing package spec: use nv install neuralv@latest")
		}
		return installPackage(client, args[1])
	case "uninstall":
		if len(args) < 2 {
			return errors.New("missing package name: use nv uninstall neuralv")
		}
		return uninstallPackage(args[1])
	default:
		printHelp()
		return fmt.Errorf("unknown command: %s", args[0])
	}
}

func printHelp() {
	fmt.Println(`nv

Commands:
  nv install neuralv@latest
  nv install neuralv@<version>
  nv uninstall neuralv
  nv -v | --version
  nv help`)
}

func installPackage(client *api.Client, spec string) error {
	name, version, err := parsePackageSpec(spec)
	if err != nil {
		return err
	}
	if name != "neuralv" {
		return fmt.Errorf("unsupported package: %s", name)
	}

	manifest, err := client.ReleaseManifest()
	if err != nil {
		return fmt.Errorf("manifest unavailable: %w", err)
	}

	artifact := manifest.Artifact("shell", "linux_shell")
	if artifact == nil || strings.TrimSpace(artifact.DownloadURL) == "" {
		return errors.New("neuralv shell artifact is not available in manifest yet")
	}
	if version != "latest" && artifact.Version != "" && artifact.Version != version {
		return fmt.Errorf("requested neuralv@%s, but manifest currently exposes %s", version, artifact.Version)
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
	if err := downloadArtifactBinary(artifact.DownloadURL, tmpDir, shellTarget, "neuralv-shell"); err != nil {
		return err
	}

	if daemonURL, ok := metadataString(artifact.Metadata, "daemonUrl"); ok && strings.TrimSpace(daemonURL) != "" {
		daemonTarget := filepath.Join(installRoot, "neuralvd")
		if err := downloadArtifactBinary(daemonURL, tmpDir, daemonTarget, "neuralvd"); err != nil {
			return err
		}
	}

	wrapper := filepath.Join(installRoot, "neuralv")
	wrapperBody := fmt.Sprintf("#!/usr/bin/env sh\nexec %q \"$@\"\n", shellTarget)
	if err := os.WriteFile(wrapper, []byte(wrapperBody), 0o755); err != nil {
		return err
	}

	shownVersion := artifact.Version
	if shownVersion == "" {
		shownVersion = version
	}

	fmt.Printf("Installed NeuralV %s\n", shownVersion)
	fmt.Printf("Run: %s\n", wrapper)
	fmt.Println("Version check: neuralv -v")
	return nil
}

func uninstallPackage(name string) error {
	if strings.TrimSpace(name) != "neuralv" {
		return fmt.Errorf("unsupported package: %s", name)
	}

	installRoot, err := defaultInstallRoot()
	if err != nil {
		return err
	}

	for _, target := range []string{"neuralv", "neuralv-shell", "neuralvd"} {
		path := filepath.Join(installRoot, target)
		if err := os.Remove(path); err != nil && !errors.Is(err, os.ErrNotExist) {
			return err
		}
	}

	fmt.Println("Removed NeuralV from ~/.local/bin")
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
		return fmt.Errorf("artifact download failed: http %d: %s", response.StatusCode, strings.TrimSpace(string(body)))
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
	var extracted []string

	for {
		header, err := tarReader.Next()
		if errors.Is(err, io.EOF) {
			break
		}
		if err != nil {
			return err
		}
		if header.Typeflag != tar.TypeReg && header.Typeflag != tar.TypeRegA {
			continue
		}

		name := path.Base(header.Name)
		if name == "." || name == "" {
			continue
		}

		destination := filepath.Join(tmpDir, name)
		file, err := os.OpenFile(destination, os.O_CREATE|os.O_WRONLY|os.O_TRUNC, 0o755)
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
		extracted = append(extracted, destination)
	}

	candidate := ""
	for _, item := range extracted {
		if filepath.Base(item) == expectedName {
			candidate = item
			break
		}
	}
	if candidate == "" && len(extracted) > 0 {
		candidate = extracted[0]
	}
	if candidate == "" {
		return errors.New("artifact archive did not contain an executable payload")
	}

	payload, err := os.ReadFile(candidate)
	if err != nil {
		return err
	}
	return os.WriteFile(target, payload, 0o755)
}
