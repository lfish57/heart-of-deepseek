using System;
using System.Diagnostics;
using System.IO;
using System.Threading;
using System.Windows.Forms;

internal static class Launcher
{
    private const string ReadyPrefix = "HEART_READY ";

    [STAThread]
    private static int Main(string[] args)
    {
        bool preview = Array.IndexOf(args, "--preview") >= 0 ||
            Path.GetFileNameWithoutExtension(Application.ExecutablePath).StartsWith("预览", StringComparison.Ordinal);
        bool checkWindow = Array.IndexOf(args, "--check-window") >= 0;
        bool check = checkWindow || Array.IndexOf(args, "--check") >= 0;
        string baseDir = AppDomain.CurrentDomain.BaseDirectory;
        string profile = check
            ? Path.Combine(Path.GetTempPath(), "heart-check-" + Guid.NewGuid().ToString("N"))
            : Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
                "HeartOfDeepseek", preview ? "Preview" : "App");
        Application.EnableVisualStyles();
        Application.SetCompatibleTextRenderingDefault(false);
        try
        {
            using (var mutex = new Mutex(false, check ? "HeartOfDeepseekCheck-" + Guid.NewGuid().ToString("N")
                : preview ? "Local\\HeartOfDeepseekPreview" : "Local\\HeartOfDeepseek"))
            {
                bool owns;
                try { owns = mutex.WaitOne(0); }
                catch (AbandonedMutexException) { owns = true; }
                if (!owns)
                {
                    MessageBox.Show("鲸之心窗口已经打开，可以从任务栏切回。", "鲸之心", MessageBoxButtons.OK, MessageBoxIcon.Information);
                    return 0;
                }
                try { Run(baseDir, profile, preview, check, checkWindow); }
                finally { mutex.ReleaseMutex(); }
            }
            return 0;
        }
        catch (Exception error)
        {
            if (check) Console.Error.WriteLine(error.ToString());
            else MessageBox.Show(error.Message, "鲸之心未能启动", MessageBoxButtons.OK, MessageBoxIcon.Error);
            return 1;
        }
    }

    private static void Run(string baseDir, string profile, bool preview, bool check, bool checkWindow)
    {
        string appDir = Path.Combine(baseDir, "app");
        string runtime = Path.Combine(baseDir, "runtime", "node.exe");
        if (!File.Exists(runtime) || !File.Exists(Path.Combine(appDir, "server.mjs")))
            throw new IOException("应用文件不完整，请从完整应用文件夹重新打开鲸之心。");
        Directory.CreateDirectory(profile);

        var serviceArgs = new ProcessStartInfo(runtime, "server.mjs")
        {
            UseShellExecute = false,
            CreateNoWindow = true,
            WorkingDirectory = appDir,
            RedirectStandardInput = true,
            RedirectStandardOutput = true
        };
        serviceArgs.StandardOutputEncoding = System.Text.Encoding.UTF8;
        serviceArgs.EnvironmentVariables["HEART_PORT"] = "0";
        serviceArgs.EnvironmentVariables["HEART_DATA_DIR"] = Path.Combine(profile, "Data");
        serviceArgs.EnvironmentVariables["HEART_DESKTOP"] = "1";
        serviceArgs.EnvironmentVariables["HEART_PREVIEW"] = preview ? "1" : "0";

        using (var service = Process.Start(serviceArgs))
        {
            try
            {
                var line = service.StandardOutput.ReadLineAsync();
                if (!line.Wait(TimeSpan.FromSeconds(12)) || line.Result == null ||
                    !line.Result.StartsWith(ReadyPrefix, StringComparison.Ordinal))
                    throw new InvalidOperationException("本地服务未能启动。运行时数据目录：" + profile);
                Uri address;
                if (!Uri.TryCreate(line.Result.Substring(ReadyPrefix.Length), UriKind.Absolute, out address) ||
                    address.Scheme != "http" || address.Host != "127.0.0.1" || address.Port < 1024)
                    throw new InvalidOperationException("本地服务返回了无效地址。");

                VerifyPage(address, preview && check);
                if (!check || checkWindow)
                {
                    using (var window = new ChatWindow(address, profile, service, preview, checkWindow))
                    {
                        Application.Run(window);
                        if (window.Failure != null) throw window.Failure;
                    }
                }
            }
            finally
            {
                service.StandardInput.Close();
                if (!service.WaitForExit(3000)) service.Kill();
            }
        }
    }

    private static void VerifyPage(Uri address, bool verifyPreview)
    {
        using (var client = new System.Net.WebClient())
        {
            client.Proxy = null;
            if (!client.DownloadString(address).Contains("id=\"messages\""))
                throw new InvalidOperationException("本地对话页未能加载。");
            if (verifyPreview && !client.DownloadString(new Uri(address, "memory.html")).Contains("id=\"memory-list\""))
                throw new InvalidOperationException("记忆预览页未能加载。");
        }
    }

}
