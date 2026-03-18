using NeuralV.Windows;
using NeuralV.Windows.Models;
using NeuralV.Windows.Services;

WindowsLog.StartSession("windows-cli");
WindowsLog.Info($"CLI command line: {string.Join(' ', args)}");

try
{
    using var apiClient = new NeuralVApiClient();
    Environment.ExitCode = await RunAsync(args, apiClient);
}
catch (Exception ex)
{
    WindowsLog.Error("CLI fatal error", ex);
    Console.Error.WriteLine(HumanizeError(ex));
    Environment.ExitCode = 1;
}

static async Task<int> RunAsync(string[] args, NeuralVApiClient apiClient)
{
    var command = args.FirstOrDefault()?.Trim().ToLowerInvariant();

    switch (command)
    {
        case null:
        case "":
        case "help":
        case "--help":
        case "-h":
            PrintHelp();
            return 0;
        case "version":
        case "--version":
        case "-v":
            Console.WriteLine(VersionInfo.Current);
            return 0;
        case "login":
            return await RunLoginAsync(apiClient);
        case "register":
            return await RunRegisterAsync(apiClient);
        case "logout":
            return await RunLogoutAsync(apiClient);
        case "whoami":
            return await RunWhoAmIAsync(apiClient);
        case "quick":
            return await RunQuickScanAsync();
        case "deep":
            return await RunServerScanAsync(apiClient, "FULL", "deep");
        case "selective":
            return await RunServerScanAsync(apiClient, "SELECTIVE", "selective");
        case "file":
            return await RunFileScanAsync(apiClient, args.Skip(1).FirstOrDefault());
        case "scan":
            return await RunLegacyScanAsync(apiClient, args.Skip(1).ToArray());
        case "history":
            return await RunHistoryAsync();
        default:
            Console.Error.WriteLine($"Неизвестная команда: {command}");
            PrintHelp();
            return 1;
    }
}

static async Task<int> RunLoginAsync(NeuralVApiClient apiClient)
{
    var email = Prompt("Почта");
    var password = PromptSecret("Пароль");
    var deviceId = SessionStore.EnsureDeviceId();

    Console.WriteLine("Отправляем запрос на вход...");
    var ticket = await apiClient.StartLoginAsync(email, password, deviceId);
    if (!ticket.Ok)
    {
        Console.Error.WriteLine(ticket.Error);
        return 1;
    }

    var code = Prompt("Код подтверждения");
    var result = await apiClient.VerifyChallengeAsync(AuthMode.Login, ticket.ChallengeId, ticket.Email, code, deviceId);
    if (result.session is null)
    {
        Console.Error.WriteLine(result.error ?? "Не удалось завершить вход.");
        return 1;
    }

    await SessionStore.SaveSessionAsync(result.session);
    Console.WriteLine($"Вход выполнен: {result.session.User.Email}");
    return 0;
}

static async Task<int> RunRegisterAsync(NeuralVApiClient apiClient)
{
    var name = Prompt("Имя");
    var email = Prompt("Почта");
    var password = PromptSecret("Пароль");
    var repeat = PromptSecret("Повтори пароль");
    if (!string.Equals(password, repeat, StringComparison.Ordinal))
    {
        Console.Error.WriteLine("Пароли не совпадают.");
        return 1;
    }

    var deviceId = SessionStore.EnsureDeviceId();
    Console.WriteLine("Создаём регистрацию...");
    var ticket = await apiClient.StartRegisterAsync(name, email, password, deviceId);
    if (!ticket.Ok)
    {
        Console.Error.WriteLine(ticket.Error);
        return 1;
    }

    var code = Prompt("Код подтверждения");
    var result = await apiClient.VerifyChallengeAsync(AuthMode.Register, ticket.ChallengeId, ticket.Email, code, deviceId);
    if (result.session is null)
    {
        Console.Error.WriteLine(result.error ?? "Не удалось завершить регистрацию.");
        return 1;
    }

    await SessionStore.SaveSessionAsync(result.session);
    Console.WriteLine($"Регистрация завершена: {result.session.User.Email}");
    return 0;
}

