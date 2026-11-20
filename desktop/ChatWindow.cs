using System;
using System.Diagnostics;
using System.Drawing;
using System.IO;
using System.Threading.Tasks;
using System.Windows.Forms;
using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.WinForms;

internal sealed class ChatWindow : Form
{
    private readonly Uri address;
    private readonly string profile;
    private readonly bool check;
    private readonly bool preview;
    private readonly WebView2 view;
    private readonly Timer monitor;
    public Exception Failure { get; private set; }

    internal ChatWindow(Uri address, string profile, Process service, bool preview, bool check)
    {
        this.address = address;
        this.profile = profile;
        this.check = check;
        this.preview = preview;
        Text = preview ? "鲸之心 · 本地聊天（预览）" : "鲸之心 · 本地聊天";
        StartPosition = FormStartPosition.CenterScreen;
        AutoScaleMode = AutoScaleMode.Dpi;
        Size = new Size(1250, 865);
        MinimumSize = new Size(520, 440);
        BackColor = Color.FromArgb(247, 241, 232);
        Controls.Add(new Label { Text = "正在打开鲸之心…", Dock = DockStyle.Fill, TextAlign = ContentAlignment.MiddleCenter });
        view = new WebView2 { Dock = DockStyle.Fill, Visible = false, DefaultBackgroundColor = BackColor };
        Controls.Add(view);
        monitor = new Timer { Interval = 500 };
        monitor.Tick += delegate
        {
            if (service.HasExited) Fail(new InvalidOperationException("鲸之心本地服务已停止，请重新打开应用。"));
        };
        Shown += Initialize;
        FormClosed += delegate { monitor.Dispose(); };
    }

