package logging

import (
	"fmt"
	"io"
	"log"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"
)

var (
	mu      sync.RWMutex
	logger  = log.New(io.Discard, "", 0)
	logFile *os.File
	logPath string
)

func Init(appName string) (string, error) {
	file, filePath, err := openLogFile(strings.TrimSpace(appName))
	if err != nil {
		return "", err
	}

	mu.Lock()
	defer mu.Unlock()

	if logFile != nil {
		_ = logFile.Close()
	}

	logFile = file
	logPath = filePath
	logger = log.New(file, "", 0)
	return filePath, nil
}

func openLogFile(appName string) (*os.File, string, error) {
	for _, root := range candidateRoots(appName) {
		if root == "" {
			continue
		}
		if err := os.MkdirAll(root, 0o700); err != nil {
			continue
		}
		filePath := filepath.Join(root, "log.txt")
		file, err := os.OpenFile(filePath, os.O_CREATE|os.O_WRONLY|os.O_TRUNC, 0o600)
		if err == nil {
			return file, filePath, nil
		}
	}
	return nil, "", fmt.Errorf("не удалось создать log.txt ни в одной из доступных директорий")
}

func candidateRoots(appName string) []string {
	roots := make([]string, 0, 4)
	if executableRoot := executableDir(); executableRoot != "" {
		roots = append(roots, executableRoot)
	}
	if workDir, err := os.Getwd(); err == nil && strings.TrimSpace(workDir) != "" {
		roots = append(roots, workDir)
	}
	if dataRoot := userDataDir(); dataRoot != "" {
		roots = append(roots, filepath.Join(dataRoot, appName))
	}

	seen := map[string]struct{}{}
	filtered := make([]string, 0, len(roots))
	for _, root := range roots {
		root = strings.TrimSpace(root)
		if root == "" {
			continue
		}
		if _, ok := seen[root]; ok {
			continue
		}
		seen[root] = struct{}{}
		filtered = append(filtered, root)
	}
	return filtered
}

func executableDir() string {
	executablePath, err := os.Executable()
	if err != nil {
		return ""
	}
	if resolved, err := filepath.EvalSymlinks(executablePath); err == nil && strings.TrimSpace(resolved) != "" {
		executablePath = resolved
	}
	return filepath.Dir(executablePath)
}

func userDataDir() string {
	if value := strings.TrimSpace(os.Getenv("XDG_DATA_HOME")); value != "" {
		return value
	}
	home := strings.TrimSpace(os.Getenv("HOME"))
	if home == "" {
		return ""
	}
	return filepath.Join(home, ".local", "share")
}

func Close() error {
	mu.Lock()
	defer mu.Unlock()

	if logFile == nil {
		return nil
	}

	err := logFile.Close()
	logFile = nil
	logger = log.New(io.Discard, "", 0)
	return err
}

func Path() string {
	mu.RLock()
	defer mu.RUnlock()
	return logPath
}

func Event(topic, format string, args ...any) {
	write(topic, fmt.Sprintf(format, args...))
}

func Error(format string, args ...any) {
	write("error", fmt.Sprintf(format, args...))
}

func write(topic, message string) {
	mu.RLock()
	defer mu.RUnlock()
	logger.Printf("%s [%s] %s", time.Now().Format(time.RFC3339), strings.TrimSpace(topic), strings.TrimSpace(message))
}