static async Task<int> RunLogoutAsync(NeuralVApiClient apiClient)
{
    var session = await SessionStore.LoadSessionAsync();
    if (session is null)
    {
        Console.WriteLine("Активной сессии нет.");
        return 0;
    }

    try
    {
        await apiClient.LogoutAsync(session);
    }
    catch (Exception ex)
    {
        WindowsLog.Error("CLI logout request failed", ex);
    }

    SessionStore.ClearSession();
    Console.WriteLine("Сессия очищена.");
    return 0;
}

static async Task<int> RunWhoAmIAsync(NeuralVApiClient apiClient)
{
    var session = await LoadSessionWithRefreshAsync(apiClient);
    if (session is null)
    {
        Console.Error.WriteLine("Сначала войди в аккаунт: neuralv login");
        return 1;
    }

    Console.WriteLine($"Пользователь: {session.User.Name}");
    Console.WriteLine($"Почта: {session.User.Email}");
    Console.WriteLine($"Премиум: {(session.User.IsPremium ? "да" : "нет")}");
    Console.WriteLine($"Режим разработчика: {(session.User.IsDeveloperMode ? "да" : "нет")}");
    return 0;
}

static async Task<int> RunQuickScanAsync()
{
    Console.WriteLine("Запускаем проверку: quick");
    var scan = await Task.Run(WindowsLocalQuickScanService.Run);
    PrintCompletedScan(scan);
    await HistoryStore.AppendAsync(scan);
    return 0;
}

static async Task<int> RunServerScanAsync(NeuralVApiClient apiClient, string mode, string displayMode)
{
    var session = await LoadSessionWithRefreshAsync(apiClient);
    if (session is null)
    {
        Console.Error.WriteLine("Сначала войди в аккаунт: neuralv login");
        return 1;
    }

    var plan = WindowsScanPlanService.BuildSmartCoveragePlan(mode, "FILESYSTEM", Environment.MachineName, Environment.SystemDirectory);
    Console.WriteLine($"Запускаем проверку: {displayMode}");
    var started = await apiClient.StartDesktopScanAsync(session, plan);
    if (started.scan is null)
    {
        Console.Error.WriteLine(started.error ?? "Не удалось создать server scan.");
        return 1;
    }

    return await PollAndPrintScanAsync(apiClient, session, started.scan);
}

static async Task<int> RunFileScanAsync(NeuralVApiClient apiClient, string? targetPath)
{
    if (string.IsNullOrWhiteSpace(targetPath))
    {
        Console.Error.WriteLine("Укажи путь: neuralv file <path>");
        return 1;
    }

    var fullPath = Path.GetFullPath(targetPath);
    if (!File.Exists(fullPath) && !Directory.Exists(fullPath))
    {
        Console.Error.WriteLine($"Путь не найден: {fullPath}");
        return 1;
    }

    var session = await LoadSessionWithRefreshAsync(apiClient);
    if (session is null)
    {
        Console.Error.WriteLine("Сначала войди в аккаунт: neuralv login");
        return 1;
    }

    var targetName = File.Exists(fullPath) ? Path.GetFileName(fullPath) : new DirectoryInfo(fullPath).Name;
    var plan = WindowsScanPlanService.BuildProgramOrFilePlan("ARTIFACT", "ARTIFACT", fullPath, targetName, DesktopCoverageMode.SmartCoverage);
    Console.WriteLine($"Запускаем проверку: file ({fullPath})");
    var started = await apiClient.StartDesktopScanAsync(session, plan);
    if (started.scan is null)
    {
        Console.Error.WriteLine(started.error ?? "Не удалось создать server scan.");
        return 1;
    }

    return await PollAndPrintScanAsync(apiClient, session, started.scan);
}

static async Task<int> RunLegacyScanAsync(NeuralVApiClient apiClient, string[] args)
{
    var mode = args.FirstOrDefault()?.Trim().ToLowerInvariant();
    return mode switch
    {
        "quick" => await RunQuickScanAsync(),
        "deep" => await RunServerScanAsync(apiClient, "FULL", "deep"),
        "selective" => await RunServerScanAsync(apiClient, "SELECTIVE", "selective"),
        _ => LegacyUnsupported(mode)
    };
}

static int LegacyUnsupported(string? mode)
{
    Console.Error.WriteLine($"Неподдерживаемый режим: {mode}");
    Console.Error.WriteLine("Используй neuralv quick, neuralv deep, neuralv selective или neuralv file <path>.");
    return 1;
}