    private async void Initialize(object sender, EventArgs e)
    {
        monitor.Start();
        try
        {
            var options = new CoreWebView2EnvironmentOptions("--no-proxy-server");
            var environment = await CoreWebView2Environment.CreateAsync(null, Path.Combine(profile, "WebView2"), options);
            if (IsDisposed) return;
            await view.EnsureCoreWebView2Async(environment);
            if (IsDisposed) return;
            var core = view.CoreWebView2;
            core.Settings.AreDevToolsEnabled = false;
            core.Settings.AreDefaultContextMenusEnabled = false;
            core.Settings.AreBrowserAcceleratorKeysEnabled = false;
            core.NewWindowRequested += delegate(object _, CoreWebView2NewWindowRequestedEventArgs request)
            {
                request.Handled = true;
            };
            core.NavigationStarting += delegate(object _, CoreWebView2NavigationStartingEventArgs navigation)
            {
                Uri target;
                navigation.Cancel = !Uri.TryCreate(navigation.Uri, UriKind.Absolute, out target) ||
                    target.GetLeftPart(UriPartial.Authority) != address.GetLeftPart(UriPartial.Authority);
            };
            view.Visible = true;
            view.BringToFront();
            string query = preview ? "?role=xiaoyu-memory-demo" : "";
            if (check)
            {
                await core.AddScriptToExecuteOnDocumentCreatedAsync(
                    "addEventListener('pagereveal', event => { window.workspaceTransition = Boolean(event.viewTransition); });");
                await CheckPage(query, preview
                    ? "document.querySelector('#name').textContent.includes('记忆演示') && document.querySelectorAll('.message-row').length >= 8"
                    : "document.querySelectorAll('#roles button').length > 0 && document.querySelector('#send-button')");
                const string frameRects = "JSON.stringify([...document.querySelectorAll('.workspace-side,.workspace-card')].map(el=>el.getBoundingClientRect().toJSON()))";
                const string transition = "(document.hidden || matchMedia('(prefers-reduced-motion: reduce)').matches || window.workspaceTransition === true)";
                string chatRects = await core.ExecuteScriptAsync(frameRects);
                await CheckPage("memory.html" + query, transition + " && !document.querySelector('#memory-add').disabled"
                    + (preview ? " && document.querySelectorAll('#memory-list article').length === 2" : ""), "#open-memory");
                if (chatRects != await core.ExecuteScriptAsync(frameRects))
                    throw new InvalidOperationException("对话和记忆的外框位置不一致。");
                string experienceCheck = preview ? " && document.querySelectorAll('#experience-list article').length === 1" : "";
                if (await core.ExecuteScriptAsync("document.querySelector('[data-memory-view=experiences]').click();" +
                    "document.querySelector('#memory-list').hidden && !document.querySelector('#experience-section').hidden" + experienceCheck) != "true")
                    throw new InvalidOperationException("共同经历视图没有独立显示。");
                await CheckPage("roles.html" + query, transition + " && document.querySelectorAll('.role-archive-card').length > 0", "#memory-role-link");
                if (chatRects != await core.ExecuteScriptAsync(frameRects))
                    throw new InvalidOperationException("对话和角色档案的外框位置不一致。");
                const string roleEditor = "!document.querySelector('#role-form').hidden && !document.querySelector('#card-pane').hidden && document.querySelectorAll('[data-section]').length === 3";
                await core.ExecuteScriptAsync("document.querySelector('.role-archive-edit').click()");
                await CheckReady("角色编辑弹窗", roleEditor + " && document.querySelector('#role-dialog').open && document.querySelector('#card-id').readOnly && document.querySelector('#card-name').value");
                if (await core.ExecuteScriptAsync("document.querySelector('#role-cancel').click(); !document.querySelector('#role-dialog').open && document.querySelector('#role-archive:not([hidden])') !== null") != "true")
                    throw new InvalidOperationException("角色编辑取消后未返回角色档案。");
                await CheckPage("roles.html?view=new", "!document.querySelector('#role-import-panel').hidden && !document.querySelector('#yaml-import').hidden && document.querySelectorAll('#yaml-import button, #yaml-import a').length === 2 && document.querySelector('#import-avatar').getClientRects().length > 0 && !document.querySelector('#import-footer').hidden && document.querySelector('#save-import').disabled && document.querySelector('#role-form').hidden");
                await core.ExecuteScriptAsync("document.querySelector('#show-manual-import').click()");
                await CheckReady("手写角色问卷", "!document.querySelector('#role-questionnaire').hidden && document.querySelectorAll('#required-questions label').length === 2 && document.querySelector('#import-avatar').getClientRects().length > 0");
                if (chatRects != await core.ExecuteScriptAsync(frameRects))
                    throw new InvalidOperationException("对话和角色编辑的外框位置不一致。");
                if (preview)
                {
                    await CheckPage("?role=xiaoyu", "document.querySelector('#name').textContent.includes('小鱼') && document.querySelector('.chat-empty')");
                }
                Close();
            }
            else
            {
                core.NavigationCompleted += delegate(object _, CoreWebView2NavigationCompletedEventArgs navigation)
                {
                    if (!navigation.IsSuccess && navigation.WebErrorStatus != CoreWebView2WebErrorStatus.OperationCanceled)
                        Fail(new InvalidOperationException("鲸之心页面加载失败，请重新打开应用。"));
                };
                core.Navigate(new Uri(address, query).AbsoluteUri);
            }
        }
        catch (WebView2RuntimeNotFoundException)
        {
            if (!IsDisposed) Fail(new InvalidOperationException("本机缺少 Microsoft WebView2 Runtime。安装该运行组件后可打开鲸之心。"));
        }
        catch (Exception error)
        {
            if (!IsDisposed) Fail(error);
        }
    }

    private async Task CheckPage(string route, string condition, string link = null)
    {
        var core = view.CoreWebView2;
        var navigation = new TaskCompletionSource<bool>();
        EventHandler<CoreWebView2NavigationCompletedEventArgs> handler = delegate(object _, CoreWebView2NavigationCompletedEventArgs e)
        {
            navigation.TrySetResult(e.IsSuccess);
        };
        core.NavigationCompleted += handler;
        try
        {
            if (link == null) core.Navigate(new Uri(address, route).AbsoluteUri);
            else
            {
                await Task.Delay(225);
                await core.ExecuteScriptAsync("document.querySelector('" + link + "').click()");
            }
            if (await Task.WhenAny(navigation.Task, Task.Delay(6000)) != navigation.Task || !await navigation.Task)
                throw new InvalidOperationException("窗口加载失败：" + route);
            await CheckReady(route, condition);
        }
        finally { core.NavigationCompleted -= handler; }
    }

    private async Task CheckReady(string page, string condition)
    {
        var core = view.CoreWebView2;
        for (int i = 0; i < 30; ++i)
        {
            if (await core.ExecuteScriptAsync("Boolean(" + condition + ")") == "true") return;
            await Task.Delay(100);
        }
        throw new InvalidOperationException("窗口页面未就绪：" + page + " " +
            await core.ExecuteScriptAsync("JSON.stringify({page:location.pathname,visibility:document.visibilityState,transition:window.workspaceTransition,active:document.querySelector(':active-view-transition')!==null})"));
    }

    private void Fail(Exception error)
    {
        Failure = error;
        Close();
    }
}