static async Task<int> PollAndPrintScanAsync(NeuralVApiClient apiClient, SessionData session, DesktopScanState initial)
{
    var scan = initial;
    var seen = new HashSet<string>(StringComparer.Ordinal);
    Console.WriteLine($"ID: {scan.Id}");

    while (true)
    {
        var polled = await apiClient.GetDesktopScanAsync(session, scan.Id);
        if (polled.scan is null)
        {
            Console.Error.WriteLine(polled.error ?? "Не удалось получить статус.");
            return 1;
        }

        scan = polled.scan;
        foreach (var item in scan.Timeline)
        {
            if (seen.Add(item))
            {
                Console.WriteLine(item);
            }
        }

        if (scan.IsFinished)
        {
            PrintCompletedScan(scan);
            if (scan.IsSuccessful)
            {
                await HistoryStore.AppendAsync(scan);
            }
            return scan.IsSuccessful ? 0 : 1;
        }

        await Task.Delay(TimeSpan.FromSeconds(3));
    }
}

static void PrintCompletedScan(DesktopScanState scan)
{
    Console.WriteLine();
    Console.WriteLine($"Итог: {scan.Status}");
    Console.WriteLine($"Вердикт: {scan.Verdict}");
    if (!string.IsNullOrWhiteSpace(scan.Message))
    {
        Console.WriteLine(scan.Message);
    }

    if (scan.Findings.Count > 0)
    {
        Console.WriteLine();
        Console.WriteLine("Найденные элементы:");
        foreach (var finding in scan.Findings)
        {
            Console.WriteLine($"- {finding.Title}: {finding.Summary}");
        }
    }
}

static async Task<int> RunHistoryAsync()
{
    var history = await HistoryStore.LoadAsync();
    if (history.Count == 0)
    {
        Console.WriteLine("История пока пустая.");
        return 0;
    }

    foreach (var item in history)
    {
        Console.WriteLine($"[{item.SavedAt:yyyy-MM-dd HH:mm}] {item.Mode} | {item.Verdict}");
        if (!string.IsNullOrWhiteSpace(item.Message))
        {
            Console.WriteLine($"  {item.Message}");
        }
    }

    return 0;
}

static async Task<SessionData?> LoadSessionWithRefreshAsync(NeuralVApiClient apiClient)
{
    var session = await SessionStore.LoadSessionAsync();
    if (session is null)
    {
        return null;
    }

    try
    {
        var refreshed = await apiClient.RefreshSessionAsync(session);
        if (refreshed.session is { } next)
        {
            await SessionStore.SaveSessionAsync(next);
            return next;
        }
    }
    catch (Exception ex)
    {
        WindowsLog.Error("CLI refresh failed", ex);
    }

    return session.IsValid ? session : null;
}

static string Prompt(string label)
{
    Console.Write($"{label}: ");
    return (Console.ReadLine() ?? string.Empty).Trim();
}

static string PromptSecret(string label)
{
    Console.Write($"{label}: ");
    var chars = new List<char>();
    while (true)
    {
        var key = Console.ReadKey(intercept: true);
        if (key.Key == ConsoleKey.Enter)
        {
            Console.WriteLine();
            return new string(chars.ToArray());
        }

        if (key.Key == ConsoleKey.Backspace)
        {
            if (chars.Count == 0)
            {
                continue;
            }
            chars.RemoveAt(chars.Count - 1);
            Console.Write("\b \b");
            continue;
        }

        if (!char.IsControl(key.KeyChar))
        {
            chars.Add(key.KeyChar);
            Console.Write('*');
        }
    }
}

static string HumanizeError(Exception ex)
{
    var text = ex.Message.Trim();
    if (string.IsNullOrWhiteSpace(text))
    {
        text = ex.GetType().Name;
    }
    return $"Ошибка: {text}";
}

static void PrintHelp()
{
    Console.WriteLine("NeuralV Windows CLI");
    Console.WriteLine();
    Console.WriteLine("Команды:");
    Console.WriteLine("  neuralv login");
    Console.WriteLine("  neuralv register");
    Console.WriteLine("  neuralv logout");
    Console.WriteLine("  neuralv whoami");
    Console.WriteLine("  neuralv quick");
    Console.WriteLine("  neuralv deep");
    Console.WriteLine("  neuralv selective");
    Console.WriteLine("  neuralv file <path>");
    Console.WriteLine("  neuralv history");
    Console.WriteLine("  neuralv version");
}
